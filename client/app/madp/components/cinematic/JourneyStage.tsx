/** "Start in the office": a client visit to a software company, in 3D. The MADP Assistant greets the signed-in person
 *  by name at Reception and asks for the project's name, walks them to the glass Meeting room for one discovery
 *  conversation at the table (the wall screen captures the notes, the files and what is in the project so far; the
 *  business analyst joins and sums up what they said), on to Engineering to choose where the code lives (MADP Factory,
 *  or the visitor's own GitHub, connected for real), and to the Build floor, from where Project setup opens.
 *
 *  It is the real New project flow (journey/real.ts, the guided start's and Project setup's own ops): the project is
 *  created once it has a name and an idea (the code kept in MADP Factory), the website is saved to its material, who
 *  it is for and the goal are saved as the guided start's answers, files are uploaded into "Client documents" and the
 *  business agent reads them (setup.assist). At launch the visit opens the project's Project setup, where the
 *  analysis starts.
 *
 *  The promo film's scripted story (journey/stories.ts) is told only when asked for: ?story=driver / ?story=webpilot
 *  (kept for the tab; ?story=real forgets it) or the recording mode ?rec=1, and only while the film mode is on
 *  (journey/filmMode.ts: a development build that turns it on; never in a hosted build). The story never creates a
 *  project. Keys:
 *  Alt+Shift+S skips to the next place (story only), Alt+Shift+X restarts, Alt+Shift+R toggles the 1920×1080 recording
 *  mode, which hides every control. */
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "lucide-react";
import { useSession } from "@/madp/blocks/session";
import { Logo } from "@/madp/ui/Shell";
import { messageFor, useProjectsContext } from "@/madp/blocks/projects";
import { useProjectList } from "@/madp/blocks/projects/reads";
import { cn } from "@/madp/lib/cn";
import { useT } from "@/madp/i18n";
import { useJourney } from "./journey/store";
import { useSetupAgent } from "@/madp/components/setup/agent/data";
import { pickStory } from "./journey/stories";
import { filmModeEnabled } from "./journey/filmMode";
import { Composer } from "./ui/Composer";
import { SpeechBubble } from "./ui/SpeechBubble";
import { Captions, DropZone, PlaceTitle, StepTracker, Transcript } from "./ui/Overlays";
import { warmStepChunks } from "./prefetch";
import { queryClient } from "@/madp/blocks/queryClient";
import { preloadStepChunk, prefetchProjectStep } from "@/madp/components/project/stepPrefetch";
import { prefetchGuides } from "./visit/cast";
import "./cinematic.css";
import { prefixPath, rewritePath } from "@/madp/lib/pathPrefix";

const World = lazy(() => import("./world/World"));

/** A 3D failure (a lost GPU context, a model that fails) rebuilds only the world; the conversation carries on. */
class WorldBoundary extends Component<{ children: ReactNode }, { n: number; failed: boolean }> {
  state = { n: 0, failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) {
    console.warn("[journey] the 3D world restarted", e);
    if (this.state.n < 3) window.setTimeout(() => this.setState((s) => ({ n: s.n + 1, failed: false })), 50);
  }
  render() { return this.state.failed ? null : <div key={this.state.n} className="absolute inset-0">{this.props.children}</div>; }
}

/** dev only: a hot reload remounts the stage; it must not restart the take */
const hmrBox = window as unknown as { __cineHmrAt?: number };
if (import.meta.hot) import.meta.hot.on("vite:beforeUpdate", () => { hmrBox.__cineHmrAt = performance.now(); });
const sinceHmr = () => performance.now() - (hmrBox.__cineHmrAt ?? -1e9);
const W = 1920;
const H = 1080;

