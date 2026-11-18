/** /new/cinematic: starting a project as a walk through the factory. The visitor picks the project type at the
 *  street, walks into the coffee shop (greenfield) or the meeting room (brownfield), gives the business agent the
 *  project's name and brief, and the project is created for real (type, name, the brief as its first note) while the
 *  visitor already walks out to the product team: the scene never waits for the network, the door opens once the
 *  project exists. Behind it the business analyst offers the real hand-over to step 2 (Product sanitization /
 *  Existing product analysis): handed over, the walk continues to the team's board and the app opens step 2; or the
 *  visitor goes to the Business step first.
 *  Reduced motion, no WebGL or no right to create projects: the normal /new form. "Use the form" skips at any time. */

import { Component, lazy, Suspense, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { ArrowRight, Coffee, DoorOpen, Presentation, Send, X } from "lucide-react";
import { isNotConfigured, messageFor, messageKeyOf, NOT_CONFIGURED_MESSAGE, useProjectsContext } from "@/madp/blocks/projects";
import { useCreateProjectOnce, useHandOver } from "@/madp/blocks/projects/mutations";
import { useWorkspaces } from "@/madp/blocks/workspaces/store";
import { guardRedirect, signInRedirect } from "@/madp/blocks/guard";
import { useSession } from "@/madp/blocks/session";
import { newRequestId } from "@/madp/blocks/fn";
import { can } from "@/madp/domain/rbac";
import { usePersona } from "@/madp/state/store";
import { useReducedMotion } from "@/madp/components/landing/motion";
import { BareShell } from "@/madp/ui/Shell";
import { Avatar, Banner, Button, Chip, Input, Textarea } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";
import { useT } from "@/madp/i18n";
import { CINEMATIC_TYPES, journeyStops, pathFor, stepLabel, type CinematicType, type PathKey } from "./journeyScenes";
import {
  busy, createArgs, doorOpen, INITIAL, lineFor, momentOf, pathKeyFor, PRODUCT_LEAD, reduce, teamChoice, type CineState, type Line,
} from "./dialogue";
import { warmBusinessStep, warmStep2, warmStepChunks } from "./prefetch";
import { JourneyStage } from "./JourneyStage";
import { OfficeStage } from "./visit/OfficeStage";
import { pickStory } from "./journey/stories";

const CinematicWorld = lazy(() => import("./CinematicWorld"));

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return Boolean(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

/** If the 3D world fails (lost GPU context, a shader error), the visitor continues in the form, or in the project. */
class WorldBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFail(); }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Types the agent's line out; the whole line is in the live region at once, and a click shows it all. */
function useTypewriter(text: string, instant: boolean): [string, boolean, () => void] {
  const [n, setN] = useState(instant ? text.length : 0);
  useEffect(() => {
    if (instant) { setN(text.length); return; }
    setN(0);
    const started = performance.now();
    let raf = 0;
    const tick = () => {
      const k = Math.min(text.length, Math.floor(((performance.now() - started) / 1000) * 48));
      setN(k);
      if (k < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, instant]);
  return [text.slice(0, n), n >= text.length, () => setN(text.length)];
}

function Speech({ line, reduced, children }: { line: Line; reduced: boolean; children?: ReactNode }) {
  const [shown, complete, finish] = useTypewriter(line.text, reduced);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Avatar initials={line.who.initials} size={40} tone="ink" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink3">
            <span className="font-medium text-ink">{line.who.name}</span>
            {line.who.role !== line.who.name && <Chip>{line.who.role}</Chip>}
          </p>
          <p className="sr-only" aria-live="polite">{line.text}</p>
          <p aria-hidden onClick={finish} className="mt-1 min-h-[3.2em] cursor-default text-[17px] leading-relaxed text-ink">
            {shown}{!complete && <span className="ml-0.5 inline-block h-4 w-[2px] animate-pulse bg-ink3 align-middle" />}
          </p>
        </div>
      </div>
      {children}
    </div>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("pointer-events-auto mx-auto w-full max-w-3xl rounded-card bg-surface/95 p-5 text-ink shadow-float ring-1 ring-line backdrop-blur", className)}>
      {children}
    </div>
  );
}

/** A calm status line (no spinner over the scene), announced politely. */
function Status({ children }: { children: ReactNode }) {
  return <p role="status" aria-busy="true" className="text-right text-[13px] text-ink3">{children}</p>;
}

const TYPE_ICON: Record<CinematicType, typeof Coffee> = { greenfield: Coffee, brownfield: Presentation };

/** The walk itself (exported for previews: `initial` starts it at a later phase). */
export function CinematicStage({ initial = INITIAL }: { initial?: CineState }) {
  const t = useT();
  const navigate = useNavigate();
  const reduced = useReducedMotion();
  const ctx = useProjectsContext();
  const [s, dispatch] = useReducer(reduce, initial);
  const [hoverType, setHoverType] = useState<CinematicType | null>(null);
  const { create } = useCreateProjectOnce();
  const handOver = useHandOver();
  const pathKey = pathKeyFor(s.phase, s.exit);
  const path = pathFor(pathKey, s.type);
  const nextLabel = s.type ? stepLabel(s.type, "sanitization") : "";
  const canHandOver = ctx.isSuperAdmin || can(ctx.permissions, "business.edit");
  const choice = teamChoice(s.type, canHandOver);
  const line = lineFor(s, nextLabel, choice);
  const lineKey = line ? `${momentOf(s.phase, s.exit)}:${line.text}` : "";
  const speaking = line && s.phase !== "entering"
    ? { who: line.who === PRODUCT_LEAD ? "pm" as const : "host" as const, key: lineKey, seconds: reduced ? 0 : line.text.length / 48 }
    : null;
  const businessUrl = s.projectId ? `/p/${s.projectId}/business` : null;
  const stepTwoUrl = s.projectId ? `/p/${s.projectId}/sanitization` : null;
  const inFlight = busy(s);

  const leave = () => {
    if (businessUrl) navigate(businessUrl, { replace: true });
    else navigate("/new", { replace: true, state: s.brief.trim() ? { brief: s.brief.trim() } : undefined });
  };

  // project.create runs while the visitor walks: started when the create turns pending (confirm, retry, an edited
  // resend), always with the attempt's requestId (a retry of the same input is idempotent)
  const latest = useRef(s);
  latest.current = s;
  useEffect(() => {
    if (s.create !== "pending" || !s.requestId) return;
    const args = createArgs(latest.current);
    create(args, s.requestId).then(
      (r) => dispatch({ t: "created", projectId: r.project.id }),
      (e: unknown) => dispatch({ t: "failed", message: isNotConfigured(e) ? NOT_CONFIGURED_MESSAGE : messageFor(e) }),
    );
  }, [s.create, s.requestId, create]);

  // the Business step's first-paint reads, as soon as the project exists (the walk to the door and in covers them)
  useEffect(() => {
    if (s.projectId && ctx.workspaceId) warmBusinessStep(ctx.workspaceId, s.projectId);
  }, [s.projectId, ctx.workspaceId]);

  const runHandOver = () => {
    if (!s.projectId || s.handOver === "pending") return;
    const projectId = s.projectId;
    dispatch({ t: "handOver" });
    handOver.run({ projectId }).then(
      () => {
        dispatch({ t: "handedOver" });
        if (ctx.workspaceId) warmStep2(ctx.workspaceId, projectId);
      },
      (e: unknown) => {
        // a retry after a lost answer: the first hand-over did land
        if (messageKeyOf(e) === "business.alreadyHandedOver") {
          dispatch({ t: "handedOver" });
          if (ctx.workspaceId) warmStep2(ctx.workspaceId, projectId);
        } else dispatch({ t: "handOverFailed", message: messageFor(e) });
      },
    );
  };

  const onArrive = (key: PathKey) => { if (key !== "lobby") dispatch({ t: "arrived" }); };

  // leaving the 3D world: the Business step at once; step 2 after the business analyst has walked over to the board
  const exitUrl = s.exit === "sanitization" ? stepTwoUrl : businessUrl;
  useEffect(() => {
    if (s.phase !== "done" || !exitUrl) return;
    const timer = window.setTimeout(() => navigate(exitUrl, { replace: true }), reduced ? 300 : s.exit === "sanitization" ? 3400 : 1600);
    return () => window.clearTimeout(timer);
  }, [s.phase, s.exit, exitUrl, navigate, reduced]);

  const submitCreate = () => dispatch({ t: "submit", requestId: newRequestId() });
  const stops = s.type ? journeyStops(s.type) : [];
  const stopIndex = s.phase === "onward" || (s.phase === "done" && s.exit === "sanitization") ? 1 : 0;
  const failedCreate = s.create === "failed" && (s.phase === "leaving" || s.phase === "door");

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#1b2233]">
      <WorldBoundary onFail={leave}>
        <Suspense fallback={<div className="grid h-full place-items-center text-[14px] text-white/70">{t("studio.cinematic.stage.settingScene", "Setting the scene…")}</div>}>
          <CinematicWorld phase={s.phase} type={s.type} pathKey={pathKey} path={path} reduced={reduced}
            hoverType={hoverType} onHoverType={setHoverType} onChoose={(type) => dispatch({ t: "choose", type })}
            doorReady={doorOpen(s)} onKnock={() => dispatch({ t: "knock" })} onArrive={onArrive} speaking={speaking} />
        </Suspense>
      </WorldBoundary>

      {/* the bar: where we are on the journey, and the way out */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4">
        <div className="pointer-events-auto flex min-w-0 flex-wrap items-center gap-2 rounded-full bg-surface/90 px-4 py-2 text-[13px] text-ink2 shadow-float ring-1 ring-line backdrop-blur">
          <span className="font-medium text-ink">{t("studio.cinematic.stage.newProject", "New project")}</span>
          {stops.length > 0 && (
            <ol aria-label={t("studio.cinematic.stage.journey", "The journey")} className="hidden items-center gap-1.5 md:flex">
              {stops.map((st, i) => (
                <li key={st.step} className="flex items-center gap-1.5">
                  <span aria-hidden className="text-ink3">{i === 0 ? "·" : "→"}</span>
                  <span aria-current={i === stopIndex ? "step" : undefined}
                    className={cn(i === stopIndex ? "font-medium text-accent" : "text-ink3")}>{st.label}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={leave} disabled={inFlight}>
            {businessUrl ? t("studio.cinematic.stage.openSetup", "Open Project setup") : t("studio.cinematic.stage.useForm", "Use the form instead")}
          </Button>
          <Button variant="secondary" size="sm" aria-label={t("studio.cinematic.stage.close", "Close")} icon={<X size={16} />}
            onClick={() => (businessUrl ? leave() : navigate("/dashboard"))} disabled={inFlight} />
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4 md:p-6">
        {s.phase === "choose" && (
          <Panel>
            <h1 className="text-[20px] font-medium">{t("studio.cinematic.stage.whereStart", "Where does your project start?")}</h1>
            <p className="mt-1 text-[14px] text-ink2">{t("studio.cinematic.stage.pickDoor", "Pick a door, or a card. The business agent meets you inside.")}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {CINEMATIC_TYPES.map((ty) => {
                const Icon = TYPE_ICON[ty.id];
                return (
                  <button key={ty.id} type="button" onClick={() => dispatch({ t: "choose", type: ty.id })}
                    onMouseEnter={() => setHoverType(ty.id)} onMouseLeave={() => setHoverType(null)} onFocus={() => setHoverType(ty.id)} onBlur={() => setHoverType(null)}
                    className={cn("flex min-w-0 flex-col gap-2 rounded-block bg-surface2 p-4 text-left ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                      hoverType === ty.id ? "ring-2 ring-accent" : "ring-line hover:ring-accent/50")}>
                    <span className="flex items-center gap-2">
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-surface text-ink2"><Icon size={16} aria-hidden /></span>
                      <span className="text-[15px] font-medium">{ty.label}</span>
                      <span className="ml-auto text-[12px] text-ink3">{ty.room}</span>
                    </span>
                    <span className="text-[13px] text-ink2">{ty.text}</span>
                  </button>
                );
              })}
              <div aria-disabled className="hatched flex min-w-0 flex-col gap-2 rounded-block bg-surface2 p-4 text-ink3 ring-1 ring-line">
                <span className="flex items-center gap-2"><span className="text-[15px] font-medium">{t("studio.cinematic.stage.rebuilt", "Rebuilt product")}</span><Chip className="ml-auto">{t("studio.cinematic.stage.comingLater", "Coming later")}</Chip></span>
                <span className="text-[13px]">{t("studio.cinematic.stage.rebuiltText", "Rebuild an existing product on a new platform.")}</span>
              </div>
            </div>
          </Panel>
        )}

        {s.phase === "entering" && s.type && (
          <Panel className="max-w-md py-3 text-center text-[14px] text-ink2">
            {s.type === "brownfield" ? t("studio.cinematic.stage.walkingToMeeting", "Walking to the meeting room…") : t("studio.cinematic.stage.walkingToCafe", "Walking to the coffee shop…")}
          </Panel>
        )}

        {line && s.phase !== "entering" && (
          <Panel>
            <Speech key={lineKey} line={line} reduced={reduced}>
              {s.phase === "greet" && (
                <div className="flex justify-end"><Button variant="primary" autoFocus onClick={() => dispatch({ t: "continue" })} iconRight={<ArrowRight size={16} />}>{t("studio.cinematic.stage.letsTalk", "Let's talk")}</Button></div>
              )}
              {s.phase === "name" && (
                <form noValidate className="flex flex-col gap-2 sm:flex-row sm:items-start" onSubmit={(e) => { e.preventDefault(); dispatch({ t: "submit" }); }}>
                  <div className="min-w-0 flex-1">
                    <Input autoFocus value={s.name} maxLength={80} placeholder={t("studio.cinematic.stage.projectName", "Project name")} aria-label={t("studio.cinematic.stage.projectName", "Project name")}
                      aria-invalid={s.error ? true : undefined} onChange={(e) => dispatch({ t: "name", value: e.target.value })} />
                    {s.error && <p role="alert" className="mt-1.5 text-[13px] text-danger">{s.error}</p>}
                  </div>
                  <span className="flex items-center gap-2 self-end sm:self-auto">
                    <Button type="submit" variant="primary">{t("studio.cinematic.stage.next", "Next")}</Button>
                  </span>
                </form>
              )}
              {s.phase === "brief" && (
                <form noValidate className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); dispatch({ t: "submit" }); }}>
                  <Textarea autoFocus value={s.brief} rows={4} aria-label={s.type === "brownfield" ? t("studio.cinematic.stage.briefExisting", "The product today and what should change") : t("studio.cinematic.stage.briefNew", "What you want to build")}
                    placeholder={s.type === "brownfield" ? t("studio.cinematic.stage.briefExistingHint", "The product today, who uses it, what should change…") : t("studio.cinematic.stage.briefNewHint", "Who it is for, the problem it solves, the first version…")}
                    aria-invalid={s.error ? true : undefined} onChange={(e) => dispatch({ t: "brief", value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); dispatch({ t: "submit" }); } }} />
                  {s.error ? <p role="alert" className="text-[13px] text-danger">{s.error}</p>
                    : <p className="text-[13px] text-ink3">{t("studio.cinematic.stage.savedAsNote", "Saved word for word as the project's first note in Project setup.")}</p>}
                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => dispatch({ t: "back" })}>{t("studio.cinematic.stage.back", "Back")}</Button>
                    <Button type="submit" variant="primary">{t("studio.cinematic.stage.next", "Next")}</Button>
                  </div>
                </form>
              )}
              {s.phase === "confirm" && (
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" onClick={() => dispatch({ t: "back" })}>{t("studio.cinematic.stage.changeSomething", "Change something")}</Button>
                  <Button variant="primary" autoFocus onClick={() => { warmStepChunks(); submitCreate(); }}>{t("studio.cinematic.stage.createProject", "Create the project")}</Button>
                </div>
              )}
              {s.phase === "edit" && (
                <form noValidate className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); submitCreate(); }}>
                  <Input autoFocus value={s.name} maxLength={80} placeholder={t("studio.cinematic.stage.projectName", "Project name")} aria-label={t("studio.cinematic.stage.projectName", "Project name")}
                    onChange={(e) => dispatch({ t: "name", value: e.target.value })} />
                  <Textarea value={s.brief} rows={3} aria-label={s.type === "brownfield" ? t("studio.cinematic.stage.briefExisting", "The product today and what should change") : t("studio.cinematic.stage.briefNew", "What you want to build")}
                    onChange={(e) => dispatch({ t: "brief", value: e.target.value })} />
                  {s.error && <p role="alert" className="text-[13px] text-danger">{s.error}</p>}
                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => dispatch({ t: "back" })}>{t("studio.cinematic.stage.cancel", "Cancel")}</Button>
                    <Button type="submit" variant="primary">{t("studio.cinematic.stage.createProject", "Create the project")}</Button>
                  </div>
                </form>
              )}
              {failedCreate && (
                <div className="flex flex-col gap-3">
                  <Banner tone="danger" title={t("studio.cinematic.stage.createFailed", "The project could not be created.")} text={s.error ?? undefined} />
                  <div className="flex justify-end gap-2">
                    <Button variant="ghost" onClick={() => dispatch({ t: "back" })}>{t("studio.cinematic.stage.changeSomething", "Change something")}</Button>
                    <Button variant="primary" autoFocus onClick={() => dispatch({ t: "retry" })}>{t("studio.cinematic.stage.tryAgain", "Try again")}</Button>
                  </div>
                </div>
              )}
              {s.phase === "leaving" && s.create === "pending" && <Status>{t("studio.cinematic.stage.creating", "Creating the project…")}</Status>}
              {s.phase === "door" && s.create === "pending" && <Status>{t("studio.cinematic.stage.settingUp", "Setting up your project…")}</Status>}
              {s.phase === "door" && s.create === "created" && (
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <span className="text-[13px] text-ink3">{t("studio.cinematic.stage.clickDoor", "Click the door, or")}</span>
                  <Button variant="primary" autoFocus icon={<DoorOpen size={16} />} onClick={() => dispatch({ t: "knock" })}>{t("studio.cinematic.stage.knock", "Knock and go in")}</Button>
                </div>
              )}
              {s.phase === "team" && (
                <div className="flex flex-col gap-3">
                  {s.handOver === "failed" && <Banner tone="danger" title={t("studio.cinematic.stage.analysisFailed", "The project analysis could not be started.")} text={s.error ?? undefined} />}
                  {choice === "handOver" && <p className="text-[13px] text-ink3">{t("studio.cinematic.stage.handOverHint", "Starting the project analysis moves the project to {next}. You can keep adding material in Project setup.", { next: nextLabel })}</p>}
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant={choice === "handOver" ? "ghost" : "primary"} autoFocus={choice !== "handOver"}
                      disabled={s.handOver === "pending"} onClick={() => dispatch({ t: "toBusiness" })}>{t("studio.cinematic.stage.openSetup", "Open Project setup")}</Button>
                    {choice === "handOver" && (
                      <Button variant="primary" autoFocus icon={<Send size={16} aria-hidden />} disabled={s.handOver === "pending"} onClick={runHandOver}>
                        {s.handOver === "pending" ? t("studio.cinematic.stage.starting", "Starting…") : s.handOver === "failed" ? t("studio.cinematic.stage.tryAgain", "Try again") : t("studio.cinematic.stage.startAnalysis", "Start project analysis")}
                      </Button>
                    )}
                  </div>
                </div>
              )}
              {s.phase === "onward" && <Status>{t("studio.cinematic.stage.walkingToBoard", "Walking to the product team's board…")}</Status>}
              {s.phase === "done" && <Status>{s.exit === "sanitization" ? t("studio.cinematic.stage.opening", "Opening {step}…", { step: nextLabel }) : t("studio.cinematic.stage.openingSetup", "Opening Project setup…")}</Status>}
            </Speech>
          </Panel>
        )}
      </div>
      <div aria-hidden style={{ transitionDelay: s.exit === "sanitization" && !reduced ? "1800ms" : "0ms" }}
        className={cn("pointer-events-none absolute inset-0 bg-canvas transition-opacity duration-[1400ms] ease-in", s.phase === "done" ? "opacity-100" : "opacity-0")} />
    </div>
  );
}

