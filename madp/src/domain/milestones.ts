// Pure milestone-plan rules (no I/O, no mutation). Shared by the Blocks scope page and the
// scope.* / milestones.* server ops, so the browser and the function validate identically.

export interface PlanMilestone {
  id?: string;
  clientKey?: string;
  number?: number;
  name: string;
  goal: string;
  /** 'feature:<Feature.Key>' strings, in order. */
  featureRefs: string[];
}

/** Order = array position. */
export type MilestonePlan = readonly PlanMilestone[];

/** S1 allows Name up to 120; the stricter 60 wins. */
export const MILESTONE_LIMITS = { min: 1, max: 20, name: 60, goal: 500 } as const;

export const milestoneKey = (m: PlanMilestone): string => m.id ?? m.clientKey ?? "";

const indexOfKey = (plan: MilestonePlan, key: string): number =>
  plan.findIndex((m) => milestoneKey(m) === key);

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

const withoutRef = (plan: MilestonePlan, ref: string): PlanMilestone[] =>
  plan.map((m) => ({ ...m, featureRefs: m.featureRefs.filter((r) => r !== ref) }));

export function addMilestone(
  plan: MilestonePlan,
  input: { clientKey: string; name: string; goal?: string },
): PlanMilestone[] {
  return [...plan.map((m) => ({ ...m, featureRefs: [...m.featureRefs] })), {
    clientKey: input.clientKey,
    name: input.name,
    goal: input.goal ?? "",
    featureRefs: [],
  }];
}

export function removeMilestone(
  plan: MilestonePlan,
  key: string,
): { ok: true; plan: PlanMilestone[] } | { ok: false; reason: "lastMilestone" } {
  if (plan.length <= MILESTONE_LIMITS.min) return { ok: false, reason: "lastMilestone" };
  return {
    ok: true,
    plan: plan.filter((m) => milestoneKey(m) !== key).map((m) => ({ ...m, featureRefs: [...m.featureRefs] })),
  };
}

const patch = (plan: MilestonePlan, key: string, p: Partial<PlanMilestone>): PlanMilestone[] =>
  plan.map((m) => ({ ...m, featureRefs: [...m.featureRefs], ...(milestoneKey(m) === key ? p : {}) }));

export const renameMilestone = (plan: MilestonePlan, key: string, name: string): PlanMilestone[] =>
  patch(plan, key, { name });

export const setGoal = (plan: MilestonePlan, key: string, goal: string): PlanMilestone[] =>
  patch(plan, key, { goal });

export function reorderMilestone(plan: MilestonePlan, from: number, to: number): PlanMilestone[] {
  const copy = plan.map((m) => ({ ...m, featureRefs: [...m.featureRefs] }));
  if (copy.length === 0) return copy;
  const f = clamp(from, 0, copy.length - 1);
  const t = clamp(to, 0, copy.length - 1);
  const [item] = copy.splice(f, 1);
  copy.splice(t, 0, item);
  return copy;
}

export function moveFeature(plan: MilestonePlan, featureRef: string, toKey: string, toIndex: number): PlanMilestone[] {
  if (indexOfKey(plan, toKey) < 0) return plan.map((m) => ({ ...m, featureRefs: [...m.featureRefs] }));
  const stripped = withoutRef(plan, featureRef);
  return stripped.map((m) => {
    if (milestoneKey(m) !== toKey) return m;
    const refs = [...m.featureRefs];
    refs.splice(clamp(toIndex, 0, refs.length), 0, featureRef);
    return { ...m, featureRefs: refs };
  });
}

export const unassignFeature = (plan: MilestonePlan, featureRef: string): PlanMilestone[] =>
  withoutRef(plan, featureRef);

export function unassignedFeatures(plan: MilestonePlan, includedRefs: readonly string[]): string[] {
  const used = new Set(plan.flatMap((m) => m.featureRefs));
  return includedRefs.filter((r) => !used.has(r));
}

export function assignNumbers(plan: MilestonePlan): PlanMilestone[] {
  let next = Math.max(0, ...plan.map((m) => m.number ?? 0)) + 1;
  return plan.map((m) => ({
    ...m,
    featureRefs: [...m.featureRefs],
    number: m.number !== undefined ? m.number : next++,
  }));
}

export type MilestoneBlocker =
  | { kind: "noMilestone" }
  | { kind: "unassignedFeatures"; featureRefs: string[] }
  | { kind: "emptyMilestones"; milestoneKeys: string[] };

