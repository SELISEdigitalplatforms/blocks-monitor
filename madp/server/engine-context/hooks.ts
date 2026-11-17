// The engine's hook into the project context (store.ts). driver.ts runs every writer through withContext():
//
//   before the writer  the context is refreshed from the rows the worker just loaded from the Data Gateway (plus the
//                      brief and project.json); jobs/<jobId>-<attempt>/context.json records the version and the input
//                      refs; the ledger gets job.started
//   during             the prompts' material (ai/material.ts) reads this snapshot and notes which records it showed
//   after the writer   the context is refreshed again (the job's outputs are in it now); the ledger gets one output event
//                      per OutputRef with its links (output -> job -> context version -> sources) and job.finished
//
// A context error never fails a job: it is logged, and the writer runs as before. Without project folders (local mode,
// unit tests) nothing is written; the material still comes from an in-memory snapshot made by the same code.
//
// Static imports are only node builtins and store.ts (pure): the rest is loaded when a job runs, so a file being edited
// elsewhere (the brief code, a domain file) can never stop driver.ts from loading.
import fs from "node:fs";
import path from "node:path";
import type { Row } from "../../functions/_lib/gateway";
import type { JobRun, KindResult } from "../local/engine/run.ts";
import type { ProjectView } from "../local/engine/context.ts";
import { appendLedger, checkId, commitContext, memoryContext, redactDeep, writeJsonAtomic, type ContextFile } from "./store.ts";

interface RunState {
  ctx: ContextFile;
  /** The knowledge-base folder holding context.json and ledger.jsonl (null: in memory only). */
  dir: string | null;
  inputRefs: string[];
  /** Records the prompts showed (material.ts). */
  seen: Set<string>;
  changed: string[];
}

const states = new WeakMap<JobRun, RunState>();
const SEEN_MAX = 120;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e)).slice(0, 300);

// ------------------------------------------------------------------------------------------------- folders

