// Goals & requirements: the key workflows, what is not included and the constraints (RequirementExtra rows; rules in
// src/domain/requirementsExtras.ts). Edited while the requirements step is open, with the requirements' permission.
// A project without rows shows its setup answers; the first write of any kind imports them (one row per answer, under
// a RequestKey per project, kind and position, so a retry or a second person's first edit finds the same rows).
import { defineOp, f, v, type OpCtx, type OpDeps, type Row } from "../../../_lib";
import { isRequirementsStepOpen } from "../../../../src/domain/requirements";
import { detailsFromRow } from "../../../../src/domain/setupDetails";
import {
  CONSTRAINT_KINDS, EXTRA_KINDS, EXTRA_LIMITS, EXTRA_SCHEMA, checkExtra, extrasFromSetup, type ExtraInput, type ExtraKind,
} from "../../../../src/domain/requirementsExtras";

export const EXTRA_ROW_FIELDS = [
  "ItemId", "WorkspaceId", "ProjectId", "Kind", "Title", "Who", "Steps", "ConstraintKind", "SortOrder", "Status", "Origin",
  "CreatedByUserId", "UpdatedByUserId",
] as const;
const PROJECT_FIELDS = ["ItemId", "WorkspaceId", "Stage", "Status", "SetupWorkflows", "SetupExclusions", "SetupConstraints"] as const;

const CLIENT_KEY = /^[A-Za-z0-9-]{8,64}$/;
/** A row id, or "setup:<kind>:<n>" for the n-th item of a kind shown from the setup answers. */
const SETUP_ID = /^setup:(workflow|exclusion|constraint):(\d{1,3})$/;

const str = (r: Row | null | undefined, k: string): string => (r && typeof r[k] === "string" ? (r[k] as string) : "");
const num = (r: Row, k: string): number => (typeof r[k] === "number" ? (r[k] as number) : 0);
const active = (r: Row) => str(r, "Status") !== "removed";
const ofKind = (rows: readonly Row[], kind: ExtraKind) => rows.filter((r) => str(r, "Kind") === kind).sort((a, b) => num(a, "SortOrder") - num(b, "SortOrder"));

async function openProject(ctx: OpCtx, deps: OpDeps, projectId: string): Promise<Row> {
  const have = ctx.project && PROJECT_FIELDS.every((k) => k in (ctx.project as Row));
  const row = have ? (ctx.project as Row) : await deps.refs.project(projectId, PROJECT_FIELDS);
  if (str(row, "Status") === "deleting") return deps.fail("not_found");
  if (!isRequirementsStepOpen(str(row, "Stage"))) return deps.fail("conflict", "requirements.closed");
  return row;
}

export function loadExtras(deps: OpDeps, projectId: string): Promise<Row[]> {
  return deps.gw.findAll(EXTRA_SCHEMA, {
    where: f.eq("ProjectId", projectId), fields: [...EXTRA_ROW_FIELDS], sort: { field: "SortOrder", dir: "asc" }, max: 500,
  });
}

/** The row fields of one item (only the ones its kind uses). */
function fieldsOf(e: ExtraInput): Row {
  return {
    Kind: e.kind, Title: e.title, Who: e.kind === "workflow" ? e.who : "", Steps: e.kind === "workflow" ? e.steps : [],
    ConstraintKind: e.kind === "constraint" ? e.constraintKind : "",
  } as Row;
}

/** Writes the setup answers as rows when the project has none yet; answers the rows written (or found again). */
export async function importSetupExtras(deps: OpDeps, project: Row, existing: readonly Row[]): Promise<Row[]> {
  if (existing.length > 0) return [];
  const projectId = str(project, "ItemId");
  const items = extrasFromSetup(detailsFromRow(project as Record<string, unknown>));
  const n: Record<ExtraKind, number> = { workflow: 0, exclusion: 0, constraint: 0 };
  const planned = items.map((e) => {
    n[e.kind] += 1;
    return { e, at: n[e.kind] };
  });
  return Promise.all(planned.map(async ({ e, at }) => {
    const row = await deps.acl.stamp({ ...fieldsOf(e), ProjectId: projectId, SortOrder: at, Status: "active", Origin: "setup" } as Row);
    const res = await deps.gw.insert(EXTRA_SCHEMA, row, { requestKey: `extra-setup:${projectId}:${e.kind}:${at}` });
    return { ...row, ItemId: res.itemId ?? "" } as Row;
  }));
}

