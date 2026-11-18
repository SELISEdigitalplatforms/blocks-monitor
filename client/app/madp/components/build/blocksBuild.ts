/** Pure rules for the Blocks build page: ticket counts from real Ticket rows and the Start gate. */
import { TICKET_COLUMNS, nextMilestoneToBuild, type TicketColumn } from "@/madp/domain/delivery";
import { isActiveEngineJob, type EngineJob } from "@/madp/blocks/engine/types";
import type { DeliveryMilestone, DeliveryTicket } from "@/madp/blocks/delivery/types";
import { t } from "@/madp/i18n";

/** The reason nextMilestoneToBuild gives, in the current language (by its messageKey; its English otherwise). */
function gateReason(next: { milestone: { number: number } | null; messageKey: string | null; reason: string | null }): string | null {
  switch (next.messageKey) {
    case "delivery.build.noMilestones": return t("build.gate.noMilestones", "Lock the scope and milestones first.");
    case "delivery.build.allBuilt": return t("build.gate.allBuilt", "Every milestone is built.");
    case "delivery.build.noTickets": return next.milestone ? t("build.gate.noTickets", "The board for milestone {number} isn't planned yet.", { number: next.milestone.number }) : next.reason;
    default: return next.reason;
  }
}

export function columnCounts(tickets: readonly DeliveryTicket[], milestoneId: string): Record<TicketColumn, number> {
  const out = Object.fromEntries(TICKET_COLUMNS.map((c) => [c, 0])) as Record<TicketColumn, number>;
  for (const t of tickets) if (t.milestoneId === milestoneId && t.column in out) out[t.column as TicketColumn] += 1;
  return out;
}

export interface BuildGate { milestone: DeliveryMilestone | null; enabled: boolean; reason: string | null }

const BUILD_KINDS = new Set(["build.run", "change.build"]);

/** `ticketCounts` = tickets per milestone id. The server decides again; this only gates the button. */
export function buildGate(input: {
  milestones: readonly DeliveryMilestone[];
  ticketCounts: Record<string, number>;
  jobs: readonly EngineJob[];
  canRun: boolean;
}): BuildGate {
  const next = nextMilestoneToBuild(input.milestones, input.ticketCounts);
  const milestone = (next.milestone ?? null) as DeliveryMilestone | null;
  if (!input.canRun) return { milestone, enabled: false, reason: t("build.gate.roleCannot", "Your role can't start builds; the project team starts them.") };
  if (input.jobs.some((j) => BUILD_KINDS.has(j.kind) && isActiveEngineJob(j))) {
    return { milestone, enabled: false, reason: t("build.gate.running", "A build is already running.") };
  }
  if (next.reason || !milestone) return { milestone, enabled: false, reason: gateReason(next) ?? t("build.gate.noMilestone", "There is no milestone to build.") };
  return { milestone, enabled: true, reason: null };
}