/** The project's knowledge-base folder (knowledgeBase.ts kbDir), or null when the engine has no project folders. */
async function contextDirOf(run: JobRun): Promise<string | null> {
  if (!run.deps.projectFolder) return null;
  const workspaceId = checkId("workspace id", run.folderWorkspaceId());
  const projectId = checkId("project id", run.projectId);
  try {
    const kb = await import("../api/knowledgeBase.ts");
    return kb.kbDir({ workspaceId, projectId });
  } catch (e) {
    // the same place (DEMO-SCOPE-31.10.md layout) when the brief code cannot be loaded right now
    run.log(`context: knowledge-base path from the project folder (${errText(e)})`);
    const dir = path.join(run.folder().dir, "artifacts", "brief");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
}

async function snapshot(run: JobRun, dir: string | null): Promise<{ sections: import("./snapshot.ts").Sections; digestOf(c: ContextFile): string }> {
  const [{ buildSections }, { wholeDigest }] = await Promise.all([import("./snapshot.ts"), import("./digest.ts")]);
  let projectDir: string | null = null;
  try {
    projectDir = run.deps.projectFolder ? run.folder().dir : null;
  } catch {
    projectDir = null;
  }
  return { sections: buildSections({ p: run.p, kbDir: dir, projectDir }), digestOf: wholeDigest };
}

async function refresh(run: JobRun, phase: "before" | "after" | "material"): Promise<{ ctx: ContextFile; dir: string | null; changed: string[] }> {
  const dir = await contextDirOf(run);
  // the brief on this host from the Blocks rows (people's decisions, answers, files) and this host's readings
  if (dir && phase === "before") {
    try {
      const { syncBrief } = await import("./briefSync.ts");
      await syncBrief({ workspaceId: run.folderWorkspaceId(), projectId: run.projectId, userId: run.requester, project: run.p.project, rows: (s) => run.p.rows(s) });
    } catch (e) {
      run.log(`context: brief not brought up to date (${errText(e)})`);
    }
  }
  const snap = await snapshot(run, dir);
  const ids = { workspaceId: run.workspaceId || run.p.workspaceId, projectId: run.projectId };
  if (!dir) return { ctx: memoryContext({ ...ids, sections: snap.sections, digestOf: snap.digestOf, now: run.now() }), dir: null, changed: [] };
  const r = commitContext(dir, { ...ids, sections: snap.sections, digestOf: snap.digestOf, now: run.now(), cause: { phase, jobId: run.id, attempt: run.attempt, kind: run.kind } });
  if (phase !== "after") await recordPeople(dir, run.p, r.context, run.log.bind(run), run.now());
  return { ctx: r.context, dir, changed: r.changed };
}

/** The people's actions (answers, approvals, the lock, accepts, chat questions, uploads) as "user" events the ledger
 *  does not hold yet (userEvents.ts). Never throws. */
async function recordPeople(dir: string, p: ProjectView, ctx: ContextFile, log: (line: string) => void, now: Date): Promise<number> {
  let n = 0;
  try {
    const { recordUserActions, userActionsOf } = await import("./userEvents.ts");
    n += recordUserActions(dir, userActionsOf(p, ctx.sections), { contextVersion: ctx.version, nameOf: (id) => p.personName(id), now });
  } catch (e) {
    log(`context: recording the people's actions failed (${errText(e)})`);
  }
  return n + (await recordChanges(dir, p, ctx, log, now));
}

/** The change requests' events (changeEvents.ts) the ledger does not hold yet; `o` names the change job finishing now.
 *  Never throws. */
async function recordChanges(dir: string, p: ProjectView, ctx: ContextFile, log: (line: string) => void, now: Date, o: Parameters<typeof import("./changeEvents.ts").changeActionsOf>[1] = {}): Promise<number> {
  try {
    const [{ recordUserActions }, { changeActionsOf }] = await Promise.all([import("./userEvents.ts"), import("./changeEvents.ts")]);
    return recordUserActions(dir, changeActionsOf(p, o), { contextVersion: ctx.version, nameOf: (id) => p.personName(id), now });
  } catch (e) {
    log(`context: recording the change requests' events failed (${errText(e)})`);
    return 0;
  }
}

/** The ready files people shared, copied into the project folder's inputs/ once each (inputs.ts). Never throws. */
async function copyFiles(o: { p: ProjectView; inputsDir: string; readFile(id: string): Promise<Uint8Array | null>; log(line: string): void }): Promise<number> {
  try {
    const { copyInputs } = await import("./inputs.ts");
    const files = o.p.files().map((f) => ({ ref: `DocFile:${str(f.ItemId)}`, name: str(f.Name), mime: str(f.Mime), storageObjectId: str(f.StorageObjectId), sizeBytes: typeof f.SizeBytes === "number" ? f.SizeBytes : 0 }));
    const added = await copyInputs({ inputsDir: o.inputsDir, files, readFile: o.readFile, log: o.log });
    if (added.length) o.log(`context: ${added.filter((a) => !a.skipped).length} file(s) copied to inputs/${added.some((a) => a.skipped) ? `, ${added.filter((a) => a.skipped).length} left out (credentials)` : ""}`);
    return added.length;
  } catch (e) {
    o.log(`context: copying the shared files failed (${errText(e)})`);
    return 0;
  }
}

/** The context refresh without a job (the Blocks worker's periodic refresh of the active projects): the snapshot from
 *  the rows loaded, a new version when something changed, the people's actions not in the ledger yet, the shared files
 *  not in inputs/ yet. Only for a project whose context exists already (a job made it): never makes a folder. */
export async function refreshProjectContext(o: {
  p: ProjectView;
  workspaceId: string;
  projectId: string;
  /** The engine root (MF_ENGINE_ROOT). */
  root: string;
  readFile?(id: string): Promise<Uint8Array | null>;
  log(line: string): void;
  now?: Date;
}): Promise<{ version: number; changed: string[]; userEvents: number; files: number } | null> {
  const workspaceId = checkId("workspace id", o.workspaceId);
  const projectId = checkId("project id", o.projectId);
  const projectDir = path.join(path.resolve(o.root), "projects", workspaceId, projectId);
  const dir = path.join(projectDir, "artifacts", "brief");
  if (!fs.existsSync(path.join(dir, "context.json"))) return null;
  const now = o.now ?? new Date();
  // the brief follows what people answered meanwhile (the business analyst's brief questions, the drafted objective) as
  // it does before a job: the same sync, rebuilt only when one of its inputs changed; only where the knowledge base is
  // this project's folder
  let briefRebuilt = false;
  try {
    const [{ syncBrief }, { knowledgeBaseDir }] = await Promise.all([import("./briefSync.ts"), import("../api/knowledgeBase.ts")]);
    if (path.resolve(knowledgeBaseDir(workspaceId, projectId)) === path.resolve(dir)) {
      briefRebuilt = await syncBrief({ workspaceId, projectId, userId: "", project: o.p.project, rows: (s) => o.p.rows(s) });
    }
  } catch (e) {
    o.log(`context: brief not brought up to date (${errText(e)})`);
  }
  const [{ buildSections }, { wholeDigest }] = await Promise.all([import("./snapshot.ts"), import("./digest.ts")]);
  const sections = buildSections({ p: o.p, kbDir: dir, projectDir });
  const r = commitContext(dir, { workspaceId, projectId, sections, digestOf: wholeDigest, now, cause: { phase: "periodic" } });
  const userEvents = await recordPeople(dir, o.p, r.context, o.log, now);
  const files = o.readFile ? await copyFiles({ p: o.p, inputsDir: path.join(projectDir, "inputs"), readFile: o.readFile, log: o.log }) : 0;
  // what people did meanwhile (an answer, a release) shows in the project's outputs too
  if (r.changed.length > 0 || userEvents > 0 || briefRebuilt) {
    try {
      const { refreshOutputs } = await import("./outputs.ts");
      await refreshOutputs(projectDir, o.log);
    } catch (e) {
      o.log(`outputs: the index was not written (${errText(e)})`);
    }
  }
  return { version: r.context.version, changed: r.changed, userEvents, files };
}

// ------------------------------------------------------------------------------------------------- refs

/** Lower-case prefixes the rows use for each other ("feature:<key>", "doc-note:<id>"). */
const PREFIX: Record<string, string> = {
  "doc-note": "DocNote", note: "DocNote", "doc-file": "DocFile", file: "DocFile", clarification: "Clarification", decision: "Decision",
  requirement: "Requirement", feature: "Feature", story: "Story", milestone: "Milestone", ticket: "Ticket", AgentChat: "AgentChatMessage",
  "feedback-thread": "FeedbackThread", "feedback-comment": "FeedbackComment",
};
/** Schemas a bare id is looked up in (a requirement's SourceRefs are bare ids of notes, files, decisions…). */
const CANDIDATES = [
  "DocNote", "DocFile", "Clarification", "Decision", "TechDecision", "Requirement", "RequirementExtra", "SetupSuggestion", "Suggestion", "Objective",
  "ScopeVersion", "Feature", "Story", "Milestone", "Ticket", "ChangeRequest", "Preview", "Release", "DesignBrief", "DesignScreen", "WikiPage",
  "AgentChatMessage", "AssistantMessage", "FeedbackThread", "FeedbackComment",
];
const KEYED = new Set(["Feature", "Story", "Requirement"]);
/** The schema of a feedback thread's item (FeedbackThread.TargetType). */
const FEEDBACK_TARGET_SCHEMA: Record<string, string> = {
  requirement: "Requirement", extra: "RequirementExtra", feature: "Feature", story: "Story", screen: "DesignScreen", milestone: "Milestone",
};

/** "Schema:ItemId" for a reference as the rows hold it, or null when it names nothing of the project. */
export function resolveRef(run: JobRun, raw: string, scopeVersion?: number): string | null {
  const v = raw.trim();
  if (!v) return null;
  const at = v.indexOf(":");
  if (at > 0) {
    const head = v.slice(0, at);
    const tail = v.slice(at + 1);
    const schema = PREFIX[head] ?? (CANDIDATES.includes(head) ? head : null);
    if (!schema || !tail) return null;
    if (run.p.row(schema, tail)) return `${schema}:${tail}`;
    if (KEYED.has(schema)) {
      const rows = run.p.rows(schema).filter((r) => r.Key === tail);
      const hit = rows.find((r) => scopeVersion === undefined || Number(r.ScopeVersion ?? 1) === scopeVersion) ?? rows[rows.length - 1];
      if (hit) return `${schema}:${str(hit.ItemId)}`;
    }
    return CANDIDATES.includes(head) ? `${schema}:${tail}` : null;
  }
  for (const schema of CANDIDATES) if (run.p.row(schema, v)) return `${schema}:${v}`;
  return null;
}

const listOf = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string" && v.trim().startsWith("[")) {
    try {
      const a = JSON.parse(v) as unknown;
      return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
    } catch {
      return [];
    }
  }
  return typeof v === "string" && v.trim() ? [v] : [];
};

