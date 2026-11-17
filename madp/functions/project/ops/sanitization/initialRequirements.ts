/**
 * initialRequirements.save: the Requirements v1 editor's single write (design 12.2 step 2).
 * Idempotency: a new row carries the browser's clientKey as Requirement.Key, so a retry or a
 * double click finds the row again instead of creating a second one.
 */
import { parseInitialRequirementsInput, PROJECT_LIMITS } from "../../../../src/domain/sanitization";
import type { OpContext, OpResult, OpTable, ReadEnv, Row } from "./ports";
import { fail, fromCheck, gate, insertNumbered, ok, requirePermission, versionCheck, withReads } from "./common";

/** The reads of the save (shared with its prefetch). Whole rows: an update answers from the row it read, with no read-back. */
function readSet(env: Pick<ReadEnv, "gateway" | "project">, removeIds: readonly string[] = []) {
  const projectId = env.project.ItemId;
  return Promise.all([
    env.gateway.list("Objective", { ProjectId: projectId }, { first: 1 }),
    env.gateway.list("Requirement", { ProjectId: projectId }, { max: PROJECT_LIMITS.requirements + 1 }),
    // The existence check remove() makes: read here, so the removals below cost no round of their own.
    ...removeIds.map((id) => env.gateway.verify("Requirement", id)),
  ]).then(([objectives, existing]) => [objectives, existing] as [Row[], Row[]]);
}

function removeIdsOf(input: { remove?: readonly string[] }): string[] {
  return [...new Set<string>(input.remove ?? [])].filter((id) => id !== "");
}

interface Conflict {
  kind: "requirement" | "objective";
  id: string;
  clientKey?: string;
}