export function milestoneLockBlockers(plan: MilestonePlan, includedRefs: readonly string[]): MilestoneBlocker[] {
  const out: MilestoneBlocker[] = [];
  if (plan.length === 0) out.push({ kind: "noMilestone" });
  const un = unassignedFeatures(plan, includedRefs);
  if (un.length > 0) out.push({ kind: "unassignedFeatures", featureRefs: un });
  const empty = plan.filter((m) => m.featureRefs.length === 0).map(milestoneKey);
  if (empty.length > 0) out.push({ kind: "emptyMilestones", milestoneKeys: empty });
  return out;
}

export interface MilestoneIssue {
  path: string;
  rule:
    | "tooFew"
    | "tooMany"
    | "nameRequired"
    | "nameTooLong"
    | "nameDuplicate"
    | "goalTooLong"
    | "unknownFeature"
    | "excludedFeature"
    | "duplicateFeature"
    | "unassignedFeature"
    | "emptyMilestone";
  params?: Record<string, string | number>;
}

export function validateMilestonePlan(
  plan: MilestonePlan,
  includedRefs: readonly string[],
  mode: "save" | "lock",
  excludedRefs: readonly string[] = [],
): MilestoneIssue[] {
  const issues: MilestoneIssue[] = [];
  if (plan.length < MILESTONE_LIMITS.min) issues.push({ path: "plan", rule: "tooFew", params: { min: MILESTONE_LIMITS.min } });
  if (plan.length > MILESTONE_LIMITS.max) issues.push({ path: "plan", rule: "tooMany", params: { max: MILESTONE_LIMITS.max } });
  const included = new Set(includedRefs);
  const excluded = new Set(excludedRefs);
  const names = new Set<string>();
  const seen = new Set<string>();
  plan.forEach((m, i) => {
    const name = m.name.trim();
    if (name.length === 0) issues.push({ path: `plan.${i}.name`, rule: "nameRequired" });
    else {
      if (name.length > MILESTONE_LIMITS.name) {
        issues.push({ path: `plan.${i}.name`, rule: "nameTooLong", params: { max: MILESTONE_LIMITS.name } });
      }
      const k = name.toLowerCase();
      if (names.has(k)) issues.push({ path: `plan.${i}.name`, rule: "nameDuplicate" });
      names.add(k);
    }
    if (m.goal.length > MILESTONE_LIMITS.goal) {
      issues.push({ path: `plan.${i}.goal`, rule: "goalTooLong", params: { max: MILESTONE_LIMITS.goal } });
    }
    m.featureRefs.forEach((ref, j) => {
      const path = `plan.${i}.featureRefs.${j}`;
      if (excluded.has(ref)) issues.push({ path, rule: "excludedFeature", params: { featureRef: ref } });
      else if (!included.has(ref)) issues.push({ path, rule: "unknownFeature", params: { featureRef: ref } });
      if (seen.has(ref)) issues.push({ path, rule: "duplicateFeature", params: { featureRef: ref } });
      seen.add(ref);
    });
  });
  if (mode === "lock") {
    for (const ref of unassignedFeatures(plan, includedRefs)) {
      issues.push({ path: "plan", rule: "unassignedFeature", params: { featureRef: ref } });
    }
    plan.forEach((m, i) => {
      if (m.featureRefs.length === 0) {
        issues.push({ path: "plan", rule: "emptyMilestone", params: { index: i, milestoneKey: milestoneKey(m) } });
      }
    });
  }
  return issues;
}

// ---------------------------------------------------------------- keyboard drag model

export type DragItem = { type: "feature"; ref: string } | { type: "milestone"; key: string };

export interface DragState {
  plan: MilestonePlan;
  focus: DragItem | null;
  picked: null | { item: DragItem; before: MilestonePlan; beforeTray?: readonly string[] };
  /** Refs shown in "Not in a milestone", in order. The plan alone cannot say; defaults to none. */
  tray?: readonly string[];
}

interface Where {
  col: number; // -1 = tray, else milestone index
  index: number;
  size: number;
}

const locate = (plan: MilestonePlan, tray: readonly string[], ref: string): Where | null => {
  const mi = plan.findIndex((m) => m.featureRefs.includes(ref));
  if (mi >= 0) return { col: mi, index: plan[mi].featureRefs.indexOf(ref), size: plan[mi].featureRefs.length };
  const ti = tray.indexOf(ref);
  return ti >= 0 ? { col: -1, index: ti, size: tray.length } : null;
};