/** Job input fields that name records. */
const INPUT_SCHEMA: Record<string, string> = {
  docNoteIds: "DocNote", noteIds: "DocNote", docFileIds: "DocFile", fileIds: "DocFile", messageId: "AgentChatMessage", assistantMessageId: "AssistantMessage",
  milestoneId: "Milestone", changeRequestId: "ChangeRequest", designBriefId: "DesignBrief", releaseId: "Release", requirementIds: "Requirement",
  scopeVersionId: "ScopeVersion", ticketId: "Ticket", ticketIds: "Ticket", clarificationId: "Clarification", threadId: "FeedbackThread",
  commentId: "FeedbackComment", commentIds: "FeedbackComment",
};

/** The records a job was asked about: its target, the ids in its input, its scope version. */
export function inputRefsOf(run: JobRun): string[] {
  const out = new Set<string>();
  const add = (r: string | null) => { if (r) out.add(r); };
  const job = run.job;
  if (str(job.TargetType) && str(job.TargetId)) add(resolveRef(run, `${str(job.TargetType)}:${str(job.TargetId)}`) ?? resolveRef(run, str(job.TargetId)));
  const visit = (o: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(o)) {
      const schema = INPUT_SCHEMA[k];
      if (schema) for (const id of listOf(v)) add(run.p.row(schema, id) ? `${schema}:${id}` : resolveRef(run, id));
      else if (k === "refId" && typeof v === "string") add(resolveRef(run, v));
    }
  };
  visit(run.input);
  if (run.input.refs && typeof run.input.refs === "object" && !Array.isArray(run.input.refs)) visit(run.input.refs as Record<string, unknown>);
  const sv = Number(run.input.scopeVersion);
  if (Number.isInteger(sv) && sv > 0) {
    const row = run.p.scopeVersionRow(sv);
    if (row) add(`ScopeVersion:${str(row.ItemId)}`);
  }
  return [...out];
}

