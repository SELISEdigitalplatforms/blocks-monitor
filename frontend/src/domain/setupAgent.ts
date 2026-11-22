/** The business agent of the Project setup step: while a project is being set up, it reads what people share (files
 *  and notes), files the documents into folders by kind and writes down what it found as suggestions people review
 *  (must-haves, key workflows, what to leave out, constraints, and a goal / users when those are missing).
 *
 *  Pure rules shared by the engine (server/local/engine/kinds/setup*), the ops (project.setup.agent.wake,
 *  project.setup.suggestion.decide) and the Project setup page (src/components/setup/agent). No imports besides the
 *  setup details, so the functions bundle this file as it is.
 *
 *  Stored rows:
 *   EngineJob        Kind "setup.assist"; InputJson {projectId, fileIds (new), noteIds (new), seen (every source read)}
 *   SetupSuggestion  ProjectId, Kind, Text, Priority, ConstraintKind, SourceName, SourceRef ("DocFile:<id>" |
 *                    "DocNote:<id>"), Status (open | added | ignored), EngineJobId, Key, SortOrder, DecidedByUserId, DecidedAt */
import {
  CONSTRAINT_LABEL, PRIORITY_LABEL, SETUP_LIMITS, cleanConstraints, cleanLines, cleanMustHaves, isConstraintKind, isPriority, oneLine,
  type ConstraintKind, type Priority, type SetupDetails,
} from "./setupDetails";

export const SETUP_AGENT_KIND = "setup.assist" as const;
export const SETUP_SUGGESTION_SCHEMA = "SetupSuggestion";

// ------------------------------------------------------------------------------------------------- filing

/** The folders the agent files documents into (top level of the project's documents). */
export const FILING_FOLDERS = {
  client: { name: "Client documents", kind: "other" },
  meetings: { name: "Meetings & calls", kind: "meeting" },
  emails: { name: "E-mails", kind: "other" },
  designs: { name: "Designs & screenshots", kind: "ideation" },
  data: { name: "Spreadsheets & data", kind: "other" },
} as const;
export type FilingKey = keyof typeof FILING_FOLDERS;
export const FILING_ORDER: readonly FilingKey[] = ["client", "meetings", "emails", "designs", "data"];

const extOf = (name: string): string => (/\.([a-z0-9]{1,8})$/i.exec(name.trim())?.[1] ?? "").toLowerCase();
const MEETING_NAME = /\b(minutes|meeting|meetings|call|calls|call notes|workshop|kick-?off|interview|transcript|stand-?up|retro|agenda|jour fixe|session|walkthrough)\b/i;
const DESIGN_NAME = /\b(wireframes?|mock-?ups?|screens?|screenshots?|sketch(es)?|whiteboard|style ?sheet|design|figma|layout)\b/i;

/** The folder a document belongs in, from its name, its type and (when read) its first lines. */
export function filingOf(name: string, mime = "", text = ""): FilingKey {
  const ext = extOf(name);
  const m = mime.toLowerCase();
  const head = text.slice(0, 600);
  if (ext === "eml" || ext === "msg" || m === "message/rfc822" || (/^from:/im.test(head) && /^subject:/im.test(head))) return "emails";
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "heic", "bmp", "tif", "tiff", "fig", "sketch"].includes(ext) || m.startsWith("image/")) return "designs";
  if (["csv", "tsv", "xlsx", "xls", "ods", "numbers", "json", "xml"].includes(ext) || /spreadsheet|csv|excel/.test(m)) return "data";
  if (["mp3", "m4a", "wav", "ogg", "mp4", "mov", "webm"].includes(ext) || m.startsWith("audio/") || m.startsWith("video/")) return "meetings";
  const base = name.replace(/\.[a-z0-9]{1,8}$/i, "");
  if (MEETING_NAME.test(base) || /^(minutes|attendees|participants|agenda)\b/im.test(head)) return "meetings";
  if (DESIGN_NAME.test(base) && ["pdf", "pptx", "key", "ppt"].includes(ext)) return "designs";
  return "client";
}

