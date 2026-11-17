/**
 * Business documents: shared rules for DocFolder, DocNote and DocFile.
 * Pure (imports only other src/domain files): no DOM, storage, timers or network.
 * Time is always passed in by the caller.
 */
import type { Check } from "./projects";
import { REFUSED_EXTENSIONS as SHARED_REFUSED_EXTENSIONS, magicMatches as sharedMagicMatches } from "./uploads";

export const DOC_KINDS = ["meeting", "presentation", "event", "ideation", "other"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const DOC_KIND_LABEL: Readonly<Record<DocKind, string>> = {
  meeting: "Meeting",
  presentation: "Presentation",
  event: "Event",
  ideation: "Ideation",
  other: "Other",
};

export const FOLDER_NAME_MAX = 80;
export const NOTE_TITLE_MAX = 120;
export const NOTE_BODY_MAX = 100000;
export const FILE_NAME_MAX = 200;
export const UNTITLED_NOTE = "Untitled note";
export const SCRATCH_TITLE = "Scratch pad";

export const MAX_FOLDER_DEPTH = 6;
export const MAX_FOLDERS = 200;
export const MAX_NOTES = 500;
export const MAX_FILES = 500;
export const FILE_MAX_BYTES = 10485760;
export const PROJECT_FILES_MAX_BYTES = 52428800;
export const SORT_GAP = 1024;
export const INT_MAX = 2147483647;

export const FOLDER_STATUSES = ["active", "deleting"] as const;
export const FILE_STATUSES = ["pending", "ready", "rejected", "deleted"] as const;

export interface FolderLite {
  id: string;
  parentId: string;
  name: string;
  kind: DocKind;
  sortOrder: number;
  status: "active" | "deleting";
  createdDate: string;
}
export interface NoteLite {
  id: string;
  folderId: string;
  title: string;
  sortOrder: number;
  isScratch: boolean;
  createdDate: string;
}
export interface FileLite {
  id: string;
  folderId: string;
  name: string;
  mime: string;
  sizeBytes: number;
  status: string;
  sortOrder: number;
  createdDate: string;
}

export type DocItemKind = "folder" | "note" | "file";
export interface DocRef {
  kind: DocItemKind;
  id: string;
}
export interface DocNode {
  kind: DocItemKind;
  id: string;
  folderId: string;
  depth: number;
  label: string;
  sortOrder: number;
  createdDate: string;
  children: DocNode[];
  folder?: FolderLite;
  note?: NoteLite;
  file?: FileLite;
}
export interface DocTree {
  scratch: NoteLite | null;
  roots: DocNode[];
  byId: ReadonlyMap<string, DocNode>;
  /** Folder ids from the root down to the item's parent. */
  ancestors(id: string): string[];
  /** Names of the ancestor folders. */
  path(id: string): string[];
  siblings(folderId: string): DocNode[];
  /** "" = 0. */
  depthOf(folderId: string): number;
  /** A leaf folder = 1. */
  height(folderId: string): number;
}

type Orderable = { sortOrder: number; createdDate: string; id: string };
const cmpOrder = (a: Orderable, b: Orderable): number =>
  a.sortOrder - b.sortOrder || (a.createdDate < b.createdDate ? -1 : a.createdDate > b.createdDate ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildTree(folders: FolderLite[], notes: NoteLite[], files: FileLite[]): DocTree {
  const folderById = new Map(folders.map((f) => [f.id, f]));
  // Hidden: deleting folders and everything under them.
  const hidden = new Set<string>();
  const isHidden = (id: string): boolean => {
    const seen = new Set<string>();
    let cur: string | undefined = id;
    while (cur && folderById.has(cur) && !seen.has(cur)) {
      if (hidden.has(cur)) return true;
      const f: FolderLite = folderById.get(cur)!;
      if (f.status === "deleting") return true;
      seen.add(cur);
      cur = f.parentId;
    }
    return false;
  };
  const visible = folders.filter((f) => !isHidden(f.id));
  const visibleIds = new Set(visible.map((f) => f.id));
  // Parent cycles are broken to the root.
  const parentOf = new Map<string, string>();
  for (const f of visible) parentOf.set(f.id, visibleIds.has(f.parentId) && f.parentId !== f.id ? f.parentId : "");
  for (const f of visible) {
    const seen = new Set<string>([f.id]);
    let cur = parentOf.get(f.id) ?? "";
    while (cur) {
      if (seen.has(cur)) {
        parentOf.set(f.id, "");
        break;
      }
      seen.add(cur);
      cur = parentOf.get(cur) ?? "";
    }
  }
  const nodes = new Map<string, DocNode>();
  for (const f of visible) {
    nodes.set(f.id, { kind: "folder", id: f.id, folderId: parentOf.get(f.id) ?? "", depth: 1, label: f.name, sortOrder: f.sortOrder, createdDate: f.createdDate, children: [], folder: f });
  }
  let scratch: NoteLite | null = null;
  const parentFor = (id: string) => (visibleIds.has(id) ? id : "");
  // Content of a hidden (deleting) folder is hidden too; content of an unknown folder goes to the root.
  const inHidden = (folderId: string) => folderById.has(folderId) && !visibleIds.has(folderId);
  for (const n of notes) {
    if (n.isScratch) {
      scratch = scratch ?? n;
      continue;
    }
    if (inHidden(n.folderId)) continue;
    nodes.set(n.id, { kind: "note", id: n.id, folderId: parentFor(n.folderId), depth: 1, label: n.title, sortOrder: n.sortOrder, createdDate: n.createdDate, children: [], note: n });
  }
  for (const f of files) {
    if (f.status !== "ready" || inHidden(f.folderId)) continue;
    nodes.set(f.id, { kind: "file", id: f.id, folderId: parentFor(f.folderId), depth: 1, label: f.name, sortOrder: f.sortOrder, createdDate: f.createdDate, children: [], file: f });
  }
  const roots: DocNode[] = [];
  for (const node of nodes.values()) {
    if (node.folderId) nodes.get(node.folderId)!.children.push(node);
    else roots.push(node);
  }
  const sortKids = (list: DocNode[]) => {
    const subs = list.filter((x) => x.kind === "folder").sort(cmpOrder);
    const rest = list.filter((x) => x.kind !== "folder").sort(cmpOrder);
    list.splice(0, list.length, ...subs, ...rest);
  };
  const setDepth = (list: DocNode[], depth: number) => {
    sortKids(list);
    for (const x of list) {
      x.depth = depth;
      setDepth(x.children, depth + 1);
    }
  };
  setDepth(roots, 1);

  const heightOf = (n: DocNode): number => 1 + Math.max(0, ...n.children.filter((c) => c.kind === "folder").map(heightOf));
  const tree: DocTree = {
    scratch,
    roots,
    byId: nodes,
    ancestors(id) {
      const out: string[] = [];
      let cur = nodes.get(id)?.folderId ?? "";
      while (cur) {
        out.unshift(cur);
        cur = nodes.get(cur)?.folderId ?? "";
      }
      return out;
    },
    path(id) {
      return tree.ancestors(id).map((a) => nodes.get(a)?.label ?? "");
    },
    siblings(folderId) {
      return folderId ? nodes.get(folderId)?.children ?? [] : roots;
    },
    depthOf(folderId) {
      return folderId ? nodes.get(folderId)?.depth ?? 0 : 0;
    },
    height(folderId) {
      const n = folderId ? nodes.get(folderId) : undefined;
      return n && n.kind === "folder" ? heightOf(n) : 1;
    },
  };
  return tree;
}

/** All descendant folder ids of rootId (deleting ones included), deepest first, excluding rootId. */
export function subtreeOf(folders: FolderLite[], rootId: string): string[] {
  const kids = new Map<string, string[]>();
  for (const f of folders) kids.set(f.parentId, [...(kids.get(f.parentId) ?? []), f.id]);
  const levels: string[][] = [];
  const seen = new Set<string>([rootId]);
  let frontier = [rootId];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) for (const c of kids.get(id) ?? []) if (!seen.has(c)) { seen.add(c); next.push(c); }
    if (next.length) levels.push(next);
    frontier = next;
  }
  return levels.reverse().flat();
}

