/**
 * How much of a `windowMs` window ending at `now` the monitor actually existed for. A window that
 * starts before the monitor was created only counts from its creation; otherwise a monitor created
 * five minutes ago and down for three of them would read 95% over "the last hour". Falls back to
 * the whole window when the creation date is missing or invalid. Never less than 1ms, so it can
 * be divided by.
 */
export const observedWindowMs = (
  windowMs: number,
  now: number,
  createdAt?: string | null
): number => {
  const created = createdAt ? new Date(createdAt).getTime() : Number.NaN;
  const sinceCreated = Number.isNaN(created) ? windowMs : now - created;
  return Math.max(1, Math.min(windowMs, sinceCreated));
};

/**
 * Uptime as a percentage with two decimals, rounded down so that any downtime at all reads below
 * 100.00% -- rounding to nearest showed "100.00%" next to "1 incidents".
 */
export const formatUptime = (observedMs: number, downtimeMs: number): string => {
  const percent = ((observedMs - downtimeMs) / observedMs) * 100;
  const clamped = Math.min(100, Math.max(0, percent));
  // The epsilon absorbs float error (e.g. 28.999999999999996 for 29) before flooring.
  return (Math.floor(clamped * 100 + 1e-9) / 100).toFixed(2);
};
