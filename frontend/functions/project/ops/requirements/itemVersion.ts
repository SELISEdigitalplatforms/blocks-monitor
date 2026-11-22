// item.version (mf-project, lane L6): restore an older version as a NEW version and update
// the live record. Actor only from ctx, server stamping, no ItemId sent, one versioned write.
// Provenance is `person` (S1 has no `restore` origin: Schema gap).
import { defineLaneOp, OpError, addChanged, argString, argInt, type ChangedRows, type Row } from "./ports";
import { loadObjective, loadRequirement, loadVersions, deferUpdate, type ReadCtx } from "./loaders";
import { writeVersion } from "./versioning";
import {
  parseItemKey,
  parseRequirementVersionText,
  parseObjectiveVersionText,
  textToCriteria,
  isActiveRequirementStatus,
} from "../../../../src/domain/requirements";
import { text, removedVersions } from "./requirement";

const invalidKey = (reason?: string) =>
  new OpError("invalid_input", "input.invalid", { field: "itemKey", ...(reason ? { reason } : {}) });

/** The row an item key points at (a requirement, its acceptance list or the objective). */
function itemRow(env: ReadCtx, parsed: NonNullable<ReturnType<typeof parseItemKey>>): { rowP: Promise<Row | null>; schema: "Requirement" | "Objective" } {
  if (parsed.kind === "requirement") return { rowP: loadRequirement(env, parsed.id), schema: "Requirement" };
  if (parsed.kind === "objective" || parsed.parent.type === "objective") return { rowP: loadObjective(env), schema: "Objective" };
  return { rowP: loadRequirement(env, parsed.parent.id), schema: "Requirement" };
}

export const restoreItemVersion = defineLaneOp({
  op: "item.version",
  permission: "requirements.edit",
  requireOpenStep: true,
  parse(input) {
    const itemKey = argString(input, "itemKey", { max: 100 });
    if (!parseItemKey(itemKey)) throw invalidKey();
    return {
      projectId: argString(input, "projectId", { max: 64 }),
      itemKey,
      restoreN: argInt(input, "restoreN", { min: 1 }),
      baseVersion: argInt(input, "baseVersion", { min: 0 }),
    };
  },
  prefetch(env, a) {
    const parsed = parseItemKey(a.itemKey);
    if (!parsed) return undefined;
    return Promise.all([itemRow(env, parsed).rowP, loadVersions(env, a.itemKey, { withText: true })]);
  },
  async run(ctx, a) {
    const changed: ChangedRows = {};
    const parsed = parseItemKey(a.itemKey);
    if (!parsed) throw invalidKey();

    // The item must belong to this project.
    // the item's row and its versions (with text) in one round
    const { rowP, schema } = itemRow(ctx, parsed);
    const [row, versions] = await Promise.all([rowP, loadVersions(ctx, a.itemKey, { withText: true })]);
    if (!row) throw new OpError("not_found", "objective.notFound");
    if (schema === "Requirement" && !isActiveRequirementStatus(row.Status)) {
      throw new OpError("conflict", "requirement.removed");
    }

    const target = versions.find((v) => v.N === a.restoreN);
    if (!target) throw new OpError("not_found", "version.notFound");
    if (a.restoreN === versions.reduce((m, r) => Math.max(m, Number(r.N) || 0), 0)) {
      throw new OpError("invalid_input", "input.invalid", { field: "restoreN", reason: "current" });
    }
    const versionText = text(target.Text);

    // Work out the live-record patch first, so unreadable text writes nothing.
    let patch: Record<string, unknown>;
    if (parsed.kind === "requirement") {
      const p = parseRequirementVersionText(versionText);
      if (!p) throw invalidKey("unreadable");
      patch = { Title: p.title, Text: p.text, Priority: p.priority };
    } else if (parsed.kind === "objective") {
      const p = parseObjectiveVersionText(versionText);
      if (!p) throw invalidKey("unreadable");
      patch = { Statement: p.statement };
    } else {
      patch = { AcceptanceCriteria: textToCriteria(versionText) };
    }

    const v = await writeVersion(ctx, { itemKey: a.itemKey, text: versionText, origin: "person", baseVersion: a.baseVersion, versions, deferPrune: true });
    const upd = deferUpdate(ctx, schema, row, patch);
    addChanged(changed, schema, upd);
    addChanged(changed, "ItemVersion", v.row);
    return { itemKey: a.itemKey, version: v.n, changed, removed: removedVersions(v.pruned) };
  },
});
