// Monthly renewal of paid plans: run hourly by the engine worker (server/blocks/engineWorker/billingRenewals.ts) and on
// demand by billing.renewals.run. For every active subscription whose renewal day has come:
// - cancel at period end, or a downgrade to Free scheduled: the organization moves to Free (no credit);
// - the next period is paid by a code (PaidThroughAt reaches the period's end): the month's credit is granted, a
//   renewal payment (receipt) is recorded and a scheduled downgrade takes effect;
// - a card subscription on a connected gateway is renewed by the gateway's events, not here;
// - otherwise the plan is marked past due with a plain notice; its monthly credit stops;
// - a paid plan the catalogue does not list (not stored: nothing is filled in from built-in plans) is left as it is and
//   reported as waiting: it is neither ended nor renewed with figures from elsewhere.
// Idempotent per period: the credit and the payment are written under renewal:<workspace>:<period start>, so two runs
// (or two hosts) never grant twice; a run catches up at most MAX_RENEWAL_STEPS missed periods.
import { addMonth, centsToUsd, toCents, type PlanView } from "../../../src/domain/billing";
import { MAX_RENEWAL_STEPS, receiptNumber } from "../../../src/domain/payments";
import { UTILITIES_PROVIDER } from "../../../src/domain/utilitiesBilling";
import type { Gateway } from "../../workspace/ops/_shared/ports";
import { BILLING_SCHEMA, SUBSCRIPTION_FIELDS, entryRow, planOf, str, type Row } from "./shared";

export interface RenewalReport {
  checked: number;
  renewed: { workspaceId: string; planKey: string; periodStart: string }[];
  pastDue: { workspaceId: string; planKey: string; since: string }[];
  ended: { workspaceId: string; planKey: string; at: string }[];
  /** Due, but its plan (or the plan it moves to) is not in the catalogue: nothing written until the catalogue lists it. */
  waiting: { workspaceId: string; planKey: string }[];
}

export interface RenewalDeps {
  gateway: Pick<Gateway, "listAll" | "insertOnce" | "update">;
  nowIso: string;
  plans: readonly PlanView[];
  /** A card gateway is connected (billing.provider "blocks" and configured): its subscriptions renew by events. */
  providerConnected: boolean;
  /** Who the writes are stamped with (the service or the super admin who ran it). */
  by: string;
}

const day = (iso: string): string => (Number.isFinite(Date.parse(iso)) ? new Date(iso).toISOString().slice(0, 10) : iso);

export const renewalKey = (workspaceId: string, periodStart: string): string => `renewal:${workspaceId}:${periodStart}`;

export async function renewDue(d: RenewalDeps): Promise<RenewalReport> {
  const subs = await d.gateway.listAll<Row>(BILLING_SCHEMA.subscription, { filter: { Status: "active" }, fields: SUBSCRIPTION_FIELDS, maxItems: 5000 });
  // A subscription Blocks Utilities holds is renewed (and charged) by Utilities; billing.subscription.sync brings its
  // mirror and the period's credit here.
  const due = subs.filter((s) => str(s.RenewsAt) && str(s.RenewsAt) <= d.nowIso && str(s.Provider) !== UTILITIES_PROVIDER);
  const report: RenewalReport = { checked: subs.length, renewed: [], pastDue: [], ended: [], waiting: [] };
  for (const sub of due) await renewOne(d, sub, report);
  return report;
}

