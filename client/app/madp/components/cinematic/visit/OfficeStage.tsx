/** "Start in the office": the app's own Project Setup and Business Analysis, done as a conversation in the 3D office,
 *  up to the scope lock. The MADP Assistant takes the guided start's questions and Project setup at reception; the
 *  business analyst takes the analysis at the meeting table; once the scope is locked, "Your team starts building"
 *  opens Software Engineering. Everything is written with the app's own ops into the app's own records, so leaving
 *  (top right) lands on the same step's page with everything in it, and coming back (/new/cinematic?project=<id>, or
 *  "Continue" at the door) resumes where the records are.
 *  No chat window: one canvas (the room and the two people), what they say in a speech bubble beside their head, your
 *  words in a slim bar at the bottom centre with a few choices above it, a transcript only when asked for, the step list
 *  with the app's names, and two windows from the app (where the code lives; the analysis). From reception to the
 *  meeting table the assistant escorts you (visit/escort.ts); with reduced motion it is a cut, and the walk can always
 *  be skipped. */
import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, X } from "lucide-react";
import { useT } from "@/madp/i18n";
import { useSession } from "@/madp/blocks/session";
import { useProjectsContext } from "@/madp/blocks/projects";
import { useProject, useProjectList } from "@/madp/blocks/projects/reads";
import { useDocTree } from "@/madp/blocks/projects/docReads";
import type { ProjectRecord } from "@/madp/blocks/projects/records";
import { queryClient } from "@/madp/blocks/queryClient";
import { preloadStepChunk, prefetchProjectStep } from "@/madp/components/project/stepPrefetch";
import { STEP_LABEL } from "@/madp/domain/journey";
import { useReducedMotion } from "@/madp/components/landing/motion";
import { Logo } from "@/madp/ui/Shell";
import { cn } from "@/madp/lib/cn";
import { useJourney } from "../journey/store";
import type { StageId } from "../journey/places";
import { useChat } from "./chat";
import { prefetchGuides } from "./cast";
import { continuable, leaveUrl, phaseOfProject, resumeIdOf, SPEAKER_OF_PHASE, type OfficePhase } from "./flow";
import { stageLayout, type Viewport } from "./layout";
import { escort, useOfficeScene } from "./scene";
import { SpeechLayer } from "./Speech";
import { OfficeInput } from "./OfficeInput";
import { Transcript } from "./Transcript";
import { AnalysisSheet, WhereSheet } from "./Sheets";
import { SetupConversation } from "./SetupConversation";
import { AnalysisConversation } from "./AnalysisConversation";
import { PhaseBar, StepList } from "./Steps";
import { useVisit } from "./store";
import "../cinematic.css";
import "./visit.css";

const World = lazy(() => import("../world/World"));

/** A 3D failure (a lost GPU context, a model that fails) rebuilds only the floor; the conversation carries on. */
class WorldBoundary extends Component<{ children: ReactNode }, { n: number; failed: boolean }> {
  state = { n: 0, failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) {
    console.warn("[office] the 3D floor restarted", e);
    if (this.state.n < 3) window.setTimeout(() => this.setState((s) => ({ n: s.n + 1, failed: false })), 50);
  }
  render() { return this.state.failed ? null : <div key={this.state.n} className="absolute inset-0">{this.props.children}</div>; }
}

function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

/** Where a phase happens: Project Setup at reception, the analysis (and its end) at the meeting table. */
const placeOf = (phase: OfficePhase): StageId => (phase === "setup" ? "reception" : "meeting");

let walkN = 0;

/** Moves the floor to the place of the phase: a walk when the hand-over happens during the visit, else straight there. */
/** the longest an escort may take before the visitor is simply there (a stalled tab, a lost frame loop) */
const ESCORT_MAX_MS = 40_000;

/** Moves the floor to the place of the phase: the escort when the hand-over happens during the visit (a cut with reduced
 *  motion), else straight there. The escort ends when the assistant has arrived (the floor says so) and introduces the
 *  analyst; then the analyst greets the visitor. */
