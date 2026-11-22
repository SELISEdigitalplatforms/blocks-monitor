/** The Release step (step 6, STEP-STANDARD.md) of a SELISE Blocks project on the shared step frame
 *  (/p/:id/delivered): the release manager releases the app to development, staging and production with release notes; you
 *  approve the release or request changes. Header: the one primary action (approve, release, send for approval, set up
 *  the approvals or request a change), the chips Development · Staging · Production · Change requests · Approvals. Main area:
 *  the release notes and where the app runs, in plain words. Details: each environment's live card and history (?env=),
 *  the promotion with its approvals per environment (?to=), the approval policy, the milestone previews and the change
 *  requests. Everything is read from real rows; a release to staging or production is a record until the MADP engine
 *  deploys it. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Check, FolderOpen, MessageSquareWarning, Rocket, Send, Server, Settings2 } from "lucide-react";
import { useProject } from "@/blocks/projects/reads";
import { isStepReachable, type JourneyStep } from "@/domain/journey";
import { useDeliveryContext } from "@/blocks/delivery/context";
import { useLiveFacts } from "@/blocks/delivery/environments";
import { attachedLive } from "@/components/analysis-next/model";
import {
  latestJobFor, useApprovalPolicies, useApprovalRequests, useChangeRequests, useDeliveryJobs, useMilestones, usePreviews, useReleases,
} from "@/blocks/delivery/hooks";
import { useApprovalRequestCreate, useApprovalRequestDecide, useReleasePromote } from "@/blocks/delivery/actions";
import type { DeliveryRelease } from "@/blocks/delivery/types";
import { ApprovalPolicyEditor, ApprovalRequestPanel, PromoteAction } from "@/components/approvals";
import { RejectDialog } from "@/components/approvals/RejectDialog";
import { ChangeRequestLayer } from "@/components/changes/ChangeRequestLayer";
import { openChangeRequest } from "@/components/changes/changeUi";
import { EngineJobStatus } from "@/components/engine/EngineJobStatus";
import { ENV_IDS, EnvSwitcher } from "@/components/overview/EnvSwitcher";
import { useOverviewUi } from "@/components/overview/overviewUi";
import { StepFrame, signOffText, type StepChip, type StepPrimary } from "@/components/step/StepFrame";
import type { Environment, GatedEnvironment } from "@/domain/promotion";
import { approvalStepLabel, changeCode, compareReleaseVersions, currentApprovalRequest, environmentStates, promotionCandidate } from "@/domain/delivery";
import { changesNotUsable, deliveryTargetOf, promotionBlockedBy } from "@/domain/afterDeploy";
import { checksSettled } from "@/domain/changeChecks";
import { useBuildClock } from "@/components/changes/buildClock";
import { useChecksPolicyValue } from "@/components/build/checksPolicy";
import { AttentionPanel } from "./AttentionPanel";
import { attentionCount, attentionItems, blockedLine } from "./attention";
import { isActiveEngineJob } from "@/blocks/engine/types";
import { ShimmerProgress } from "@/ui/ShimmerProgress";
import { Button, Card, EmptyState, Modal, Tabs } from "@/ui/kit";
import { changeStopped } from "@/components/changes/changeStopped";
import { ChangeRequestsPanel } from "./ChangeRequestsPanel";
import { EnvironmentsCard } from "./EnvironmentsCard";
import { GoLiveConsole } from "./GoLiveConsole";
import { LiveDelivered } from "./LiveDelivered";
import { MilestonePreviews } from "./MilestonePreviews";
import { ReleaseMain } from "./ReleaseMain";
import { promotionMoveText, releaseKey, releaseMilestones, whereItRuns } from "./liveRelease";
import { RELEASE_ROLE, releaseNotes, releaseStep, type ReleaseChipId } from "./releaseStep";
import { envName, envWord, pickTarget } from "./releaseUi";
import { BlocksConnectNotice } from "@/components/engine/BlocksConnectCard";
import { t, useCulture, useT } from "@/i18n";

const targets = () => [
  { value: "stage" as const, label: envName("stage") },
  { value: "production" as const, label: envName("production") },
];
const PAGE = "flex w-full min-w-0 flex-col";

/** The environment the page shows: ?env= (dev, stage or production), dev otherwise. */
export function shownEnvironment(param: string | null): Environment {
  return param === "stage" || param === "production" ? param : "dev";
}

/** "Organisation · Project", as on every project page; empty while neither is known. */
export function releaseEyebrow(p: { clientName?: string; name?: string } | null | undefined): string {
  return [p?.clientName?.trim() ?? "", p?.name?.trim() ?? ""].filter(Boolean).join(" · ");
}

