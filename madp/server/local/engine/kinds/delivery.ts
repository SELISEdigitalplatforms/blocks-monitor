// Delivery: the build of a milestone (build.run), its preview (preview.deploy, queued by the build) and the build of a
// change request after go-live (change.build). The rows are those of seed/build/delivery.ts, written live:
//
//   build.run       Milestone building -> each ticket moves through the agents' columns (Ticket Column / AgentRole /
//                   IsDone / DoneAt and a TicketEvent per move, with the pull request, a remark now and then and the
//                   test report; now and then a reviewer or the tests send a ticket back) -> queues preview.deploy.
//   preview.deploy  Preview ready (https URL, version 0.<n>.<k>, k = the milestone's feedback tickets done), Milestone
//                   preview-ready, "preview ready" notes. The milestone then WAITS for the client: feedback (a fix
//                   ticket, Source "feedback", from milestone.feedback) is built by a build.run of that milestone and
//                   the preview is refreshed; open feedback left after a build is picked up here. Acceptance
//                   (milestone.accept) sets the milestone done; only after the LAST one is accepted does the op queue
//                   preview.deploy with { release: "1.0.0" }: the accepted build goes to dev as release 1.0.0 and the
//                   project moves on to Release. With { environment: "stage" | "production" } (queued by
//                   release.promote) the promoted version is deployed there and its Release row gets its address.
//   change.build    the change's tickets (from the request, or from the fix plan of a bug analysis) through the same
//                   columns -> release <version> to dev, ChangeRequest released-dev, "change released" notes.
//                   A new feature on a product without a Factory scope (Analysis route "feature") builds one increment
//                   per change.build: the first increment with open tickets, through the official feature lane with
//                   --max-steps by its size, released to dev; while later increments are left the request goes back
//                   to "approved" (people try it on dev, then start the next build), after the last one released-dev.
//
// After the deploy (real builds): the data tables, then the texts, each retried once when that can help
// (official/afterDeploy.ts), then, for a product that checks each change on dev, the change's own live tests (the lane
// runs with --no-accept and `madp accept` runs last: official/acceptance.ts; a lane that failed its own checks anyway,
// LaneAttention, still gets its data tables and texts). A build whose steps after the deploy did not all finish still succeeds (its code is live)
// with its ErrorCode naming what is left (src/domain/afterDeploy.ts); the page says so and offers "Finish the steps
// after the deploy": build.retryAfterDeploy queues a job of the same kind with { afterDeploy: true }, which runs only
// those steps again (finishAfterDeploy) and changes no status.
//
// Dependencies (Ticket.DependsOn): a ticket leaves Planned only once every ticket it waits for is done; tickets that wait
// for nothing (or for done work) run side by side, picked up in the team's order (src/domain/ticketDeps.ts). An open
// ticket of another milestone that a ticket of the build waits for is built first, in the same build.
//
// Restart safe by construction: the plan of moves is worked out from where the tickets (and their dependencies) stand now.
//
// Real builds (MF_ENGINE_BUILD=claude, build/paths.ts): build.run and change.build write, install, build and check the
// app for real (build/realBuild.ts) and the tickets move when their part is written, reviewed, built, scanned,
// documented and merged; preview.deploy publishes the build on the preview server (build/publish.ts) and the Preview
// and Release rows carry its real address. Off (the default): the board-only build above.
import { changeCode } from "../../../../src/domain/delivery";
import { featureMaxSteps, incrementOfTicket, incrementsOf, nextIncrement, parseChangeAnalysis, planIndexOf, type ChangeAnalysis } from "../../../../src/domain/changeAnalysis";
import { chainLength, changeDependencies, teamOrder } from "../../../../src/domain/ticketDeps";
import { plannedRoleOf } from "../../../../src/domain/ticketRole";
import type { EngineJobKind } from "../../../../src/domain/engineJob";
import type { Row } from "../../../../functions/_lib/gateway";
import { num, str, strs } from "../context.ts";
import { JobFailure, inParallel, type JobRun, type KindResult, type KindWriter } from "../run.ts";
import { clip, hashOf, sentence, slugOf } from "../text.ts";
import { estimateField, readCalibration } from "../estimates.ts";
import { buildMode, siteUrl } from "../build/paths.ts";
import { buildTicketOf, type BuildTicket, type ChangeBrief, type FeatureBuildBrief } from "../build/prompt.ts";
import { publishDevRelease, publishEnvironment, publishPreview } from "../build/publish.ts";
import { factRules } from "../build/jobKit.ts";
import { ensureApp, type OfficialApp } from "../official/app.ts";
import { MergeConflict, fixLoopWords, runOfficialWork, type FixEnvironment, type WorkResult } from "../official/build.ts";
import { refreshStreamsAdvice } from "../official/streamsAdvice.ts";
import { inMergeTurn, lastLandedOf, mergeTurn, ordinal, projectStreams, readyWords, removeTurnFile, turnFile, writeGo } from "../streams.ts";
import { stepFamily, type LaneStep } from "../official/madp.ts";
import { syncTexts, withTexts, type TextsOutcome } from "../official/uilm.ts";
import { afterDeployNote, syncDataTables, type DataOutcome } from "../official/dataTables.ts";
import { runAfterDeploy, type AfterDeployResult } from "../official/afterDeploy.ts";
import { NO_CHECKS, acceptChecksOf, laneWithChecks, openAcceptTargets, runAcceptance, type AcceptOutcome } from "../official/acceptance.ts";
import { NOTHING_DEPLOYED_CODE, afterDeployIssues, type AfterDeployDetails, type AfterDeployIssue } from "../../../../src/domain/afterDeploy";
import { failingChecksSince, fixBlock, readFound, recordFound, reportedChecks, type FoundCheck } from "../official/failingChecks.ts";
import { revertPlan, runRevert } from "../official/revert.ts";
import {
  MAX_AUTO_FIX_ROUNDS, afterChecksDecision, changeCommitsOf, checksCleared, checksPolicyOf, fixRoundInput, fixRoundOf, fixTargets, latestRun, nothingLine, parseChangeChecks, redBuildsOf, revertInput, revertOf,
  serializeChangeChecks, sparedRounds, withRun, MAX_PASSED, type ChangeChecks, type CheckFile, type ChecksJob, type ChecksRunKind, type DiagnosedCheck, type FailingCheck, type FixRoundInput, type KnownMark,
} from "../../../../src/domain/changeChecks";
import { changeVersionAtStart, fixRoundVersion, freeVersion, takenVersions } from "../../../../src/domain/delivery";
import { continueDecision, continueOn, continuedWords, pausedByPerson } from "../../../../src/domain/continueIncrements";

type Column = "planned" | "dev" | "review" | "test" | "security" | "docs" | "gate" | "done";
const FLOW: Column[] = ["planned", "dev", "review", "test", "security", "docs", "gate", "done"];
const OWNER: Record<Column, string> = { planned: "planner", dev: "dev", review: "reviewer", test: "qa", security: "secops", docs: "docs", gate: "shipper", done: "shipper" };
const isColumn = (v: unknown): v is Column => typeof v === "string" && (FLOW as string[]).includes(v);

const MOVE_TEXT: Record<Column, (t: Tk, n: number) => string> = {
  planned: (t) => `Created in Planned: ${t.title}.`,
  dev: (t) => `Started on ${t.title}.`,
  review: (t, n) => `Ready for review on branch mf-${t.number}-${slugOf(t.title, 28)}: ${3 + (n % 9)} files changed.`,
  test: (_t, n) => ["Review approved: structure, naming and error handling are fine.", "Review approved after one small rename; the change is easy to follow.", "Review approved: the new code follows the existing patterns."][n % 3]!,
  security: (_t, n) => `${12 + (n % 23)} automated checks passed; acceptance criteria verified.`,
  docs: (_t, n) => ["Security checks passed with no findings.", "Dependency and secret scans clean; input validation checked.", "Security checks passed; access rules covered by tests."][n % 3]!,
  gate: (_t, n) => ["User guide and release notes updated.", "Release notes and the help text for the screen updated.", "User guide updated with the new steps."][n % 3]!,
  done: () => "Release gate passed.",
};

const SEND_BACKS = [
  "Sent back: the empty state is missing when there is nothing to show.",
  "Sent back: the error message on a lost connection is not in plain words yet.",
  "Sent back: two acceptance criteria are not covered by a test yet.",
  "Sent back: the date is shown in the wrong time zone on the confirmation.",
];
const REMARKS = [
  "Reused the existing date helpers instead of adding a new library.",
  "Added a fallback when the list is empty so the screen never looks broken.",
  "Kept the API response small: only the fields this screen shows.",
  "The import tolerates a missing optional column and logs a warning.",
  "Moved the validation to the server so the phone and the web check the same rules.",
];
const NOW_DOING: Record<Column, string> = {
  planned: "planning",
  dev: "developing",
  review: "reviewing",
  test: "testing",
  security: "security checks on",
  docs: "documenting",
  gate: "release gate for",
  done: "finished",
};

interface Tk {
  id: string;
  /** Stable across resets (PlanRef and project), so the same plan always plays out the same way. */
  seed: number;
  number: number;
  title: string;
  column: Column;
  sentBack: boolean;
  /** Ids of the tickets it waits for. */
  deps: string[];
}

interface Move {
  at: number;
  tk: Tk;
  from: Column;
  to: Column;
  text: string;
  /** Who moves it: the owner of the column it leaves. */
  label: string;
  after?: { kind: "artifact" | "note"; label: string; text: string }[];
}

function ticketOf(r: Row, project: string): Tk {
  const id = str(r.ItemId);
  return {
    id,
    seed: hashOf(project, str(r.PlanRef) || str(r.Title)),
    number: num(r.Number),
    title: str(r.Title) || "the ticket",
    column: isColumn(r.Column) ? r.Column : "planned",
    sentBack: false,
    deps: [...new Set(strs(r.DependsOn))].filter((d) => d !== "" && d !== id),
  };
}

/** The build's tickets plus every open ticket they wait for (transitively) that is not part of them: the team does
 *  that work first, in the same build. Answers them in board order (by number). */
function withOpenDeps(run: JobRun, rows: Row[]): Row[] {
  const byId = new Map(run.p.tickets().map((t) => [str(t.ItemId), t]));
  const set = new Map(rows.map((r) => [str(r.ItemId), r]));
  const queue = [...rows];
  while (queue.length > 0) {
    const r = queue.shift()!;
    for (const d of strs(r.DependsOn)) {
      const dep = byId.get(d);
      if (!dep || set.has(d) || dep.Column === "done") continue;
      set.set(d, dep);
      queue.push(dep);
    }
  }
  return [...set.values()].sort((a, b) => num(a.Number) - num(b.Number));
}

/** The moves left for each ticket, timed as a pipeline: started tickets go on at once; waiting ones are picked up one
 *  after another in the team's order, each only once the tickets it waits for are done. A dependency that is done, or
 *  not part of the build (gone), counts as met. Without dependencies this is the plain staggered pipeline. */
function planMoves(run: JobRun, tickets: Tk[], totalSec: number): { moves: Move[]; steps: number; doneSteps: number } {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const open = tickets.filter((t) => t.column !== "done");
  const openIds = open.map((t) => t.id);
  const waitsFor = (id: string): string[] => byId.get(id)!.deps.filter((d) => byId.has(d) && byId.get(d)!.column !== "done");
  const order = teamOrder(openIds, waitsFor).map((id) => byId.get(id)!);
  // the longer the chain of tickets waiting for each other, the quicker each one moves, so the build keeps its length
  const chain = Math.max(1, chainLength(openIds, waitsFor));
  const step = (totalSec * Math.min(0.5, 0.85 / chain)) / 7;
  const fresh = order.filter((t) => t.column === "planned");
  const stagger = fresh.length > 1 ? Math.max(0, totalSec - chain * 7 * step) / (fresh.length - 1) : 0;
  const moves: Move[] = [];
  const doneAt = new Map<string, number>();
  let steps = 0;
  let doneSteps = 0;
  const sendBacks = run.config.sendBacks;
  for (const t of tickets) {
    const willSendBack = sendBacks && !t.sentBack && t.seed % 5 === 2 && FLOW.indexOf(t.column) < FLOW.indexOf("test");
    steps += 7 + (willSendBack || t.sentBack ? 3 : 0);
    doneSteps += FLOW.indexOf(t.column) + (t.sentBack ? 3 : 0);
  }
  for (const t of order) {
    const seed = t.seed;
    const willSendBack = sendBacks && !t.sentBack && seed % 5 === 2 && FLOW.indexOf(t.column) < FLOW.indexOf("test");
    const k = fresh.indexOf(t);
    // picked up a moment after the last ticket it waits for is done
    const ready = Math.max(0, ...waitsFor(t.id).map((d) => (doneAt.get(d) ?? 0) + step * 0.4));
    let at = k >= 0 ? Math.max(2 + k * stagger, ready) : 1 + (open.indexOf(t) % 3) * 1.5;
    let col: Column = t.column;
    const go = (to: Column, text: string, after?: Move["after"]) => {
      at += step * (0.75 + ((seed >>> 3) + FLOW.indexOf(to)) % 6 / 10);
      moves.push({ at, tk: t, from: col, to, text, label: OWNER[col === "planned" ? "dev" : col], after });
      col = to;
    };
    for (const to of FLOW.slice(FLOW.indexOf(t.column) + 1)) {
      const after: Move["after"] = [];
      if (to === "review") {
        after.push({ kind: "artifact", label: "dev", text: `Pull request #${40 + t.number * 3} opened: ${t.title}.` });
        if (seed % 4 === 1) after.push({ kind: "note", label: "dev", text: REMARKS[seed % REMARKS.length]! });
      }
      if (to === "security") after.push({ kind: "artifact", label: "qa", text: `Test report: ${10 + (seed % 17)} passed, 0 failed.` });
      go(to, MOVE_TEXT[to](t, seed), after);
      if (to === "test" && willSendBack) {
        go("dev", SEND_BACKS[seed % SEND_BACKS.length]!);
        go("review", "Fixed and ready for review again.");
        go("test", MOVE_TEXT.test(t, seed + 1));
      }
    }
    doneAt.set(t.id, at);
  }
  moves.sort((a, b) => a.at - b.at || a.tk.number - b.tk.number);
  return { moves, steps: Math.max(1, steps), doneSteps };
}