// ------------------------------------------------------------------------------------------------- material

/** A short stable hash (FNV-1a, 32 bit, hex). */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export interface MaterialFile { id: string; status: string }
export interface MaterialNote { id: string; body: string; title?: string; isBrief?: boolean }

/** What the agent reads of a project: every ready file, and every note with words in it except the "Project brief"
 *  (the setup's own summary, kept up to date from the setup answers). A note is read again when its words change. */
export function materialOf(files: readonly MaterialFile[], notes: readonly MaterialNote[]): { files: string[]; notes: { id: string; sig: string }[] } {
  return {
    files: files.filter((f) => f.status === "ready" && f.id).map((f) => f.id).sort(),
    notes: notes
      .filter((n) => n.id && !n.isBrief && (n.title ?? "").trim() !== "Project brief" && n.body.trim().length >= 12)
      .map((n) => ({ id: n.id, sig: `note:${n.id}:${shortHash(n.body.trim())}` }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

export interface AgentRunPlan {
  fileIds: string[];
  noteIds: string[];
  /** Every source of the project as read by this run (the next run reads only what is not in here). */
  seen: string[];
}

/** What a new run would read: the files and notes no finished run has read yet; null when there is nothing new. */
export function planAgentRun(material: ReturnType<typeof materialOf>, readBefore: Iterable<string>): AgentRunPlan | null {
  const before = new Set(readBefore);
  const fileIds = material.files.filter((id) => !before.has(`file:${id}`));
  const noteIds = material.notes.filter((n) => !before.has(n.sig)).map((n) => n.id);
  if (fileIds.length === 0 && noteIds.length === 0) return null;
  return { fileIds, noteIds, seen: [...material.files.map((id) => `file:${id}`), ...material.notes.map((n) => n.sig)] };
}

/** The sources earlier finished runs read (the "seen" lists of the project's succeeded agent jobs). */
export function readSoFar(jobs: readonly Record<string, unknown>[]): Set<string> {
  const out = new Set<string>();
  for (const j of jobs) {
    if (j.Kind !== SETUP_AGENT_KIND || j.Status !== "succeeded") continue;
    try {
      const seen = (JSON.parse(String(j.InputJson ?? "{}")) as { seen?: unknown }).seen;
      if (Array.isArray(seen)) for (const s of seen) if (typeof s === "string") out.add(s);
    } catch {
      /* a broken input reads as nothing read */
    }
  }
  return out;
}

/** True while the project is in its setup step (before the hand-over). */
export const inSetup = (p: Record<string, unknown>): boolean =>
  p.IsDeleted !== true && p.Status !== "deleting" && !(typeof p.BusinessHandedOverAt === "string" && p.BusinessHandedOverAt !== "");

// ------------------------------------------------------------------------------------------------- suggestions

export const SUGGESTION_KINDS = ["mustHave", "workflow", "exclusion", "constraint", "goal", "users"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];
export const isSuggestionKind = (v: unknown): v is SuggestionKind => (SUGGESTION_KINDS as readonly unknown[]).includes(v);

export const SUGGESTION_STATUSES = ["open", "added", "ignored"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];
export const isSuggestionStatus = (v: unknown): v is SuggestionStatus => (SUGGESTION_STATUSES as readonly unknown[]).includes(v);

/** One and many: "must-have" / "must-haves". */
export const SUGGESTION_NOUN: Readonly<Record<SuggestionKind, [string, string]>> = {
  mustHave: ["must-have", "must-haves"],
  workflow: ["workflow", "workflows"],
  exclusion: ["thing to leave out", "things to leave out"],
  constraint: ["constraint", "constraints"],
  goal: ["goal", "goals"],
  users: ["user group", "user groups"],
};

/** The review window's section of each kind. */
export const SUGGESTION_SECTION: Readonly<Record<SuggestionKind, string>> = {
  mustHave: "What it must do",
  workflow: "Key workflows",
  exclusion: "What to leave out",
  constraint: "What we must respect",
  goal: "Goal",
  users: "Who will use it",
};

export const TEXT_MAX: Readonly<Record<SuggestionKind, number>> = {
  mustHave: SETUP_LIMITS.itemText,
  workflow: SETUP_LIMITS.workflowText,
  exclusion: SETUP_LIMITS.exclusionText,
  constraint: SETUP_LIMITS.constraintText,
  goal: 400,
  users: 300,
};

export interface SetupSuggestion {
  id: string;
  kind: SuggestionKind;
  text: string;
  priority: Priority;
  constraintKind: ConstraintKind;
  sourceName: string;
  sourceRef: string;
  status: SuggestionStatus;
  jobId: string;
  sortOrder: number;
}

/** A stored row as the screens read it (unknown kinds dropped). */
export function toSetupSuggestion(r: Record<string, unknown>): SetupSuggestion | null {
  const kind = r.Kind;
  if (!isSuggestionKind(kind) || typeof r.ItemId !== "string") return null;
  return {
    id: r.ItemId,
    kind,
    text: typeof r.Text === "string" ? r.Text : "",
    priority: isPriority(r.Priority) ? r.Priority : "must",
    constraintKind: isConstraintKind(r.ConstraintKind) ? r.ConstraintKind : "other",
    sourceName: typeof r.SourceName === "string" ? r.SourceName : "",
    sourceRef: typeof r.SourceRef === "string" ? r.SourceRef : "",
    status: isSuggestionStatus(r.Status) ? r.Status : "open",
    jobId: typeof r.EngineJobId === "string" ? r.EngineJobId : "",
    sortOrder: typeof r.SortOrder === "number" ? r.SortOrder : 0,
  };
}

const fold = (s: string): string => oneLine(s).toLowerCase().replace(/[“”"'’.,;:!?()]/g, "").replace(/\s+/g, " ").trim();

/** The key of a suggestion within its project: the same finding from another run (or another copy of the same
 *  document) is the same suggestion, so what a person ignored stays ignored. */
export function suggestionKey(kind: SuggestionKind, text: string): string {
  return `${kind}:${shortHash(fold(text))}`;
}

/** The meta line of an item: "Must · from PRD v2.pdf". */
export function suggestionMeta(s: Pick<SetupSuggestion, "kind" | "priority" | "constraintKind" | "sourceName">): string {
  const what = s.kind === "mustHave" ? PRIORITY_LABEL[s.priority] : s.kind === "constraint" && s.constraintKind !== "other" ? CONSTRAINT_LABEL[s.constraintKind] : "";
  const from = s.sourceName ? `from ${s.sourceName}` : "";
  return [what, from].filter(Boolean).join(" · ");
}

/** The project.setup.save arguments that add these suggestions (as edited) to what the project has; only the details
 *  that change are sent. Goal and users are not setup details (they are saved with the guided start's answers). */
export function addToDetails(
  d: SetupDetails,
  items: readonly Pick<SetupSuggestion, "kind" | "text" | "priority" | "constraintKind">[],
): Partial<Pick<SetupDetails, "mustHaves" | "workflows" | "exclusions" | "constraints">> {
  const out: Partial<Pick<SetupDetails, "mustHaves" | "workflows" | "exclusions" | "constraints">> = {};
  const of = (k: SuggestionKind) => items.filter((i) => i.kind === k && oneLine(i.text)).map((i) => ({ ...i, text: oneLine(i.text).replace(/[.;]+$/, "") }));
  const musts = of("mustHave");
  if (musts.length) out.mustHaves = cleanMustHaves([...d.mustHaves, ...musts.map((m) => ({ text: m.text, priority: m.priority }))]).slice(0, SETUP_LIMITS.mustHaves);
  const flows = of("workflow");
  if (flows.length) out.workflows = cleanLines([...d.workflows, ...flows.map((w) => w.text)]).slice(0, SETUP_LIMITS.workflows);
  const outs = of("exclusion");
  if (outs.length) out.exclusions = cleanLines([...d.exclusions, ...outs.map((x) => x.text)]).slice(0, SETUP_LIMITS.exclusions);
  const cons = of("constraint");
  if (cons.length) {
    // one constraint per kind: a found deadline joins the deadline already written down
    const merged = d.constraints.map((c) => ({ ...c }));
    for (const c of cons) {
      const same = c.constraintKind !== "other" ? merged.find((m) => m.kind === c.constraintKind) : undefined;
      if (same) {
        const t = oneLine(c.text);
        const joined = /^[A-Z][a-z]/.test(t) && /^(The|A|An|It|Our|We|This|Each|Every)\b/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
        if (!fold(same.text).includes(fold(c.text))) same.text = same.text.trim() ? `${same.text.trim().replace(/[.;]+$/, "")}; ${joined}` : t;
      } else merged.push({ kind: c.constraintKind, text: oneLine(c.text) });
    }
    out.constraints = cleanConstraints(merged.map((c) => ({ ...c, text: c.text.slice(0, SETUP_LIMITS.constraintText) }))).slice(0, SETUP_LIMITS.constraints);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------- the line

export interface AgentRunFacts {
  /** Documents the run sorted (moved or left in the right folder). */
  filed: number;
  /** Folders they are in. */
  folders: number;
}

/** "4 must-haves, 2 workflows and 1 constraint". */
export function foundText(open: readonly Pick<SetupSuggestion, "kind">[]): string {
  const parts: string[] = [];
  for (const k of SUGGESTION_KINDS) {
    const n = open.filter((s) => s.kind === k).length;
    if (!n) continue;
    if (k === "goal" || k === "users") {
      if (!parts.some((p) => p.startsWith("a goal") || p.startsWith("the users"))) parts.push(k === "goal" ? "a goal" : "the users");
      continue;
    }
    parts.push(`${n} ${SUGGESTION_NOUN[k][n === 1 ? 0 : 1]}`);
  }
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The finished line: "Filed 8 documents into 3 folders · found 4 must-haves and 2 workflows in PRD v2.pdf".
 *  `reviewed`: how many findings people have added or ignored already. */
export function doneLine(facts: AgentRunFacts | null, open: readonly Pick<SetupSuggestion, "kind" | "sourceName">[], reviewed = 0): string {
  const filed = facts && facts.filed > 0
    ? `Filed ${facts.filed} document${facts.filed === 1 ? "" : "s"} into ${facts.folders} folder${facts.folders === 1 ? "" : "s"}`
    : "";
  const found = foundText(open);
  const sources = [...new Set(open.map((s) => s.sourceName).filter(Boolean))];
  const where = sources.length === 1 ? ` in ${sources[0]}` : sources.length > 1 ? ` in ${sources.length} documents` : "";
  if (found) return filed ? `${filed} · found ${found}${where}` : `Found ${found}${where}`;
  if (reviewed > 0) return filed ? `${filed} · you've reviewed everything it found` : "You've reviewed everything your business analyst found";
  return filed ? `${filed} · nothing new to add to your setup` : "Read everything you shared · nothing new to add to your setup";
}

/** The working line: "Your business analyst is reading 3 new files…". */
export function workingLine(fileCount: number, noteCount: number): string {
  const what = [fileCount ? `${fileCount} new file${fileCount === 1 ? "" : "s"}` : "", noteCount ? `${noteCount === 1 ? "a note" : `${noteCount} notes`}` : ""]
    .filter(Boolean).join(" and ");
  return `Your business analyst is reading ${what || "what you shared"}…`;
}
