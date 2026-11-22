// Requirement ops of the Requirements & objective step (mf-project, lane L6).
// Rules every op here follows (design Appendix A, enforced by defineLaneOp):
//  - the actor comes only from ctx (never from the input); permission `requirements.edit`
//    and the open step are checked before `run` is called;
//  - WorkspaceId, ReaderIds, CreatedByUserId and UpdatedByUserId are stamped by the scoped
//    gateway; input copies of them (and of ItemId) are never read, ItemId is never sent;
//  - one versioned write per text change (writeVersion), answered with the changed rows.
import {
  defineLaneOp,
  OpError,
  addChanged,
  argString,
  argInt,
  argBool,
  argStringArray,
  type ChangedRows,
  type RemovedIds,
  type LaneOpContext,
  type Row,
} from "./ports";
import { loadRequirement, loadRequirements, loadVersions, insertRequirement, deferUpdate, assertActiveCapacity } from "./loaders";
import { writeVersion, currentVersion } from "./versioning";
import { isEngineWritten, type RequirementPriority } from "./records";
import {
  REQUIREMENT_LIMITS,
  checkRequirementInput,
  checkCriteria,
  criteriaToText,
  requirementItemKey,
  acceptanceItemKey,
  requirementVersionText,
  reorderPlan,
  isActiveRequirementStatus,
  manualSourceRef,
  REMOVED_STATUS,
} from "../../../../src/domain/requirements";

/**
 * Answers whose writes ended with deps.flush() in their last round: the router skips their Operation record, so the
 * op needs no bookkeeping round. A retry runs the op again, and it finds the first write by its Key.
 */
const flushed = new WeakSet<object>();
export function markFlushed<T extends object>(answer: T): T {
  flushed.add(answer);
  return answer;
}
export const recordUnlessFlushed = (data: unknown): boolean => !(data && typeof data === "object" && flushed.has(data));

export const text = (v: unknown): string => (typeof v === "string" ? v : "");

/** Version ids the prune removed, for the answer's `removed` (accepts ids or rows). */
export function removedVersions(...pruned: unknown[]): RemovedIds {
  const ids: string[] = [];
  for (const list of pruned) {
    if (!Array.isArray(list)) continue;
    for (const p of list) {
      if (typeof p === "string") ids.push(p);
      else if (p && typeof p === "object" && typeof (p as Row).ItemId === "string") ids.push((p as Row).ItemId);
    }
  }
  return ids.length ? { ItemVersion: ids } : {};
}

/** checkCriteria → the lane's refusals (too_long: invalid_input; too_many: limit_reached). */
export function criteriaOrThrow(criteria: readonly string[]): string[] {
  const r = checkCriteria(criteria);
  if (r.ok) return r.criteria;
  if (r.reason === "too_many") {
    throw new OpError("limit_reached", "criteria.tooMany", { max: REQUIREMENT_LIMITS.maxCriteria });
  }
  throw new OpError("invalid_input", "input.invalid", { field: "criteria", reason: "too_long", index: r.index });
}

/** The stored versions of one item key with every column an answer carries (the replay of a create). */
const versionsOf = (ctx: LaneOpContext, itemKey: string): Promise<Row[]> =>
  ctx.db.find(
    "ItemVersion",
    { ProjectId: ctx.project.id, ItemKey: itemKey },
    { fields: ["ItemId", "WorkspaceId", "ProjectId", "ItemKey", "N", "Text", "Origin", "CreatedByUserId", "UpdatedByUserId", "CommentIds"], limit: 100 },
  );

const CRITERION_MAX = REQUIREMENT_LIMITS.criterionMax;
const CLIENT_KEY = /^[A-Za-z0-9-]{8,64}$/;

