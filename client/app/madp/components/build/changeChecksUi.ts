/** What a change request's page says about its own checks after a deploy (src/domain/changeChecks.ts): a change whose
 *  checks failed is on development but NOT usable there; what does not work (the failing checks by name, with a short
 *  reason, and what a fix round's diagnosis says beside the verdict), what happens next and who acts (a fix round
 *  running, development being put back, or a person deciding), the rounds so far, and the checks that still fail as
 *  they did before the change ("known before this change": by the engine's baseline or a person's mark; never the
 *  change's failure, always listed). Pure: read from the change request's Checks record, its jobs and the project's
 *  policy. */
import type { EngineJob } from "@/madp/blocks/engine/types";
import { t } from "@/madp/i18n";
import { attentionOf, deliveryTargetOf, newestDelivered, openAttention, type AfterDeployAttention } from "@/madp/domain/afterDeploy";
import {
  afterChecksDecision, baseJobOf, checksPassSince, fixRoundOf, fixTargets, latestRun, openFailing, parseChangeChecks, revertOf, roundsOf, sparedRounds,
  type ChecksPassSince, type ChecksPolicy, type ChecksRun, type DiagnosedCheck, type FailingCheck, type FileVerdict, type KnownMark,
} from "@/madp/domain/changeChecks";

const ACTIVE = new Set(["queued", "claimed", "running"]);

export interface RoundLine {
  round: number;
  auto: boolean;
  /** running, passed, failed (its checks still did not pass), stopped (the round did not reach its deploy), nothing (it
   *  found nothing to change: the checks that failed are the environment's; it deployed nothing), not-run */
  state: "running" | "passed" | "failed" | "stopped" | "nothing" | "not-run";
  version: string;
  failed: number;
  files: number;
  /** state "nothing": why the checks that failed are the environment's. */
  reasons?: string[];
}

export type ChecksNext =
  | { who: "team"; what: "fixing"; round: number; auto: boolean }
  | { who: "team"; what: "reverting"; auto: boolean }
  | { who: "you"; why: "rounds-used" | "policy-off" | "person-started" | "no-failing-tests" | "not-started" | "environment" | "nothing" };

/** A failing check of the change, with what the last fix round's diagnosis said about it (null: nothing). */
export interface FailingLine extends FailingCheck {
  diagnosed: DiagnosedCheck | null;
}

/** A check that still fails as it did before the change: by the engine's baseline ("history") or a person's mark. */
export interface KnownLine {
  repo: string;
  name: string;
  /** How it fails. */
  reason: string;
  /** Why it counts as known before this change. */
  evidence: string;
  by: "history" | "person";
  /** The person's mark (they can take it back). */
  mark: KnownMark | null;
}

export interface ChangeChecksState {
  /** The change's newest delivered build left its own checks failing: on development, but not usable there. */
  broken: boolean;
  /** That build (cr.fixChecks takes it as the one to fix). */
  job: EngineJob | null;
  /** Test files that failed, and that ran; the test data could not be prepared. */
  failed: number;
  files: number;
  fixtures: boolean;
  /** What does not work: the failing checks by name, with a short reason (empty when the record does not name them),
   *  without the ones a person marked known before this change. */
  failing: FailingLine[];
  /** The checks that still fail as they did before the change (its newest build's): never the change's failure. */
  known: KnownLine[];
  /** The version that build deployed ("" when it is not known). */
  version: string;
  /** The rounds of the build whose checks failed first, by round. */
  rounds: RoundLine[];
  /** What happens next and who acts (while broken). */
  next: ChecksNext | null;
  /** Development was put back without this change (the record's newest run is a revert) and nothing runs now. */
  reverted: ChecksRun | null;
  /** The change's checks pass again after a fix round (the record's newest run). */
  fixed: ChecksRun | null;
  /** What else is open after the deploy (data tables, texts), without the checks; null when nothing. */
  other: AfterDeployAttention | null;
  /** Its newest build's own checks failed, but each failing check passes since on a later version of the environment
   *  (any change's run judged it: checksPassSince): it is usable; its own failed run is kept (`ownRun`). */
  passSince: ChecksPassSince | null;
  /** That failed run of its own (with passSince). */
  ownRun: ChecksRun | null;
}

