/** What MADP produced for a project: the list the app's server reads from the project's saved work (GET /api/outputs/:id)
 *  and the links to each file. Pure parsing and one same-origin fetch; no React, no store. */

export const OUTPUTS_SCHEMA = "madp-outputs/1";

export const OUTPUT_KINDS = ["md", "yaml", "json", "html", "png", "log", "txt"] as const;
export type OutputKind = (typeof OUTPUT_KINDS)[number];
export type OutputStatus = "pass" | "fail" | "hold" | "open" | "info";

export interface OutputItem {
  path: string;
  title: string;
  summary: string;
  /** A kind the server may add later is kept as "other": it opens in a new tab and downloads, it is not read in the app. */
  kind: OutputKind | "other";
  bytes: number;
  updatedAt: string;
  status?: OutputStatus;
  group?: string;
}

export interface OutputSection { id: string; title: string; summary: string; items: OutputItem[] }
export interface OutputFact { label: string; value: string }

export interface OutputsManifest {
  schema: typeof OUTPUTS_SCHEMA;
  projectId: string;
  workspaceId: string;
  name: string;
  generatedAt: string;
  summary: string;
  facts: OutputFact[];
  sections: OutputSection[];
}

/** ok, nothing produced yet (404), not signed in (401), or not available (503, another answer, no answer). */
export type OutputsResult =
  | { status: "ok"; manifest: OutputsManifest }
  | { status: "empty" }
  | { status: "signed-out" }
  | { status: "unavailable" };

