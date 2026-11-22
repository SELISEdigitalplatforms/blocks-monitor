// seed.apply: inserts the missing rows of ONE schema of a scenario into a workspace, in chunks the script repeats.
// Super admin only. Idempotent: every row is looked up by SeedKey first and a found row is reused, never updated;
// RequestKey (unique) catches a racing duplicate. A seed must never run twice concurrently.
import { defineOp, v } from "../../../_lib";
import type { OpCtx, OpDeps, Row } from "../../../_lib";
import {
  SCENARIO_PATTERN,
  SEED_LIMITS,
  anchorAllowed,
  parseSeedRecords,
  refTargets,
  resolveRecord,
  seedKeyOf,
  seedSchema,
  userKeysOf,
  type SeedRecord,
} from "../../../../src/domain/seed";
import { requireSuperAdmin } from "./gate";
import { budgetLeft, insertSeeded, recordArg, resolveUsers, rowsBySeedKey, usersArg, type SeedOutcome } from "./resolve";

const str = (x: unknown): string => (typeof x === "string" ? x : "");

const argsSpec = v.object({
  workspaceId: v.id(),
  scenario: v.string({ pattern: SCENARIO_PATTERN }),
  version: v.int({ min: 0 }),
  anchorAt: v.dateTime(),
  users: usersArg,
  schema: v.string({ max: 64 }),
  records: v.array(recordArg, { min: 1, max: SEED_LIMITS.recordsPerCall }),
});

export interface SeedApplyResult {
  schema: string;
  done: boolean;
  created: number;
  existing: number;
  skipped: { key: string; messageKey: string; params: Record<string, unknown> }[];
  items: { key: string; itemId: string | null; outcome: SeedOutcome }[];
  remainingKeys: string[];
}

/** The SeedKeys to look up per schema: this call's records and every row they refer to. */
function wantedKeys(args: { workspaceId: string; scenario: string; schema: string }, records: readonly SeedRecord[]): Map<string, Set<string>> {
  const { workspaceId, scenario } = args;
  const seedKey = (schema: string, key: string): string => seedKeyOf({ workspaceId, scenario, schema, key });
  const wanted = new Map<string, Set<string>>([[args.schema, new Set(records.map((r) => seedKey(args.schema, r.key)))]]);
  for (const rec of records) {
    for (const t of refTargets(rec)) {
      if (!wanted.has(t.schema)) wanted.set(t.schema, new Set());
      wanted.get(t.schema)!.add(seedKey(t.schema, t.key));
    }
  }
  return wanted;
}

