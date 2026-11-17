// The one adapter between the tenancy handlers (ports.ts) and the shared library (functions/_lib).
// Handlers keep their small port interface; this file maps ports onto the router's ctx and deps.
// Plain functions only; nothing is kept between calls (warm sandboxes are shared).
import { OpError, defineOp, f, type Kind, type OpCtx as LibCtx, type OpDeps as LibDeps, type OpDef, type Row } from "../../../_lib";
import type { Filter as LibFilter } from "../../../_lib/filter";
import {
  DuplicateError,
  type Filter,
  type FilterValue,
  type Gateway,
  type IamAdmin,
  type ListQuery,
  type OpAnswer,
  type OpDeps,
  type OpHandler,
  type OpPrefetch,
} from "./ports";

type Universe = readonly (readonly [field: string, values: readonly (string | boolean)[]])[];

/** The library's filter builder has no "all rows" filter, so an empty filter is spelled as a union per schema. */
const ALL_ROWS: Readonly<Record<string, Universe>> = {
  Account: [["Status", ["active", "deactivated"]]],
  Workspace: [["Status", ["active", "suspended", "archived"]]],
  Membership: [["Status", ["pending-account", "invited", "active", "suspended", "removed"]]],
  PlatformRole: [["IsBuiltIn", [true]], ["IsBuiltIn", [false]]],
  PlatformRoleAssignment: [["Status", ["active", "revoked"]]],
  AuditEvent: [["Impersonated", [true]], ["Impersonated", [false]]],
  PlatformSetting: [["Key", ["allowed-email-domains", "allowed-email-exceptions"]]],
  Plan: [["Active", [true]], ["Active", [false]]],
  Coupon: [["Active", [true]], ["Active", [false]]],
  Subscription: [["Status", ["active", "pending", "cancelled", "past_due"]]],
  Payment: [["Status", ["open", "paid", "failed", "expired", "cancelled", "refunded"]]],
  PurchaseRequest: [["Status", ["pending", "approved", "declined"]]],
  CreditEntry: [["Kind", ["signup", "plan", "coupon", "purchase", "usage", "adjustment"]]],
};

const NE_VALUES: Readonly<Record<string, readonly string[]>> = {
  Status: ["pending-account", "invited", "active", "suspended", "removed"],
};

const MAX_IN = 500;
const isRange = (v: FilterValue): v is { gte?: string; lte?: string } =>
  typeof v === "object" && v !== null && ("gte" in v || "lte" in v);

interface Plan {
  /** Alternatives that are OR-ed; each is a list of library filters AND-ed. */
  alternatives: LibFilter[];
  empty: boolean;
}

function planFilter(schema: string, filter: Filter): Plan {
  const parts: LibFilter[] = [];
  let empty = false;
  let chunked: { field: string; chunks: (string | number)[][] } | null = null;
  for (const [field, value] of Object.entries(filter)) {
    if (typeof value === "object" && value !== null) {
      if ("in" in value) {
        const list = [...value.in] as (string | number)[];
        if (list.length === 0) empty = true;
        else if (list.length <= MAX_IN) parts.push(f.in(field, list as (string | number)[]));
        else if (!chunked) {
          chunked = { field, chunks: [] };
          for (let i = 0; i < list.length; i += MAX_IN) chunked.chunks.push(list.slice(i, i + MAX_IN));
        } else throw new OpError("internal");
      } else if ("ne" in value) {
        const universe = NE_VALUES[field];
        if (!universe) throw new OpError("internal");
        parts.push(f.in(field, universe.filter((x) => x !== String(value.ne))));
      } else if (isRange(value)) {
        if (value.gte || value.lte) parts.push(f.range(field, { ...(value.gte ? { gte: value.gte } : {}), ...(value.lte ? { lte: value.lte } : {}) }));
      }
    } else {
      parts.push(f.eq(field, value as string | number | boolean));
    }
  }
  const base: LibFilter[][] = [parts];
  if (chunked) {
    const c = chunked;
    return {
      alternatives: c.chunks.map((chunk) => f.and(...parts, f.in(c.field, chunk))),
      empty,
    };
  }
  if (parts.length === 0) {
    const universe = ALL_ROWS[schema];
    if (!universe) throw new OpError("internal");
    return {
      alternatives: universe.map(([field, values]) =>
        values.length === 1 ? f.eq(field, values[0]) : f.in(field, values as readonly string[]),
      ),
      empty,
    };
  }
  return { alternatives: base.map((p) => f.and(...p)), empty };
}

