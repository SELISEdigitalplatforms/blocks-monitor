// Where an agent-chat task goes (design 8), decided by the project's real stage and its records.
import type { Row } from "../../../_lib";
import { effectiveStep } from "../../../../src/domain/projects";
import { stepIndex } from "../../../../src/domain/journey";
import type { FactsRows } from "../common/loaders";
import { str } from "../common/records";

export type ChatTaskRoute = "change-request" | "ticket" | "suggestion";

/** The permission each route needs (design 8). */
export const CHAT_TASK_PERMISSION = {
  "change-request": "build.run",
  ticket: "board.edit",
  suggestion: "requirements.edit",
} as const satisfies Record<ChatTaskRoute, string>;

/** released -> change request; scope locked but not released -> a Task ticket in Planned; scope not locked -> a suggestion. */
export function routeChatTask(i: { released: boolean; scopeLocked: boolean }): ChatTaskRoute {
  if (i.released) return "change-request";
  return i.scopeLocked ? "ticket" : "suggestion";
}

const isReleased = (r: Row): boolean => str(r, "Status") === "released" || (r.ReleasedAt !== undefined && r.ReleasedAt !== null && r.ReleasedAt !== "");

/**
 * The real state: released = a Release row is released. scopeLocked = the journey is at Board or later AND a locked
 * ScopeVersion exists (Project.ScopeLockedAt is not used: it stays set after an unlock).
 */
export function chatTaskState(rows: FactsRows): { released: boolean; scopeLocked: boolean } {
  const step = effectiveStep(str(rows.project, "Stage"), str(rows.project, "ResumeTo") || undefined);
  return {
    released: rows.releases.some(isReleased),
    scopeLocked: stepIndex(step) >= stepIndex("board") && rows.lockedVersion !== null,
  };
}
