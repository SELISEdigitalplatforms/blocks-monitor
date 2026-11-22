/**
 * The ONLY file of mf-delivery that imports functions/_lib. It binds the narrow DeliveryPorts (ports.ts)
 * to the router's per-request ctx and deps, and wraps every registry entry (index.ts) with _lib's defineOp.
 * The router has already authenticated the caller, checked the account, the membership and the permission,
 * written the Operation record and queued the audit and notification rows; the handlers' own checks run
 * again on top of that (defence in depth), so beginOperation / finishOperation are no-ops here.
 * Rows never carry ItemId (F0); every insert goes through deps.gw with an explicit RequestKey.
 */
import { f, defineOp, OpError } from "../../_lib";
import type { Filter as GwFilter } from "../../_lib/filter";
import { capKey } from "../../_lib/ids";
import type { OpCtx, OpDeps, ScopedGateway } from "../../_lib/types";
import { OpFailure, runOp, type DeliveryOpName } from "./common";
import { deliveryOps } from "./index";
import type { DeliveryPorts, Filter, NotificationKind, OpAnswer, ReadPorts, Row, Scalar } from "./ports";
import { DELIVERY_FIELDS } from "./rows";
import type { RoleDef } from "../../../src/domain/roles";
import type { WorkspacePermission } from "../../../src/domain/rbac";
import type { OpFailureCode } from "../../../src/domain/fnContract";

class DuplicateKeyError extends Error {
  constructor() {
    super("duplicate");
    this.name = "DuplicateKeyError";
  }
}

const str = (x: unknown): string => (typeof x === "string" ? x : "");
const kebab = (s: string): string => s.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();

function fieldsFor(schema: keyof typeof DELIVERY_FIELDS): string[] {
  return ["ItemId", ...Object.keys(DELIVERY_FIELDS[schema])];
}

function toGwFilter(filter: Filter): GwFilter {
  const parts = Object.entries(filter).map(([field, v]) =>
    typeof v === "object" && v !== null ? f.in(field, v.in as readonly (string | number)[]) : f.eq(field, v as Scalar),
  );
  return f.and(...parts);
}

/**
 * The handler's reads. The router's prefetch builds the SAME functions from its own gateway, so an identical
 * later call is answered by the per-request memo and costs no round.
 */
function readPorts(gw: ScopedGateway, project: () => Record<string, unknown> | null): ReadPorts {
  const rowOf = (r: Row | Record<string, unknown>): Row => r as Row;
  return {
    async getById(schema, id) {
      // The router's project row (every Project column; null for an empty one) saves the first round trip.
      const known = project();
      if (schema === "Project" && known && "Stage" in known && (known.ItemId === undefined || known.ItemId === id)) {
        const out: Record<string, unknown> = { ItemId: id };
        for (const [k, v] of Object.entries(known)) if (v !== null && v !== undefined && k !== "ItemId") out[k] = v;
        return rowOf(out);
      }
      const r = await gw.get(schema, id, fieldsFor(schema));
      return r ? rowOf({ ...r, ItemId: id }) : null;
    },
    async query(schema, filter, opts) {
      const where = toGwFilter(filter);
      const fields = opts?.fields ? [...new Set(["ItemId", ...opts.fields])] : fieldsFor(schema);
      const sort = opts?.sort?.[0];
      if (opts?.limit !== undefined) {
        const page = await gw.find(schema, { where, fields, ...(sort ? { sort } : {}), pageSize: Math.min(100, opts.limit) });
        return page.items.map(rowOf);
      }
      return (await gw.findAll(schema, { where, fields, ...(sort ? { sort } : {}), max: 1000 })).map(rowOf);
    },
  };
}

