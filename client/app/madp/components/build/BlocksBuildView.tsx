/** The Build page, step 3 "Software Engineering" of the project stepper (STEP-STANDARD.md), of a SELISE Blocks project on the shared step frame: the development team
 *  (engineers + QA) builds a working preview milestone by milestone; you try the preview, give feedback and accept the
 *  milestone. Header: the one primary action (start the build, watch it, open the preview or accept the milestone), the
 *  checklist chips and the development team's line with the shimmer while a job runs. Main area: Overview (the milestone
 *  in plain words with its preview, then every milestone), and the build views Board (the tickets), Studio (the 3D
 *  office with the agent chat, pipeline, progress, gates and live feed) and Timeline (one track per stage with the
 *  inspector and proof, then every milestone with its build). Studio and Timeline read only real records: the build job
 *  (a milestone's build.run or a change request's change.build), its tickets and their events; while a change build runs
 *  (or is the newest build and no milestone is left) the header is about that change. Live follows those records as
 *  they arrive; Replay plays the recorded build back at 1x or 4x (useBuildReplay), never anything that was not
 *  recorded. The engine writes tickets, ticket events, previews and milestone status. Quality checks, the live feed
 *  and the build controls sit in Details. */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Check, ExternalLink, Hammer, Info, Layers, MessageSquarePlus, Pause, Play, Radio, SkipForward } from "lucide-react";
import { Button, Card, EmptyState, Label, Segmented, Select } from "@/madp/ui/kit";
import { EasedJobBar } from "@/madp/components/engine/EasedJobBar";
import { EngineJobStatus } from "@/madp/components/engine/EngineJobStatus";
import type { StageState } from "@/madp/data/pipeline";
import { useDeliveryContext } from "@/madp/blocks/delivery/context";
import { latestJobFor, useChangeRequests, useDeliveryJobs, useMilestones, usePreviews, useProjectTicketEvents, useReleases, useTickets } from "@/madp/blocks/delivery/hooks";
import { useBuildStart, useMilestoneAccept, useMilestoneFeedback, useRetryAfterDeploy } from "@/madp/blocks/delivery/actions";
import { cancelEngineJob, engineErrorMessage, retryEngineJob } from "@/madp/blocks/engine/actions";
import { isActiveEngineJob, type EngineJob } from "@/madp/blocks/engine/types";
import { useProject } from "@/madp/blocks/projects/reads";
import { FactoryOffice } from "@/madp/components/home/factoryOffice";
import { StageBoundary, StageFallback, stagesFromJob } from "@/madp/components/home/LiveFactoryCard";
import { latestPreviewFor } from "@/madp/components/delivery/MilestonePreviews";
import { BlocksBoardView } from "@/madp/components/board/BlocksBoardView";
import { columnName } from "@/madp/components/board/TicketHistory";
import { StepFrame, signOffText, type StepChip, type StepPrimary } from "@/madp/components/step/StepFrame";
import { ticketLabel } from "@/madp/data/board";
import { environmentStates } from "@/madp/domain/delivery";
import { appLink } from "@/madp/domain/appPreview";
import { phaseNumber, stepPath } from "@/madp/domain/phases";
import { phaseName, phaseNameOf, stepName } from "@/madp/components/project/stepNames";
import { formatDateTime } from "@/madp/lib/dates";
import { formatNumber } from "@/madp/i18n/format";
import { STEP_TABS, STEP_TAB_LABEL, linkedTimelineStage, resolveStepTab, searchWithStepTab, searchWithoutStage, type StepTab } from "./buildTabs";
import { buildGate } from "./blocksBuild";
import { BlocksChangeBuildView } from "./BlocksChangeBuildView";
import { ChangeRequestLayer } from "@/madp/components/changes/ChangeRequestLayer";
import { BuildOverview } from "./BuildOverview";
import { BuildQueue } from "./queue/BuildQueue";
import {
  BUILD_ROLE, CHANGE_BUILD_ROLE, buildStep, changeRunName, changeRunOf, changeWords, milestoneStopped, startAnswered, startSnapshot, worksByChanges, type BuildChipId,
  type StepChangeBuild,
} from "./buildStep";
import { ChangeRequestsCard, ChangesOverview } from "./ChangesOverview";
import { attachedLive } from "@/madp/components/analysis-next/model";
import { MilestoneBuildRow } from "./MilestoneBuildRow";
import { AcceptDialog, FeedbackDialog, FeedbackList, feedbackCount, feedbackOf } from "./MilestoneReview";
import {
  allBuildJobs, buildFocus, buildJobs, buildWindow, changeBuildScope, donePct, feedItems, fmtElapsed, focusAt, focusName, jobMilestoneId,
  qualityGates, stageStates, stepChangeOf, windowAt, type BuildChange, type ReplaySpeed,
} from "./model";
import { LiveFeed, QualityGates } from "./Panels";
import { StudioView } from "./StudioView";
import { TimelineView, useLitStage } from "./TimelineView";
import { useBuildReplay } from "./useBuildReplay";
import { BlocksConnectNotice } from "@/madp/components/engine/BlocksConnectCard";
import { openAfterDeploy } from "./afterDeployUi";
import { AfterDeployNotice } from "./AfterDeployNotice";
import { checksSettled } from "@/madp/domain/changeChecks";
import { WaitingForYouLine } from "./WaitingForYouLine";
import { UsagePill } from "@/madp/components/billing/UsagePill";
import { t, useT } from "@/madp/i18n";
import { toBuildUsage } from "@/madp/components/billing/types";
import { useJobUsage } from "@/madp/components/billing/billingData";

const ticketCode = (t: { number: number; planRef: string }) => ticketLabel(t);
/** A build's state in plain words (the Timeline's build picker); a cancelled build reads "stopped" like a failed one
 *  (one rule: src/components/changes/changeStopped.ts). */
