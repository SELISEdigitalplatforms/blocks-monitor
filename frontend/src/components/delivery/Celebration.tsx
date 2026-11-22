/** The go-live celebration: two soft confetti bursts and a ring pulse, once, when a new release arrives while the page is
 *  open. Nothing moves with reduced motion. The keyframes live in styles/index.css (no inline style element, CSP). */
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { useReducedMotion } from "./shared";

/** the stage is dark in both themes: the accent, success and white, in full and softer strength (no status colours) */
const COLORS = ["bg-accent", "bg-success", "bg-white", "bg-accent/60", "bg-success/70", "bg-white/70"];


interface Piece { left: number; dx: number; up: number; fall: number; rot: number; delay: number; dur: number; w: number; h: number; color: string; round: boolean }

function makePieces(count: number, duration: number): Piece[] {
  return Array.from({ length: count }, (_, i) => {
    const fromLeft = i % 2 === 0;
    const deg = fromLeft ? -52 - Math.random() * 30 : -128 + Math.random() * 30;
    const power = 280 + Math.random() * 300;
    const rad = (deg * Math.PI) / 180;
    const up = Math.sin(rad) * power;
    const round = i % 5 === 0;
    const w = 5 + Math.random() * 5;
    return {
      left: fromLeft ? 6 + Math.random() * 6 : 88 + Math.random() * 6,
      dx: Math.cos(rad) * power,
      up,
      fall: up + 220 + Math.random() * 260,
      rot: (Math.random() < 0.5 ? -1 : 1) * (240 + Math.random() * 540),
      delay: Math.random() * 260,
      dur: duration * (0.8 + Math.random() * 0.35),
      w,
      h: round ? w : w * (1.4 + Math.random() * 0.8),
      color: COLORS[i % COLORS.length],
      round,
    };
  });
}

export function Confetti({ count = 96, duration = 2800 }: { count?: number; duration?: number }) {
  const reduced = useReducedMotion();
  const [on, setOn] = useState(true);
  const pieces = useMemo(() => makePieces(count, duration), [count, duration]);
  useEffect(() => {
    const t = window.setTimeout(() => setOn(false), duration * 1.3);
    return () => window.clearTimeout(t);
  }, [duration]);
  if (reduced || !on) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
      {pieces.map((p, i) => (
        <span key={i} className={cn("absolute bottom-0", p.color, p.round ? "rounded-full" : "rounded-[2px]")}
          style={{
            left: `${p.left}%`, width: p.w, height: p.h,
            "--dx": `${p.dx}px`, "--up": `${p.up}px`, "--fall": `${p.fall}px`, "--rot": `${p.rot}deg`,
            animation: `madp-confetti ${p.dur}ms ${p.delay}ms both`,
          } as CSSProperties} />
      ))}
    </div>
  );
}

/** Expanding rings behind the live badge (a quiet "it happened"). */
export function RingPulse({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  if (reduced) return null;
  return (
    <span aria-hidden className={cn("pointer-events-none absolute inset-0", className)}>
      {[0, 500, 1000].map((d) => (
        <span key={d} className="absolute inset-0 rounded-full bg-success/50" style={{ animation: `madp-ring 1.8s cubic-bezier(.2,.6,.3,1) ${d}ms 2 both` }} />
      ))}
    </span>
  );
}
