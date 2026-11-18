/** The changes that need attention on the Release page, in ONE place (09.11.2026, the owner: "if there are more not
 *  usable like this, it cannot appear in a list like this; it needs a separate UI, managing this kind of information,
 *  small space"). Instead of one full-width notice per change, the page shows one chip "Needs attention · N" in its
 *  status strip, and a right side panel lists each change in one row: its code and title, its state in plain words,
 *  the version, and the one next action. Pure: read from the change requests, their jobs and their checks records,
 *  with the same rules as every change page (changeChecksUi.ts, afterDeployUi.ts, changeFlow.ts buildLost).
 *
 *   checks      its own checks fail on development: not usable (also while a fix round or the revert runs)
 *   unfinished  its code is on development, but the steps after the deploy are not finished (checks that could not
 *               judge it, data tables, texts)
 *   lost        it reads "building", but no build of its own ever reached the development team
 *   passed      its own checks failed, but each failing check passes since on a later version: usable; listed for
 *               the record, never counted as needing attention
 */
import type { DeliveryChangeRequest } from "@/madp/blocks/delivery/types";
import type { EngineJob } from "@/madp/blocks/engine/types";
import { latestJobFor } from "@/madp/blocks/delivery/hooks";
import { changeCode } from "@/madp/domain/delivery";
import { checksSettled, fileVerdicts, type ChecksPolicy } from "@/madp/domain/changeChecks";
import { analysisOf, changeStage, decisionOf } from "@/madp/components/changes/changeFlow";
import { openAfterDeploy } from "@/madp/components/build/afterDeployUi";
import { changeChecksState } from "@/madp/components/build/changeChecksUi";
import { t } from "@/madp/i18n";

export type AttentionGroup = "checks" | "unfinished" | "lost" | "passed";

/** The one next action of a row: an op the panel runs (fix, recheck, start) or the change's page (where the action
 *  needs its context: a reason for "Known before this change", the confirmation of "Put development back"). */
export type AttentionAction =
  | { kind: "fix"; label: string }
  | { kind: "recheck"; label: string; jobId: string }
  | { kind: "finish"; label: string; jobId: string }
  | { kind: "start"; label: string }
  | { kind: "known"; label: string }
  | { kind: "revert"; label: string }
  | { kind: "open"; label: string };

/** The action words, in the current language: "Fix what the checks found". */
export function actionLabel(kind: AttentionAction["kind"]): string {
  switch (kind) {
    case "fix": return t("build.release.attention.action.fix", "Fix what the checks found");
    case "recheck": return t("build.release.attention.action.recheck", "Run the checks again");
    case "finish": return t("build.release.attention.action.finish", "Finish the steps after the deploy");
    case "start": return t("build.release.attention.action.start", "Start the build again");
    case "known": return t("build.release.attention.action.known", "Known before this change");
    case "revert": return t("build.release.attention.action.revert", "Put development back");
    default: return t("build.release.attention.action.open", "Open the change");
  }
}

export interface AttentionItem {
  changeId: string;
  number: number;
  code: string;
  title: string;
  group: AttentionGroup;
  /** Its state in plain words: "Checks fail on development (1 of 3)". */
  state: string;
  /** The version its build deployed ("" when none is known). */
  version: string;
  action: AttentionAction;
  /** The change's page. */
  href: string;
}

/** A group's name on the panel's tabs, in the current language. */
export function groupLabel(g: AttentionGroup): string {
  switch (g) {
    case "checks": return t("build.release.attention.group.checks", "Checks fail");
    case "unfinished": return t("build.release.attention.group.unfinished", "Not finished");
    case "lost": return t("build.release.attention.group.lost", "Not started");
    default: return t("build.release.attention.group.passed", "Pass since");
  }
}

/** The groups that need attention (counted on the chip); "passed" is listed, never counted. */
export const NEEDS_ATTENTION: readonly AttentionGroup[] = ["checks", "unfinished", "lost"];


export interface AttentionInput {
  projectId: string;
  changes: readonly DeliveryChangeRequest[];
  jobs: readonly EngineJob[];
  policy: ChecksPolicy;
  /** The time now (changeFlow.ts buildLost). */
  now: number;
  /** Whether the person may run builds (build.run): without it every action opens the change. */
  canRun: boolean;
}

