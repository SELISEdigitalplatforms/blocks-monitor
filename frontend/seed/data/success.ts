// Success & performance of each seeded scope (ScopeVersion.SuccessTargets), by project key. A locked scope has every
// required value agreed or accepted (the lock rule); the open order portal scope still has one question waiting for the
// product manager and one answer of his waiting for the team.
import type { SuccessKey } from "../../src/domain/successTargets";

export interface SuccessSeed {
  value?: string;
  choice?: string;
  /** "Not sure yet — ask the product manager" */
  unsure?: boolean;
  /** the product manager's answer (and why); with `use` the team took it as the value */
  answer?: { value: string; reason: string; use?: boolean; accept?: boolean };
  suggested?: boolean;
}

export const SUCCESS_SEED: Readonly<Record<string, Partial<Record<SuccessKey, SuccessSeed>>>> = {
  "order-portal": {
    outcome: { value: "70% of repeat orders placed in the portal within six months of launch, and Excel orders by e-mail stopped" },
    users: { value: "about 350 buyers at 120 restaurant and retail customers, up to 70 at the same time before the 10:00 cut-off" },
    responseTime: { value: "under 1 second for pages and searches", choice: "fast" },
    dataVolume: { unsure: true },
    availability: {
      unsure: true,
      answer: {
        value: "every day 05:00–22:00 CET, busiest 07:00–10:00 before the order cut-off; maintenance only after 22:00",
        reason: "Restaurants order early for next-day delivery; the 10:00 cut-off makes the morning the peak.",
      },
    },
  },
  "driver-app": {
    outcome: { value: "Paper delivery notes retired within two months, and proof of delivery for 99% of stops" },
    users: { value: "about 45 drivers and 6 dispatchers, all at the same time during the morning tours" },
    responseTime: { value: "under 2 seconds; reports up to 10 seconds", choice: "normal", suggested: true },
    dataVolume: { value: "about 900 stops a day with photos and signatures, kept two years" },
    availability: {
      unsure: true,
      answer: { value: "every working day 04:30–15:00; the app keeps working offline when the network drops", reason: "Tours start before five; offline first covers the dead spots on the routes.", use: true },
    },
  },
  "spare-parts": {
    outcome: { value: "Half of all spare-part orders placed in the webshop within six months, with wrong-part returns down by a third" },
    users: { value: "about 600 service partners and industrial customers, up to 60 at the same time" },
    responseTime: { value: "under 1 second for pages and searches", choice: "fast" },
    dataVolume: { value: "about 18,000 parts with exploded views for 2,400 pump models; 12,000 orders a year" },
    availability: { value: "weekdays 06:00–20:00 CET; quarter-end is the peak" },
  },
  "service-portal": {
    outcome: { value: "Service reports invoiced the same day instead of after a week, and no paper reports typed in" },
    users: { value: "about 80 field technicians and 8 people at the service desk, up to 50 at the same time" },
    responseTime: { value: "under 2 seconds; reports up to 10 seconds", choice: "normal" },
    dataVolume: {
      unsure: true,
      answer: { value: "about 14,000 service reports a year with photos, kept ten years", reason: "Service reports are invoicing documents, so the retention follows the bookkeeping rules.", accept: true },
    },
    availability: { value: "working days 06:00–19:00 CET; reports may be sent until midnight" },
  },
};