/** True when the ticket was already sent back once (a move to an earlier column). */
function wasSentBack(run: JobRun, ticketId: string): boolean {
  return run.p.ticketEvents(ticketId).some((e) => e.Kind === "move" && isColumn(e.FromColumn) && isColumn(e.ToColumn) && FLOW.indexOf(e.ToColumn) < FLOW.indexOf(e.FromColumn) && e.ToColumn !== "planned");
}

/** One move: the ticket's column and agent (done: IsDone, DoneAt), its move event and the events after it. */
async function moveTicket(run: JobRun, mv: Pick<Move, "tk" | "from" | "to" | "text" | "label" | "after">, evKey: string): Promise<void> {
  const at = run.iso();
  const done = mv.to === "done";
  await run.together(async () => {
    await run.update("Ticket", mv.tk.id, { Column: mv.to, AgentRole: OWNER[mv.to], IsDone: done, ...(done ? { DoneAt: at } : {}) });
    await run.insert("TicketEvent", { TicketId: mv.tk.id, Kind: "move", FromColumn: mv.from, ToColumn: mv.to, AuthorUserId: "", AuthorLabel: mv.label, Text: mv.text, At: at, IsAuto: true, EngineJobId: run.id }, `ev:${evKey}`);
    for (const [i, a] of (mv.after ?? []).entries()) {
      await run.insert("TicketEvent", { TicketId: mv.tk.id, Kind: a.kind, FromColumn: "", ToColumn: "", AuthorUserId: "", AuthorLabel: a.label, Text: a.text, At: run.iso(200 + i * 100), IsAuto: true, EngineJobId: run.id }, `ev:${evKey}:+${i}`);
    }
  });
  mv.tk.column = mv.to;
}

/** Runs the moves: each one updates the ticket, adds its events and reports progress. */
async function work(run: JobRun, tickets: Tk[], o: { totalSec: number; line: (done: number, total: number, doing: string) => string }): Promise<void> {
  for (const t of tickets) t.sentBack = wasSentBack(run, t.id);
  const { moves, steps, doneSteps } = planMoves(run, tickets, o.totalSec);
  let advanced = doneSteps;
  const total = tickets.length;
  const doneCount = () => tickets.filter((t) => t.column === "done").length;
  const pct = () => 4 + (90 * advanced) / steps;
  await run.step(pct(), o.line(doneCount(), total, ""));
  let clock = 0;
  for (const mv of moves) {
    await run.wait(Math.max(0, mv.at - clock), 0);
    clock = mv.at;
    const done = mv.to === "done";
    await moveTicket(run, mv, `${mv.tk.id}:${mv.from}>${mv.to}:${advanced}`);
    advanced += 1;
    const doing = done ? "" : `${NOW_DOING[mv.to]} “${clip(mv.tk.title, 70)}”`;
    await run.step(pct(), o.line(doneCount(), total, doing));
  }
}

// ------------------------------------------------------------------ real builds (MF_ENGINE_BUILD=claude)

const realMode = (): boolean => buildMode() !== "off";

/** The board follows the official MADP engine: every ticket moves forward only, when the lane really finished that part
 *  of the work (its steps: plan, dev, ownership, gate, review, commit, push, deploy, smoke). */
const STEP_PCT: Record<string, number> = { load: 18, preflight: 20, isolate: 22, file: 24, diagnose: 30, depth: 31, plan: 32, locate: 32, lock: 34, dev: 60, ownership: 62, integrate: 64, gate: 70, verify: 70, fix: 72, review: 76, guard: 77, commit: 80, push: 83, secrets: 85, deploy: 90, smoke: 94, post: 95 };
function laneMoves(run: JobRun, tickets: Tk[], line: string): (s: LaneStep) => Promise<void> {
  const open = () => tickets.filter((t) => t.column !== "done");
  const go = async (t: Tk, to: Column, text: string) => {
    if (FLOW.indexOf(to) <= FLOW.indexOf(t.column)) return;
    const from = t.column;
    await moveTicket(run, { tk: t, from, to, text, label: OWNER[from === "planned" ? "dev" : from] }, `${t.id}:${from}>${to}:madp`);
  };
  const all = async (to: Column, text: string) => {
    await inParallel(open(), 4, (t) => go(t, to, text));
  };
  let shown = 0;
  return async (s) => {
    const family = stepFamily(s.name);
    const repo = /\[([^\]]+)\]/.exec(s.name)?.[1];
    const failed = /\bfail/i.test(s.outcome);
    const on = repo ? ` (${repo})` : "";
    if (!failed) {
      if (family === "plan" || family === "locate") await all("dev", `Started by the MADP dev agents: ${clip(s.outcome, 140)}.`);
      else if (family === "dev" || family === "ownership") await all("review", "Code written by the MADP dev agents, each within its own files.");
      else if (family === "gate" || family === "verify") await all("test", `MADP gate passed${on}: ${clip(s.outcome, 120)}.`);
      else if (family === "review" && /approve/i.test(s.outcome)) await all("security", "MADP review approved the change.");
      else if (family === "commit" || family === "push") await all("gate", `Committed and pushed to dev${on}: ${clip(s.outcome, 120)}.`);
    }
    const pct = Math.max(shown, STEP_PCT[family] ?? shown);
    shown = pct;
    await run.step(pct, `${line}: ${s.name} ${clip(s.outcome, 110)}`);
  };
}

/** After the lane's deploy and smoke test: every ticket of the work is done. */
async function finishAll(run: JobRun, tickets: Tk[], text: string): Promise<void> {
  await inParallel(tickets.filter((t) => t.column !== "done"), 4, async (t) => {
    const from = t.column;
    await moveTicket(run, { tk: t, from, to: "done", text, label: OWNER[from === "planned" ? "dev" : from] }, `${t.id}:${from}>done:madp`);
  });
}

/** A step after the deploy on every ticket the work finished: the data tables (official/dataTables.ts: "Data tables
 *  updated on Blocks (...)" or the plain refusal or failure) and the texts' sync (official/uilm.ts: "Texts synced to
 *  Blocks Localization", or the plain note when Blocks has portal edits or the sync did not go through). */
async function noteAfterDeploy(run: JobRun, tickets: Tk[], t: { status: string; line: string }, key: "data" | "texts" | "accept"): Promise<void> {
  if (t.status === "none" || !t.line) return;
  await inParallel(tickets, 4, async (tk) => {
    await run.insert("TicketEvent", { TicketId: tk.id, Kind: "note", FromColumn: "", ToColumn: "", AuthorUserId: "", AuthorLabel: "shipper", Text: t.line, At: run.iso(), IsAuto: true, EngineJobId: run.id }, `ev:${tk.id}:${key}`);
  });
}

/** The steps after a successful lane, in order: the new data tables (the new API code needs them), then the texts, each
 *  retried once when that can help, then the change's own checks on dev (`accept`, when the product has them); and
 *  what is still open after them (official/afterDeploy.ts). */
async function afterDeploy(run: JobRun, app: OfficialApp, res: { commits: string[] }, working: Tk[], accept?: () => Promise<AcceptOutcome>): Promise<AfterDeployResult> {
  return runAfterDeploy({
    // a product whose API keeps its tables in blocks/data/schemas: new tables and fields go to Blocks now (additive only)
    data: () => syncDataTables(run, app, res, { step: (p, l) => run.step(p, l), pct: 95 }),
    // a product with a localization section shows its texts from Blocks: the changed modules go there now
    texts: () => syncTexts(run, app, res, { step: (p, l) => run.step(p, l), pct: 95 }),
    // last: the change's own checks on dev (they may need the new tables and texts)
    ...(accept ? { accept } : {}),
    log: (line) => run.log(line),
    note: (t, key) => noteAfterDeploy(run, working, t, key),
  });
}

/** The checks' line in the job's message only when they did not pass, could not run or could not judge the change (the
 *  tickets get every outcome) (pure). */
const checksNote = (a: AcceptOutcome): AcceptOutcome | null => (a.status === "failed" || a.status === "not-run" || a.status === "not-judged" ? a : null);

/** "Finish the steps after the deploy" (the delivery op build.retryAfterDeploy): a job of the build's own kind with
 *  { afterDeploy: true, afterJobId } runs only the steps after the deploy again. No lane, no ticket move, no status
 *  change: the data tables and the texts an earlier build left open are still listed in the product's records
 *  (data-sync.json and uilm.json "pending"), and both syncs retry those by themselves; the change's own checks run
 *  again on the repos and commits accept.json kept for that build. The tickets of that build get the new notes; the
 *  job's ErrorCode says what is still open, like any build's. */
async function finishAfterDeploy(run: JobRun, what: string, keep: string[], crId = ""): Promise<KindResult> {
  run.resumeHere();
  if (!realMode()) return { outputs: keep, message: `Nothing was left to finish after the deploy of ${what}.` };
  await run.step(5, `Finishing the steps after the deploy of ${what}.`);
  const app = await ensureApp(run, (p, l) => run.step(p, l));
  const afterJobId = str(run.input.afterJobId);
  const earlier = run.p.row("EngineJob", afterJobId);
  const ticketIds = strs(earlier?.OutputRefs).map((r) => /^Ticket:(.+)$/.exec(r)?.[1] ?? "").filter(Boolean);
  const tickets = ticketIds.map((id) => run.p.row("Ticket", id)).filter((r): r is Row => Boolean(r)).map((r) => ticketOf(r, run.p.name));
  // the change's own checks again when that build's did not get through (accept.json keeps which repos and commits);
  // when they are not known any more they stay open, never pass unseen
  const opened = openAcceptTargets(app, afterJobId);
  const hadChecks = afterDeployIssues(earlier?.ErrorCode).some((i) => i.startsWith("accept-"));
  // a change's checks again: its other commits are never "before" it (a fix round's base build and earlier rounds), a
  // person's marks count
  const record = crId ? parseChangeChecks(run.p.row("ChangeRequest", crId)?.Checks) : null;
  const earlierView = earlier ? jobView(earlier) : null;
  const base = (earlierView && (fixRoundOf(earlierView)?.baseJobId || revertOf(earlierView)?.baseJobId)) || afterJobId;
  const change = crId ? changeCommitsOf(record, base, afterJobId) : [];
  const targets = opened?.map((t) => (change.length ? { ...t, change: [...new Set([...(t.change ?? []), ...change])].slice(0, 40) } : t)) ?? null;
  const accept = targets?.length
    ? () => runAcceptance(run, app, targets, { step: (p, l) => run.step(p, l), known: knownMarks(record) })
    : hadChecks ? async () => ({ ...NO_CHECKS, status: "not-run" as const, notRun: ["unknown"], line: "The change is on dev, but its own checks on the development environment could not run again: which ones it had is no longer known, so the change is not checked yet. Its next build runs its checks." }) : undefined;
  await run.step(20, `Finishing the steps after the deploy of ${what}: the data tables, then the texts${accept ? ", then its own checks on the development environment" : ""}.`);
  const since = Date.now();
  const { tables, texts, accept: checks, issues, details } = await afterDeploy(run, app, { commits: [] }, tickets, accept);
  // a change's checks run again: recorded on the change as a run of the same kind as the deploy they checked
  if (crId && checks.status !== "none") {
    const cr = run.p.row("ChangeRequest", crId);
    const before = latestRun(parseChangeChecks(cr?.Checks), afterJobId);
    const fix = fixRoundOf(earlier ? jobView(earlier) : null);
    const revert = revertOf(earlier ? jobView(earlier) : null);
    await recordChecks(run, app, crId, {
      kind: fix ? "fix" : revert ? "revert" : "build", round: fix?.round ?? 0, auto: false, baseJobId: fix?.baseJobId ?? revert?.baseJobId ?? before?.baseJobId ?? "",
      version: before?.version ?? str(cr?.Version), commits: readFound(app, afterJobId)?.commits ?? before?.commits ?? [], checks, sinceMs: since,
      // what the round's diagnosis said stays with the checks it was about
      diagnosed: before?.diagnosed ?? [],
    });
  }
  const note = afterDeployNote(tables, checksNote(checks), texts);
  const message = issues.length
    ? withTexts(`The steps after the deploy of ${what} are still not finished.`, note, `${what} is still not finished.`)
    : withTexts(`The steps after the deploy of ${what} are finished.`, note, `${what} is finished.`);
  return { outputs: [...keep, ...tickets.map((t) => `Ticket:${t.id}`)], message: clip(message, 200), ...(issues.length ? { attention: issues, attentionDetails: details } : {}) };
}

