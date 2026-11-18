// billing.balances.list as the platform pages cache it (Credits & coupons and the paywall card share the key
// ["billing", "balances"] and this shape): every organization's balance, and how many engine jobs run on the platform,
// so the pages that show figures read faster while work runs (src/blocks/billing/usage.ts).
import { callFunction } from "@/madp/blocks/fn";
import type { BalanceRow } from "@/madp/domain/billing";

export const BALANCES_KEY = ["billing", "balances"] as const;

export interface BalancesData {
  rows: BalanceRow[];
  runningJobs: number;
}

/** Whether an engine job runs, by the latest balances answer. */
export const balancesBusy = (d: BalancesData | undefined): boolean => (d?.runningJobs ?? 0) > 0;

export async function fetchBalances(): Promise<BalancesData> {
  const d = (await callFunction<{ rows?: BalanceRow[]; runningJobs?: number }>("billing", "billing.balances.list", {})).data;
  return { rows: Array.isArray(d?.rows) ? d.rows : [], runningJobs: typeof d?.runningJobs === "number" ? d.runningJobs : 0 };
}