export type MoveCheck =
  | { ok: true }
  | { ok: false; messageKey: "doc.cycle" | "doc.tooDeep" | "doc.scratchFixed" | "doc.notFound" };

export function canMove(tree: DocTree, item: DocRef, targetFolderId: string): MoveCheck {
  const node = tree.byId.get(item.id);
  if (item.kind === "note" && tree.scratch?.id === item.id) return { ok: false, messageKey: "doc.scratchFixed" };
  if (!node || node.kind !== item.kind) return { ok: false, messageKey: "doc.notFound" };
  if (targetFolderId) {
    const t = tree.byId.get(targetFolderId);
    if (!t || t.kind !== "folder") return { ok: false, messageKey: "doc.notFound" };
  }
  if (item.kind === "folder") {
    if (targetFolderId === item.id || tree.ancestors(targetFolderId).includes(item.id)) return { ok: false, messageKey: "doc.cycle" };
    if (tree.depthOf(targetFolderId) + tree.height(item.id) > MAX_FOLDER_DEPTH) return { ok: false, messageKey: "doc.tooDeep" };
  }
  return { ok: true };
}

export function canCreateFolder(tree: DocTree, parentId: string): MoveCheck {
  if (parentId) {
    const p = tree.byId.get(parentId);
    if (!p || p.kind !== "folder") return { ok: false, messageKey: "doc.notFound" };
  }
  return tree.depthOf(parentId) + 1 > MAX_FOLDER_DEPTH ? { ok: false, messageKey: "doc.tooDeep" } : { ok: true };
}