const jobWord = (status: EngineJob["status"]): string => ({
  queued: t("build.page.job.queued", "waiting"), claimed: t("build.page.job.claimed", "starting"), running: t("build.page.job.running", "running"),
  succeeded: t("build.page.job.succeeded", "finished"), failed: t("build.page.job.failed", "stopped"), cancelled: t("build.page.job.cancelled", "stopped"),
} as Partial<Record<EngineJob["status"], string>>)[status] ?? status;
const PAGE = "flex w-full min-w-0 flex-col";

/** The clock the Studio and Timeline read while a build runs (elapsed time, the playhead moving in real time); still
 *  otherwise, and while the tab is in the background. */
function useNow(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const t = window.setInterval(() => { if (document.visibilityState !== "hidden") setNow(Date.now()); }, 1_000);
    return () => window.clearInterval(t);
  }, [live]);
  return now;
}

/** The same array while no stage visibly changes, so the 3D floor does not re-render on every clock tick. */
function useStableStages(value: StageState[]): StageState[] {
  const ref = useRef<{ key: string; value: StageState[] } | null>(null);
  const key = value.map((s) => `${s.id}:${s.status}:${s.progress ?? ""}:${s.caption ?? ""}`).join("|");
  if (!ref.current || ref.current.key !== key) ref.current = { key, value };
  return ref.current.value;
}

/** "The development team is building milestone 2… ▓▓▒░"; while the job waits for a person (the Blocks sign-in), the
 *  line without the working animation: nothing is being built until then. */
function BuildAgentLine({ text, progress, waiting = false }: { text: string; progress: number | null; waiting?: boolean }) {
  if (waiting) return <WaitingForYouLine text={text} />;
  return (
    <div role="status" className="flex flex-col gap-2 rounded-block bg-ai-soft px-3.5 py-2.5">
      <p className="flex items-center gap-2 text-[13px] text-[rgb(var(--c-ai-text))]">
        <Hammer size={15} aria-hidden className="shrink-0 animate-pulse motion-reduce:animate-none" />{text}…
      </p>
      <EasedJobBar progress={progress} ticks={false} active label={text} size="sm" />
    </div>
  );
}

/** The previews this person opened in this browser (a convenience: after trying it, the primary becomes Accept). */
function useOpenedPreviews(): { opened: (previewId: string | null | undefined) => boolean; mark: (previewId: string | null | undefined) => void } {
  const KEY = "mf:build:opened-previews";
  const [ids, setIds] = useState<string[]>(() => {
    try { const v = JSON.parse(window.localStorage.getItem(KEY) ?? "[]") as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []; } catch { return []; }
  });
  const mark = useCallback((id: string | null | undefined) => {
    if (!id) return;
    setIds((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id].slice(-200);
      try { window.localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* the page works without it */ }
      return next;
    });
  }, []);
  return { opened: (id) => Boolean(id && ids.includes(id)), mark };
}

/** The primary action when it opens the preview in a new tab (the frame's own primary links stay in the app). */
function PreviewPrimary({ url, label, onOpen }: { url: string; label: string; onOpen?: () => void }) {
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" onClick={onOpen}
      className="inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-accent px-5 text-[14px] font-medium text-white outline-none transition hover:bg-accent-hover focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas">
      <ExternalLink size={16} aria-hidden />{label}
    </a>
  );
}

const focusEl = (id: string) => window.setTimeout(() => {
  const el = document.getElementById(id);
  el?.scrollIntoView({ behavior: "smooth", block: "start" });
  el?.focus({ preventScroll: true });
}, 60);

