/** Product sanitization ops of mf-project (lane L5). The coordinator registers SANITIZATION_OPS. */
import { BRIEF_ANSWER_OPS } from "./briefAnswer";
import { CLARIFICATION_OPS } from "./clarification";
import { COMPLETE_OPS } from "./complete";
import { DECISION_OPS } from "./decision";
import { DISCUSSION_OPS } from "./discussion";
import { INITIAL_REQUIREMENTS_OPS } from "./initialRequirements";
import { SANITIZATION_JOB_OPS } from "./jobs";
import { TECH_DECISION_OPS } from "./techDecision";
import type { OpTable } from "./ports";

export const SANITIZATION_OPS: OpTable = Object.freeze({
  ...CLARIFICATION_OPS,
  ...BRIEF_ANSWER_OPS,
  ...DECISION_OPS,
  ...TECH_DECISION_OPS,
  ...DISCUSSION_OPS,
  ...INITIAL_REQUIREMENTS_OPS,
  ...COMPLETE_OPS,
  ...SANITIZATION_JOB_OPS,
});

export const SANITIZATION_OP_NAMES: readonly string[] = Object.freeze(Object.keys(SANITIZATION_OPS));

export { bindSanitizationOps } from "./bind";
export type {
  ErrorCode,
  Filter,
  Gateway,
  Handler,
  JobKind,
  JobsPort,
  ListOptions,
  OpContext,
  OpError,
  OpResult,
  OpTable,
  Row,
} from "./ports";
