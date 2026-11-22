/** The calibration of the real build estimates for every screen of the Build step (Studio, Timeline, Board, Queue and
 *  the ticket drawer): the Build page reads it once (src/blocks/engine/estimates.ts) and hands it down here. Without a
 *  provider (a screen shown on its own) there is no calibration, so no estimate is shown. */
import { createContext, useContext, type ReactNode } from "react";
import { useEstimateCalibration } from "@/blocks/engine/estimates";
import type { EstimateCalibration } from "@/domain/engineEstimate";

const EstimatesContext = createContext<EstimateCalibration | null>(null);

/** Hands a known calibration down (tests, a page that read it already). */
export function EstimatesValue({ value, children }: { value: EstimateCalibration | null; children?: ReactNode }) {
  return <EstimatesContext.Provider value={value}>{children}</EstimatesContext.Provider>;
}

/** Reads the calibration and hands it down. */
export function EstimatesProvider({ children }: { children: ReactNode }) {
  return <EstimatesValue value={useEstimateCalibration()}>{children}</EstimatesValue>;
}

/** The calibration, or null (loading, failed, or no provider). */
export const useEstimates = (): EstimateCalibration | null => useContext(EstimatesContext);
