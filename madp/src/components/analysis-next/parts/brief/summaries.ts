/** The one-line summaries of the first five parts (What we understood, files, objective, master features, workflows)
 *  for their collapsed rows on the next Business Analysis page. Pure: the hooks (summaryHooks.ts) feed them the same
 *  records today's parts show, the tests feed them plain values. Plain words only (see ../../model.ts).
 *
 *  Zero mismatches (owner rule): a status never contradicts its own text. "Confirmed" only once the step is passed
 *  AND the part has content; a passed step without content is "Not used" (skipped) with the reason; "being read" /
 *  "being written" only while the engine job that does it is queued or running; "not written yet" only while the
 *  step is current. */
import { t } from "@/i18n";
import type { RequirementRow } from "@/blocks/requirements/records";
import type { Brief, BriefFile } from "@/components/understanding/briefApi";
import { stepIndex, type JourneyStep } from "@/domain/journey";
import { isActiveRequirementStatus } from "@/domain/requirements";
import { fileCounts } from "@/components/understanding/model";
import { briefAnswers, type AskedRow } from "@/domain/projectBrief";
import { notUsed, type PartStatus, type PartSummary } from "../../model";

/* ── small helpers ─────────────────────────────────────────────────────────── */

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** One of two texts by count: the singular for exactly one. */
const byCount = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The first sentence of a text, on one line ("A web app where customers book repair slots…"). */
export function firstSentence(text: string | null | undefined, max = 140): string {
  const txt = (text ?? "").replace(/\s+/g, " ").trim();
  if (!txt) return "";
  const m = /^(.+?[.!?])(?:\s|$)/.exec(txt);
  const s = (m ? m[1] : txt).replace(/[.]$/, "").trim();
  return clip(s, max);
}

