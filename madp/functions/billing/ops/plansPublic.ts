// billing.plans.public: the plan catalogue for the pricing page. Read-only, no arguments, no permission beyond being a
// caller of the function; the same answer is served without a sign-in at GET /api/public/plans
// (server/fnHost/publicPlans.ts, rate-limited per address), because a Logic Function always needs a signed-in caller.
// Only the stored, active plans, only the public fields (src/domain/publicPlans.ts): a plan that is not stored is not
// listed (never a built-in plan with its built-in price), and neither is a stored plan that is switched off. An empty
// catalogue answers an empty list; the platform fills it with its seed action (billing.plans.seed). Registered here
// (collected from this file).
import { OpError, defineOp, f, v } from "../../_lib";
import type { RawGateway } from "../../_lib/gateway";
import type { PlanView } from "../../../src/domain/billing";
import { publicPlansOf, type PublicPlan } from "../../../src/domain/publicPlans";
import { BILLING_SCHEMA, PLAN_FIELDS, planFromRow } from "./shared";
import { utilitiesPlans } from "./utilitiesCatalogue";
import type { UtilitiesAccess } from "../../../src/domain/blocksUtilities";
import { SETTING_SOURCE, settingSource } from "../../../src/domain/utilitiesBilling";

/** The most plan rows read (the catalogue holds a handful). */
export const MAX_PLAN_ROWS = 200;

/** The public plans from the stored rows (service reads), nothing filled in; with billing.source "blocks-utilities" the
 *  active plans Blocks Utilities sells (service identity). */
export async function readPublicPlans(raw: Pick<RawGateway, "findAll">, utilities?: UtilitiesAccess | null): Promise<PublicPlan[]> {
  // Active first, so with two rows of one key the active one is the one listed.
  const [active, inactive, setting] = await Promise.all([
    ...[true, false].map((on) => raw.findAll(BILLING_SCHEMA.plan, { where: f.eq("Active", on), fields: PLAN_FIELDS, max: MAX_PLAN_ROWS })),
    raw.findAll(BILLING_SCHEMA.platformSetting, { where: f.eq("Key", SETTING_SOURCE), fields: ["Key", "ValueJson"], max: 2 }),
  ]);
  if (settingSource(setting[0]?.ValueJson) === "blocks-utilities") {
    if (!utilities) throw new OpError("unavailable");
    return publicPlansOf((await utilitiesPlans(utilities)).filter((p) => p.active));
  }
  const stored: PlanView[] = [...active, ...inactive].map(planFromRow).filter((p) => p.key !== "");
  return publicPlansOf(stored);
}

export const billingPlansPublic = defineOp({
  op: "billing.plans.public",
  kind: "view",
  scope: "self",
  args: v.object({}),
  async handler(_ctx, _args, deps): Promise<{ plans: PublicPlan[] }> {
    if (!deps.svc) throw new OpError("internal");
    return { plans: await readPublicPlans(deps.svc, deps.utilities ?? null) };
  },
});
