/** "Apply change" of a suggested change (a FeedbackComment of kind "proposal", src/domain/feedback.ts proposalText):
 *  the new wording is saved through the item's NORMAL edit op, exactly as its own editor sends it, so every rule,
 *  version and conflict check of that op still holds. One hook per kind of item, so a card only reads what it needs.
 *  The card then closes the thread with setStatus(threadId, "resolved", "applied").
 *
 *  What a proposal's title / text become, per item:
 *  - requirement: title (empty = keep) and detail (empty = keep); priority kept; criteria are not part of an edit.
 *  - extra: a workflow takes the title (empty = keep) and its steps (the text, one step per line; empty = keep);
 *    a "not included" item or a constraint is its words: the text, or the title when the text is empty.
 *  - feature: name (empty = keep) and description (empty = keep); everything else kept.
 *  - story: the story text (the text, or the title when the text is empty); actor and criteria kept.
 *  - milestone: name (empty = keep) and goal (empty = keep); the rest of the plan kept.
 *  - success target: the value (the text, or the title when the text is empty).
 *  - screen: none (the designer makes a new version of the screen instead). */
import { useCollabContext } from "@/blocks/collab/context";
import { useItemVersionsMeta, useRequirements } from "@/blocks/requirements/hooks";
import { useRequirementsContext } from "@/blocks/requirements/context";
import { useRequirementsExtras } from "@/blocks/requirements/extras";
import { useSaveRequirement } from "@/blocks/requirements/mutations";
import { useSaveExtra, type SaveExtraArgs } from "@/blocks/requirements/extrasMutations";
import { useScopeContext } from "@/blocks/scope/context";
import { useFeatures, useMilestones, useScopeVersion, useStories } from "@/blocks/scope/hooks";
import { useMilestonesSave, useScopeSave, useSuccessSave, type ScopeSaveAnswer } from "@/blocks/scope/mutations";
import { STALE_ROW_TEXT, scopeErrorMessage } from "@/blocks/scope/messages";
import { requirementsErrorMessage } from "@/components/requirements/messages";
import type { WorkspacePermission } from "../../domain/rbac";
import type { Proposal } from "../../domain/feedback";
import { currentVersionOf } from "../../domain/requirements";
import { cleanLines } from "../../domain/setupDetails";
import { SUCCESS_KEYS, setValue, type SuccessKey } from "../../domain/successTargets";
import type { FeedbackTarget } from "./feedbackUi";
import { t } from "@/i18n";

/** A plain sentence the card shows as it is (the item is gone or changed meanwhile). */
export class ApplyError extends Error {}

// the plain sentences, in the person's language (read when they are shown)
export const itemGoneMessage = (): string => t("settings.feedback.apply.itemGone", "This item is no longer here, so the change can't be applied. Choose “Keep as is”.");
export const notLoadedMessage = (): string => t("settings.feedback.apply.notLoaded", "The item is still loading. Try again in a moment.");
export const editDirectlyMessage = (): string => t("settings.feedback.apply.editDirectly", "Edit the item directly to make this change, then choose “Keep as is”.");
const noEditMessage = (): string => t("settings.feedback.apply.noEdit", "Only people who can edit this item can apply the change.");
const scopeLockedApply = (): string => t("settings.feedback.apply.scopeLocked", "The scope is locked, so this change can't be applied here.");

export interface ApplyLane {
  /** Saves the suggested change through the item's own edit. Null: not offered (see `blocked`). */
  apply: ((p: Proposal) => Promise<void>) | null;
  /** Why "Apply change" is not offered, in plain words; null when it is. */
  blocked: string | null;
}

const none = (): ApplyLane => ({ apply: null, blocked: editDirectlyMessage() });

/** Every failure of an apply leaves as an ApplyError carrying the plain sentence of the op that refused. */
const guarded = (fn: (p: Proposal) => Promise<void>, message: (e: unknown) => string) => async (p: Proposal): Promise<void> => {
  try { await fn(p); } catch (e) { throw e instanceof ApplyError ? e : new ApplyError(message(e)); }
};
const textOr = (p: Proposal, fallback: string): string => (p.text.trim() ? p.text.trim() : fallback);
const titleOr = (p: Proposal, fallback: string): string => (p.title.trim() ? p.title.trim() : fallback);
/** A one-field item takes the text, or the title when there is no text. */
const wordsOf = (p: Proposal): string => p.text.trim() || p.title.trim();

