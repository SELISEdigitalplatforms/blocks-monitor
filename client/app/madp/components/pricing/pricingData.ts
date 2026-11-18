// The plans of the pricing page: GET /api/public/plans (no sign-in, the same answer as billing.plans.public). Only the
// catalogue is ever shown. When it cannot be read (the route is not there, the server is busy, a reply that is not plans)
// the page says the plans couldn't be loaded and offers to try again; it has no plans or prices of its own.
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/madp/blocks/session";
import { useCurrentWorkspace } from "@/madp/state/workspaces";
import { FRESHNESS_MS } from "@/madp/blocks/data/freshness";
import { parsePublicPlans, type PublicPlan } from "@/madp/domain/publicPlans";
import { useBillingSummary } from "@/madp/components/billing/billingData";

export const PUBLIC_PLANS_URL = "/api/public/plans";
export const publicPlansKey = ["public", "billing", "plans"] as const;

/** live: the catalogue's answer (an empty list when it lists no plan); unavailable: it could not be read. */
export type PlansSource = "live" | "unavailable";
export interface PricingPlans { plans: PublicPlan[]; source: PlansSource }

const unavailable = (): PricingPlans => ({ plans: [], source: "unavailable" });

/** Never throws: the catalogue's plans, or none with source "unavailable". */
export async function fetchPublicPlans(fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<PricingPlans> {
  try {
    const res = await fetcher(PUBLIC_PLANS_URL, {
      method: "GET", credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer",
      headers: { accept: "application/json" }, signal,
    });
    if (res.status !== 200) return unavailable();
    const plans = parsePublicPlans(await res.json());
    return plans ? { plans, source: "live" } : unavailable();
  } catch {
    return unavailable();
  }
}

/** How long an answer is shown without a new read: the catalogue for the calm tier's half pace (5 min, docs/FRESHNESS.md),
 *  a failed read not at all (the page opened again, or the window back in focus, tries again). */
export function plansStaleTime(data: PricingPlans | undefined): number {
  return data?.source === "live" ? FRESHNESS_MS.calm.busy : 0;
}

export interface PublicPlansView extends PricingPlans {
  /** false only while the first read runs (the cards then hold their place). */
  ready: boolean;
  /** A read is running again after an answer (Try again pressed). */
  retrying: boolean;
  /** Reads the catalogue again. */
  retry: () => void;
}

/** The plans to show: the catalogue, or nothing (unavailable) while it cannot be read; never plans of the page's own. */
export function usePublicPlans(): PublicPlansView {
  const q = useQuery({
    queryKey: publicPlansKey,
    queryFn: ({ signal }) => fetchPublicPlans(fetch, signal),
    staleTime: (query) => plansStaleTime(query.state.data),
    retry: false,
  });
  const retry = () => void q.refetch();
  if (!q.data) return { plans: [], source: "unavailable", ready: false, retrying: false, retry };
  return { ...q.data, ready: true, retrying: q.isFetching, retry };
}

/** Who is looking: signed in or not, and (signed in) the open organization's plan when the billing summary has it. */
export function usePricingViewer(): { signedIn: boolean; currentKey: string | null } {
  const signedIn = useSession((s) => s.status === "signed-in");
  const ws = useCurrentWorkspace();
  const summary = useBillingSummary(signedIn ? ws?.id : null);
  return { signedIn, currentKey: signedIn ? summary.data?.plan?.key ?? null : null };
}
