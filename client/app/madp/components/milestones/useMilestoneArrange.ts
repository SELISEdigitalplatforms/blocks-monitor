/** Owns the milestone plan on screen. Every change goes through the pure functions of src/domain/milestones.ts, then
 *  into the autosave queue (milestones.save). The plan is derived from the stored rows until it is edited. */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  addMilestone, keyboardMove, milestoneKey, moveFeature, removeMilestone, renameMilestone, reorderMilestone, setGoal,
  unassignFeature, unassignedFeatures, validateMilestonePlan,
  type DragItem, type DragState, type MilestoneIssue, type PlanMilestone,
} from "../../domain/milestones";
import { t } from "@/madp/i18n";

export interface StoredMilestone {
  id: string;
  number: number;
  name: string;
  goal: string;
  featureRefs: string[];
  sortOrder: number;
  updatedAt: string;
}
export interface ArrangeFeature { ref: string; name: string; priority: string }
export interface ArrangeAutosave { queue: (plan: PlanMilestone[]) => void }

export interface MilestoneIssues { name?: string; features?: string }

export const FEATURE_PREFIX = "feature:";
export const MILESTONE_PREFIX = "milestone:";
export const isExcluded = (f: ArrangeFeature) => f.priority === "excluded";

export function planFromStored(stored: readonly StoredMilestone[]): PlanMilestone[] {
  return [...stored]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number)
    .map((m) => ({ id: m.id, number: m.number, name: m.name, goal: m.goal, featureRefs: [...m.featureRefs] }));
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const core = ({ id, name, goal, featureRefs }: PlanMilestone) => ({ id, name, goal, featureRefs });
const full = ({ id, clientKey, number, name, goal, featureRefs }: PlanMilestone) => ({ id, clientKey, number, name, goal, featureRefs });

/** The plan to show when the stored rows change. Never over pending edits that differ from the stored rows, and the
 *  SAME reference when nothing differs, so the effect does not set state (and render) again. */
export function nextPlan(current: PlanMilestone[], storedPlan: PlanMilestone[], dirty: boolean): { plan: PlanMilestone[]; dirty: boolean } {
  if (dirty && !sameJson(storedPlan.map(core), current.map(core))) return { plan: current, dirty: true };
  return { plan: sameJson(current.map(full), storedPlan.map(full)) ? current : storedPlan, dirty: false };
}

function issueText(i: MilestoneIssue): string {
  switch (i.rule) {
    case "nameRequired": return t("build.milestones.issue.nameRequired", "Give the milestone a name.");
    case "nameDuplicate": return t("build.milestones.issue.nameDuplicate", "Another milestone already has this name.");
    case "nameTooLong": return t("build.milestones.issue.nameTooLong", "Use at most {max} characters.", { max: String(i.params?.max ?? 60) });
    case "unknownFeature": return t("build.milestones.issue.unknownFeature", "A feature here is not part of the scope.");
    case "excludedFeature": return t("build.milestones.issue.excludedFeature", "A feature here is not included in the scope.");
    case "duplicateFeature": return t("build.milestones.issue.duplicateFeature", "A feature is listed twice.");
    default: return "";
  }
}

/** removeMilestone answers the new plan, or {ok:false, reason}. */
function planOf(res: unknown): PlanMilestone[] | null {
  if (Array.isArray(res)) return res as PlanMilestone[];
  const r = res as { ok?: boolean; plan?: PlanMilestone[] } | null;
  return r && r.ok !== false && Array.isArray(r.plan) ? r.plan : null;
}

