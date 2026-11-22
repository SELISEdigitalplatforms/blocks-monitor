/** The screen-design job's progress, as the shimmer bar shows it. A design job reports few real steps (checking the
 *  feedback at 5 %, designing at 10 %) and then works for minutes in the design tool without a word, so a bar driven only
 *  by those steps sits still and looks stuck. Here the bar follows the larger of the job's real progress and an honest
 *  time curve based on how long a design usually takes; it never goes backwards for the same job, never shows 100 %
 *  before the job is done, and while the job says nothing new the line keeps its last real step with the elapsed time.
 *  Pure: no React, no clock (the caller passes `now`). */
import type { EngineJobStatus } from "@/domain/engineJob";
import { t } from "@/i18n";

/** What people are told a design takes. Since 09.11.2026 every design is drawn on the strongest model, then reviewed
 *  and polished (up to two rounds) before it is shown: about 45 to 75 minutes (drawing 25-45, each polish 10-25). */
export const DESIGN_TYPICAL = "about 45 to 75 minutes";
/** DESIGN_TYPICAL in the chosen language. */
export const designTypical = () => t("analysis.design.typical", "about 45 to 75 minutes");
/** The end of the usual range: past it the line says it is taking longer than usual. */
export const DESIGN_TYPICAL_MAX_MS = 75 * 60_000;
/** No new step or message for this long: the line says it is still working. */
export const DESIGN_IDLE_AFTER_MS = 45_000;
/** The time curve: after this long about 63 % of the way to its ceiling (about 55 % at 20 minutes, 85 % at 45). */
export const DESIGN_TIME_TAU_MS = 25 * 60_000;
/** The highest the time curve goes on its own; only real progress or the finished job go further. */
export const DESIGN_TIME_CEILING = 92;
/** The smallest fill shown, so a bar that has just started is still visible. */
export const DESIGN_MIN_SHOWN = 4;

/** The part of an engine job the bar reads. */
export interface DesignProgressJob {
  id: string;
  status: EngineJobStatus;
  progress: number;
  message: string | null;
  createdAt: string | null;
  claimedAt: string | null;
  updatedAt: string | null;
}

/** What the bar remembers between renders of the same job. */
export interface DesignProgressMemo {
  jobId: string;
  /** The highest value shown so far. */
  shown: number;
  /** The last real progress the job reported. */
  real: number;
  /** The last real step text the job reported (kept when a later read has none). */
  message: string | null;
  /** When the real progress or step text last changed (ms). */
  changedAt: number;
}

export interface DesignProgressView {
  memo: DesignProgressMemo;
  /** The fill, a whole number 0-100. */
  shown: number;
  /** Picked up by the design worker and working (the shimmer and the time curve run only then). */
  working: boolean;
  /** Waiting for a design worker to pick it up. */
  queued: boolean;
  /** The last real step text, or the fallback. */
  stepText: string;
  /** Since the job started (or was requested, while queued); null without a usable time. */
  elapsedMs: number | null;
  /** Working, but no new step or message for DESIGN_IDLE_AFTER_MS. */
  idle: boolean;
  /** Working past the usual range. */
  overdue: boolean;
  /** The time line under the bar. */
  timeText: string;
  /** What a screen reader hears for the bar. */
  valueText: string;
}

const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0);
const time = (v: string | null | undefined): number | null => {
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};

/** "45 s", "3 min 05 s", "12 min". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m >= 10) return `${m} min`;
  return `${m} min ${String(s % 60).padStart(2, "0")} s`;
}

/** The time curve's value after `elapsed` ms of work. */
export function timeCurve(elapsed: number): number {
  return DESIGN_TIME_CEILING * (1 - Math.exp(-Math.max(0, elapsed) / DESIGN_TIME_TAU_MS));
}

/** A design step as people read it. The engine still names the design role by its former name ("The planner is
 *  designing screens …"); people know that role as the business analyst (owner, 08.11.2026), so the role is renamed
 *  here. Lines already naming the business analyst, and every other word, pass as they are. */
export function designStepText(text: string): string {
  return text.replace(/\b(the|your) planner\b/gi, (_, det: string) => `${det} business analyst`);
}

/** The bar's next state for a job at `now`, from what it showed before (`prev`, any job). */
export function designProgress(prev: DesignProgressMemo | null, job: DesignProgressJob, now: number, fallback: string): DesignProgressView {
  const same = prev !== null && prev.jobId === job.id;
  const real = clamp(job.progress);
  const message = job.message && job.message.trim() ? designStepText(job.message.trim()) : null;
  const changed = !same || real !== prev.real || (message !== null && message !== prev.message);
  // the first sight of a job counts from its own last write, so a job silent for minutes is idle at once
  const updated = time(job.updatedAt);
  const changedAt = !same ? Math.min(now, updated ?? now) : changed ? now : prev.changedAt;
  const lastMessage = message ?? (same ? prev.message : null);

  const working = job.status === "claimed" || job.status === "running";
  const queued = job.status === "queued";
  const done = job.status === "succeeded";
  const startedAt = working ? time(job.claimedAt) ?? time(job.createdAt) : time(job.createdAt);
  const elapsedMs = startedAt === null ? null : Math.max(0, now - startedAt);

  const target = working && elapsedMs !== null ? Math.max(real, timeCurve(elapsedMs)) : real;
  const before = same ? prev.shown : 0;
  const shown = done ? 100 : Math.round(Math.min(99, Math.max(DESIGN_MIN_SHOWN, before, target)));

  const idle = working && now - changedAt >= DESIGN_IDLE_AFTER_MS;
  const overdue = working && elapsedMs !== null && elapsedMs > DESIGN_TYPICAL_MAX_MS;
  const so = elapsedMs !== null ? t("analysis.design.soFar", "{elapsed} so far", { elapsed: formatElapsed(elapsedMs) }) : null;
  const timeText = queued
    ? (elapsedMs !== null
      ? t("analysis.design.queuedFor", "Waiting for the design worker to start · requested {elapsed} ago. A design usually takes {typical}.", { elapsed: formatElapsed(elapsedMs), typical: designTypical() })
      : t("analysis.design.queued", "Waiting for the design worker to start. A design usually takes {typical}.", { typical: designTypical() }))
    : overdue
      ? t("analysis.design.overdue", "Taking longer than usual · {soFar}. It keeps going if you leave this page.", { soFar: so ?? "" })
      : [idle ? t("analysis.design.stillWorking", "Still working") : null, so, t("analysis.design.usually", "usually {typical}", { typical: designTypical() })].filter(Boolean).join(" · ");

  return {
    memo: { jobId: job.id, shown, real, message: lastMessage, changedAt },
    shown, working, queued,
    stepText: lastMessage ?? fallback,
    elapsedMs, idle, overdue, timeText,
    valueText: `${shown}%`,
  };
}
