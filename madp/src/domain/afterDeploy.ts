/**
 * A delivery build (build.run, change.build) whose code is live on dev but whose steps after the deploy did not all
 * finish: the data tables (official/dataTables.ts), the texts (official/uilm.ts) or the change's own checks on the
 * development environment (official/acceptance.ts: the lanes' live acceptance tests, run after the data tables and the
 * texts). The deploy stands and is never undone, so the job still ends as `succeeded`; its ErrorCode names what is left,
 * "after-deploy:<issue>[=<detail>][,<issue>…]", most urgent first (official/afterDeploy.ts writes it). ErrorCode is a
 * field every EngineJob row already has and the page already reads, so no schema change is needed and an older page
 * simply shows the job as done.
 *
 * The page shows one plain line for it and, when running the steps again can finish them, the action "Finish the steps
 * after the deploy" (the delivery op build.retryAfterDeploy): a job of the build's own kind with { afterDeploy: true }
 * that runs only those steps again. Each line says what happens next; none points at a team that would have to dig in
 * a host's files: the checks that did not pass or could not judge the change come with the outcome (AcceptCheck). Every build also retries the data tables and texts an earlier one left open, so a
 * later build that finished them closes them too; a change's own checks are closed only by a later job of that same
 * change or milestone (openAttention).
 *
 * No imports: the server functions bundle this file.
 */

/** What can be left open after a deploy, most urgent first. */
export const AFTER_DEPLOY_ISSUES = [
  "data-exposed", "data-failed", "data-refused", "accept-failed", "accept-not-run", "texts-failed", "texts-held",
] as const;
export type AfterDeployIssue = (typeof AFTER_DEPLOY_ISSUES)[number];

/** A detail of an issue, written into the ErrorCode: for accept-failed "<failed>/<files>" (test files) or "fixtures"
 *  (the test data could not be prepared, so no test ran); for accept-not-run why the checks could not judge the
 *  change although nothing failed: "setup" (a test could not start on the engine host: a file, module or setting it
 *  needs is missing there), "fixture" (a test uses test data the checks' fixtures did not prepare), "service" (a service
 *  of the environment, such as its mail service, refused), "ready" (the
 *  environment was not ready), "limit" (an environment limit such as invitations per hour left no room), "time" (the
 *  step's time ran out); none: they could not run at all. */
export type AfterDeployDetails = Partial<Record<AfterDeployIssue, string>>;

/** One check of a change's own checks on the development environment that did not pass ("failed") or could not judge
 *  the change ("not-judged": a test that could not start, the environment was not ready, a limit, out of time); from
 *  the engine's structured result
 *  (official/acceptance.ts). The reason is short and redacted (no account, password or token). */
export interface AcceptCheck {
  /** The repo key (api, web). */
  repo: string;
  /** The repo-relative test file; the fixtures script for the test data; "" for the step as a whole. */
  file: string;
  verdict: "failed" | "not-judged";
  /** What failed (the first failing check's line), or why it was not judged. */
  reason: string;
  /** Why it ran: "the change's own test", "calls GET /api/x/:id (src/routes/x.ts, which uses src/x.ts)", … */
  why: string;
  /** The environment limit that stopped it, by name ("" when none). */
  limit: string;
}

/** A check that still fails as it did before the change (the engine's baseline: "history"), or that a person marked
 *  "known before this change" ("person"): reported apart, never the change's failure, never a fix round's target. */
export interface AcceptKnown {
  repo: string;
  file: string;
  /** How it fails (the first failing check's line, redacted). */
  reason: string;
  /** Why it counts as known before this change, in words. */
  evidence: string;
  by: "history" | "person";
  why: string;
}

/** One known check in a line: "test/x.mjs (api) still fails as before this change: FAIL … (failed the same way before
 *  this change (on abc…))" (pure). */
export function acceptKnownLine(k: AcceptKnown): string {
  return `${k.file}${k.repo ? ` (${k.repo})` : ""} still fails as before this change${k.reason ? `: ${k.reason}` : ""}${k.evidence ? ` (${k.evidence})` : ""}`;
}

/** One check in a line: "test/x.mjs (api) did not pass: FAIL … (selected: calls GET /api/x (src/routes/x.ts))" (pure). */
export function acceptCheckLine(c: AcceptCheck): string {
  const what = c.file ? `${c.file}${c.repo ? ` (${c.repo})` : ""}` : `The checks${c.repo ? ` of ${c.repo}` : ""}`;
  const verb = c.verdict === "failed" ? "did not pass" : "could not judge the change";
  return `${what} ${verb}${c.reason ? `: ${c.reason}` : ""}${c.why ? ` (selected: ${c.why})` : ""}`;
}