export function BlocksBuildView({ projectId }: { projectId: string }) {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const ctx = useDeliveryContext(projectId);
  const record = useProject(projectId).data;
  const tickets = useTickets(ctx);
  const milestones = useMilestones(ctx);
  const previews = usePreviews(ctx);
  const releases = useReleases(ctx);
  const { jobs, isLoading: jobsLoading } = useDeliveryJobs(ctx);
  const events = useProjectTicketEvents(ctx);
  const changes = useChangeRequests(ctx);
  const settled = useMemo(() => checksSettled(changes.data), [changes.data]);
  const start = useBuildStart(ctx);
  const accept = useMilestoneAccept(ctx);
  const feedbackOp = useMilestoneFeedback(ctx);
  const retry = useRetryAfterDeploy(ctx);
  const openedPreviews = useOpenedPreviews();
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null);
  const [acceptFor, setAcceptFor] = useState<string | null>(null);
  const [pickedJob, setPickedJob] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  // the build and preview jobs on the page when a start was requested: its "requested" line shows until its job is here
  const [requestedOver, setRequestedOver] = useState<ReadonlySet<string> | null>(null);
  const [studioSeen, setStudioSeen] = useState(false);
  const tab = resolveStepTab({ tab: params.get("tab"), ticket: params.get("ticket") });
  const select = (tab: StepTab) => setParams((prev) => searchWithStepTab(prev, tab), { replace: true });
  // a linked Timeline stage (?stage=test, the Projects page's Tests link) is shown until the person picks another; it is
  // scrolled to and lit once the jobs are read
  const linkedStage = linkedTimelineStage(params.get("stage"));
  const litStage = useLitStage(linkedStage, tab === "timeline" && !jobsLoading);
  const unlinkStage = () => setParams((prev) => searchWithoutStage(prev), { replace: true });
  useEffect(() => { if (tab === "studio") setStudioSeen(true); }, [tab]);
  const showStudio = studioSeen || tab === "studio";
  // the Studio and the floor follow the running (else newest) build, a milestone's or a change request's; the Timeline
  // can show an earlier one
  const focus = useMemo(() => buildFocus({ jobs, milestones: milestones.data, tickets: tickets.data, events: events.data, changes: changes.data }),
    [jobs, milestones.data, tickets.data, events.data, changes.data]);
  const shown = useMemo(() => (pickedJob && pickedJob !== focus.job?.id
    ? buildFocus({ jobs, milestones: milestones.data, tickets: tickets.data, events: events.data, changes: changes.data, pickedJobId: pickedJob }) : focus),
  [focus, pickedJob, jobs, milestones.data, tickets.data, events.data, changes.data]);
  // every change build named by its change request (and increment), for the feed and the Timeline's build picker
  const changeOf = useMemo(() => {
    const out = new Map<string, BuildChange>();
    for (const j of jobs) {
      const s = j.kind === "change.build" ? changeBuildScope({ job: j, changes: changes.data, tickets: tickets.data, events: events.data, jobs }) : null;
      if (s) out.set(j.id, s.change);
    }
    return out;
  }, [jobs, changes.data, tickets.data, events.data]);
  const now = useNow(focus.live || shown.live);
  const win = useMemo(() => buildWindow(focus, now), [focus, now]);
  const shownWin = useMemo(() => (shown === focus ? win : buildWindow(shown, now)), [shown, focus, win, now]);
  // the replay plays the build shown on the Timeline (the focus unless an earlier build is picked) on both tabs
  const replay = useBuildReplay(shownWin, shown.job?.id ?? "none");
  const at = replay.at;
  const view = useMemo(() => (at === null ? shown : focusAt(shown, at)), [shown, at]);
  const viewWin = useMemo(() => (at === null || !shownWin ? shownWin : windowAt(shownWin, at)), [shownWin, at]);
  // the Studio follows the running build live; during a replay it shows the replayed build
  const studio = at === null ? focus : view;
  const studioWin = at === null ? win : viewWin;
  const stages = useMemo(() => stageStates(focus), [focus]);
  const studioStages = useStableStages(useMemo(() => (studio === focus ? stages : stageStates(studio)), [studio, focus, stages]));
  const shownStages = useMemo(() => (view === focus ? stages : stageStates(view)), [view, focus, stages]);
  const gates = useMemo(() => qualityGates(studio, columnName), [studio]);
  const liveGates = useMemo(() => (studio === focus ? gates : qualityGates(focus, columnName)), [studio, focus, gates]);
  const allFeed = useMemo(() => feedItems({
    jobs, events: events.data, tickets: tickets.data, ticketCode, columnName,
    jobLabel: (j) => { const c = changeOf.get(j.id); return c?.code ? changeRunName(changeWords(c), changeRunOf(j)) : null; },
  }), [jobs, events.data, tickets.data, changeOf]);
  const feed = useMemo(() => (at === null ? allFeed : allFeed.filter((i) => i.at <= at)), [allFeed, at]);
  const active: EngineJob | undefined = jobs.find((j) => j.kind === "build.run" && isActiveEngineJob(j));
  const changeJob = active ? null : jobs.find((j) => j.kind === "change.build" && isActiveEngineJob(j)) ?? null;
  // the floor follows the build in focus, a milestone's or a change request's: its tickets' real columns (the replayed
  // ones during a replay)
  const officeStages = useStableStages(studio.job ? studioStages : stagesFromJob(null));
  // what the build in focus has cost: so far while it runs (its finished parts), its charge once it has ended
  const focusRunning = focus.job ? isActiveEngineJob(focus.job) : false;
  const focusUsage = useJobUsage(focus.job?.workspaceId, focus.job?.id);

  // the same header as every step: title · project, the role line (no workspace or client line above the title);
  // loading and errors keep it, so the page never jumps out of the step frame
  const title = phaseName("engineering");
  // an existing product attached as it is live works through change requests: its words say so from the first frame
  const live = attachedLive(record ?? null);
  const frame = { title, subject: ctx.project?.name ?? record?.name, role: BUILD_ROLE.who, deliverable: (live ? CHANGE_BUILD_ROLE : BUILD_ROLE).delivers };
  if (ctx.status === "loading") return <StepFrame {...frame} status={t("build.page.loading", "Loading the build…")} statusTone="waiting" />;
  if (ctx.status === "not_found") {
    return <StepFrame {...frame}><Card><EmptyState title={t("build.page.notFoundTitle", "This project doesn't exist")} text={t("build.page.notFoundText", "It may have been removed, or you are not a member of its workspace.")} /></Card></StepFrame>;
  }
  if (ctx.status === "error" || !ctx.project) {
    return <StepFrame {...frame} status={t("build.page.loadFailed", "The build could not be loaded")} statusTone="attention"><p role="alert" className="text-[14px] text-danger">{ctx.error ?? t("build.page.loadFailedSentence", "The build could not be loaded.")}</p></StepFrame>;
  }

  const crParam = params.get("cr");
  const crNumber = crParam ? Number(crParam) : NaN;
  if (crParam && Number.isInteger(crNumber)) return <BlocksChangeBuildView ctx={ctx} number={crNumber} />;

  const project = ctx.project;
  // your part follows what your role may do: accept (build.run), give feedback (comment) or follow along; on a product
  // that works through change requests: approve each change and try it on development
  const canRunBuilds = ctx.can("build.run");
  const canFeedback = canRunBuilds || ctx.can("comment");
  const wordsFor = (byChanges: boolean) => {
    const r = byChanges ? CHANGE_BUILD_ROLE : BUILD_ROLE;
    return {
      role: r.who, deliverable: r.delivers,
      yourPart: canRunBuilds ? r.you
        : byChanges ? (canFeedback ? t("build.page.yourPart.changeFeedback", "try each change on development and give feedback; the project team approves it") : t("build.page.yourPart.changeFollow", "follow the build and try each change on development"))
          : canFeedback ? t("build.page.yourPart.feedback", "try the preview and give feedback; the project team accepts the milestone") : t("build.page.yourPart.follow", "follow the build and try the preview"),
    };
  };
  let { role, deliverable, yourPart } = wordsFor(live);

  if (!project.scopeLocked) {
    return (
      <StepFrame title={title} subject={project.name} role={role} deliverable={deliverable} yourPart={yourPart}
        status={t("build.page.waitingScope", "Waiting for the locked scope")} statusTone="waiting"
        primary={{ label: t("build.page.openScope", "Open the scope"), href: stepPath(projectId, "scope") }}>
        <Card>
          <EmptyState icon={<Layers size={28} strokeWidth={1.75} />} title={t("build.page.scopeFirstTitle", "The build starts once the scope is locked")}
            text={t("build.page.scopeFirstText", "The approver locks the scope and its milestones in {part}, the last part of step {number}, {phase}. The development team builds from there.", { part: stepName("scope"), number: phaseNumber("scope"), phase: phaseNameOf("scope") })} />
        </Card>
      </StepFrame>
    );
  }

  // the first read of the milestones, tickets, jobs and previews: the step waits for it instead of flashing "0 of 0"
  if (milestones.isLoading || tickets.isLoading || jobsLoading || previews.isLoading || changes.isLoading) {
    return <StepFrame title={title} subject={project.name} role={role} deliverable={deliverable} yourPart={yourPart} status={t("build.page.loading", "Loading the build…")} statusTone="waiting" />;
  }

  const list = milestones.data;
  // no milestones and an existing product attached as it is live (or change requests already): change requests, not
  // milestones, are what is built here
  const byChanges = worksByChanges({ milestones: list.length, attachedLive: live, changes: changes.data.length });
  ({ role, deliverable, yourPart } = wordsFor(byChanges));
  const counts: Record<string, number> = {};
  for (const tk of tickets.data) if (tk.milestoneId) counts[tk.milestoneId] = (counts[tk.milestoneId] ?? 0) + 1;
  const canRun = ctx.can("build.run");
  const failedDelivery = [...jobs].filter((job) => ["build.run", "change.build", "preview.deploy"].includes(job.kind) && job.status === "failed"
    && !jobs.some((later) => later.kind === job.kind && later.status === "succeeded"
      && jobMilestoneId(later) === jobMilestoneId(job) && (later.createdAt ?? "") > (job.createdAt ?? "")))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0];
  const retryFailed = async () => {
    if (!failedDelivery) return;
    setRetryingId(failedDelivery.id);
    setRetryError(null);
    try { await retryEngineJob(failedDelivery.id); }
    catch (error) { setRetryError(engineErrorMessage(error)); }
    finally { setRetryingId(null); }
  };
  const gate = buildGate({ milestones: list, ticketCounts: counts, jobs, canRun });
  const previewOf = (id: string) => latestPreviewFor(previews.data, id);
  // the automatic tests of the milestone the step is about: its newest build (the running one while it runs)
  const testsOf = (milestoneId: string | null) => {
    const job = milestoneId ? buildJobs(jobs).find((j) => jobMilestoneId(j) === milestoneId) : null;
    if (!job) return null;
    const f = job.id === focus.job?.id ? focus : buildFocus({ jobs, milestones: list, tickets: tickets.data, events: events.data, pickedJobId: job.id });
    const g = (f === focus ? liveGates : qualityGates(f, columnName)).find((x) => x.id === "04");
    return g ? { state: g.state, detail: g.detail } : null;
  };
  // the newest build when it is a change request's: its change, increment, tickets and automatic tests
  const changeTests = liveGates.find((g) => g.id === "04");
  // a build whose code is on development but whose steps after the deploy (data tables, texts) are not all finished
  // a change's failing checks marked known before it, or passing since on a later version, are not its (checksSettled)
  const unfinishedOf = (kind: "build.run" | "change.build", id: string) =>
    openAfterDeploy(jobs, { kind, id, ...(kind === "change.build" ? { checks: changes.data.find((c) => c.id === id)?.checks ?? null, settled } : {}) });
  const changeUnfinished = focus.change ? unfinishedOf("change.build", focus.change.id) : null;
  const changeBuild: StepChangeBuild | null = stepChangeOf(focus, {
    tests: changeTests ? { state: changeTests.state, detail: changeTests.detail } : null,
    unfinished: changeUnfinished?.attention ?? null,
  });
  const step = buildStep({
    milestones: list, tickets: tickets.data, previewOf, jobs, gate,
    tests: testsOf,
    canAccept: canRun,
    feedback: (id) => feedbackCount(tickets.data, id),
    previewOpened: (id) => openedPreviews.opened(previewOf(id)?.id),
    change: changeBuild,
    unfinished: (id) => unfinishedOf("build.run", id)?.attention ?? null,
    byChanges,
  });
  const current = step.current;
  // the line about the steps after the deploy: the change the header is about, else the milestone in focus
  const unfinishedNow = step.change && changeUnfinished ? { open: changeUnfinished, what: step.change.code ?? t("build.page.theChange", "The change") }
    : current && (step.phase === "review" || step.phase === "complete") && !step.change ? (() => {
      const open = unfinishedOf("build.run", current.id);
      return open ? { open, what: t("build.page.milestoneN", "Milestone {number}", { number: current.number }) } : null;
    })() : null;
  const currentPreview = current ? previewOf(current.id) : null;
  const previewUrl = currentPreview ? appLink(currentPreview)?.href ?? null : null;
  const replayLine = at === null ? null : feed[0]?.text ?? null;
  // "This build" in the usage pill: the same charge the credit and the project figures are made of
  const buildUsage = focus.job ? toBuildUsage(focusUsage.data, focusRunning) : null;
  const officeCaption = at !== null ? replayLine ?? undefined : (focus.live ? focus.job : null)?.message ?? undefined;
  const builds = allBuildJobs(jobs);
  // the project has more recorded ticket updates than are read: the oldest are left out, so the counts below say so
  const eventsCapped = events.capped ? <EventsCappedNote shown={events.data.length} total={events.totalCount} /> : null;
  const feedWin = at === null ? win : shownWin;
  const when = (ms: number) => (feedWin && ms >= feedWin.start && ms <= feedWin.end ? t("build.page.intoBuild", "{elapsed} into the build", { elapsed: fmtElapsed(ms - feedWin.start) }) : formatDateTime(ms));
  const buildName = (j: EngineJob) => {
    if (j.kind === "change.build") {
      const c = changeOf.get(j.id);
      const run = changeRunOf(j);
      const name = (c ? focusName({ milestone: null, change: c }) : null) ?? t("build.page.changeBuild", "Change build");
      return run.kind === "fix" ? t("build.page.buildFixRound", "{name} (fix round {round})", { name, round: run.round })
        : run.kind === "revert" ? t("build.page.buildPutBack", "{name} (putting development back)", { name }) : name;
    }
    const m = list.find((x) => x.id === jobMilestoneId(j));
    return m ? t("build.page.milestoneNamed", "Milestone {number}: {name}", { number: m.number, name: m.name }) : t("build.page.milestoneBuild", "Milestone build");
  };
  const openChange = (n: number) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    next.delete("tab"); next.delete("ticket"); next.set("cr", String(n));
    return next;
  });
  // the build to cancel: the milestone's, else the change request's (the running build is the one in focus)
  const running = active ?? changeJob;
  // what Cancel stops, in one sentence (each language words it whole)
  const cancelHint = (() => {
    if (focus.change) {
      const what = changeWords(focus.change);
      const run = changeRunOf(focus.job);
      switch (run.kind) {
        case "fix": return t("build.page.stops.fix", "Stops fix round {round} of {what}; it can be started again.", { what, round: run.round });
        case "revert": return t("build.page.stops.revert", "Stops putting development back without {what}; it can be started again.", { what });
        case "finish": return t("build.page.stops.finish", "Stops the steps after the deploy of {what}; it can be started again.", { what });
        default: return t("build.page.stops.change", "Stops the build of {what}; it can be started again.", { what });
      }
    }
    return focus.milestone ? t("build.page.stops.milestone", "Stops the build of milestone {number}; it can be started again.", { number: focus.milestone.number })
      : t("build.page.stops.this", "Stops the build of this milestone; it can be started again.");
  })();
  const error = start.error ?? cancelError;
  const readError = milestones.error ?? tickets.error;
  // a new start clears the notices of the previous build (its cancel line or error)
  const runBuild = (milestoneId: string) => {
    accept.reset(); feedbackOp.reset(); setCancelled(false); setCancelError(null);
    setRequestedOver(startSnapshot(jobs));
    void start.run({ milestoneId });
  };
  // the requested job is on the page now (running, waiting for you or stopped): it speaks for itself
  const requestedShown = start.success !== null && !startAnswered(jobs, requestedOver);
  const stoppedOf = (milestoneId: string) => milestoneStopped(jobs, milestoneId);

  const cancel = async () => {
    if (!running) return;
    setCancelError(null); setCancelled(false);
    // the start's "requested" line is about the build that is being cancelled now
    try { await cancelEngineJob(running.id); start.reset(); setCancelled(true); } catch (e) { setCancelError(engineErrorMessage(e)); }
  };

  // the one primary action
  let primary: StepPrimary | null = null;
  let primaryAction: ReactNode = null;
  switch (step.primary.kind) {
    case "start":
      primary = {
        label: step.primary.label, icon: <Hammer size={16} strokeWidth={1.75} aria-hidden />, disabled: step.primary.disabled,
        reason: step.primary.reason ?? undefined, pending: start.pending, pendingLabel: step.previewOnly ? t("build.page.requestingPreview", "Requesting the preview…") : t("build.page.starting", "Starting the build…"),
        onClick: () => gate.milestone && runBuild(gate.milestone.id),
      };
      break;
    case "watch":
      primary = {
        label: step.primary.label, icon: <Play size={16} strokeWidth={1.75} aria-hidden />,
        onClick: () => { select("studio"); window.setTimeout(() => document.querySelector('[data-build-panel="studio"]')?.scrollIntoView({ behavior: "smooth", block: "start" }), 60); },
      };
      break;
    case "preview":
      primaryAction = previewUrl ? (
        <div className="flex flex-col items-stretch gap-1 sm:items-end">
          <PreviewPrimary url={previewUrl} label={step.primary.label} onOpen={() => openedPreviews.mark(currentPreview?.id)} />
          {step.primary.reason && <span className="max-w-[22rem] text-[12px] text-ink3 sm:text-right">{step.primary.reason}</span>}
        </div>
      ) : null;
      break;
    case "accept":
      primary = {
        label: step.primary.label, icon: <Check size={16} strokeWidth={2} aria-hidden />, pending: accept.pending, pendingLabel: t("build.page.accepting", "Accepting…"),
        reason: step.primary.reason ?? undefined,
        onClick: () => { if (current) { accept.reset(); setAcceptFor(current.id); } },
      };
      break;
    case "change":
      primary = {
        label: step.primary.label, disabled: step.primary.disabled, reason: step.primary.reason ?? undefined,
        href: step.change?.number != null ? `/p/${projectId}/build?cr=${step.change.number}` : undefined,
      };
      break;
    default:
      primary = { label: step.primary.label, disabled: step.primary.disabled, reason: step.primary.reason ?? undefined, href: step.primary.kind === "release" ? stepPath(projectId, "release") : undefined };
  }

  // the chips open their part of the page
  const CHIP_OPEN: Partial<Record<BuildChipId, () => void>> = {
    milestone: () => { select("overview"); focusEl("build-milestones"); },
    change: () => { if (step.change?.number != null) openChange(step.change.number); },
    increment: () => { if (step.change?.number != null) openChange(step.change.number); },
    tickets: () => select("board"),
    preview: () => { select("overview"); focusEl("build-preview"); },
    tests: () => select("studio"),
    accepted: () => {
      if (step.primary.kind === "accept" && current) { accept.reset(); setAcceptFor(current.id); return; }
      select("overview"); focusEl("build-preview");
    },
    feedback: () => {
      if (canFeedback && current && current.status === "preview-ready" && previewUrl && step.phase === "review") { feedbackOp.reset(); accept.reset(); setFeedbackFor(current.id); return; }
      select("overview"); focusEl("build-preview");
    },
  };
  const chips: StepChip[] = step.chips.map((c) => ({
    id: c.id, label: c.label, value: c.value, state: c.state, title: c.title, onClick: CHIP_OPEN[c.id],
    todoLabel: c.id === "accepted" ? t("build.page.chipTodoAccept", "accept") : c.id === "feedback" ? t("build.page.chipTodoGive", "give") : undefined, editableAfterSignOff: c.id !== "accepted" && c.id !== "feedback",
  }));

  // after the sign-off: who accepted the last milestone, or the release that delivered every milestone
  const devRelease = environmentStates(releases.data).dev.history.at(-1) ?? null;
  const last = [...list].sort((a, b) => b.sortOrder - a.sortOrder || b.number - a.number)[0] ?? null;
  const acceptedText = (m: { acceptedAt: string | null; acceptedByUserId: string | null }) =>
    m.acceptedAt ? signOffText({ verb: t("build.page.signOff.accepted", "Accepted"), by: m.acceptedByUserId ? ctx.memberName(m.acceptedByUserId) : null, at: m.acceptedAt }) : null;
  const signedOff = step.phase === "complete" && list.length > 0 && !step.change ? {
    text: last?.acceptedAt
      ? signOffText({ verb: t("build.page.signOff.milestoneAccepted", "Milestone {number} accepted", { number: last.number }), by: last.acceptedByUserId ? ctx.memberName(last.acceptedByUserId) : null, at: last.acceptedAt })
      : devRelease
        ? signOffText({ verb: list.length === 1 ? t("build.page.signOff.deliveredOne", "Milestone delivered with release {version}", { version: devRelease.version })
          : t("build.page.signOff.deliveredAll", "All {count} milestones delivered with release {version}", { count: list.length, version: devRelease.version }), at: devRelease.releasedAt })
        : signOffText({ verb: list.length === 1 ? t("build.page.signOff.oneAccepted", "Milestone accepted") : t("build.page.signOff.allAccepted", "All {count} milestones accepted", { count: list.length }) }),
    extra: !last?.acceptedAt ? undefined : devRelease ? t("build.page.signOff.onDev", "release {version} on development", { version: devRelease.version }) : t("build.page.signOff.onItsWay", "the release to development is on its way"),
    next: { label: t("build.page.signOff.goTo", "Go to {phase}", { phase: phaseName("release") }), href: stepPath(projectId, "release") },
  } : null;

  // your part on the milestone in focus: feedback and acceptance
  const reviewable = Boolean(current && current.status === "preview-ready" && previewUrl);
  const myFeedback = current ? feedbackOf(tickets.data, current.id) : [];
  const acceptMilestone = acceptFor ? list.find((m) => m.id === acceptFor) ?? null : null;
  const feedbackMilestone = feedbackFor ? list.find((m) => m.id === feedbackFor) ?? null : null;
  const isLast = (id: string) => list.every((m) => m.id === id || m.status === "done");
  const previewActions = reviewable && current ? (<>
    {canFeedback && <Button size="sm" variant="secondary" icon={<MessageSquarePlus size={14} strokeWidth={1.75} aria-hidden />}
      onClick={() => { feedbackOp.reset(); accept.reset(); setFeedbackFor(current.id); }}>{t("build.page.giveFeedback", "Give feedback")}</Button>}
    {canRun && step.primary.kind !== "accept" && (
      <Button size="sm" variant="ghost" icon={<Check size={14} strokeWidth={2} aria-hidden />} disabled={step.feedback.open > 0 || step.phase !== "review"}
        onClick={() => { accept.reset(); setAcceptFor(current.id); }}>{t("build.page.accept", "Accept")}</Button>
    )}
  </>) : null;

  // replay works on any build with a recorded start; live is offered while the build in focus runs
  const replayable = (tab === "studio" || tab === "timeline") && shownWin !== null;
  const followsLive = focus.live && shown === focus;
  const replayControls = replayable ? (<>
    <Button variant="ghost" size="sm" onClick={replay.playing ? replay.pause : replay.play}
      aria-label={replay.playing ? t("build.page.replay.pauseLabel", "Pause the replay") : at === null ? t("build.page.replay.replayLabel", "Replay the recorded build") : t("build.page.replay.playLabel", "Play the replay")}
      icon={replay.playing ? <Pause size={15} strokeWidth={1.75} aria-hidden className="shrink-0" /> : <Play size={15} strokeWidth={1.75} aria-hidden className="shrink-0" />}>
      {replay.playing ? t("build.page.replay.pause", "Pause") : at === null ? t("build.page.replay.replay", "Replay") : t("build.page.replay.play", "Play")}
    </Button>
    <Segmented<ReplaySpeed> label={t("build.page.replay.speed", "Replay speed")} value={replay.speed} onChange={replay.setSpeed} options={[{ value: "1x", label: "1x" }, { value: "4x", label: "4x" }]} />
    {followsLive ? (
      <Button variant="ghost" size="sm" onClick={replay.live} aria-pressed={at === null} className={at === null ? "text-accent" : undefined}
        icon={<Radio size={15} strokeWidth={1.75} aria-hidden className="shrink-0" />}
        title={at === null ? t("build.page.replay.following", "Following the build live") : t("build.page.replay.backToLive", "Back to the live build")}>{t("build.page.replay.live", "Live")}</Button>
    ) : at !== null && (
      <Button variant="ghost" size="sm" onClick={replay.live} icon={<SkipForward size={15} strokeWidth={1.75} aria-hidden className="shrink-0" />}>{t("build.page.replay.skip", "Skip to the end")}</Button>
    )}
  </>) : null;

  const MAIN_TITLE: Record<StepTab, string> = {
    overview: byChanges ? t("build.page.yourChanges", "Your change requests") : current ? t("build.page.milestoneTitle", "Milestone {number} · {name}", { number: current.number, name: current.name }) : t("build.page.yourMilestones", "Your milestones"),
    board: STEP_TAB_LABEL.board, queue: STEP_TAB_LABEL.queue, studio: STEP_TAB_LABEL.studio, timeline: STEP_TAB_LABEL.timeline,
  };

  const details = (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-4">
        {failedDelivery && canRun && (
          <Card title={t("build.page.recovery", "Build recovery")}>
            <EngineJobStatus job={failedDelivery} variant="compact" canRetry={!jobs.some(isActiveEngineJob)}
              onRetry={() => void retryFailed()} retrying={retryingId === failedDelivery.id} requestError={retryError} />
          </Card>
        )}
        <div>
          <Label>{focus.milestone ? t("build.page.checksOfMilestone", "Automatic quality checks · milestone {number}", { number: focus.milestone.number })
            : focus.change?.code ? t("build.page.checksOf", "Automatic quality checks · {what}", { what: changeWords(focus.change) }) : t("build.page.checks", "Automatic quality checks")}</Label>
          {focus.job ? <QualityGates gates={liveGates} /> : <p className="text-[13px] text-ink2">{t("build.page.checksFirst", "They run with the first build.")}</p>}
        </div>
        {running && canRun && (
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button size="sm" onClick={() => void cancel()}>{t("build.page.cancel", "Cancel the build")}</Button>
            <span className="text-[12px] text-ink3">{cancelHint}</span>
          </div>
        )}
      </div>
      <LiveFeed items={allFeed} live={focus.live} when={when} maxHeight={260} />
    </div>
  );

  return (
    <div className={PAGE}>
      <StepFrame
        title={title}
        subject={project.name}
        status={step.status}
        statusTone={step.tone}
        role={role}
        deliverable={deliverable}
        yourPart={yourPart}
        primary={primary}
        primaryAction={primaryAction}
        extras={<>
          <UsagePill projectId={projectId} build={buildUsage} />
          {step.primary.kind === "accept" && previewUrl && (
          <a href={previewUrl} target="_blank" rel="noopener noreferrer" onClick={() => openedPreviews.mark(currentPreview?.id)}
            aria-label={current ? t("build.page.openPreviewOf", "Open the preview of milestone {number}", { number: current.number }) : t("build.page.openPreview", "Open the preview")}
            className="inline-flex h-11 items-center gap-2 whitespace-nowrap rounded-full bg-surface px-5 text-[14px] font-medium text-ink outline-none ring-1 ring-inset ring-line transition hover:bg-surface2 focus-visible:ring-2 focus-visible:ring-accent/50">
            <ExternalLink size={15} strokeWidth={1.75} aria-hidden />{t("build.page.openPreview", "Open the preview")}
          </a>
          )}
        </>}
        chips={chips}
        chipsLabel={t("build.page.checklist", "Build checklist")}
        agentLine={step.agent ? <BuildAgentLine text={step.agent.text} progress={step.agent.progress} waiting={step.agent.waiting} /> : undefined}
        signedOff={signedOff}
        notices={<>
        <BlocksConnectNotice jobs={jobs} />
          {requestedShown && (step.phase === "ready" || step.phase === "planning" || step.phase === "stopped") && <p role="status" className="text-[13px] text-[rgb(var(--c-success-text))]">{start.success}</p>}
          {step.stopReason && !requestedShown && <p role="status" className="text-[13px] text-danger">{step.stopReason}</p>}
          {cancelled && <p role="status" className="text-[13px] text-[rgb(var(--c-success-text))]">{t("build.page.cancelled", "The build was cancelled.")}</p>}
          {(error || readError) && <p role="alert" className="text-[13px] text-danger">{error ?? readError}</p>}
          {accept.success && !acceptFor && <p role="status" className="text-[13px] text-[rgb(var(--c-success-text))]">{t("build.page.acceptedThanks", "Milestone accepted. Thank you.")}</p>}
          {feedbackOp.success && !feedbackFor && step.feedback.open > 0 && <p role="status" className="text-[13px] text-[rgb(var(--c-success-text))]">{t("build.page.feedbackSent", "Your feedback is with the development team. A new preview follows.")}</p>}
          {unfinishedNow && (
            <AfterDeployNotice open={unfinishedNow.open} what={unfinishedNow.what} canRun={canRun}
              onFinish={() => void retry.run({ jobId: unfinishedNow.open.job.id })} pending={retry.pending} error={retry.error} success={retry.success} />
          )}
        </>}
        mainTitle={MAIN_TITLE[tab]}
        mainActions={<>
          <Segmented<StepTab> label={t("build.page.views", "Build views")} options={STEP_TABS.map((tab) => ({ value: tab, label: STEP_TAB_LABEL[tab] }))} value={tab} onChange={select} className="max-w-full overflow-x-auto" />
          {replayControls}
        </>}
        details={details}
        detailsLabel={t("build.page.details", "Details · quality checks, live feed")}
      >
        <section data-build-panel="overview" aria-label={STEP_TAB_LABEL.overview} hidden={tab !== "overview"}>
          {byChanges ? (
            <ChangesOverview projectId={projectId} changes={changes.data} tickets={tickets.data} jobs={jobs}
              focusNumber={step.change?.number ?? null} now={step.change} onOpenBoard={() => select("board")} onOpenQueue={() => select("queue")} />
          ) : <BuildOverview step={step} milestones={list} tickets={tickets.data} previewOf={previewOf}
            runningId={active ? jobMilestoneId(active) : null} stoppedOf={stoppedOf} acceptedText={acceptedText}
            alsoStart={step.alsoStart ? { label: t("build.step.primary.startMilestone", "Start the build of milestone {number}", { number: step.alsoStart.number }), onClick: () => runBuild(step.alsoStart!.id), disabled: start.pending } : null}
            previewActions={previewActions} onPreviewOpen={(id) => openedPreviews.mark(previewOf(id)?.id)}
            previewFooter={<FeedbackList items={myFeedback} projectId={projectId} />}
            onOpenBoard={() => select("board")} onOpenQueue={() => select("queue")} />}
        </section>
        <section data-build-panel="board" aria-label={STEP_TAB_LABEL.board} hidden={tab !== "board"}>
          <BlocksBoardView projectId={projectId} highlightTicketId={params.get("ticket")} />
        </section>
        <section data-build-panel="queue" aria-label={STEP_TAB_LABEL.queue} hidden={tab !== "queue"}>
          {eventsCapped}
          {/* mounted only while shown: the map fits itself to its real size */}
          {tab === "queue" && (
            <BuildQueue ctx={ctx} projectId={projectId} tickets={tickets.data} loading={tickets.isLoading} events={events.data}
              milestones={list} jobs={jobs} changes={changes.data} byChanges={byChanges} currentMilestoneId={current?.id ?? null} onOpenBoard={() => select("board")} />
          )}
        </section>
        <section data-build-panel="studio" aria-label={STEP_TAB_LABEL.studio} hidden={tab !== "studio"}>
          {eventsCapped}
          {showStudio && (
            <StudioView hud={<UsagePill variant="hud" projectId={projectId} build={buildUsage} />} focus={studio} window={studioWin} stages={studioStages} gates={gates} feed={feed} when={when}
              replay={at === null ? null : { pct: donePct(studio.tickets), line: replayLine, playing: replay.playing }}
              stage={
                <StageBoundary fallback={<StageFallback text={t("build.page.floorUnavailable", "The factory floor is not available on this screen.")} />}>
                  <Suspense fallback={<StageFallback text={t("build.page.floorOpening", "Opening the factory floor…")} pulse />}>
                    <FactoryOffice variant="full" chat projectId={projectId} follow stages={officeStages} caption={officeCaption} paused={at !== null && !replay.playing} className="min-h-[320px] w-full flex-1" />
                  </Suspense>
                </StageBoundary>
              } />
          )}
        </section>
        <section data-build-panel="timeline" aria-label={STEP_TAB_LABEL.timeline} hidden={tab !== "timeline"}>
          {eventsCapped}
          {builds.length > 1 && (
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="text-[13px] text-ink2">{t("build.page.buildShown", "Build shown")}</span>
              <Select label={t("build.page.buildShown", "Build shown")} size="sm" value={shown.job?.id ?? ""} onChange={(v) => setPickedJob(v)}
                options={builds.map((j) => ({ value: j.id, label: `${/"feedback"\s*:\s*true/.test(j.inputJson ?? "") ? t("build.page.yourFeedback", "{name} (your feedback)", { name: buildName(j) }) : buildName(j)} · ${jobWord(j.status)}${j.createdAt ? ` · ${formatDateTime(j.createdAt)}` : ""}` }))} />
            </div>
          )}
          <div className="mb-6">
            <TimelineView key={shown.job?.id ?? "none"} focus={view} window={viewWin} stages={shownStages} ticketCode={ticketCode} columnName={columnName} replaying={at !== null}
              linkedStage={linkedStage} onUnlink={unlinkStage} lit={litStage} />
          </div>
          {byChanges ? (
            <ChangeRequestsCard projectId={projectId} changes={changes.data} tickets={tickets.data} jobs={jobs} focusId={focus.change?.id ?? null} />
          ) : <>
          <h3 className="mb-3 text-[15px] font-medium text-ink">{t("build.page.milestones", "Milestones")}</h3>
          {milestones.isLoading ? <p role="status" className="text-[14px] text-ink3">{t("build.page.loadingMilestones", "Loading the milestones…")}</p>
            : list.length === 0 ? (
              <Card><EmptyState icon={<Layers size={28} strokeWidth={1.75} />} title={t("build.page.noMilestonesTitle", "No milestones yet")} text={t("build.page.noMilestonesText", "The locked scope has no milestones to build.")} /></Card>
            ) : (
              <div className="space-y-4">
                {list.map((m) => (
                  <MilestoneBuildRow key={m.id} milestone={m} tickets={tickets.data} jobs={jobs} stopped={stoppedOf(m.id)}
                    preview={previewOf(m.id) ?? null}
                    previewJob={latestJobFor(jobs, "preview.deploy", { milestoneId: m.id }) ?? null} />
                ))}
              </div>
            )}
          </>}
        </section>
      </StepFrame>
      <FeedbackDialog open={feedbackFor !== null} projectId={projectId} milestone={feedbackMilestone} pending={feedbackOp.pending} error={feedbackOp.error}
        onClose={() => setFeedbackFor(null)}
        onSend={(text, files) => (feedbackFor ? feedbackOp.run({ milestoneId: feedbackFor, text, ...(files ?? {}) }) : Promise.resolve(false))} />
      <AcceptDialog open={acceptFor !== null} milestone={acceptMilestone} version={acceptFor ? previewOf(acceptFor)?.version ?? null : null}
        last={acceptFor ? isLast(acceptFor) : false} pending={accept.pending} error={accept.error}
        onClose={() => setAcceptFor(null)}
        onAccept={() => { if (acceptFor) void accept.run({ milestoneId: acceptFor }).then((ok) => { if (ok) setAcceptFor(null); }); }} />
      <ChangeRequestLayer />
    </div>
  );
}

/** Shown when the project has more recorded ticket updates than the Build page reads: the newest are all there, the
 *  oldest are left out, and every count from them (records, send-backs, the feed) says so. */
export function EventsCappedNote({ shown, total }: { shown: number; total: number }) {
  const t = useT();
  return (
    <p className="mb-4 flex items-start gap-2 text-[13px] text-ink3">
      <Info size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />
      {t("build.page.eventsCapped", "Showing the newest {shown} of {total} recorded ticket updates. The oldest are left out of the counts here.",
        { shown: formatNumber(shown), total: formatNumber(total) })}
    </p>
  );
}