/** The tickets of a build in the order the team works through them (what a ticket waits for comes first). */
function inTeamOrder(tickets: Tk[]): Tk[] {
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const ids = tickets.filter((t) => t.column !== "done").map((t) => t.id);
  return [...teamOrder(ids, (id) => byId.get(id)!.deps.filter((d) => byId.has(d))).map((id) => byId.get(id)!), ...tickets.filter((t) => t.column === "done")];
}

async function officialBuildRun(run: JobRun, o: { m: Row; milestoneId: string; name: string; rows: Row[]; verb: string }): Promise<KindResult> {
  const n = num(o.m.Number, 1) || 1;
  const inBuild = new Set(o.rows.map((r) => str(r.ItemId)));
  // the version this build becomes: the milestone's feedback tickets done after it
  const k = run.p.tickets().filter((t) => t.MilestoneId === o.milestoneId && t.Source === "feedback" && (t.Column === "done" || inBuild.has(str(t.ItemId)))).length;
  const version = `0.${n}.${k}`;
  const tickets = inTeamOrder(o.rows.map((r) => ticketOf(r, run.p.name)));
  const rowOf = new Map(o.rows.map((r) => [str(r.ItemId), r]));
  const app = await ensureApp(run, (p, l) => run.step(p, l));
  const working = tickets.filter((t) => t.column !== "done");
  await run.step(20, `${o.verb} ${o.name} with the official MADP engine: planning the work.`);
  // the change's own checks on dev run last, after the data tables and texts (official/acceptance.ts)
  const facts = await factRules(run);
  const { work: res, accept } = await laneWithChecks(run, app, (noAccept) => runOfficialWork(run, app, {
    product: run.p.name,
    label: `Milestone ${n}: ${o.name}`,
    goal: str(o.m.Goal),
    tickets: tickets.map((t) => buildTicketOf(rowOf.get(t.id)!, run.p)),
    built: run.p.tickets().filter((t) => t.Column === "done" && !inBuild.has(str(t.ItemId))).slice(-40).map((r) => buildTicketOf(r, run.p)),
    later: run.p
      .milestones()
      .filter((x) => str(x.ItemId) !== o.milestoneId && (x.Status === "planned" || x.Status === "building"))
      .map((x) => `Milestone ${num(x.Number)}: ${str(x.Name)}${str(x.Goal) ? `: ${str(x.Goal)}` : ""}`),
    facts,
  }, { kind: "milestone", onStep: laneMoves(run, tickets, `${o.verb} ${o.name}`), noAccept }), { step: (p, l) => run.step(p, l) });
  await finishAll(run, tickets, "Deployed to dev by MADP and smoke-tested.");
  const { tables, texts, accept: checks, issues, details } = await afterDeploy(run, app, res, working, accept);
  await run.step(96, `${o.name}: built and deployed to dev; handing ${version} to the preview.`);
  await run.queueJob({
    kind: "preview.deploy",
    input: { projectId: run.projectId, milestoneId: o.milestoneId, version },
    target: { type: "milestone", id: o.milestoneId },
    requestKey: `job:preview.deploy:${o.milestoneId}:${version}:${run.id}`,
  });
  const message = `${o.name} built by MADP: ${tickets.length} of ${tickets.length} tickets done${res.commits[0] ? `, commit ${res.commits[0].slice(0, 7)}` : ""}.`;
  return officialResult(tickets.map((t) => `Ticket:${t.id}`), withTexts(message, afterDeployNote(tables, checksNote(checks), texts), `${o.name} is on dev.`), res, version, tickets, texts, tables, { issues, details, checks });
}

/** An official build's result: the usual outputs and line, what is still open after its deploy (the job's attention),
 *  plus its trace for the context ledger. */
function officialResult(outputs: string[], message: string, r: WorkResult, version: string, tickets: Tk[], texts?: TextsOutcome | null, tables?: DataOutcome | null,
  after: { issues: AfterDeployIssue[]; details: AfterDeployDetails; checks: AcceptOutcome; failing?: FailingCheck[] } = { issues: [], details: {}, checks: NO_CHECKS }): KindResult & { build: Record<string, unknown> } {
  const { issues, details, checks, failing = [] } = after;
  return {
    outputs,
    message: clip(message, 200),
    ...(issues.length ? { attention: issues, attentionDetails: details } : {}),
    build: {
      ...(issues.length ? { afterDeploy: issues } : {}),
      ...(checks.status !== "none" ? { accept: { status: checks.status, repos: checks.repos, failed: checks.failed, files: checks.files, ...(checks.notJudged ? { notJudged: checks.notJudged, unjudged: checks.unjudged } : {}), ...(checks.checks.length ? { checks: checks.checks } : failing.length ? { failing: failing.map((f) => `${f.repo}: ${f.name}`) } : {}), ...(checks.known?.length ? { known: checks.known } : {}) } } : {}),
      engine: "madp", lane: r.lane, commits: r.commits, commit: r.commits[0] ?? "", branch: "dev", version, ticketIds: tickets.map((t) => t.id), seconds: r.seconds,
      ...(texts && texts.status !== "none" ? { texts: { status: texts.status, modules: texts.modules, ...(texts.report ? { report: texts.report } : {}) } } : {}),
      ...(tables && tables.status !== "none" ? { data: { status: tables.status, repos: tables.repos, tables: tables.tables, fields: tables.fields, ...(tables.exposed?.length ? { exposed: tables.exposed } : {}) } } : {}),
    },
  };
}

/** The project's dev address: from an earlier dev release or preview, else from the client and the repository. */
function devUrl(run: JobRun): string {
  if (typeof run.p.project.BlocksProjectDomain === "string" && run.p.project.BlocksProjectDomain.startsWith("https://")) {
    return run.p.project.BlocksProjectDomain.replace(/\/+$/, "");
  }
  if (realMode()) return siteUrl(run.projectId, "latest");
  const rel = run.p.releases("dev").map((r) => str(r.Url)).find((u) => u.startsWith("https://"));
  if (rel) return rel.replace(/\/+$/, "");
  const pre = run.p.rows("Preview").map((r) => str(r.Url)).find((u) => u.startsWith("https://"));
  if (pre) return pre.replace(/^https:\/\/m\d+-/, "https://").replace(/\/+$/, "");
  const p = run.p.project;
  const region = `${str(p.ClientRegion)} ${str(p.ClientName)}`.toLowerCase();
  const tld = /switzerland|schweiz|suisse|\bag\b|zurich|zürich|bern|basel|geneva/.test(region) ? "ch" : /germany|deutschland|gmbh|berlin|munich|hamburg/.test(region) ? "de" : /austria|österreich|vienna|wien/.test(region) ? "at" : "com";
  const client = slugOf(str(p.ClientName).replace(/\b(AG|GmbH|SA|Sàrl|SARL|Ltd|Inc|KG|AB|BV|NV|SE)\b\.?/g, ""), 30) || "client";
  const app = slugOf(str(p.RepoName) || run.p.name, 40).replace(/-(app|portal|webshop|platform|service|tool)$/, "") || "app";
  return `https://${app}.dev.${client}.${tld}`;
}

