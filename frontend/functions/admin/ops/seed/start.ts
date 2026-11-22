// seed.start: creates (or repairs) the example workspace and its memberships, or checks an existing target workspace.
// Super admin only. Idempotent by SeedKey lookup + RequestKey; complete-or-repair on retry (the parent is written first).
// A seed must never run twice concurrently.
import { defineOp, f, v } from "../../../_lib";
import type { OpCtx, OpDeps, Row } from "../../../_lib";
import type { ScopedGateway } from "../../../_lib/types";
import { invalidInput } from "../../../_lib/errors";
import type { Validator } from "../../../_lib/validate";
import {
  SCENARIO_PATTERN,
  parseSeedRecord,
  parseSeedRecords,
  resolveRecord,
  seedKeyOf,
  type SeedFieldError,
  type SeedRecord,
} from "../../../../src/domain/seed";
import { requireSuperAdmin } from "./gate";
import { budgetLeft, insertSeeded, recordArg, resolveUsers, rowsBySeedKey, usersArg, type SeedOutcome } from "./resolve";

const str = (x: unknown): string => (typeof x === "string" ? x : "");

type NewTarget = { mode: "new"; workspace: Record<string, unknown>; memberships: Record<string, unknown>[]; workspaceName?: string };
type ExistingTarget = { mode: "existing"; workspaceId: string };
type Target = NewTarget | ExistingTarget;

const newTarget = v.object({
  mode: v.enumOf(["new"] as const),
  workspace: recordArg,
  memberships: v.array(recordArg, { max: 200 }),
  workspaceName: v.optional(v.string({ min: 1, max: 60, trim: true })),
});
const existingTarget = v.object({ mode: v.enumOf(["existing"] as const), workspaceId: v.id() });

const targetArg: Validator<Target> = {
  kind: "mf.validator",
  parse(raw, field) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw invalidInput(field, "type");
    const mode = (raw as Record<string, unknown>).mode;
    if (mode === "new") return newTarget.parse(raw, field) as NewTarget;
    if (mode === "existing") return existingTarget.parse(raw, field);
    throw invalidInput(`${field}.mode`, "enum");
  },
};

const argsSpec = v.object({
  scenario: v.string({ pattern: SCENARIO_PATTERN }),
  version: v.int({ min: 0 }),
  users: usersArg,
  target: targetArg,
});

export interface SeedStartResult {
  workspaceId: string;
  mode: "new" | "existing";
  anchorAt: string;
  workspace: "created" | "existing" | null;
  memberships: { key: string; itemId: string | null; outcome: SeedOutcome }[];
}

function badRecord(deps: OpDeps, schema: string, errors: readonly SeedFieldError[]): never {
  return deps.fail("invalid_input", "seed.record", { schema, field: errors[0].field, rule: errors[0].rule });
}

/** The users, the workspace and its active members in one parallel round. */
function readExisting(svc: ScopedGateway, users: Record<string, string>, workspaceId: string, fail: OpDeps["fail"]) {
  return Promise.all([
    resolveUsers(svc, users, fail),
    svc.get("Workspace", workspaceId, ["ItemId", "Status"]),
    svc.findAll("Membership", { where: f.and(f.eq("WorkspaceId", workspaceId), f.eq("Status", "active")), fields: ["ItemId", "UserId"], max: 5000 }),
  ]);
}

/** The new target's workspace lookup by SeedKey; the same call is made by the prefetch and the handler. */
const workspaceBySeedKey = (svc: ScopedGateway, wsSeedKey: string) => rowsBySeedKey(svc, "Workspace", [wsSeedKey], ["WorkspaceId", "Status", "Name"]);

