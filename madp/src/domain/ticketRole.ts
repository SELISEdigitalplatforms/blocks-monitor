// Who a ticket names while it waits in Planned (Ticket.AgentRole): the role that does its work. Once a build starts,
// the ticket names the role of the column it is in (server/local/engine/kinds/delivery.ts OWNER), so this only decides
// the ticket's role before anyone has started on it. The role ids stay as they were; since 08.11.2026 the "planner"
// reads as the business analyst (src/lib/factoryLabels.ts), so a ticket the build team does never names it: building
// it starts with the tech lead (the role that takes a ticket out of Planned), a security review is SecOps' work.
import type { ChatRole } from "./agentChat";

/** The kinds of cross-cutting task the board plan writes (the "role" Claude gives each task, and the built-in ones). */
export const TASK_KINDS = ["pipeline", "access", "interface", "offline", "review", "backend", "other"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** The role a new ticket in Planned names: SecOps for a security review task, the tech lead ("dev") for every other
 *  story, task or fix, which the build team builds. */
export function plannedRoleOf(ticket: { type: string; kind?: TaskKind }): ChatRole {
  return ticket.type === "task" && ticket.kind === "review" ? "secops" : "dev";
}