/** The row an id names: a row of this project, or the imported row of a "setup:<kind>:<n>" id. */
function rowFor(deps: OpDeps, rows: readonly Row[], id: string): Row {
  const m = SETUP_ID.exec(id);
  if (m) {
    const list = ofKind(rows.filter((r) => str(r, "Origin") === "setup"), m[1] as ExtraKind);
    const row = list[Number(m[2]) - 1];
    return row ?? deps.fail("not_found");
  }
  return rows.find((r) => r.ItemId === id) ?? deps.fail("not_found");
}

const pickRow = (r: Row): Row => Object.fromEntries(EXTRA_ROW_FIELDS.filter((k) => k in r).map((k) => [k, r[k]])) as Row;

const saveExtra = defineOp({
  op: "extra.save",
  kind: "command",
  scope: "project",
  permission: "requirements.edit",
  args: v.object({
    projectId: v.id(),
    id: v.optional(v.string({ min: 1, max: 100 })),
    clientKey: v.optional(v.string({ pattern: CLIENT_KEY })),
    kind: v.enumOf(EXTRA_KINDS),
    title: v.optional(v.string({ max: EXTRA_LIMITS.title * 4 })),
    who: v.optional(v.string({ max: EXTRA_LIMITS.who * 4 })),
    steps: v.optional(v.array(v.string({ max: EXTRA_LIMITS.step * 4 }), { max: EXTRA_LIMITS.steps * 2 })),
    constraintKind: v.optional(v.enumOf(CONSTRAINT_KINDS)),
    restore: v.optional(v.bool()),
  }),
  async handler(ctx: OpCtx, args, deps: OpDeps) {
    const project = await openProject(ctx, deps, args.projectId);
    const existing = await loadExtras(deps, args.projectId);
    const imported = await importSetupExtras(deps, project, existing);
    const rows = [...existing, ...imported];
    const changed: Row[] = [...imported];

    if (args.id) {
      const row = rowFor(deps, rows, args.id);
      if (str(row, "Kind") !== args.kind) return deps.fail("invalid_input", "input.invalid", { field: "kind", reason: "invalid" });
      if (args.restore) {
        if (!active(row)) {
          if (ofKind(rows, args.kind).filter(active).length >= EXTRA_LIMITS.perKind) return deps.fail("limit_reached", "extra.limit", { max: EXTRA_LIMITS.perKind });
          await deps.gw.update(EXTRA_SCHEMA, row.ItemId as string, { Status: "active" });
          deps.audit({ targetType: "requirement-extra", targetId: row.ItemId as string, details: { kind: args.kind, restored: true } });
        }
        const out = { ...row, Status: "active" } as Row;
        return { extra: pickRow(out), changed: { RequirementExtra: [...changed.filter((r) => r.ItemId !== out.ItemId), out].map(pickRow) } };
      }
      if (!active(row)) return deps.fail("not_found", "extra.removed");
      const checked = checkExtra(args);
      if (!checked.ok) return deps.fail("invalid_input", "input.invalid", { field: checked.field, reason: checked.reason });
      const patch = fieldsOf(checked.value);
      delete patch.Kind;
      await deps.gw.update(EXTRA_SCHEMA, row.ItemId as string, patch);
      deps.audit({ targetType: "requirement-extra", targetId: row.ItemId as string, details: { kind: args.kind } });
      const out = { ...row, ...patch, UpdatedByUserId: ctx.caller.userId } as Row;
      return { extra: pickRow(out), changed: { RequirementExtra: [...changed.filter((r) => r.ItemId !== out.ItemId), out].map(pickRow) } };
    }

    // CREATE: one row per clientKey (a double submit finds the first one).
    if (!args.clientKey) return deps.fail("invalid_input", "input.invalid", { field: "clientKey", reason: "required" });
    const checked = checkExtra(args);
    if (!checked.ok) return deps.fail("invalid_input", "input.invalid", { field: checked.field, reason: checked.reason });
    const same = ofKind(rows, args.kind);
    if (same.filter(active).length >= EXTRA_LIMITS.perKind) return deps.fail("limit_reached", "extra.limit", { max: EXTRA_LIMITS.perKind });
    const sortOrder = same.reduce((m, r) => Math.max(m, num(r, "SortOrder")), 0) + 1;
    const row = await deps.acl.stamp({ ...fieldsOf(checked.value), ProjectId: args.projectId, SortOrder: sortOrder, Status: "active", Origin: "person" } as Row);
    const res = await deps.gw.insert(EXTRA_SCHEMA, row, { requestKey: `extra:${args.projectId}:${args.clientKey}` });
    const id = res.itemId ?? "";
    const out = res.created ? ({ ...row, ItemId: id } as Row) : ((await deps.gw.get(EXTRA_SCHEMA, id, [...EXTRA_ROW_FIELDS])) as Row | null) ?? ({ ...row, ItemId: id } as Row);
    if (res.created) deps.audit({ targetType: "requirement-extra", targetId: id, details: { kind: args.kind, created: true } });
    return { extra: pickRow(out), changed: { RequirementExtra: [...changed, out].map(pickRow) } };
  },
});

