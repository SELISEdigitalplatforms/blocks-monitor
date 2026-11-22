// objective.save (mf-project, lane L6). Actor only from ctx, WorkspaceId/ReaderIds/
// CreatedByUserId/UpdatedByUserId stamped by the scoped gateway, no ItemId sent, one
// versioned write per text change. The Objective is found by ProjectId whatever ItemId
// Product sanitization gave it; UNIQUE ProjectId stops a second row.
import { defineLaneOp, OpError, addChanged, argString, argInt, type ChangedRows, type RemovedIds } from "./ports";
import { loadObjective, ensureObjective, loadVersions, deferUpdate } from "./loaders";
import { writeVersion } from "./versioning";
import { isEngineWritten } from "./records";
import { checkObjectiveText, objectiveVersionText, OBJECTIVE_ITEM_KEY } from "../../../../src/domain/requirements";
import { text, removedVersions } from "./requirement";

export const saveObjective = defineLaneOp({
  op: "objective.save",
  permission: "requirements.edit",
  requireOpenStep: true,
  parse: (input) => ({
    projectId: argString(input, "projectId", { max: 64 }),
    text: argString(input, "text", { max: 100000, allowEmpty: true, optional: true }) ?? "",
    baseVersion: argInt(input, "baseVersion", { min: 0 }),
  }),
  prefetch: (env) => Promise.all([loadObjective(env), loadVersions(env, OBJECTIVE_ITEM_KEY, { withText: false })]),
  async run(ctx, a) {
    const checked = checkObjectiveText(a.text);
    if (!checked.ok) throw new OpError("invalid_input", "input.invalid", { field: "text", reason: checked.reason });
    const statement = checked.value;
    const changed: ChangedRows = {};
    // the Objective and its versions in one round
    const [existing, versions] = await Promise.all([loadObjective(ctx), loadVersions(ctx, OBJECTIVE_ITEM_KEY, { withText: ctx.retry })]);

    if (!existing) {
      // the row and its first version do not depend on each other: one round
      const [{ row }, v] = await Promise.all([
        ensureObjective(ctx, statement, null),
        writeVersion(ctx, {
          itemKey: OBJECTIVE_ITEM_KEY,
          text: objectiveVersionText({ statement }),
          origin: "person",
          baseVersion: a.baseVersion,
          versions,
          deferPrune: true,
        }),
      ]);
      addChanged(changed, "Objective", row);
      addChanged(changed, "ItemVersion", v.row);
      ctx.deps.audit({ targetType: "objective", targetId: row.ItemId, details: { created: true } });
      return { objectiveId: row.ItemId, version: v.n, changed, removed: removedVersions(v.pruned) };
    }

    if (text(existing.Statement) === statement) {
      return {
        objectiveId: existing.ItemId,
        version: versions.reduce((m, r) => Math.max(m, Number(r.N) || 0), 0),
        changed,
        removed: {} as RemovedIds,
      };
    }
    const highLevelMd = text(existing.HighLevelMd);
    const architectureMd = text(existing.ArchitectureMd);
    const v = await writeVersion(ctx, {
      itemKey: OBJECTIVE_ITEM_KEY,
      text: objectiveVersionText({ statement, highLevelMd, architectureMd }),
      origin: "person",
      baseVersion: a.baseVersion,
      versions,
      seed: {
        text: objectiveVersionText({ statement: text(existing.Statement), highLevelMd, architectureMd }),
        origin: isEngineWritten(existing) ? "engine" : "person",
      },
      deferPrune: true,
    });
    const upd = deferUpdate(ctx, "Objective", existing, { Statement: statement });
    addChanged(changed, "Objective", upd);
    addChanged(changed, "ItemVersion", v.row);
    ctx.deps.audit({ targetType: "objective", targetId: existing.ItemId, details: { created: false } });
    return { objectiveId: existing.ItemId, version: v.n, changed, removed: removedVersions(v.pruned) };
  },
});
