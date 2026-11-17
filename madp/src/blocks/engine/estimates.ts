// The calibration of the real build estimates (src/domain/engineEstimate.ts), read once from the project function's
// view engine.estimates and kept 10 minutes, as the server keeps it (functions/_lib/engineEstimates.ts). A function
// that is not there yet, fails or answers something else reads as "no calibration": the screens then show no estimate,
// never a made-up one.
import { useQuery } from "@tanstack/react-query";
import { callFunction, type FunctionResult } from "@/blocks/fn";
import type { FunctionName } from "@/blocks/functions";
import { parseCalibration, type EstimateCalibration } from "@/domain/engineEstimate";

export const ESTIMATES_STALE_MS = 10 * 60_000;

export const estimateKeys = {
  calibration: () => ["platform", "engine", "estimates"] as const,
};

type Call = <T>(name: FunctionName, op: string, args?: Record<string, unknown>) => Promise<FunctionResult<T>>;

/** The calibration, or null when the answer is not one. */
export async function fetchEstimateCalibration(call: Call = callFunction): Promise<EstimateCalibration | null> {
  const r = await call<unknown>("project", "engine.estimates", {});
  return parseCalibration(r.data);
}

/** The calibration (null while it loads, when it failed or when the server has none). */
export function useEstimateCalibration(enabled = true): EstimateCalibration | null {
  const q = useQuery({
    queryKey: estimateKeys.calibration(),
    queryFn: () => fetchEstimateCalibration(),
    enabled,
    staleTime: ESTIMATES_STALE_MS,
    gcTime: 3 * ESTIMATES_STALE_MS,
    retry: 1,
    refetchOnWindowFocus: false,
  });
  return q.data ?? null;
}