const OUTPUT_ALIAS: Record<string, string> = { AgentChat: "AgentChatMessage" };

/** An OutputRef as "Schema:ItemId" (aliases mapped), and its row when the project has it. */
function outputRow(run: JobRun, ref: string): { ref: string; schema: string; row: Row | undefined } {
  const at = ref.indexOf(":");
  const schema = at > 0 ? (OUTPUT_ALIAS[ref.slice(0, at)] ?? ref.slice(0, at)) : "";
  const id = at > 0 ? ref.slice(at + 1) : ref;
  const row = schema ? (run.p.row(schema, id) ?? (schema === "Project" ? run.p.project : undefined)) : undefined;
  return { ref: schema ? `${schema}:${id}` : ref, schema, row };
}

/** The records a row itself says it comes from (its source fields). */
export function rowSources(run: JobRun, schema: string, row: Row | undefined): string[] {
  if (!row) return [];
  const sv = Number(row.ScopeVersion ?? NaN);
  const scope = Number.isFinite(sv) ? sv : undefined;
  const raw: string[] = [];
  const idOf = (field: string, as: string) => { if (str(row[field])) raw.push(`${as}:${str(row[field])}`); };
  switch (schema) {
    case "Requirement":
      raw.push(...listOf(row.SourceRefs));
      break;
    case "Clarification":
    case "SetupSuggestion":
      if (str(row.SourceRef)) raw.push(str(row.SourceType) && str(row.SourceType) !== "engine" ? `${str(row.SourceType)}:${str(row.SourceRef)}` : str(row.SourceRef));
      break;
    case "Decision":
      idOf("ClarificationId", "Clarification");
      if (str(row.SourceRef)) raw.push(str(row.SourceRef));
      break;
    case "Feature":
      raw.push(...listOf(row.RequirementRefs));
      break;
    case "Story":
      if (str(row.FeatureRef)) raw.push(str(row.FeatureRef));
      break;
    case "Milestone":
      raw.push(...listOf(row.FeatureRefs));
      break;
    case "Ticket":
      idOf("MilestoneId", "Milestone");
      idOf("ChangeRequestId", "ChangeRequest");
      for (const f of ["FeatureRef", "StoryRef"]) if (str(row[f])) raw.push(str(row[f]));
      break;
    case "FeedbackComment":
      idOf("ThreadId", "FeedbackThread");
      break;
    case "FeedbackThread": {
      // the item the thread is about (a success target is a value of the scope version, not a record)
      const item = FEEDBACK_TARGET_SCHEMA[str(row.TargetType)];
      if (item && str(row.TargetId)) raw.push(`${item}:${str(row.TargetId)}`);
      break;
    }
    case "Preview":
    case "Release":
      idOf("MilestoneId", "Milestone");
      for (const id of listOf(row.ChangeRequestIds)) raw.push(`ChangeRequest:${id}`);
      break;
    default:
      break;
  }
  const out = new Set<string>();
  for (const r of raw) {
    const hit = resolveRef(run, r, scope);
    if (hit) out.add(hit);
  }
  return [...out];
}