export function sortOrderBetween(prev: number | null, next: number | null): number | "renumber" {
  let v: number;
  if (prev === null && next === null) return SORT_GAP;
  if (next === null) {
    v = (prev as number) + SORT_GAP;
    return v > INT_MAX ? "renumber" : v;
  }
  if (prev === null) {
    v = Math.floor(next / 2);
    return v > 0 && v < next ? v : "renumber";
  }
  v = Math.floor((prev + next) / 2);
  return v > prev && v < next ? v : "renumber";
}

export function renumber(ids: string[]): { id: string; sortOrder: number }[] {
  return ids.map((id, i) => ({ id, sortOrder: (i + 1) * SORT_GAP }));
}

export type Placement =
  | { ok: true; sortOrder: number; renumber: { id: string; sortOrder: number }[] }
  | { ok: false };

/** Where an item lands when dropped before `beforeId` (null = the end). `siblings` excludes the moving item. */
export function placeBefore(siblings: { id: string; sortOrder: number }[], beforeId: string | null): Placement {
  let idx = siblings.length;
  if (beforeId !== null) {
    idx = siblings.findIndex((s) => s.id === beforeId);
    if (idx < 0) return { ok: false };
  }
  const v = sortOrderBetween(idx > 0 ? siblings[idx - 1].sortOrder : null, idx < siblings.length ? siblings[idx].sortOrder : null);
  if (v !== "renumber") return { ok: true, sortOrder: v, renumber: [] };
  const ids = siblings.map((s) => s.id);
  ids.splice(idx, 0, "\u0000moving");
  const all = renumber(ids);
  const mine = all.find((a) => a.id === "\u0000moving")!;
  return { ok: true, sortOrder: mine.sortOrder, renumber: all.filter((a) => a.id !== "\u0000moving") };
}

export type FileFamily = "pdf" | "image" | "text" | "office" | "email" | "audio" | "video";
export interface FileTypeDef {
  ext: string;
  mimes: readonly string[];
  family: FileFamily;
  label: string;
}