function useCanEdit(permission: WorkspacePermission): boolean {
  const { permissions, isSuperAdmin } = useCollabContext();
  return isSuperAdmin || permissions.includes(permission);
}

// ── Goals & requirements ──────────────────────────────────────────────────────────────────────────────────────────

export function useRequirementApply(projectId: string, target: FeedbackTarget): ApplyLane {
  const reqs = useRequirements(projectId);
  const versions = useItemVersionsMeta(projectId);
  const save = useSaveRequirement(projectId);
  if (!useCanEdit("requirements.edit")) return { apply: null, blocked: noEditMessage() };
  return {
    blocked: null,
    apply: guarded(async (p) => {
      if (!reqs.data || !versions.data) throw new ApplyError(notLoadedMessage());
      const r = reqs.data.find((x) => x.id === target.id);
      if (!r) throw new ApplyError(itemGoneMessage());
      await save.mutateAsync({
        id: r.id, title: titleOr(p, r.title), detail: textOr(p, r.detail), priority: r.priority,
        baseVersion: currentVersionOf(versions.data.latest, `requirement:${r.id}`),
      });
    }, requirementsErrorMessage),
  };
}

export function useExtraApply(projectId: string, target: FeedbackTarget): ApplyLane {
  const ctx = useRequirementsContext(projectId);
  const extras = useRequirementsExtras(projectId, ctx.project?.setup);
  const save = useSaveExtra(projectId);
  if (!useCanEdit("requirements.edit")) return { apply: null, blocked: noEditMessage() };
  return {
    blocked: null,
    apply: guarded(async (p) => {
      if (extras.loading) throw new ApplyError(notLoadedMessage());
      const e = [...extras.byKind.workflow, ...extras.byKind.exclusion, ...extras.byKind.constraint].find((x) => x.id === target.id);
      if (!e) throw new ApplyError(itemGoneMessage());
      let body: SaveExtraArgs;
      if (e.kind === "workflow") {
        const steps = cleanLines(p.text.split("\n"));
        body = { id: e.id, kind: e.kind, title: titleOr(p, e.title), who: e.who, steps: steps.length ? steps : e.steps };
      } else {
        body = { id: e.id, kind: e.kind, title: wordsOf(p) || e.title, ...(e.kind === "constraint" ? { constraintKind: e.constraintKind || "other" } : {}) };
      }
      await save.mutateAsync(body);
    }, requirementsErrorMessage),
  };
}

// ── Scope & success ───────────────────────────────────────────────────────────────────────────────────────────────

/** A scope.save answer that names a conflict did not save that row: someone changed it meanwhile. */
function checkSaved(answer: ScopeSaveAnswer | undefined): void {
  if (answer?.conflicts?.length) throw new ApplyError(STALE_ROW_TEXT);
}

const lockedLane = (target: FeedbackTarget): ApplyLane | null => (target.locked ? { apply: null, blocked: scopeLockedApply() } : null);

export function useFeatureApply(projectId: string, target: FeedbackTarget): ApplyLane {
  const ctx = useScopeContext(projectId);
  const version = useScopeVersion(ctx).data ?? null;
  const features = useFeatures(ctx, version);
  const save = useScopeSave(ctx);
  const canEdit = useCanEdit("requirements.edit");
  const locked = lockedLane(target);
  if (locked) return locked;
  if (!canEdit) return { apply: null, blocked: noEditMessage() };
  return {
    blocked: null,
    apply: guarded(async (p) => {
      if (!features.data) throw new ApplyError(notLoadedMessage());
      const f = features.data.items.find((x) => x.id === target.id);
      if (!f) throw new ApplyError(itemGoneMessage());
      const res = await save.mutateAsync({
        projectId,
        upsertFeatures: [{
          id: f.id, expectedUpdatedAt: f.updatedAt || undefined, name: titleOr(p, f.name), description: textOr(p, f.description),
          priority: f.priority, excludedReason: f.priority === "excluded" && f.excludedReason ? f.excludedReason : undefined,
          requirementIds: f.requirementIds, screenIds: f.screenIds, sortOrder: f.sortOrder,
        }],
      });
      checkSaved(res.data);
    }, scopeErrorMessage),
  };
}

