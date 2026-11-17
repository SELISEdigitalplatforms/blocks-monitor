// Op map of the requirements area. OPS holds the defineOp-made ops that functions/_lib's build discovers.
import type { LaneOp } from "./ports";
import { toDefinedOps } from "./bind";
import { saveRequirement, deleteRequirement, reorderRequirements } from "./requirement";
import { saveObjective } from "./objective";
import { saveAcceptance } from "./acceptance";
import { restoreItemVersion } from "./itemVersion";
import { decideSuggestionOp } from "./suggestion";
import { confirmRequirements } from "./confirm";
import { requestReview } from "./review";

const all: LaneOp[] = [
  saveRequirement,
  deleteRequirement,
  reorderRequirements,
  saveObjective,
  saveAcceptance,
  restoreItemVersion,
  decideSuggestionOp,
  confirmRequirements,
  requestReview,
];

/** The lane ops by name (kept for the unit tests). */
export const LANE_OPS: Record<string, LaneOp> = Object.fromEntries(all.map((o) => [o.op, o]));
export const REQUIREMENT_OPS = toDefinedOps(LANE_OPS);