export function useMilestoneArrange({ stored, features, autosave, editable }: {
  stored: readonly StoredMilestone[];
  features: readonly ArrangeFeature[];
  autosave: ArrangeAutosave;
  editable: boolean;
}) {
  const [plan, setPlanState] = useState<PlanMilestone[]>(() => planFromStored(stored));
  const dirty = useRef(false);
  const storedPlan = useMemo(() => planFromStored(stored), [stored]);
  const [picked, setPicked] = useState<DragState["picked"]>(null);
  const held: DragItem | null = picked?.item ?? null;
  const [announcement, setAnnouncement] = useState("");
  const [focusId, setFocusId] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  // re-derive after a reload or new stored rows, but never over pending edits
  useEffect(() => {
    const r = nextPlan(plan, storedPlan, dirty.current);
    dirty.current = r.dirty;
    if (r.plan !== plan) setPlanState(r.plan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedPlan]);

  useEffect(() => {
    if (!focusId) return;
    container.current?.querySelector<HTMLElement>(`[data-focus-id="${focusId.replace(/"/g, '\\"')}"]`)?.focus();
    setFocusId(null);
  }, [focusId, plan]);

  const included = useMemo(() => features.filter((f) => !isExcluded(f)).map((f) => f.ref), [features]);
  const excluded = useMemo(() => features.filter(isExcluded).map((f) => f.ref), [features]);
  const nameOf = useCallback((ref: string) => features.find((f) => f.ref === ref)?.name ?? t("build.milestones.featureFallback", "Feature"), [features]);

  const commit = useCallback((next: PlanMilestone[]) => {
    dirty.current = true;
    setPlanState(next);
    autosave.queue(next);
  }, [autosave]);

  const issues = useMemo(() => {
    const out: Record<string, MilestoneIssues> = {};
    for (const i of validateMilestonePlan(plan, included, "save", excluded) as MilestoneIssue[]) {
      const m = /^plan\.(\d+)\.(name|goal|featureRefs)/.exec(i.path);
      const m0 = m ? plan[Number(m[1])] : undefined;
      if (!m || !m0) continue;
      const slot = (out[milestoneKey(m0)] ??= {});
      const text = issueText(i);
      if (m[2] === "name") slot.name = text;
      else if (m[2] === "featureRefs") slot.features = text;
    }
    return out;
  }, [plan, included, excluded]);

  const unassigned = useMemo(() => unassignedFeatures(plan, included), [plan, included]);

  const guard = editable;
  // the new milestone's name field takes the focus with its placeholder name selected, so typing names it at once
  const [nameFocus, setNameFocus] = useState<string | null>(null);
  const clearNameFocus = useCallback(() => setNameFocus(null), []);
  const add = useCallback(() => {
    if (!guard) return;
    const clientKey = crypto.randomUUID();
    const next = planOf(addMilestone(plan, { clientKey, name: t("build.page.milestoneN", "Milestone {number}", { number: Math.max(0, ...plan.map((m) => m.number ?? 0), plan.length) + 1 }) }));
    if (next) {
      commit(next);
      setNameFocus(clientKey);
      setAnnouncement(t("build.milestones.announce.added", "Milestone added. Type its name."));
    }
  }, [guard, plan, commit]);
  const remove = useCallback((key: string) => {
    if (!guard) return;
    const next = planOf(removeMilestone(plan, key));
    if (next) {
      commit(next);
      setAnnouncement(t("build.milestones.announce.removed", "Milestone removed. Its features are back in Not in a milestone."));
    }
  }, [guard, plan, commit]);
  const rename = useCallback((key: string, name: string) => { if (guard) { const n = planOf(renameMilestone(plan, key, name)); if (n) commit(n); } }, [guard, plan, commit]);
  const goal = useCallback((key: string, text: string) => { if (guard) { const n = planOf(setGoal(plan, key, text)); if (n) commit(n); } }, [guard, plan, commit]);
  const reorder = useCallback((from: number, to: number) => {
    if (!guard || from === to || to < 0 || to >= plan.length) return;
    const n = planOf(reorderMilestone(plan, from, to));
    if (n) {
      commit(n);
      setAnnouncement(t("build.milestones.announce.moved", "Milestone moved to position {n} of {of}.", { n: to + 1, of: plan.length }));
    }
  }, [guard, plan, commit]);
  const move = useCallback((ref: string, toKey: string, toIndex: number) => {
    if (!guard) return;
    const n = planOf(moveFeature(plan, ref, toKey, toIndex));
    if (n) {
      commit(n);
      setAnnouncement(t("build.milestones.announce.featureMoved", "{name} moved.", { name: nameOf(ref) }));
      setFocusId(`f:${ref}`);
    }
  }, [guard, plan, commit, nameOf]);
  const unassign = useCallback((ref: string) => {
    if (!guard) return;
    const n = planOf(unassignFeature(plan, ref));
    if (n) {
      commit(n);
      setAnnouncement(t("build.milestones.announce.unassigned", "{name} is now in Not in a milestone.", { name: nameOf(ref) }));
      setFocusId(`f:${ref}`);
    }
  }, [guard, plan, commit, nameOf]);

  /** Native drop: payload "feature:<ref>" or "milestone:<key>". */
  const dropFeature = useCallback((data: string, to: { milestoneKey: string | null; index?: number }) => {
    if (!data.startsWith(FEATURE_PREFIX)) return;
    const ref = data.slice(FEATURE_PREFIX.length);
    if (to.milestoneKey === null) unassign(ref);
    else move(ref, to.milestoneKey, to.index ?? Number.MAX_SAFE_INTEGER);
  }, [move, unassign]);
  const dropMilestone = useCallback((data: string, toIndex: number) => {
    if (!data.startsWith(MILESTONE_PREFIX)) return;
    const from = plan.findIndex((m) => milestoneKey(m) === data.slice(MILESTONE_PREFIX.length));
    if (from >= 0) reorder(from, toIndex);
  }, [plan, reorder]);

  /** The keyboard drag model: the domain reducer decides; the hook applies its plan, focus and announcement. */
  const handleKey = useCallback((item: DragItem, focusKey: string) => (e: KeyboardEvent<HTMLElement>) => {
    if (!guard) return;
    const state: DragState = { plan, focus: item, picked, tray: unassigned };
    const res = keyboardMove(state, e.key, { feature: nameOf });
    if (!res.handled) return;
    e.preventDefault();
    e.stopPropagation();
    setPicked(res.state.picked);
    if (res.announcement) setAnnouncement(res.announcement);
    if (res.state.plan !== plan) commit([...res.state.plan]);
    setFocusId(focusKey);
  }, [guard, plan, picked, unassigned, nameOf, commit]);

  return {
    plan, issues, unassigned, held, announcement, container, nameOf, included,
    /** the clientKey of the milestone just added, whose name field takes the focus once */
    nameFocus, clearNameFocus,
    add, remove, rename, goal, reorder, move, unassign, dropFeature, dropMilestone, handleKey,
    /** forget local edits and show the stored rows again (after Reload) */
    resetToStored: () => { dirty.current = false; setPlanState(storedPlan); },
  };
}
