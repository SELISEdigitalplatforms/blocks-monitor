/**
 * Pure rules of the floating MADP assistant on Blocks records: message classification, factual answers
 * from real rows, the shape of an engine bug analysis and the "start the fix" state machine.
 * No React, DOM, timer or network.
 */
import { CHAT_ROLES, type ChatRole } from "./agentChat";
import { changeCode, isOpenChange } from "./delivery";

export const TEXT_MAX = 5000;
export const MAX_FILES = 3;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const EXCERPT_CHARS = 2000;
export const ATTACHMENTS_JSON_MAX = 8000;
export const POINTS_MAX = 8;
export const ANALYSIS_JSON_MAX = 50000;

export const ASSISTANT_ENVIRONMENTS = ["dev", "stage", "production"] as const;
export type AssistantEnv = (typeof ASSISTANT_ENVIRONMENTS)[number];

export const BUG_NOTE_TEXT = "I saved this bug report. Someone who can run builds can ask MADP to analyse it.";
export const FIX_DECLINED_TEXT = "Not started. The analysis stays here; start the fix whenever you are ready.";

// ------------------------------------------------------------------ attachments

export interface AttachmentNote {
  name: string;
  mime: string;
  size: number;
  excerpt: string;
}

export function isTextFile(name: string, mime: string): boolean {
  return mime.startsWith("text/") || mime === "application/json" || /\.(log|txt|json|csv)$/i.test(name);
}

/** The excerpt is kept for text files only. */
export function normaliseNotes(notes: readonly AttachmentNote[]): AttachmentNote[] {
  return notes.map((n) => ({
    name: n.name,
    mime: n.mime,
    size: n.size,
    excerpt: isTextFile(n.name, n.mime) ? n.excerpt : "",
  }));
}

// ------------------------------------------------------------------ classification

const normalise = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[‘’]/g, "'").toLowerCase();
const ASK_START = /^(what|which|when|is|are|how|does|did|has|have|who|why|where|can|could)\b/;
const BUG_WORDS =
  /(?<![a-z0-9])(?:bug|broken|error|errors|exception|wrong|fails|failed|failing|crash|crashes|crashed|cannot|can't|doesn't|does not|not working|missing|says|reports|complains|disappeared)(?![a-z0-9])/;

export function classifyMessage(text: string, attachments: readonly AttachmentNote[]): "question" | "bug" {
  const t = normalise(text).trim();
  const asks = t.endsWith("?") || ASK_START.test(t);
  if (asks && answerTopic(text) !== null) return "question";
  if (BUG_WORDS.test(t)) return "bug";
  if (attachments.length > 0 && !asks) return "bug";
  return "question";
}

export type AnswerTopic = "whatChanged" | "environments" | "scope" | "board" | "changeRequests";

