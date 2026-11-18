/** The office, lazily loaded (three.js is a large chunk), with the 2D floor as the fallback when
 *  WebGL is unavailable or the 3D chunk fails. Ported from MADP Studio. Nothing here imports three:
 *  the 3D chunk loads only when a stage scrolls into view. */

import { Component, type ComponentType, type ReactNode, Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { AgentFloor } from "./AgentFloor";
import type { OfficeProps } from "./Office3D";
import { isChunkLoadError, retryImport } from "./retry";
import { t, useT } from "@/madp/i18n";

let office3DLoaded = false;
let pending: Promise<{ default: ComponentType<OfficeProps> }> | null = null;
/** one shared download; a chunk-load failure is retried with a growing pause (helps where the browser re-fetches a failed
 *  module), and a failed promise is not kept */
const loadOffice3D = () => {
  pending ??= retryImport(() => import("./Office3D")).then(
    (m) => { office3DLoaded = true; return m; },
    (e: unknown) => { pending = null; throw e; },
  );
  return pending;
};

/** start downloading the 3D chunk early (e.g. on hover of a link to the build screen) */
export function preloadOffice3D(): void {
  void loadOffice3D().catch(() => undefined);
}

let webglProbe: boolean | undefined;

export function webglAvailable(): boolean {
  if (webglProbe !== undefined) return webglProbe;
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    webglProbe = Boolean(gl);
  } catch {
    webglProbe = false;
  }
  return webglProbe;
}

type FailReason = "load-failed" | "crashed";

/** catches a failed chunk or a crash of the 3D floor: the 2D floor stands in with a Try again */
class Boundary extends Component<{ fallback: (reason: FailReason) => ReactNode; children: ReactNode }, { failed: FailReason | null }> {
  state: { failed: FailReason | null } = { failed: null };
  static getDerivedStateFromError(e: unknown) { return { failed: isChunkLoadError(e) ? "load-failed" as const : "crashed" as const }; }
  render() { return this.state.failed ? this.props.fallback(this.state.failed) : this.props.children; }
}

/** the stage's loading state over its surroundings' colours (office.css fo-stage-env): a faint floor grid and one line,
 *  in the theme's ink, until the 3D floor is ready */
function StageSkeleton() {
  const t = useT();
  return (
    <div className="relative grid h-full w-full place-items-center overflow-hidden text-[rgb(var(--ink-2))]">
      <div aria-hidden className="absolute inset-0 opacity-[0.08] [background-image:linear-gradient(currentColor_1px,transparent_1px),linear-gradient(90deg,currentColor_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black_35%,transparent_75%)]" />
      <span role="status" className="relative animate-pulse-dot text-[13px]">{t("studio.office.stage.opening", "Opening the factory floor…")}</span>
    </div>
  );
}

const FALLBACK_TEXT: Record<"no-webgl" | FailReason, () => string> = {
  "no-webgl": () => t("studio.office.fallback.noWebgl", "3D needs WebGL, which this browser has turned off; showing the floor plan."),
  "load-failed": () => t("studio.office.fallback.loadFailed", "The 3D floor didn't load; showing the floor plan."),
  crashed: () => t("studio.office.fallback.crashed", "The 3D floor hit a problem; showing the floor plan."),
};

/** The 2D floor in place of the 3D one: without WebGL it says so. A 3D chunk that did not download (already retried with
 *  a growing pause) needs a page reload: browsers keep a failed module import for the page's lifetime. A crash of the 3D
 *  floor offers Try again (a fresh mount, no reload), and a page reload once that failed too. */
function Fallback({ props, reason, onRetry, retried }: { props: OfficeProps; reason: "no-webgl" | FailReason; onRetry?: () => void; retried?: boolean }) {
  const t = useT();
  const btn = "pointer-events-auto font-medium underline underline-offset-2";
  const action = reason === "no-webgl" ? null
    : reason === "load-failed" ? <button type="button" onClick={() => window.location.reload()} className={btn}>{t("studio.office.fallback.reload3d", "Reload 3D")}</button>
    : retried || !onRetry ? <button type="button" onClick={() => window.location.reload()} className={btn}>{t("studio.office.fallback.reloadPage", "Reload page")}</button>
    : <button type="button" onClick={onRetry} className={btn}>{t("studio.office.fallback.tryAgain", "Try again")}</button>;
  if (props.variant === "compact") {
    return (
      <div className="relative h-full w-full p-2">
        <AgentFloor view={props.view} dense />
        {action && <div role="status" className="absolute right-2 top-2 flex items-center gap-2 rounded-block bg-[rgb(var(--warning-soft))] px-2 py-1 text-[11px] text-[rgb(var(--warning-ink))]">{t("studio.office.fallback.paused", "3D paused")} {action}</div>}
      </div>
    );
  }
  return (
    <div className="flex h-full w-full flex-col gap-2 p-4">
      <div role="status" className="flex flex-wrap items-center gap-3 self-start rounded-block bg-[rgb(var(--warning-soft))] px-3 py-2 text-[12px] text-[rgb(var(--warning-ink))]">
        {FALLBACK_TEXT[reason]()}
        {action}
      </div>
      <div className="min-h-0 flex-1 overflow-auto"><AgentFloor view={props.view} fill /></div>
    </div>
  );
}

export function Office(props: OfficeProps) {
  if (!webglAvailable()) return <div className="w-full" style={{ height: props.height ?? 560 }}><Fallback props={props} reason="no-webgl" /></div>;
  return <Lazy3D {...props} />;
}

/** mounts the 3D chunk the first time the stage scrolls into view, then keeps it mounted */
function Lazy3D(props: OfficeProps) {
  const [seen, setSeen] = useState(office3DLoaded);
  // Try again remounts the boundary with a fresh lazy component (React.lazy keeps a rejected load forever)
  const [attempt, setAttempt] = useState(0);
  const Office3D = useMemo(() => lazy(loadOffice3D), [attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (seen) return;
    if (typeof IntersectionObserver === "undefined" || !ref.current) { setSeen(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: "200px 0px" });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen]);
  return (
    <div ref={ref} className="w-full" style={{ height: props.height ?? 560 }}>
      {seen ? (
        <Boundary key={attempt} fallback={(reason) => <Fallback props={props} reason={reason} retried={attempt >= 2} onRetry={() => setAttempt((n) => n + 1)} />}>
          <Suspense fallback={<StageSkeleton />}>
            <Office3D {...props} />
          </Suspense>
        </Boundary>
      ) : <StageSkeleton />}
    </div>
  );
}