export const FILE_TYPES: readonly FileTypeDef[] = [
  { ext: "pdf", mimes: ["application/pdf"], family: "pdf", label: "PDF" },
  { ext: "png", mimes: ["image/png"], family: "image", label: "PNG image" },
  { ext: "jpg", mimes: ["image/jpeg", "image/jpg"], family: "image", label: "JPEG image" },
  { ext: "gif", mimes: ["image/gif"], family: "image", label: "GIF image" },
  { ext: "webp", mimes: ["image/webp"], family: "image", label: "WEBP image" },
  { ext: "txt", mimes: ["text/plain"], family: "text", label: "Text" },
  { ext: "md", mimes: ["text/markdown", "text/x-markdown"], family: "text", label: "Markdown" },
  { ext: "csv", mimes: ["text/csv", "application/vnd.ms-excel"], family: "text", label: "CSV" },
  { ext: "doc", mimes: ["application/msword"], family: "office", label: "Word document" },
  { ext: "docx", mimes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"], family: "office", label: "Word document" },
  { ext: "xls", mimes: ["application/vnd.ms-excel"], family: "office", label: "Excel sheet" },
  { ext: "xlsx", mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"], family: "office", label: "Excel sheet" },
  { ext: "ppt", mimes: ["application/vnd.ms-powerpoint"], family: "office", label: "PowerPoint" },
  { ext: "pptx", mimes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"], family: "office", label: "PowerPoint" },
  { ext: "odt", mimes: ["application/vnd.oasis.opendocument.text"], family: "office", label: "OpenDocument text" },
  { ext: "ods", mimes: ["application/vnd.oasis.opendocument.spreadsheet"], family: "office", label: "OpenDocument sheet" },
  { ext: "odp", mimes: ["application/vnd.oasis.opendocument.presentation"], family: "office", label: "OpenDocument slides" },
  { ext: "eml", mimes: ["message/rfc822"], family: "email", label: "Email" },
  { ext: "msg", mimes: ["application/vnd.ms-outlook"], family: "email", label: "Outlook message" },
  { ext: "mp3", mimes: ["audio/mpeg", "audio/mp3"], family: "audio", label: "MP3 audio" },
  { ext: "m4a", mimes: ["audio/mp4", "audio/x-m4a"], family: "audio", label: "M4A audio" },
  { ext: "wav", mimes: ["audio/wav", "audio/x-wav", "audio/wave"], family: "audio", label: "WAV audio" },
  { ext: "mp4", mimes: ["video/mp4"], family: "video", label: "MP4 video" },
  { ext: "mov", mimes: ["video/quicktime"], family: "video", label: "MOV video" },
];

export const ACCEPTED_EXTENSIONS: string = FILE_TYPES.map((t) => `.${t.ext}`).join(", ");

export const REFUSED_EXTENSIONS: readonly string[] = SHARED_REFUSED_EXTENSIONS;

const EXT_ALIAS: Readonly<Record<string, string>> = { jpeg: "jpg", markdown: "md" };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_OR_BIDI = /[\u0000-\u001F\u007F‪-‮⁦-⁩]/g;

const lastSegment = (fileName: string): string => {
  const seg = fileName.split(/[\\/]/).pop() ?? "";
  return seg.replace(CONTROL_CHARS, "").replace(/[. ]+$/, "");
};

export function fileTypeFor(fileName: string, mime: string): FileTypeDef | null {
  const seg = lastSegment(String(fileName ?? ""));
  const dot = seg.lastIndexOf(".");
  const rawExt = dot > 0 || (dot === 0 && seg.length > 1) ? seg.slice(dot + 1).toLowerCase() : "";
  if (rawExt) {
    const ext = EXT_ALIAS[rawExt] ?? rawExt;
    if (REFUSED_EXTENSIONS.includes(ext)) return null;
    const hit = FILE_TYPES.find((t) => t.ext === ext);
    if (hit) return hit;
  }
  const m = String(mime ?? "").split(";")[0].trim().toLowerCase();
  if (!rawExt && m) {
    const hit = FILE_TYPES.find((t) => t.mimes.includes(m));
    if (hit && !REFUSED_EXTENSIONS.includes(hit.ext)) return hit;
  }
  return null;
}

export type StoredName =
  | { ok: true; storedName: string; ext: string; type: FileTypeDef }
  | { ok: false; messageKey: "doc.typeNotAllowed"; params: { accepted: string } };

export function normaliseStoredName(itemId: string, fileName: string, mime: string): StoredName {
  if (typeof itemId !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(itemId)) throw new TypeError("itemId must match [A-Za-z0-9-]{1,64}");
  const type = fileTypeFor(fileName, mime);
  if (!type) return { ok: false, messageKey: "doc.typeNotAllowed", params: { accepted: ACCEPTED_EXTENSIONS } };
  return { ok: true, storedName: `${itemId}.${type.ext}`, ext: type.ext, type };
}

const clean = (raw: string): string => raw.replace(CONTROL_OR_BIDI, " ").replace(/\s+/g, " ").trim();

export function cleanDisplayName(raw: unknown): Check<string> {
  if (typeof raw !== "string") return { ok: false, messageKey: "input.wrongType" };
  const v = clean(raw);
  if (!v) return { ok: false, messageKey: "doc.nameRequired" };
  if (v.length > FILE_NAME_MAX) return { ok: false, messageKey: "doc.nameTooLong", params: { max: FILE_NAME_MAX } };
  return { ok: true, value: v };
}

export function checkFolderName(raw: unknown): Check<string> {
  if (typeof raw !== "string") return { ok: false, messageKey: "input.wrongType" };
  const v = clean(raw);
  if (!v) return { ok: false, messageKey: "doc.nameRequired" };
  if (v.length > FOLDER_NAME_MAX) return { ok: false, messageKey: "doc.nameTooLong", params: { max: FOLDER_NAME_MAX } };
  return { ok: true, value: v };
}

export function checkNoteTitle(raw: unknown, opts?: { scratch?: boolean }): Check<string> {
  if (opts?.scratch) return { ok: true, value: SCRATCH_TITLE };
  if (typeof raw !== "string") return { ok: false, messageKey: "input.wrongType" };
  const v = clean(raw);
  if (!v) return { ok: true, value: UNTITLED_NOTE };
  if (v.length > NOTE_TITLE_MAX) return { ok: false, messageKey: "doc.nameTooLong", params: { max: NOTE_TITLE_MAX } };
  return { ok: true, value: v };
}

export function checkNoteBody(raw: unknown): Check<string> {
  if (typeof raw !== "string") return { ok: false, messageKey: "input.wrongType" };
  if (raw.length > NOTE_BODY_MAX) return { ok: false, messageKey: "note.tooLong", params: { max: NOTE_BODY_MAX } };
  return { ok: true, value: raw };
}

export function magicMatches(ext: string, head: Uint8Array): boolean {
  const type = FILE_TYPES.find((t) => t.ext === ext);
  return type ? sharedMagicMatches(type.mimes[0], head) : false;
}

export type LimitCheck =
  | { ok: true }
  | { ok: false; code: "invalid_input" | "too_large" | "limit_reached"; messageKey: string; params: Record<string, unknown> };

export function checkUpload(a: { sizeBytes: number; usedBytes: number; fileCount: number }): LimitCheck {
  if (!Number.isInteger(a.sizeBytes) || a.sizeBytes < 1) return { ok: false, code: "invalid_input", messageKey: "doc.emptyFile", params: {} };
  if (a.sizeBytes > FILE_MAX_BYTES) return { ok: false, code: "too_large", messageKey: "doc.fileTooLarge", params: { maxMb: FILE_MAX_BYTES / 1048576 } };
  if (a.fileCount >= MAX_FILES) return { ok: false, code: "limit_reached", messageKey: "doc.tooManyFiles", params: { max: MAX_FILES } };
  if (a.usedBytes + a.sizeBytes > PROJECT_FILES_MAX_BYTES) {
    return { ok: false, code: "limit_reached", messageKey: "doc.projectFull", params: { maxMb: PROJECT_FILES_MAX_BYTES / 1048576, usedMb: Math.round((a.usedBytes / 1048576) * 10) / 10 } };
  }
  return { ok: true };
}

export function checkCount(kind: "folder" | "note" | "file", current: number): LimitCheck {
  const max = kind === "folder" ? MAX_FOLDERS : kind === "note" ? MAX_NOTES : MAX_FILES;
  if (current < max) return { ok: true };
  const messageKey = kind === "folder" ? "doc.tooManyFolders" : kind === "note" ? "doc.tooManyNotes" : "doc.tooManyFiles";
  return { ok: false, code: "limit_reached", messageKey, params: { max } };
}

/** Case- and diacritic-insensitive text with a map from each folded index to the original index. */
export function foldSearchText(s: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    const f = ch.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
    for (let k = 0; k < f.length; k++) map.push(i);
    folded += f;
    i += ch.length;
  }
  return { folded, map };
}

export interface SearchEntry {
  kind: DocItemKind;
  id: string;
  path: string[];
  title: string;
  body?: string;
}
export interface SearchHit {
  kind: DocItemKind;
  id: string;
  path: string[];
  title: string;
  titleRanges: [number, number][];
  snippet: string;
  snippetRanges: [number, number][];
}

const SNIPPET_LEN = 120;

function rangesOf(text: string, terms: string[]): [number, number][] {
  const { folded, map } = foldSearchText(text);
  const raw: [number, number][] = [];
  for (const t of terms) {
    let at = folded.indexOf(t);
    while (at >= 0) {
      const endIdx = at + t.length - 1;
      const end = map[endIdx] + 1;
      // include the rest of a code point whose folded form was longer
      raw.push([map[at], Math.max(end, map[at] + 1)]);
      at = folded.indexOf(t, at + t.length);
    }
  }
  raw.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const out: [number, number][] = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  return out;
}

export function searchDocs(index: SearchEntry[], query: string, limit = 50): SearchHit[] {
  const terms = foldSearchText(String(query ?? "").trim()).folded.split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const titleHits: SearchHit[] = [];
  const bodyHits: SearchHit[] = [];
  for (const e of index) {
    const tf = foldSearchText(e.title).folded;
    const bf = foldSearchText(e.body ?? "").folded;
    if (!terms.every((t) => tf.includes(t) || bf.includes(t))) continue;
    const titleRanges = rangesOf(e.title, terms);
    let snippet = "";
    let snippetRanges: [number, number][] = [];
    const body = e.body ?? "";
    const bodyRanges = body ? rangesOf(body, terms) : [];
    if (bodyRanges.length) {
      const first = bodyRanges[0][0];
      const start = Math.max(0, first - Math.floor(SNIPPET_LEN / 3));
      const end = Math.min(body.length, start + SNIPPET_LEN);
      const pre = start > 0 ? "…" : "";
      const post = end < body.length ? "…" : "";
      snippet = pre + body.slice(start, end).replace(/\s/g, " ") + post;
      const shift = pre.length - start;
      snippetRanges = bodyRanges
        .filter(([a]) => a >= start && a < end)
        .map(([a, b]) => [a + shift, Math.min(b, end) + shift] as [number, number]);
    }
    (titleRanges.length ? titleHits : bodyHits).push({ kind: e.kind, id: e.id, path: e.path, title: e.title, titleRanges, snippet, snippetRanges });
  }
  return [...titleHits, ...bodyHits].slice(0, limit);
}

/** True only when both parse and the item was created after the hand-over. */
export function isNewSinceHandOver(createdDate: string, handedOverAt: string): boolean {
  if (!createdDate || !handedOverAt) return false;
  const c = Date.parse(createdDate);
  const h = Date.parse(handedOverAt);
  return Number.isFinite(c) && Number.isFinite(h) && c > h;
}

export const AUTOSAVE_DELAY_MS = 800;

export interface AutosaveState {
  edits: number;
  saved: number;
  inFlight: number | null;
  dueAt: number | null;
  failed: boolean;
}
export const AUTOSAVE_IDLE: AutosaveState = { edits: 0, saved: 0, inFlight: null, dueAt: null, failed: false };

export type AutosaveEvent =
  | { type: "edit"; now: number }
  | { type: "flush"; now: number }
  | { type: "tick"; now: number }
  | { type: "done"; version: number }
  | { type: "fail"; version: number };

export function hasUnsaved(s: AutosaveState): boolean {
  return s.edits > s.saved || s.inFlight !== null;
}

/** Pure autosave reducer. The UI owns the timers: it sleeps until `wakeAt`, then sends "tick". */
export function nextAutosave(s: AutosaveState, e: AutosaveEvent): { state: AutosaveState; saveVersion: number | null; wakeAt: number | null } {
  const out = (state: AutosaveState, saveVersion: number | null = null) => ({
    state,
    saveVersion,
    wakeAt: state.inFlight === null && state.edits > state.saved && !state.failed ? state.dueAt : null,
  });
  const start = (st: AutosaveState) => out({ ...st, inFlight: st.edits, dueAt: null }, st.edits);
  switch (e.type) {
    case "edit":
      return out({ ...s, edits: s.edits + 1, dueAt: e.now + AUTOSAVE_DELAY_MS, failed: false });
    case "tick":
      if (s.inFlight === null && s.edits > s.saved && !s.failed && s.dueAt !== null && e.now >= s.dueAt) return start(s);
      return out(s);
    case "flush":
      if (s.inFlight === null && s.edits > s.saved) return start({ ...s, failed: false });
      return out(s);
    case "done": {
      const done = { ...s, saved: Math.max(s.saved, e.version), inFlight: null, failed: false };
      // Edits made during the save are saved right after it.
      if (done.edits > done.saved) return start(done);
      return out({ ...done, dueAt: null });
    }
    case "fail":
      return out({ ...s, inFlight: null, failed: true, dueAt: null });
  }
}