export const saveRequirement = defineLaneOp({
  op: "requirement.save",
  permission: "requirements.edit",
  requireOpenStep: true,
  closedStepChecked: true,
  record: recordUnlessFlushed,
  parse(input) {
    const restore = argBool(input, "restore");
    return {
      projectId: argString(input, "projectId", { max: 64 }),
      id: argString(input, "id", { max: 64, optional: true }),
      clientKey: argString(input, "clientKey", { max: 64, optional: true }),
      // Text fields are ignored on a restore.
      title: restore ? "" : (argString(input, "title", { max: 4000, allowEmpty: true, optional: true }) ?? ""),
      detail: restore ? "" : (argString(input, "detail", { max: 100000, allowEmpty: true, optional: true }) ?? ""),
      priority: restore ? "" : (argString(input, "priority", { max: 20, allowEmpty: true, optional: true }) ?? ""),
      criteria: argStringArray(input, "criteria", { maxItems: 200, maxLength: CRITERION_MAX * 4, optional: true }),
      baseVersion: argInt(input, "baseVersion", { min: 0, optional: true }),
      restore,
    };
  },
  // The same reads the run makes, started in the router's first round.
  prefetch(env, a) {
    if (!a.id) return loadRequirements(env);
    if (a.restore) return Promise.all([loadRequirement(env, a.id), loadVersions(env, requirementItemKey(a.id), { withText: false }), loadRequirements(env)]);
    return Promise.all([loadRequirement(env, a.id), loadVersions(env, requirementItemKey(a.id), { withText: false })]);
  },
  async run(ctx, a) {
    const changed: ChangedRows = {};
    // On a closed step only the repeat of a create (its row exists) is answered.
    if (ctx.stepClosed && (a.id || !a.clientKey)) throw new OpError("conflict", "requirements.closed");

    // RESTORE: a removed requirement goes back to draft; an active one is a no-op.
    if (a.id && a.restore) {
      const itemKey = requirementItemKey(a.id);
      const [row, version, all] = await Promise.all([loadRequirement(ctx, a.id), currentVersion(ctx, itemKey), loadRequirements(ctx)]);
      if (isActiveRequirementStatus(row.Status)) {
        addChanged(changed, "Requirement", row);
      } else {
        assertActiveCapacity(all);
        addChanged(changed, "Requirement", await ctx.db.update("Requirement", a.id, { Status: "draft" }));
        ctx.deps.audit({ targetType: "requirement", targetId: a.id, details: { created: false, restored: true } });
      }
      return { requirementId: a.id, version, changed, removed: {} as RemovedIds };
    }

    const checked = checkRequirementInput({ title: a.title, detail: a.detail, priority: a.priority });
    if (!checked.ok) {
      throw new OpError("invalid_input", "input.invalid", { field: checked.field, reason: checked.reason });
    }
    const { title, detail, priority } = checked.value;

    // CREATE (deterministic per clientKey: a double submit finds the first row).
    if (!a.id) {
      if (!a.clientKey || !CLIENT_KEY.test(a.clientKey)) {
        throw new OpError("invalid_input", "input.invalid", { field: "clientKey", reason: "invalid" });
      }
      const criteria = a.criteria ? criteriaOrThrow(a.criteria) : [];
      const preloaded = await loadRequirements(ctx);
      if (ctx.stepClosed && !preloaded.some((r) => r.Key === a.clientKey)) throw new OpError("conflict", "requirements.closed");
      const { row, created } = await insertRequirement(
        ctx,
        {
          key: a.clientKey,
          title,
          detail,
          priority,
          criteria,
          sourceRefs: [manualSourceRef(ctx.actorUserId)],
        },
        preloaded,
      );
      const id = row.ItemId;
      addChanged(changed, "Requirement", row);
      ctx.deps.audit({ targetType: "requirement", targetId: id, details: { created } });
      const kept = Array.isArray(row.AcceptanceCriteria) ? (row.AcceptanceCriteria as unknown[]).filter((x): x is string => typeof x === "string") : [];
      const reqKey = requirementItemKey(id);
      const accKey = acceptanceItemKey(id);
      // The first versions: a new item has none; a repeat (retry, double submit) writes only what a crashed run left out.
      let hasReq = false;
      let hasAcc = kept.length === 0;
      if (!created) {
        const [rv, av] = await Promise.all([versionsOf(ctx, reqKey), kept.length ? versionsOf(ctx, accKey) : Promise.resolve([])]);
        hasReq = rv.length > 0;
        hasAcc = kept.length === 0 || av.length > 0;
        if (hasReq && hasAcc) {
          // the first run wrote everything but its answer was not recorded: answer from the stored rows
          for (const stored of [...rv, ...av]) addChanged(changed, "ItemVersion", stored);
          return { requirementId: id, version: Math.max(...rv.map((r) => Number(r.N) || 0)), changed, removed: {} as RemovedIds };
        }
      }
      const firstVersions = () =>
        Promise.all([
          hasReq
            ? Promise.resolve(null)
            : writeVersion(ctx, {
                itemKey: reqKey,
                text: requirementVersionText({ title: text(row.Title), text: text(row.Text), priority: text(row.Priority) as RequirementPriority }),
                origin: "person",
                baseVersion: null,
                empty: true,
              }),
          hasAcc
            ? Promise.resolve(null)
            : writeVersion(ctx, {
                itemKey: accKey,
                text: criteriaToText(kept),
                origin: "person",
                baseVersion: null,
                empty: true,
              }),
        ]);
      if (created) {
        // The first versions go out in the router's last round, beside the audit, the notifications and the Operation
        // record (so a repeat of this call after later changes is answered from the record); the answer names the
        // requirement and version 1, the version rows are read with the history.
        ctx.deps.after(firstVersions);
        return { requirementId: id, version: 1, changed, removed: {} as RemovedIds };
      }
      // A repeat that finds a crashed run's leftovers writes only what is missing, with the audit and notifications.
      const [[v, av]] = await Promise.all([firstVersions(), ctx.deps.flush()]);
      let pruned: unknown[] = [];
      if (v) {
        addChanged(changed, "ItemVersion", v.row);
        pruned = pruned.concat([v.pruned]);
      }
      if (av) {
        addChanged(changed, "ItemVersion", av.row);
        pruned = pruned.concat([av.pruned]);
      }
      const answer = { requirementId: id, version: v ? v.n : 1, changed, removed: removedVersions(...pruned) };
      return answer;
    }

    // UPDATE (criteria go through acceptance.save)
    if (a.criteria !== undefined) {
      throw new OpError("invalid_input", "input.invalid", { field: "criteria", reason: "useAcceptance" });
    }
    if (a.baseVersion === undefined) {
      throw new OpError("invalid_input", "input.invalid", { field: "baseVersion", reason: "required" });
    }
    const itemKey = requirementItemKey(a.id);
    // the row and its versions in one round
    const [row, versions] = await Promise.all([loadRequirement(ctx, a.id), loadVersions(ctx, itemKey, { withText: ctx.retry })]);
    if (!isActiveRequirementStatus(row.Status)) throw new OpError("conflict", "requirement.removed");
    const old = { title: text(row.Title), text: text(row.Text), priority: text(row.Priority) };
    if (old.title === title && old.text === detail && old.priority === priority) {
      return { requirementId: a.id, version: Math.max(0, ...versions.map((r) => Number(r.N) || 0)), changed, removed: {} as RemovedIds };
    }
    const seedText = requirementVersionText({
      title: old.title,
      text: old.text,
      priority: old.priority === "nice" || old.priority === "later" ? old.priority : "must",
    });
    const v = await writeVersion(ctx, {
      itemKey,
      text: requirementVersionText({ title, text: detail, priority }),
      origin: "person",
      baseVersion: a.baseVersion,
      versions,
      seed: { text: seedText, origin: isEngineWritten(row) ? "engine" : "person" },
      deferPrune: true,
    });
    const upd = deferUpdate(ctx, "Requirement", row, { Title: title, Text: detail, Priority: priority });
    addChanged(changed, "Requirement", upd);
    addChanged(changed, "ItemVersion", v.row);
    ctx.deps.audit({ targetType: "requirement", targetId: a.id, details: { created: false } });
    return { requirementId: a.id, version: v.n, changed, removed: removedVersions(v.pruned) };
  },
});