/** The job kinds that deploy and then run the steps after the deploy. */
export const AFTER_DEPLOY_KINDS: readonly string[] = ["build.run", "change.build"];

/** The ErrorCode prefix of a succeeded job with steps left after its deploy. */
export const AFTER_DEPLOY_CODE_PREFIX = "after-deploy:";

/** The line on the tickets and the first one in the job's message whenever a new table may still be open (also
 *  dataTables.ts EXPOSED_LINE). */
export const EXPOSED_LINE = "A new data table may be readable by anyone until its access rules are deployed: keep real data out of it until then. \"Finish the steps after the deploy\" deploys the rules again.";

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

const FINISH = '"Finish the steps after the deploy"';

/** What the checks of a deploy found, as a fact (no next step): "Its own checks on the development environment did
 *  not pass: 6 of 38 test files failed." (pure). */
export function acceptFailedFact(detail?: string): string {
  const m = /^(\d{1,4})\/(\d{1,4})$/.exec(detail ?? "");
  const why = m ? `: ${m[1]} of ${plural(Number(m[2]), "test file")} failed`
    : detail === "fixtures" ? ": the test data could not be prepared, so no test ran" : "";
  return `Its own checks on the development environment did not pass${why}.`;
}

/** What happens next after a build of this kind whose checks did not pass, and who acts. It is not usable there yet
 *  (never shown as delivered): a change goes back to the development team as a fix round of the same change
 *  (src/domain/changeChecks.ts); a milestone's build gets what does not work as feedback; test data that could not be
 *  prepared is fixed first, then the checks run again (pure). */
export function acceptNextStep(kind?: string, detail?: string): string {
  if (detail === "fixtures") return `It is not usable there yet: once the test data or the test accounts are fixed, ${FINISH} runs the checks again.`;
  return kind === "build.run"
    ? `It is not usable there yet: send what does not work to the development team as feedback on the milestone; after the fix, ${FINISH} runs the checks again.`
    : "It is not usable there yet: the development team fixes what the checks found in a fix round of the change.";
}

/** The line of a build's own checks on the development environment that did not pass: the fact, then what happens
 *  next and who acts (pure). */
export function acceptFailedLine(detail?: string, kind?: string): string {
  return `${acceptFailedFact(detail)} ${acceptNextStep(kind, detail)}`;
}

/** The line of a change's own checks that could not run, or could not judge the change although nothing failed (the
 *  detail says why), and what happens next (pure). */
export function acceptNotRunLine(detail?: string): string {
  if (detail === "setup") return `Its own checks on the development environment could not judge the change: some of its tests could not start on the engine host (a file, module or setting they need is missing there). Nothing failed; once the product's test setup there is complete, ${FINISH} runs them again.`;
  if (detail === "fixture") return `Its own checks on the development environment could not judge the change: some of its tests use test data the checks did not prepare (a workspace or record they need was not there). Nothing failed; once the test data covers them, ${FINISH} runs them again.`;
  if (detail === "service") return `Its own checks on the development environment could not judge the change: a service of the environment (such as its mail service) refused. Nothing failed; once it works again, ${FINISH} runs them again.`;
  if (detail === "ready") return `Its own checks on the development environment could not judge the change: the environment was not ready yet. Nothing failed; ${FINISH} runs them again.`;
  if (detail === "limit") return `Its own checks on the development environment could not judge the change: a limit of the environment (such as invitations per hour) left no room. Nothing failed; ${FINISH} runs the rest once the limit allows.`;
  if (detail === "time") return `Its own checks on the development environment ran out of time before all of them ran. Nothing failed; ${FINISH} runs the rest.`;
  return `Its own checks on the development environment could not run, so the change is not checked yet. ${FINISH} tries them again; if they still cannot run, the product's test setup on the engine host needs a fix.`;
}

/** The plain line people read for each issue (accept-failed and accept-not-run with their detail: acceptFailedLine,
 *  acceptNotRunLine). */