// ------------------------------------------------------------------------------------------------- builds

interface BuildTrace {
  buildId: string;
  commit: string;
  branch: string;
  version: string;
  ticketIds: string[];
}

const BUILD_ID = /^[A-Za-z0-9_.-]{1,80}$/;
const TEXT_ID = /^[A-Za-z0-9_./-]{0,120}$/;

/** The build a job made (kinds/delivery.ts realResult `build`, else jobs/<id>-<n>/build.json), or null. */
function buildOf(run: JobRun, result: KindResult): BuildTrace | null {
  let b: unknown = (result as KindResult & { build?: unknown }).build;
  if (!b || typeof b !== "object") {
    const dir = run.jobDir();
    try {
      b = dir && fs.existsSync(path.join(dir, "build.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "build.json"), "utf8")) : null;
    } catch {
      b = null;
    }
  }
  if (!b || typeof b !== "object") return null;
  const o = b as Record<string, unknown>;
  const buildId = str(o.buildId);
  if (!BUILD_ID.test(buildId)) return null;
  const safe = (v: unknown) => (TEXT_ID.test(str(v)) ? str(v) : "");
  return { buildId, commit: safe(o.commit), branch: safe(o.branch), version: safe(o.version), ticketIds: listOf(o.ticketIds).filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id)) };
}

// ------------------------------------------------------------------------------------------------- hooks

function jobRecord(run: JobRun, value: Record<string, unknown>): void {
  const dir = run.jobDir();
  if (dir) writeJsonAtomic(path.join(dir, "context.json"), redactDeep(value));
}