/** Recording mode: a fixed 1920×1080 stage, scaled to fit the window (exactly 1:1 in a 1920×1080 window). */
function useStageScale(on: boolean) {
  const [k, setK] = useState(1);
  useEffect(() => {
    if (!on) return;
    const fit = () => setK(Math.min(window.innerWidth / W, window.innerHeight / H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [on]);
  return k;
}

/** the stage's aspect ratio (fixed 16:9 when recording), for placing overlays over the scene */
function useAspect(recording: boolean) {
  const [a, setA] = useState(() => window.innerWidth / Math.max(1, window.innerHeight));
  useEffect(() => {
    if (recording) return;
    const on = () => setA(window.innerWidth / Math.max(1, window.innerHeight));
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, [recording]);
  return recording ? W / H : a;
}

function Intro() {
  const t = useT();
  const phase = useJourney((s) => s.phase);
  const start = useJourney((s) => s.start);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (phase === "intro") btn.current?.focus(); }, [phase]);
  return (
    <div className={cn("pointer-events-none absolute inset-0 flex items-end justify-start p-16 transition-opacity duration-700", phase === "intro" ? "opacity-100" : "opacity-0")}>
      <div className={cn("cine-glass max-w-[560px] rounded-[32px] p-9", phase === "intro" && "pointer-events-auto cine-rise")}>
        <div className="text-[13px] font-medium uppercase tracking-[0.16em] text-ink3">MADP Factory · SELISE</div>
        <h1 className="mt-3 text-[44px] font-medium leading-[1.05] tracking-[-0.03em] text-ink">{t("studio.cinematic.intro.title", "Come in. Let's talk about your idea.")}</h1>
        <p className="mt-3 text-[16px] leading-relaxed text-ink2">
          {t("studio.cinematic.intro.text", "Your MADP Assistant meets you at reception, sits down with you and your business analyst, sets up your code home and takes you to the floor where your software gets built. What you share goes straight into your new project.")}
        </p>
        <button
          ref={btn}
          type="button"
          onClick={start}
          className="cine-launch mt-7"
        >
          {t("studio.cinematic.intro.walkIn", "Walk in")}
        </button>
      </div>
    </div>
  );
}

/** The only control on screen besides the journey tracker: leave. (Operators use the keyboard: Alt+Shift+S skips,
 *  X restarts, R toggles recording, T the transcript; ?rec=1 starts in recording mode, ?debug shows fps.) */
function CloseButton({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <button type="button" aria-label={t("studio.cinematic.stage.close", "Close")} onClick={onClose} className="cine-pill pointer-events-auto absolute right-6 top-6 grid h-10 w-10 place-items-center text-ink2 transition-colors hover:text-ink">
      <X size={17} />
    </button>
  );
}

function useHotkeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.altKey && e.shiftKey) || e.ctrlKey || e.metaKey) return;
      const j = useJourney.getState();
      if (e.code === "KeyS") { e.preventDefault(); j.skip(); }
      else if (e.code === "KeyX") { e.preventDefault(); j.restart(); }
      else if (e.code === "KeyR") { e.preventDefault(); j.setRecording(!j.recording); }
      else if (e.code === "KeyT") { e.preventDefault(); j.setTranscript(!j.transcript); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** At Launch. The real office: the project exists already; once every save of the visit has settled, its Project
 *  setup opens while the camera flies through the doors. The story: a project of the story's name opens at
 *  Understanding your project; without one the take ends there. Scripted answers never create a real project. */
function useHandOff() {
  const t = useT();
  const navigate = useNavigate();
  const phase = useJourney((s) => s.phase);
  const mode = useJourney((s) => s.mode);
  const projectFailed = useJourney((s) => s.project.status === "failed");
  const ctx = useProjectsContext();
  const list = useProjectList();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (phase !== "handoff") { started.current = false; return; }
    if (started.current) return;
    if (mode === "real") {
      if (projectFailed) return; // the project card offers "Try again"; this runs again once it is created
      started.current = true;
      setError(null);
      warmStepChunks();
      preloadStepChunk("business");
      const flight = new Promise((r) => window.setTimeout(r, 4600));
      Promise.all([useJourney.getState().settled(), flight]).then(
        ([id]) => {
          if (ctx.workspaceId) prefetchProjectStep(queryClient, ctx.workspaceId, id, "business");
          navigate(prefixPath(`/p/${id}/business`), { replace: true });
        },
        (e: unknown) => { setError(messageFor(e)); started.current = false; },
      );
      return;
    }
    if (list.isPending) return; // the list arrives within the flight; this effect runs again then
    started.current = true;
    setError(null);
    warmStepChunks();
    const a = useJourney.getState().answers;
    const name = a.name.trim().toLowerCase();
    const flight = new Promise((r) => window.setTimeout(r, 4600));
    const existing = (list.data ?? []).find((p) => p.name.trim().toLowerCase() === name && (!ctx.workspaceId || p.workspaceId === ctx.workspaceId));
    if (existing) {
      preloadStepChunk("sanitization");
      prefetchProjectStep(queryClient, existing.workspaceId, existing.id, "sanitization");
    }
    if (!existing) {
      setError(t("studio.cinematic.journey.storyNoProject", "A recorded story never creates a project. Create a project named {name} first to end the take there.", { name: a.name.trim() }));
      return;
    }
    Promise.all([Promise.resolve(prefixPath(`/p/${existing.id}/sanitization`)), flight]).then(
      ([url]) => navigate(url, { replace: true }),
      (e: unknown) => { setError(messageFor(e)); started.current = false; },
    );
  }, [phase, mode, projectFailed, list.isPending, list.data, ctx.workspaceId, navigate, t]);

  return error;
}

/** The business agent's reading, from its EngineJob and SetupSuggestion rows, into the visit (real office, once the
 *  shared files woke it). */
function AgentWatch({ projectId }: { projectId: string }) {
  const agent = useSetupAgent(projectId, { live: true });
  const state = agent.working ? "reading" : agent.job?.status === "succeeded" ? "read" : agent.job ? "failed" : null;
  const found = agent.suggestions.length;
  useEffect(() => {
    if (state) useJourney.getState().setAgent({ state, found });
  }, [state, found]);
  return null;
}

