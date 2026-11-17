/** A job's progress as people see it: always the value the job recorded, never ahead of it (owner rule, 12.11.2026: no
 *  invented numbers). A job reports its progress in coarse steps and can sit on one value for a while; the bar then
 *  waits with it. Between two recorded values the bar's own CSS width transition animates the move, so a new value
 *  slides in instead of jumping, and the number shown is the recorded one. 100 % only once the job is done.
 *  (Until 12.11 the bar eased ahead of the record, up to 25 points, and printed that eased number.) */

const clamp = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0);

/** A job's progress as its record says it, in whole percent: 100 once it succeeded, else its own Progress (0 without
 *  one). The number wherever two places on a page show the same job's progress (the build's Studio and its milestone
 *  row on the Timeline tab), so they never disagree. */
export function recordedProgress(job: { status: string; progress: number }): number {
  return job.status === "succeeded" ? 100 : Math.floor(clamp(job.progress));
}

/** What the bar and its number show: 100 only when the job is done, otherwise the recorded value in whole percent,
 *  at most 99 (a record of 100 on a job not yet done waits at 99). */
export function shownProgress(real: number | null | undefined, { done }: { done: boolean }): number {
  if (done) return 100;
  return Math.min(99, Math.floor(clamp(real ?? 0)));
}

/** The progress to show for a job's recorded value (whole percent). `done` when it succeeded (shows 100). `active` and
 *  `resetKey` are kept for the callers' sake: the value never moves on its own, so neither changes what is shown. */
export function useEasedProgress(real: number | null | undefined, { done = false }: {
  active?: boolean;
  done?: boolean;
  resetKey?: string;
}): number {
  return shownProgress(real, { done });
}