/** null = an open question (an engine chat.reply job answers it). */
export function answerTopic(text: string): AnswerTopic | null {
  const t = normalise(text);
  if (/what changed|what's new|what is new|changelog|release notes|latest release|changed in/.test(t)) return "whatChanged";
  if (/\b(?:stage|staging|production|environments?|up to date|behind)\b/.test(t)) return "environments";
  if (/change requests?|\bcrs?\b|open changes|\bfixes\b/.test(t)) return "changeRequests";
  if (/\b(?:board|tickets?|kanban|backlog)\b/.test(t)) return "board";
  if (/\b(?:scope|features?|stories|story)\b/.test(t)) return "scope";
  return null;
}

// ------------------------------------------------------------------ factual answers

export interface AssistantRecords {
  projectName: string;
  releases: { environment: string; version: string; releasedAt: string; changeRequestIds: string[] }[];
  changeRequests: { id: string; number: number; lane: string; title: string; status: string; version: string }[];
  tickets: { column: string; ticketType: string; title: string }[];
  features: { id: string; ref: string; title: string }[];
  stories: { featureId: string; title: string }[];
}

const COLUMN_LABEL: Record<string, string> = {
  planned: "Planned", dev: "In development", review: "In review", test: "Testing", security: "Security", docs: "Docs",
  gate: "Release gate", done: "Done",
};
const day = (iso: string): string => iso.slice(0, 10);
const newest = <T extends { releasedAt: string }>(xs: T[]): T | undefined =>
  [...xs].sort((a, b) => (a.releasedAt < b.releasedAt ? 1 : a.releasedAt > b.releasedAt ? -1 : 0))[0];
const crLine = (c: AssistantRecords["changeRequests"][number]): string => `${changeCode(c)} ${c.title} · ${c.status}`;
const cap = (xs: string[]): string[] => xs.slice(0, POINTS_MAX);

export function answerQuestion(topic: AnswerTopic, r: AssistantRecords): { text: string; points: string[] } {
  switch (topic) {
    case "whatChanged": {
      const latest = newest(r.releases.filter((x) => x.environment === "dev")) ?? newest(r.releases);
      if (!latest) return { text: "Nothing is released yet.", points: [] };
      const where = ({ dev: "development", stage: "staging", production: "production" } as Record<string, string>)[latest.environment] ?? "an environment";
      const text = `The latest release is v${latest.version} on ${where}, released ${day(latest.releasedAt)}.`;
      const crs = r.changeRequests.filter((c) => latest.changeRequestIds.includes(c.id)).sort((a, b) => a.number - b.number);
      if (!crs.length) return { text: `${text} It carries the locked scope with no change requests.`, points: [] };
      return { text, points: cap(crs.map(crLine)) };
    }
    case "environments": {
      const by = (env: string) => newest(r.releases.filter((x) => x.environment === env));
      const dev = by("dev");
      const stage = by("stage");
      const prod = by("production");
      const say = (name: string, rel?: { version: string }) =>
        rel ? `${name} runs v${rel.version}` : `${name.toLowerCase()} is not released yet`;
      let text = `${say("Development", dev)}, ${say("Staging", stage)}, ${say("Production", prod)}.`;
      let points: string[] = [];
      if (dev && stage) {
        if (dev.version === stage.version) text += " Staging is up to date with development.";
        else {
          const onStage = new Set(r.releases.filter((x) => x.environment === "stage").flatMap((x) => x.changeRequestIds));
          const behind = r.changeRequests
            .filter((c) => r.releases.some((x) => x.environment === "dev" && x.changeRequestIds.includes(c.id)) && !onStage.has(c.id))
            .sort((a, b) => a.number - b.number);
          text += " Staging is behind development.";
          points = cap(behind.map(crLine));
        }
      } else if (dev) text += " Staging has not received a release yet.";
      return { text, points };
    }
    case "scope": {
      if (!r.features.length) return { text: `${r.projectName} has no locked scope yet.`, points: [] };
      const text = `The locked scope of ${r.projectName} has ${r.features.length} feature${r.features.length === 1 ? "" : "s"} and ${r.stories.length} stor${r.stories.length === 1 ? "y" : "ies"}.`;
      const points = r.features.map((f) => {
        const n = r.stories.filter((s) => s.featureId === f.id).length;
        return `${f.title} · ${n} stor${n === 1 ? "y" : "ies"}`;
      });
      return { text, points: cap(points) };
    }
    case "board": {
      if (!r.tickets.length) return { text: "The board has no tickets yet.", points: [] };
      const counts = new Map<string, number>();
      for (const t of r.tickets) counts.set(t.column, (counts.get(t.column) ?? 0) + 1);
      const done = counts.get("done") ?? 0;
      const text = `The board has ${r.tickets.length} ticket${r.tickets.length === 1 ? "" : "s"}; ${done} ${done === 1 ? "is" : "are"} done.`;
      const points = Object.keys(COLUMN_LABEL).filter((c) => counts.has(c)).map((c) => `${COLUMN_LABEL[c]} · ${counts.get(c)}`);
      return { text, points: cap(points) };
    }
    case "changeRequests": {
      const open = r.changeRequests
        .filter((c) => isOpenChange(c.status))
        .sort((a, b) => a.number - b.number);
      if (!open.length) {
        return {
          text: r.changeRequests.length ? "There are no open change requests." : "There are no change requests yet.",
          points: [],
        };
      }
      return { text: `There ${open.length === 1 ? "is 1 open change request" : `are ${open.length} open change requests`}.`, points: cap(open.map(crLine)) };
    }
  }
}

// ------------------------------------------------------------------ bug analysis (engine output)

export interface CodeRef {
  path: string;
  line: number | null;
  why: string;
}

export type Severity = "critical" | "high" | "medium" | "low";

export interface BugAnalysis {
  title: string;
  summary: string;
  severity: Severity;
  severityReason: string;
  rootCause: { text: string; refs: CodeRef[] };
  evidence: { steps: string[]; failing: string; stories: string[]; tests: string[] };
  plan: { steps: string[]; files: string[]; tests: string[] };
  impact: { features: string[]; screens: string[]; environments: string[] };
  estimate: { hours: number; agentRoles: ChatRole[] };
  featureRef: string;
}

const STR_MAX = 2000;
const TITLE_CAP = 200;
const ARR_MAX = 20;
const PATH_MAX = 300;
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const str = (x: unknown, max = STR_MAX): string | null => (typeof x === "string" && x.length <= max ? x : null);
function strs(x: unknown): string[] | null {
  if (!Array.isArray(x) || x.length > ARR_MAX) return null;
  const out: string[] = [];
  for (const v of x) {
    const s = str(v);
    if (s === null) return null;
    out.push(s);
  }
  return out;
}
function refsOf(x: unknown): CodeRef[] | null {
  if (!Array.isArray(x) || x.length > ARR_MAX) return null;
  const out: CodeRef[] = [];
  for (const v of x) {
    if (!isObj(v)) return null;
    const path = str(v.path, PATH_MAX);
    const why = str(v.why);
    const line = v.line;
    if (path === null || why === null || path === "") return null;
    if (line !== null && !(typeof line === "number" && Number.isInteger(line) && line > 0)) return null;
    out.push({ path, line: line as number | null, why });
  }
  return out;
}
function parse(json: string | null | undefined, max: number): unknown {
  if (typeof json !== "string" || json.length === 0 || json.length > max) return undefined;
  try {
    return JSON.parse(json);
  } catch {
    return undefined;
  }
}

export function parseAnalysis(json: string | null | undefined): BugAnalysis | null {
  const a = parse(json, ANALYSIS_JSON_MAX);
  if (!isObj(a)) return null;
  const title = str(a.title, TITLE_CAP);
  const summary = str(a.summary);
  const severityReason = str(a.severityReason);
  const featureRef = str(a.featureRef, 100);
  const sev = a.severity;
  if (title === null || title === "" || summary === null || severityReason === null || featureRef === null) return null;
  if (sev !== "critical" && sev !== "high" && sev !== "medium" && sev !== "low") return null;
  const { rootCause: rc, evidence: ev, plan: pl, impact: im, estimate: es } = a;
  if (!isObj(rc) || !isObj(ev) || !isObj(pl) || !isObj(im) || !isObj(es)) return null;
  const rcText = str(rc.text);
  const refs = refsOf(rc.refs);
  const failing = str(ev.failing);
  const steps = strs(ev.steps), stories = strs(ev.stories), evTests = strs(ev.tests);
  const planSteps = strs(pl.steps), files = strs(pl.files), planTests = strs(pl.tests);
  const features = strs(im.features), screens = strs(im.screens), environments = strs(im.environments);
  const hours = es.hours;
  const roles = es.agentRoles;
  if (rcText === null || refs === null || failing === null) return null;
  if (!steps || !stories || !evTests || !planSteps || !files || !planTests || !features || !screens || !environments) return null;
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0 || hours > 10000) return null;
  if (!Array.isArray(roles) || roles.length > CHAT_ROLES.length) return null;
  if (!roles.every((r) => (CHAT_ROLES as readonly unknown[]).includes(r))) return null;
  return {
    title, summary, severity: sev, severityReason,
    rootCause: { text: rcText, refs },
    evidence: { steps, failing, stories, tests: evTests },
    plan: { steps: planSteps, files, tests: planTests },
    impact: { features, screens, environments },
    estimate: { hours, agentRoles: roles as ChatRole[] },
    featureRef,
  };
}