/** The real office's project, if project.create failed: why, and "Try again" (the same request: never two projects). */
function ProjectProblem() {
  const t = useT();
  const project = useJourney((s) => s.project);
  const retry = useJourney((s) => s.retryCreate);
  if (project.status !== "failed") return null;
  return (
    <div role="alert" className="cine-card pointer-events-auto absolute left-1/2 top-24 w-[440px] -translate-x-1/2 p-4 text-[14px] text-ink">
      <div className="font-medium text-danger">{t("studio.cinematic.journey.createFailed", "The project could not be created yet.")}</div>
      {project.error && <div className="mt-1 text-ink2">{project.error}</div>}
      <button type="button" onClick={retry} className="mt-3 rounded-xl bg-accent px-3 py-1.5 text-[13px] font-medium text-white">{t("studio.cinematic.stage.tryAgain", "Try again")}</button>
    </div>
  );
}

export function JourneyStage() {
  const t = useT();
  const navigate = useNavigate();
  const recording = useJourney((s) => s.recording);
  const phase = useJourney((s) => s.phase);
  const k = useStageScale(recording);
  const aspect = useAspect(recording);
  const error = useHandOff();
  useHotkeys();
  const profileName = useSession((st) => (st.status === "signed-in" ? st.profile?.firstName ?? "" : ""));
  useEffect(() => { useJourney.getState().setVisitorDefault(profileName.trim().split(/\s+/)[0] ?? ""); }, [profileName]);
  const ctx = useProjectsContext();
  useEffect(() => { useJourney.getState().setWorkspace(ctx.workspaceId ?? ""); }, [ctx.workspaceId]);
  const mode = useJourney((s) => s.mode);
  const watchId = useJourney((s) => (s.mode === "real" && s.agent.state !== "idle" ? s.project.id : null));

  // a fresh journey on every visit (not on a dev hot reload); the story from ?story=; recording mode from ?rec=1; the
  // guides start loading
  useEffect(() => {
    const j = useJourney.getState();
    j.setStory(pickStory());
    if (sinceHmr() > 4000) j.restart();
    j.setRecording(filmModeEnabled() && new URLSearchParams(window.location.search).has("rec"));
    prefetchGuides();
    return () => { if (sinceHmr() > 4000) useJourney.getState().restart(); };
  }, []);

  const stage = (
    <div className={cn("relative overflow-hidden bg-[#eef0f4] text-ink", recording && "cine-rec")} style={recording ? { width: W, height: H } : { position: "absolute", inset: 0 }}>
      <Suspense fallback={<div className="grid h-full place-items-center text-[14px] text-ink3">{t("studio.cinematic.journey.openingStudio", "Opening the studio…")}</div>}>
        <WorldBoundary><World /></WorldBoundary>
      </Suspense>
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute left-6 top-6 flex items-center gap-2.5">
          <Logo size={36} />
          <span className="text-[17px] font-semibold tracking-[-0.01em] text-ink">MADP Factory</span>
        </div>
        <div className="absolute left-1/2 top-6 -translate-x-1/2"><StepTracker /></div>
        <Intro />
        <PlaceTitle />
        <SpeechBubble aspect={aspect} />
        <Captions />
        <Composer />
        <DropZone aspect={aspect} />
        <Transcript />
        {mode === "real" && <ProjectProblem />}
        {watchId && <AgentWatch projectId={watchId} />}
        {!recording && <CloseButton onClose={() => navigate(rewritePath("/dashboard"))} />}
        {error && (
          <div role="alert" className="cine-card pointer-events-auto absolute bottom-28 left-1/2 w-[440px] -translate-x-1/2 p-4 text-[14px] text-ink">
            <div className="font-medium text-danger">{t("studio.cinematic.journey.openFailed", "The project could not be opened.")}</div>
            <div className="mt-1 text-ink2">{error}</div>
            <button type="button" onClick={() => useJourney.getState().restart()} className="mt-3 rounded-xl bg-accent px-3 py-1.5 text-[13px] font-medium text-white">{t("studio.cinematic.journey.startAgain", "Start again")}</button>
          </div>
        )}
      </div>
      {/* the hand-off: the desks light up, the visitor steps towards the board, the app fades in */}
      <div aria-hidden className={cn("pointer-events-none absolute inset-0 bg-canvas transition-opacity duration-[1400ms] ease-in", phase === "handoff" ? "opacity-100 delay-[2600ms]" : "opacity-0")} />
      {phase === "handoff" && !error && (
        <div role="status" className="cine-fade pointer-events-none absolute inset-0 grid place-items-center [animation-delay:3200ms]">
          <div className="text-center">
            <div className="text-[13px] font-medium uppercase tracking-[0.16em] text-accent">{t("studio.cinematic.places.buildFloor", "Build floor")}</div>
            <div className="mt-2 text-[40px] font-medium tracking-[-0.03em] text-ink">{mode === "real" ? t("studio.cinematic.journey.openingSetup", "Opening Project setup") : t("studio.cinematic.journey.teamStarting", "Your team is getting started")}</div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <main className="fixed inset-0 overflow-hidden bg-[#0b0d12]">
      {recording ? (
        <div className="absolute left-1/2 top-1/2" style={{ width: W, height: H, transform: `translate(-50%, -50%) scale(${k})` }}>{stage}</div>
      ) : stage}
    </main>
  );
}