function sortRows(rows: Row[], sort: ListQuery["sort"]): Row[] {
  if (!sort) return rows;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => (String(a[sort.field] ?? "") < String(b[sort.field] ?? "") ? -dir : String(a[sort.field] ?? "") > String(b[sort.field] ?? "") ? dir : 0));
}

function gatewayOf(deps: Pick<LibDeps, "svc" | "audit" | "notify" | "guard">, emails: Readonly<Record<string, string>> = {}): Gateway {
  const svc = deps.svc;
  const need = () => {
    if (!svc) throw new OpError("internal");
    return svc;
  };

  async function batchesOf(schema: string, plan: Plan, q: { fields: readonly string[]; sort?: ListQuery["sort"] }, max: number): Promise<Row[][]> {
    return Promise.all(
      plan.alternatives.map((where) =>
        need().findAll(schema, { where, fields: [...q.fields], ...(q.sort ? { sort: q.sort } : {}), max }),
      ),
    );
  }

  async function everything(schema: string, q: { filter: Filter; fields: readonly string[]; sort?: ListQuery["sort"]; maxItems?: number }): Promise<Row[]> {
    const plan = planFilter(schema, q.filter);
    if (plan.empty) return [];
    const batches = await batchesOf(schema, plan, q, q.maxItems ?? 1000);
    const out = batches.flat();
    return plan.alternatives.length > 1 ? sortRows(out, q.sort) : out;
  }

  return {
    async list<T>(schema: string, q: ListQuery) {
      const plan = planFilter(schema, q.filter);
      if (plan.empty) return { items: [] as T[], totalCount: 0 };
      const page = q.page ?? 1;
      const size = Math.min(q.pageSize ?? 100, 100);
      if (plan.alternatives.length === 1) {
        const res = await need().find(schema, {
          where: plan.alternatives[0],
          fields: [...q.fields],
          ...(q.sort ? { sort: q.sort } : {}),
          page,
          pageSize: size,
        });
        return { items: res.items as T[], totalCount: res.totalCount ?? res.items.length };
      }
      // Several alternatives are merged in memory: refuse (never a short totalCount) when one holds more than the cap.
      const cap = 1000;
      const batches = await batchesOf(schema, plan, q, cap + 1);
      if (batches.some((rows) => rows.length > cap)) throw new OpError("limit_reached", "fn.tooManyRows", { schema });
      const all = sortRows(batches.flat(), q.sort);
      return { items: all.slice((page - 1) * size, page * size) as T[], totalCount: all.length };
    },
    async listAll<T>(schema: string, q: { filter: Filter; fields: readonly string[]; sort?: ListQuery["sort"]; maxItems?: number }) {
      return (await everything(schema, q)) as T[];
    },
    async insertOnce<T>(schema: string, row: Record<string, unknown>, onceKey: string) {
      // Audit and notification rows are written by the router after the handler (deps.audit / deps.notify).
      if (schema === "AuditEvent") {
        // A key that is not core.audit's per-request key is a guard: inserted now, so a duplicate is seen at call time.
        if (deps.guard && !onceKey.startsWith("audit:")) {
          const g = await deps.guard(
            {
              action: String(row.Action),
              targetType: String(row.TargetType),
              targetId: String(row.TargetId),
              details: JSON.parse(String(row.DetailsJson ?? "{}")) as Record<string, unknown>,
            },
            onceKey,
          );
          return { item: { ...row, ...g.row, ItemId: String(g.row.ItemId ?? onceKey) } as T & { ItemId: string }, created: g.created };
        }
        deps.audit({
          action: String(row.Action),
          targetType: String(row.TargetType),
          targetId: String(row.TargetId),
          details: JSON.parse(String(row.DetailsJson ?? "{}")) as Record<string, unknown>,
        });
        return { item: { ...row, ItemId: onceKey } as T & { ItemId: string }, created: true };
      }
      if (schema === "Notification") {
        const params = JSON.parse(String(row.ParamsJson ?? "{}")) as Record<string, unknown>;
        deps.notify({
          kind: row.Kind as never,
          recipients: [String(row.RecipientUserId)],
          params,
          ...(typeof row.Link === "string" && row.Link ? { link: row.Link } : {}),
          eventKey: String(row.EventKey),
          ...(Object.keys(emails).length ? { emails } : {}),
          ...(typeof row.ProjectId === "string" && row.ProjectId ? { projectId: row.ProjectId } : {}),
        });
        return { item: { ...row, ItemId: onceKey } as T & { ItemId: string }, created: true };
      }
      const res = await need().insert(schema, { ...row }, { requestKey: onceKey });
      if (res.created) {
        if (!res.itemId) throw new OpError("internal");
        return { item: { ...row, ItemId: res.itemId } as T & { ItemId: string }, created: true };
      }
      // Not created: the same key already wrote this row, or another unique index refused it.
      if (!res.itemId) throw new DuplicateError();
      const fields = [...new Set(["ItemId", ...Object.keys(row)])];
      const back = await need().get(schema, res.itemId, fields);
      if (!back) throw new DuplicateError();
      return { item: back as T & { ItemId: string }, created: false };
    },
    async update(schema, itemId, set) {
      await need().update(schema, itemId, set);
    },
    async updateMany(schema, filter, set) {
      const plan = planFilter(schema, filter);
      if (plan.empty) return 0;
      const counts = await Promise.all(plan.alternatives.map(async (where) => (await need().updateMany(schema, where, set)).matched ?? 0));
      return counts.reduce((n, c) => n + c, 0);
    },
    async remove(schema, itemId) {
      await need().remove(schema, itemId);
    },
  };
}