/** Every change that needs attention, and those whose failing checks pass since, in change order (newest first) (pure). */
export function attentionItems(i: AttentionInput): AttentionItem[] {
  const verdicts = fileVerdicts(i.changes);
  const settled = checksSettled(i.changes);
  const codeOf = (id: string) => {
    const c = i.changes.find((x) => x.id === id);
    return c ? changeCode(c) : "";
  };
  const out: AttentionItem[] = [];
  const OPEN: AttentionAction = { kind: "open", label: actionLabel("open") };
  for (const cr of [...i.changes].sort((a, b) => b.number - a.number)) {
    const analysis = analysisOf(cr);
    const newestBuild = latestJobFor(i.jobs, "change.build", { changeRequestId: cr.id });
    const stage = analysis ? changeStage(cr.status, analysis, decisionOf(cr), newestBuild, null, { updatedAt: cr.updatedAt ?? null, now: i.now }) : null;
    const base = { changeId: cr.id, number: cr.number, code: changeCode(cr), title: cr.title, href: `/p/${i.projectId}/build?cr=${cr.number}` };
    const may = (a: AttentionAction): AttentionAction => (i.canRun ? a : OPEN);

    if (stage === "buildLost") {
      out.push({ ...base, group: "lost", state: t("build.release.attention.state.lost", "Build requested but not picked up"), version: cr.version ?? "", action: may({ kind: "start", label: actionLabel("start") }) });
      continue;
    }
    // only a change whose code is on development (released, or an increment between builds) has checks there
    const onDev = stage === "released" || stage === "approved" || (!analysis && cr.status !== "draft");
    if (!onDev) continue;
    const checks = changeChecksState(cr, i.jobs, i.policy, verdicts);
    const version = checks.version || cr.version || "";
    if (checks.next?.who === "team") {
      const state = checks.next.what === "fixing"
        ? t("build.release.attention.state.fixing", "Checks fail on development; the development team is fixing them (round {round})", { round: checks.next.round })
        : t("build.release.attention.state.reverting", "Checks fail on development; development is being put back without it");
      out.push({ ...base, group: "checks", state, version, action: OPEN });
      continue;
    }
    if (checks.broken) {
      const state = checks.fixtures ? t("build.release.attention.state.fixtures", "Checks could not run on development: their test data could not be prepared")
        : checks.failed > 0 && checks.files > 0
          ? t("build.release.attention.state.failCount", "Checks fail on development ({failed} of {files})", { failed: checks.failed, files: checks.files })
          : t("build.release.attention.state.fail", "Checks fail on development");
      const open = openAfterDeploy(i.jobs, { kind: "change.build", id: cr.id, checks: cr.checks });
      const why = checks.next?.who === "you" ? checks.next.why : null;
      // the failing checks are not named on its record (a run from before they were): only running them again tells
      const action: AttentionAction = !checks.failing.length && open?.attention.retry && !open.finishing && checks.job
        ? { kind: "recheck", label: actionLabel("recheck"), jobId: checks.job.id }
        : why === "rounds-used" || why === "person-started" ? { kind: "revert", label: actionLabel("revert") }
          : why === "environment" || why === "nothing" ? { kind: "known", label: actionLabel("known") }
            : { kind: "fix", label: actionLabel("fix") };
      out.push({ ...base, group: "checks", state, version, action: may(action) });
      continue;
    }
    if (checks.passSince) {
      const by = codeOf(checks.passSince.changeId);
      const since = checks.passSince.version || t("build.release.attention.state.laterVersion", "a later version");
      const state = by && by !== base.code
        ? t("build.release.attention.state.passSinceAfter", "Superseded: its checks pass since {since} (after {by})", { since, by })
        : t("build.release.attention.state.passSince", "Superseded: its checks pass since {since}", { since });
      out.push({ ...base, group: "passed", state, version, action: OPEN });
      continue;
    }
    const open = openAfterDeploy(i.jobs, { kind: "change.build", id: cr.id, checks: cr.checks, settled });
    if (open && !open.attention.broken) {
      const a = open.attention;
      const state = open.finishing ? t("build.release.attention.state.finishing", "Not finished: the steps after the deploy are being finished")
        : a.security ? t("build.release.attention.state.security", "Not finished: a new data table may be readable by anyone")
          : a.top === "accept-not-run" ? t("build.release.attention.state.acceptNotRun", "Not finished: its checks could not judge it on development")
            : a.top.startsWith("data-") ? t("build.release.attention.state.data", "Not finished: its data tables are not on Blocks yet")
              : t("build.release.attention.state.texts", "Not finished: its new texts are not synced yet");
      // running the steps again can finish them: its checks again, or the data tables and texts
      const action: AttentionAction = !a.retry || open.finishing ? OPEN
        : a.issues.some((x) => x.startsWith("accept-")) ? { kind: "recheck", label: actionLabel("recheck"), jobId: open.job.id }
          : { kind: "finish", label: actionLabel("finish"), jobId: open.job.id };
      out.push({ ...base, group: "unfinished", state, version, action: may(action) });
    }
  }
  return out;
}

/** How many changes need attention (the chip's number; 0 hides it) (pure). */
export const attentionCount = (items: readonly AttentionItem[]): number => items.filter((x) => NEEDS_ATTENTION.includes(x.group)).length;

/** The panel's tabs: "All" (what needs attention) and each group that has rows, with its count (pure). */
export function attentionTabs(items: readonly AttentionItem[]): { value: "all" | AttentionGroup; label: string; count: number }[] {
  const tabs: { value: "all" | AttentionGroup; label: string; count: number }[] = [{ value: "all", label: t("build.release.attention.group.all", "All"), count: attentionCount(items) }];
  for (const g of [...NEEDS_ATTENTION, "passed"] as AttentionGroup[]) {
    const n = items.filter((x) => x.group === g).length;
    if (n > 0) tabs.push({ value: g, label: groupLabel(g), count: n });
  }
  return tabs;
}

/** The rows of a tab (pure). */
export const attentionRows = (items: readonly AttentionItem[], tab: "all" | AttentionGroup): AttentionItem[] =>
  items.filter((x) => (tab === "all" ? NEEDS_ATTENTION.includes(x.group) : x.group === tab));

/** The short line under "Send to Staging" when a change holds it back: which change, then where to look (pure). */
export function blockedLine(version: string, blocker: { code: string } | null): string {
  return blocker
    ? t("build.release.attention.blocked", "v{version} carries {code}, whose own checks fail on development.", { version, code: blocker.code })
    : t("build.release.attention.blockedUnnamed", "v{version} carries a change, whose own checks fail on development.", { version });
}
