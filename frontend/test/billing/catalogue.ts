// The plan catalogue as the platform stores it after its seed action (billing.plans.seed): Free, Classic, Speed and
// Enterprise as Plan rows. Nothing fills in a plan that is not stored, so a test that needs plans stores them first.
import { seedRow, type MemoryGateway } from "../../functions/_lib/testing";
import { planToRow } from "../../functions/billing/ops/shared";
import { DEFAULT_PLANS, type PlanView } from "../../src/domain/billing";

/** The four seeded plans (fresh copies). */
export const CATALOGUE: readonly PlanView[] = DEFAULT_PLANS.map((p) => ({ ...p, features: [...p.features] }));

/** Stores the seeded catalogue (or the plans given) as Plan rows. */
export function seedCatalogue(gateway: MemoryGateway, plans: readonly PlanView[] = CATALOGUE): void {
  for (const p of plans) seedRow(gateway, "Plan", planToRow(p));
}
