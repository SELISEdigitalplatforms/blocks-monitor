/** The build as a multi-track timeline: one track per pipeline stage, real work as clips, a playhead for now.
 *  A clip is a stretch of time the milestone's tickets really spent in that stage's board column (from their recorded
 *  moves; overlapping tickets merge into one clip); the Release to dev track holds the milestone's preview deploys.
 *  Hatched clips are tickets waiting in Planned. Every real send-back (a ticket moved back to an earlier column) draws a
 *  connector from the stage that sent it up to the stage that got it. On a phone the tracks scroll sideways inside the
 *  card under pinned track names, and keep the playhead in view while the build runs, until the person scrolls them. */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, TriangleAlert, Workflow } from "lucide-react";
import { STAGES, type StageState, type StageStatus } from "@/madp/data/pipeline";
import type { StageId } from "@/madp/data/types";
import type { DeliveryTicket } from "@/madp/blocks/delivery/types";
import { estimateBuild } from "@/madp/domain/engineEstimate";
import { AGENT_NAME } from "@/madp/lib/factoryLabels";
import { cn } from "@/madp/lib/cn";
import { Card, Chip, Dot } from "@/madp/ui/kit";
import { COLUMN_STAGE, fmtElapsed, pctOf, type BuildWindow, type Clip, type SendBack } from "./model";
import { STATUS_WORD, stageWithAgent } from "./stageUi";
import { useT } from "@/madp/i18n";
import { useEstimates } from "./EstimatesContext";
import { buildEstimateTitle, estimateTimeText } from "./estimateText";

const ROW_H = 36;
const RULER_H = 30;
const rowTop = (i: number) => RULER_H + i * ROW_H;
const indexOf = (id: StageId) => STAGES.findIndex((s) => s.id === id);

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

/** Text width in the timeline's font (Outfit 500, 12 px), measured once per text once the font has loaded. */
const FONT = "500 12px 'Outfit Variable', Outfit, system-ui, sans-serif";
const widths = new Map<string, number>();
let measureCtx: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string): number {
  const known = widths.get(text);
  if (known !== undefined) return known;
  if (typeof document === "undefined") return text.length * 7;
  if (measureCtx === undefined) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * 7;
  measureCtx.font = FONT;
  const w = measureCtx.measureText(text).width;
  if (document.fonts?.check(FONT) !== false) widths.set(text, w);
  return w;
}

/** A linked stage (?stage=…) is lit for a moment: its track name and lane in the accent tint. */
const LIT = "bg-accent-soft";

/** Brings a linked stage's track into the middle of the view (at once where motion is reduced). */
function scrollToTrack(el: HTMLElement | null | undefined) {
  if (!el || typeof window === "undefined" || typeof el.scrollIntoView !== "function") return;
  const calm = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ block: "center", inline: "nearest", behavior: calm ? "auto" : "smooth" });
}

/** A calm note in a selected track with nothing recorded yet: right of the playhead while there is room, else at the start. */
function LaneNote({ note, p }: { note: { stage: StageId; text: string }; p: number }) {
  return (
    <span className="pointer-events-none absolute flex items-center whitespace-nowrap text-[12px] text-ink3"
      style={{ top: rowTop(indexOf(note.stage)), height: ROW_H, left: p <= 55 ? `calc(${p}% + 12px)` : 12 }}>{note.text}</span>
  );
}

/** Where the playhead's time pill sits: centred on the playhead, or ending at it near either edge of the lanes. */
const pillAlign = (p: number) => (p < 8 ? "start" : p > 92 ? "end" : "center");
/** The pill's extent in lane pixels (its text plus 8 px padding a side). */
function pillExtent(p: number, laneW: number, label: string): [number, number] {
  const x = (p / 100) * laneW, w = textWidth(label) + 16, a = pillAlign(p);
  return a === "start" ? [x, x + w] : a === "end" ? [x - w, x] : [x - w / 2, x + w / 2];
}

export interface TimelineProps {
  window: BuildWindow;
  stages: StageState[];
  clips: Clip[];
  backs: SendBack[];
  tickets: DeliveryTicket[];
  ticketCode: (t: DeliveryTicket) => string;
  columnName: (c: string) => string;
  selected: StageId | null;
  onSelect?: (id: StageId) => void;
  title?: string;
  subtitle?: string;
  className?: string;
  /** the playhead is the replay clock, not now */
  replaying?: boolean;
  /** a linked stage, scrolled into view and lit for a moment */
  lit?: StageId | null;
  /** a calm note in a selected track with nothing recorded yet */
  note?: { stage: StageId; text: string } | null;
}

