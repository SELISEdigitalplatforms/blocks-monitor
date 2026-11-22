// The steps after a deploy, and the build's honest outcome. After every successful build or change lane the code is
// live on dev, and the steps follow: the new data tables (dataTables.ts), then the texts (uilm.ts), then, for a product
// whose registry checks a change on dev, the change's own live tests (acceptance.ts: after the tables and texts, which
// the tests may need). A build is done only when all of them finished. So:
//
//   1. each step that stopped for a reason a second run can fix is run once more right away, inside the job: the data
//      tables when they "failed" (the security path, `exposed`, already ran its apply twice and checked the rules
//      twice in dataTables.ts, so it is not run a third time; a refusal waits for an engineer), the texts when their
//      sync "failed" (held back for portal edits or for problems the change brought in waits for a person);
//      The change's own checks are not run twice (a failed test is the change's, not a hiccup);
//   2. what is still open then is the job's attention (src/domain/afterDeploy.ts): a new table that may be open (top
//      priority), data tables that did not reach Blocks or wait for an engineer, the change's own checks that did not
//      pass or could not run, texts not synced or held back, also
//      when an EARLIER build left them open (the records still list them: data-sync.json "exposed" and a refusal it
//      keeps, uilm.json "pending" is retried by every sync). The job still succeeds (the deploy stands); its ErrorCode
//      names the issues (driver.ts) and the page shows one plain line and "Finish the steps after the deploy".
//
// The data tables' and the texts' own lines stay as they were on the tickets and in the job's message.
import { orderIssues, type AfterDeployDetails, type AfterDeployIssue } from "../../../../src/domain/afterDeploy";
import { NO_CHECKS, acceptDetails, acceptIssues, type AcceptOutcome } from "./acceptance.ts";
import type { DataOutcome } from "./dataTables.ts";
import type { TextsOutcome } from "./uilm.ts";

/** The data tables' issues after their sync (pure). */
export function dataIssues(t: DataOutcome): AfterDeployIssue[] {
  const out: AfterDeployIssue[] = [];
  if (t.status === "exposed" || (t.openTables?.length ?? 0) > 0) out.push("data-exposed");
  if (t.status === "failed") out.push("data-failed");
  if (t.status === "refused" || (t.waiting?.length ?? 0) > 0) out.push("data-refused");
  return orderIssues(out);
}

/** The texts' issues after their sync (pure). */
export function textsIssues(t: TextsOutcome): AfterDeployIssue[] {
  if (t.status === "portal-edits") return ["texts-held"];
  if (t.status === "failed") return t.problems?.length ? ["texts-held"] : ["texts-failed"];
  return [];
}

/** A data sync a second run can finish: it failed (not the security path, which retried already, nor a refusal). */
export const retriesData = (t: DataOutcome): boolean => t.status === "failed";
/** A texts sync a second run can finish: it failed for another reason than problems the change brought in. */
export const retriesTexts = (t: TextsOutcome): boolean => t.status === "failed" && !t.problems?.length;

export interface AfterDeploySteps {
  /** One run of the data tables' sync (syncDataTables). */
  data(): Promise<DataOutcome>;
  /** One run of the texts' sync (syncTexts). */
  texts(): Promise<TextsOutcome>;
  /** The change's own checks on dev (runAcceptance, or what the lane's own checks said); absent: the product has none. */
  accept?(): Promise<AcceptOutcome>;
  /** The engine log line (the job's log). */
  log(line: string): void;
  /** The final outcome of a step on the build's tickets (a note), once per step. */
  note?(t: { status: string; line: string }, key: "data" | "texts" | "accept"): Promise<void>;
}

export interface AfterDeployResult {
  tables: DataOutcome;
  texts: TextsOutcome;
  accept: AcceptOutcome;
  /** What is still open after the deploy, most urgent first; [] when everything finished. */
  issues: AfterDeployIssue[];
  /** Their details for the job's ErrorCode (the checks' failed test files). */
  details: AfterDeployDetails;
}

/** The steps after a deploy, in order (the new API code needs its tables first), each retried once when that can help;
 *  answers their final outcomes and what is still open. Never throws for a step's problem (a stopped job still
 *  stops). */
export async function runAfterDeploy(s: AfterDeploySteps): Promise<AfterDeployResult> {
  let tables = await s.data();
  if (retriesData(tables)) {
    s.log("after deploy: the data tables did not reach Blocks; trying once more now");
    tables = await s.data();
  }
  if (s.note) await s.note(tables, "data");
  let texts = await s.texts();
  if (retriesTexts(texts)) {
    s.log("after deploy: the texts' sync did not go through; trying once more now");
    texts = await s.texts();
  }
  if (s.note) await s.note(texts, "texts");
  // last: the change's own checks on dev, which may need the new tables and texts
  const accept = s.accept ? await s.accept() : NO_CHECKS;
  if (s.note && accept.status !== "none") await s.note(accept, "accept");
  const issues = orderIssues([...dataIssues(tables), ...acceptIssues(accept), ...textsIssues(texts)]);
  if (issues.length) s.log(`after deploy: not finished: ${issues.join(", ")}; the job succeeds with them as its ErrorCode`);
  return { tables, texts, accept, issues, details: acceptDetails(accept) };
}
