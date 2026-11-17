// engine.estimates: the calibration of the real build estimates (src/domain/engineEstimate.ts): what a build and each
// of its tickets take on the MADP engine and what that costs, measured from the newest finished builds. A view for any
// signed-in caller: the answer holds only figures over every build of the platform (counts, minutes, USD, the finish
// dates of the oldest and newest build), no ids and nothing of one project or workspace; it is read with the service
// gateway and kept 10 minutes (functions/_lib/engineEstimates.ts).
import { OpError, defineOp, v } from "../../../_lib";
import { engineEstimates } from "../../../_lib/engineEstimates";
import type { EstimateCalibration } from "../../../../src/domain/engineEstimate";

export const engineEstimatesOp = defineOp({
  op: "engine.estimates",
  kind: "view",
  scope: "self",
  args: v.object({}),
  async handler(_ctx, _args, deps): Promise<EstimateCalibration> {
    if (!deps.svc) throw new OpError("internal");
    try {
      return await engineEstimates.calibration(deps.svc);
    } catch (e) {
      if (e instanceof OpError) throw e;
      throw new OpError("unavailable");
    }
  },
});