export function useStoryApply(projectId: string, target: FeedbackTarget): ApplyLane {
  const ctx = useScopeContext(projectId);
  const version = useScopeVersion(ctx).data ?? null;
  const stories = useStories(ctx, version);
  const save = useScopeSave(ctx);
  const canEdit = useCanEdit("requirements.edit");
  const locked = lockedLane(target);
  if (locked) return locked;
  if (!canEdit) return { apply: null, blocked: noEditMessage() };
  return {
    blocked: null,
    apply: guarded(async (p) => {
      if (!stories.data) throw new ApplyError(notLoadedMessage());
      const s = stories.data.items.find((x) => x.id === target.id);
      if (!s) throw new ApplyError(itemGoneMessage());
      const res = await save.mutateAsync({
        projectId,
        upsertStories: [{
          id: s.id, expectedUpdatedAt: s.updatedAt || undefined, featureId: s.featureId, actor: s.actor,
          text: wordsOf(p) || s.text, acceptanceCriteria: s.acceptanceCriteria, sortOrder: s.sortOrder,
        }],
      });
      checkSaved(res.data);
    }, scopeErrorMessage),
  };
}

export function useMilestoneApply(projectId: string, target: FeedbackTarget): ApplyLane {
  const ctx = useScopeContext(projectId);
  const version = useScopeVersion(ctx).data ?? null;
  const milestones = useMilestones(ctx, version);
  const save = useMilestonesSave(ctx);
  const canEdit = useCanEdit("milestones.edit");
  const locked = lockedLane(target);
  if (locked) return locked;
  if (!canEdit) return { apply: null, blocked: noEditMessage() };
  return {
    blocked: null,
    apply: guarded(async (p) => {
      if (!version || !milestones.data) throw new ApplyError(notLoadedMessage());
      if (version.status === "locked") throw new ApplyError(scopeLockedApply());
      const stored = milestones.data.items;
      if (!stored.some((m) => m.id === target.id)) throw new ApplyError(itemGoneMessage());
      // the whole arrangement is one unit (milestones.save): every milestone is sent as it is stored, the one changed
      await save.mutateAsync({
        projectId,
        scopeVersionId: version.id,
        plan: stored.map((m) => ({
          id: m.id, name: m.id === target.id ? titleOr(p, m.name) : m.name, goal: m.id === target.id ? textOr(p, m.goal) : m.goal,
          featureRefs: [...m.featureRefs],
        })),
        expected: stored.map((m) => ({ id: m.id, updatedAt: m.updatedAt })),
      });
    }, scopeErrorMessage),
  };
}

export function useSuccessApply(projectId: string, target: FeedbackTarget): ApplyLane {
  const ctx = useScopeContext(projectId);
  const version = useScopeVersion(ctx).data ?? null;
  const save = useSuccessSave(ctx);
  const canEdit = useCanEdit("requirements.edit");
  const locked = lockedLane(target);
  if (locked) return locked;
  if (!(SUCCESS_KEYS as readonly string[]).includes(target.id)) return none();
  if (!canEdit) return { apply: null, blocked: noEditMessage() };
  const k = target.id as SuccessKey;
  return {
    blocked: null,
    apply: guarded(async (p) => {
      if (!version) throw new ApplyError(notLoadedMessage());
      if (version.status === "locked") throw new ApplyError(scopeLockedApply());
      const words = wordsOf(p);
      if (!words) throw new ApplyError(editDirectlyMessage());
      const t = version.successTargets;
      await save.mutateAsync({
        projectId, scopeVersionId: version.id,
        targets: { ...t, [k]: setValue(t[k], words, "", new Date().toISOString(), k === "responseTime" ? "" : t[k].choice) },
      });
    }, scopeErrorMessage),
  };
}

/** Screens take no suggested wording: the designer makes a new version of the screen instead. */
export function useNoApply(): ApplyLane {
  return none();
}