function buildPorts(ctx: OpCtx, deps: OpDeps): DeliveryPorts {
  const { gw } = deps;
  return {
    caller: () => ({ userId: ctx.caller.userId, isSuperAdmin: ctx.caller.isSuperAdmin }),
    account: async () => (ctx.account ? { status: str(ctx.account.Status) } : null),
    after: (work) => deps.after(work),
    flush: () => deps.flush(),
    async routed() {
      // The router's bundle (membership, permissions, member ids) is already in memory for commands.
      const memberIds = await deps.acl.readerIds();
      const m = ctx.membership;
      return {
        permissions: ctx.permissions,
        memberIds,
        me: m
          ? { userId: ctx.caller.userId, roleKey: str(m.RoleKey), displayName: str(ctx.account?.DisplayName) || str(ctx.account?.Email) || str(m.Email) }
          : null,
      };
    },
    async activeMembers(workspaceId) {
      const rows = await gw.findAll("Membership", {
        where: f.and(f.eq("WorkspaceId", workspaceId), f.eq("Status", "active")),
        fields: ["ItemId", "UserId", "RoleKey", "DisplayName", "Email"],
        max: 5000,
      });
      return rows.map((r) => ({
        userId: str(r.UserId),
        roleKey: str(r.RoleKey),
        displayName: str(r.DisplayName) || str(r.Email),
      }));
    },
    async customRoles(workspaceId): Promise<RoleDef[]> {
      const rows = await gw.findAll("WorkspaceRole", {
        where: f.eq("WorkspaceId", workspaceId),
        fields: ["ItemId", "Key", "Name", "Description", "Permissions", "IsBuiltIn"],
        max: 50,
      });
      return rows.map((r) => ({
        key: str(r.Key),
        name: str(r.Name),
        description: str(r.Description),
        permissions: Array.isArray(r.Permissions) ? r.Permissions.filter((p): p is string => typeof p === "string") : [],
        isBuiltIn: r.IsBuiltIn === true,
      }));
    },
    ...readPorts(gw, () => ctx.project),
    async insert(schema, row, opts) {
      const res = await gw.insert(schema, row, { requestKey: capKey(`delivery:${opts.requestKey}`) });
      if (res.itemId === null) throw new DuplicateKeyError(); // a unique-index clash other than RequestKey
      return { itemId: res.itemId, existing: !res.created };
    },
    update: (schema, id, patch) => gw.update(schema, id, patch),
    remove: (schema, id) => gw.remove(schema, id),
    isDuplicateKey: (e) => e instanceof DuplicateKeyError,
    // The router owns the Operation record and the replay.
    beginOperation: async () => null,
    finishOperation: async () => undefined,
    async createEngineJob(job) {
      const { job: row, existing } = await deps.jobs.create({
        kind: job.kind,
        projectId: job.projectId,
        input: job.input,
        eventKey: job.dedupeKey,
        ...(job.target ? { targetType: job.target.type, targetId: job.target.id } : {}),
      });
      return { jobId: str(row.ItemId), existing, status: str(row.Status) || "queued" };
    },
    async notify(n) {
      if (n.audience) {
        deps.notify({
          kind: n.kind as "build.started",
          audience: n.audience,
          projectId: n.projectId,
          params: n.params,
          link: n.link,
          eventKey: n.dedupeKey,
        });
        return;
      }
      // "approval.cancelled" has no stored kind; it is stored as a decision with decision "cancelled".
      const cancelled = (n.kind as NotificationKind) === "approval.cancelled";
      deps.notify({
        kind: cancelled ? "approval.decided" : (n.kind as Exclude<NotificationKind, "approval.cancelled">),
        recipients: [n.recipientUserId as string],
        projectId: n.projectId,
        params: cancelled ? { ...n.params, decision: "cancelled" } : n.params,
        link: n.link,
        eventKey: n.dedupeKey,
      });
    },
    async audit(a) {
      deps.audit({
        action: a.action,
        targetType: kebab(a.targetType),
        targetId: a.targetId,
        details: { ...a.details },
      });
    },
    uuid5: (name) => deps.ids.uuid5(name),
    now: () => ctx.now.toISOString(),
  };
}

function unwrap(answer: OpAnswer, deps: OpDeps): unknown {
  if (answer.ok) return answer.data;
  const { code, messageKey, params } = answer.error;
  return deps.fail(code as OpFailureCode, messageKey, params);
}

function bindOp(name: DeliveryOpName) {
  const def = deliveryOps[name] as unknown as {
    permission: WorkspacePermission | readonly WorkspacePermission[];
    validate(args: unknown): { projectId: string };
    prefetch?(ports: ReadPorts, args: never): unknown;
    record?(data: unknown): boolean;
  };
  return defineOp({
    op: name,
    kind: "command",
    scope: "project",
    permission: def.permission,
    args(raw: unknown) {
      try {
        return def.validate(raw);
      } catch (e) {
        if (e instanceof OpFailure) throw new OpError("invalid_input", e.messageKey, e.params);
        throw e;
      }
    },
    ...(def.record ? { record: (data: unknown) => def.record!(data) } : {}),
    ...(def.prefetch
      ? { prefetch: (p: { args: unknown; gw: ScopedGateway | null }) => (p.gw ? def.prefetch!(readPorts(p.gw, () => null), p.args as never) : undefined) }
      : {}),
    async handler(ctx, args, deps) {
      const ports = buildPorts(ctx, deps);
      const answer = await runOp(ports, { op: name, requestId: ctx.requestId }, deliveryOps[name] as never, args);
      return unwrap(answer, deps);
    },
  });
}

export const deliveryBoundOps = (Object.keys(deliveryOps) as DeliveryOpName[]).map(bindOp);
