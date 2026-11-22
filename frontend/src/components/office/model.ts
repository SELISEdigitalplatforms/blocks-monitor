/** The office's data model: a local copy of MADP Studio's reducer types (shared/src/reducer.ts) that the
 *  3D office and the 2D floor read, plus the Factory's two extra roles (secops, docs) and their stations.
 *  The Factory feeds it from the pipeline (see fromPipeline.ts), not from a live MADP event stream. */

import type { StageId } from "@/data/types";
import type { StageStatus } from "@/data/pipeline";

export type Station =
  | "whiteboard" | "desks" | "debug" | "review" | "bench" | "security" | "docs" | "door" | "ship" | "supervisor" | "lobby";

export type Role =
  | "planner" | "dev" | "fixup" | "reviewer" | "qa" | "secops" | "docs" | "integrator" | "shipper" | "autopilot";

/** Studio's agent states plus "returning": work was sent back and the agent walks back to its station. */
export type AgentStatus = "idle" | "queued" | "working" | "waiting" | "pass" | "fail" | "done" | "returning";

export interface AgentView {
  id: string;
  role: Role;
  label: string;
  station: Station;
  status: AgentStatus;
  /** what the agent is doing right now (the bubble / hover text) */
  detail?: string;
  /** ISO time the current status began */
  since?: string;
  /** the pipeline stage this agent shows right now, and that stage's status */
  stage?: StageId;
  stageStatus?: StageStatus;
}

export type RunStatus = "running" | "waiting" | "passed" | "failed" | "stopped" | "unknown";

/** The release gate (07) and the deploy to SELISE Blocks share one station. */
export type GateState = "idle" | "checking" | "open" | "deploying" | "live" | "hold";

export interface OfficeView {
  /** office instance id (selection and look hashing are keyed by it) */
  run: string;
  status: RunStatus;
  agents: AgentView[];
  gate: GateState;
}

export const STATION_OF: Record<Role, Station> = {
  planner: "whiteboard", dev: "desks", fixup: "debug", reviewer: "review", qa: "bench", secops: "security", docs: "docs",
  integrator: "door", shipper: "ship", autopilot: "supervisor",
};

export function emptyView(run: string): OfficeView {
  return { run, status: "unknown", agents: [], gate: "idle" };
}