/** A release that arrived while the page was open (not the ones there on the first read): the id to celebrate. */
function useFreshRelease(currentIds: Record<Environment, string | null>, loaded: boolean): string | null {
  const seen = useRef<Record<Environment, string | null> | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const key = ENV_IDS.map((e) => currentIds[e] ?? "").join("|");
  useEffect(() => {
    if (!loaded) return;
    const prev = seen.current;
    seen.current = currentIds;
    if (!prev) return;
    for (const e of ENV_IDS) {
      const id = currentIds[e];
      if (id && id !== prev[e]) setFresh(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loaded]);
  return fresh;
}

/** Why Release is closed: null while the step is unknown or once the journey has reached Release (the stepper's text otherwise). */
export function releaseGateReason(step: JourneyStep | null | undefined): string | null {
  if (!step) return null;
  return isStepReachable({ step, scopeLocked: false }, "release") ? null : t("build.release.page.gateReason", "Finish the build first");
}

/** C1: a promotion needs a complete approval policy; scope lock and the build are not gated on approvals. */
export function PromotionPolicyNote({ environment }: { environment: GatedEnvironment }) {
  const t = useT();
  const rule = environment === "stage"
    ? t("build.release.page.ruleStage", "A release to staging needs an architect and a security approval; QA is optional.")
    : t("build.release.page.ruleProduction", "A release to production needs every approval set up for production.");
  return (
    <p className="text-[13px] leading-relaxed text-ink2">
      {rule}{" "}
      <a href="#approval-policy" className="font-medium text-accent underline-offset-2 hover:underline"
        onClick={(e) => {
          e.preventDefault();
          const el = document.getElementById("approval-policy");
          el?.scrollIntoView({ block: "start" });
          el?.focus({ preventScroll: true });
        }}>{t("build.release.page.setUpWhoApproves", "Set up who approves")}</a>
    </p>
  );
}

/** The change request a change.analyse job is for ("" when its input names none). */
function jobChangeId(job: { inputJson?: string | null }): string {
  try {
    const v = JSON.parse(job.inputJson ?? "") as { changeRequestId?: unknown } | null;
    return v && typeof v.changeRequestId === "string" ? v.changeRequestId : "";
  } catch { return ""; }
}

/** "The development team is building change ADD-3… ▓▓▒░" */
function ReleaseAgentLine({ text, progress }: { text: string; progress: number | null }) {
  return (
    <div role="status" className="flex flex-col gap-2 rounded-block bg-ai-soft px-3.5 py-2.5">
      <p className="text-[13px] text-[rgb(var(--c-ai-text))]">{text}…</p>
      <ShimmerProgress step={Math.max(6, Math.round(progress ?? 30))} total={100} ticks={false} active label={text}
        valueText={progress !== null ? `${Math.round(progress)}%` : t("build.release.page.working", "Working")} size="sm" />
    </div>
  );
}

/** The environment and version of a deployment job (a preview.deploy with an environment), or null. */
function deployTarget(inputJson: string | null | undefined): { environment: GatedEnvironment; version: string } | null {
  try {
    const p = JSON.parse(inputJson ?? "") as { environment?: unknown; version?: unknown };
    return (p.environment === "stage" || p.environment === "production") && typeof p.version === "string" ? { environment: p.environment, version: p.version } : null;
  } catch { return null; }
}

const focusEl = (id: string) => window.setTimeout(() => {
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
  el?.focus({ preventScroll: true });
}, 80);

export function BlocksReleaseView({ projectId }: { projectId: string }) {
  const t = useT();
  const culture = useCulture();
  const ctx = useDeliveryContext(projectId);
  const project = useProject(projectId).data;
  const gate = releaseGateReason(project?.step);
  const [params, setParams] = useSearchParams();
  const releases = useReleases(ctx);
  const milestones = useMilestones(ctx);
  const previews = usePreviews(ctx);
  const changes = useChangeRequests(ctx);
  const policies = useApprovalPolicies(ctx);
  const requests = useApprovalRequests(ctx);
  const { jobs } = useDeliveryJobs(ctx);
  const decide = useApprovalRequestDecide(ctx);
  const create = useApprovalRequestCreate(ctx);
  const promote = useReleasePromote(ctx);
  const [rejecting, setRejecting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [confirmProd, setConfirmProd] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // every environment with what the records know (an attached product's documented environments and releases included)
  const known = useLiveFacts(projectId);
  // each release with its commit: its own record's, else the one the live product was documented with
  // a release taken off its environment again (its checks failed, development was put back) is not where it runs
  const releaseRows = useMemo(() => releases.data.filter((r) => r.status !== "rolled-back")
    .map((r) => (r.sourceCommit ? r : { ...r, sourceCommit: known.commits.get(releaseKey(r)) ?? null })), [releases.data, known.commits]);
  // the changes whose own checks failed on development: there, but not usable; never promoted (failing checks marked
  // known before the change, or each passing since on a later version, are not the change's: checksSettled)
  const notUsable = useMemo(() => changesNotUsable(jobs, checksSettled(changes.data)), [jobs, changes.data]);
  // every change that needs attention, in ONE side panel behind one chip (attention.ts), never a notice per change
  const checksPolicy = useChecksPolicyValue(projectId);
  const clock = useBuildClock(changes.data.some((c) => c.status === "building"));
  const canRunBuilds = ctx.can("build.run");
  const attention = useMemo(() => attentionItems({ projectId, changes: changes.data, jobs, policy: checksPolicy, now: clock, canRun: canRunBuilds }),
    // culture: the rows' words follow the language
    [projectId, changes.data, jobs, checksPolicy, clock, canRunBuilds, culture]);
  const needsAttention = attentionCount(attention);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const states = useMemo(() => environmentStates(releaseRows), [releaseRows]);
  const where = useMemo(() => whereItRuns(states, known.facts, known.documented), [states, known.facts, known.documented]);
  const attached = attachedLive(project ?? null);
  const ms = releaseMilestones(attached, previews.data.length);
  const factoryDevReleases = states.dev.history.filter((r) => !known.documented.has(releaseKey(r)));
  const fresh = useFreshRelease(
    { dev: states.dev.current?.id ?? null, stage: states.stage.current?.id ?? null, production: states.production.current?.id ?? null },
    ctx.status === "ready" && !releases.isLoading,
  );
  const shown = shownEnvironment(params.get("env"));
  const setEnv = (e: Environment) => {
    useOverviewUi.getState().setEnv(projectId, e);
    setParams((p) => { const n = new URLSearchParams(p); n.set("env", e); return n; }, { replace: true });
  };
  // the same header as every step: title · project, the role line (no workspace or client line above the title)
  const role = RELEASE_ROLE.who;
  const deliverable = RELEASE_ROLE.delivers;
  const yourPart = RELEASE_ROLE.you;
  const frame = { title: t("build.release.page.title", "Release"), subject: project?.name, role, deliverable, yourPart };

  const status = ctx.status;
  if (status === "loading") return <StepFrame {...frame} status={t("build.release.page.loading", "Loading the release…")} statusTone="waiting" />;
  if (status === "not_found") {
    return (
      <StepFrame {...frame}>
        <EmptyState title={t("build.release.page.notFoundTitle", "Project not found")}
          text={t("build.release.page.notFoundText", "It does not exist, or you are not a member of its workspace.")} />
      </StepFrame>
    );
  }
  if (status === "error") {
    return <StepFrame {...frame}><p role="alert" className="text-[14px] text-danger">{ctx.error ?? t("build.release.page.loadError", "The project could not be loaded.")}</p></StepFrame>;
  }

  const policyEditor = (initial: GatedEnvironment) => (
    <div id="approval-policy" tabIndex={-1} className="flex min-w-0 scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)] flex-col outline-none">
      <ApprovalPolicyEditor ctx={ctx} policies={policies.data} loading={policies.isLoading} initialEnvironment={initial} />
    </div>
  );
  const changePanel = (
    <div id="change-requests" tabIndex={-1} className="flex min-w-0 scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)] flex-col outline-none">
      <ChangeRequestsPanel ctx={ctx} changeRequests={changes.data} milestones={milestones.data} releases={releases.data} jobs={jobs} />
    </div>
  );
  const openDetails = (id: string) => { setDetailsOpen(true); focusEl(id); };

  const memberName = (id: string) => ctx.memberName(id);
  const step = releaseStep({
    states, requests: requests.data, policies: policies.data, policiesLoading: policies.isLoading, changes: changes.data, userId: ctx.userId,
    activeMemberIds: ctx.activeMemberIds,
    can: { approve: ctx.can("release.approve"), promote: ctx.can("release.promote"), request: ctx.can("release.request") },
    nameOf: memberName,
    liveWithoutRelease: ENV_IDS.filter((e) => !where[e].factoryRelease && where[e].state === "live"),
  });

  if (gate) {
    const building = project?.step === "board" || project?.step === "build";
    // the same chips as after the build: where the app runs (nothing yet), the change requests and the saved approvals
    const gateChips: StepChip[] = step.chips.map((c) => ({
      id: c.id, label: c.label, value: c.value, state: c.state, title: c.title, editableAfterSignOff: true,
      onClick: c.id === "approvals" ? () => openDetails("approval-policy") : c.id === "changes" ? () => openDetails("change-requests") : undefined,
      // the value says it ("not set up"), as on the Scope step: the chip only adds its "›"
      todoLabel: c.id === "approvals" ? "" : undefined,
    }));
    return (
      <StepFrame {...frame} status={t("build.release.step.waitingForBuild", "Waiting for the build")} statusTone="waiting" chips={gateChips}
        chipsLabel={t("build.release.page.checklist", "Release checklist")}
        primary={{
          label: building ? t("build.release.step.goToEngineering", "Go to Software Engineering") : t("build.release.page.goToCurrent", "Go to the current step"),
          href: `/p/${projectId}/${building ? "build" : "business"}`,
        }}
        details={<div className="flex min-w-0 flex-col gap-6">{policyEditor(params.get("env") === "production" ? "production" : "stage")}{changePanel}</div>}
        detailsLabel={t("build.release.page.detailsGate", "Details · approvals, change requests")} detailsOpen={detailsOpen}>
        <Card>
          <EmptyState icon={<Rocket size={28} strokeWidth={1.75} aria-hidden />} title={t("build.release.page.nothingTitle", "Nothing to release yet")}
            text={t("build.release.page.nothingText", "The development team is still building. Once the last milestone is accepted, the app goes to the development environment first; staging and production follow with your approval. You can already set up who approves a release in Details.")} />
        </Card>
      </StepFrame>
    );
  }

  const notes = releaseNotes({
    // an attached live product's milestones (documented from the live product) were never delivered by a first release
    devHistory: states.dev.history, changes: changes.data, milestones: ms.inNotes ? milestones.data : [], after: null, upTo: null, code: changeCode,
    documented: known.documented,
  });

  // the Details' promotion card has its own ?to=: choosing where to promote never switches the environment shown
  const target = pickTarget(params.get("to") ?? params.get("env"), states);
  const setTarget = (t: GatedEnvironment) => setParams((p) => { const n = new URLSearchParams(p); n.set("to", t); return n; }, { replace: true });
  const candidate = promotionCandidate(states, target);
  const pending = currentApprovalRequest(requests.data, target, null);
  const forCandidate = currentApprovalRequest(requests.data, target, candidate);
  const policy = policies.data.find((p) => p.environment === target) ?? null;
  const hasDev = releases.data.some((r) => r.environment === "dev");
  const firstMilestone = milestones.data[0] ?? null;
  const buildJob = firstMilestone ? latestJobFor(jobs, "build.run", { milestoneId: firstMilestone.id }) : null;
  const unreadable = [releases, milestones, previews, changes, policies, requests].some((q) => q.unreadable.length > 0);
  const loadError = [releases, milestones, previews, changes, policies, requests].find((q) => q.error)?.error;
  const shownState = states[shown];
  const shownRelease = shownState.current;
  const firstDev = states.dev.history.reduce<DeliveryRelease | null>(
    (a, r) => (!a || (Date.parse(r.releasedAt ?? "") || Infinity) < (Date.parse(a.releasedAt ?? "") || Infinity) ? r : a), null);
  const nextOf: GatedEnvironment | null = shown === "dev" ? "stage" : shown === "stage" ? "production" : null;
  const promoteFromCard = (t: GatedEnvironment) => { setTarget(t); openDetails("promotion"); };
  const sourceOfShown = shown === "production" ? states.stage.current : shown === "stage" ? states.dev.current : null;

  let hero;
  if (!hasDev) {
    hero = buildJob && firstMilestone && (buildJob.status === "claimed" || buildJob.status === "running")
      ? <GoLiveConsole job={buildJob} milestone={firstMilestone} eyebrow={releaseEyebrow(project) || undefined} />
      : (
        <Card title={firstMilestone
          ? t("build.release.page.firstFromMilestone", "The first release to development comes from the build of milestone {number}", { number: firstMilestone.number })
          : t("build.release.page.firstFromFirst", "The first release to development comes from the first milestone's build")}>
          <EngineJobStatus job={buildJob} />
        </Card>
      );
  } else if (shownRelease) {
    const crIds = new Set(shownRelease.changeRequestIds);
    hero = (
      <LiveDelivered project={{ name: project?.name ?? "", eyebrow: releaseEyebrow(project), createdDate: project?.createdDate ?? null, attached, devReleases: factoryDevReleases }} env={shown}
        release={shownRelease} firstDev={firstDev} changes={changes.data.filter((c) => crIds.has(c.id))} milestones={ms.inHero ? milestones.data.length : 0}
        celebrate={fresh === shownRelease.id} primary={false} />
    );
  } else if (where[shown].state === "live") {
    // live without a release by the Factory (documented from the live product): never "not released yet"
    const w = where[shown];
    hero = (
      <Card>
        <EmptyState icon={<Server size={22} strokeWidth={1.75} aria-hidden />} title={t("build.release.page.envLive", "{env} is live", { env: envName(shown) })}
          text={[
            w.host && w.branch ? t("build.release.page.runsAtFromBranch", "It runs at {host} from branch {branch}.", { host: w.host, branch: w.branch })
              : w.host ? t("build.release.page.runsAt", "It runs at {host}.", { host: w.host })
                : w.branch ? t("build.release.page.runsFromBranch", "It runs from branch {branch}.", { branch: w.branch })
                  : t("build.release.page.runs", "It runs."),
            w.version ? t("build.release.page.runsVersion", "It runs v{version}.", { version: w.version }) : "",
            sourceOfShown
              ? t("build.release.page.noFactoryReleaseFollow", "The Factory has not released a version here yet: v{version} can follow once its approvals are in.",
                { version: sourceOfShown.version })
              : t("build.release.page.noFactoryRelease", "The Factory has not released a version here yet."),
          ].filter(Boolean).join(" ")} />
      </Card>
    );
  } else {
    hero = (
      <Card>
        <EmptyState icon={<Server size={22} strokeWidth={1.75} aria-hidden />} title={t("build.release.page.envNotReleased", "{env} is not released yet", { env: envName(shown) })}
          text={sourceOfShown
            ? t("build.release.page.sourceRuns", "{env} runs v{version}. It can be released here once its approvals are in.",
              { env: envName(shown === "production" ? "stage" : "dev"), version: sourceOfShown.version })
            : t("build.release.page.sourceEmpty", "Nothing released yet. {env} has no version to release here yet.", { env: envName(shown === "production" ? "stage" : "dev") })} />
      </Card>
    );
  }

  // a version that carries a change whose own checks failed on development is not usable: it is not promoted
  const blockerId = step.version ? promotionBlockedBy(step.version, notUsable, states.dev.history.map((r) => ({ version: r.version, engineJobId: r.engineJobId ?? null })), compareReleaseVersions) : null;
  const blocker = blockerId ? changes.data.find((c) => c.id === blockerId) ?? null : null;
  // one short line under the action, linking to the panel where the change is handled
  const blockedReason = blockerId && step.version ? (
    <>
      {blockedLine(step.version, blocker ? { code: changeCode(blocker) } : null)}{" "}
      <button type="button" onClick={() => setAttentionOpen(true)} className="font-medium text-accent underline-offset-2 hover:underline">{t("build.release.page.seeAttention", "See what needs attention")}</button>
    </>
  ) : null;

  // the one primary action, from the step's state
  const req = step.request;
  // every open step you may decide is approved with the one click (optional ones first, the request settles on the last)
  const myStepNames = req ? [...step.mySteps].sort((a, b) => a - b).map((i) => approvalStepLabel(req.request.steps[i]!.type, req.request.steps[i]!.label)) : [];
  const myStepName = myStepNames.length > 1
    ? t("build.release.move.list", "{items} and {last}", { items: myStepNames.slice(0, -1).join(", "), last: myStepNames[myStepNames.length - 1]! })
    : myStepNames[0] ?? "";
  // one notice at a time: an action clears the outcome of the earlier ones
  const clearNotices = () => { decide.reset(); create.reset(); promote.reset(); };
  const approveAll = async () => {
    if (!req || step.mySteps.length === 0) return;
    clearNotices();
    setApproving(true);
    try {
      for (const i of step.mySteps) {
        if (!(await decide.run({ approvalRequestId: req.id, stepIndex: i, decision: "approved" }))) break;
      }
    } finally {
      setApproving(false);
    }
  };
  const newChange = () => openChangeRequest({ lane: "change", target: null });
  // a product without a Factory scope (an existing product attached as it is live) gets new features built on it
  // (an attached product never locked a Factory scope: milestones documented from it never make it "scoped")
  const scoped = ms.mayScope && (milestones.isLoading || milestones.data.some((m) => m.featureRefs.length > 0));
  const newFeature = () => openChangeRequest({ lane: "add", target: null });
  let primary: StepPrimary | null = null;
  switch (step.primary.kind) {
    case "build":
      primary = { label: step.primary.label, href: `/p/${projectId}/build` };
      break;
    case "approve":
      primary = {
        label: step.primary.label, icon: <Check size={16} strokeWidth={2} aria-hidden />, pending: approving || decide.pending, pendingLabel: t("build.release.page.approving", "Approving…"),
        reason: [step.primary.reason, myStepName ? t("build.release.page.approveAs", "You approve as {step}.", { step: myStepName }) : ""].filter(Boolean).join(" ") || undefined,
        onClick: () => { void approveAll(); },
      };
      break;
    case "promote":
      primary = {
        label: step.primary.label, icon: <Rocket size={16} strokeWidth={1.75} aria-hidden />, disabled: step.primary.disabled || !!blockedReason,
        reason: blockedReason ?? step.primary.reason ?? undefined, pending: promote.pending, pendingLabel: t("build.release.page.releasing", "Releasing…"),
        onClick: () => {
          if (!step.target || !step.version) return;
          if (step.target === "production") setConfirmProd(true);
          else { clearNotices(); void promote.run({ environment: step.target, version: step.version }); }
        },
      };
      break;
    case "request":
      primary = {
        label: step.primary.label, icon: <Send size={16} strokeWidth={1.75} aria-hidden />, disabled: step.primary.disabled || !!blockedReason,
        // what it moves: the version, from where to where, and the change requests it carries
        reason: blockedReason ?? step.primary.reason ?? (step.target && step.version
          ? promotionMoveText({ target: step.target, version: step.version, where, changes: changes.data, code: changeCode })
          : undefined),
        pending: create.pending, pendingLabel: t("build.release.page.sending", "Sending…"),
        onClick: () => { if (step.target && step.version) { clearNotices(); void create.run({ environment: step.target, version: step.version }); } },
      };
      break;
    case "setup":
      primary = { label: step.primary.label, icon: <Settings2 size={16} strokeWidth={1.75} aria-hidden />, onClick: () => openDetails("approval-policy") };
      break;
    case "wait":
      primary = { label: step.primary.label, disabled: true, reason: step.primary.reason ?? undefined };
      break;
    default:
      primary = {
        label: step.primary.label, icon: <MessageSquareWarning size={16} strokeWidth={1.75} aria-hidden />, onClick: newChange,
        disabled: !ctx.can("build.run"), reason: step.primary.reason ?? (ctx.can("build.run") ? undefined : t("build.release.page.teamTurnsIt", "Your team turns it into a change request.")),
      };
  }

  // "Request a change": while you approve it asks for changes to this release; otherwise it opens a change request
  const canChange = hasDev && ctx.can("build.run");
  const extras = (<>
    {step.phase === "approve" ? (
      <Button variant="ghost" size="sm" onClick={() => setRejecting(true)} disabled={decide.pending}>{t("build.release.page.requestChanges", "Request changes")}</Button>
    ) : step.phase !== "live" && step.primary.kind !== "change" && canChange ? (
      <Button variant="ghost" size="sm" onClick={newChange}>{t("build.release.step.requestChange", "Request a change")}</Button>
    ) : null}
    {canChange && !scoped && step.phase !== "approve" && (
      <Button variant="ghost" size="sm" onClick={newFeature}
        title={t("build.release.page.addFeatureHint", "A new feature built on the existing product, in small builds you try on development")}>
        {t("build.release.page.addFeature", "Add a feature")}
      </Button>
    )}
    <Link to={`/p/${projectId}/produced`}
      className="inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-surface2 px-3.5 text-[13px] font-medium text-ink outline-none transition hover:bg-line focus-visible:ring-2 focus-visible:ring-accent/50">
      <FolderOpen size={15} strokeWidth={1.75} aria-hidden />{t("build.release.page.produced", "What MADP produced")}
    </Link>
  </>);

  const CHIP_OPEN: Record<ReleaseChipId, () => void> = {
    dev: () => focusEl("release-where"),
    stage: () => focusEl("release-where"),
    production: () => focusEl("release-where"),
    changes: () => openDetails("change-requests"),
    approvals: () => (step.phase === "setup" ? openDetails("approval-policy") : (step.target && setTarget(step.target), openDetails("promotion"))),
  };
  const chips: StepChip[] = step.chips.map((c) => ({
    id: c.id, label: c.label, value: c.value, state: c.state, title: c.title, onClick: CHIP_OPEN[c.id], editableAfterSignOff: true,
    todoLabel: c.id === "approvals" ? "" : undefined,
  }));
  // what needs attention, in one chip beside the change requests; none: no chip
  if (needsAttention > 0) {
    chips.splice(chips.findIndex((c) => c.id === "changes") + 1 || chips.length, 0, {
      // the chip's own mark says it needs you; "" shows only "›": it opens the list
      id: "attention", label: t("build.release.page.needsAttention", "Needs attention"), value: String(needsAttention), state: "attention", editableAfterSignOff: true, todoLabel: "",
      title: needsAttention === 1 ? t("build.release.page.attentionOne", "1 change needs attention: open the list")
        : t("build.release.page.attentionMany", "{count} changes need attention: open the list", { count: needsAttention }),
      onClick: () => setAttentionOpen(true),
    });
  }

  const live = step.live;
  const signedOff = live ? {
    text: signOffText({ verb: t("build.release.page.signOffVerb", "v{version} released to production", { version: live.version }), by: live.releasedByUserId ? memberName(live.releasedByUserId) : null, at: live.releasedAt }),
    action: canChange ? (
      <Button variant="primary" className="h-11 px-5" icon={<MessageSquareWarning size={16} strokeWidth={1.75} aria-hidden />} onClick={newChange}>{t("build.release.step.requestChange", "Request a change")}</Button>
    ) : undefined,
  } : null;

  const changeJob = jobs.find((j) => j.kind === "change.build" && isActiveEngineJob(j)) ?? null;
  // the change the running build is for, from the job itself (another change at "building" may have no build at all)
  const buildingCr = changeJob ? changes.data.find((c) => c.id === deliveryTargetOf(changeJob)) ?? null : null;
  // a change request the business analyst is analysing (cr.submit queued change.analyse)
  const analyseJob = jobs.find((j) => j.kind === "change.analyse" && isActiveEngineJob(j)) ?? null;
  const analysingCr = analyseJob ? changes.data.find((c) => c.id === jobChangeId(analyseJob)) ?? null : null;
  // a release to staging or production being deployed (release.promote queues it)
  const deploy = jobs.map((j) => ({ j, to: j.kind === "preview.deploy" && isActiveEngineJob(j) ? deployTarget(j.inputJson) : null })).find((x) => x.to) ?? null;
  const agentLine = deploy?.to
    ? <ReleaseAgentLine text={t("build.release.agent.deploying", "Your release manager is putting v{version} live on {env}", { version: deploy.to.version, env: envWord(deploy.to.environment) })}
      progress={Number.isFinite(deploy.j.progress) ? deploy.j.progress : null} />
    : changeJob
    ? <ReleaseAgentLine text={buildingCr ? t("build.release.agent.buildingChange", "The development team is building change {code}", { code: changeCode(buildingCr) })
      : t("build.release.agent.buildingAChange", "The development team is building a change")} progress={Number.isFinite(changeJob.progress) ? changeJob.progress : null} />
    : analyseJob
    ? <ReleaseAgentLine text={analysingCr ? t("build.release.agent.analysingChange", "The business analyst is analysing change {code}", { code: changeCode(analysingCr) })
      : t("build.release.agent.analysingAChange", "The business analyst is analysing a change")} progress={Number.isFinite(analyseJob.progress) ? analyseJob.progress : null} />
    : !hasDev && buildJob && isActiveEngineJob(buildJob)
      ? <ReleaseAgentLine text={firstMilestone ? t("build.release.agent.buildingMilestone", "The development team is building milestone {number}", { number: firstMilestone.number })
        : t("build.release.agent.buildingFirst", "The development team is building the first milestone")} progress={Number.isFinite(buildJob.progress) ? buildJob.progress : null} />
      : undefined;

  // a person who can neither send, release nor change (a viewer) is told what the page is for them
  const followsOnly = !ctx.can("release.request") && !ctx.can("release.promote") && !ctx.can("build.run") && step.phase !== "approve";
  const approverSomewhere = Boolean(ctx.userId) && policies.data.some((p) => p.policy.steps.some((st) => st.approverUserIds.includes(ctx.userId!)));
  // your part follows what your role may do: release, approve when asked, or follow along
  const yourPartNow = !followsOnly ? RELEASE_ROLE.you
    : approverSomewhere ? t("build.release.role.youApprover", "approve a version when it waits for you; your release manager releases it")
    : t("build.release.role.youFollow", "follow the release and read the release notes");
  // a release to staging or production whose newest deployment stopped while the release has no address yet: it is not
  // going live by itself, so the page says so instead of "going live in a moment"
  const stoppedDeploy = (() => {
    const seen = new Set<string>();
    for (const j of jobs) {
      const to = j.kind === "preview.deploy" ? deployTarget(j.inputJson) : null;
      if (!to) continue;
      const key = `${to.environment}:${to.version}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (j.status !== "failed") continue;
      if (releases.data.some((r) => r.environment === to.environment && r.version === to.version && !r.url)) {
        const why = j.message ? j.message.trim().replace(/[.\s]+$/, "") : "";
        return why
          ? t("build.release.page.deployStoppedWhy", "The deployment of v{version} to {env} stopped: {why}.", { version: to.version, env: envWord(to.environment), why })
          : t("build.release.page.deployStopped", "The deployment of v{version} to {env} stopped.", { version: to.version, env: envWord(to.environment) });
      }
    }
    return null;
  })();
  const outcome = [
    decide.error, create.error, promote.error, stoppedDeploy,
  ].find(Boolean);
  const success = promote.success ? t("build.release.page.releasedOk", "Released. It goes live in a moment.")
    : create.success ? t("build.release.page.sentOk", "Sent for approval.")
      : decide.success ? t("build.release.page.decidedOk", "Your decision is recorded.") : null;

  const showPreviews = ms.showPreviews;
  const details = (
    <div className="flex min-w-0 flex-col gap-8">
      {hasDev && (
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-[15px] font-medium">{t("build.release.page.eachEnvironment", "Each environment")}</h3>
            <EnvSwitcher states={states} value={shown} onChange={setEnv} live={{ dev: where.dev.state === "live", stage: where.stage.state === "live", production: where.production.state === "live" }} />
          </div>
          {hero}
          <EnvironmentsCard projectId={projectId} env={shown} state={shownState} where={where[shown]} changes={changes.data}
            stopped={(c) => changeStopped(c, latestJobFor(jobs, "change.build", { changeRequestId: c.id }))}
            buildingId={(() => { const j = jobs.find((x) => x.kind === "change.build" && isActiveEngineJob(x)); return j ? deliveryTargetOf(j) || null : null; })()}
            candidate={nextOf ? promotionCandidate(states, nextOf) : null} onPromote={promoteFromCard} />
        </div>
      )}
      {!hasDev && hero}
      {hasDev && (
        <div id="promotion" tabIndex={-1} className="flex min-w-0 scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)] flex-col outline-none">
          <Card title={t("build.release.page.approvalsAndRelease", "Approvals and release")}>
            <Tabs label={t("build.release.page.releaseTo", "Release to")} tabs={targets()} value={target} idPrefix="promote" onChange={(v) => setTarget(v)} />
            <div className="mt-5 flex min-w-0 flex-col gap-6">
              <PromotionPolicyNote environment={target} />
              <ApprovalRequestPanel ctx={ctx} environment={target} request={pending ?? forCandidate} candidateVersion={candidate} primary={false}
                moves={candidate ? promotionMoveText({ target, version: candidate, where, changes: changes.data, code: changeCode }) : null} />
              <PromoteAction ctx={ctx} environment={target} version={candidate} policy={policy} request={forCandidate} primary={false} />
            </div>
          </Card>
        </div>
      )}
      {policyEditor(target)}
      {/* an attached live product is changed through change requests: milestone previews only once one exists */}
      {showPreviews && <MilestonePreviews milestones={milestones.data} previews={previews.data} jobs={jobs} />}
      {changePanel}
    </div>
  );

  return (
    <div className={PAGE}>
      <StepFrame
        {...frame}
        yourPart={yourPartNow}
        status={step.status}
        statusTone={step.tone}
        primary={primary}
        extras={extras}
        chips={chips}
        chipsLabel={t("build.release.page.checklist", "Release checklist")}
        agentLine={agentLine}
        signedOff={signedOff}
        notices={<>
        <BlocksConnectNotice jobs={jobs} />
          {(unreadable || loadError) && (
            <p role="alert" className="text-[13px] text-danger">{loadError ? t("build.release.page.someNotLoaded", "Some release data could not be loaded.") : t("build.release.page.someUnreadable", "Some rows could not be read and are not shown.")}</p>
          )}
          {outcome && <p role="alert" className="text-[13px] text-danger">{outcome}</p>}
          {success && !outcome && <p role="status" className="text-[13px] text-[rgb(var(--c-success-text))]">{success}</p>}
        </>}
        details={details}
        detailsLabel={showPreviews ? t("build.release.page.detailsPreviews", "Details · each environment, approvals, previews, change requests")
          : t("build.release.page.details", "Details · each environment, approvals, change requests")}
        detailsOpen={detailsOpen}
      >
        <ReleaseMain states={states} where={where} step={step} notes={notes} attached={attached} />
      </StepFrame>
      <RejectDialog open={rejecting} busy={decide.pending} error={rejecting && decide.error ? String(decide.error) : null}
        stepName={myStepName || t("build.release.page.stepWord", "step")} onClose={() => setRejecting(false)}
        title={step.version ? t("build.release.page.rejectTitle", "Request changes to v{version}", { version: step.version })
          : t("build.release.page.rejectTitleAny", "Request changes to this release")}
        question={step.target ? t("build.release.page.rejectQuestion", "What has to change before it goes to {env}?", { env: envWord(step.target) })
          : t("build.release.page.rejectQuestionAny", "What has to change before it goes to the next environment?")}
        confirmLabel={t("build.release.page.requestChanges", "Request changes")}
        onConfirm={(comment) => {
          if (!req || step.myStep === null) return;
          clearNotices();
          void decide.run({ approvalRequestId: req.id, stepIndex: step.myStep, decision: "rejected", comment }).then((ok) => { if (ok) setRejecting(false); });
        }} />
      <Modal open={confirmProd} onClose={() => setConfirmProd(false)} title={step.version ? t("build.release.page.confirmProdTitle", "Release v{version} to production?", { version: step.version })
        : t("build.release.page.confirmProdTitleAny", "Release to production?")}
        footer={<>
          <Button variant="ghost" onClick={() => setConfirmProd(false)} disabled={promote.pending}>{t("build.release.page.notYet", "Not yet")}</Button>
          <Button variant="primary" disabled={promote.pending} icon={<Rocket size={16} strokeWidth={1.75} aria-hidden />}
            onClick={() => { if (step.version) { clearNotices(); void promote.run({ environment: "production", version: step.version }).then(() => setConfirmProd(false)); } }}>
            {promote.pending ? t("build.release.page.releasing", "Releasing…") : t("build.release.page.release", "Release")}
          </Button>
        </>}>
        <p className="text-[14px] text-ink2">{step.version
          ? t("build.release.page.confirmProdText", "Production is what your users work with. Every approval for v{version} is in.", { version: step.version })
          : t("build.release.page.confirmProdTextAny", "Production is what your users work with. Every approval for this version is in.")}</p>
      </Modal>
      <AttentionPanel open={attentionOpen} onClose={() => setAttentionOpen(false)} ctx={ctx} items={attention} jobs={jobs} />
      <ChangeRequestLayer />
    </div>
  );
}
