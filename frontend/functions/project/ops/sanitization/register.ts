/**
 * Registration of the Product sanitization ops with the real library (functions/_lib). Every handler of
 * SANITIZATION_OPS becomes a defineOp() op of scope "project"; the router has already run the caller guard, the
 * Account check, Operation replay, the project -> workspace check and the permission load. This file is the
 * only place that adapts the lane's ports (./ports) to the library's OpCtx and OpDeps.
 */
import { defineOp, f, issuedStamp } from "../../../_lib";
import type { OpCtx, OpDeps, PrefetchInput, Row as LibRow, ScopedGateway } from "../../../_lib/types";
import { fail, OpFailure } from "./common";
import { SANITIZATION_OPS } from "./index";
import type { Filter, Gateway, ListOptions, OpContext, OpResult, ReadEnv, Row } from "./ports";

const SYSTEM_FIELDS = ["ItemId", "CreatedDate", "LastUpdatedDate"];

/** The S1 field names of the schemas this lane reads (blocks/data/schemas; test/sanitization-fields.test.ts keeps it in sync). */
export const SANITIZATION_SCHEMA_FIELDS: Readonly<Record<string, readonly string[]>> = {
  Clarification: ["WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Number", "Question", "Options", "Answer", "Status", "OwnerUserId", "SourceType", "SourceRef", "DeferReason", "AnsweredByUserId", "AnsweredAt", "SortOrder", "RequestKey", "SeedKey"],
  Decision: ["WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Number", "Title", "Statement", "Rationale", "ClarificationId", "Status", "SourceRef", "DecidedByUserId", "DecidedAt", "SupersededById", "RequestKey", "SeedKey"],
  DocFile: ["WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "FolderId", "Name", "StoredName", "Mime", "SizeBytes", "StorageObjectId", "Kind", "SortOrder", "Status", "RequestKey"],
  DocFolder: ["WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "ParentId", "Name", "Kind", "SortOrder", "Status", "RequestKey", "SeedKey"],
  DocNote: ["WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "FolderId", "Title", "BodyMd", "SortOrder", "IsScratchPad", "RequestKey", "SeedKey"],
  EngineJob: ["WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Kind", "Status", "ActiveKey", "TargetType", "TargetId", "InputJson", "OutputRefs", "Progress", "Message", "Attempts", "ClaimedBy", "ClaimedAt", "StartedAt", "FinishedAt", "ErrorCode", "RequestedByUserId", "RequestKey"],
  FeedbackComment: ["WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "ThreadId", "AuthorUserId", "Kind", "Text", "AttachmentIds", "At", "RequestKey"],
  FeedbackThread: ["WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "TargetType", "TargetId", "Status", "RequestKey"],
  ItemVersion: ["WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "ItemKey", "N", "Text", "CommentIds", "Origin", "RequestKey"],
  Membership: ["WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "UserId", "Email", "DisplayName", "RoleKey", "Status", "InvitedByUserId", "InvitedAt", "JoinedAt", "SuspendedAt", "RemovedAt", "RequestKey", "SeedKey"],
  Objective: ["WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Statement", "AcceptanceCriteria", "HighLevelMd", "ArchitectureMd", "SpecVersion", "Status", "ConfirmedByUserId", "ConfirmedAt", "RequestKey", "SeedKey"],
  Project: ["WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "Name", "ClientName", "ClientContact", "ClientIndustry", "ClientRegion", "Status", "BusinessHandedOverByUserId", "Brief", "NameSuggested", "Stage", "ResumeTo", "CurrentScopeVersion", "AssigneeUserId", "BusinessHandedOverAt", "SanitizationCompletedAt", "RequirementsConfirmedAt", "ScopeLockedAt", "RepoProvider", "RepoOwner", "RepoName", "RepoMode", "RepoVisibility", "RepoBranch", "RepoExisting", "RepoNameEdited", "IsExample", "SeedKey", "Rev", "RequestKey"],
  Requirement: ["WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Number", "Key", "Title", "Text", "Category", "Priority", "Status", "AcceptanceCriteria", "SourceRefs", "SpecVersion", "SortOrder", "RequestKey", "SeedKey"],
  TechDecision: ["WorkspaceId", "ReaderIds", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Number", "Area", "Title", "Choice", "Rationale", "Alternatives", "NfrCategory", "NfrTarget", "IntegrationSystem", "ExpertUserIds", "Status", "DecidedByUserId", "DecidedAt", "RequestKey", "SeedKey"],
};

const FIELDS: Record<string, string[]> = {};
for (const [name, list] of Object.entries(SANITIZATION_SCHEMA_FIELDS)) FIELDS[name] = [...SYSTEM_FIELDS, ...list];

function fieldsOf(schema: string): string[] {
  const list = FIELDS[schema];
  if (!list) throw new Error(`sanitization: no field list for ${schema}`);
  return list;
}

/** A unique-index clash that is not this request's own RequestKey (for example a taken number). */
class DuplicateKey extends Error {}

function toFilter(filter: Filter) {
  const parts = Object.entries(filter).map(([field, value]) =>
    typeof value === "object" ? f.in(field, value.in) : f.eq(field, value),
  );
  return f.and(...parts);
}

function hasEmptyIn(filter: Filter): boolean {
  return Object.values(filter).some((v) => typeof v === "object" && v.in.length === 0);
}

const MANY = 100;

/**
 * The lane's Gateway port over the library's scoped gateway. The handler and the prefetch build it the same way, so a
 * prefetched read is the handler's identical read and costs no round trip. Writes answer without a read-back: an insert
 * is the written fields plus the new id; an update is the row this request read, merged with the patch.
 */
function gatewayOf(o: { gw: ScopedGateway; ids: OpDeps["ids"] | null; userId: string; workspaceId: string; stamp: () => string }): Gateway {
  const { gw } = o;
  // The full rows this request read, so an update can answer from them.
  const seen = new Map<string, Row>();
  const keyOf = (schema: string, id: string): string => `${schema}\u0000${id}`;
  const load = async (schema: string, id: string): Promise<Row | null> => {
    const row = ((await gw.get(schema, id, fieldsOf(schema))) as Row | null) ?? null;
    if (row) seen.set(keyOf(schema, id), row);
    return row;
  };
  const clean = (fields: Record<string, unknown>): LibRow => {
    const out: LibRow = {};
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) out[k] = v;
    return out;
  };
  const localKeyOf = (localKey: string): string => {
    if (!o.ids) throw new Error("sanitization: no request ids in a prefetch");
    return o.ids.local(localKey);
  };
  return {
    async list(schema: string, filter: Filter, opts?: ListOptions) {
      if (hasEmptyIn(filter)) return [];
      const sort = opts?.sort?.[0];
      let rows: Row[];
      if (opts?.first !== undefined) {
        const res = await gw.find(schema, {
          where: toFilter(filter),
          fields: opts.fields ? [...opts.fields] : fieldsOf(schema),
          ...(sort ? { sort: { field: sort.field, dir: sort.dir } } : {}),
          page: 1,
          pageSize: Math.min(100, Math.max(1, Math.floor(opts.first))),
        });
        rows = res.items as Row[];
      } else {
        rows = (await gw.findAll(schema, {
          where: toFilter(filter),
          fields: opts?.fields ? [...opts.fields] : fieldsOf(schema),
          ...(sort ? { sort: { field: sort.field, dir: sort.dir } } : {}),
          max: opts?.max ?? 1000,
        })) as Row[];
      }
      if (!opts?.fields) for (const r of rows) seen.set(keyOf(schema, String(r.ItemId)), r);
      return rows;
    },
    get: load,
    async findMine(schema, localKey) {
      const rows = await gw.findAll(schema, {
        where: f.eq("RequestKey", localKeyOf(localKey)),
        fields: fieldsOf(schema),
        max: 1,
      });
      return (rows[0] as Row | undefined) ?? null;
    },
    async insert(schema, fields, localKey) {
      const stored = clean(fields);
      const res = await gw.insert(schema, stored, { key: localKey });
      if (!res.itemId) throw new DuplicateKey(`${schema}: unique key already taken`);
      if (!res.created) {
        // This request's own earlier insert (a retry): the stored row is the answer.
        const row = await load(schema, res.itemId);
        if (!row) throw new DuplicateKey(`${schema}: row not readable after insert`);
        // The same shape as the first answer: no reader list, the stored stamps (the issued one when none is stored).
        const { ReaderIds: _readers, ...answer } = row;
        const issued = o.stamp();
        return { row: { ...answer, CreatedDate: row.CreatedDate ?? issued, LastUpdatedDate: row.LastUpdatedDate ?? issued } as Row, existing: true };
      }
      const stamp = o.stamp();
      const row: Row = {
        ...stored,
        ItemId: res.itemId,
        WorkspaceId: o.workspaceId,
        CreatedByUserId: o.userId,
        UpdatedByUserId: o.userId,
        RequestKey: localKeyOf(localKey),
        CreatedDate: stamp,
        LastUpdatedDate: stamp,
      };
      seen.set(keyOf(schema, res.itemId), row);
      return { row, existing: false };
    },
    async insertMany(schema, rows) {
      const chunks: (typeof rows)[number][][] = [];
      for (let i = 0; i < rows.length; i += MANY) chunks.push(rows.slice(i, i + MANY) as (typeof rows)[number][]);
      await Promise.all(
        chunks.map((chunk) => gw.insertMany(schema, chunk.map((r) => clean(r.fields)), { keys: chunk.map((r) => r.localKey) })),
      );
    },
    async update(schema, itemId, fields) {
      const patch = clean(fields);
      const base = seen.get(keyOf(schema, itemId));
      if (Object.keys(patch).length > 0) await gw.update(schema, itemId, patch);
      else if (base) return base;
      if (!base) {
        const row = await load(schema, itemId);
        return row ?? ({ ItemId: itemId } as Row);
      }
      const row: Row = { ...base, ...patch, UpdatedByUserId: o.userId, LastUpdatedDate: o.stamp() };
      seen.set(keyOf(schema, itemId), row);
      return row;
    },
    async verify(schema, itemId) {
      await gw.get(schema, itemId, ["ItemId"]);
    },
    async patch(schema, itemId, fields) {
      const patch = clean(fields);
      if (Object.keys(patch).length > 0) await gw.update(schema, itemId, patch);
    },
    async remove(schema, itemId) {
      await gw.remove(schema, itemId);
      seen.delete(keyOf(schema, itemId));
    },
    isDuplicateKey: (e) => e instanceof DuplicateKey,
  };
}

/** The prefetch's view: the same gateway port over the read-only gateway of the router's first round trip. */
function readEnvOf(p: PrefetchInput<Record<string, unknown>>): ReadEnv | null {
  if (!p.gw || !p.projectId) return null;
  return {
    userId: p.callerUserId,
    workspaceId: p.workspaceId ?? "",
    project: { ItemId: p.projectId },
    gateway: gatewayOf({ gw: p.gw, ids: null, userId: p.callerUserId, workspaceId: p.workspaceId ?? "", stamp: () => "" }),
  };
}

async function contextOf(ctx: OpCtx, deps: OpDeps): Promise<OpContext> {
  // The router's round-1 Project read carries every Project column (null when empty); read again only without them.
  const workspaceId = String(ctx.workspace?.ItemId ?? ctx.project?.WorkspaceId ?? "");
  const gateway = gatewayOf({
    gw: deps.gw,
    ids: deps.ids,
    userId: ctx.caller.userId,
    workspaceId,
    stamp: () => issuedStamp(ctx.now),
  });
  let projectRow: Row;
  if (ctx.project && "Stage" in ctx.project) {
    projectRow = Object.fromEntries(Object.entries(ctx.project).filter(([, v]) => v !== null && v !== undefined)) as Row;
  } else {
    const full = await gateway.get("Project", String(ctx.project?.ItemId ?? ""));
    if (!full) return deps.fail("not_found");
    projectRow = full;
  }
  return {
    requestId: ctx.requestId,
    userId: ctx.caller.userId,
    isSuperAdmin: ctx.viaPlatform,
    permissions: ctx.permissions,
    workspaceId,
    project: projectRow,
    now: () => ctx.now.toISOString(),
    issuedStamp: () => issuedStamp(ctx.now),
    gateway,
    requestKeyOf: (localKey) => deps.ids.local(localKey),
    after: (work) => deps.after(work),
    flush: () => deps.flush(),
    notify: (n) => deps.notify(n),
    audit: (e) => deps.audit(e),
    jobs: {
      async create(input) {
        const made = await deps.jobs.create({
          kind: input.kind,
          projectId: input.projectId,
          input: input.inputJson,
          ...(input.target ? { targetType: input.target.type, targetId: input.target.id } : {}),
        });
        if (made.existing && input.kind === "sanitization.assist") {
          // The race: another focus or record opened the job between the list and the insert.
          const open = jobInput(made.job.InputJson);
          if (open.focus !== input.inputJson.focus || String(open.refId ?? "") !== String(input.inputJson.refId ?? "")) {
            throw new OpFailure(fail("conflict", "sanitization.assistBusy"));
          }
        }
        return { jobId: String(made.job.ItemId), existing: made.existing };
      },
    },
  };
}

function jobInput(raw: unknown): Record<string, unknown> {
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function unwrap(deps: OpDeps, result: OpResult): unknown {
  if (result.ok) return result.data;
  return deps.fail(result.error.code, result.error.messageKey, result.error.params);
}

export const SANITIZATION_DEFS = Object.keys(SANITIZATION_OPS).map((op) => {
  const entry = SANITIZATION_OPS[op];
  const { prefetch, record } = entry;
  return defineOp<Record<string, unknown>, unknown>({
    op,
    kind: "command",
    scope: "project",
    // Handlers check their own, finer permission (an assigned expert may answer, any commenter may discuss).
    permission: "membership",
    args: (raw) => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}),
    ...(prefetch
      ? {
          prefetch: (p: PrefetchInput<Record<string, unknown>>) => {
            const env = readEnvOf(p);
            return env ? prefetch(env, p.args) : undefined;
          },
        }
      : {}),
    ...(record ? { record: (data: unknown) => record(data) } : {}),
    async handler(ctx, args, deps) {
      try {
        return unwrap(deps, await entry(args, await contextOf(ctx, deps)));
      } catch (e) {
        if (e instanceof OpFailure) return unwrap(deps, e.result);
        throw e;
      }
    },
  });
});
