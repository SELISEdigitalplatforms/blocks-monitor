/** Dashboard: the workspace at a glance. A strip of four numbers (projects, in build, released, waiting for you), the
 *  "Live now" 3D office of the focused project (display only, driven by the team's real work), the project list with
 *  where each one stands, and three cards: recent activity, releases, and what is waiting for you. */
import { openGuidedStart } from "@/madp/components/guided/store";
import { Suspense, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  AlertCircle, ArrowUpRight, Clapperboard, DoorOpen, FolderKanban, GitPullRequest, Hammer, History, Inbox, Info, ListChecks, Plus, Rocket, Workflow,
} from "lucide-react";
import { DASHBOARD_CAPPED_TEXT, useDashboardData } from "@/madp/blocks/dashboard/hooks";
import { useBlocksContext } from "@/madp/blocks/context";
import { useSession } from "@/madp/blocks/session";
import { useWorkspaces } from "@/madp/blocks/workspaces/store";
import {
  ENV_LABEL, kpis, latestActivity, liveNow, recentActivity, relativeTime, releaseRows, stepPath, yourProjects,
  type ActivityKind, type DashProject,
} from "@/madp/domain/dashboard";
import { projectsNow, waitingCount, waitingForYou } from "@/madp/domain/projectNow";
import { useNowTeam, WaitingForYouCard, WorkingLine } from "@/madp/components/home/ProjectNowParts";
import { PHASE_COUNT, phaseNumber } from "@/madp/domain/phases";
import { phaseName, phaseNameOf } from "@/madp/components/project/stepNames";
import { cn } from "@/madp/lib/cn";
import { Banner, Bar, Button, Card, Chip, EmptyState, PageHeader, ProgressRing } from "@/madp/ui/kit";
import { FactoryOffice } from "@/madp/components/home/factoryOffice";
import { StageBoundary, StageFallback } from "@/madp/components/home/LiveFactoryCard";
import { dockReserve } from "@/madp/components/office/dock";
import { useOfficeStage } from "@/madp/components/office/officeStore";
import { officeView } from "./officeStages";
import { getCulture, t, useT } from "@/madp/i18n";
import { rewritePath } from "@/madp/lib/pathPrefix";


/** The office never draws above this pixel ratio here. */
const DASHBOARD_MAX_DPR = 1.5;
const MAX_LISTED = 5;
/** The live row keeps one height (the project list beside the 3D card scrolls); one column below lg. At least 460 px,
 *  so an agent's chat docked in the card has room for its messages, wrapped quick prompts and composer. */
const LIVE_ROW = "lg:h-[clamp(460px,50vh,560px)] lg:grid-cols-12 lg:grid-rows-[minmax(0,1fr)]";
const LIVE_CARD = "h-[420px] md:h-[460px] lg:col-span-8 lg:h-auto";
/** The cards below grow with their content up to one height, then scroll inside; a row keeps them equally tall. The
 *  scroll body keeps the card's 24 px inset on the right with its (stable) scrollbar gutter included. */
const SCROLL_CARD = "flex min-h-0 min-w-0 flex-col";
const SCROLL_BODY = "scroll-thin mb-3 mr-1 min-h-0 flex-1 overflow-y-auto pb-3 pr-2 [scrollbar-gutter:stable]";
const LOWER_CARD = `${SCROLL_CARD} max-h-[420px]`;
/** a lower card's body: a column, so an empty card's line sits in its middle */
const LOWER_BODY = `${SCROLL_BODY} flex flex-col`;
const EMPTY_LINE = "m-auto max-w-[18rem] text-center text-[14px] text-ink3";

const ACTIVITY_ICON: Record<ActivityKind, ReactNode> = {
  journey: <FolderKanban size={16} strokeWidth={1.75} />,
  ticket: <ListChecks size={16} strokeWidth={1.75} />,
  release: <Rocket size={16} strokeWidth={1.75} />,
  change: <GitPullRequest size={16} strokeWidth={1.75} />,
  job: <Workflow size={16} strokeWidth={1.75} />,
};

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-card bg-surface p-5 shadow-card dark:border dark:border-line">
      <div className="flex items-center gap-3 text-[14px] font-medium text-ink2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-block bg-accent/10 text-accent">{icon}</span>
        <span className="min-w-0 truncate">{label}</span>
      </div>
      <div className="num mt-4 truncate text-[28px] font-medium leading-tight tracking-tight text-ink">{value}</div>
    </div>
  );
}

