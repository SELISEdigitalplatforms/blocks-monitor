// The real build estimates on the engine host (src/domain/engineEstimate.ts): the planners (board.plan, a change
// build's tickets) write each new ticket's EstimateHours from the same calibration the screens show, read through the
// engine's own gateway and kept 10 minutes per process (functions/_lib/engineEstimates.ts).
import { engineEstimates } from "../../../functions/_lib/engineEstimates";
import { ticketEstimateHours, type EstimateCalibration } from "../../../src/domain/engineEstimate";
import type { Row } from "../../../functions/_lib/gateway";
import type { JobRun } from "./run.ts";

/** The calibration, or null when it cannot be read now (the tickets are then written without an estimate). */
export async function readCalibration(run: Pick<JobRun, "deps" | "log">): Promise<EstimateCalibration | null> {
  try {
    return await engineEstimates.calibration(run.deps.gateway);
  } catch (e) {
    run.log(`The build estimates could not be read: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** The EstimateHours field of a new ticket of this type: { EstimateHours } or nothing without enough history. */
export function estimateField(cal: EstimateCalibration | null, type: string): Row {
  const hours = ticketEstimateHours(cal, type);
  return hours === undefined ? {} : { EstimateHours: hours };
}