/** The route: the same sign-in guard as the app shell, full screen; everyone who cannot walk it gets the form. */
export default function CinematicNewProject() {
  const { pathname, search } = useLocation();
  const status = useSession((st) => st.status);
  const mustChange = useSession((st) => st.status === "signed-in" && st.profile?.mustChangePassword === true);
  const persona = usePersona();
  const ready = useWorkspaces((st) => st.ready);
  const noWorkspace = useWorkspaces((st) => st.ready && st.workspaces.length === 0);
  const ctx = useProjectsContext();
  const reduced = useReducedMotion();
  const [webgl] = useState(hasWebGL);
  const forced = new URLSearchParams(search).has("motion");
  const [film] = useState(() => pickStory(search) !== null);

  if (mustChange) return <Navigate to={signInRedirect(pathname, search)} replace />;
  const blank = <BareShell><div className="min-h-screen bg-canvas" aria-busy="true" /></BareShell>;
  if (status === "restoring" || (status === "signed-in" && !persona)) return blank;
  const to = guardRedirect(pathname, search, status);
  if (to || !persona) return <Navigate to={to ?? "/sign-in"} replace />;
  if (!ready) return blank;
  const canCreate = ctx.isSuperAdmin || can(ctx.permissions, "project.create");
  // reduced motion: the office visit cuts between places instead of walking (the scripted film has no such cut)
  if (noWorkspace || !canCreate || !webgl || (film && reduced && !forced)) return <Navigate to="/new" replace />;
  // the office visit (the app's own steps as a conversation); the promo film's scripted story only when asked for
  return <BareShell appIcons theme="light">{film ? <JourneyStage /> : <OfficeStage />}</BareShell>;
}