export function Timeline({ window: w, stages, clips, backs, tickets, ticketCode, columnName, selected, onSelect, title: titleProp, subtitle, className, replaying = false, lit = null, note = null }: TimelineProps) {
  const t = useT();
  const title = titleProp ?? t("build.tabs.timeline", "Timeline");
  const live = w.live;
  const p = pctOf(w, w.head);
  const [laneRef, laneW] = useWidth<HTMLDivElement>();
  const headRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const status = new Map(stages.map((s) => [s.id, s.status]));
  // on a phone the tracks overflow: keep the playhead at about a third of the view while the build runs, until the
  // person scrolls the tracks themselves
  const scroller = useRef<HTMLDivElement>(null);
  const autoLeft = useRef<number | null>(null);
  const manual = useRef(false);
  useEffect(() => {
    const el = scroller.current, lane = laneRef.current;
    if (!live || manual.current || !el || !lane || el.scrollWidth <= el.clientWidth) return;
    // the lanes show right of the pinned track names
    const shown = el.clientWidth - (lane.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft);
    const left = Math.round(Math.max(0, Math.min(el.scrollWidth - el.clientWidth, (p / 100) * laneW - shown * 0.35)));
    autoLeft.current = left;
    el.scrollLeft = left;
  }, [live, p, laneW, laneRef]);
  const onScroll = () => {
    const el = scroller.current;
    if (el && autoLeft.current !== null && Math.abs(el.scrollLeft - autoLeft.current) > 2) manual.current = true;
  };
  useEffect(() => { if (lit) scrollToTrack(headRefs.current[indexOf(lit)]); }, [lit]);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const cur = selected ? indexOf(selected) : -1;
    const next = Math.max(0, Math.min(STAGES.length - 1, cur + (e.key === "ArrowDown" ? 1 : -1)));
    onSelect?.(STAGES[next].id);
    headRefs.current[next]?.focus();
  };
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const total = fmtElapsed(w.head - w.start);
  // the build's real estimate, as the Studio shows it (src/domain/engineEstimate.ts); nothing without enough history
  const estimate = estimateBuild(useEstimates(), tickets.map((tk) => tk.type));
  const estimated = estimate ? estimateTimeText(estimate.minutes) : null;

  return (
    <Card className={className} icon={<Workflow size={18} strokeWidth={1.75} />} bodyClassName="pt-3"
      title={<span className="flex items-baseline gap-3">{title}{subtitle && <span className="hidden text-[13px] font-normal text-ink3 md:inline">{subtitle}</span>}</span>}
      action={
        <span className="hidden items-baseline gap-1.5 whitespace-nowrap sm:flex" aria-label={estimated ? t("build.timeline.timeWithEstimate", "Build time {total}, estimated {estimate}", { total, estimate: estimated }) : t("build.timeline.time", "Build time {total}", { total })}>
          <span className="text-[12px] text-ink3">{t("build.timeline.buildTime", "Build time")}</span>
          <span className="num text-[14px] font-medium text-ink">{total}</span>
          {estimate && estimated && <span className="num text-[13px] text-ink3" title={buildEstimateTitle(estimate)}>· {t("build.timeline.estimated", "estimated {estimate}", { estimate: estimated })}</span>}
        </span>
      }>
      {/* isolate: the layers below (track names z-[45] over the clips z-40 and the playhead z-30) stack inside the card
          only, so the page scrolls under the sticky top bar (z-30) and project stepper (z-20) without showing through */}
      <div ref={scroller} onScroll={onScroll} className="scroll-thin isolate -mx-2 overflow-x-auto px-2 pb-1">
        <div className="flex min-w-[640px]">
          {/* track headers, pinned while the lanes scroll; the shadow covers the scroller's 8 px gutter on its left */}
          <div className="sticky left-0 z-[45] w-[120px] shrink-0 bg-surface shadow-[-8px_0_0_rgb(var(--c-surface))] sm:w-[172px]" role="toolbar" aria-orientation="vertical" aria-label={t("build.timeline.stages", "Stages")} onKeyDown={onKey}>
            <div style={{ height: RULER_H }} className="flex items-end pb-2 pl-2 text-[12px] font-medium uppercase tracking-wider text-ink3">{t("build.timeline.stage", "Stage")}</div>
            {STAGES.map((s, i) => {
              const st = status.get(s.id) ?? "planned";
              const isSel = selected === s.id;
              return (
                <button key={s.id} ref={(el) => { headRefs.current[i] = el; }} type="button" onClick={() => onSelect?.(s.id)}
                  aria-pressed={isSel} aria-label={`${stageWithAgent(s.id)}: ${STATUS_WORD[st]}`}
                  tabIndex={isSel || (!selected && i === 0) ? 0 : -1}
                  style={{ height: ROW_H }}
                  className={cn("flex w-full items-center gap-2.5 rounded-l-block pl-2 pr-3 text-left transition-colors",
                    lit === s.id ? LIT : isSel ? "bg-surface2" : "hover:bg-surface2/60")}>
                  <span className="num hidden w-5 shrink-0 text-[12px] text-ink3 sm:block">{s.id === "deploy" ? "↗" : ""}</span>
                  <span className={cn("h-2 w-2 shrink-0 rounded-full transition-colors duration-500",
                    st === "done" && "bg-ink", st === "active" && "animate-pulse-dot bg-accent", st === "planned" && "bg-line",
                    (st === "sent-back" || st === "blocked") && "bg-warning", st === "sent-back" && "animate-pulse-dot")} />
                  <span className="min-w-0 leading-tight">
                    <span className={cn("block truncate text-[13px]", st === "planned" ? "text-ink2" : "font-medium text-ink")}>{s.name}</span>
                    <span className="hidden truncate text-[12px] text-ink3 sm:block">{subline(s.id, s.name, st)}</span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* lanes */}
          <div ref={laneRef} className="relative min-w-0 flex-1" style={{ height: RULER_H + STAGES.length * ROW_H }}>
            <Ruler w={w} p={p} laneW={laneW} />
            {/* elapsed tint */}
            <div aria-hidden className="absolute bottom-0 left-0 rounded-bl-block bg-accent/[0.035] transition-[width] duration-300 ease-linear" style={{ top: RULER_H, width: `${p}%` }} />
            {STAGES.map((s, i) => (
              <div key={s.id} style={{ top: rowTop(i), height: ROW_H }} onClick={() => onSelect?.(s.id)}
                className={cn("absolute inset-x-0 rounded-r-block border-b border-line/60 transition-colors", lit === s.id ? LIT : selected === s.id && "bg-surface2")} />
            ))}
            {note && <LaneNote note={note} p={p} />}
            {clips.map((c) => (
              <ClipBlock key={c.id} clip={c} w={w} laneW={laneW} tickets={c.ticketIds.map((id) => byId.get(id)).filter((t): t is DeliveryTicket => !!t)}
                ticketCode={ticketCode} onSelect={onSelect} />
            ))}

            {backs.map((b) => {
              const from = indexOf(COLUMN_STAGE[b.from]), to = indexOf(COLUMN_STAGE[b.to]);
              const x = pctOf(w, b.at);
              const tk = byId.get(b.ticketId);
              const open = b.phase === "open";
              const what = t("build.timeline.sentBack", "{ticket} sent back from {from} to {to}", { ticket: tk ? `${ticketCode(tk)} ${tk.title}` : t("build.banner.aTicket", "A ticket"), from: columnName(b.from), to: columnName(b.to) });
              return (
                <div key={b.id}>
                  {/* the send-back: from the stage that sent it up to the stage that got it */}
                  <div aria-hidden className={cn("pointer-events-none absolute z-10 border-l-2 border-dashed transition-colors duration-500", open ? "border-warning" : "border-success/70")}
                    style={{ left: `${x}%`, top: rowTop(to) + ROW_H / 2, height: (from - to) * ROW_H }} />
                  <span title={what}
                    className={cn("absolute z-20 grid h-6 w-6 -translate-x-1/2 place-items-center rounded-full ring-4 ring-surface transition-colors duration-500",
                      open ? "bg-danger text-white" : b.phase === "rechecking" ? "bg-warning text-stage" : "bg-success text-white dark:text-stage")}
                    style={{ left: `${x}%`, top: rowTop(from) + ROW_H / 2 - 12 }}>
                    {open ? <TriangleAlert size={12} strokeWidth={2.25} /> : <Check size={12} strokeWidth={2.25} />}
                  </span>
                  <span className="sr-only">{`${what}. ${open ? t("build.timeline.beingFixed", "Being fixed.") : b.phase === "rechecking" ? t("build.timeline.rechecking", "Being re-checked.") : t("build.timeline.fixed", "Fixed and passed.")}`}</span>
                </div>
              );
            })}

            <Playhead p={p} label={total} live={live} />
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 pl-2 text-[12px] text-ink3">
        <Legend />
        <span className="ml-auto">{replaying ? t("build.page.replay.replay", "Replay") : live ? t("build.timeline.running", "Running now") : t("build.timeline.finished", "Finished")} · {t("build.timeline.ofBuildTime", "{total} of build time", { total })}</span>
      </div>
    </Card>
  );
}

/** A track header's second line: who works the stage, or its status where the agent's name is the stage's name. */
function subline(id: StageId, name: string, st: StageStatus): string {
  if (st === "sent-back") return STATUS_WORD[st];
  if (id === "deploy") return "SELISE Blocks";
  return AGENT_NAME[id] === name ? STATUS_WORD[st] : AGENT_NAME[id];
}

function Legend() {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5" aria-hidden>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-full bg-bar" />{t("build.timeline.legend.done", "Done")}</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-full bg-accent" />{t("build.timeline.legend.working", "Working")}</span>
      <span className="flex items-center gap-1.5"><span className="hatched h-2.5 w-4 rounded-full bg-surface2 ring-1 ring-inset ring-line" />{t("build.timeline.legend.waiting", "Waiting")}</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-full bg-warning" />{t("build.timeline.legend.sentBack", "Sent back / on hold")}</span>
      <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-full bg-success-soft ring-1 ring-inset ring-success/30" />{t("build.timeline.legend.fixed", "Fixed / passed")}</span>
    </div>
  );
}

const STEPS_MIN = [1, 2, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1440, 2880, 10080];
const tickLabel = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60}` : m % 1440 || m < 2880 ? `${m / 60} h` : `${m / 1440} d`);

/** Elapsed-time ticks over the window (at most about eight); labels within 6 px of the playhead's pill are left out. */
function Ruler({ w, p, laneW }: { w: BuildWindow; p: number; laneW: number }) {
  const spanMin = (w.end - w.start) / 60_000;
  const step = STEPS_MIN.find((s) => spanMin / s <= 8) ?? STEPS_MIN[STEPS_MIN.length - 1];
  const ticks = Array.from({ length: Math.floor(spanMin / step) + 1 }, (_, k) => k * step);
  const pill = pillExtent(p, laneW, fmtElapsed(w.head - w.start));
  const clear = (x0: number, x1: number) => x1 + 6 <= pill[0] || x0 - 6 >= pill[1];
  return (
    <div aria-hidden className="absolute inset-x-0 top-0" style={{ height: RULER_H }}>
      {ticks.map((m) => {
        const pct = (m / spanMin) * 100;
        const left = `${pct}%`;
        const label = tickLabel(m);
        const x = (pct / 100) * laneW, tw = textWidth(label);
        const crowded = m > 0 && x + tw / 2 + 4 > laneW;
        return (
          <div key={m}>
            <span className="absolute bottom-0 h-2 w-px bg-ink3/50" style={{ left }} />
            {!crowded && clear(m === 0 ? x : x - tw / 2, m === 0 ? x + tw : x + tw / 2) && (
              <span className={cn("num absolute bottom-2.5 whitespace-nowrap text-[12px] text-ink3", m === 0 ? "" : "-translate-x-1/2")} style={{ left }}>{label}</span>
            )}
            {m > 0 && pct < 97 && <span className="absolute w-px bg-line/70" style={{ left, top: RULER_H, height: STAGES.length * ROW_H }} />}
          </div>
        );
      })}
    </div>
  );
}

function Playhead({ p, label, live }: { p: number; label: string; live: boolean }) {
  const align = { start: "translate-x-0", end: "-translate-x-full", center: "-translate-x-1/2" }[pillAlign(p)];
  return (
    <div aria-hidden className="pointer-events-none absolute inset-y-0 z-30 transition-[left] duration-300 ease-linear" style={{ left: `${p}%` }}>
      <span className={cn("num absolute top-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium shadow-float", live ? "bg-accent text-white" : "bg-ink text-canvas", align)}>{label}</span>
      <span className={cn("absolute bottom-0 w-0.5 -translate-x-1/2 rounded-full", live ? "bg-accent" : "bg-ink/60")} style={{ top: RULER_H - 6 }} />
      <span className={cn("absolute h-2 w-2 -translate-x-1/2 rotate-45 rounded-[2px]", live ? "bg-accent" : "bg-ink/60")} style={{ top: RULER_H - 9 }} />
    </div>
  );
}

function ClipBlock({ clip: c, w, laneW, tickets, ticketCode, onSelect }: {
  clip: Clip; w: BuildWindow; laneW: number; tickets: DeliveryTicket[]; ticketCode: (t: DeliveryTicket) => string; onSelect?: (id: StageId) => void;
}) {
  const t = useT();
  const from = pctOf(w, c.from), to = Math.max(pctOf(w, c.to), from + 0.6);
  const widthPx = ((to - from) / 100) * laneW - 4;
  const top = rowTop(indexOf(c.stage));
  const one = tickets.length === 1 ? tickets[0] : null;
  const release = Boolean(c.job && /"release"\s*:/.test(c.job.inputJson ?? ""));
  const full = c.job ? (release ? (c.job.status === "succeeded" ? t("build.timeline.clip.released", "Released to development") : t("build.pipeline.deploy.name", "Release to development")) : c.job.status === "succeeded" ? t("build.timeline.clip.previewOnline", "Preview online") : t("build.timeline.clip.previewGoing", "Preview going online"))
    : one ? `${ticketCode(one)} ${one.title}` : t("build.step.ticketsMany", "{count} tickets", { count: tickets.length });
  const short = c.job ? (release ? t("build.timeline.clip.release", "Release") : t("build.step.chip.preview", "Preview")) : one ? ticketCode(one) : String(tickets.length);
  // the full name when it fits, the short one otherwise, never an ellipsis (the tooltip and inspector carry the name)
  const room = widthPx - 20;
  const label = textWidth(full) <= room ? full : textWidth(short) <= room ? short : null;
  const look =
    c.state === "planned" ? "hatched bg-surface2 text-ink3 ring-1 ring-inset ring-line"
      : c.state === "held" ? "bg-warning text-stage"
        : c.sendBack ? (c.state === "active" ? "bg-warning text-stage" : "bg-success-soft text-success ring-1 ring-inset ring-success/30")
          : c.state === "active" ? "bg-accent text-white ring-2 ring-accent/25"
            : "bg-bar text-canvas dark:bg-bar/75";
  const span = `${fmtElapsed(c.from - w.start)} – ${fmtElapsed(c.to - w.start)}`;
  const word = c.state === "planned" ? t("build.timeline.legend.waiting", "Waiting") : c.state === "active" ? t("build.timeline.legend.working", "Working")
    : c.state === "held" ? (c.job?.status === "failed" ? t("build.jobs.status.failed", "Failed") : t("build.timeline.onHold", "On hold")) : c.sendBack ? t("build.timeline.clip.fixed", "Fixed") : t("build.timeline.legend.done", "Done");
  const tipRight = from > 62;
  return (
    <button type="button" tabIndex={-1} onClick={() => onSelect?.(c.stage)} aria-label={t("build.timeline.clip.label", "{name}: {state}, build time {span}", { name: full, state: word, span })}
      className={cn("group absolute rounded-full text-left transition-colors duration-500 hover:z-40 focus-visible:z-40", look, c.state === "active" && "z-[5]", c.sendBack && "z-[6]")}
      style={{ left: `calc(${from}% + 2px)`, width: `calc(${to - from}% - 4px)`, top: top + 5, height: ROW_H - 10 }}>
      <span className="relative block h-full overflow-hidden rounded-full">
        {label && <span className="block whitespace-nowrap px-2.5 text-[12px] font-medium leading-[26px]">{label}</span>}
      </span>
      <span role="tooltip"
        className={cn("pointer-events-none absolute bottom-full mb-2 hidden w-64 rounded-block bg-surface p-3 text-left text-ink shadow-float group-hover:block dark:border dark:border-line",
          tipRight ? "right-0" : "left-0")}>
        <span className="flex items-center gap-2">
          <span className="min-w-0 truncate text-[13px] font-medium">{full}</span>
          <Chip tone={c.state === "active" ? (c.sendBack ? "warning" : "accent") : c.state === "held" ? "warning" : c.state === "done" && c.sendBack ? "success" : "neutral"} className="ml-auto shrink-0">
            {c.state === "active" && <Dot tone={c.sendBack ? "warning" : "accent"} pulse />}{word}
          </Chip>
        </span>
        {!one && tickets.length > 1 && (
          <span className="mt-1 block text-[13px] leading-snug text-ink2">{tickets.slice(0, 4).map(ticketCode).join(", ")}{tickets.length > 4 ? ` and ${tickets.length - 4} more` : ""}</span>
        )}
        {c.job?.message && <span className="mt-1 block text-[13px] leading-snug text-ink2">{c.job.message}</span>}
        <span className="num mt-2 block text-[12px] text-ink3">Build time {span}</span>
      </span>
    </button>
  );
}

/** The timeline before any dated build: the same card, track names and legend, with empty lanes that say why. Nothing
 *  is drawn on the tracks until the engine records the build's start. */
export function EmptyTimeline({ title, text, subtitle, className, selected = null, lit = null, note = null }: {
  title: string; text: string; subtitle?: string; className?: string;
  /** a linked stage: its track stays marked, is scrolled into view and lit for a moment, and its note is added */
  selected?: StageId | null; lit?: StageId | null; note?: string | null;
}) {
  const t = useT();
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => { if (lit) scrollToTrack(rowRefs.current[indexOf(lit)]); }, [lit]);
  return (
    <Card className={className} icon={<Workflow size={18} strokeWidth={1.75} />} bodyClassName="pt-3"
      title={<span className="flex items-baseline gap-3">{t("build.tabs.timeline", "Timeline")}{subtitle && <span className="hidden text-[13px] font-normal text-ink3 md:inline">{subtitle}</span>}</span>}>
      <div className="scroll-thin isolate -mx-2 overflow-x-auto px-2 pb-1">
        <div className="flex min-w-[640px]">
          <div className="sticky left-0 z-[45] w-[120px] shrink-0 bg-surface shadow-[-8px_0_0_rgb(var(--c-surface))] sm:w-[172px]" aria-label={t("build.timeline.stages", "Stages")} role="list">
            <div style={{ height: RULER_H }} className="flex items-end pb-2 pl-2 text-[12px] font-medium uppercase tracking-wider text-ink3">{t("build.timeline.stage", "Stage")}</div>
            {STAGES.map((s, i) => (
              <div key={s.id} ref={(el) => { rowRefs.current[i] = el; }} role="listitem" style={{ height: ROW_H }} aria-label={`${stageWithAgent(s.id)}: ${STATUS_WORD.planned}`}
                {...(selected === s.id ? { "aria-current": true } : {})}
                className={cn("flex w-full items-center gap-2.5 rounded-l-block pl-2 pr-3 transition-colors", lit === s.id ? LIT : selected === s.id && "bg-surface2")}>
                <span className="num hidden w-5 shrink-0 text-[12px] text-ink3 sm:block">{s.id === "deploy" ? "↗" : ""}</span>
                <span className="h-2 w-2 shrink-0 rounded-full bg-line" />
                <span className="min-w-0 leading-tight">
                  <span className="block truncate text-[13px] text-ink2">{s.name}</span>
                  <span className="hidden truncate text-[12px] text-ink3 sm:block">{subline(s.id, s.name, "planned")}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="relative min-w-0 flex-1" style={{ height: RULER_H + STAGES.length * ROW_H }}>
            {STAGES.map((s, i) => (
              <div key={s.id} aria-hidden style={{ top: rowTop(i), height: ROW_H }}
                className={cn("absolute inset-x-0 rounded-r-block border-b border-line/60 transition-colors", lit === s.id ? LIT : selected === s.id && "bg-surface2")} />
            ))}
            <div className="absolute inset-x-3 grid place-items-center" style={{ top: RULER_H, bottom: 0 }}>
              <div role="status" className="hatched max-w-md rounded-block bg-surface2/90 px-6 py-5 text-center ring-1 ring-inset ring-line">
                <div className="text-[15px] font-medium text-ink">{title}</div>
                <p className="mt-1 text-[13px] text-ink2">{text}</p>
                {note && <p className="mt-2 text-[13px] text-ink3">{note}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 pl-2 text-[12px] text-ink3">
        <Legend />
        <span className="ml-auto">The tracks fill from the build&apos;s recorded steps</span>
      </div>
    </Card>
  );
}