const STATUSES: readonly OutputStatus[] = ["pass", "fail", "hold", "open", "info"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

export function outputsUrl(projectId: string): string {
  return `/api/outputs/${encodeURIComponent(projectId)}`;
}

/** The file's own address: it opens in the browser (or in the in-app reader); with download it is saved instead. */
export function outputFileUrl(projectId: string, path: string, download = false): string {
  return `${outputsUrl(projectId)}/file?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
}

function parseItem(v: unknown): OutputItem | null {
  if (!isObj(v)) return null;
  const path = str(v.path);
  if (!path) return null;
  const kind = (OUTPUT_KINDS as readonly string[]).includes(str(v.kind)) ? (v.kind as OutputKind) : "other";
  const bytes = typeof v.bytes === "number" && Number.isFinite(v.bytes) && v.bytes >= 0 ? v.bytes : 0;
  const item: OutputItem = {
    path,
    title: str(v.title).trim() || path.split("/").pop() || path,
    summary: str(v.summary),
    kind,
    bytes,
    updatedAt: str(v.updatedAt),
  };
  if ((STATUSES as readonly string[]).includes(str(v.status))) item.status = v.status as OutputStatus;
  const group = str(v.group).trim();
  if (group) item.group = group;
  return item;
}

function parseSection(v: unknown, i: number): OutputSection | null {
  if (!isObj(v)) return null;
  const items = Array.isArray(v.items) ? v.items.map(parseItem).filter((x): x is OutputItem => x !== null) : [];
  return { id: str(v.id) || `section-${i + 1}`, title: str(v.title).trim() || "Other files", summary: str(v.summary), items };
}

/** The server's answer as a manifest, or null when it is not one (another schema, missing project or sections). */
export function parseOutputsManifest(body: unknown): OutputsManifest | null {
  if (!isObj(body) || body.schema !== OUTPUTS_SCHEMA || !str(body.projectId) || !Array.isArray(body.sections)) return null;
  const facts = Array.isArray(body.facts)
    ? body.facts.filter(isObj).map((f) => ({ label: str(f.label), value: str(f.value) })).filter((f) => f.label && f.value)
    : [];
  return {
    schema: OUTPUTS_SCHEMA,
    projectId: str(body.projectId),
    workspaceId: str(body.workspaceId),
    name: str(body.name),
    generatedAt: str(body.generatedAt),
    summary: str(body.summary),
    facts,
    sections: body.sections.map(parseSection).filter((s): s is OutputSection => s !== null),
  };
}

/** Reads what MADP produced for the project. Never throws: every failure is one of the result's states. */
export async function fetchOutputs(projectId: string, signal?: AbortSignal): Promise<OutputsResult> {
  try {
    const res = await fetch(outputsUrl(projectId), {
      method: "GET", credentials: "same-origin", cache: "no-store", headers: { accept: "application/json" }, signal,
    });
    if (res.status === 404) return { status: "empty" };
    if (res.status === 401) return { status: "signed-out" };
    if (res.status !== 200) return { status: "unavailable" };
    const manifest = parseOutputsManifest(await res.json());
    return manifest ? { status: "ok", manifest } : { status: "unavailable" };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { status: "unavailable" };
  }
}

/** The largest file read inside the app; a larger one is opened in a new tab or downloaded. */
export const READER_MAX_BYTES = 2_000_000;

/** Files the in-app reader shows: text (md, yaml, json, log, txt) and images. Web pages open in a new tab. */
export function readsInApp(kind: OutputItem["kind"]): boolean {
  return kind === "md" || kind === "yaml" || kind === "json" || kind === "log" || kind === "txt" || kind === "png";
}

export type FileTextResult = { status: "ok"; text: string } | { status: "too-large" } | { status: "signed-out" } | { status: "unavailable" };

/** A text file's content for the reader (JSON is shown indented). Never throws. */
export async function fetchOutputText(projectId: string, item: Pick<OutputItem, "path" | "kind">, signal?: AbortSignal): Promise<FileTextResult> {
  try {
    const res = await fetch(outputFileUrl(projectId, item.path), { method: "GET", credentials: "same-origin", cache: "no-store", signal });
    if (res.status === 401) return { status: "signed-out" };
    if (!res.ok) return { status: "unavailable" };
    const len = Number(res.headers.get("content-length"));
    if (Number.isFinite(len) && len > READER_MAX_BYTES) return { status: "too-large" };
    const text = await res.text();
    if (text.length > READER_MAX_BYTES) return { status: "too-large" };
    return { status: "ok", text: item.kind === "json" ? prettyJson(text) : text };
  } catch (e) {
    if (signal?.aborted) throw e;
    return { status: "unavailable" };
  }
}

/** JSON indented by two spaces; anything that does not parse is shown as it is. */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** A section's items in their order, grouped by `group` (groups in order of first appearance; ungrouped items first). */
export function groupOutputItems(items: readonly OutputItem[]): { group: string | null; items: OutputItem[] }[] {
  const loose: OutputItem[] = [];
  const groups = new Map<string, OutputItem[]>();
  for (const item of items) {
    if (!item.group) { loose.push(item); continue; }
    const list = groups.get(item.group);
    if (list) list.push(item);
    else groups.set(item.group, [item]);
  }
  return [
    ...(loose.length ? [{ group: null, items: loose }] : []),
    ...[...groups].map(([group, list]) => ({ group, items: list })),
  ];
}

export function outputFileCount(m: Pick<OutputsManifest, "sections">): number {
  return m.sections.reduce((n, s) => n + s.items.length, 0);
}

/** "840 B", "12 KB", "1.4 MB". */
export function outputSize(bytes: number): string {
  const n = Math.max(0, Math.floor(bytes) || 0);
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} KB`;
  return `${(n / 1_000_000).toFixed(1)} MB`;
}

/** What kind of file it is, in plain words. */
export const OUTPUT_KIND_LABEL: Record<OutputItem["kind"], string> = {
  md: "Document",
  yaml: "Data file",
  json: "Data file",
  html: "Web page",
  png: "Image",
  log: "Work log",
  txt: "Text",
  other: "File",
};

/** The status badge's words and tone. */
export const OUTPUT_STATUS: Record<OutputStatus, { label: string; tone: "success" | "danger" | "warning" | "accent" | "neutral" }> = {
  pass: { label: "Passed", tone: "success" },
  fail: { label: "Failed", tone: "danger" },
  hold: { label: "On hold", tone: "warning" },
  open: { label: "Still open", tone: "accent" },
  info: { label: "For information", tone: "neutral" },
};