const DETAIL = /^(\d{1,4})\/(\d{1,4})$/;
const when = (iso: string | null | undefined): number => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? t : -Infinity;
};

/** The page's view of a change's checks (pure). `verdicts`: every change's judged check files (fileVerdicts), so a
 *  failing check that passes since on a later version no longer makes the change not usable. */
export function changeChecksState(cr: { id: string; checks?: string | null }, jobs: readonly EngineJob[], policy: ChecksPolicy, verdicts: readonly FileVerdict[] = []): ChangeChecksState {
  const record = parseChangeChecks(cr.checks ?? null);
  const mine = jobs.filter((j) => j.kind === "change.build" && deliveryTargetOf(j) === cr.id);
  const own = newestDelivered(mine);
  const attention = own ? openAttention(own, newestDelivered(jobs)) : null;
  const brokenByJob = !!attention?.broken;
  const other = attention ? attentionOf(attention.issues.filter((i) => !i.startsWith("accept-")), attention.details, own?.kind) : null;
  const m0 = DETAIL.exec(attention?.details["accept-failed"] ?? "");
  const run = own ? latestRun(record, own.id) : null;
  const failedRun = run?.status === "failed" ? run : null;
  // a person's marks: those checks are not the change's; every failing one marked: it is usable
  const marks = record?.marks ?? [];
  const open = failedRun ? openFailing(failedRun, marks) : null;
  const cleared = !!open && failedRun!.failing.length > 0 && open.failed === 0;
  const targets = failedRun ? fixTargets(failedRun, marks) : { failed: 0, environment: [] };
  const known: KnownLine[] = [
    ...(run?.known ?? []).map((k) => ({ repo: k.repo, name: k.name, reason: k.reason, evidence: k.evidence, by: k.by, mark: marks.find((m) => m.name === k.name && (!m.repo || m.repo === k.repo)) ?? null })),
    ...(open?.marked ?? []).filter((f) => !(run?.known ?? []).some((k) => k.name === f.name && k.repo === f.repo)).map((f) => {
      const mark = marks.find((m) => m.name === f.name && (!m.repo || !f.repo || m.repo === f.repo)) ?? null;
      return { repo: f.repo, name: f.name, reason: f.reason, evidence: mark ? t("changes.checks.markedWhy", "marked known before this change: {reason}", { reason: mark.reason }) : t("changes.checks.marked", "marked known before this change"), by: "person" as const, mark };
    }),
  ];
  // each failing check passes since on a later version (from any change's run): the change's checks pass there
  const passSince = brokenByJob && !cleared && own && failedRun ? checksPassSince(record, own.id, verdicts) : null;
  // its newest build left checks failing that are the change's (a build whose every failing check is marked, or passes
  // since, is not)
  const broken = brokenByJob && !cleared && !passSince;
  const marked = open?.marked.length ?? 0;
  const m = m0 ? [m0[0], String(Math.max(0, Number(m0[1]) - marked)), m0[2]] : null;
  const base = own ? baseJobOf(own, jobs) : "";
  const rounds: RoundLine[] = base
    ? roundsOf(mine, base).map((j) => {
        const f = fixRoundOf(j)!;
        const r = latestRun(record, j.id);
        const state: RoundLine["state"] = ACTIVE.has(j.status) ? "running"
          : j.status !== "succeeded" ? "stopped"
            : r?.nothing?.length ? "nothing"
              : r?.status === "ok" ? "passed" : r?.status === "failed" ? "failed" : "not-run";
        return { round: f.round, auto: f.auto, state, version: r?.version ?? f.version, failed: r?.failed ?? 0, files: r?.files ?? 0, ...(state === "nothing" ? { reasons: r!.nothing } : {}) };
      })
    : [];
  const active = mine.find((j) => ACTIVE.has(j.status) && (fixRoundOf(j) || revertOf(j))) ?? null;
  let next: ChecksNext | null = null;
  if (active && fixRoundOf(active)) next = { who: "team", what: "fixing", round: fixRoundOf(active)!.round, auto: fixRoundOf(active)!.auto };
  else if (active && revertOf(active)) next = { who: "team", what: "reverting", auto: revertOf(active)!.auto };
  else if (broken && own) {
    // the failing test files a fix round would target: without marks, and without the ones the last round's diagnosis
    // put in the environment (no automatic round starts for those; a person decides)
    const failed = failedRun ? targets.failed : m ? Number(m[1]) : 0;
    // a round that found nothing to change is not one of the automatic rounds; the newest round of this build found
    // nothing to change after these checks ran: the checks that fail are the environment's, a person decides
    const spared = sparedRounds(record);
    const newestRound = base ? roundsOf(mine, base).at(-1) : undefined;
    const nothingNow = !!newestRound && spared.has(newestRound.id) && when(newestRound.createdAt) > when(own.createdAt ?? own.finishedAt);
    const d = afterChecksDecision(jobs, own, failed, policy, targets.environment.length, spared);
    // the engine starts what the policy allows right after the build; when it did not (the policy changed since, or
    // the build ran before it existed), a person starts it
    next = { who: "you", why: nothingNow ? "nothing" : d.action === "wait" ? d.why : d.action === "revert" ? "rounds-used" : "not-started" };
  }
  const newest = latestRun(record);
  const quiet = !active && !broken;
  return {
    broken,
    job: broken ? own : null,
    failed: m ? Number(m[1]) : failedRun?.failed ?? 0,
    files: m ? Number(m[2]) : failedRun?.files ?? 0,
    fixtures: attention?.details["accept-failed"] === "fixtures" || !!failedRun?.fixtures,
    failing: (open?.failing ?? []).map((f) => ({ ...f, diagnosed: (failedRun?.diagnosed ?? []).find((d) => d.name === f.name && (!d.repo || !f.repo || d.repo === f.repo)) ?? null })),
    known,
    version: run?.version ?? "",
    rounds,
    next,
    reverted: quiet && newest?.kind === "revert" ? newest : null,
    fixed: quiet && newest?.kind === "fix" && newest.status === "ok" ? newest : null,
    other,
    passSince,
    ownRun: passSince ? failedRun : null,
  };
}