async function save(args: Record<string, unknown>, ctx: OpContext): Promise<OpResult> {
  const refused = gate(ctx, "current") ?? requirePermission(ctx, "sanitization.edit");
  if (refused) return refused;

  const parsed = parseInitialRequirementsInput(args);
  if (!parsed.ok) return fromCheck(parsed);
  const input = parsed.value;
  const projectId = ctx.project.ItemId;

  const [objectives, existing] = await readSet(ctx, removeIdsOf(input));

  const byId = new Map<string, Row>(existing.map((r) => [r.ItemId as string, r]));
  const byKey = new Map<string, Row>(existing.filter((r) => r.Key).map((r) => [r.Key as string, r]));

  const remove: string[] = [...new Set<string>(input.remove ?? [])];
  const upsert = input.upsert ?? [];
  for (const id of [...remove, ...upsert.map((u) => u.id).filter((x) => x !== "")]) {
    if (!byId.has(id)) return fail("invalid_input", "sanitization.badReference", { field: "id" });
  }

  // Resolve each upsert to an existing row (by id, or by a clientKey that already exists) or a new one.
  const removeSet = new Set(remove);
  const updates: { target: Row; item: (typeof upsert)[number] }[] = [];
  const creates = new Map<string, (typeof upsert)[number]>();
  for (const item of upsert) {
    if (item.id !== "") {
      if (!removeSet.has(item.id)) updates.push({ target: byId.get(item.id)!, item });
    } else if (item.clientKey !== "") {
      const found = byKey.get(item.clientKey);
      if (found) {
        if (!removeSet.has(found.ItemId as string)) updates.push({ target: found, item });
      } else {
        creates.set(item.clientKey, item);
      }
    } else {
      return fail("invalid_input", "sanitization.badReference", { field: "clientKey" });
    }
  }
  if (existing.length - remove.length + creates.size > PROJECT_LIMITS.requirements) {
    return fail("limit_reached", "sanitization.limit", { kind: "requirements", max: PROJECT_LIMITS.requirements });
  }

  const conflicts: Conflict[] = [];
  const objective0: Row | null = objectives[0] ?? null;

  // Objective: one row per project.
  const writeObjective = async (): Promise<Row | null> => {
    if (!input.objective) return objective0;
    const o = input.objective;
    const patch: Record<string, unknown> = {};
    if (o.statement !== undefined) patch.Statement = o.statement;
    if (o.highLevelMd !== undefined) patch.HighLevelMd = o.highLevelMd;
    if (o.architectureMd !== undefined) patch.ArchitectureMd = o.architectureMd;
    if (objective0) {
      const seen = versionCheck(objective0, o.expectedUpdatedAt, ctx.userId, { values: patch });
      if (seen === "stale") {
        conflicts.push({ kind: "objective", id: objective0.ItemId as string });
        return objective0;
      }
      if (seen === "own") return objective0;
      if (Object.keys(patch).length > 0) return ctx.gateway.update("Objective", objective0.ItemId as string, patch);
      return objective0;
    }
    const fields = { Statement: "", HighLevelMd: "", ArchitectureMd: "", AcceptanceCriteria: [], ...patch, ProjectId: projectId, Status: "draft" };
    try {
      return (await ctx.gateway.insert("Objective", fields, "objective")).row;
    } catch (e) {
      if (!ctx.gateway.isDuplicateKey(e)) throw e;
      const again = await ctx.gateway.list("Objective", { ProjectId: projectId }, { first: 1 });
      if (again[0] && Object.keys(patch).length > 0) {
        return ctx.gateway.update("Objective", again[0].ItemId as string, patch);
      }
      return again[0] ?? null;
    }
  };

  // Updates of existing rows.
  const writeUpdate = async ({ target, item }: (typeof updates)[number]): Promise<Row | null> => {
    const values = {
      Title: item.title,
      Text: item.text,
      Priority: item.priority,
      AcceptanceCriteria: item.acceptanceCriteria,
      SortOrder: item.sortOrder,
    };
    const seen = versionCheck(target, item.expectedUpdatedAt, ctx.userId, { values });
    if (seen === "stale") {
      conflicts.push({ kind: "requirement", id: target.ItemId as string, clientKey: item.clientKey || undefined });
      return null;
    }
    if (seen === "own") return target;
    return ctx.gateway.update("Requirement", target.ItemId as string, values);
  };

  // Creates take the next R-n each: the numbers are handed out from the rows already read, so every create runs at once.
  let top = 0;
  for (const r of existing) if (typeof r.Number === "number" && r.Number > top) top = r.Number;
  const writeCreate = async ([clientKey, item]: [string, (typeof upsert)[number]], i: number): Promise<Row> =>
    (
      await insertNumbered(
        ctx,
        "Requirement",
        {
          ProjectId: projectId,
          Key: clientKey,
          Title: item.title,
          Text: item.text,
          Priority: item.priority,
          AcceptanceCriteria: item.acceptanceCriteria,
          SortOrder: item.sortOrder,
          Status: "draft",
        },
        "requirement:" + clientKey,
        {
          knownMax: top + i,
          onDuplicate: async () =>
            (await ctx.gateway.list("Requirement", { ProjectId: projectId, Key: clientKey }, { first: 1 }))[0] ?? null,
        },
      )
    ).row;

  // Removes: one call per id. Everything above is idempotent by clientKey, so one batch is safe to retry.
  // The removals are issued first: their existence check is answered by the memo before the other writes drop it.
  const [, objective, updated, created] = await Promise.all([
    Promise.all(remove.map((id) => ctx.gateway.remove("Requirement", id))),
    writeObjective(),
    Promise.all(updates.map(writeUpdate)),
    Promise.all([...creates].map(writeCreate)),
  ]);
  const requirements: Row[] = [...updated.filter((r): r is Row => r !== null), ...created];

  ctx.audit({
    action: "initialRequirements.save",
    targetType: "requirement",
    targetId: String(requirements[0]?.ItemId ?? remove[0] ?? objective?.ItemId ?? projectId),
    details: {
      created: created.length,
      updated: updated.filter((r) => r !== null).length,
      removed: remove.length,
      conflicts: conflicts.length,
      objective: input.objective ? Object.keys(input.objective).filter((k) => k !== "expectedUpdatedAt") : [],
    },
  });
  return ok({ objective, requirements, removed: remove, conflicts });
}

export const INITIAL_REQUIREMENTS_OPS: OpTable = {
  "initialRequirements.save": withReads(save, {
    prefetch: (env, args) => {
      const parsed = parseInitialRequirementsInput(args);
      return parsed.ok ? readSet(env, removeIdsOf(parsed.value)) : null;
    },
  }),
};
