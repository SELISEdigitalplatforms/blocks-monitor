// One measure over time for one host (the Engine & capacity charts): a single series in the theme's accent, a
// recessive baseline and top line, the latest value labelled at the end of the line, and a crosshair with the time and
// value under the pointer. One series, so no legend: the title names it. The table view lives with the section.
import { useRef, useState, type PointerEvent } from "react";
import { clockTime } from "./engineData";
import { useT } from "@/i18n";

export interface TrendPoint {
  at: string;
  value: number;
}

export function trendPath(points: readonly TrendPoint[], max: number, from: number, to: number): string {
  if (points.length === 0 || max <= 0 || to <= from) return "";
  const x = (at: string) => ((Date.parse(at) - from) / (to - from)) * 100;
  const y = (v: number) => 40 - (Math.max(0, Math.min(v, max)) / max) * 40;
  return points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.at).toFixed(2)},${y(p.value).toFixed(2)}`).join(" ");
}

export function TrendChart({ title, points, max, format, from, to }: {
  title: string;
  points: readonly TrendPoint[];
  /** The top of the scale (100 for a share; the host's total for memory; the peak otherwise). */
  max: number;
  format: (v: number) => string;
  from: number;
  to: number;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const last = points[points.length - 1];
  const top = Math.max(max, 1);
  const xOf = (at: string) => Math.max(0, Math.min(100, ((Date.parse(at) - from) / (to - from)) * 100));
  const yOf = (v: number) => 100 - (Math.max(0, Math.min(v, top)) / top) * 100;
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || points.length === 0) return;
    const at = from + ((e.clientX - r.left) / r.width) * (to - from);
    let best = 0;
    for (let i = 1; i < points.length; i += 1) {
      if (Math.abs(Date.parse(points[i]!.at) - at) < Math.abs(Date.parse(points[best]!.at) - at)) best = i;
    }
    setHover(best);
  };
  const h = hover !== null ? points[hover] : null;
  const summary = last
    ? t("platform.trend.summary", "{title}: now {now}, highest {highest} in the last 24 hours", { title, now: format(last.value), highest: format(Math.max(...points.map((p) => p.value))) })
    : t("platform.trend.summaryEmpty", "{title}: no samples in the last 24 hours", { title });

  return (
    <figure className="min-w-0">
      <figcaption className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="font-medium text-ink">{title}</span>
        {last && <span className="tabular-nums text-ink2">{t("platform.trend.nowValue", "now {value}", { value: format(last.value) })}</span>}
      </figcaption>
      {points.length === 0 ? (
        <p className="mt-2 rounded-block bg-surface2 px-3 py-6 text-center text-[13px] text-ink3">{t("platform.trend.noSamples", "No samples in the last 24 hours")}</p>
      ) : (
        <div
          ref={box}
          className="relative mt-2 h-28 touch-none select-none"
          role="img"
          aria-label={summary}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        >
          {/* recessive frame: the top of the scale and the baseline */}
          <div className="absolute inset-x-0 top-0 border-t border-dashed border-line" aria-hidden />
          <div className="absolute inset-x-0 bottom-0 border-t border-line" aria-hidden />
          <span className="absolute -top-2 right-0 bg-surface pl-1 text-[11px] tabular-nums text-ink3" aria-hidden>{format(top)}</span>
          <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible text-accent" aria-hidden>
            <path d={trendPath(points, top, from, to)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>
          {last && (
            <span
              className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface"
              style={{ left: `${xOf(last.at)}%`, top: `${yOf(last.value)}%` }}
              aria-hidden
            />
          )}
          {h && (
            <>
              <div className="pointer-events-none absolute inset-y-0 w-px bg-ink3/60" style={{ left: `${xOf(h.at)}%` }} aria-hidden />
              <span
                className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent ring-2 ring-surface"
                style={{ left: `${xOf(h.at)}%`, top: `${yOf(h.value)}%` }}
                aria-hidden
              />
              <div
                className="pointer-events-none absolute -top-1 z-10 -translate-y-full whitespace-nowrap rounded-block bg-surface px-2 py-1 text-[12px] text-ink shadow-float ring-1 ring-line"
                style={xOf(h.at) > 60 ? { right: `${100 - xOf(h.at)}%` } : { left: `${xOf(h.at)}%` }}
              >
                <span className="text-ink3">{clockTime(h.at)}</span> <span className="tabular-nums">{format(h.value)}</span>
              </div>
            </>
          )}
        </div>
      )}
      <div className="mt-1 flex justify-between text-[11px] text-ink3" aria-hidden>
        <span>{clockTime(new Date(from).toISOString())}</span>
        <span>{t("platform.trend.now", "now")}</span>
      </div>
    </figure>
  );
}
