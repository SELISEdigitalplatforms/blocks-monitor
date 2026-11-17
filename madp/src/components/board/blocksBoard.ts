/** Pure helpers of the Blocks board: the filter, the agent role names and the lane counts. No generators of src/data/board.ts. */
import { agentInitials, agentLabel, ticketLabel } from "@/data/board";
import { isActiveEngineJob, type EngineJob } from "@/blocks/engine/types";
import type { StageId } from "@/data/types";
import type { DeliveryMilestone, DeliveryTicket, DeliveryTicketEvent } from "@/blocks/delivery/types";
import { NO_MILESTONE } from "../../domain/delivery";
import { isChatRole, STAGE_OF } from "../office/chat/persona";
import { t } from "@/i18n";

export interface BlocksBoardFilter { milestone: string; feature: string; agent: string; type: string; q: string }
export const NO_BLOCKS_FILTER: BlocksBoardFilter = { milestone: "", feature: "", agent: "", type: "", q: "" };
export const CROSS_FEATURE = "__cross";

const STAGE_IDS: readonly string[] = ["01", "02", "03", "04", "05", "06", "07", "deploy"];

/** The stage of an agent value: a stage id as it is, or a chat role key (planner, dev, …) mapped to its stage; null when unknown. */
export function agentStage(agent: string): StageId | null {
  if (STAGE_IDS.includes(agent)) return agent as StageId;
  return isChatRole(agent) ? STAGE_OF[agent] : null;
}

/** The agent's role name; anything that is not a known stage or chat role reads "MADP agents". Never a number or a count. */
export function agentName(agent: string): string {
  const stage = agentStage(agent);
  if (stage === "deploy") return t("build.agents.deploy", "Deploy");
  return stage ? agentLabel(stage) : t("build.board.madpAgents", "MADP agents");
}

export const ticketCode = (t: Pick<DeliveryTicket, "number" | "planRef">): string => ticketLabel(t);

/** A ticket's type in the current language (src/data/board.ts TYPE_LABEL stays the English). */
export const typeLabel = (type: DeliveryTicket["type"]): string =>
  type === "fix" ? t("build.board.type.fix", "Fix") : type === "task" ? t("build.board.type.task", "Task") : t("build.board.type.story", "Story");

/** The milestone filter's value for one change request ("cr:<id>"): its tickets only. */
export const changeFilterValue = (changeRequestId: string): string => `cr:${changeRequestId}`;
/** The change request a ticket belongs to: "cr:<id>:<k>" or "fx:<n>:<id>[:k]" (the same rule as the queue's). */
const changeIdOf = (planRef: string): string | null => /^(?:cr|fx:\d+):([^:]+)/.exec(planRef)?.[1] ?? null;

function inLane(t: Pick<DeliveryTicket, "milestoneId" | "planRef">, value: string): boolean {
  if (!value) return true;
  if (value === NO_MILESTONE) return t.milestoneId === null;
  if (value.startsWith("cr:")) return t.milestoneId === null && changeIdOf(t.planRef) === value.slice(3);
  return t.milestoneId === value;
}

export function filterBlocksTickets(tickets: DeliveryTicket[], filter: BlocksBoardFilter, featureName: (ref: string) => string,
  agentOf: (t: DeliveryTicket) => string = (t) => t.agent): DeliveryTicket[] {
  const q = filter.q.trim().toLowerCase();
  return tickets.filter((t) =>
    inLane(t, filter.milestone)
    && (!filter.feature || (filter.feature === CROSS_FEATURE ? t.featureRef === "" : t.featureRef === filter.feature))
    && (!filter.agent || agentName(agentOf(t)) === filter.agent)
    && (!filter.type || t.type === filter.type)
    && (!q || ticketCode(t).toLowerCase().includes(q) || t.title.toLowerCase().includes(q) || featureName(t.featureRef).toLowerCase().includes(q)));
}

export function laneCounts(tickets: Pick<DeliveryTicket, "isDone">[]): { done: number; total: number } {
  return { done: tickets.filter((t) => t.isDone).length, total: tickets.length };
}

/** Avatar initials of the agent ("D", "SO", "RG"); "MA" for MADP agents. Never a stage number. */
export function agentInitialsOf(agent: string): string {
  const stage = agentStage(agent);
  return stage ? agentInitials(stage) : "MA";
}

/** Done and total over every ticket of the board (not the filtered view), with the done share in whole percent. */
export function boardCounts(tickets: Pick<DeliveryTicket, "isDone">[]): { done: number; total: number; donePct: number } {
  const { done, total } = laneCounts(tickets);
  return { done, total, donePct: total ? Math.round((done / total) * 100) : 0 };
}

/** True while a build.run or change.build engine job is queued, claimed or running: the board is live. */
export const isBuilding = (jobs: readonly Pick<EngineJob, "kind" | "status">[]): boolean =>
  jobs.some((j) => (j.kind === "build.run" || j.kind === "change.build") && isActiveEngineJob(j));

/** "Milestone 2" for a ticket of a milestone, "Changes and fixes" for one without. */
export function milestoneTag(milestoneId: string | null, milestones: readonly Pick<DeliveryMilestone, "id" | "number">[]): string {
  if (milestoneId === null) return t("build.queue.changesAndFixes", "Changes and fixes");
  const m = milestones.find((x) => x.id === milestoneId);
  return m ? t("build.queue.milestoneN", "Milestone {number}", { number: m.number }) : t("build.queue.milestone", "Milestone");
}

type MoveLike = Pick<DeliveryTicketEvent, "kind" | "fromColumn" | "toColumn" | "authorLabel" | "at">;

/** The role a ticket names on the board (its avatar and role name). A finished ticket is credited to the role that did
 *  its work: the role that took it out of development (that move's author), else the tech lead, who builds every
 *  story, task and fix; never the release gate that only closed it, nor the business analyst who planned it. A ticket
 *  in a working column names that column's role (the engine stores it as it moves). A ticket waiting in Planned names
 *  the role that will do it: an older ticket that still names the business analyst (the planner) is the tech lead's
 *  work (src/domain/ticketRole.ts). Returns the stored agent value, or a chat role key. */
export function creditedAgent(t: Pick<DeliveryTicket, "agent" | "column" | "isDone">, events: readonly MoveLike[] = []): string {
  const planner = (a: string) => agentStage(a) === "01";
  if (t.isDone || t.column === "done") {
    const built = [...events].filter((e) => e.kind === "move" && e.fromColumn === "dev" && e.toColumn !== null && e.toColumn !== "dev" && e.toColumn !== "planned")
      .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "")).at(-1);
    const by = built?.authorLabel ?? "";
    return by && agentStage(by) && !planner(by) && agentStage(by) !== "07" ? by : "dev";
  }
  if (planner(t.agent)) return "dev";
  return t.agent;
}

/** The status line of a ticket card: "Done · <when>" (with its change request), else where it belongs: its change
 *  request ("CR-006", with "build stopped" when that build stopped: src/components/changes/changeStopped.ts) or its
 *  milestone ("Milestone 2", "Changes and fixes"). */
export function ticketStatusLine(o: { done: boolean; doneAt: string | null; milestone?: string; change?: string | null; stopped?: boolean }): string | undefined {
  if (o.done) return [o.doneAt ? t("build.board.doneAt", "Done · {at}", { at: o.doneAt }) : t("build.queue.status.done", "Done"), o.change].filter(Boolean).join(" · ");
  const where = o.change ?? o.milestone;
  return o.stopped ? (where ? t("build.board.buildStopped", "{where} · build stopped", { where }) : t("build.board.itsBuildStopped", "Its build · build stopped")) : where;
}
