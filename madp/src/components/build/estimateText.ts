/** The real build estimates in words (src/domain/engineEstimate.ts): "about 19 min (16–23 min)" for a build or a
 *  milestone, "≈ 45 s" for a ticket, "about USD 6" for the cost, and the explanation behind each one for its tooltip.
 *  The time shown is BUILD TIME: how long the build runs on MADP from start to finish (its agents work side by side, so
 *  it is not the sum of their own times), the same measure as the "Build time" the page shows for a running build.
 *  Every text in English and de-CH; nothing is shown without enough measured builds. */
import { t } from "@/i18n";
import { formatMoney, formatNumber } from "@/i18n/format";
import { RANGE_QUANTILES, type BuildEstimate, type EstimateCalibration, type EstimateRange, type TicketEstimate } from "@/domain/engineEstimate";

/** Under a minute in seconds, to 5 s (at least 5 s); 60 s reads as a minute. */
const secondsOf = (minutes: number): number => Math.max(5, Math.round((minutes * 60) / 5) * 5);

/** 0.76 → "45 s", 19.2 → "19 min", 65 → "1 h 5 min", 120 → "2 h" (a ticket adds well under a minute, so seconds keep
 *  a build's tickets adding up to what its tooltip says). */
export function minutesText(minutes: number): string {
  if (!(minutes > 0)) return t("build.estimate.seconds", "{n} s", { n: 0 });
  if (minutes < 1 && secondsOf(minutes) < 60) return t("build.estimate.seconds", "{n} s", { n: secondsOf(minutes) });
  const total = Math.max(1, Math.round(minutes));
  if (total < 60) return t("build.estimate.minutes", "{n} min", { n: total });
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m ? t("build.estimate.hoursMinutes", "{h} h {m} min", { h, m }) : t("build.estimate.hours", "{h} h", { h });
}

/** The range in words, or null when it reads as the value itself ("16–23 min", "40–55 s", "50 min – 1 h 10 min"). */
export function minuteRangeText(r: EstimateRange): string | null {
  const low = minutesText(r.low);
  const high = minutesText(r.high);
  if (low === high) return null;
  const lowMin = Math.round(r.low);
  const highMin = Math.round(r.high);
  if (r.low >= 1 && lowMin >= 1 && highMin < 60) return t("build.estimate.minuteRange", "{low}–{high} min", { low: lowMin, high: highMin });
  if (r.high < 1 && secondsOf(r.high) < 60) return t("build.estimate.secondRange", "{low}–{high} s", { low: secondsOf(r.low), high: secondsOf(r.high) });
  return `${low} – ${high}`;
}

/** "USD 6" from one dollar on, "USD 0.55" below it. */
export function usdText(amount: number): string {
  return formatMoney(amount, "USD", { decimals: amount >= 1 ? 0 : 2 });
}

/** "USD 5–7", or null when it rounds to one amount. */
export function usdRangeText(r: EstimateRange): string | null {
  const decimals = r.high >= 1 ? 0 : 2;
  const low = formatNumber(r.low, { decimals });
  const high = formatNumber(r.high, { decimals });
  return low === high ? null : `${formatMoney(r.low, "USD", { decimals })}–${high}`;
}

/** "about 19 min (16–23 min)" */
export function estimateTimeText(r: EstimateRange): string {
  const value = minutesText(r.value);
  const range = minuteRangeText(r);
  return range ? t("build.estimate.aboutRange", "about {value} ({range})", { value, range }) : t("build.estimate.about", "about {value}", { value });
}

/** "about USD 6" */
export const estimateCostText = (r: EstimateRange): string => t("build.estimate.about", "about {value}", { value: usdText(r.value) });

const ticketsWord = (n: number): string => (n === 1 ? t("build.estimate.oneTicket", "its ticket") : t("build.estimate.tickets", "its {count} tickets", { count: n }));

/** What a build's estimate stands on, for its tooltip. */
export function buildEstimateTitle(e: BuildEstimate): string {
  const parts = [
    t("build.estimate.title.basis", "Measured from {builds} builds MADP finished: about {base} per build to plan, check and deploy, and about {ticketTime} for {tickets}.", {
      builds: e.builds, base: minutesText(e.baseMinutes), ticketTime: minutesText(e.ticketMinutes), tickets: ticketsWord(e.tickets),
    }),
    t("build.estimate.title.buildTime", "Build time is how long a build runs from start to finish. Its agents work side by side, so it is not the sum of their own times."),
    t("build.estimate.title.range", "{n} in 10 measured builds ended within the range.", { n: Math.round((RANGE_QUANTILES[1] - RANGE_QUANTILES[0]) * 10) }),
  ];
  if (e.costUsd) {
    const range = usdRangeText(e.costUsd);
    parts.push(range
      ? t("build.estimate.title.costRange", "Cost: about {cost} ({range}), measured from the same builds.", { cost: usdText(e.costUsd.value), range })
      : t("build.estimate.title.cost", "Cost: about {cost}, measured from the same builds.", { cost: usdText(e.costUsd.value) }));
  }
  if (e.pooled) parts.push(t("build.estimate.title.pooled", "Too few builds of this kind are measured yet, so every kind of build counts."));
  if (e.beyond) parts.push(t("build.estimate.title.beyond", "No measured build had this many tickets, so the estimate carries the measured trend further."));
  return parts.join(" ");
}

/** "≈ 45 s" on a ticket card. */
export const ticketEstimateText = (e: TicketEstimate): string => t("build.estimate.ticket", "≈ {value}", { value: minutesText(e.minutes.value) });

/** "≈ 45 s build time" in the ticket's drawer. */
export const ticketEstimateChip = (e: TicketEstimate): string => t("build.estimate.ticketChip", "≈ {value} build time", { value: minutesText(e.minutes.value) });

/** What a ticket's estimate stands on, for its tooltip. */
export function ticketEstimateTitle(e: TicketEstimate): string {
  const parts = [
    e.costUsd
      ? t("build.estimate.ticketTitleCost", "This ticket adds about {time} to its build's time and about {cost} to its cost.", { time: minutesText(e.minutes.value), cost: usdText(e.costUsd.value) })
      : t("build.estimate.ticketTitle", "This ticket adds about {time} to its build's time.", { time: minutesText(e.minutes.value) }),
    t("build.estimate.ticketBase", "Every build also takes about {base} to plan, check and deploy.", { base: minutesText(e.baseMinutes) }),
    t("build.estimate.ticketBasis", "Measured from {builds} builds MADP finished.", { builds: e.builds }),
  ];
  if (e.pooled) parts.push(t("build.estimate.title.pooled", "Too few builds of this kind are measured yet, so every kind of build counts."));
  return parts.join(" ");
}

/** Too few measured builds for any estimate: the plain line and its tooltip (with the sample size); null when the
 *  calibration is not known (loading, failed) or has estimates. */
export function noEstimateYet(cal: EstimateCalibration | null): { text: string; title: string } | null {
  if (!cal || cal.all.time) return null;
  return {
    text: t("build.estimate.none", "No estimate yet"),
    title: t("build.estimate.noneTitle", "Estimates start once MADP has finished {min} measured builds; {count} so far.", { min: cal.minBuilds, count: cal.builds }),
  };
}