export const AFTER_DEPLOY_LINE: Readonly<Record<AfterDeployIssue, string>> = {
  "data-exposed": EXPOSED_LINE,
  "data-failed": "The new data tables did not reach Blocks yet, so new screens may not save until they do.",
  "data-refused": "A change to existing data fields waits for an engineer to apply it by hand; until then new screens may not save.",
  "accept-failed": acceptFailedLine(),
  "accept-not-run": acceptNotRunLine(),
  "texts-failed": "The new texts are not synced yet, so the app may still show its old words until they are.",
  "texts-held": "The new texts are held back (texts edited in the portal, or text problems in the change), so the app may still show its old words. They sync once the portal edits are taken into the product or the change's texts are fixed; the next build syncs them too.",
};

/** A few words for an area that is open too, after the most urgent line. */
const ALSO: Readonly<Record<AfterDeployIssue, string>> = {
  "data-exposed": "A new data table may still be open too.",
  "data-failed": "The new data tables are not on Blocks yet either.",
  "data-refused": "A change to existing data fields waits for an engineer too.",
  "accept-failed": "Its own checks on the development environment did not pass either.",
  "accept-not-run": "Its own checks on the development environment did not finish either.",
  "texts-failed": "The new texts are not synced yet either.",
  "texts-held": "The new texts are held back too.",
};

/** Running the steps again can finish these; the others wait for a person (an engineer, a portal pull, a fix). A
 *  change's own checks run again after the data tables and the texts: after a fix, once the environment is ready or
 *  its limit allows, or once the test data or accounts are fixed; checks that failed are fixed by a fix round
 *  (src/domain/changeChecks.ts). */
const RETRYABLE: ReadonlySet<AfterDeployIssue> = new Set(["data-exposed", "data-failed", "accept-failed", "accept-not-run", "texts-failed"]);

const isIssue = (x: string): x is AfterDeployIssue => (AFTER_DEPLOY_ISSUES as readonly string[]).includes(x);
type Area = "data" | "accept" | "texts";
const area = (i: AfterDeployIssue): Area => (i.startsWith("data-") ? "data" : i.startsWith("accept-") ? "accept" : "texts");
const DETAIL = /^[a-z0-9/]{1,20}$/;

/** The issues in their order, each once (pure). */
export function orderIssues(issues: Iterable<AfterDeployIssue>): AfterDeployIssue[] {
  const set = new Set(issues);
  return AFTER_DEPLOY_ISSUES.filter((i) => set.has(i));
}

/** The ErrorCode of a job with these issues (and their details); "" when there are none (pure). */
export function afterDeployCode(issues: Iterable<AfterDeployIssue>, details: AfterDeployDetails = {}): string {
  const list = orderIssues(issues);
  const token = (i: AfterDeployIssue) => (details[i] && DETAIL.test(details[i]!) ? `${i}=${details[i]}` : i);
  return list.length ? `${AFTER_DEPLOY_CODE_PREFIX}${list.map(token).join(",")}` : "";
}

function tokensOf(code: unknown): Array<[AfterDeployIssue, string]> {
  if (typeof code !== "string" || !code.startsWith(AFTER_DEPLOY_CODE_PREFIX)) return [];
  const out: Array<[AfterDeployIssue, string]> = [];
  for (const raw of code.slice(AFTER_DEPLOY_CODE_PREFIX.length).split(",")) {
    const [name, detail = ""] = raw.trim().split("=", 2) as [string, string?];
    if (isIssue(name)) out.push([name, DETAIL.test(detail ?? "") ? detail ?? "" : ""]);
  }
  return out;
}

/** The issues an ErrorCode names; [] for any other code (pure). */
export function afterDeployIssues(code: unknown): AfterDeployIssue[] {
  return orderIssues(tokensOf(code).map(([i]) => i));
}

/** The details an ErrorCode carries (pure). */
export function afterDeployDetails(code: unknown): AfterDeployDetails {
  const out: AfterDeployDetails = {};
  for (const [i, d] of tokensOf(code)) if (d) out[i] = d;
  return out;
}

/** What a build left open after its deploy, for the page. */
export interface AfterDeployAttention {
  issues: AfterDeployIssue[];
  details: AfterDeployDetails;
  /** The most urgent one. */
  top: AfterDeployIssue;
  /** A new data table may be open: it comes first, everywhere. */
  security: boolean;
  /** Its own checks did not pass: it is on the environment, but NOT usable there yet (never shown as delivered). */
  broken: boolean;
  /** One plain line: the most urgent issue, then each other open area in a few words. */
  line: string;
  /** Running the steps again can finish it ("Finish the steps after the deploy"); false: it waits for a person. */
  retry: boolean;
}