function usePlace(project: ProjectRecord | null, started: boolean, reduced: boolean) {
  const t = useT();
  const phase = phaseOfProject(project);
  const place = placeOf(phase);
  const seen = useRef<{ id: string | null; phase: OfficePhase | null }>({ id: null, phase: null });
  const poll = useRef(0);
  const arrive = useRef<() => void>(() => undefined);
  arrive.current = () => {
    window.clearInterval(poll.current);
    if (!useJourney.getState().walk) return;
    escort.active = false;
    // he introduces the analyst before the analyst speaks (the analysis turn waits for the arrival)
    void useChat.getState().say("assistant", t("studio.office.visit.escort.intro", "Here we are. This is your business analyst, who takes it from here."));
    useOfficeScene.getState().set({ focus: "pm" });
    useJourney.setState({ walk: null });
  };
  useEffect(() => {
    const prev = seen.current;
    seen.current = { id: project?.id ?? null, phase };
    const scene = useOfficeScene.getState();
    const j = useJourney.getState();
    if (j.stage === place && !j.walk) { scene.set({ focus: SPEAKER_OF_PHASE[phase] }); return; }
    const handedOverNow = started && prev.id !== null && prev.id === project?.id && prev.phase === "setup" && phase !== "setup";
    window.clearInterval(poll.current);
    if (handedOverNow && !reduced) {
      walkN++;
      escort.active = true;
      escort.done = false;
      escort.startedAt = performance.now();
      scene.set({ focus: "assistant" });
      // Project Setup is done: the list says so while you walk (the analysis's list comes at the table)
      const ind = useVisit.getState().indicator;
      if (ind?.phase === "setup") useVisit.getState().setIndicator({ ...ind, items: ind.items.map((i) => (i.id === "handOver" ? { ...i, state: "done" } : i)) });
      void useChat.getState().say("assistant", t("studio.office.visit.escort.thisWay", "This way, please. Your business analyst is waiting for you at the meeting table."));
      // the walk starts on the frame after this switch has been drawn: its render is never part of the walk
      const n = walkN;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (n !== walkN) return;
        escort.startedAt = performance.now();
        useJourney.setState({ stage: place, walk: { to: place, n }, pm: { present: true, joinN: 0 } });
        poll.current = window.setInterval(() => {
          if (escort.done || performance.now() - escort.startedAt > ESCORT_MAX_MS) arrive.current();
        }, 150);
      }));
    } else {
      escort.active = false;
      scene.set({ focus: SPEAKER_OF_PHASE[phase] });
      useJourney.setState({ stage: place, walk: null, pm: { present: place !== "reception", joinN: 0 } });
      scene.snap();
    }
  }, [place, phase, project?.id, started, reduced]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { window.clearInterval(poll.current); escort.active = false; }, []);
  /** "Skip the walk": straight to the table */
  const skip = () => {
    window.clearInterval(poll.current);
    escort.done = true;
    useOfficeScene.getState().snap();
    arrive.current();
  };
  return { phase, skip };
}

/** The person you talk to looks thoughtful while they work on what you asked (an op in flight, a job running). */
function useThinkingLook() {
  useEffect(() => useChat.subscribe((s) => {
    const who = s.busy?.who ?? s.working?.who ?? null;
    if (useOfficeScene.getState().thinking !== who) useOfficeScene.getState().set({ thinking: who });
  }), []);
}

/** The meeting room's wall screen shows the project as its records say (name, description, the people, the goal, the
 *  files given in this visit). */
function useWallScreen(project: ProjectRecord | null) {
  const uploads = useVisit((s) => s.uploads);
  const description = useVisit((s) => s.draft.answers.description);
  useEffect(() => {
    if (!project) return;
    useJourney.setState((s) => ({
      answers: { ...s.answers, name: project.name, about: description || s.answers.about, audience: project.targetUsers, goal: project.goal, website: project.websiteUrl },
      project: { id: project.id, status: "created", error: null },
      uploads: uploads.map((u) => ({ name: u.name, progress: u.phase === "done" ? 1 : 0, phase: u.phase === "done" ? "done" : u.phase === "failed" ? "failed" : "queued" })),
    }));
  }, [project, uploads, description]);
}