export const seedApply = defineOp({
  op: "seed.apply",
  kind: "command",
  scope: "workspace",
  permission: "workspace.manage",
  platformOverride: "platform.workspaces.manage",
  args: argsSpec,
  // The handler's lookups start in the router's first round trip (the same reads, so the memo answers them later).
  prefetch: (p) => {
    const parsed = parseSeedRecords(p.args.schema, p.args.records);
    if (!p.gw || !parsed.ok) return undefined;
    const gw = p.gw;
    return Promise.all([
      resolveUsers(gw, p.args.users, (() => {
        throw new Error("prefetch");
      }) as never),
      ...[...wantedKeys(p.args, parsed.value)].map(([schema, keys]) => rowsBySeedKey(gw, schema, [...keys])),
    ]);
  },
  async handler(ctx: OpCtx, args, deps: OpDeps): Promise<SeedApplyResult> {
    const denied = requireSuperAdmin(ctx, deps);
    if (denied) return denied;
    const { workspaceId, scenario } = args;
    const seedKey = (schema: string, key: string): string => seedKeyOf({ workspaceId, scenario, schema, key });

    // Validation, before any I/O.
    if (!anchorAllowed(args.anchorAt, ctx.now.toISOString())) return deps.fail("invalid_input", "seed.anchor");
    const def = seedSchema(args.schema);
    if (!def || def.startOnly) return deps.fail("invalid_input", "seed.schema");
    const parsed = parseSeedRecords(args.schema, args.records);
    if (!parsed.ok) {
      return deps.fail("invalid_input", "seed.record", { schema: args.schema, field: parsed.errors[0].field, rule: parsed.errors[0].rule });
    }
    const records: SeedRecord[] = parsed.value;
    const inCall = new Set(records.map((r) => r.key));
    for (const rec of records) {
      for (const user of userKeysOf(rec)) if (!(user in args.users)) return deps.fail("invalid_input", "seed.userUnknown", { user });
    }

    // One parallel read round: the users, the rows of this schema and every $ref target, by SeedKey.
    const wanted = wantedKeys(args, records);
    const [users, ...reads] = await Promise.all([
      resolveUsers(deps.gw, args.users, deps.fail),
      ...[...wanted].map(([schema, keys]) => rowsBySeedKey(deps.gw, schema, [...keys])),
    ]);
    const found = new Map([...wanted.keys()].map((schema, i) => [schema, reads[i] as Map<string, Row>] as const));
    const rowOf = (schema: string, key: string): Row | undefined => found.get(schema)?.get(seedKey(schema, key));

    // Every $ref target must exist (or be a record of this call, inserted first); a Workspace ref is this workspace.
    const refs: Record<string, string> = {};
    for (const rec of records) {
      for (const t of refTargets(rec)) {
        const token = `${t.schema}:${t.key}`;
        const hit = rowOf(t.schema, t.key);
        const own = t.schema === args.schema && inCall.has(t.key) && t.key !== rec.key;
        if (hit && (t.schema !== "Workspace" || str(hit.ItemId) === workspaceId)) refs[token] = str(hit.ItemId);
        else if (!own) return deps.fail("invalid_input", "seed.refMissing", { field: t.field, ref: token });
      }
    }

    const items = new Map<string, { key: string; itemId: string | null; outcome: SeedOutcome }>();
    const skipped: SeedApplyResult["skipped"] = [];
    let pending: SeedRecord[] = [];
    for (const rec of records) {
      const hit = rowOf(args.schema, rec.key);
      if (hit) items.set(rec.key, { key: rec.key, itemId: str(hit.ItemId), outcome: "existing" });
      else pending.push(rec);
    }

    // Insert the missing rows in waves: a row waits until the in-call rows it refers to have an id.
    let stopped = false;
    while (pending.length > 0 && !stopped) {
      const ready = pending.filter((rec) => refTargets(rec).every((t) => `${t.schema}:${t.key}` in refs));
      if (ready.length === 0) {
        // what is left refers to a row of this call that was skipped: it is skipped too, never claimed
        for (const rec of pending) {
          items.set(rec.key, { key: rec.key, itemId: null, outcome: "skipped" });
          skipped.push({ key: rec.key, messageKey: "seed.refSkipped", params: {} });
        }
        pending = [];
        break;
      }
      for (let i = 0; i < ready.length; i += SEED_LIMITS.insertConcurrency) {
        if (!budgetLeft(ctx)) {
          stopped = true;
          break;
        }
        const batch = ready.slice(i, i + SEED_LIMITS.insertConcurrency);
        const made = await Promise.all(
          batch.map(async (rec) => {
            const r = resolveRecord(rec, { refs, users, anchorIso: args.anchorAt });
            if (!r.ok) {
              if (r.missingUsers.length > 0) return deps.fail("invalid_input", "seed.userUnknown", { user: r.missingUsers[0] });
              return deps.fail("invalid_input", "seed.refMissing", { field: r.missingRefs[0].field, ref: r.missingRefs[0].ref });
            }
            return insertSeeded({
              schema: args.schema,
              seedKey: seedKey(args.schema, rec.key),
              row: r.row,
              insert: (row, requestKey) => deps.gw.insert(args.schema, row, { requestKey }),
              reader: deps.gw,
            });
          }),
        );
        batch.forEach((rec, j) => {
          const m = made[j];
          items.set(rec.key, { key: rec.key, itemId: m.itemId, outcome: m.outcome });
          if (m.outcome === "skipped") skipped.push({ key: rec.key, messageKey: m.messageKey ?? "seed.uniqueConflict", params: m.params ?? {} });
          else refs[`${args.schema}:${rec.key}`] = m.itemId ?? "";
        });
        for (const rec of batch) pending = pending.filter((p) => p.key !== rec.key);
      }
    }
    // Rows found by SeedKey are targets for later rows of this call too.
    const remainingKeys = records.filter((r) => !items.has(r.key)).map((r) => r.key);
    const list = records.filter((r) => items.has(r.key)).map((r) => items.get(r.key)!);
    const count = (o: SeedOutcome): number => list.filter((i) => i.outcome === o).length;

    deps.audit({
      action: "seed.applied",
      targetType: "workspace",
      targetId: workspaceId,
      details: { scenario, schema: args.schema, created: count("created"), existing: count("existing"), skipped: count("skipped") },
    });
    return { schema: args.schema, done: remainingKeys.length === 0, created: count("created"), existing: count("existing"), skipped, items: list, remainingKeys };
  },
});