const lineOf = (i: AfterDeployIssue, details: AfterDeployDetails, kind?: string): string =>
  i === "accept-failed" ? acceptFailedLine(details[i], kind) : i === "accept-not-run" ? acceptNotRunLine(details[i]) : AFTER_DEPLOY_LINE[i];

/** The attention of a list of issues; null when there are none (pure). `kind`: the build's job kind, for what happens
 *  next after checks that failed (acceptNextStep). */
export function attentionOf(issues: Iterable<AfterDeployIssue>, details: AfterDeployDetails = {}, kind?: string): AfterDeployAttention | null {
  const list = orderIssues(issues);
  const top = list[0];
  if (!top) return null;
  const others: string[] = [];
  const seen = new Set<Area>([area(top)]);
  for (const i of list) {
    if (seen.has(area(i))) continue;
    seen.add(area(i));
    others.push(ALSO[i]);
  }
  const kept: AfterDeployDetails = {};
  for (const i of list) if (details[i]) kept[i] = details[i];
  return {
    issues: list,
    details: kept,
    top,
    security: top === "data-exposed",
    broken: list.includes("accept-failed"),
    line: [lineOf(top, details, kind), ...others].join(" "),
    retry: list.some((i) => RETRYABLE.has(i)),
  };
}

/** The job's own attention: a succeeded build.run or change.build with an after-deploy ErrorCode; else null (pure). */
export function jobAttention(job: { kind: string; status: string; errorCode?: string | null } | null | undefined): AfterDeployAttention | null {
  if (!job || job.status !== "succeeded" || !AFTER_DEPLOY_KINDS.includes(job.kind)) return null;
  return attentionOf(afterDeployIssues(job.errorCode), afterDeployDetails(job.errorCode), job.kind);
}

