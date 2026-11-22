// The per-project context every builder works with: the project's ids, times and the rows written so far.
import type { When } from "../core/clock";
import type { Seeder, WsScope } from "../core/writer";
import { STEPS, type MilestonePlan, type P, type ProjectPlan, type Ref, type Step } from "../model";
import { uid, type World } from "./world";

export interface Ctx {
  w: World;
  s: Seeder;
  ws: WsScope;
  plan: ProjectPlan;
  /** Project ItemId. */
  id: string;
  /** The step the project is at (paused / abandoned: the step it stopped at). */
  step: Step;
  at: { created: string; handedOver?: string; sanitized?: string; confirmed?: string; locked?: string; buildStart?: string; stopped?: string; updated: string };
  /** Local refs ("note:x", "file:x", "clar:x", "dec:x", "req:x", "feature:x", "story:x", "screen:x", "cr:<n>") → ItemId. */
  refs: Map<Ref, string>;
  milestones: { id: string; number: number; plan: MilestonePlan; status: string }[];
  scopeVersionId?: string;
  briefId?: string;
  objectiveId?: string;
}

export function reached(c: Ctx, step: Step): boolean {
  return STEPS.indexOf(c.step) >= STEPS.indexOf(step);
}

export const t = (c: Ctx, when: When): string => c.s.clock.at(when);
export const u = (c: Ctx, p: P): string => uid(c.w, p);
export const plus = (c: Ctx, iso: string, minutes: number): string => c.s.clock.plus(iso, minutes);

export function ref(c: Ctx, r: Ref): string {
  const id = c.refs.get(r);
  if (!id) throw new Error(`seed: ${c.plan.key} has no ${r}`);
  return id;
}

export interface RowMeta {
  by: P;
  at: string;
  updatedAt?: string;
  updatedBy?: P;
  requestKey?: string;
}

/** Inserts a project row (ProjectId is added for every schema but Project itself). */
export async function row(c: Ctx, schema: string, local: string, fields: Record<string, unknown>, m: RowMeta): Promise<string> {
  return c.s.insert(schema, schema === "Project" ? fields : { ProjectId: c.id, ...fields }, {
    key: `${c.plan.key}:${local}`,
    ws: c.ws,
    by: u(c, m.by),
    at: m.at,
    updatedAt: m.updatedAt,
    updatedBy: m.updatedBy ? u(c, m.updatedBy) : undefined,
    requestKey: m.requestKey,
  });
}

/** The people who follow a project: the assignee (or creator) and the lead. */
export function followers(c: Ctx): P[] {
  return [...new Set([c.plan.assignee ?? c.plan.creator, c.plan.lead])];
}