async function before(run: JobRun): Promise<void> {
  if (!run.deps.projectFolder) return; // in memory, on demand (contextOf)
  const r = await refresh(run, "before");
  const inputRefs = inputRefsOf(run);
  states.set(run, { ctx: r.ctx, dir: r.dir, inputRefs, seen: new Set(), changed: r.changed });
  if (!r.dir) return;
  appendLedger(r.dir, { type: "job.started", jobId: run.id, attempt: run.attempt, kind: run.kind, contextVersion: r.ctx.version, inputRefs });
  // the files people shared, into the project folder's inputs/ (in the background: the job never waits for a download)
  const readFile = run.deps.readFile;
  if (readFile) {
    let inputsDir: string | null = null;
    try {
      inputsDir = run.folder().inputs;
    } catch {
      inputsDir = null;
    }
    if (inputsDir) void copyFiles({ p: run.p, inputsDir, readFile: (id) => readFile(id), log: run.log.bind(run) });
  }
  jobRecord(run, {
    jobId: run.id, attempt: run.attempt, kind: run.kind,
    contextVersion: r.ctx.version, contextHash: r.ctx.hash, contextFile: path.join(r.dir, "context.json"), refreshedAt: r.ctx.updatedAt, changedSections: r.changed,
    inputRefs,
  });
}

async function after(run: JobRun, outcome: { result?: KindResult; error?: unknown }): Promise<void> {
  const st = states.get(run);
  if (!st?.dir) return;
  const status = outcome.result ? "succeeded" : outcome.error && (outcome.error as Error).name === "JobGone" ? "stopped" : "failed";
  const r = status === "succeeded" ? await refresh(run, "after") : { ctx: st.ctx, dir: st.dir, changed: [] as string[] };
  const seen = [...st.seen].slice(0, SEEN_MAX);
  const outputs: { ref: string; sources: string[] }[] = [];
  for (const raw of outcome.result ? [...new Set(outcome.result.outputs)] : []) {
    const o = outputRow(run, raw);
    const sources = [...new Set([...rowSources(run, o.schema, o.row), ...st.inputRefs])].filter((s) => s !== o.ref);
    outputs.push({ ref: o.ref, sources });
    appendLedger(st.dir, { type: "output", ref: o.ref, jobId: run.id, attempt: run.attempt, kind: run.kind, contextVersion: st.ctx.version, resultVersion: r.ctx.version, sources, seen });
  }
  // a real build: build -> commit -> tickets (the result's `build`, else the job folder's build.json)
  const build = outcome.result ? buildOf(run, outcome.result) : null;
  if (build) {
    const ref = `Build:${build.buildId}`;
    const tickets = build.ticketIds.map((id) => `Ticket:${id}`);
    const sources = [...new Set([...tickets, ...st.inputRefs])];
    outputs.push({ ref, sources });
    appendLedger(st.dir, {
      type: "output", ref, jobId: run.id, attempt: run.attempt, kind: run.kind, contextVersion: st.ctx.version, resultVersion: r.ctx.version, sources, seen,
      build: { buildId: build.buildId, commit: build.commit, branch: build.branch, version: build.version, tickets },
    });
  }
  // a change job: the change request's own events (analysed, built with its commit, released) right away
  if (outcome.result && (run.kind === "change.analyse" || run.kind === "change.build")) {
    await recordChanges(st.dir, run.p, r.ctx, run.log.bind(run), run.now(), {
      current: { jobId: run.id, at: run.now().toISOString() },
      build: build ? { jobId: run.id, commit: build.commit, branch: build.branch, buildId: build.buildId, version: build.version } : null,
    });
  }
  // a feedback job: the team's reply / suggested change in the thread right away (userEvents.ts → feedbackContext.ts)
  if (outcome.result && run.kind === "feedback.apply") await recordPeople(st.dir, run.p, r.ctx, run.log.bind(run), run.now());
  appendLedger(st.dir, {
    type: "job.finished", jobId: run.id, attempt: run.attempt, kind: run.kind, status,
    contextVersion: st.ctx.version, resultVersion: r.ctx.version, outputs: outputs.map((o) => o.ref), seen,
    ...(outcome.result ? { message: outcome.result.message } : { error: errText(outcome.error) }),
  });
  jobRecord(run, {
    jobId: run.id, attempt: run.attempt, kind: run.kind,
    contextVersion: st.ctx.version, contextHash: st.ctx.hash, contextFile: path.join(st.dir, "context.json"), refreshedAt: st.ctx.updatedAt, changedSections: st.changed,
    inputRefs: st.inputRefs, seen, status, resultVersion: r.ctx.version, outputs, finishedAt: run.now().toISOString(),
  });
  await writeOutputs(run);
}