/** A short stable fingerprint of any JSON-able content (FNV-1a, 32 bit, base 36). */
export function fingerprintOf(value: unknown): string {
  const s = JSON.stringify(value) ?? "";
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/** Labels counted and ordered: the most frequent first, then by first appearance; at most `max`. */
export function rankLabels(labels: readonly string[], max = 6): string[] {
  const count = new Map<string, number>();
  for (const l of labels) if (l.trim()) count.set(l.trim(), (count.get(l.trim()) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([l]) => l);
}

/** The source name the brief gives your own guided-start answers, as a chip. */
const OWN_SETUP = "Your project setup";
export const setupLabel = () => t("analysis.brief.projectSetup", "Project setup");
export const sourceChip = (name: string) => (name.trim() === OWN_SETUP ? setupLabel() : name.trim());

/** Understanding is signed off: confirmed here, or the project has moved past the questions (as today's parts read it). */
export function understandingSigned(brief: Pick<Brief, "confirmedAt"> | null, step: JourneyStep | null): boolean {
  return Boolean(brief?.confirmedAt) || (!!step && stepIndex(step) > stepIndex("sanitization"));
}

/** The requirements were approved: the project moved past them, or the approval is stored. */
export function requirementsApproved(step: JourneyStep | null, confirmedAt: string | null | undefined): boolean {
  return (!!step && stepIndex(step) > stepIndex("requirements")) || Boolean(confirmedAt);
}

const loadingSummary = (id: PartSummary["id"], summary: string): PartSummary => ({ id, status: "draft", summary, fingerprint: "loading", loading: true });

/* ── What we understood ────────────────────────────────────────────────────── */

/** The objective and the users "What we understood" shows: the facts every agent reads and the checklist marks
 *  (projectBrief briefAnswers: the project's own field, else the answer to the business analyst's own question), the
 *  objective last the drafted objective statement, as the design intent reads it (designProject). What the reading or
 *  the business agent only found is not an answer, so it never fills these lines. */
export function understoodAnswers(i: {
  name: string; goal: string; users: string; asked: readonly AskedRow[]; objectiveStatement: string;
}): { objective: string; users: string } {
  const a = briefAnswers({ name: i.name, goal: i.goal, users: i.users, asked: i.asked });
  const drafted = i.objectiveStatement.trim();
  return { objective: a.missing.includes("goal") && drafted ? drafted : a.goal, users: a.users };
}

export interface UnderstoodInput {
  open: boolean;
  loading: boolean;
  /** Confirmed on Understanding, or the project has moved past it. */
  signed: boolean;
  /** The person may confirm, settle and add answers here. */
  canAct: boolean;
  about: string;
  objective: string;
  users: string;
  /** Unsettled disagreements between the sources. */
  conflictsOpen: number;
  /** Items found in the material that still wait for "Confirm" or "Set aside". */
  toCheck: number;
  /** Files still being read (the understanding can't be confirmed meanwhile). In Blocks mode a file is "pending" /
   *  "processing" exactly while its file.extract job is queued / running (server/api/brief/builder.ts). */
  reading: number;
  /** Files read. */
  filesRead?: number;
  /** An existing product's intended changes (the setup's change tags and text). */
  changes?: readonly string[];
  /** An existing product attached as it is live (never went through the analysis). */
  live?: boolean;
  /** Plain source names (file names, "Your project setup"). */
  sources: readonly string[];
  /** The content, for the fingerprint. */
  content: unknown;
}

export function understoodSummary(i: UnderstoodInput): PartSummary {
  if (!i.open) {
    return { id: "understood", status: "not-started", summary: t("analysis.brief.understoodBefore", "What your project is, its objective and who it is for, in a few lines."), fingerprint: "not-started" };
  }
  if (i.loading) return loadingSummary("understood", t("analysis.brief.understoodLoading", "Opening what we understood…"));
  const missing: string[] = [];
  if (!i.objective.trim()) missing.push(t("analysis.brief.objectiveMissing", "The objective isn't answered yet"));
  if (!i.users.trim()) missing.push(t("analysis.brief.usersMissing", "Who will use it isn't answered yet"));
  const issues = i.signed ? [] : [
    ...missing,
    ...(i.conflictsOpen ? [byCount(i.conflictsOpen,
      t("analysis.brief.conflictsOne", "One point disagrees between your sources"),
      t("analysis.brief.conflictsMany", "{count} points disagree between your sources", { count: i.conflictsOpen }))] : []),
    ...(i.toCheck ? [byCount(i.toCheck,
      t("analysis.brief.toCheckOne", "1 found item to confirm or set aside"),
      t("analysis.brief.toCheckMany", "{count} found items to confirm or set aside", { count: i.toCheck }))] : []),
    ...(i.reading ? [stillReading(i.reading)] : []),
  ];
  const waits = missing.length > 0 || i.conflictsOpen > 0 || i.toCheck > 0;
  const read = i.filesRead ?? 0;
  const changes = (i.changes ?? []).filter((c) => c.trim());
  // what was understood, in the order the open part shows it (the found items are listed apart, as things to check)
  const said = firstSentence(i.about) || firstSentence(i.objective)
    || (changes.length ? t("analysis.brief.whatShouldChange", "What should change: {changes}", { changes: clip(changes.join(", "), 120) }) : "")
    || (i.users.trim() ? t("analysis.brief.whoWillUse", "Who will use it: {users}", { users: firstSentence(i.users, 120) }) : "");
  const fp = fingerprintOf(i.content);
  if (i.signed && !said) {
    // the step was passed but nothing was written: never "Confirmed" over an empty part
    return notUsed("understood", i.live === true && read === 0,
      read ? byCount(read,
        t("analysis.brief.readNoSummaryOne", "Read 1 file; no summary was written for this project."),
        t("analysis.brief.readNoSummaryMany", "Read {count} files; no summary was written for this project.", { count: read }))
        : t("analysis.brief.noSummary", "No summary was written for this project."), fp);
  }
  const status: PartStatus = i.signed ? "confirmed" : i.canAct && waits ? "needs-you" : "draft";
  const summary = said
    || (i.reading ? byCount(i.reading,
      t("analysis.brief.beingReadOne", "One file is being read."),
      t("analysis.brief.beingReadMany", "{count} files are being read.", { count: i.reading })) : "")
    || (read ? byCount(read,
      t("analysis.brief.readSummaryFromAnswersOne", "Read 1 file. The summary comes from your answers about the objective and who will use it."),
      t("analysis.brief.readSummaryFromAnswersMany", "Read {count} files. The summary comes from your answers about the objective and who will use it.", { count: read })) : "")
    || t("analysis.brief.understoodNotWritten", "Not written yet. It comes from your answers about the objective and who will use it.");
  return {
    id: "understood", status, summary,
    sources: rankLabels(i.sources.map(sourceChip)),
    issues: issues.length ? issues : undefined,
    fingerprint: fp,
  };
}

/* ── What we read from your files ──────────────────────────────────────────── */

export interface FilesInput {
  open: boolean;
  loading: boolean;
  error: boolean;
  signed: boolean;
  canAct: boolean;
  files: readonly Pick<BriefFile, "fileId" | "name" | "status" | "observationCount" | "requirementCount" | "summary">[];
  /** An existing product attached as it is live (never went through the analysis). */
  live?: boolean;
  /** The notes the person shared, counted as Project setup's Material chip counts them (setupChips sharedNoteCount);
   *  0 or left out when none (or while they load). */
  notes?: number;
}

/** "1 note shared, no files" / "No files shared": the material besides files, so a shared note never reads as nothing. */
export function noFilesText(notes: number): string {
  return notes > 0
    ? byCount(notes, t("analysis.brief.noFilesNoteOne", "1 note shared, no files"), t("analysis.brief.noFilesNoteMany", "{count} notes shared, no files", { count: notes }))
    : t("analysis.brief.noFilesShared", "No files shared");
}

/** "One file is still being read" / "3 files are still being read". */
function stillReading(n: number): string {
  return byCount(n, t("analysis.brief.stillReadingOne", "One file is still being read"), t("analysis.brief.stillReadingMany", "{count} files are still being read", { count: n }));
}

export function filesSummary(i: FilesInput): PartSummary {
  if (!i.open) {
    return { id: "files", status: "not-started", summary: t("analysis.brief.filesBefore", "Every file you share, with what was found in each."), fingerprint: "not-started" };
  }
  if (i.error) {
    return { id: "files", status: "draft", summary: t("analysis.brief.filesLoadError", "We couldn't load what we read from your files. Reload the page to try again."), fingerprint: "error" };
  }
  if (i.loading) return loadingSummary("files", t("analysis.brief.filesLoading", "Opening what we read from your files…"));
  const c = fileCounts(i.files);
  const notes = Math.max(0, i.notes ?? 0);
  if (i.signed && c.total === 0) {
    return notUsed("files", i.live === true, notes > 0
      ? byCount(notes,
        t("analysis.brief.filesNotUsedNoteOne", "1 note and no files were shared for this project."),
        t("analysis.brief.filesNotUsedNoteMany", "{count} notes and no files were shared for this project.", { count: notes }))
      : t("analysis.brief.filesNotUsed", "No files were shared for this project."));
  }
  const toRetry = c.failed + c.notRead;
  const bits = [
    c.read ? byCount(c.read, t("analysis.brief.filesReadOne", "1 file read"), t("analysis.brief.filesReadMany", "{count} files read", { count: c.read })) : "",
    c.reading ? t("analysis.brief.filesStillReading", "{count} still reading", { count: c.reading }) : "",
    c.failed ? t("analysis.brief.filesFailed", "{count} couldn't be read", { count: c.failed }) : "",
    c.notRead ? t("analysis.brief.filesNotReadYet", "{count} not read yet", { count: c.notRead }) : "",
    c.unsupported ? t("analysis.brief.filesUnsupported", "{count} can't be read", { count: c.unsupported }) : "",
    notes ? byCount(notes, t("analysis.brief.notesSharedOne", "1 note shared"), t("analysis.brief.notesSharedMany", "{count} notes shared", { count: notes })) : "",
  ].filter(Boolean);
  const summary = c.total === 0
    ? (notes === 0 ? t("analysis.brief.filesNoneFromSetup", "No files shared. What we know comes from your project setup.")
      : byCount(notes,
        t("analysis.brief.filesNoneFromNoteOne", "1 note shared, no files. What we know comes from your note and your project setup."),
        t("analysis.brief.filesNoneFromNoteMany", "{count} notes shared, no files. What we know comes from your notes and your project setup.", { count: notes })))
    : bits.join(" · ");
  const status: PartStatus = i.signed ? "confirmed" : i.canAct && toRetry > 0 ? "needs-you" : "draft";
  const issues = i.signed ? [] : [
    ...(c.reading ? [stillReading(c.reading)] : []),
    ...(toRetry && i.canAct ? [byCount(toRetry,
      t("analysis.brief.retryOne", "One file needs another try"),
      t("analysis.brief.retryMany", "{count} files need another try", { count: toRetry }))] : []),
  ];
  return {
    id: "files", status, summary,
    sources: i.files.map((f) => f.name.trim()).filter(Boolean).slice(0, 6),
    issues: issues.length ? issues : undefined,
    fingerprint: fingerprintOf([i.files.map((f) => [f.fileId, f.status, f.observationCount, f.requirementCount ?? 0, f.summary ?? ""]), notes]),
  };
}

/* ── Objective ─────────────────────────────────────────────────────────────── */

/** Who wrote the latest version of an item (ItemVersion.Origin), as a chip. */
export function versionOriginLabel(origin: string | null | undefined): string | null {
  switch (origin) {
    case "engine": return t("analysis.brief.originAnswers", "From your answers");
    case "person": return t("analysis.brief.originTeamEdit", "Edited by your team");
    case "feedback": return t("analysis.brief.originFeedback", "From feedback");
    case "second-opinion": return t("analysis.brief.originSecondLook", "From a second look");
    default: return null;
  }
}

export interface ObjectiveInput {
  open: boolean;
  loading: boolean;
  /** The requirements were approved. */
  approved: boolean;
  /** The requirements are open and the person may edit them. */
  canAct: boolean;
  text: string;
  criteria: readonly string[];
  /** Origin of the latest saved version (ItemVersion.Origin), when known. */
  origin: string | null;
  /** A requirements.draft job (not the landing page's) is queued or running: it writes the objective. */
  drafting?: boolean;
  /** An existing product attached as it is live (never went through the analysis). */
  live?: boolean;
}

export function objectiveSummary(i: ObjectiveInput): PartSummary {
  if (!i.open) {
    return { id: "objective", status: "not-started", summary: t("analysis.brief.objectiveBefore", "What this project should achieve, in a sentence or two, and how we'll know it worked."), fingerprint: "not-started" };
  }
  if (i.loading) return loadingSummary("objective", t("analysis.brief.objectiveLoading", "Opening the objective…"));
  const text = i.text.trim();
  const fp = fingerprintOf([text, i.criteria]);
  if (i.approved && !text) return notUsed("objective", i.live === true, t("analysis.brief.objectiveNotUsed", "No objective was written for this project."), fp);
  const checks = i.criteria.filter((c) => c.trim()).length;
  // while the analyst writes it, nothing waits on the person yet
  const issues = i.approved ? [] : !text ? (i.drafting ? [] : [t("analysis.brief.writeObjective", "Write the objective")]) : checks === 0 ? [t("analysis.brief.addObjectiveCheck", "Add how we'll know it worked")] : [];
  const status: PartStatus = i.approved ? "confirmed" : i.canAct && issues.length ? "needs-you" : "draft";
  const origin = versionOriginLabel(i.origin);
  return {
    id: "objective", status,
    summary: text ? firstSentence(text) : i.drafting ? t("analysis.brief.beingWritten", "Being written from your answers…") : t("analysis.brief.notWrittenYet", "Not written yet."),
    sources: origin ? [origin] : undefined,
    issues: issues.length ? issues : undefined,
    fingerprint: fp,
  };
}

/* ── Master features ───────────────────────────────────────────────────────── */

/** Where one source ref of a requirement (Requirement.SourceRefs) comes from, as a chip. Refs are `manual:<user>`,
 *  `suggestion:<id>`, `second-opinion:<…>`, `feedback:<…>`, a typed ref (`file:<id>`, `clarification:<id>`…) or the
 *  bare id of a file, an answered question or a note. */
export function requirementRefLabel(ref: string, known: { files: ReadonlyMap<string, string>; answers: ReadonlySet<string> }): string {
  const r = ref.trim();
  const colon = r.indexOf(":");
  const kind = colon > 0 ? r.slice(0, colon) : "";
  const id = colon > 0 ? r.slice(colon + 1) : r;
  switch (kind) {
    case "manual": return t("analysis.brief.refTeam", "Added by your team");
    case "suggestion": return t("analysis.brief.refSuggestion", "Accepted suggestion");
    case "second-opinion": return t("analysis.brief.originSecondLook", "From a second look");
    case "feedback": case "feedback-thread": case "feedback-comment": return t("analysis.brief.originFeedback", "From feedback");
    case "clarification": case "decision": return t("analysis.brief.refAnswers", "Your answers");
    case "file": case "doc-file": return known.files.get(id) ?? t("analysis.brief.refFiles", "Your files");
    case "note": case "doc-note": return t("analysis.brief.refNotes", "Project notes");
    case "live-product": return t("analysis.brief.refLiveCode", "The live product's code");
    default: break;
  }
  if (known.files.has(id)) return known.files.get(id)!;
  if (known.answers.has(id)) return t("analysis.brief.refAnswers", "Your answers");
  return t("analysis.brief.refMaterial", "Your project material");
}

export interface FeatureItem { id: string; title: string; priority: string; criteria: readonly string[]; status: string; sourceRefs: readonly string[] }

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The requirement rows with their source refs (the shared requirements cache holds rows; the record drops the refs). */
export function selectFeatureItems(rows: readonly RequirementRow[]): FeatureItem[] {
  return rows
    .filter((r) => isActiveRequirementStatus(str(r.Status)))
    .sort((a, b) => (a.SortOrder ?? 0) - (b.SortOrder ?? 0))
    .map((r) => ({
      id: r.ItemId, title: str(r.Title), priority: ["must", "nice", "later"].includes(str(r.Priority)) ? str(r.Priority) : "must",
      criteria: strList(r.AcceptanceCriteria), status: str(r.Status), sourceRefs: strList(r.SourceRefs),
    }));
}

export interface FeaturesInput {
  open: boolean;
  loading: boolean;
  approved: boolean;
  canAct: boolean;
  requirements: readonly FeatureItem[];
  /** Suggested additions still waiting for "Confirm" or "Set aside". */
  openSuggestions: number;
  known: { files: ReadonlyMap<string, string>; answers: ReadonlySet<string> };
  /** A requirements.draft job (not the landing page's) is queued or running: it writes the requirements. */
  drafting?: boolean;
  /** An existing product attached as it is live (never went through the analysis). */
  live?: boolean;
}

export function featuresSummary(i: FeaturesInput): PartSummary {
  if (!i.open) {
    return { id: "features", status: "not-started", summary: t("analysis.brief.featuresBefore", "What the product must do, each with its priority and how we'll know it works."), fingerprint: "not-started" };
  }
  if (i.loading) return loadingSummary("features", t("analysis.brief.featuresLoading", "Opening the master features…"));
  const n = i.requirements.length;
  const fp = fingerprintOf([i.requirements.map((r) => [r.id, r.title, r.priority, r.criteria, r.status]), i.openSuggestions]);
  if (i.approved && n === 0) return notUsed("features", i.live === true, t("analysis.brief.featuresNotUsed", "No master features were written for this project."), fp);
  const bare = i.requirements.filter((r) => r.criteria.filter((c) => c.trim()).length === 0).length;
  const musts = i.requirements.filter((r) => r.priority === "must").length;
  const summary = n === 0
    ? (i.drafting ? t("analysis.brief.beingWritten", "Being written from your answers…")
      : i.openSuggestions ? byCount(i.openSuggestions,
        t("analysis.brief.noneYetSuggestionOne", "None yet · 1 suggestion to confirm"),
        t("analysis.brief.noneYetSuggestionMany", "None yet · {count} suggestions to confirm", { count: i.openSuggestions }))
      : t("analysis.brief.noneWrittenYet", "None written yet."))
    : [
      byCount(n, t("analysis.brief.masterFeaturesOne", "1 master feature"), t("analysis.brief.masterFeaturesMany", "{count} master features", { count: n })),
      ...(!i.approved && i.openSuggestions ? [t("analysis.brief.stillToConfirm", "{count} still to confirm", { count: i.openSuggestions })] : []),
    ].join(" · ");
  const issues = i.approved ? [] : [
    ...(n === 0 && !i.drafting ? [t("analysis.brief.addRequirement", "Add at least one requirement")] : []),
    ...(bare ? [byCount(bare,
      t("analysis.brief.noCheckOne", "1 requirement has no check yet"),
      t("analysis.brief.noCheckMany", "{count} requirements have no check yet", { count: bare }))] : []),
    ...(n > 0 && musts === 0 ? [t("analysis.brief.markMust", "Mark at least one as must")] : []),
  ];
  const waits = i.openSuggestions > 0 || bare > 0 || (n > 0 && musts === 0);
  const status: PartStatus = i.approved ? "confirmed" : i.canAct && waits ? "needs-you" : "draft";
  return {
    id: "features", status, summary,
    sources: rankLabels(i.requirements.flatMap((r) => [...new Set(r.sourceRefs.map((ref) => requirementRefLabel(ref, i.known)))])),
    issues: issues.length ? issues : undefined,
    fingerprint: fp,
  };
}

/* ── Workflows, constraints & not included ─────────────────────────────────── */

/** RequirementExtra.Origin as a chip. */
export function extraOriginLabel(origin: string): string {
  if (origin === "live-product") return t("analysis.brief.originLiveProduct", "From the live product");
  return origin === "setup" ? setupLabel() : origin === "engine" ? t("analysis.brief.originAnalyst", "Your business analyst") : t("analysis.brief.refTeam", "Added by your team");
}

export interface WorkflowItem { id: string; kind: "workflow" | "constraint" | "exclusion"; title: string; who: string; steps: readonly string[]; origin: string }

export interface WorkflowsInput {
  open: boolean;
  loading: boolean;
  approved: boolean;
  items: readonly WorkflowItem[];
  /** A requirements.draft job (not the landing page's) is queued or running: it writes these lists too. */
  drafting?: boolean;
  /** An existing product attached as it is live (never went through the analysis). */
  live?: boolean;
}

export function workflowsSummary(i: WorkflowsInput): PartSummary {
  if (!i.open) {
    return { id: "workflows", status: "not-started", summary: t("analysis.brief.workflowsBefore", "The key workflows, the constraints to respect and what this version leaves out."), fingerprint: "not-started" };
  }
  if (i.loading) return loadingSummary("workflows", t("analysis.brief.workflowsLoading", "Opening the workflows…"));
  const count = (k: WorkflowItem["kind"]) => i.items.filter((x) => x.kind === k).length;
  const w = count("workflow");
  const c = count("constraint");
  const x = count("exclusion");
  const fp = fingerprintOf(i.items.map((e) => [e.id, e.kind, e.title, e.who, e.steps]));
  if (i.approved && w + c + x === 0) return notUsed("workflows", i.live === true, t("analysis.brief.workflowsNotUsed", "No workflows, constraints or exclusions in this project."), fp);
  const summary = w + c + x === 0
    ? (i.drafting ? t("analysis.brief.beingWritten", "Being written from your answers…") : t("analysis.brief.workflowsNoneYet", "No workflows, constraints or exclusions yet."))
    : [
      byCount(w, t("analysis.brief.workflowsOne", "1 workflow"), t("analysis.brief.workflowsMany", "{count} workflows", { count: w })),
      byCount(c, t("analysis.brief.constraintsOne", "1 constraint"), t("analysis.brief.constraintsMany", "{count} constraints", { count: c })),
      t("analysis.brief.notIncludedCount", "{count} not included", { count: x }),
    ].join(" · ");
  return {
    id: "workflows", status: i.approved ? "confirmed" : "draft", summary,
    sources: rankLabels(i.items.map((e) => extraOriginLabel(e.origin))),
    fingerprint: fp,
  };
}
