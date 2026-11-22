// The mf-billing op table. Organization ops (summary, jobs.usage, redeemCoupon, requestPurchase) check membership of the workspace;
// administration checks platform.billing.manage (the report and balances also platform.usage.view). Checkout and plan
// changes (checkout.ts) need workspace.manage (the organization's owners); payments.list and access any member.
import { bindOp } from "../../workspace/ops/_shared/bind";
import type { OpHandler, OpTable } from "../../workspace/ops/_shared/ports";
import { noteBillingWrite } from "./readCache";
import {
  adjust, balancesList, couponsList, couponsSave, entriesList, jobsUsage, plansList, plansSave, plansSeed, purchasesDecide, purchasesList,
  redeemCoupon, requestPurchase, settingsGet, settingsSave, summary, usageReport,
} from "./handlers";
import {
  access, checkoutApplyCode, checkoutConfirm, checkoutStart, paymentsList, paywallGet, paywallSave, renewalsRun, subscriptionCancel,
  subscriptionChange, subscriptionResume,
} from "./checkout";

import * as utilities from "./utilitiesCheckout";
import { readSource } from "./utilitiesCatalogue";
import { fail } from "../../workspace/ops/_shared/core";

/** The op as PlatformSetting billing.source says: this platform's records, or Blocks Utilities. */
export function bySource(factory: OpHandler | null, blocks: OpHandler): OpHandler {
  return async (ctx, args, deps) => {
    if ((await readSource(deps.gateway)) === "blocks-utilities") return blocks(ctx, args, deps);
    return factory ? factory(ctx, args, deps) : fail("not_supported", "billing.utilities.notSource");
  };
}

export const BILLING_OPS: OpTable = {
  "billing.plans.list": plansList,
  "billing.plans.save": plansSave,
  "billing.plans.seed": plansSeed,
  "billing.settings.get": settingsGet,
  "billing.settings.save": settingsSave,
  "billing.summary": summary,
  "billing.jobs.usage": jobsUsage,
  "billing.redeemCoupon": redeemCoupon,
  "billing.requestPurchase": requestPurchase,
  "billing.coupons.list": couponsList,
  "billing.coupons.save": couponsSave,
  "billing.purchases.list": purchasesList,
  "billing.purchases.decide": purchasesDecide,
  "billing.adjust": adjust,
  "billing.balances.list": balancesList,
  "billing.entries.list": entriesList,
  "billing.usage.report": usageReport,
  "billing.checkout.start": bySource(checkoutStart, utilities.checkoutStart),
  "billing.checkout.applyCode": bySource(checkoutApplyCode, utilities.checkoutApplyCode),
  "billing.checkout.confirm": bySource(checkoutConfirm, utilities.checkoutConfirm),
  "billing.subscription.change": bySource(subscriptionChange, utilities.subscriptionChange),
  "billing.subscription.cancel": bySource(subscriptionCancel, utilities.subscriptionCancel),
  "billing.subscription.resume": bySource(subscriptionResume, utilities.subscriptionResume),
  "billing.subscription.sync": bySource(null, utilities.subscriptionSync),
  "billing.credits.buy": bySource(null, utilities.creditsBuy),
  "billing.payments.list": bySource(paymentsList, utilities.paymentsList),
  "billing.access": access,
  "billing.paywall.get": paywallGet,
  "billing.paywall.save": paywallSave,
  "billing.renewals.run": renewalsRun,
};

export const BILLING_VIEWS: readonly string[] = [
  "billing.plans.list", "billing.settings.get", "billing.summary", "billing.jobs.usage", "billing.coupons.list", "billing.purchases.list", "billing.balances.list",
  "billing.entries.list", "billing.usage.report", "billing.payments.list", "billing.access", "billing.paywall.get",
];

/** A command may change what the cached views answer (readCache.ts): when it ends, successful or not, the
 *  organization's summary (every summary when the args name none) and every usage report are read afresh. */
export function dropsCachedViews(handler: OpHandler): OpHandler {
  return async (ctx, args, deps) => {
    try {
      return await handler(ctx, args, deps);
    } finally {
      const ws = typeof args === "object" && args !== null ? (args as { workspaceId?: unknown }).workspaceId : undefined;
      noteBillingWrite(typeof ws === "string" && ws ? ws : null);
    }
  };
}

export const BILLING_DEFS = Object.entries(BILLING_OPS).map(([op, handler]) => {
  const view = BILLING_VIEWS.includes(op);
  return bindOp({ op, handler: view ? handler : dropsCachedViews(handler), kind: view ? "view" : "command" });
});