const removeExtra = defineOp({
  op: "extra.remove",
  kind: "command",
  scope: "project",
  permission: "requirements.edit",
  args: v.object({ projectId: v.id(), id: v.string({ min: 1, max: 100 }) }),
  async handler(ctx: OpCtx, args, deps: OpDeps) {
    const project = await openProject(ctx, deps, args.projectId);
    const existing = await loadExtras(deps, args.projectId);
    const imported = await importSetupExtras(deps, project, existing);
    const rows = [...existing, ...imported];
    const row = rowFor(deps, rows, args.id);
    const out = { ...row, Status: "removed" } as Row;
    if (active(row)) {
      await deps.gw.update(EXTRA_SCHEMA, row.ItemId as string, { Status: "removed" });
      deps.audit({ targetType: "requirement-extra", targetId: row.ItemId as string, details: { kind: str(row, "Kind"), removed: true } });
    }
    return { extra: pickRow(out), changed: { RequirementExtra: [...imported.filter((r) => r.ItemId !== out.ItemId), out].map(pickRow) } };
  },
});

const moveExtra = defineOp({
  op: "extra.move",
  kind: "command",
  scope: "project",
  permission: "requirements.edit",
  args: v.object({ projectId: v.id(), id: v.string({ min: 1, max: 100 }), dir: v.int({ min: -1, max: 1 }) }),
  async handler(ctx: OpCtx, args, deps: OpDeps) {
    const project = await openProject(ctx, deps, args.projectId);
    const existing = await loadExtras(deps, args.projectId);
    const imported = await importSetupExtras(deps, project, existing);
    const rows = [...existing, ...imported];
    const row = rowFor(deps, rows, args.id);
    const list = ofKind(rows, str(row, "Kind") as ExtraKind).filter(active);
    const i = list.findIndex((r) => r.ItemId === row.ItemId);
    const j = i + args.dir;
    if (args.dir === 0 || i < 0 || j < 0 || j >= list.length) return { changed: { RequirementExtra: imported.map(pickRow) } };
    // Positions are renumbered 1..n in the new order, so equal or missing SortOrders can never block a move.
    const order = list.map((r) => r.ItemId as string);
    [order[i], order[j]] = [order[j], order[i]];
    const byId = new Map(list.map((r) => [r.ItemId as string, r]));
    const writes: Row[] = [];
    order.forEach((id, k) => {
      const r = byId.get(id)!;
      if (num(r, "SortOrder") !== k + 1) writes.push({ ...r, SortOrder: k + 1 } as Row);
    });
    await Promise.all(writes.map((r) => deps.gw.update(EXTRA_SCHEMA, r.ItemId as string, { SortOrder: r.SortOrder })));
    deps.audit({ targetType: "requirement-extra", targetId: row.ItemId as string, details: { moved: args.dir } });
    const ids = new Set(writes.map((r) => r.ItemId));
    return { changed: { RequirementExtra: [...imported.filter((r) => !ids.has(r.ItemId)), ...writes].map(pickRow) } };
  },
});

export const REQUIREMENT_EXTRA_OPS = [saveExtra, removeExtra, moveExtra];