const previewUrl = (dev: string, n: number): string => dev.replace(/^https:\/\//, `https://m${n}-`);

// ------------------------------------------------------------------ build.run

async function buildRun(run: JobRun): Promise<KindResult> {
  run.resumeHere();
  const milestoneId = str(run.input.milestoneId);
  const m = run.p.row("Milestone", milestoneId);
  if (!m) throw new Error("the milestone of this build no longer exists");
  const name = str(m.Name) || `Milestone ${num(m.Number, 1)}`;
  if (run.input.afterDeploy === true) return finishAfterDeploy(run, `milestone ${num(m.Number, 1) || 1}`, []);
  const own = run.p.tickets().filter((t) => t.MilestoneId === milestoneId);
  if (own.length === 0) throw new Error("the milestone has no tickets");
  const rows = withOpenDeps(run, own);
  if (m.Status === "planned") await run.update("Milestone", milestoneId, { Status: "building" });
  if (run.p.project.Stage === "board") await run.update("Project", run.projectId, { Stage: "build" });
  // a build for feedback on a ready preview: the milestone keeps its preview (preview-ready) while it is updated
  const feedback = run.input.feedback === true || own.some((t) => t.Source === "feedback" && t.Column !== "done");
  const verb = feedback && m.Status === "preview-ready" ? "Updating" : "Building";
  if (realMode()) return officialBuildRun(run, { m, milestoneId, name, rows, verb });

  const tickets = rows.map((r) => ticketOf(r, run.p.name));
  const totalSec = Math.min(180, Math.max(80, 55 + 12 * tickets.filter((t) => t.column !== "done").length));
  await work(run, tickets, {
    totalSec,
    line: (done, total, doing) => `${verb} ${name}: ${done} of ${total} tickets done${doing ? `, ${doing}` : ""}.`,
  });

  // Hand-over to the release gate: the preview of this milestone.
  await run.step(96, `${name}: packaging the build for the preview.`);
  await run.wait(3);
  const n = num(m.Number, 1) || 1;
  const version = previewVersion(run, milestoneId, n);
  await run.queueJob({
    kind: "preview.deploy",
    input: { projectId: run.projectId, milestoneId, version },
    target: { type: "milestone", id: milestoneId },
    requestKey: `job:preview.deploy:${milestoneId}:${version}:${run.id}`,
  });
  return { outputs: tickets.map((t) => `Ticket:${t.id}`), message: `${name} built: ${tickets.length} of ${tickets.length} tickets done.` };
}

// ------------------------------------------------------------------ preview.deploy

/** 0.<n>.<k>: k counts the milestone's feedback tickets that are done, so every update for feedback is a new preview.
 *  Read from the rows, so a restarted build asks for the same version. */
export function previewVersion(run: JobRun, milestoneId: string, n: number): string {
  const k = run.p.tickets().filter((t) => t.MilestoneId === milestoneId && t.Source === "feedback" && t.Column === "done").length;
  return `0.${n}.${k}`;
}

const ACTIVE = new Set(["queued", "claimed", "running"]);

/** Feedback left open after a build (given while another build ran) is built now: a build.run of its milestone, when
 *  no build runs and the milestone still waits for acceptance. Answers the queued job's id, or null. */
async function pickUpFeedback(run: JobRun): Promise<string | null> {
  const open = run.p.tickets().filter((t) => t.Source === "feedback" && t.Column !== "done" && str(t.MilestoneId));
  if (open.length === 0) return null;
  const busy = run.p.rows("EngineJob").some((j) => (j.Kind === "build.run" || j.Kind === "change.build") && ACTIVE.has(str(j.Status)));
  if (busy) return null;
  for (const mid of [...new Set(open.map((t) => str(t.MilestoneId)))]) {
    const m = run.p.row("Milestone", mid);
    if (!m || m.Status !== "preview-ready") continue;
    const ids = open.filter((t) => t.MilestoneId === mid).map((t) => str(t.ItemId)).sort();
    return run.queueJob({
      kind: "build.run",
      input: { projectId: run.projectId, milestoneId: mid, feedback: true },
      requestKey: `job:build.run:feedback:${mid}:${hashOf(...ids)}`,
    });
  }
  return null;
}

/** The first release to dev, once the client accepted the last milestone (milestone.accept queues it): the accepted
 *  build goes to the dev address as release 1.0.0, every milestone is done and the project moves on to Release. */
async function releaseToDev(run: JobRun): Promise<KindResult> {
  const version = /^\d+\.\d+\.\d+$/.test(str(run.input.release)) ? str(run.input.release) : "1.0.0";
  const milestoneId = str(run.input.milestoneId);
  let dev = devUrl(run);
  let host = dev.replace(/^https:\/\//, "");
  const outputs: string[] = [];
  await run.step(10, `Every milestone is accepted; deploying release ${version} to ${host}.`);
  if (realMode()) {
    dev = await publishDevRelease(run, version, (p, l) => run.step(p, l));
    host = dev.replace(/^https:\/\//, "");
    await run.step(85, `Smoke tests passed; ${host} runs ${version}.`);
  } else {
    await run.wait(5);
    await run.step(55, `Running the smoke tests on ${host}.`);
    await run.wait(5);
    await run.step(85, `Smoke tests passed; switching ${host} to ${version}.`);
    await run.wait(2);
  }
  const existing = run.p.releases("dev").find((r) => r.Version === version);
  const releaseId = existing
    ? str(existing.ItemId)
    : await run.insert(
      "Release",
      { Environment: "dev", Version: version, Url: dev, Status: "released", ChangeRequestIds: [], MilestoneId: milestoneId, ReleasedAt: run.iso(), ReleasedByUserId: run.requester, EngineJobId: run.id },
      `release:dev:${version}`,
    );
  outputs.push(`Release:${releaseId}`);
  for (const x of run.p.milestones()) if (x.Status !== "done") await run.update("Milestone", str(x.ItemId), { Status: "done" });
  if (run.p.project.Stage === "build" || run.p.project.Stage === "board") {
    await run.update("Project", run.projectId, { Stage: "release", Rev: num(run.p.project.Rev) + 1 });
  }
  await run.notify({
    kind: "release.created",
    to: run.p.followers(run.requester),
    params: { environment: "dev", version },
    link: `/p/${run.projectId}/delivered?env=dev`,
    eventKey: `factory:release.created:${run.projectId}:dev:${version}`,
  });
  return { outputs, message: `Release ${version} is on dev.` };
}

/** The address of a stage or production release: the environment's earlier address, else from the dev address
 *  (service.dev.client.de → service-stage.client.de and service.client.de). */
function envUrl(run: JobRun, env: "stage" | "production"): string {
  if (realMode()) return devUrl(run);
  const prev = run.p.releases(env).map((r) => str(r.Url)).find((u) => u.startsWith("https://"));
  if (prev) return prev.replace(/\/+$/, "");
  const dev = devUrl(run);
  const m = /^https:\/\/([^.]+)\.dev\.(.+)$/.exec(dev);
  if (m) return env === "production" ? `https://${m[1]}.${m[2]}` : `https://${m[1]}-stage.${m[2]}`;
  return env === "production" ? dev.replace(".dev.", ".") : dev.replace(".dev.", ".stage.");
}

/** A promoted release goes live (release.promote queues it with the environment): the version is deployed to the
 *  stage or production address, smoke-tested, and the Release row gets its address. */
async function deployRelease(run: JobRun, env: "stage" | "production"): Promise<KindResult> {
  const version = str(run.input.version);
  const row = run.p.row("Release", str(run.input.releaseId)) ?? run.p.releases(env).find((r) => r.Version === version);
  if (!row) throw new Error("the release to deploy no longer exists");
  let url = envUrl(run, env);
  let host = url.replace(/^https:\/\//, "");
  const where = env === "production" ? "production" : "staging";
  await run.step(10, `Deploying ${version} to ${where} (${host}).`);
  if (realMode()) {
    url = await publishEnvironment(run, env, version, (p, l) => run.step(p, l));
    host = url.replace(/^https:\/\//, "");
    await run.step(85, `Smoke tests passed; ${host} runs ${version}.`);
    if (str(row.Url) !== url) await run.update("Release", str(row.ItemId), { Url: url, EngineJobId: run.id });
    return { outputs: [`Release:${str(row.ItemId)}`], message: `${version} is live on ${where}.` };
  }
  await run.wait(4);
  await run.step(55, `Running the smoke tests on ${host}.`);
  await run.wait(4);
  await run.step(85, `Smoke tests passed; switching ${host} to ${version}.`);
  await run.wait(2);
  if (!str(row.Url)) await run.update("Release", str(row.ItemId), { Url: url, EngineJobId: run.id });
  return { outputs: [`Release:${str(row.ItemId)}`], message: `${version} is live on ${where}.` };
}

async function previewDeploy(run: JobRun): Promise<KindResult> {
  if (run.input.release) return releaseToDev(run);
  if (run.input.environment === "stage" || run.input.environment === "production") return deployRelease(run, run.input.environment);
  const milestoneId = str(run.input.milestoneId);
  const m = run.p.row("Milestone", milestoneId);
  if (!m) throw new Error("the milestone of this preview no longer exists");
  const n = num(m.Number, 1) || 1;
  const version = /^\d+\.\d+\.\d+$/.test(str(run.input.version)) ? str(run.input.version) : `0.${n}.0`;
  const name = str(m.Name) || `Milestone ${n}`;
  let url: string;
  if (realMode()) {
    await run.step(8, `Checking ${version} of ${name} on dev.`);
    url = await publishPreview(run, version, (p, l) => run.step(p, l));
    await run.step(85, `Smoke tests passed; ${url.replace(/^https:\/\//, "")} runs ${version}.`);
  } else {
    url = previewUrl(devUrl(run), n);
    const host = url.replace(/^https:\/\//, "");
    await run.step(8, `Packaging ${version} of ${name}.`);
    await run.wait(4);
    await run.step(30, `Deploying ${version} to the preview environment.`);
    await run.wait(6);
    await run.step(60, `Running the smoke tests on ${host}.`);
    await run.wait(5);
    await run.step(85, `Smoke tests passed; switching ${host} to ${version}.`);
    await run.wait(2);
  }

  const readyAt = run.iso();
  const existing = run.p.rows("Preview").find((r) => r.MilestoneId === milestoneId && r.Version === version);
  const fields = { MilestoneId: milestoneId, Environment: "dev", Version: version, Url: url, Status: "ready", ReadyAt: readyAt, EngineJobId: run.id };
  let previewId: string;
  if (existing) {
    previewId = str(existing.ItemId);
    await run.update("Preview", previewId, { Url: url, Status: "ready", ReadyAt: readyAt, EngineJobId: run.id });
  } else {
    previewId = await run.insert("Preview", fields, `preview:${milestoneId}:${version}`);
  }
  if (m.Status !== "done") await run.update("Milestone", milestoneId, { Status: "preview-ready" });
  await run.notify({
    kind: "preview.ready",
    to: run.p.followers(run.requester),
    params: { milestoneName: name },
    link: `/p/${run.projectId}/build`,
    eventKey: `factory:preview.ready:${run.projectId}:${milestoneId}:${version}`,
  });
  const outputs = [`Preview:${previewId}`, `Milestone:${milestoneId}`];
  // the milestone now waits for the client (feedback or acceptance); feedback left open meanwhile is built next
  await pickUpFeedback(run);
  return { outputs, message: `Preview ${version} is live.` };
}

// ------------------------------------------------------------------ change.build

interface Planned {
  title: string;
  acceptance: string[];
  /** The ticket's own text (an analysed change's ticket); else the request's description. */
  description?: string;
  sortOrder?: number;
}

/** The planned tickets of an analysed change (ChangeRequest.Analysis): its tickets, each checked against the change's
 *  acceptance criteria (pure). */
export function analysisTickets(a: ChangeAnalysis): Planned[] {
  const criteria = a.acceptanceCriteria.map(sentence);
  return a.tickets.map((t, i) => ({
    title: clip(t.title, 120),
    acceptance: criteria.length ? criteria : [sentence(`${t.title} works on dev as described`)],
    description: t.description,
    sortOrder: i,
  }));
}

/** What the build's prompt says about an analysed change (build/prompt.ts changeBlock) (pure). */
export function changeBriefOf(a: ChangeAnalysis): ChangeBrief {
  const touches = ([["Features", a.impact.features], ["Stories", a.impact.stories], ["Screens", a.impact.screens], ["Milestones", a.impact.milestones]] as const)
    .filter(([, xs]) => xs.length > 0)
    .map(([label, xs]) => `${label}: ${xs.join(", ")}`);
  return {
    kind: a.kind,
    summary: a.summary,
    touches,
    acceptanceCriteria: a.acceptanceCriteria,
    answers: a.questions.filter((q) => q.answer !== null).map((q) => ({ question: q.text, answer: q.answer! })),
    risks: a.risks,
    conflicts: a.conflicts,
  };
}

/** The parts of the product a feature changes, in plain words. */
const partWords = (p: NonNullable<ChangeAnalysis["feature"]>["parts"]): string[] =>
  [p.api ? "API" : "", p.web ? "web app" : "", p.data ? "data" : ""].filter(Boolean);

/** Where a feature on an existing product stands: the increment to build now (the first with an open ticket; the last
 *  when all are done), its tickets among `rows`, and whether later increments are left after it (pure). */
export function featureIncrementOf(a: ChangeAnalysis, crId: string, rows: readonly Row[]): { n: number; of: number; rows: Row[]; final: boolean } {
  const incOf = (r: Row): number => {
    const k = planIndexOf(str(r.PlanRef), crId);
    return k === null ? 1 : incrementOfTicket(a, k);
  };
  const of = incrementsOf(a).length;
  const doneAt = new Map<number, boolean>();
  for (const r of rows) {
    const k = planIndexOf(str(r.PlanRef), crId);
    if (k !== null) doneAt.set(k, (doneAt.get(k) ?? true) && r.Column === "done");
  }
  const next = nextIncrement(a, (k) => doneAt.get(k) === true);
  const n = next ?? of;
  const mine = rows.filter((r) => incOf(r) === n);
  const final = !rows.some((r) => incOf(r) > n && r.Column !== "done") && (next === null || n >= of);
  return { n, of, rows: mine, final };
}

/** What the build's prompt says about this increment of a feature on an existing product (pure). */
export function featureBriefOf(a: ChangeAnalysis, n: number): FeatureBuildBrief | undefined {
  if (!a.feature) return undefined;
  const incs = incrementsOf(a);
  const line = (i: (typeof incs)[number]) => `Increment ${i.n}: ${i.title}${i.goal ? `: ${i.goal}` : ""}`;
  const me = incs.find((i) => i.n === n) ?? incs[0]!;
  return {
    increment: me.n,
    of: incs.length,
    title: me.title,
    goal: me.goal,
    parts: partWords(a.feature.parts),
    codeAreas: a.codeAreas ?? [],
    earlier: incs.filter((i) => i.n < me.n).map(line),
    later: incs.filter((i) => i.n > me.n).map(line),
  };
}

/** The tickets of a change: from its analysis, else from the fix plan of its bug analysis, else from the request's own
 *  text (requests made before the analysis). */
function changeTickets(run: JobRun, cr: Row, analysed: ChangeAnalysis | null): Planned[] {
  if (analysed && analysed.tickets.length > 0) return analysisTickets(analysed);
  const crId = str(cr.ItemId);
  const lane = str(cr.Lane);
  const title = str(cr.Title) || "the change";
  const description = str(cr.Description);
  const analysis = run.p
    .rows("AssistantMessage")
    .find((m) => m.Kind === "analysis" && m.FixChangeRequestId === crId);
  if (analysis) {
    try {
      const a = JSON.parse(str(analysis.AnalysisJson)) as { title?: string; plan?: { steps?: string[]; tests?: string[] }; estimate?: { hours?: number }; evidence?: { failing?: string } };
      // the analysis's own size decides whether the regression test is a ticket of its own (it is never stored: a
      // ticket's estimate is the real one, engine/estimates.ts)
      const size = Math.max(1, Math.round(Number(a.estimate?.hours) || 4));
      const tests = (a.plan?.tests ?? []).filter((x) => typeof x === "string").slice(0, 4);
      const out: Planned[] = [{ title: clip(str(a.title) || title, 120), acceptance: tests.length ? tests.map(sentence) : [sentence(`${title} no longer happens on dev`)] }];
      if (size >= 4) out.push({ title: clip(`Regression test: ${str(a.title) || title}`, 120), acceptance: [sentence(a.evidence?.failing ? `The case "${clip(a.evidence.failing, 90)}" is covered by an automated test` : "The reported case is covered by an automated test"), "The full test suite passes on dev."] });
      return out;
    } catch {
      /* the request's text below */
    }
  }
  const parts = description
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim().replace(/[.!?]+$/, ""))
    .filter((s) => s.length >= 18 && s.length <= 140);
  if (lane === "fix" || lane === "change" || parts.length < 2) {
    const base: Planned[] = [{ title: clip(title, 120), acceptance: [sentence(parts[0] ?? `${title} works on dev as requested`), "Nothing else on the affected screens changes."] }];
    if (lane !== "fix" && lane !== "change") base.push({ title: clip(`${title}: tests and user guide`, 120), acceptance: ["The new behaviour is covered by automated tests.", "The user guide describes the new steps."] });
    return base;
  }
  return parts.slice(0, 3).map((p, i) => ({ title: clip(p, 120), acceptance: [sentence(p), i === 0 ? "Existing reports and data keep working unchanged." : "Covered by an automated test."] }));
}

async function changeBuild(run: JobRun): Promise<KindResult> {
  run.resumeHere();
  const crId = str(run.input.changeRequestId);
  const cr = run.p.row("ChangeRequest", crId);
  if (!cr) throw new Error("the change request no longer exists");
  const lane = str(cr.Lane);
  const number = num(cr.Number, 1) || 1;
  const code = changeCode({ lane, number });
  const title = str(cr.Title) || code;
  // the version this build was started with (its input: the change request may still show the one before), never one
  // another deploy holds already
  let version = deployVersion(run, cr, crId);
  // only the steps after an earlier deploy of this change: its status stays as it is. These, a fix round and a revert
  // deploy and check on development from their start: they hold the product's merge turn for their whole run
  if (run.input.afterDeploy === true) return inTurn(run, `The steps after the deploy of ${code}`, () => finishAfterDeploy(run, code, [`ChangeRequest:${crId}`], crId));
  // what its checks found after a deploy: a fix round of the same change, or development put back without it
  if (run.input.fixChecks === true) return inTurn(run, `The fix round of ${code}`, () => fixRound(run, cr, code, title));
  if (run.input.revertChecks === true) return inTurn(run, `Putting development back without ${code}`, () => revertChange(run, cr, code, title));
  // an analysed request (CHANGE-PROCESS-31.10.md) is built only when approved and on the fast route; one made before the
  // analysis (no Analysis) builds as it always did
  const analysis = parseChangeAnalysis(cr.Analysis);
  if (analysis && analysis.route === "scope") throw new JobFailure("This is a new feature: add it through Scope & success.", "change.scope");
  if (cr.Status === "draft" || cr.Status === "approved") await run.update("ChangeRequest", crId, { Status: "building" });

  await run.step(3, `Building ${code}: ${title}.`);
  let rows = run.p.tickets().filter((t) => t.ChangeRequestId === crId);
  if (rows.length === 0) {
    await run.wait(4);
    const planned = changeTickets(run, cr, analysis);
    // each new ticket's real estimate (engine/estimates.ts): what it adds to this build's time on MADP
    const cal = await readCalibration(run);
    // a ticket on the same subject as an earlier one, or the tests and docs, waits for it; the rest runs side by side
    const deps = changeDependencies(planned.map((t) => t.title));
    const ids: string[] = [];
    let next = run.p.tickets().reduce((mx, t) => Math.max(mx, num(t.Number)), 0);
    const fix = lane === "fix";
    for (const [k, t] of planned.entries()) {
      next += 1;
      const planRef = fix ? (k === 0 ? `fx:${number}:${crId}` : `fx:${number}:${crId}:${k}`) : `cr:${crId}:${k}`;
      const existing = run.p.tickets().find((x) => x.PlanRef === planRef);
      if (existing) {
        ids.push(str(existing.ItemId));
        continue;
      }
      const at = run.iso();
      const id = await run.insert(
        "Ticket",
        {
          Number: next,
          PlanRef: planRef,
          Title: t.title,
          TicketType: fix || lane === "change" ? "fix" : "story",
          FeatureRef: str(cr.FeatureRef),
          StoryRef: "",
          MilestoneId: "",
          AgentRole: plannedRoleOf({ type: fix || lane === "change" ? "fix" : "story" }),
          Column: "planned",
          ...estimateField(cal, fix || lane === "change" ? "fix" : "story"),
          Acceptance: t.acceptance,
          SortOrder: t.sortOrder ?? k,
          Description: t.description ? (fix ? `${code} · ${t.description}` : t.description) : fix ? `${code} · ${str(cr.Description)}` : str(cr.Description),
          IsDone: false,
          Source: fix ? "fix" : "change-request",
          ChangeRequestId: crId,
          EngineJobId: run.id,
          DependsOn: deps[k]!.map((j) => ids[j]!).filter(Boolean),
        },
        `ticket:${planRef}`,
      );
      ids.push(id);
      await run.insert("TicketEvent", { TicketId: id, Kind: "move", FromColumn: "", ToColumn: "planned", AuthorUserId: "", AuthorLabel: "planner", Text: `Created in Planned: ${t.title}.`, At: at, IsAuto: true, EngineJobId: "" }, `ev:${id}:planned`);
    }
    rows = run.p.tickets().filter((t) => t.ChangeRequestId === crId);
    await run.step(8, `Building ${code}: planned ${rows.length === 1 ? "1 ticket" : `${rows.length} tickets`}.`);
  }

  // a feature on an existing product builds one increment now (its tickets only); a change builds all of its tickets
  const inc = analysis?.route === "feature" && analysis.feature ? featureIncrementOf(analysis, crId, rows) : null;
  const what = inc ? `${code} increment ${inc.n} of ${inc.of}` : code;
  if (inc) {
    const name = incrementsOf(analysis!).find((i) => i.n === inc.n)?.title ?? "";
    await run.step(9, `Building ${what}${name ? `: ${name}` : ""} (${inc.rows.length === 1 ? "1 ticket" : `${inc.rows.length} tickets`}).`);
  }
  const depRows = withOpenDeps(run, inc ? inc.rows : rows);
  const tickets = depRows.map((r) => ticketOf(r, run.p.name));
  let official: WorkResult | null = null;
  let texts: TextsOutcome | null = null;
  let tables: DataOutcome | null = null;
  let issues: AfterDeployIssue[] = [];
  let details: AfterDeployDetails = {};
  let checks: AcceptOutcome = NO_CHECKS;
  let releasedUrl: string | undefined;
  let app: OfficialApp | null = null;
  const since = Date.now();
  if (realMode()) {
    const ordered = inTeamOrder(tickets);
    const rowOf = new Map(depRows.map((r) => [str(r.ItemId), r]));
    const inBuild = new Set(depRows.map((r) => str(r.ItemId)));
    app = await ensureApp(run, (p, l) => run.step(p, l));
    const working = ordered.filter((t) => t.column !== "done");
    const feature = inc && analysis ? featureBriefOf(analysis, inc.n) : undefined;
    const open = working.length;
    // the change's own checks on dev run last, after the data tables and texts (official/acceptance.ts)
    const facts = await factRules(run);
    const product = app;
    // a change taken off development after its checks failed is built again knowing what they found
    const lastFound = foundBefore(cr);
    // a person's "known before this change" marks of the change: its checks report them apart
    const known = knownMarks(parseChangeChecks(cr.Checks));
    // parallel streams (streams.ts): with more than one, the lane develops in its own working copies and asks for the
    // product's merge turn right before it lands; otherwise (one stream, or a set-up that cannot) it holds the turn from
    // the start. Either way the merge, the deploy and the checks after it run one build at a time.
    const advice = await refreshStreamsAdvice(run, product.registry);
    const isolated = projectStreams(run.p.project) > 1 && (advice?.cap ?? 1) > 1;
    const turn = mergeTurn(run.projectId, run.id, run.signal);
    const file = turnFile(product.dir, run.id);
    // built and green: it waits for its turn to land, its place in line on the job (the lane meanwhile keeps its work
    // on what landed: pre-rebase); a non-isolated build waits before it starts
    const onWait = (_holder: string, place: number) => void run.say(readyWords(place)).catch(() => undefined);
    const moved = (place: number) => void run.say(readyWords(place)).catch(() => undefined);
    const ask = {
      product: run.p.name,
      label: feature ? `${code}: ${title} (increment ${feature.increment} of ${feature.of}: ${feature.title})` : `${code}: ${title}`,
      goal: `${feature?.goal ? `${feature.goal}\n\n${str(cr.Description)}` : str(cr.Description)}${lastFound}`,
      tickets: ordered.map((t) => buildTicketOf(rowOf.get(t.id)!, run.p)),
      built: run.p.tickets().filter((t) => t.Column === "done" && !inBuild.has(str(t.ItemId))).slice(-40).map((r) => buildTicketOf(r, run.p)),
      later: feature?.later ?? [],
      facts,
      ...(analysis ? { change: { ...changeBriefOf(analysis), ...(feature ? { feature } : {}) } } : {}),
    };
    const stream = isolated ? { turnFile: file, grant: async () => { await turn.grant(onWait, moved); writeGo(file); } } : undefined;
    try {
      if (!isolated) await turn.grant(onWait, moved);
      let lane: Awaited<ReturnType<typeof laneWithChecks>> | null = null;
      for (let attempt = 1; !lane; attempt += 1) {
        removeTurnFile(file);
        try {
          lane = await laneWithChecks(run, product, (noAccept) => runOfficialWork(run, product, ask, inc && analysis?.feature
            // the official feature lane, sized by this increment (tickets x the parts it changes, at most the cap 12)
            ? { kind: "feature", maxSteps: featureMaxSteps(open, analysis.feature.parts), onStep: streamSteps(run, laneMoves(run, ordered, `Building ${what}`)), noAccept, stream }
            : { kind: "change", onStep: streamSteps(run, laneMoves(run, ordered, `Building ${code}`)), noAccept, stream }), { step: (p, l) => run.step(p, l), known });
        } catch (e) {
          if (!(e instanceof MergeConflict)) throw e;
          // it could not land cleanly on what landed meanwhile: nothing was deployed; the turn goes to the next build,
          // and this one goes back to its developers once, on top of the latest development branch
          turn.release();
          run.log(`${what}: could not be merged cleanly (${e.reason}), attempt ${attempt}`);
          if (attempt >= 2) {
            throw new JobFailure(`${what} could not be merged cleanly onto the latest development branch, also when built again on top of it. Nothing was deployed; start its build again.`.slice(0, 300), "madp.merge_conflict");
          }
          await run.step(12, `${what} could not be merged cleanly onto the changes that landed meanwhile: the development team builds it again on top of them.`);
        }
      }
      official = lane.work;
      await finishAll(run, ordered, "Deployed to dev by MADP and smoke-tested.");
      ({ tables, texts, accept: checks, issues, details } = await afterDeploy(run, app, official, working, lane.accept));
    } finally {
      turn.release();
      removeTurnFile(file);
    }
    await run.step(96, `${what}: ${checks.status === "failed" ? "deployed" : "released"} ${version || "the change"} to dev.`);
    releasedUrl = app.url;
  } else {
    const totalSec = Math.min(130, Math.max(55, 35 + 16 * tickets.filter((t) => t.column !== "done").length));
    await work(run, tickets, {
      totalSec,
      line: (done, total, doing) => `Building ${what}: ${done} of ${total} tickets done${doing ? `, ${doing}` : ""}.`,
    });
    await run.step(96, `${what}: releasing ${version || "the change"} to dev.`);
    await run.wait(4);
  }
  const outputs = [`ChangeRequest:${crId}`, ...tickets.map((t) => `Ticket:${t.id}`)];
  if (version) {
    version = deployVersion(run, cr, crId);
    outputs.push(`Release:${await devRelease(run, { version, changeRequestIds: [crId], url: releasedUrl })}`);
    // the change request names the version really deployed (its build may have started from an older row)
    if (str(cr.Version) !== version) await run.update("ChangeRequest", crId, { Version: version });
  }
  // its own checks on dev: recorded on the change; failed, it is on dev but NOT usable, and what happens next is the fix
  // round or the revert the project's policy lets the engine start now, else a person decides
  const failing = app && official ? await recordChecks(run, app, crId, { kind: "build", round: 0, auto: false, baseJobId: "", version, commits: official.commits, checks, sinceMs: since }) : [];
  const red = checks.status === "failed";
  const next = red ? await nextAfterRed(run, crId, checks, version, fixTargets({ failing, failed: checks.failed, diagnosed: [] }, parseChangeChecks(cr.Checks)?.marks)) : null;
  const failingWords = red ? `${checksCount(checks)}` : "";
  if (inc && !inc.final) {
    // an increment of a feature: on dev for people to try; the next build starts from the change request again, or by
    // itself when the project says so and its checks passed (continueNext)
    await run.update("ChangeRequest", crId, { Status: "approved" });
    const continued = await continueNext(run, cr, crId, { checks, next: inc.n + 1, of: inc.of, version });
    await run.notify({
      kind: "release.created",
      to: [str(cr.RequestedByUserId), ...run.p.followers(run.requester)],
      params: { environment: "dev", version: version || "the increment", ...(red ? { changeNumber: `${code} increment ${inc.n}`, state: "not-usable", checks: failingWords, next: next! } : {}) },
      link: `/p/${run.projectId}/build?cr=${number}`,
      eventKey: `factory:change.increment:${run.projectId}:${crId}:${inc.n}`,
    });
    const message = red
      ? `${what} is on dev${version ? ` as ${version}` : ""}, but not usable yet: ${failingWords} test files failed; ${NEXT_WORDS[next!]}.`
      : continued
        ? `${what} released to dev${version ? ` as ${version}` : ""}; ${continued}.`
        : `${what} released to dev${version ? ` as ${version}` : ""}; try it there, then start increment ${inc.n + 1}.`;
    if (official) {
      const full = red ? message : `${message.replace(/\.$/, "")}${official.commits[0] ? `; commit ${official.commits[0].slice(0, 7)}` : ""}.`;
      return officialResult(outputs, withTexts(full, afterDeployNote(tables, checksNote(checks), texts), `${what} is on dev${version ? ` as ${version}` : ""}.`), official, version, tickets, texts, tables, { issues, details, checks, failing });
    }
    return { outputs, message };
  }
  await run.update("ChangeRequest", crId, { Status: "released-dev" });
  await run.notify({
    kind: "change.released",
    to: [str(cr.RequestedByUserId), ...run.p.followers(run.requester)],
    params: { changeNumber: code, ...(version ? { version } : {}), ...(red ? { state: "not-usable", checks: failingWords, next: next! } : {}) },
    link: red ? `/p/${run.projectId}/build?cr=${number}` : `/p/${run.projectId}/delivered?env=dev`,
    eventKey: `factory:change.released:${run.projectId}:${crId}:${run.id}`,
  });
  const message = red
    ? `${code} is on dev${version ? ` as ${version}` : ""}, but not usable yet: ${failingWords} test files failed; ${NEXT_WORDS[next!]}.`
    : version ? `${code} released to dev as ${version}.` : `${code} released to dev.`;
  if (official) {
    const full = red ? message : `${message.replace(/\.$/, "")}${official.commits[0] ? `; commit ${official.commits[0].slice(0, 7)}` : ""}.`;
    return officialResult(outputs, withTexts(full, afterDeployNote(tables, checksNote(checks), texts), `${code} is on dev${version ? ` as ${version}` : ""}.`), official, version, tickets, texts, tables, { issues, details, checks, failing });
  }
  return { outputs, message };
}

// ------------------------------------------------------------------ the next increment by itself (continueIncrements.ts)

/** After an increment of a feature whose own checks passed on development (or every failure is marked known before
 *  this change): when the project says "Continue with the next increment when the checks pass", the next increment of
 *  the same change is asked for now, a queued build that starts by the same stream rules as any other (it follows this
 *  one: the same change). Never when the checks failed or could not judge it, never past the last increment, never for
 *  a change whose automatic next increment a person cancelled. Answers the job line's words ("increment 2 of 3 starts
 *  by itself next (…)"), or "" when nothing was asked for. `open`: false when the increment `next` names has no open
 *  ticket (nothing is left to build). */
async function continueNext(run: JobRun, cr: Row, crId: string, o: { checks: AcceptOutcome; next: number; of: number; version: string; open?: boolean }): Promise<string> {
  if (!continueOn(run.p.project.ContinueIncrements)) return "";
  const jobs = run.p.rows("EngineJob").map((j) => ({ kind: str(j.Kind), status: str(j.Status), inputJson: str(j.InputJson) }));
  const d = continueDecision({
    on: true, checks: o.checks.status, cleared: checksCleared(run.p.row("ChangeRequest", crId)?.Checks, run.id), next: o.open === false ? null : o.next, of: o.of,
    paused: pausedByPerson(jobs, crId),
  });
  if (!d.go) {
    run.log(`the next increment of the change does not start by itself: ${d.why}`);
    return "";
  }
  const version = changeVersionAtStart(str(cr.Lane) as Parameters<typeof changeVersionAtStart>[0], [...versionsHeld(run), ...(o.version ? [o.version] : [])]) ?? "";
  await run.queueJob({
    kind: "change.build",
    input: { projectId: run.projectId, changeRequestId: crId, version, continued: true, afterJobId: run.id },
    // its own key: this build of the change is still active while it asks
    target: { type: "EngineJob", id: run.id },
    requestKey: `job:change.build:continue:${crId}:${d.next}`,
  });
  run.log(`the checks passed: increment ${d.next} of ${d.of} asked for by itself (${version || "no version"})`);
  return continuedWords(d.next, d.of);
}

// ------------------------------------------------------------------ the merge turn (parallel streams, streams.ts)

/** The change a job builds, by its code ("CR-018"), or "" when it names none. */
function codeOfJob(run: JobRun, jobId: string): string {
  const job = jobId ? run.p.row("EngineJob", jobId) : null;
  let crId = "";
  try {
    crId = job ? str((JSON.parse(str(job.InputJson) || "{}") as Record<string, unknown>).changeRequestId) : "";
  } catch {
    /* an unreadable input names no change */
  }
  const cr = crId ? run.p.row("ChangeRequest", crId) : null;
  return cr ? changeCode({ lane: str(cr.Lane), number: num(cr.Number, 1) || 1 }) : "";
}

/** A stream lane's steps: while it brings its work onto what landed meanwhile (pre-rebase) or merges a conflict at its
 *  turn, the job says so in plain words ("Resolving a conflict with CR-018's landed change."); every other step goes to
 *  `inner` (the ticket moves and the build's lines). */
function streamSteps(run: JobRun, inner: (s: LaneStep) => Promise<void>): (s: LaneStep) => Promise<void> {
  return async (s) => {
    const landed = codeOfJob(run, lastLandedOf(run.projectId));
    if (/^conflict[- ]fix/.test(s.name)) {
      await run.say(`Resolving a conflict with ${landed ? `${landed}'s` : "a"} landed change.`);
      return;
    }
    if (/^pre-rebase/.test(s.name)) {
      await run.say(/^FAILED/.test(s.outcome)
        ? `Could not be brought onto ${landed ? `${landed}'s` : "the"} landed change cleanly; it is built again on top of it.`
        : `Brought onto ${landed ? `${landed}'s` : "the"} landed change and checked again; it waits for its turn to land.`);
      return;
    }
    await inner(s);
  };
}

/** The build that holds the merge turn now, in plain words ("CR-003 is landing now"). */
function landingWords(run: JobRun, holder: string): string {
  const job = run.p.row("EngineJob", holder);
  let crId = "";
  try {
    crId = job ? str((JSON.parse(str(job.InputJson) || "{}") as Record<string, unknown>).changeRequestId) : "";
  } catch {
    /* an unreadable input names no change */
  }
  const cr = crId ? run.p.row("ChangeRequest", crId) : null;
  return cr ? `${changeCode({ lane: str(cr.Lane), number: num(cr.Number, 1) || 1 })} is landing now` : "another build is landing now";
}

/** A change job that deploys or checks from its start (the steps after a deploy, a fix round, a revert): in real
 *  builds it holds the product's merge turn for its whole run. */
function inTurn<T>(run: JobRun, what: string, work: () => Promise<T>): Promise<T> {
  if (!realMode()) return work();
  return inMergeTurn({ projectId: run.projectId, jobId: run.id, signal: run.signal, onWait: (holder, place) => run.say(`${what} waits for its turn on development (${landingWords(run, holder)}; ${place === 2 ? "next" : `${ordinal(place)} in line`}).`).catch(() => undefined) }, work);
}

// ------------------------------------------------------------------ what the checks found: versions, fix rounds, reverts
//
// src/domain/changeChecks.ts: a change whose own checks failed after its deploy is on dev but NOT usable there. What
// they found is recorded on the change and on the engine host; then a fix round of the same change (the change, the
// failing checks with their output, the deployed commits, the rule; same gates, deploy and checks; a patch version of
// its own) or, once the rounds did not help, development is put back to the last build whose checks passed (a revert,
// the same deploy path). The engine starts what the project's policy allows (Project.ChecksPolicy); otherwise a person
// decides on the change's page (cr.fixChecks).

const VERSION = /^\d+\.\d+\.\d+$/;

/** Every version a deploy or a build holds now (every release, every change request's, every delivery build's input). */
function versionsHeld(run: JobRun, o: { exceptJob?: string; exceptChange?: string } = {}): string[] {
  return takenVersions({
    releases: run.p.rows("Release").filter((r) => !o.exceptJob || str(r.EngineJobId) !== o.exceptJob).map((r) => str(r.Version)),
    changes: run.p.rows("ChangeRequest").filter((r) => !o.exceptChange || str(r.ItemId) !== o.exceptChange).map((r) => str(r.Version)),
    jobs: run.p.rows("EngineJob").filter((j) => str(j.ItemId) !== o.exceptJob && (j.Kind === "change.build" || j.Kind === "build.run")).map((j) => ({ inputJson: str(j.InputJson) })),
  });
}

/** The version this deploy gets: the one its job was started with (its input; a job queued before jobs carried one:
 *  the change request's), moved to the next free patch when another deploy or build holds it already. A restarted job
 *  finds its own release again. "" when it has none. */
export function deployVersion(run: JobRun, cr: Row, crId: string): string {
  const asked = str(run.input.version);
  const v = VERSION.test(asked) ? asked : VERSION.test(str(cr.Version)) ? str(cr.Version) : "";
  if (!v) return "";
  const own = run.p.releases("dev").find((r) => str(r.EngineJobId) === run.id);
  if (own && VERSION.test(str(own.Version))) return str(own.Version);
  return freeVersion(v, versionsHeld(run, { exceptJob: run.id, exceptChange: crId }));
}

/** The dev release of this deploy: its own row (a restarted job finds it again), never another deploy's. */
export async function devRelease(run: JobRun, o: { version: string; changeRequestIds: string[]; url?: string }): Promise<string> {
  const own = run.p.releases("dev").find((r) => str(r.EngineJobId) === run.id);
  if (own) {
    if (o.url) await run.update("Release", str(own.ItemId), { Url: o.url });
    return str(own.ItemId);
  }
  return run.insert(
    "Release",
    { Environment: "dev", Version: o.version, Url: o.url ?? devUrl(run), Status: "released", ChangeRequestIds: o.changeRequestIds, ReleasedAt: run.iso(), ReleasedByUserId: run.requester, EngineJobId: run.id },
    `release:dev:${o.version}`,
  );
}

/** "6 of 38" test files (or "the test data could not be prepared") (pure). */
function checksCount(a: AcceptOutcome): string {
  return a.failed > 0 && a.files > 0 ? `${a.failed} of ${a.files}` : a.fixtures ? "its test data could not be prepared, so none of its" : "some of its";
}

type NextStep = "fixing" | "reverting" | "you";
const NEXT_WORDS: Record<NextStep, string> = {
  fixing: "the development team is fixing what the checks found",
  reverting: "development is being put back to the last build whose checks passed",
  you: "a person decides how to go on on the change's page",
};

const jobView = (j: Row): ChecksJob => ({ id: str(j.ItemId), kind: str(j.Kind), status: str(j.Status), inputJson: str(j.InputJson), finishedAt: str(j.FinishedAt), createdAt: str(j.CreatedDate) });

/**
 * Records what this deploy's checks found: on the engine host (the failing checks with their output, the deployed
 * commits and repos: failingChecks.ts, for a later fix round or revert) and on the change (ChangeRequest.Checks: names
 * and short reasons for its page and every list). The failing checks come from the acceptance step's own result
 * (AcceptOutcome.checks, verdict "failed"); the report adds each one's output tail for the developers (and is the
 * source for an engine without the result). Checks that could not judge the change are never failing ones. Answers
 * the failing checks (none when they passed, could not run or could not judge).
 */
export async function recordChecks(run: JobRun, app: OfficialApp, crId: string, o: { kind: ChecksRunKind; round: number; auto: boolean; baseJobId: string; version: string; commits: string[]; checks: AcceptOutcome; sinceMs: number; diagnosed?: DiagnosedCheck[] }): Promise<FailingCheck[]> {
  if (o.checks.status === "none") return [];
  const found = o.checks.status === "failed" ? foundChecks(o.checks, failingChecksSince(app, o.sinceMs)) : [];
  // the acceptance step's own result goes with it: a fix round of this build hands it to its lane (failedChecks)
  recordFound(run, app, { at: run.iso(), env: "dev", commits: o.commits, targets: o.checks.targets, checks: found, ...(o.checks.checks.length ? { reported: o.checks.checks } : {}) });
  const failing = found.map(({ repo, name, reason }) => ({ repo, name, reason }));
  const cr = run.p.row("ChangeRequest", crId);
  const status = o.checks.status === "failed" ? "failed" : o.checks.status === "ok" ? "ok" : o.checks.status === "not-judged" ? "not-judged" : "not-run";
  // known before this change: kept apart with its evidence; the diagnosis beside the failing checks it was about
  const known = (o.checks.known ?? []).map((k) => ({ repo: k.repo, name: k.file, reason: k.reason, evidence: k.evidence, by: k.by }));
  const diagnosed = (o.diagnosed ?? []).filter((d) => failing.some((f) => f.name === d.name && (!f.repo || f.repo === d.repo)));
  // the test files that passed (also those a fix round's recheck passed on the deployed commit): a later run of any
  // change shows with them that a check another change left failing passes now (changeChecks.ts checksPassSince)
  const passed = passedFilesOf(o.checks);
  const record = withRun(parseChangeChecks(cr?.Checks), {
    jobId: run.id, kind: o.kind, env: "dev", at: run.iso(), status,
    version: o.version, commits: o.commits, failed: o.checks.failed, files: o.checks.files, fixtures: o.checks.fixtures, failing, round: o.round, auto: o.auto, baseJobId: o.baseJobId,
    known, diagnosed, ...(passed.length ? { passed } : {}),
  });
  await run.update("ChangeRequest", crId, { Checks: serializeChangeChecks(record) });
  return failing;
}

/** The test files an outcome's run passed, by repo and name, each once (pure). */
export function passedFilesOf(a: Pick<AcceptOutcome, "tests">): CheckFile[] {
  const seen = new Set<string>();
  const out: CheckFile[] = [];
  for (const t of a.tests ?? []) {
    const key = `${t.repo}:${t.file}`;
    if (t.verdict !== "ok" || !t.file || seen.has(key)) continue;
    seen.add(key);
    out.push({ repo: t.repo, name: t.file });
  }
  return out.slice(0, MAX_PASSED);
}

/** The failing checks of an outcome: the acceptance step's own (verdict "failed"), each with the output tail and the
 *  reason the report has for the same file; without them (an older engine), the report's (pure). */
export function foundChecks(a: Pick<AcceptOutcome, "checks">, report: FoundCheck[]): FoundCheck[] {
  const own = (a.checks ?? []).filter((c) => c.verdict === "failed");
  if (!own.length) return report;
  return own.map((c) => {
    const r = report.find((x) => x.repo === c.repo && x.name === c.file);
    return { repo: c.repo, name: c.file || (r?.name ?? "the checks"), reason: c.reason || r?.reason || "", output: r?.output ?? "", ...(c.why ? { why: c.why } : {}) };
  });
}

/** After a deploy whose checks failed: the next fix round, or development put back, when the project's policy lets the
 *  engine start it; queued now (it runs right after this job, ActiveKey change.build:<this job>). Else a person
 *  decides. Answers what happens next. */
export async function nextAfterRed(run: JobRun, crId: string, checks: AcceptOutcome, deployed: string, targets?: { failed: number; environment: unknown[] }): Promise<NextStep> {
  const jobs = run.p.rows("EngineJob").map(jobView);
  const me: ChecksJob = { id: run.id, kind: "change.build", status: "running", inputJson: JSON.stringify(run.input) };
  // the failing test files that are the change's and that the last round's diagnosis did not put in the environment
  // (a person's marks and the diagnosis count; the checks' own verdict is unchanged)
  // a round that found nothing to change (the checks that failed were the environment's) is not one of the automatic ones
  const spared = sparedRounds(parseChangeChecks(run.p.row("ChangeRequest", crId)?.Checks));
  const d = afterChecksDecision(jobs, me, targets?.failed ?? checks.failed, checksPolicyOf(run.p.project.ChecksPolicy), targets?.environment.length ?? 0, spared);
  if (d.action === "wait") {
    run.log(`checks after deploy: not usable; a person decides (${d.why})`);
    return "you";
  }
  const version = fixRoundVersion([...versionsHeld(run), ...(deployed ? [deployed] : [])]) ?? "";
  if (d.action === "fix") {
    await run.queueJob({
      kind: "change.build",
      input: fixRoundInput(run.projectId, { changeRequestId: crId, afterJobId: run.id, baseJobId: d.next.baseJobId, round: d.next.round, auto: true, version }),
      target: { type: "EngineJob", id: run.id },
      requestKey: `job:change.build:fix:${crId}:${d.next.baseJobId}:${d.next.round}`,
    });
    run.log(`checks after deploy: not usable; fix round ${d.next.round} of at most ${MAX_AUTO_FIX_ROUNDS} queued (${version})`);
    return "fixing";
  }
  await run.queueJob({
    kind: "change.build",
    input: revertInput(run.projectId, { changeRequestId: crId, afterJobId: run.id, baseJobId: d.baseJobId, auto: true, version }),
    target: { type: "EngineJob", id: run.id },
    requestKey: `job:change.build:revert:${crId}:${d.baseJobId}`,
  });
  run.log(`checks after deploy: still not usable after the automatic fix rounds; putting development back (${version})`);
  return "reverting";
}

/** A person's "known before this change" marks of a change, as the checks take them (`madp accept --known`) (pure). */
function knownMarks(record: ChangeChecks | null): Array<{ repo: string; file: string; reason: string; commit?: string }> {
  return (record?.marks ?? []).map((m: KnownMark) => ({ repo: m.repo, file: m.name, reason: m.reason, ...(m.commit ? { commit: m.commit } : {}) }));
}

/** A fix round's diagnosis of the environment (the engine's madp-fix-round/1 `environment`) as the change's record keeps
 *  it (pure). */
export function diagnosedOf(env: FixEnvironment[] | undefined): DiagnosedCheck[] {
  return (env ?? []).map((e) => ({ repo: e.repo, name: e.file, side: "environment" as const, cause: e.cause, evidence: e.evidence.slice(0, 3) })).filter((d) => d.evidence.length);
}

/** What the checks found the last time the change was on dev and was taken off it again (a revert), for its next build
 *  (pure). */
function foundBefore(cr: Row): string {
  const record = parseChangeChecks(cr.Checks);
  const last = latestRun(record);
  if (!last || last.kind !== "revert" || !last.baseJobId) return "";
  const red = record!.runs.filter((r) => (r.jobId === last.baseJobId || r.baseJobId === last.baseJobId) && r.kind !== "revert" && r.status === "failed").at(-1);
  if (!red?.failing.length) return "";
  return `\n\nThe last build of this change was taken off development again because its own checks there did not pass. Make sure these pass this time:\n${red.failing.map((f) => `- ${f.repo ? `${f.repo}: ` : ""}${f.name}: ${f.reason}`).join("\n")}`;
}

/** The ticket rows a build finished (its OutputRefs), as they stand now. */
function ticketRowsOfJob(run: JobRun, jobId: string): Row[] {
  const job = run.p.row("EngineJob", jobId);
  return strs(job?.OutputRefs)
    .map((r) => /^Ticket:(.+)$/.exec(r)?.[1] ?? "")
    .filter(Boolean)
    .map((id) => run.p.row("Ticket", id))
    .filter((r): r is Row => Boolean(r));
}

/** The tickets a build finished (its OutputRefs), as they stand now. */
function ticketsOfJob(run: JobRun, jobId: string): Tk[] {
  return ticketRowsOfJob(run, jobId).map((r) => ticketOf(r, run.p.name));
}

/** The build(s) a fix round fixes or a revert takes off, as the change's record keeps them (WorkAsk.fixes): their
 *  tickets and, for an increment of a feature, that increment (the newest one their tickets belong to). */
export function buildOfJobs(run: JobRun, analysis: ChangeAnalysis | null, crId: string, jobIds: readonly string[]): { feature?: FeatureBuildBrief; tickets: BuildTicket[] } {
  const rows = [...new Map(jobIds.flatMap((id) => ticketRowsOfJob(run, id)).map((r) => [str(r.ItemId), r])).values()];
  const ns = rows.map((r) => planIndexOf(str(r.PlanRef), crId)).filter((k): k is number => k !== null).map((k) => (analysis ? incrementOfTicket(analysis, k) : 1));
  const feature = analysis?.route === "feature" && analysis.feature && ns.length ? featureBriefOf(analysis, Math.max(...ns)) : undefined;
  return { ...(feature ? { feature } : {}), tickets: rows.map((r) => buildTicketOf(r, run.p)) };
}

/** The status of an increment: is a feature's change between its increments ("approved") or delivered. */
const isIncrement = (cr: Row): boolean => parseChangeAnalysis(cr.Analysis)?.route === "feature" && str(cr.Status) === "approved";

/**
 * A fix round (cr.fixChecks, or queued by the engine after a deploy whose checks failed): the change, the failing
 * checks with their output, the deployed commits and the rule go to the official quick lane; the same gates, deploy,
 * steps after the deploy and checks run. Its own patch version; no status change and no ticket moves (the change's
 * tickets are built; the round's notes go on them). Its checks pass: the change is usable on dev. They fail again: the
 * next round or the revert when the policy allows, else a person decides.
 */
async function fixRound(run: JobRun, cr: Row, code: string, title: string): Promise<KindResult> {
  run.resumeHere();
  const crId = str(cr.ItemId);
  const f = fixRoundOf({ kind: "change.build", inputJson: JSON.stringify(run.input) })!;
  const what = `${code} fix round ${f.round}`;
  if (!realMode()) return { outputs: [`ChangeRequest:${crId}`], message: `Nothing to fix in ${code}: its checks run only on real builds.` };
  await run.step(3, `Fixing what the checks of ${code} found (round ${f.round}).`);
  const app = await ensureApp(run, (p, l) => run.step(p, l));
  const raw = readFound(app, f.afterJobId);
  const record = parseChangeChecks(cr.Checks);
  const marks = record?.marks ?? [];
  const marked = (c: { repo: string; name: string }) => marks.some((m) => m.name === c.name && (!m.repo || !c.repo || m.repo === c.repo));
  // what the checks found: the change's record, else what the acceptance step kept for that build (accept.json); a
  // check a person marked "known before this change" is never a fix round's target
  const recorded = latestRun(record, f.afterJobId)?.failing ?? [];
  const accepted = acceptChecksOf(app, f.afterJobId);
  const all = recorded.length ? recorded
    : accepted.filter((c) => c.verdict === "failed").map((c) => ({ repo: c.repo, name: c.file || "the checks", reason: c.reason }));
  const failing = all.filter((c) => !marked(c));
  const found = raw ? { ...raw, checks: raw.checks.filter((c) => !marked(c)), ...(raw.reported ? { reported: raw.reported.filter((c) => !(c.verdict === "failed" && marked({ repo: c.repo, name: c.file }))) } : {}) } : null;
  if (!found?.checks.length && !failing.length) {
    if (all.length) return { outputs: [`ChangeRequest:${crId}`], message: clip(`Nothing left to fix in ${code}: every check that failed is marked known before this change.`, 200) };
    throw new JobFailure(`What the checks of ${code} found is not known on the engine host any more. Run them again first ("Finish the steps after the deploy"); the fix round can start from what they find.`, "checks.unknown");
  }
  const base = ticketsOfJob(run, f.baseJobId);
  const analysis = parseChangeAnalysis(cr.Analysis);
  const facts = await factRules(run);
  const since = Date.now();
  // the lane starts from what the checks reported (its failed test files are run on dev before and after the fix; a
  // "not judged" check is the environment's, never a fix target); the change's record keeps the build it fixes. An
  // automatic round never targets a check the round before's diagnosis put in the environment with evidence: it goes
  // to the lane as the environment's (with that evidence) and runs again after the deploy, its verdict unchanged
  const before = latestRun(record, f.afterJobId);
  const envFiles = f.auto ? (before?.diagnosed ?? []) : [];
  const isEnv = (c: { repo: string; file: string }) => envFiles.some((d) => d.name === c.file && (!d.repo || d.repo === c.repo));
  const failedChecks = reportedChecks(found, accepted.filter((c) => !(c.verdict === "failed" && marked({ repo: c.repo, name: c.file }))), failing)
    .map((c) => (c.verdict === "failed" && isEnv(c) ? { ...c, verdict: "not-judged" as const, reason: clip(`the diagnosis of the round before puts it in the environment: ${envFiles.find((d) => d.name === c.file)?.cause || envFiles.find((d) => d.name === c.file)?.evidence[0] || "with evidence"} (the checks' verdict: failed)`, 300) } : c));
  const alsoChecks = envFiles.map((d) => `${d.repo}:${d.name}`);
  // the change's earlier commits (its base build, earlier rounds): never "before this change" for the checks' baseline
  const changeCommits = changeCommitsOf(record, f.baseJobId, run.id);
  const lane = await laneWithChecks(run, app, (noAccept) => runOfficialWork(run, app, {
    product: run.p.name,
    label: `${code}: ${title}`,
    goal: str(cr.Description),
    tickets: [],
    built: run.p.tickets().filter((t) => t.ChangeRequestId === crId || t.Column === "done").slice(-40).map((r) => buildTicketOf(r, run.p)),
    later: [],
    facts,
    ...(analysis ? { change: changeBriefOf(analysis) } : {}),
    fix: fixBlock({ round: f.round, env: "dev", found, failing }),
    failedChecks,
    ...(alsoChecks.length ? { alsoChecks } : {}),
    // the commits the build (or round) whose checks failed deployed: the engine's diagnosis sees what they changed
    fixesCommits: [...(found?.commits ?? []), ...(before?.commits ?? [])],
    ...(changeCommits.length ? { changeCommits } : {}),
    fixes: { round: f.round, ...buildOfJobs(run, analysis, crId, [f.baseJobId]) },
  }, { kind: "change", onStep: laneMoves(run, [], `Fixing ${code} (round ${f.round})`), noAccept }), { step: (p, l) => run.step(p, l), changeCommits, known: knownMarks(record) });
  const official = lane.work;
  // the engine found nothing to change: the checks that failed are the environment's; nothing was deployed, so no step
  // after the deploy and no checks run, and a person decides
  if (official.fixLoop?.nothing?.length) return nothingToChange(run, crId, code, what, f, official.fixLoop.nothing);
  const { tables, texts, accept: checks, issues, details } = await afterDeploy(run, app, official, base, lane.accept);
  const fallback = fixRoundVersion(versionsHeld(run, { exceptJob: run.id })) ?? "";
  const version = freeVersion(VERSION.test(f.version) ? f.version : fallback, versionsHeld(run, { exceptJob: run.id, exceptChange: crId }));
  const outputs = [`ChangeRequest:${crId}`, ...base.map((t) => `Ticket:${t.id}`)];
  if (version) {
    outputs.push(`Release:${await devRelease(run, { version, changeRequestIds: [crId], url: app.url })}`);
    await run.update("ChangeRequest", crId, { Version: version });
  }
  // the diagnosis beside the verdict: the failing files it put in the environment with evidence (the verdict stays)
  const diagnosed = diagnosedOf(official.fixLoop?.environment);
  const now = await recordChecks(run, app, crId, { kind: "fix", round: f.round, auto: f.auto, baseJobId: f.baseJobId, version, commits: official.commits, checks, sinceMs: since, diagnosed });
  const red = checks.status === "failed";
  const next = red ? await nextAfterRed(run, crId, checks, version, fixTargets({ failing: now, failed: checks.failed, diagnosed }, marks)) : null;
  const number = num(cr.Number, 1) || 1;
  const final = !isIncrement(cr);
  // the increment works now: its next one starts by itself when the project says so (continueNext)
  const nextInc = !final && analysis?.feature ? featureIncrementOf(analysis, crId, run.p.tickets().filter((t) => t.ChangeRequestId === crId)) : null;
  const continued = nextInc && !red ? await continueNext(run, cr, crId, { checks, next: nextInc.n, of: nextInc.of, version, open: nextInc.rows.some((r) => r.Column !== "done") }) : "";
  if (!red && checks.status === "ok") {
    await run.notify({
      kind: final ? "change.released" : "release.created",
      to: [str(cr.RequestedByUserId), ...run.p.followers(run.requester)],
      params: final ? { changeNumber: code, ...(version ? { version } : {}), state: "fixed" } : { environment: "dev", version: version || "the fix", changeNumber: code, state: "fixed" },
      link: `/p/${run.projectId}/build?cr=${number}`,
      eventKey: `factory:change.fixed:${run.projectId}:${crId}:${run.id}`,
    });
  } else if (red) {
    await run.notify({
      kind: final ? "change.released" : "release.created",
      to: [str(cr.RequestedByUserId), ...run.p.followers(run.requester)],
      params: final ? { changeNumber: code, ...(version ? { version } : {}), state: "not-usable", checks: checksCount(checks), next: next! } : { environment: "dev", version: version || "the fix", changeNumber: code, state: "not-usable", checks: checksCount(checks), next: next! },
      link: `/p/${run.projectId}/build?cr=${number}`,
      eventKey: `factory:change.fixround:${run.projectId}:${crId}:${run.id}`,
    });
  }
  // the engine's fix round with depth: its deploy iterations and the changes its guard did not count as a fix
  const loop = fixLoopWords(official.fixLoop);
  const after = loop ? ` after ${loop}` : "";
  const message = red
    ? `${what} is on dev${version ? ` as ${version}` : ""}, but ${checksCount(checks)} test files still fail${after}; ${NEXT_WORDS[next!]}.`
    : checks.status === "ok"
      ? `${what} is on dev${version ? ` as ${version}` : ""}: its checks pass now (${checks.files} test file${checks.files === 1 ? "" : "s"})${after}${continued ? `; ${continued}` : ""}.`
      : `${what} is on dev${version ? ` as ${version}` : ""}${after}.`;
  return officialResult(outputs, withTexts(message, afterDeployNote(tables, checksNote(checks), texts), `${what} is on dev.`), official, version, base, texts, tables, { issues, details, checks, failing: now });
}

/**
 * A fix round whose engine found nothing to change (fix_round_ops: every check that failed could not judge on the
 * environment, or the diagnosis or the developer put every cause in the environment: a fixture the checks did not
 * prepare, a limit, a service). It changed and deployed nothing: a normal end, never a job failure (PrimaBook CR-007,
 * 09.11.2026: such a round stopped as "the development agent found nothing to change"). The round is kept on the
 * change's record with its reasons and is not one of the automatic rounds (sparedRounds); its job carries
 * NOTHING_DEPLOYED_CODE, so the build it followed keeps its open checks; the people who follow the change are told
 * that a person decides.
 */
async function nothingToChange(run: JobRun, crId: string, code: string, what: string, f: FixRoundInput, reasons: string[]): Promise<KindResult> {
  const cr = run.p.row("ChangeRequest", crId);
  const record = parseChangeChecks(cr?.Checks);
  const followed = latestRun(record, f.afterJobId);
  await run.update("ChangeRequest", crId, {
    Checks: serializeChangeChecks(withRun(record, {
      jobId: run.id, kind: "fix", env: "dev", at: run.iso(), status: "not-run", version: "", commits: [], failed: 0, files: 0, fixtures: false,
      failing: [], round: f.round, auto: f.auto, baseJobId: f.baseJobId, known: [], diagnosed: [], nothing: reasons.slice(0, 6),
    })),
  });
  const final = cr ? !isIncrement(cr) : true;
  const checks = followed && followed.failed > 0 && followed.files > 0 ? `${followed.failed} of ${followed.files}` : "some of its";
  await run.notify({
    kind: final ? "change.released" : "release.created",
    to: [str(cr?.RequestedByUserId), ...run.p.followers(run.requester)],
    params: final ? { changeNumber: code, state: "not-usable", checks, next: "you" } : { environment: "dev", version: "the fix", changeNumber: code, state: "not-usable", checks, next: "you" },
    link: `/p/${run.projectId}/build?cr=${num(cr?.Number, 1) || 1}`,
    eventKey: `factory:change.nothing:${run.projectId}:${crId}:${run.id}`,
  });
  run.log(`${what}: nothing to change, the failing checks are the environment's (${reasons.join("; ")}); a person decides`);
  return { outputs: [`ChangeRequest:${crId}`], message: nothingLine(what, reasons), code: NOTHING_DEPLOYED_CODE };
}

/**
 * Development put back to the last build whose checks passed (revert.ts): the commits of the build whose checks failed
 * first and of its fix rounds are reverted through the official quick lane, then the steps after the deploy and the
 * checks run. Its own patch version (a dev release without the change); the earlier releases of those builds are
 * rolled back; the change goes back to "approved" with the tickets of those builds open again, ready to build again
 * (its next build knows what the checks found). Never staging or production.
 */
async function revertChange(run: JobRun, cr: Row, code: string, title: string): Promise<KindResult> {
  run.resumeHere();
  const crId = str(cr.ItemId);
  const r = revertOf({ kind: "change.build", inputJson: JSON.stringify(run.input) })!;
  if (!realMode()) return { outputs: [`ChangeRequest:${crId}`], message: `Nothing to put back for ${code}: its checks run only on real builds.` };
  await run.step(3, `Putting development back to the last build whose checks passed: taking ${code} off it.`);
  const app = await ensureApp(run, (p, l) => run.step(p, l));
  const jobs = run.p.rows("EngineJob").map(jobView);
  const red = redBuildsOf(jobs, r.baseJobId).map((j) => j.id);
  const record = parseChangeChecks(cr.Checks);
  const commits = [...new Set(red.flatMap((id) => [...(latestRun(record, id)?.commits ?? []), ...(readFound(app, id)?.commits ?? [])]))];
  const plan = commits.length ? await revertPlan(app, commits) : [];
  if (!plan.length) {
    throw new JobFailure(`Development could not be put back by itself: which code ${code} deployed is not known on the engine host any more. A person decides how to go on.`, "checks.revert_unknown");
  }
  const since = Date.now();
  // the change's record keeps its analysis and the build(s) taken off; its round says development was put back
  const analysis = parseChangeAnalysis(cr.Analysis);
  const ask = {
    product: run.p.name, label: `${code}: ${title}`, goal: str(cr.Description), tickets: [], built: [], later: [],
    ...(analysis ? { change: changeBriefOf(analysis) } : {}), fixes: buildOfJobs(run, analysis, crId, red),
  };
  const lane = await laneWithChecks(run, app, (noAccept) => runRevert(run, app, ask, plan, {
    onStep: laneMoves(run, [], `Putting development back without ${code}`), noAccept,
  }), { step: (p, l) => run.step(p, l) });
  const official = lane.work;
  const tickets = [...new Map(red.flatMap((id) => ticketsOfJob(run, id)).map((t) => [t.id, t])).values()];
  const { tables, texts, accept: checks, issues, details } = await afterDeploy(run, app, official, [], lane.accept);
  const version = freeVersion(VERSION.test(r.version) ? r.version : fixRoundVersion(versionsHeld(run, { exceptJob: run.id })) ?? "", versionsHeld(run, { exceptJob: run.id }));
  const outputs = [`ChangeRequest:${crId}`, ...tickets.map((t) => `Ticket:${t.id}`)];
  if (version) outputs.push(`Release:${await devRelease(run, { version, changeRequestIds: [], url: app.url })}`);
  // the releases of the builds taken off dev are rolled back (staging and production never had them)
  for (const rel of run.p.releases("dev")) if (red.includes(str(rel.EngineJobId)) && str(rel.Status) === "released") await run.update("Release", str(rel.ItemId), { Status: "rolled-back" });
  // the change is not on dev any more: approved again, its tickets open, ready to build again
  await run.update("ChangeRequest", crId, { Status: "approved", Version: "" });
  await inParallel(tickets.filter((t) => t.column !== "planned"), 4, async (t) => {
    await moveTicket(run, { tk: t, from: t.column, to: "planned", text: `Taken off development again: its own checks there did not pass. Development is back on ${version || "the last build whose checks passed"}.`, label: "shipper" }, `${t.id}:${t.column}>planned:revert:${run.id}`);
  });
  await recordChecks(run, app, crId, { kind: "revert", round: 0, auto: r.auto, baseJobId: r.baseJobId, version, commits: official.commits, checks: checks.status === "none" ? { ...checks, status: "ok", line: "" } : checks, sinceMs: since });
  const number = num(cr.Number, 1) || 1;
  await run.notify({
    kind: "release.created",
    to: [str(cr.RequestedByUserId), ...run.p.followers(run.requester)],
    params: { environment: "dev", version: version || "the last build", changeNumber: code, state: "reverted" },
    link: `/p/${run.projectId}/build?cr=${number}`,
    eventKey: `factory:change.reverted:${run.projectId}:${crId}:${run.id}`,
  });
  const message = `Development is back on the last build whose checks passed${version ? ` (${version})` : ""}: ${code} was taken off it; it can be built again.`;
  return officialResult(outputs, withTexts(message, afterDeployNote(tables, checksNote(checks), texts), message), official, version, tickets, texts, tables, { issues, details, checks });
}

export const WRITERS: Partial<Record<EngineJobKind, KindWriter>> = {
  "build.run": buildRun,
  "preview.deploy": previewDeploy,
  "change.build": changeBuild,
};