export function keyboardMove(
  state: DragState,
  key: string,
  names: { feature(ref: string): string },
): { state: DragState; announcement: string | null; handled: boolean } {
  const unhandled = { state, announcement: null, handled: false };
  const tray = state.tray ?? [];
  const numberOf = (plan: MilestonePlan, i: number) => assignNumbers(plan)[i]?.number ?? i + 1;
  const featureSpot = (plan: MilestonePlan, tr: readonly string[], ref: string): string => {
    const w = locate(plan, tr, ref);
    if (!w) return "";
    return w.col < 0
      ? `Not in a milestone, position ${w.index + 1} of ${w.size}.`
      : `Milestone ${numberOf(plan, w.col)}, position ${w.index + 1} of ${w.size}.`;
  };
  const milestoneSpot = (plan: MilestonePlan, k: string): { n: number; pos: string } => {
    const i = indexOfKey(plan, k);
    return { n: numberOf(plan, i), pos: `${i + 1} of ${plan.length}.` };
  };

  if (!state.picked) {
    if (key !== " " || !state.focus) return unhandled;
    const item = state.focus;
    const next: DragState = { ...state, picked: { item, before: state.plan, beforeTray: state.tray } };
    if (item.type === "feature") {
      if (!locate(state.plan, tray, item.ref)) return unhandled;
      return { state: next, announcement: `${names.feature(item.ref)} picked up. ${featureSpot(state.plan, tray, item.ref)}`, handled: true };
    }
    if (indexOfKey(state.plan, item.key) < 0) return unhandled;
    const s = milestoneSpot(state.plan, item.key);
    return { state: next, announcement: `Milestone ${s.n} picked up. Position ${s.pos}`, handled: true };
  }

  const { item, before, beforeTray } = state.picked;
  const done = (): DragState => ({ ...state, picked: null, focus: item });

  if (key === "Escape") {
    const restored: DragState = { ...state, plan: before, picked: null, focus: item };
    if (beforeTray !== undefined) restored.tray = beforeTray;
    if (item.type === "feature") {
      return { state: restored, announcement: `${names.feature(item.ref)}: move cancelled.`, handled: true };
    }
    const s = milestoneSpot(before, item.key);
    return { state: restored, announcement: `Milestone ${s.n}: move cancelled.`, handled: true };
  }

  if (key === " " || key === "Enter") {
    if (item.type === "feature") {
      const w = locate(state.plan, tray, item.ref);
      const where = w && w.col >= 0 ? `Milestone ${numberOf(state.plan, w.col)}` : "Not in a milestone";
      return { state: done(), announcement: `${names.feature(item.ref)} dropped in ${where}.`, handled: true };
    }
    const s = milestoneSpot(state.plan, item.key);
    return { state: done(), announcement: `Milestone ${s.n} dropped at position ${s.pos}`, handled: true };
  }

  const arrows = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
  if (!arrows.includes(key)) return unhandled;

  if (item.type === "milestone") {
    const from = indexOfKey(state.plan, item.key);
    if (from < 0) return unhandled;
    const dir = key === "ArrowUp" || key === "ArrowLeft" ? -1 : 1;
    const plan = reorderMilestone(state.plan, from, from + dir);
    const s = milestoneSpot(plan, item.key);
    return { state: { ...state, plan, focus: item }, announcement: `Milestone ${s.n}. Position ${s.pos}`, handled: true };
  }

  const w = locate(state.plan, tray, item.ref);
  if (!w) return unhandled;
  let plan: MilestonePlan = state.plan;
  let nextTray = tray;
  if (key === "ArrowUp" || key === "ArrowDown") {
    const to = clamp(w.index + (key === "ArrowUp" ? -1 : 1), 0, w.size - 1);
    if (w.col < 0) {
      const t = tray.filter((r) => r !== item.ref);
      t.splice(to, 0, item.ref);
      nextTray = t;
    } else {
      plan = moveFeature(state.plan, item.ref, milestoneKey(state.plan[w.col]), to);
    }
  } else {
    const col = w.col + (key === "ArrowLeft" ? -1 : 1);
    if (col >= -1 && col < state.plan.length && col !== w.col) {
      if (col < 0) {
        plan = unassignFeature(state.plan, item.ref);
        const t = [...tray];
        t.splice(clamp(w.index, 0, t.length), 0, item.ref);
        nextTray = t;
      } else {
        plan = moveFeature(state.plan, item.ref, milestoneKey(state.plan[col]), w.index);
        nextTray = tray.filter((r) => r !== item.ref);
      }
    }
  }
  const next: DragState = { ...state, plan, focus: item };
  if (state.tray !== undefined || nextTray !== tray) next.tray = nextTray;
  return { state: next, announcement: `${names.feature(item.ref)}. ${featureSpot(plan, nextTray, item.ref)}`, handled: true };
}