async function startExisting(ctx: OpCtx, args: { scenario: string; version: number; users: Record<string, string> }, workspaceId: string, deps: OpDeps): Promise<SeedStartResult> {
  const svc = deps.svc!;
  const [users, workspace, members] = await readExisting(svc, args.users, workspaceId, deps.fail);
  if (!workspace) return deps.fail("not_found");
  if (str(workspace.Status) !== "active") return deps.fail("conflict", "seed.workspaceInactive");
  const active = new Set(members.map((m) => str(m.UserId)));
  for (const key of Object.keys(users)) if (!active.has(users[key].userId)) return deps.fail("invalid_input", "seed.userNotMember", { user: key });
  deps.audit({
    action: "seed.started",
    targetType: "workspace",
    targetId: workspaceId,
    details: { scenario: args.scenario, version: args.version, mode: "existing", created: 0, existing: 0, skipped: 0 },
  });
  return { workspaceId, mode: "existing", anchorAt: ctx.now.toISOString(), workspace: null, memberships: [] };
}

async function startNew(ctx: OpCtx, args: { scenario: string; version: number; users: Record<string, string> }, target: NewTarget, deps: OpDeps): Promise<SeedStartResult> {
  const svc = deps.svc!;
  const { scenario } = args;
  const wsRec = parseSeedRecord("Workspace", target.workspace);
  if (!wsRec.ok) return badRecord(deps, "Workspace", wsRec.errors);
  const memRecs = parseSeedRecords("Membership", target.memberships);
  if (!memRecs.ok) return badRecord(deps, "Membership", memRecs.errors);
  const ws: SeedRecord = wsRec.value;
  const name = (target.workspaceName ?? str(ws.fields.Name)).trim();
  if (name.length < 1 || name.length > 60) return deps.fail("invalid_input", "seed.record", { schema: "Workspace", field: "Name", rule: "length" });
  if (Object.keys(ws.refs).length + Object.keys(ws.users).length + Object.keys(ws.at).length > 0) {
    return deps.fail("invalid_input", "seed.record", { schema: "Workspace", field: "$record", rule: "plain" });
  }

  const wsSeedKey = seedKeyOf({ workspaceId: "", scenario, schema: "Workspace", key: ws.key });
  const [users, found0] = await Promise.all([resolveUsers(svc, args.users, deps.fail), workspaceBySeedKey(svc, wsSeedKey)]);
  const existing = found0.get(wsSeedKey);

  // The membership fields, resolved before anything is written.
  const rows: { rec: SeedRecord; row: Row }[] = [];
  for (const rec of memRecs.value) {
    const r = resolveRecord(rec, { refs: {}, users, anchorIso: ctx.now.toISOString() });
    if (!r.ok) {
      if (r.missingUsers.length > 0) return deps.fail("invalid_input", "seed.userUnknown", { user: r.missingUsers[0] });
      return deps.fail("invalid_input", "seed.refMissing", { field: r.missingRefs[0].field, ref: r.missingRefs[0].ref });
    }
    rows.push({ rec, row: r.row });
  }
  const readerIds = [...new Set(rows.filter((r) => r.row.Status === "active").map((r) => str(r.row.UserId)))].filter(Boolean).sort();
  if (!existing && readerIds.length === 0) return deps.fail("invalid_input", "seed.noActiveMembers");

  let workspaceId: string;
  let workspace: "created" | "existing";
  let pointAtSelf: (() => Promise<unknown>) | null = null;
  if (existing) {
    if (str(existing.Status) !== "active") return deps.fail("conflict", "seed.workspaceInactive");
    workspaceId = str(existing.ItemId);
    workspace = "existing";
    if (str(existing.WorkspaceId).startsWith("pending:")) {
      // an interrupted start: finish the update that points the row at its own id (in the same round as the memberships)
      if (!budgetLeft(ctx)) return deps.fail("timeout");
      pointAtSelf = () => svc.update("Workspace", workspaceId, { WorkspaceId: workspaceId, UpdatedByUserId: ctx.caller.userId });
    }
  } else {
    if (!budgetLeft(ctx)) return deps.fail("timeout");
    const made = await insertSeeded({
      schema: "Workspace",
      seedKey: wsSeedKey,
      row: {
        WorkspaceId: `pending:${wsSeedKey}`,
        Name: name,
        Status: "active",
        ReaderIds: readerIds,
        CreatedByUserId: ctx.caller.userId,
        UpdatedByUserId: ctx.caller.userId,
      },
      insert: (row, requestKey) => svc.insert("Workspace", row, { requestKey }),
      reader: svc,
    });
    if (!made.itemId) return deps.fail("conflict", "seed.uniqueConflict", made.params);
    workspaceId = made.itemId;
    workspace = made.outcome === "created" ? "created" : "existing";
    if (!budgetLeft(ctx)) return deps.fail("timeout");
    pointAtSelf = () => svc.update("Workspace", workspaceId, { WorkspaceId: workspaceId, UpdatedByUserId: ctx.caller.userId });
  }

  // A workspace this call just created has no memberships yet, so there is nothing to look up.
  const memKeys = rows.map((r) => seedKeyOf({ workspaceId, scenario, schema: "Membership", key: r.rec.key }));
  const found = workspace === "created" ? new Map<string, Row>() : await rowsBySeedKey(svc, "Membership", memKeys);
  if (rows.some((_, i) => !found.has(memKeys[i])) && !budgetLeft(ctx)) return deps.fail("timeout");
  // The memberships and the update that points the workspace at its own id share one round.
  const [, ...made] = await Promise.all([
    pointAtSelf ? pointAtSelf() : Promise.resolve(),
    ...rows.map(async ({ rec, row }, i): Promise<SeedStartResult["memberships"][number]> => {
      const hit = found.get(memKeys[i]);
      if (hit) return { key: rec.key, itemId: str(hit.ItemId), outcome: "existing" };
      const m = await insertSeeded({
        schema: "Membership",
        seedKey: memKeys[i],
        row,
        insert: (r, requestKey) => deps.gw.insert("Membership", r, { requestKey, acl: { workspaceId, readerIds } }),
        reader: svc,
      });
      return { key: rec.key, itemId: m.itemId, outcome: m.outcome };
    }),
  ]);
  const memberships: SeedStartResult["memberships"] = made;

  // The Workspace, the memberships and anything already in the workspace carry the final reader set. A workspace created
  // here holds only rows written with that set; the restamp repairs a workspace left by an earlier start, after the answer.
  if (workspace === "existing") {
    deps.after(async () => {
      await deps.acl.restamp(workspaceId, { secondPassMs: 250 });
    });
  }

  const count = (o: SeedOutcome): number => memberships.filter((m) => m.outcome === o).length + (o === workspace ? 1 : 0);
  deps.audit({
    action: "seed.started",
    targetType: "workspace",
    targetId: workspaceId,
    details: { scenario, version: args.version, mode: "new", created: count("created"), existing: count("existing"), skipped: count("skipped") },
  });
  return { workspaceId, mode: "new", anchorAt: ctx.now.toISOString(), workspace, memberships };
}

export const seedStart = defineOp({
  op: "seed.start",
  kind: "command",
  scope: "platform",
  permission: "platform.workspaces.manage",
  args: argsSpec,
  // The lookups of the handler's first step start in the router's first round trip (the same reads, answered from the memo).
  prefetch: (p) => {
    const svc = p.svc;
    if (!svc) return undefined;
    const ignore = (() => {
      throw new Error("prefetch");
    }) as never;
    if (p.args.target.mode === "existing") return readExisting(svc, p.args.users, p.args.target.workspaceId, ignore);
    const rec = parseSeedRecord("Workspace", p.args.target.workspace);
    if (!rec.ok) return undefined;
    return Promise.all([resolveUsers(svc, p.args.users, ignore), workspaceBySeedKey(svc, seedKeyOf({ workspaceId: "", scenario: p.args.scenario, schema: "Workspace", key: rec.value.key }))]);
  },
  async handler(ctx, args, deps): Promise<SeedStartResult> {
    const denied = requireSuperAdmin(ctx, deps);
    if (denied) return denied;
    const { target, ...rest } = args;
    return target.mode === "new" ? startNew(ctx, rest, target, deps) : startExisting(ctx, rest, target.workspaceId, deps);
  },
});