/** The project's outputs and their index (outputs.ts: artifacts/README.md, index.html, the engine-style artifacts),
 *  after every job of the project. Never fails the job. */
async function writeOutputs(run: JobRun): Promise<void> {
  try {
    const { refreshOutputs } = await import("./outputs.ts");
    await refreshOutputs(run.folder().dir, run.log.bind(run));
  } catch (e) {
    run.log(`outputs: the index was not written (${errText(e)})`);
  }
}

/** Runs a job's writer with the project context around it (driver.ts). The writer's result and errors pass unchanged;
 *  a context error is only logged. */
export async function withContext(run: JobRun, writer: (run: JobRun) => Promise<KindResult>): Promise<KindResult> {
  try {
    await before(run);
  } catch (e) {
    run.log(`context: refresh before the job failed (${errText(e)}); the job goes on`);
  }
  let result: KindResult;
  try {
    result = await writer(run);
  } catch (e) {
    try {
      await after(run, { error: e });
    } catch (e2) {
      run.log(`context: recording the job's end failed (${errText(e2)})`);
    }
    throw e;
  }
  try {
    await after(run, { result });
  } catch (e) {
    run.log(`context: recording the job's outputs failed (${errText(e)})`);
  }
  return result;
}

/** The context snapshot the job works from: the one refreshed before the job, else one made now (in memory without
 *  project folders). Never throws for a missing folder. */
export async function contextOf(run: JobRun): Promise<ContextFile> {
  const st = states.get(run);
  if (st) return st.ctx;
  let r: { ctx: ContextFile; dir: string | null; changed: string[] };
  try {
    r = await refresh(run, "material");
  } catch (e) {
    run.log(`context: snapshot in memory only (${errText(e)})`);
    const snap = await snapshot(run, null);
    r = { ctx: memoryContext({ workspaceId: run.workspaceId, projectId: run.projectId, sections: snap.sections, digestOf: snap.digestOf, now: run.now() }), dir: null, changed: [] };
  }
  states.set(run, { ctx: r.ctx, dir: r.dir, inputRefs: [], seen: new Set(), changed: r.changed });
  return r.ctx;
}

/** The knowledge-base folder of the job's context (null in memory). */
export function contextDir(run: JobRun): string | null {
  return states.get(run)?.dir ?? null;
}

/** Notes the records a prompt showed (material.ts): they are the job's "seen" sources in the trace. */
export function noteContextUsed(run: JobRun, refs: readonly string[]): void {
  const st = states.get(run);
  if (!st) return;
  for (const r of refs) if (st.seen.size < SEEN_MAX && r) st.seen.add(r);
}

/** Records a check a writer made of its own work (answers.ts checkAnswers: is every answer in the draft?): a "check"
 *  event in the ledger (with the job, its context version and the result) and `<name>-check.json` in the job's folder.
 *  In memory (no project folders) only the job folder, when there is one. Never throws. */
export function recordCheck(run: JobRun, name: string, result: Record<string, unknown>): void {
  const value = { name, jobId: run.id, attempt: run.attempt, kind: run.kind, at: run.now().toISOString(), ...result };
  try {
    run.writeJobFile(`${name}-check.json`, redactDeep(value));
  } catch (e) {
    run.log(`context: the ${name} check was not written to the job folder (${errText(e)})`);
  }
  const st = states.get(run);
  if (!st?.dir) return;
  try {
    appendLedger(st.dir, { type: "check", ...value, contextVersion: st.ctx.version });
  } catch (e) {
    run.log(`context: the ${name} check was not recorded in the ledger (${errText(e)})`);
  }
}