/** "6 of 38 checks fail" (test files), or what kept them from running (pure). */
export function failingWords(s: Pick<ChangeChecksState, "failed" | "files" | "fixtures">): string {
  if (s.failed > 0 && s.files > 0) return t("build.step.checksFail", "{failed} of its {total} checks fail", { failed: s.failed, total: s.files });
  return s.fixtures ? t("changes.checks.fixtures", "the data its checks need could not be prepared, so they did not run") : t("changes.checks.someFail", "some of its checks fail");
}

/** What happens next and who acts, in one sentence (pure). */
export function nextWords(n: ChecksNext | null, policy: ChecksPolicy): string {
  if (!n) return "";
  if (n.who === "team") {
    return n.what === "fixing"
      ? (n.auto ? t("changes.checks.next.fixing", "The development team is fixing what the checks found (fix round {round}); the same checks run again after its deploy.", { round: n.round })
        : t("changes.checks.next.fixingAsked", "The development team is fixing what the checks found as you asked (fix round {round}); the same checks run again after its deploy.", { round: n.round }))
      : t("changes.checks.next.reverting", "The development team is putting development back to the last build whose checks passed; the change can be built again after.");
  }
  switch (n.why) {
    case "rounds-used":
      return policy.autoFixRounds === 1
        ? t("changes.checks.next.roundUsed", "The development team tried 1 fix round on its own and the checks still fail. Decide how to go on: another fix round, or put development back to the last build whose checks passed.")
        : t("changes.checks.next.roundsUsed", "The development team tried {count} fix rounds on its own and the checks still fail. Decide how to go on: another fix round, or put development back to the last build whose checks passed.", { count: policy.autoFixRounds });
    case "person-started":
      return t("changes.checks.next.personStarted", "The fix round you started did not make them pass. Start another round, or put development back to the last build whose checks passed.");
    case "not-started":
      return t("changes.checks.next.notStarted", "What the checks found has not gone back to the development team yet. Start a fix round: they fix the code, or a test that is wrong, and deploy again; or put development back to the last build whose checks passed.");
    case "environment":
      return t("changes.checks.next.environment", "The last fix round's diagnosis puts the checks that still fail in the environment, not the code (see each one below), so no further round starts on its own. Run the checks again once the environment works, mark a check known before this change, or start a fix round if you see it differently.");
    case "nothing":
      return t("changes.checks.next.nothing", "The last fix round found nothing to change: the checks that still fail are the environment's, not the code (see the round below), and it did not count as one of the automatic rounds. Once the environment is fixed (for example the test data the checks prepare), run the checks again; or mark a check known before this change, or start a fix round if you see it differently.");
    case "no-failing-tests":
      return t("changes.checks.next.noTests", "None of its checks could run, so there is nothing for the developers to fix yet. Run the checks again once they can run, or start a fix round if the data the checks prepare is itself wrong.");
    default:
      return t("changes.checks.next.off", "Automatic fixes are off for this project. Start a fix round: the development team fixes the code, or a test that is wrong, and deploys again; or put development back to the last build whose checks passed.");
  }
}