function depsOf(ctx: LibCtx, deps: LibDeps): OpDeps {
  // Per request: addresses the handler hands over for the notifications it queues.
  const emails: Record<string, string> = {};
  return {
    gateway: gatewayOf(deps, emails),
    knownEmails: (known) => void Object.assign(emails, known),
    acl: {
      async restamp(workspaceId, readerIds) {
        // The handler worked the reader list out; every ACL schema is written in one parallel round. The handler
        // schedules its own check (restampWorkspace -> deps.after), which also knows the deactivated accounts.
        const report = await deps.acl.restamp(workspaceId, { readers: readerIds });
        return {
          schemas: report.schemas.map((s) => s.schema),
          rows: report.schemas.reduce((n, s) => n + (s.matched ?? 0), 0),
        };
      },
    },
    clock: {
      now: () => ctx.now.toISOString(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.min(ms, ctx.remainingMs() - 5000)))),
    },
    access: { platformHolders: (permission) => deps.access.platformHolders(permission, { max: 50 }) },
    after: (work) => deps.after(work),
    flush: () => deps.flush(),
    iam: (deps as unknown as { callerIam?: IamAdmin | null }).callerIam ?? null,
    iamDirectory: deps.iamAdmin ?? null,
    identitySource: ctx.caller.identitySource,
    ...(deps.rbac ? { rbac: deps.rbac } : {}),
    utilities: deps.utilities ?? null,
  };
}

export interface BindSpec {
  op: string;
  kind: Kind;
  allowInactiveAccount?: boolean;
  /** false skips the Operation record for this answer. */
  record?: (data: unknown) => boolean;
  /** Reads started in round trip 1 of the router; the handler's identical later read is then answered from the memo. */
  prefetch?: OpPrefetch;
  handler: OpHandler;
}

function unwrap<T>(answer: OpAnswer<T>): T {
  if (answer.ok) return answer.data;
  throw new OpError(answer.error.code as ConstructorParameters<typeof OpError>[0], answer.error.messageKey, answer.error.params);
}

/** Wraps one tenancy handler as a library op. Every op checks its own permission, so scope is "self". */
export function bindOp(spec: BindSpec): OpDef {
  const extra: Record<string, unknown> = {};
  if (spec.prefetch) {
    const prefetch = spec.prefetch;
    extra.prefetch = (p: { args: unknown; svc: LibDeps["svc"]; callerUserId: string }) =>
      prefetch({ gateway: gatewayOf({ svc: p.svc, audit: () => undefined, notify: () => undefined }), userId: p.callerUserId }, p.args);
  }
  return defineOp({
    ...extra,
    op: spec.op,
    kind: spec.kind,
    scope: "self",
    early: true,
    ...(spec.record ? { record: spec.record } : {}),
    ...(spec.allowInactiveAccount ? { allowInactiveAccount: true } : {}),
    args: (raw: unknown) => raw,
    async handler(ctx, args, deps) {
      const caller = ctx.caller;
      const answer = await spec.handler(
        {
          context: {
            isAuthenticated: true,
            userId: caller.userId,
            email: caller.email,
            displayName: caller.displayName,
            roles: caller.roles,
            impersonated: caller.impersonated,
          },
          requestId: ctx.requestId,
          op: ctx.op,
        },
        args,
        depsOf(ctx, deps),
      );
      return unwrap(answer);
    },
  });
}