const cut = (s: string, n: number): string => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");

/** Exactly the args L8's cr.saveDraft validates (checkChangeDraft). */
export function fixDraftFrom(a: BugAnalysis): { lane: "fix"; featureRef: string; title: string; description: string } {
  return {
    lane: "fix",
    featureRef: a.featureRef,
    title: cut(a.title, 120),
    description: cut(`${a.summary}\n\nRoot cause: ${a.rootCause.text}`, 10000),
  };
}

export function fixFollowUpText(cr: { lane: string; number: number; status: string; version: string }): string {
  const code = changeCode(cr);
  if (cr.status === "building") return `${code} is on its way: your development team builds it and releases v${cr.version} to development.`;
  if (cr.status === "analysing") return `${code} is with your business analyst for analysis. Once you approve it on the Release page, the development team builds it.`;
  if (cr.status === "questions") return `${code} has a few questions for you on the Release page before it can be approved.`;
  if (cr.status === "review") return `${code} is analysed and waiting for your approval on the Release page.`;
  if (cr.status === "approved") return `${code} is approved; start its build on the Release page.`;
  if (cr.status === "draft") return `${code} is saved as a draft, but it was not sent for analysis yet. Send it from the Release page.`;
  return `${code} is ${cr.status}.`;
}

// ------------------------------------------------------------------ fix state

export type FixState = "none" | "offered" | "started" | "declined";

export const FIX_TRANSITIONS: Readonly<Record<FixState, readonly FixState[]>> = {
  none: [],
  offered: ["started", "declined"],
  declined: ["started"],
  started: ["offered"],
};

/** started → offered (release) only while no change request exists; started with one is final. */
export function canFixTransition(from: FixState, to: FixState, hasChangeRequest: boolean): boolean {
  if (from === "started" && hasChangeRequest) return false;
  return FIX_TRANSITIONS[from].includes(to);
}

// ------------------------------------------------------------------ stored JSON

export function parseRefs(json: string | null | undefined): CodeRef[] {
  const v = parse(json, 10000);
  return refsOf(v) ?? [];
}

export function parseAttachmentNotes(json: string | null | undefined): AttachmentNote[] {
  const v = parse(json, ATTACHMENTS_JSON_MAX);
  if (!Array.isArray(v) || v.length > MAX_FILES) return [];
  const out: AttachmentNote[] = [];
  for (const n of v) {
    if (!isObj(n)) return [];
    const name = str(n.name, 255), mime = str(n.mime, 100), excerpt = str(n.excerpt, EXCERPT_CHARS);
    const size = n.size;
    if (name === null || mime === null || excerpt === null) return [];
    if (typeof size !== "number" || !Number.isInteger(size) || size < 0 || size > MAX_FILE_BYTES) return [];
    out.push({ name, mime, size, excerpt });
  }
  return out;
}
