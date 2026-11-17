/** The task board's model: the columns, the ticket types and the pure helpers the Blocks board shares with the change and
 *  fix ticket stores. Pure data and derivations (no React, no state, no database). Tickets of a project are real records;
 *  nothing here generates a plan or a schedule. */
import type { StageId } from "@/data/types";
import { AGENT_NAME } from "@/lib/factoryLabels";

/* ── columns and types ────────────────────────────────────────────────────── */

export type ColumnId = "planned" | "dev" | "review" | "test" | "security" | "docs" | "gate" | "done";
export interface ColumnDef { id: ColumnId; name: string; stage: StageId | null }

/** The board's columns follow MADP's pipeline. */
export const COLUMNS: ColumnDef[] = [
  { id: "planned", name: "Planned", stage: null },
  { id: "dev", name: "In development", stage: "02" },
  { id: "review", name: "In review", stage: "03" },
  { id: "test", name: "In test", stage: "04" },
  { id: "security", name: "Security", stage: "05" },
  { id: "docs", name: "Docs", stage: "06" },
  { id: "gate", name: "Release gate", stage: "07" },
  { id: "done", name: "Done", stage: null },
];


/** The column a change request's tickets have reached at a change-build progress: the columns before Done split 0-99 evenly, Done at 100. */
export function changeRequestColumnAt(progress: number): ColumnId {
  const last = COLUMNS.length - 1;
  if (!(progress > 0)) return COLUMNS[0].id;
  if (progress >= 100) return COLUMNS[last].id;
  return COLUMNS[Math.min(last - 1, Math.floor((progress / 100) * last))].id;
}

export type TicketType = "story" | "task" | "fix";
export const TYPE_LABEL: Record<TicketType, string> = { story: "Story", task: "Task", fix: "Fix" };

/** A ticket as MADP plans it, before it belongs to a project. */
export interface TicketPlan {
  /** stable reference: 'r3.0' (slice r3, first ticket), 'x.sec' (cross-cutting) or 'cr:<request>:<i>' (change request) */
  planRef: string;
  number: number;
  title: string;
  type: TicketType;
  featureRef: string;
  agent: StageId;
  /** hours */
  estimate: number;
  acceptance: string[];
  description: string;
  storyIds: string[];
}

export interface Ticket {
  id: string;
  projectId: string;
  number: number;
  planRef: string;
  title: string;
  type: TicketType;
  featureRef: string;
  agent: StageId;
  column: ColumnId;
  estimate: number;
  acceptance: string[];
  description: string;
  order: number;
  createdAt: string;
  doneAt: string | null;
}

export type EventKind = "move" | "comment" | "artifact" | "note";

export interface TicketEvent {
  id: string;
  ticketId: string;
  kind: EventKind;
  from: ColumnId | null;
  to: ColumnId | null;
  author: string;
  text: string;
  createdAt: string;
  /** build progress (%) the agents wrote it at, or null for a person's comment */
  at: number | null;
}

export interface ChangeRequestInput {
  id: string;
  kind: "change" | "enhance" | "add";
  title: string;
  description?: string;
  featureRef?: string;
  items?: { title: string; type?: TicketType; acceptance?: string[]; estimate?: number }[];
}

/* ── small helpers ────────────────────────────────────────────────────────── */

export const ticketKey = (n: number) => `MF-${n}`;
export const fixRef = (fixNumber: number, changeRequestId: string): string => `fx:${fixNumber}:${changeRequestId}`;
export function parseFixRef(ref: string): { fixNumber: number; changeRequestId: string } | null {
  const m = /^fx:(\d+):(.+)$/.exec(ref);
  return m ? { fixNumber: Number(m[1]), changeRequestId: m[2] } : null;
}
/** "FX-1" for a fix ticket, else "MF-12". */
export const ticketLabel = (t: { number: number; planRef: string }): string => {
  const fx = parseFixRef(t.planRef);
  return fx ? `FX-${fx.fixNumber}` : ticketKey(t.number);
};
export const ticketId = (projectId: string, n: number) => `tk-${projectId}-${n}`;
export const isAutoEvent = (e: { id: string }) => e.id.startsWith("auto:");

const SLICE_RE = /^r\d+\.\d+$/;
export const isPlanRef = (ref: string) => SLICE_RE.test(ref) || ref.startsWith("x.");

export const agentLabel = (id: StageId) => (id === "deploy" ? "Deploy" : AGENT_NAME[id]);

/** Avatar initials for an agent: "BA", "TL", "SO", "RG", "D"; never the stage number. */
export const AGENT_INITIALS: Record<StageId, string> = {
  "01": "BA", "02": "TL", "03": "R", "04": "T", "05": "SO", "06": "D", "07": "RG", deploy: "D",
};
export const agentInitials = (id: StageId) => AGENT_INITIALS[id];

/** Display-time only: events stored before the stage numbers were dropped keep "02 Developer" in the database. */
export const stripStageNumber = (label: string) => label.replace(/^0[1-7] /, "");

/** "Scope v1 · locked Sun 18 Oct" */
export function lockedLabel(version: number, lockedAt: string): string {
  const day = new Date(lockedAt).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(/,/g, "");
  return `Scope v${version} · locked ${day}`;
}

/** When an event at `at` % of the build happens, counted from the lock (`hours` = the build time). */
export const eventTime = (lockedAt: string, at: number, hours: number) =>
  new Date(Date.parse(lockedAt) + (at / 100) * hours * 3600000).toISOString();

const halves = (x: number) => Math.max(0.5, Math.round(x * 2) / 2);

export function ticketsFromPlan(plans: TicketPlan[], projectId: string, createdAt: string): Ticket[] {
  return plans.map((p) => ({
    id: ticketId(projectId, p.number), projectId, number: p.number, planRef: p.planRef, title: p.title, type: p.type,
    featureRef: p.featureRef, agent: p.agent, column: "planned", estimate: p.estimate, acceptance: p.acceptance,
    description: p.description, order: p.number, createdAt, doneAt: null,
  }));
}

/** The tickets a change request adds to the board: one per item, or one for the request itself. */
export function changeRequestPlans(request: ChangeRequestInput, nextNumber: number): TicketPlan[] {
  const items: NonNullable<ChangeRequestInput["items"]> = request.items?.length ? request.items : [{ title: request.title }];
  return items.map((item, i) => ({
    planRef: `cr:${request.id}:${i}`, number: nextNumber + i, title: item.title || request.title,
    type: item.type ?? (request.kind === "change" ? "fix" : "story"), featureRef: request.featureRef ?? "",
    agent: "02" as StageId, estimate: halves(item.estimate ?? 1),
    acceptance: item.acceptance ?? [], description: request.description ?? "", storyIds: [],
  }));
}

/** What the MADP assistant hands over when a bug fix starts. */
export interface FixTicketInput {
  fixNumber: number; changeRequestId: string; title: string; summary: string; featureRef: string; estimate: number;
  acceptance: string[]; sourceRefs: string[]; analysis: string[];
}

/** The fix ticket of a bug analysis. */
export function fixTicketPlan(input: FixTicketInput, number: number): TicketPlan {
  return {
    planRef: fixRef(input.fixNumber, input.changeRequestId), number, title: input.title, type: "fix", featureRef: input.featureRef,
    agent: "02", estimate: halves(input.estimate), acceptance: input.acceptance, description: `FX-${input.fixNumber} · ${input.summary}`, storyIds: [],
  };
}
