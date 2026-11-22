import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { Layers, MailCheck, ShieldCheck } from "lucide-react";
import { grain } from "@/components/landing/stage";
import { usePageVisible, useReducedMotion } from "@/components/landing/motion";
import { Logo } from "@/ui/Shell";
import { PRODUCT } from "@/data/facts";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";
import type { AuthMode } from "./auth";
import { Lifecycle } from "./Lifecycle";
import "@/components/landing/landing.css";
import "./cinema.css";

/** The line under the headline, per tab, in the current language. */
function line(t: ReturnType<typeof useT>, mode: AuthMode): string {
  return mode === "signin"
    ? t("auth.cinema.lineSignIn", "Describe what you need. MADP agents take it from brief to a verified release on SELISE Blocks.")
    : t("auth.cinema.lineSignUp", "MADP Factory is invite-only. Open your invitation email to set your password.");
}

/** The chips at the bottom of the pane, in the current language. */
function chips(t: ReturnType<typeof useT>) {
  return [
    { id: "blocks", label: t("auth.cinema.chipBlocks", "Runs on SELISE Blocks"), Icon: Layers },
    { id: "invite", label: t("auth.cinema.chipInvite", "Invite-only access"), Icon: MailCheck },
    { id: "verified", label: t("auth.cinema.chipVerified", "Verified at every stage"), Icon: ShieldCheck },
  ];
}

const d = (ms: number) => ({ "--si-d": `${ms}ms` }) as React.CSSProperties;

export function CinemaPane({ mode, entrance, className }: { mode: AuthMode; entrance: boolean; className?: string }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const visible = usePageVisible();
  const reduced = useReducedMotion();
  const grainUrl = useMemo(() => grain(), []);

  // pointer parallax: CSS variables only, no React state per frame
  useEffect(() => {
    const root = ref.current;
    if (!root || reduced) return;
    if (window.matchMedia("(hover: none), (pointer: coarse)").matches) return;
    let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
    const tick = () => {
      x += (tx - x) * 0.08;
      y += (ty - y) * 0.08;
      const settled = Math.abs(tx - x) < 0.002 && Math.abs(ty - y) < 0.002;
      if (settled) { x = tx; y = ty; }
      root.style.setProperty("--px", x.toFixed(4));
      root.style.setProperty("--py", y.toFixed(4));
      raf = settled ? 0 : requestAnimationFrame(tick);
    };
    const kick = () => { if (!raf) raf = requestAnimationFrame(tick); };
    const move = (e: PointerEvent) => {
      const r = root.getBoundingClientRect();
      if (!r.width || !r.height) return;
      tx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
      ty = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1));
      kick();
    };
    const leave = () => { tx = 0; ty = 0; kick(); };
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerleave", leave);
    return () => {
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", leave);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reduced]);

  return (
    <div
      ref={ref}
      data-theme="dark"
      data-in={entrance || undefined}
      data-paused={!visible || undefined}
      className={cn("si-cinema relative isolate min-w-0 flex-col overflow-hidden bg-stage text-ink", className)}
    >
      <div aria-hidden="true" className="si-c-layer si-c-gradient" />
      <div aria-hidden="true" className="si-c-layer si-c-floor">
        <div className="si-c-plane"><div className="si-c-grid" /></div>
      </div>
      <div aria-hidden="true" className="si-c-layer si-c-sweep" />
      <div
        aria-hidden="true"
        className="si-c-layer si-c-grain"
        style={grainUrl ? { backgroundImage: `url(${grainUrl})` } : undefined}
      />

      <div className="relative z-10 flex h-full flex-col justify-between gap-8 p-8 lg:p-12">
        <Link
          to="/"
          aria-label={t("auth.screen.logoLabel", "MADP Factory, back to the landing page")}
          style={d(120)}
          className="si-c-in flex w-fit items-center gap-3 rounded-full hover:[filter:drop-shadow(0_0_14px_rgb(var(--c-accent)/0.55))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-stage"
        >
          <Logo size={36} />
          <span className="text-[16px] font-medium tracking-tight">{PRODUCT}</span>
        </Link>

        <div>
          <p style={d(180)} className="si-c-in font-mono text-[12px] uppercase tracking-[0.14em] text-ink2">{t("auth.cinema.eyebrow", "Autonomous software factory")}</p>
          <p className="mt-4 text-[clamp(2.25rem,3.6vw,3.5rem)] font-medium leading-[1.02] tracking-[-0.03em]">
            <span style={d(260)} className="si-c-in block">{t("auth.cinema.headline1", "From idea to production.")}</span>
            <span style={d(340)} className="si-c-in lp-glow-text block w-fit max-w-full pb-[0.08em]">{t("auth.cinema.headline2", "Every stage verified.")}</span>
          </p>
          <p style={d(420)} className="si-c-in mt-5 max-w-[46ch] text-[15px] leading-relaxed text-ink2">{line(t, mode)}</p>
          <div style={d(500)} className="si-c-in"><Lifecycle className="mt-10" /></div>
        </div>

        <ul style={d(580)} className="si-c-in flex flex-wrap gap-2">
          {chips(t).map(({ id, label, Icon }) => (
            <li key={id} className="inline-flex items-center gap-1.5 rounded-full bg-ink/[0.05] px-3 py-1.5 text-[12px] text-ink2 ring-1 ring-line">
              <Icon size={14} strokeWidth={1.75} aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