export const deleteRequirement = defineLaneOp({
  op: "requirement.delete",
  permission: "requirements.edit",
  requireOpenStep: true,
  parse: (input) => ({
    projectId: argString(input, "projectId", { max: 64 }),
    id: argString(input, "id", { max: 64 }),
  }),
  prefetch: (env, a) => loadRequirement(env, a.id),
  async run(ctx, a) {
    const changed: ChangedRows = {};
    const row = await loadRequirement(ctx, a.id);
    // Soft delete; idempotent when already dropped.
    const next = row.Status === REMOVED_STATUS ? row : await ctx.db.update("Requirement", a.id, { Status: REMOVED_STATUS });
    addChanged(changed, "Requirement", next);
    ctx.deps.audit({ targetType: "requirement", targetId: a.id });
    return { requirementId: a.id, changed };
  },
});

export const reorderRequirements = defineLaneOp({
  op: "requirement.reorder",
  permission: "requirements.edit",
  requireOpenStep: true,
  parse: (input) => ({
    projectId: argString(input, "projectId", { max: 64 }),
    orderedIds: argStringArray(input, "orderedIds", {
      maxItems: REQUIREMENT_LIMITS.maxOrderedIds,
      maxLength: 64,
    }),
  }),
  prefetch: (env) => loadRequirements(env),
  async run(ctx, a) {
    const changed: ChangedRows = {};
    const active = (await loadRequirements(ctx)).filter((r) => isActiveRequirementStatus(r.Status));
    const plan = reorderPlan(a.orderedIds, active.map((r) => r.ItemId));
    if (!plan.ok) throw new OpError("conflict", "reorder.mismatch");
    // Set semantics: only rows whose SortOrder changes are written.
    const byId = new Map(active.map((r) => [r.ItemId, r]));
    // One round of parallel writes, whatever the number of moved rows.
    const moved = plan.plan.filter(({ id, sortOrder }) => byId.get(id)?.SortOrder !== sortOrder);
    const rows = await Promise.all(moved.map(({ id, sortOrder }) => ctx.db.update("Requirement", id, { SortOrder: sortOrder })));
    for (const row of rows) addChanged(changed, "Requirement", row);
    ctx.deps.audit({ targetType: "project", targetId: ctx.project.id, details: { count: moved.length } });
    return { changed };
  },
});