function inputOf(inputJson: string | null | undefined): Record<string, unknown> {
  if (!inputJson) return {};
  try {
    const v = JSON.parse(inputJson) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** True for a job that only runs the steps after an earlier deploy again (build.retryAfterDeploy) (pure). */
export function isAfterDeployRetry(job: { inputJson?: string | null } | null | undefined): boolean {
  return inputOf(job?.inputJson).afterDeploy === true;
}

/** The record a delivery build is for, from its input: the milestone of a build.run, the change request of a
 *  change.build; "" when it names none (pure). */
export function deliveryTargetOf(job: { kind: string; inputJson?: string | null }): string {
  const input = inputOf(job.inputJson);
  const id = job.kind === "build.run" ? input.milestoneId : job.kind === "change.build" ? input.changeRequestId : undefined;
  return typeof id === "string" ? id : "";
}

/** The input of the job that finishes the steps after the deploy of `job` (build.retryAfterDeploy): the same kind and
 *  target, { afterDeploy: true, afterJobId } (pure). */
export function afterDeployRetryInput(job: { id: string; kind: string; inputJson?: string | null }, projectId: string): Record<string, unknown> {
  const target = deliveryTargetOf(job);
  const key = job.kind === "build.run" ? "milestoneId" : "changeRequestId";
  return { projectId, [key]: target, afterDeploy: true, afterJobId: job.id };
}

/** The fields of a job these rules read (the web's EngineJob has them; an op maps its rows). */
export interface AfterDeployJob {
  id: string;
  kind: string;
  status: string;
  errorCode?: string | null;
  /** When it finished: the steps after a deploy ran last in the build that finished last. */
  finishedAt?: string | null;
}

const at = (iso: string | null | undefined): number => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : -Infinity;
};

/** The ErrorCode of a delivery job that succeeded without deploying anything: a fix round that found nothing to change
 *  because the checks that failed are the environment's (src/domain/changeChecks.ts). It is no delivery: the build it
 *  followed keeps what it left open, and a person decides there. */
export const NOTHING_DEPLOYED_CODE = "nothing-deployed";

/** True for a delivery job that succeeded without deploying anything (NOTHING_DEPLOYED_CODE) (pure). */
export const deployedNothing = (job: Pick<AfterDeployJob, "status" | "errorCode">): boolean => job.status === "succeeded" && job.errorCode === NOTHING_DEPLOYED_CODE;

/** The newest succeeded build.run or change.build of a list (by when it finished), optionally only those `mine` keeps
 *  (pure). Over the whole project (a retry of the steps after a deploy counts): every such build ran the steps after
 *  its deploy again for whatever was still open, so it says what is open now. A job that deployed nothing (a fix round
 *  that found nothing to change) is none. */
export function newestDelivered<J extends AfterDeployJob>(jobs: readonly J[], mine?: (j: J) => boolean): J | null {
  let best: J | null = null;
  for (const j of jobs) {
    if (j.status !== "succeeded" || !AFTER_DEPLOY_KINDS.includes(j.kind) || deployedNothing(j) || (mine && !mine(j))) continue;
    if (!best || at(j.finishedAt) > at(best.finishedAt)) best = j;
  }
  return best;
}

/**
 * What is still open after the deploy of a change request's or a milestone's build (`target`: its newest SUCCEEDED
 * build, so a retry that stopped leaves the earlier attention in place): the data tables and texts its build left open
 * that the project's newest delivered build (`latest`, newestDelivered) still has open, in that build's words (a later
 * build that finished them closes them here too), and its own checks on the development environment as it left them
 * (only a later job of the same target, a retry, closes those); null when nothing is open (pure).
 */
export function openAttention(target: AfterDeployJob | null | undefined, latest: AfterDeployJob | null | undefined): AfterDeployAttention | null {
  const own = jobAttention(target);
  if (!own || !target) return null;
  if (!latest || latest.id === target.id || at(latest.finishedAt) <= at(target.finishedAt)) return own;
  // the data tables and the texts: as the newest delivered build of the project left them (it retried them all)
  const code = latest.status === "succeeded" ? latest.errorCode : "";
  const now = afterDeployIssues(code);
  const areas = new Set(own.issues.map(area));
  const shared = now.filter((i) => area(i) !== "accept" && areas.has(area(i)));
  // a change's own checks test that change only: another build's checks never close them
  const mine = own.issues.filter((i) => area(i) === "accept");
  const mineDetails = Object.fromEntries(Object.entries(own.details).filter(([i]) => area(i as AfterDeployIssue) === "accept"));
  return attentionOf([...shared, ...mine], { ...afterDeployDetails(code), ...mineDetails }, target.kind);
}

/**
 * True when the build that deployed a release left its own checks failing there (a later run of the same checks that
 * passed, "Finish the steps after the deploy", closes it): the release is on its environment, but NOT usable there, so
 * it is never shown as delivered and never promoted (pure). A release taken off again (Status "rolled-back") or one
 * without a known build is not.
 */
export function releaseBroken(
  release: { engineJobId?: string | null; status?: string | null },
  jobs: readonly (AfterDeployJob & { inputJson?: string | null })[],
): boolean {
  if (!release.engineJobId || release.status === "rolled-back") return false;
  const job = jobs.find((j) => j.id === release.engineJobId);
  if (!job) return false;
  const again = jobs.filter((j) => isAfterDeployRetry(j) && inputOf(j.inputJson).afterJobId === job.id);
  return jobAttention(newestDelivered([job, ...again]))?.broken ?? false;
}

/** The change requests whose newest delivered build left their own checks failing (its code is on development, but the
 *  change is not usable there), each with that build's job id (pure). `cleared(changeId, jobId)`: every check that
 *  failed in that build is marked "known before this change" on the change (src/domain/changeChecks.ts checksCleared):
 *  then it is not the change's failure and does not count. */
export function changesNotUsable(jobs: readonly (AfterDeployJob & { inputJson?: string | null })[], cleared?: (changeId: string, jobId: string) => boolean): Map<string, string> {
  const latest = newestDelivered(jobs);
  const out = new Map<string, string>();
  const targets = new Set(jobs.filter((j) => j.kind === "change.build").map((j) => deliveryTargetOf(j)).filter(Boolean));
  for (const id of targets) {
    const own = newestDelivered(jobs, (j) => j.kind === "change.build" && deliveryTargetOf(j) === id);
    if (own && openAttention(own, latest)?.broken && !cleared?.(id, own.id)) out.set(id, own.id);
  }
  return out;
}

/** A change that is not usable on development blocks the promotion of every version that carries its code: a version
 *  at or above the one its broken build deployed ("" when that build has no release: every version). Answers the first
 *  such change request's id, or null (pure). */
export function promotionBlockedBy(
  version: string,
  notUsable: ReadonlyMap<string, string>,
  releases: readonly { version: string; engineJobId?: string | null }[],
  compare: (a: string, b: string) => number,
): string | null {
  for (const [crId, jobId] of notUsable) {
    const rel = releases.find((r) => r.engineJobId === jobId);
    if (!rel || compare(version, rel.version) >= 0) return crId;
  }
  return null;
}