/** Dates in the chosen language: "10 Nov" in English, "10. Nov." in German (Switzerland). */
const dateLocale = () => (getCulture() === "de-CH" ? "de-CH" : "en-GB");
const dateOf = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(dateLocale(), { day: "numeric", month: "short" });
};
const versionText = (v: string) => `v${v.replace(/^v/i, "")}`;

const greeting = (first: string, hour = new Date().getHours()) => {
  if (hour < 12) return first ? t("shell.dashboard.goodMorningName", "Good morning, {name}", { name: first }) : t("shell.dashboard.goodMorning", "Good morning");
  if (hour < 18) return first ? t("shell.dashboard.goodAfternoonName", "Good afternoon, {name}", { name: first }) : t("shell.dashboard.goodAfternoon", "Good afternoon");
  return first ? t("shell.dashboard.goodEveningName", "Good evening, {name}", { name: first }) : t("shell.dashboard.goodEvening", "Good evening");
};

export function DashboardView() {
  useT();
  const navigate = useNavigate();
  const ctx = useBlocksContext();
  const profile = useSession((s) => s.profile);
  const { records, capped, isLoading, error, refetch } = useDashboardData();
  const ready = useWorkspaces((s) => s.ready);
  // no role verdict before the membership has loaded
  const canCreate = ready && ctx.can("project.create");
  const [focusId, setFocusId] = useState<string | null>(null);
  // an agent's chat docks on the live card's right: the card's header keeps to the part left of it
  const chatDocked = useOfficeStage((s) => s.docked !== null);
  // the live card's header (project, step, Open) as measured: the 3D frames the room and the busy agents below it
  const [headH, setHeadH] = useState(0);
  const headRo = useRef<ResizeObserver | null>(null);
  const headRef = useCallback((el: HTMLDivElement | null) => {
    headRo.current?.disconnect();
    headRo.current = null;
    if (!el) return;
    setHeadH(el.offsetHeight);
    if (typeof ResizeObserver === "undefined") return;
    headRo.current = new ResizeObserver(() => setHeadH(el.offsetHeight));
    headRo.current.observe(el);
  }, []);

  const workspace = ctx.workspaces.find((w) => w.id === ctx.workspaceId);
  const date = new Date().toLocaleDateString(dateLocale(), { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const first = profile?.firstName?.trim() ?? "";
  const header = (
    <PageHeader title={greeting(first)}
      subtitle={workspace ? t("shell.dashboard.subtitleWorkspace", "Everything in {workspace} at a glance · {date}", { workspace: workspace.name, date }) : t("shell.dashboard.subtitle", "Everything at a glance · {date}", { date })}
      actions={!ready ? <span aria-hidden className="inline-block h-10 w-36 animate-pulse rounded-full bg-surface2" />
        : canCreate ? (
          <Button variant="secondary" icon={<DoorOpen size={16} strokeWidth={1.75} />} onClick={() => openGuidedStart()}>{t("shell.dashboard.startInOffice", "Start in the office")}</Button>
        ) : undefined} />
  );

  const stats = useMemo(() => kpis(records), [records]);
  // newest first: the projects by their latest activity (a new release moves a project up)
  const activity = useMemo(() => latestActivity(records), [records]);
  const list = useMemo(() => yourProjects(records.projects, activity), [records.projects, activity]);
  const rows = useMemo(() => releaseRows(records.projects, records.releases, records.jobs), [records.projects, records.releases, records.jobs]);
  const events = useMemo(() => recentActivity(records), [records]);
  const team = useNowTeam();
  const now = useMemo(() => projectsNow(records, ctx.userId ?? "", ctx.permissions, team), [records, ctx.userId, ctx.permissions, team]);
  const todo = useMemo(() => waitingForYou(now), [now]);
  const live = useMemo(() => {
    const focused: DashProject | undefined = focusId ? records.projects.find((p) => p.id === focusId) : undefined;
    return focused ? liveNow([focused], records.jobs) : liveNow(records.projects, records.jobs, activity);
  }, [records, focusId, activity]);
  const office = useMemo(() => officeView(live?.job ?? null), [live]);

  if (error) {
    return (
      <div className="pb-4">
        {header}
        <Banner tone="danger" title={t("shell.dashboard.loadFailed", "We couldn't load the dashboard.")} text={t("shell.dashboard.checkConnection", "Check your connection and try again.")}
          action={<Button variant="ghost" size="sm" onClick={refetch}>{t("common.actions.tryAgain", "Try again")}</Button>} />
      </div>
    );
  }
  if (isLoading || !ready) {
    return (
      <div className="pb-4" aria-busy="true" aria-label={t("shell.dashboard.loading", "Loading the dashboard")}>
        {header}
        <div aria-hidden className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-[116px] animate-pulse rounded-card bg-surface2 motion-reduce:animate-none" />)}
        </div>
        <div aria-hidden className={cn("mb-5 grid grid-cols-1 gap-5", LIVE_ROW)}>
          <div className={cn("animate-pulse rounded-card bg-stage motion-reduce:animate-none", LIVE_CARD)} />
          <div className="h-64 animate-pulse rounded-card bg-surface2 lg:col-span-4 lg:h-auto motion-reduce:animate-none" />
        </div>
        <div aria-hidden className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="h-48 animate-pulse rounded-card bg-surface2 motion-reduce:animate-none" />)}
        </div>
      </div>
    );
  }

  const at = Date.now();
  const shown = live?.project ?? null;
  const job = live?.job ?? null;
  const shownItem = shown ? list.find((x) => x.id === shown.id) ?? null : null;
  const progress = job ? Math.round(job.progress) : 0;
  const caption = job ? office.caption : "";

  return (
    <div className="pb-4">
      {header}
      {capped && (
        <p className="flex items-start gap-2 text-[13px] text-ink3"><Info size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden />{DASHBOARD_CAPPED_TEXT}</p>
      )}

      <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat icon={<FolderKanban size={18} strokeWidth={1.75} />} label={t("shell.dashboard.statProjects", "Projects")} value={stats.projects} />
        <Stat icon={<Hammer size={18} strokeWidth={1.75} />} label={t("shell.dashboard.statInBuild", "In build")} value={stats.inBuild} />
        <Stat icon={<Rocket size={18} strokeWidth={1.75} />} label={t("shell.dashboard.statReleased", "Released")} value={stats.released} />
        <Stat icon={<Inbox size={18} strokeWidth={1.75} />} label={t("shell.dashboard.statWaiting", "Waiting for you")} value={waitingCount(todo)} />
      </div>

      <div className={cn("mb-5 grid grid-cols-1 gap-5", LIVE_ROW)}>
        <section aria-label={t("shell.dashboard.liveNow", "Live now")} className={cn("relative min-w-0 overflow-hidden rounded-card bg-stage text-white animate-rise", LIVE_CARD)}>
          {/* the 3D fills the whole card at every size */}
          <div className="absolute inset-0 flex flex-col">
            {shown && shownItem ? (
              <StageBoundary fallback={<StageFallback text={t("shell.dashboard.teamViewUnavailable", "The team view can't be shown on this screen.")} />}>
                <Suspense fallback={<StageFallback text={t("shell.dashboard.teamViewOpening", "Opening the team view…")} pulse />}>
                  <FactoryOffice variant="compact" stages={office.stages} caption={caption || undefined} follow paused={office.held} maxDpr={DASHBOARD_MAX_DPR}
                    chat projectId={shown.id} reserveTop={headH} className="h-full w-full flex-1" />
                </Suspense>
              </StageBoundary>
            ) : (
              <div className="grid flex-1 place-items-center px-6 text-center">
                <div>
                  <Clapperboard size={28} strokeWidth={1.75} className="mx-auto text-white/70" />
                  <h2 className="mt-3 text-[17px] font-medium">{t("shell.dashboard.liveNow", "Live now")}</h2>
                  <p className="mt-1 text-[14px] text-white/70">{canCreate ? t("shell.dashboard.liveEmptyCreate", "Start a project and watch your team work on it here.") : t("shell.dashboard.workspaceProjectsAppear", "The projects of this workspace appear here.")}</p>
                  {!ready && <span aria-hidden className="mx-auto mt-4 block h-10 w-36 animate-pulse rounded-full bg-surface2" />}
                </div>
              </div>
            )}
          </div>
          {/* the header's scrim reaches a little below it, so its lines stay legible over the room's light walls */}
          {shown && shownItem && (
            <div ref={headRef} style={chatDocked ? { right: dockReserve("compact") } : undefined}
              className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-3 p-4 before:absolute before:inset-x-0 before:top-0 before:-z-10 before:h-[calc(100%+1.5rem)] before:bg-gradient-to-b before:from-stage/90 before:via-stage/70 before:to-transparent">
              <div className="flex min-w-0 items-center gap-3">
                {job && <div className="text-white"><ProgressRing value={progress} size={40} stroke={5} label="" /></div>}
                <div className="min-w-0">
                  <h2 className="truncate text-[17px] font-medium">{shownItem.name}</h2>
                  <Chip className="mt-1 bg-white/10 text-white"><span className="num">{job ? caption : phaseNameOf(now.get(shown.id)?.step ?? shownItem.step)}</span></Chip>
                  {!job && <p className="mt-1 text-[13px] text-white/70">{t("shell.dashboard.nobodyWorking", "Nobody is working on it right now.")}</p>}
                </div>
              </div>
              <Link to={job ? stepPath(shown.id, "build") : shownItem.to}
                className="pointer-events-auto inline-flex h-8 items-center gap-2 rounded-full bg-white/10 px-3.5 text-[13px] font-medium text-white transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                {t("shell.dashboard.openStep", "Open {step}", { step: job ? phaseName("engineering") : phaseNameOf(now.get(shown.id)?.step ?? shownItem.step) })}<ArrowUpRight size={14} strokeWidth={1.75} />
              </Link>
            </div>
          )}
        </section>

        <Card title={t("shell.dashboard.yourProjects", "Your projects")} icon={<FolderKanban size={18} strokeWidth={1.75} />} className={cn(SCROLL_CARD, "max-lg:max-h-[460px] lg:col-span-4")}
          bodyClassName={cn(SCROLL_BODY, "flex flex-col gap-2.5")}>
          {list.length === 0 ? (
            <EmptyState title={t("shell.dashboard.noProjects", "No projects yet")} text={canCreate ? t("shell.dashboard.firstProjectAppears", "Your first project appears here once you start it.") : t("shell.dashboard.workspaceProjectsAppear", "The projects of this workspace appear here.")} />
          ) : (
            <>
              {list.slice(0, MAX_LISTED).map((it) => {
                const on = shown?.id === it.id;
                const row = rows.find((x) => x.projectId === it.id);
                const env = row?.production ? "production" : row?.stage ? "stage" : row?.dev ? "dev" : null;
                const version = env && row ? row[env]!.version : "";
                const state = now.get(it.id);
                const next = state?.waiting[0];
                return (
                  <div key={it.id} className="relative">
                    <button type="button" aria-pressed={on} onClick={() => setFocusId(it.id)}
                      className={cn("block w-full min-w-0 rounded-block bg-surface2 p-3.5 pr-14 text-left transition hover:bg-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        on && "ring-2 ring-accent")}>
                      <span className="block truncate text-[14px] font-medium">{it.name}</span>
                      {it.clientName && <span className="block truncate text-[12px] text-ink3">{it.clientName}</span>}
                      <span className="mt-1.5 block truncate text-[12px] font-medium text-ink">
                        {phaseNameOf(state?.step ?? it.step)}<span className="num font-normal text-ink3"> · {t("shell.dashboard.stepOf", "Step {step} of {total}", { step: phaseNumber(it.step), total: PHASE_COUNT })}</span>
                      </span>
                      {state && <WorkingLine now={state} className="mt-0.5 flex" />}
                      {/* one of the four steps: the bar fills a quarter per step */}
                      <Bar value={phaseNumber(it.step) / PHASE_COUNT * 100} hatchRest={false} className="mt-2 h-1" />
                      {next && (
                        <span className="mt-2 flex min-w-0 items-center gap-1.5 text-[12px] text-ink">
                          <AlertCircle size={14} aria-hidden className="shrink-0 text-[rgb(var(--c-warning-text))]" />
                          <span className="min-w-0 truncate">{next.text}{state && state.waiting.length > 1 ? ` (+${state.waiting.length - 1})` : ""}</span>
                        </span>
                      )}
                      {env && <span className="mt-2 block"><Chip tone="success">{t("shell.dashboard.onEnv", "On {env} {version}", { env: ENV_LABEL[env], version: versionText(version) })}</Chip></span>}
                    </button>
                    <Link to={it.to} aria-label={t("shell.dashboard.openNamed", "Open {name}", { name: it.name })} title={t("shell.dashboard.openNamed", "Open {name}", { name: it.name })}
                      className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full bg-surface text-ink2 transition hover:bg-accent hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                      <ArrowUpRight size={16} strokeWidth={1.75} />
                    </Link>
                  </div>
                );
              })}
              {list.length > MAX_LISTED && <Link to={rewritePath("/projects")} className="mt-1 text-[13px] font-medium text-accent hover:underline">{t("shell.dashboard.allProjects", "All projects")}</Link>}
            </>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card title={t("shell.dashboard.recentActivity", "Recent activity")} icon={<History size={18} strokeWidth={1.75} />} className={LOWER_CARD} bodyClassName={LOWER_BODY}>
          {events.length === 0 ? (
            <p className={EMPTY_LINE}>{t("shell.dashboard.activityEmpty", "Updates appear here as your projects move forward.")}</p>
          ) : (
            <ul className="space-y-3">
              {events.map((e) => (
                <li key={e.id} className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 shrink-0 text-ink2">{ACTIVITY_ICON[e.kind]}</span>
                  <div className="min-w-0 flex-1">
                    <Link to={e.to} className="block text-[14px] leading-snug [overflow-wrap:anywhere] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{e.text}</Link>
                    <p className="truncate text-[12px] text-ink3">{e.project} · {relativeTime(e.at, at)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("shell.dashboard.releases", "Releases")} icon={<Rocket size={18} strokeWidth={1.75} />} className={LOWER_CARD} bodyClassName={LOWER_BODY}>
          {rows.length === 0 ? (
            <p className={EMPTY_LINE}>{t("shell.dashboard.releasesEmpty", "No releases yet. Each one appears here once it goes out.")}</p>
          ) : (
            <ul className="space-y-4">
              {rows.map((r) => (
                <li key={r.projectId} className="min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate text-[14px] font-medium">{r.project}</span>
                    <Link to={stepPath(r.projectId, "release")} aria-label={t("shell.dashboard.openRelease", "Open the release of {project}", { project: r.project })} className="shrink-0 text-[13px] font-medium text-accent hover:underline">{t("common.actions.open", "Open")}</Link>
                  </div>
                  <dl className="mt-1 space-y-0.5 text-[13px] text-ink2">
                    {(["dev", "stage", "production"] as const).map((env) => (
                      <div key={env} className="flex justify-between gap-3">
                        <dt className="text-ink3">{ENV_LABEL[env]}</dt>
                        <dd className="num">{r[env] ? `${versionText(r[env]!.version)} · ${r[env]!.notUsable ? t("shell.dashboard.notUsableYet", "not usable yet") : dateOf(r[env]!.releasedAt)}` : t("shell.dashboard.notYet", "Not yet")}</dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <WaitingForYouCard items={todo} className={LOWER_CARD} bodyClassName={LOWER_BODY} />
      </div>
    </div>
  );
}
