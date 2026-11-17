// acceptance.save (mf-project, lane L6). Actor only from ctx, server stamping, no ItemId
// sent, one versioned write per change. Replaces the parent's whole criteria list.
import { defineLaneOp, OpError, addChanged, argString, argInt, argStringArray, type ChangedRows, type RemovedIds, type Row } from "./ports";
import { loadObjective, loadRequirement, loadVersions, deferUpdate } from "./loaders";
import { writeVersion } from "./versioning";
import {
  REQUIREMENT_LIMITS,
  criteriaToText,
  acceptanceItemKey,
  ACCEPTANCE_OBJECTIVE_KEY,
  isActiveRequirementStatus,
} from "../../../../src/domain/requirements";
import { criteriaOrThrow, removedVersions } from "./requirement";

type Parent = { type: "objective" } | { type: "requirement"; id: string };

function parseParent(input: Record<string, unknown>): Parent {
  const p = input.parent;
  const bad = (reason: string) => new OpError("invalid_input", "input.invalid", { field: "parent", reason });
  if (!p || typeof p !== "object" || Array.isArray(p)) throw bad("required");
  const o = p as Record<string, unknown>;
  if (o.type === "objective") return { type: "objective" };
  if (o.type === "requirement") return { type: "requirement", id: argString(o, "id", { max: 64 }) };
  throw bad("value");
}

export const saveAcceptance = defineLaneOp({
  op: "acceptance.save",
  permission: "requirements.edit",
  requireOpenStep: true,
  parse: (input) => ({
    projectId: argString(input, "projectId", { max: 64 }),
    parent: parseParent(input),
    // Longer entries pass the shape check so the domain rule can report the exact index.
    criteria: argStringArray(input, "criteria", {
      maxItems: 200,
      maxLength: REQUIREMENT_LIMITS.criterionMax * 4,
    }),
    baseVersion: argInt(input, "baseVersion", { min: 0 }),
  }),
  prefetch(env, a) {
    const key = a.parent.type === "objective" ? ACCEPTANCE_OBJECTIVE_KEY : acceptanceItemKey(a.parent.id);
    const parent = a.parent.type === "objective" ? loadObjective(env) : loadRequirement(env, a.parent.id);
    return Promise.all([parent, loadVersions(env, key, { withText: false })]);
  },
  async run(ctx, a) {
    const changed: ChangedRows = {};
    let row: Row | null;
    let itemKey: string;
    let schema: "Objective" | "Requirement";
    // the parent row and the item's versions in one round
    let versions: Row[];
    if (a.parent.type === "objective") {
      itemKey = ACCEPTANCE_OBJECTIVE_KEY;
      [row, versions] = await Promise.all([loadObjective(ctx), loadVersions(ctx, itemKey, { withText: ctx.retry })]);
      if (!row) throw new OpError("not_found", "objective.notFound");
      schema = "Objective";
    } else {
      itemKey = acceptanceItemKey(a.parent.id);
      [row, versions] = await Promise.all([loadRequirement(ctx, a.parent.id), loadVersions(ctx, itemKey, { withText: ctx.retry })]);
      if (!isActiveRequirementStatus(row.Status)) throw new OpError("conflict", "requirement.removed");
      schema = "Requirement";
    }
    const list = criteriaOrThrow(a.criteria);
    const current = Array.isArray(row.AcceptanceCriteria)
      ? (row.AcceptanceCriteria as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
    if (criteriaToText(list) === criteriaToText(current)) {
      return { itemKey, version: Math.max(0, ...versions.map((r) => Number(r.N) || 0)), changed, removed: {} as RemovedIds };
    }
    const v = await writeVersion(ctx, {
      itemKey,
      text: criteriaToText(list),
      origin: "person",
      baseVersion: a.baseVersion,
      versions,
      // Seed v1 with the existing list only when there is one.
      seed: current.length ? { text: criteriaToText(current), origin: "person" } : null,
      deferPrune: true,
    });
    const upd = deferUpdate(ctx, schema, row, { AcceptanceCriteria: list });
    addChanged(changed, schema, upd);
    addChanged(changed, "ItemVersion", v.row);
    ctx.deps.audit({
      targetType: a.parent.type === "objective" ? "objective" : "requirement",
      targetId: String(row.ItemId),
      details: { criteria: list.length },
    });
    return { itemKey, version: v.n, changed, removed: removedVersions(v.pruned) };
  },
});