/** One round in a few words: "Fix round 1 (automatic) · 0.10.1 · 2 of 38 still fail" (pure). */
export function roundWords(r: RoundLine): string {
  const how = r.auto ? t("changes.checks.round.auto", "automatic") : t("changes.checks.round.person", "started by a person");
  const result = r.state === "running" ? t("changes.checks.round.running", "running now")
    : r.state === "passed" ? t("changes.checks.round.passed", "its checks pass")
      : r.state === "failed" ? (r.files ? t("changes.checks.round.failedCount", "{failed} of {files} still fail", { failed: r.failed, files: r.files }) : t("changes.checks.round.failed", "they still fail"))
        : r.state === "stopped" ? t("changes.checks.round.stopped", "it stopped before its deploy")
          : r.state === "nothing" ? (r.reasons?.length ? t("changes.checks.round.nothingWhy", "nothing to change: the failing checks are the environment's ({reasons})", { reasons: r.reasons.join("; ") }) : t("changes.checks.round.nothing", "nothing to change: the failing checks are the environment's"))
            : t("changes.checks.round.notRun", "its checks did not run");
  const head = t("changes.checks.round.head", "Fix round {round} ({how})", { round: r.round, how });
  return `${head}${r.version ? ` · ${r.version}` : ""} · ${result}`;
}

/** The project's policy in one sentence (pure). */
export function policyWords(p: ChecksPolicy): string {
  if (p.autoFixRounds === 0) {
    return p.autoRevert ? t("changes.checks.policy.manual", "When a change's checks fail after its deploy, a person starts each fix round.")
      : t("changes.checks.policy.manualDecide", "When a change's checks fail after its deploy, a person starts each fix round; if they still fail, a person decides.");
  }
  const rounds = p.autoFixRounds === 1 ? t("changes.checks.policy.oneRound", "1 round") : t("changes.checks.policy.rounds", "{count} rounds", { count: p.autoFixRounds });
  return p.autoRevert
    ? t("changes.checks.policy.autoRevert", "When a change's checks fail after its deploy, the development team fixes them on its own, up to {rounds}; if they still fail, development is put back to the last build whose checks passed.", { rounds })
    : t("changes.checks.policy.autoDecide", "When a change's checks fail after its deploy, the development team fixes them on its own, up to {rounds}; if they still fail, a person decides.", { rounds });
}