function Intro({ onStart }: { onStart: (projectId: string | null) => void }) {
  const t = useT();
  const { search } = useLocation();
  const list = useProjectList();
  const wanted = resumeIdOf(search);
  const open = continuable(list.data ?? [], 3);
  const asked = wanted ? (list.data ?? []).find((p) => p.id === wanted) ?? null : null;
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { btn.current?.focus(); }, [asked?.id]);
  return (
    <div className="pointer-events-none absolute inset-0 flex items-end justify-start p-6 md:p-16">
      <div className="cine-glass pointer-events-auto cine-rise max-w-[560px] rounded-[32px] p-7 md:p-9">
        <div className="text-[13px] font-medium uppercase tracking-[0.16em] text-ink3">MADP Factory · SELISE</div>
        <h1 className="mt-3 text-[34px] font-medium leading-[1.05] tracking-[-0.03em] text-ink md:text-[44px]">
          {asked ? t("studio.office.visit.intro.back", "Welcome back.") : t("studio.office.visit.intro.title", "Come in. Let's talk about your idea.")}
        </h1>
        <p className="mt-3 text-[16px] leading-relaxed text-ink2">
          {t("studio.office.visit.intro.text", "Your MADP Assistant sets up your project with you at reception; your business analyst works through the analysis with you at the meeting table, until the scope is agreed. Everything you say goes straight into your project.")}
        </p>
        {asked ? (
          <button ref={btn} type="button" onClick={() => onStart(asked.id)} className="cine-launch mt-7">
            {t("studio.office.visit.intro.continue", "Continue {name}", { name: asked.name })}
          </button>
        ) : (
          <button ref={btn} type="button" onClick={() => onStart(null)} className="cine-launch mt-7">{t("studio.office.visit.intro.walkIn", "Walk in")}</button>
        )}
        {!asked && open.length > 0 && (
          <div className="mt-6 border-t border-ink/[0.06] pt-4">
            <p className="text-[13px] font-medium text-ink3">{t("studio.office.visit.intro.orContinue", "Or continue where you left off")}</p>
            <ul className="mt-2 flex flex-col gap-1">
              {open.map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => onStart(p.id)}
                    className="flex w-full items-center gap-3 rounded-[12px] px-2 py-2 text-left outline-none transition-colors hover:bg-ink/[0.04] focus-visible:ring-2 focus-visible:ring-accent/50">
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-[15px] font-medium text-ink">{p.name}</span>
                      <span className="block text-[13px] text-ink3">{STEP_LABEL[p.step]}</span>
                    </span>
                    <ArrowRight size={16} aria-hidden className="shrink-0 text-ink3" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/** The conversation for a project that exists: Project setup's or the analysis's, read from its records. */
function ProjectConversation({ project, visitor, resumed, arrived }: { project: ProjectRecord; visitor: string; resumed: boolean; arrived: boolean }) {
  const ctx = useProjectsContext();
  const phase = phaseOfProject(project);
  if (phase === "setup") return <SetupWithMaterial project={project} visitor={visitor} resumed={resumed} />;
  // the analysis takes over at the table: nothing heavy mounts during the escort (its reads are prefetched meanwhile)
  if (!ctx.workspaceId || !arrived) return null;
  return <AnalysisConversation project={project} workspaceId={ctx.workspaceId} visitor={visitor} arrived={arrived} />;
}

/** Project setup reads the project's material (the Material chip, the hand-over rule, the folder files go into). */
function SetupWithMaterial({ project, visitor, resumed }: { project: ProjectRecord; visitor: string; resumed: boolean }) {
  const tree = useDocTree(project.id);
  return <SetupConversation project={project} tree={tree.data} visitor={visitor} resumed={resumed} />;
}

export function OfficeStage() {
  const t = useT();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const ctx = useProjectsContext();
  const visitor = useSession((st) => (st.status === "signed-in" ? st.profile?.firstName ?? "" : ""));
  const started = useVisit((s) => s.started);
  const projectId = useVisit((s) => s.projectId);
  const toBuild = useVisit((s) => s.toBuild);
  const whereOpen = useVisit((s) => s.whereOpen);
  const sheet = useVisit((s) => s.sheet);
  const projectQ = useProject(projectId);
  const project = projectQ.data ?? null;
  const vp = useViewport();
  const layout = useMemo(() => stageLayout(vp), [vp]);
  const resumed = useRef<string | null>(null);
  const walk = useJourney((s) => s.walk);
  const floorAt = useJourney((s) => s.stage);

  // a fresh visit each time the office opens: nothing of an earlier visit carries over
  useEffect(() => {
    useVisit.getState().reset();
    useChat.getState().reset();
    // the floor shows the real project only (never the promo film's scripted story, if it ran in this tab before)
    useJourney.getState().setStory(null);
    useJourney.getState().restart();
    useOfficeScene.getState().set({ office: true });
    prefetchGuides();
    return () => {
      useOfficeScene.getState().set({ office: false });
      useChat.getState().reset();
      useVisit.getState().reset();
    };
  }, []);
  useEffect(() => { useChat.getState().setReduced(reduced); }, [reduced]);

  const { phase, skip } = usePlace(project, started, reduced);
  useWallScreen(project);
  useThinkingLook();
  const focus = useOfficeScene((s) => s.focus);
  const speaker = walk ? "assistant" : focus;

  // the camera leaves the panel's side free for the person you talk to
  useEffect(() => { useOfficeScene.getState().set({ framing: layout.speaker }); }, [layout]);

  // the steps' pages are warmed while you talk, so leaving (or the hand-over to Software Engineering) opens at once
  useEffect(() => {
    if (!project || !ctx.workspaceId) return;
    const slug = phase === "setup" ? "business" : phase === "analysis" ? "analysis" : "build";
    preloadStepChunk(slug);
    prefetchProjectStep(queryClient, ctx.workspaceId, project.id, slug);
    if (phase === "analysis") preloadStepChunk("build");
  }, [project?.id, phase, ctx.workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // after the lock: "Your team starts building" → the room fades and Software Engineering opens
  useEffect(() => {
    if (!toBuild || !project) return;
    const id = window.setTimeout(() => navigate(`/p/${project.id}/build`, { replace: true }), reduced ? 200 : 1500);
    return () => window.clearTimeout(id);
  }, [toBuild, project, navigate, reduced]);

  const start = (id: string | null) => {
    if (id) { resumed.current = id; useVisit.getState().setProject(id); }
    useVisit.getState().start();
    useJourney.setState({ phase: "journey" });
  };
  const leave = () => navigate(leaveUrl(project), { replace: true, state: !project && useVisit.getState().draft.answers.description ? { brief: useVisit.getState().draft.answers.description } : undefined });
  const leaveLabel = !project ? t("studio.office.visit.top.form", "Use the form instead")
    : phase === "setup" ? t("studio.office.visit.top.openSetup", "Open Project setup")
    : phase === "analysis" ? t("studio.office.visit.top.openAnalysis", "Open Business Analysis")
    : t("studio.office.visit.top.openBuild", "Open Software Engineering");
  const loadingProject = Boolean(projectId) && projectQ.data === undefined;

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#eef0f4] text-ink">
      <Suspense fallback={<div className="grid h-full place-items-center text-[14px] text-ink3">{t("studio.office.visit.loading", "Opening the office…")}</div>}>
        <WorldBoundary><World /></WorldBoundary>
      </Suspense>

      {/* a soft vignette: the eye rests on the person you talk to (CSS, no cost on the GPU) */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(ellipse 75% 85% at 40% 45%, transparent 55%, rgb(16 24 48 / 0.14) 100%)" }} />
      <div className="pointer-events-none absolute inset-0">
        {/* the top bar: the product, the journey, the way out */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-3 px-4 py-4 md:px-6">
          <div className="flex items-center gap-2.5">
            <Logo size={34} />
            <span className="hidden text-[17px] font-semibold tracking-[-0.01em] text-ink sm:inline">MADP Factory</span>
          </div>
          {started && <PhaseBar phase={phase} />}
          <div className="pointer-events-auto flex items-center gap-2">
            {started && (
              <button type="button" onClick={leave} className="cine-pill flex h-10 items-center px-4 text-[13px] font-medium text-ink2 transition-colors hover:text-ink">
                {leaveLabel}
              </button>
            )}
            <button type="button" aria-label={t("studio.office.visit.top.close", "Close")} onClick={() => navigate("/dashboard")}
              className="cine-pill grid h-10 w-10 place-items-center text-ink2 transition-colors hover:text-ink">
              <X size={17} />
            </button>
          </div>
        </div>

        {!started && <Intro onStart={start} />}

        {started && (
          <>
            <StepList layout={layout} />
            <SpeechLayer layout={layout} vp={vp} fallback={speaker} />
            <OfficeInput layout={layout} speaker={speaker} paused={whereOpen || sheet !== null}>
              {loadingProject ? null
                : project ? <ProjectConversation project={project} visitor={visitor} resumed={resumed.current === project.id} arrived={!walk && floorAt === placeOf(phase)} />
                : <SetupConversation project={null} tree={undefined} visitor={visitor} resumed={false} />}
            </OfficeInput>
            <Transcript phone={layout.mode === "phone"} />
            {walk && (
              <button type="button" onClick={skip}
                className="cine-pill pointer-events-auto absolute bottom-6 left-6 px-4 py-2 text-[13px] font-medium text-ink2 hover:text-ink">
                {t("studio.office.visit.skipWalk", "Skip the walk")}
              </button>
            )}
          </>
        )}
      </div>

      <WhereSheet />
      <AnalysisSheet ctx={project && ctx.workspaceId ? { projectId: project.id, workspaceId: ctx.workspaceId, step: project.step, type: project.type } : null} />

      {/* the hand-over to Software Engineering */}
      <div aria-hidden className={cn("pointer-events-none absolute inset-0 bg-canvas transition-opacity duration-[1200ms] ease-in", toBuild ? "opacity-100" : "opacity-0")} />
      {toBuild && (
        <div role="status" className="cine-fade pointer-events-none absolute inset-0 grid place-items-center">
          <div className="text-center">
            <div className="text-[13px] font-medium uppercase tracking-[0.16em] text-accent">{t("studio.office.visit.phase.engineering", "Software Engineering")}</div>
            <div className="mt-2 text-[40px] font-medium tracking-[-0.03em] text-ink">{t("studio.office.visit.locked.go", "Your team starts building")}</div>
          </div>
        </div>
      )}
    </main>
  );
}