async function renewOne(d: RenewalDeps, sub: Row, report: RenewalReport): Promise<void> {
  const g = d.gateway;
  const workspaceId = str(sub.WorkspaceId);
  const id = str(sub.ItemId);
  let planKey = str(sub.PlanKey) || "free";
  let renewsAt = str(sub.RenewsAt);
  let next = str(sub.NextPlanKey);
  for (let step = 0; step < MAX_RENEWAL_STEPS && renewsAt && renewsAt <= d.nowIso; step++) {
    const current = planOf(d.plans, planKey);
    const targetKey = next || planKey;
    const target = planOf(d.plans, targetKey) ?? null;
    // a plan the catalogue does not list: never ended or priced from anything but the catalogue (a move to Free still ends)
    if (sub.CancelAtPeriodEnd !== true && !target && targetKey !== "free") {
      report.waiting.push({ workspaceId, planKey: targetKey });
      return;
    }
    const ends = sub.CancelAtPeriodEnd === true || !target || !target.priceUsd || target.priceUsd <= 0 || target.contactSales;
    if (ends) {
      await g.update(BILLING_SCHEMA.subscription, id, {
        PlanKey: "free", Status: "active", StartedAt: renewsAt, CurrentPeriodStart: renewsAt, RenewsAt: "", PaidThroughAt: "", CancelAtPeriodEnd: false,
        NextPlanKey: "", CouponCode: "", DiscountUntil: "", Provider: "", ProviderRef: "", PastDueSince: "",
        StatusNote: `The ${current?.name ?? planKey} plan ended on ${day(renewsAt)}. You are on Free.`, UpdatedByUserId: d.by,
      });
      report.ended.push({ workspaceId, planKey, at: renewsAt });
      return;
    }
    if (str(sub.Provider) === "blocks" && d.providerConnected) return; // the gateway's renewal event renews it
    const start = renewsAt;
    const end = addMonth(start);
    const paidThrough = str(sub.PaidThroughAt);
    const covered = Boolean(paidThrough) && Date.parse(paidThrough) >= Date.parse(end);
    if (!covered) {
      await g.update(BILLING_SCHEMA.subscription, id, {
        Status: "past_due", PastDueSince: start, UpdatedByUserId: d.by,
        StatusNote: `The ${current?.name ?? planKey} plan's payment for the month from ${day(start)} is due. Redeem a code or choose a plan to keep it.`,
      });
      report.pastDue.push({ workspaceId, planKey, since: start });
      return;
    }
    const key = renewalKey(workspaceId, start);
    const credit = toCents(target.creditUsd);
    const price = toCents(target.priceUsd ?? 0);
    const code = str(sub.CouponCode);
    await Promise.all([
      g.insertOnce<Row>(BILLING_SCHEMA.payment, {
        WorkspaceId: workspaceId, UserId: "", UserEmail: "", Kind: "renewal", PlanKey: target.key, FromPlanKey: target.key === planKey ? "" : planKey,
        Provider: "coupon", ProviderRef: code ? `coupon:${code}` : "", AmountUsd: centsToUsd(price), DiscountUsd: centsToUsd(price), PaidUsd: 0,
        CreditUsd: centsToUsd(credit), CouponCode: code, Status: "paid", ReceiptNo: receiptNumber(key, start), PeriodStart: start, PeriodEnd: end,
        PaidThroughAt: paidThrough, PaidAt: d.nowIso, ExpiresAt: "", Note: code ? `Paid by the code ${code}` : "", DetailJson: "",
        CreatedByUserId: d.by, UpdatedByUserId: d.by,
      }, `payment:${key}`),
      credit > 0
        ? g.insertOnce<Row>(BILLING_SCHEMA.creditEntry, entryRow({
          workspaceId, kind: "plan", cents: credit, planKey: target.key, note: `${target.name} plan credit, month from ${day(start)}`,
          detailJson: JSON.stringify({ renewal: start }),
        }, d.nowIso, d.by), key)
        : null,
    ]);
    await g.update(BILLING_SCHEMA.subscription, id, {
      PlanKey: target.key, NextPlanKey: "", CurrentPeriodStart: start, RenewsAt: end, StatusNote: "", PastDueSince: "", UpdatedByUserId: d.by,
    });
    report.renewed.push({ workspaceId, planKey: target.key, periodStart: start });
    planKey = target.key;
    next = "";
    renewsAt = end;
  }
}
