/**
 * The single binding point between this lane and functions/_lib. Every handler
 * is written against the lane ports in ports.ts; toDefinedOp turns each lane op
 * into a real defineOp (the router owns the caller, account, Operation record,
 * membership, permission and super-admin audit steps of Appendix A) and adapts
 * deps.gw, deps.files and deps.jobs to the ports.
 */
import { defineOp, f, fail, OpError as LibOpError } from "../../../_lib";
import type { OpDeps, OpDef, Row as LibRow, ScopedGateway as LibGateway } from "../../../_lib";
import type { FactoryNoteInput } from "../../../../src/domain/factoryNotes";
import { NumberingConflictError } from "../../../../src/domain/numbering";
import { isRequirementsStepOpen } from "../../../../src/domain/requirements";
import { SAMPLE_MIME_TYPES } from "../../../../src/domain/designBrief";
import {
  OpError,
  type FilesPort,
  type JobsPort,
  type LaneAuditInput,
  type LaneDeps,
  type LaneOp,
  type LaneOpContext,
  type LaneReadEnv,
  type ScopedGateway,
  type Row,
  type Where,
  type FindOptions,
} from "./ports";
import { toProject } from "./records";

/** The fields read per schema (S1's names); the hosted gateway needs an explicit list. */
const FIELDS: Record<string, readonly string[]> = {
  Requirement: ["ItemId", "WorkspaceId", "CreatedByUserId", "UpdatedByUserId", "ProjectId", "Number", "Key", "Title", "Text", "Category", "Priority", "Status", "AcceptanceCriteria", "SourceRefs", "SortOrder"],
  Objective: ["ItemId", "WorkspaceId", "ProjectId", "Statement", "AcceptanceCriteria", "HighLevelMd", "ArchitectureMd", "Status", "ConfirmedByUserId", "ConfirmedAt"],
  ItemVersion: ["ItemId", "WorkspaceId", "ProjectId", "ItemKey", "N", "Text", "Origin", "CreatedByUserId", "UpdatedByUserId", "CommentIds"],
  Suggestion: ["ItemId", "WorkspaceId", "ProjectId", "Source", "Key", "Title", "Text", "Status", "DecidedByUserId", "DecidedAt", "EngineJobId"],
  DesignBrief: ["ItemId", "WorkspaceId", "ProjectId", "Mode", "Instructions", "References", "SampleFileIds", "Status", "ConfirmedByUserId", "ConfirmedAt", "PrototypeJson"],
  RequirementExtra: ["ItemId", "ProjectId", "Kind", "Title", "Who", "Steps", "ConstraintKind", "Status"],
  Attachment: ["ItemId", "WorkspaceId", "ProjectId", "OwnerType", "OwnerId", "FileId", "FileName", "StoredName", "Kind", "Mime", "SizeBytes", "Origin", "Meta", "Status"],
  Project: ["ItemId", "WorkspaceId", "Name", "ClientName", "Stage", "RequirementsConfirmedAt", "LandingPageAddOn", "LandingPageSection", "Goal", "TargetUsers", "Brief", "SetupWorkflows", "SetupExclusions", "SetupConstraints", "SetupMustHaves"],
  EngineJob: ["ItemId", "WorkspaceId", "ProjectId", "Kind", "Status", "InputJson", "Progress", "Message", "Attempts", "TargetType", "TargetId", "CreatedDate", "FinishedAt"],
  // read by the design intent (design/context.ts loadDesignIntent): the Project brief note and the answered questions
  DocNote: ["ItemId", "WorkspaceId", "ProjectId", "BodyMd", "IsProjectBrief"],
  Clarification: ["ItemId", "WorkspaceId", "ProjectId", "Number", "Question", "Answer", "Status"],
};

class DuplicateKey extends Error {
  constructor() {
    super("duplicate key");
    this.name = "DuplicateKey";
  }
}

function fieldsOf(schema: string, opts?: FindOptions): string[] {
  const all = FIELDS[schema];
  if (!all) throw new TypeError(`no field list for ${schema}`);
  const want = opts?.fields;
  return want ? Array.from(new Set(["ItemId", ...want])).filter((x) => x === "ItemId" || all.includes(x)) : [...all];
}

function filterOf(where: Where) {
  const parts = Object.entries(where).map(([k, v]) => {
    if (v !== null && typeof v === "object") return f.in(k, v.in);
    if (v === null) throw new TypeError("null filter values are not supported");
    return f.eq(k, v);
  });
  return f.and(...parts);
}

/** The lane's gateway over deps.gw (workspace scoped, stamping and RequestKey are the library's job). */
function laneGateway(gw: LibGateway, actor: string, workspaceId: string, project?: Row): ScopedGateway {
  // Full rows this request already holds (found, inserted or updated): an update answers the
  // merged row instead of reading it back, which saves one sequential round per write.
  const held = new Map<string, Row>();
  const key = (schema: string, id: string) => `${schema}:${id}`;
  if (project) held.set(key("Project", project.ItemId), project);
  const getRow = async (schema: string, id: string): Promise<Row | null> => {
    const r = await gw.get(schema, id, fieldsOf(schema));
    return r ? ({ ...r, ItemId: id } as Row) : null;
  };
  return {
    workspaceId,
    readerIds: [],
    async find(schema, where, opts) {
      const fields = fieldsOf(schema, opts);
      const limit = opts?.limit ?? 1000;
      const sort = opts?.sort?.[0];
      const filter = filterOf(where);
      let items: LibRow[];
      if (limit <= 100) {
        items = (await gw.find(schema, { where: filter, fields, pageSize: limit, ...(sort ? { sort } : {}) })).items;
      } else {
        // Page 1 tells the total; every other page then goes out in one parallel round (never more than 100 per page).
        // A stable sort keeps the pages disjoint.
        const stable = sort ?? { field: "ItemId", dir: "asc" as const };
        const first = await gw.find(schema, { where: filter, fields, pageSize: 100, page: 1, sort: stable });
        const total = first.totalCount ?? first.items.length;
        if (total > limit) throw new OpError("limit_reached", "fn.tooManyRows");
        const pages = first.items.length < 100 ? 1 : Math.ceil(total / 100);
        const rest = await Promise.all(
          Array.from({ length: Math.max(0, pages - 1) }, (_, i) => gw.find(schema, { where: filter, fields, pageSize: 100, page: i + 2, sort: stable })),
        );
        items = first.items.concat(...rest.map((r) => r.items));
      }
      const rows = items.slice(0, limit) as Row[];
      if (!opts?.fields) for (const r of rows) held.set(key(schema, r.ItemId), r);
      return rows;
    },
    async insert(schema, row) {
      const res = await gw.insert(schema, row);
      if (res.created && res.itemId) {
        const made = { ...row, ItemId: res.itemId, WorkspaceId: workspaceId, CreatedByUserId: actor, UpdatedByUserId: actor } as Row;
        held.set(key(schema, res.itemId), made);
        return made;
      }
      if (res.itemId) {
        // the same request already wrote this row (a retry)
        const existing = await getRow(schema, res.itemId);
        if (existing) return existing;
      }
      throw new DuplicateKey();
    },
    async update(schema, itemId, patch) {
      await gw.update(schema, itemId, patch);
      const known = held.get(key(schema, itemId));
      if (known) {
        const merged = { ...known, ...patch, ItemId: itemId, UpdatedByUserId: actor } as Row;
        held.set(key(schema, itemId), merged);
        return merged;
      }
      const row = await getRow(schema, itemId);
      if (!row) throw new OpError("not_found", "project.notFound");
      held.set(key(schema, itemId), row);
      return row;
    },
    async remove(schema, itemId) {
      await gw.remove(schema, itemId);
      held.delete(key(schema, itemId));
    },
    isDuplicateKey: (e) => e instanceof DuplicateKey,
  };
}

const swallowNotFound = async <T>(run: () => Promise<T>, fallback: T): Promise<T> => {
  try {
    return await run();
  } catch (e) {
    if (e instanceof LibOpError && e.code === "not_found") return fallback;
    throw e;
  }
};

function laneFiles(files: OpDeps["files"], now: Date, projectId: string): FilesPort {
  return {
    projectDirectory: (_w, projectId) => files.projectDirectory(projectId),
    async presignUpload(req) {
      const r = await files.presignUpload({
        projectId,
        fileName: req.fileName,
        mime: req.contentType,
        sizeBytes: req.sizeInBytes,
        maxBytes: req.sizeInBytes,
        allowedMimes: [...SAMPLE_MIME_TYPES],
      });
      return { fileId: r.fileId, uploadUrl: r.uploadUrl, requiredHeaders: {}, storedName: r.storedName };
    },
    async info(fileId) {
      return swallowNotFound(async () => {
        const i = await files.info(fileId);
        return { sizeInBytes: i.sizeBytes, contentType: i.mime || null };
      }, null);
    },
    head: (fileId, length) => files.head(fileId, length),
    async downloadUrl(fileId) {
      const r = await files.downloadUrl(fileId);
      return { url: r.url, expiresAt: r.expiresAt ?? new Date(now.getTime() + 5 * 60_000).toISOString() };
    },
    remove: (fileId) => swallowNotFound(() => files.remove(fileId), undefined),
  };
}

function laneJobs(jobs: OpDeps["jobs"]): JobsPort {
  return {
    async create(req) {
      const { job, existing } = await jobs.create({
        kind: req.kind,
        projectId: req.projectId,
        input: req.input,
        targetType: req.kind === "design.generate" ? "design-brief" : "project",
        targetId: req.targetKey,
      });
      return { job: job as Row, created: !existing };
    },
  };
}

function refuse(): never {
  throw new Error("this port is owned by the router (functions/_lib) and is not available to lane ops");
}

/** Turns a lane OpError (or the numbering clash) into the library's failure. */
function rethrow(e: unknown): never {
  if (e instanceof OpError) fail(e.code, e.messageKey, e.params);
  if (e instanceof NumberingConflictError) fail("conflict", "numbering.busy");
  throw e;
}

export function toDefinedOp(op: LaneOp): OpDef<Record<string, unknown>, unknown> {
  const spec = op.spec;
  return defineOp<Record<string, unknown>, unknown>({
    op: op.op,
    kind: spec.readOnly ? "view" : "command",
    scope: "project",
    permission: op.permission,
    ...(spec.record ? { record: (data: unknown) => spec.record!(data) } : {}),
    ...(spec.prefetch
      ? {
          prefetch(p) {
            if (!p.gw || !p.projectId || !p.workspaceId) return undefined;
            const env: LaneReadEnv = {
              workspaceId: p.workspaceId,
              actorUserId: p.callerUserId,
              project: { id: p.projectId },
              db: laneGateway(p.gw, p.callerUserId, p.workspaceId),
            };
            // reads only: a failure here shows again, with its real error, when the handler reads
            return Promise.resolve(spec.prefetch!(env, p.args as never)).catch(() => undefined);
          },
        }
      : {}),
    args(raw) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("invalid_input", "input.invalid", { field: "args" });
      try {
        return { ...(spec.parse(raw as Record<string, unknown>) as Record<string, unknown>) };
      } catch (e) {
        return rethrow(e);
      }
    },
    async handler(ctx, args, deps) {
      try {
        const projectId = String(args.projectId);
        // The router's round-1 Project read already carries every column; read again only without it.
        const loaded = ctx.project && "Stage" in ctx.project ? (ctx.project as LibRow) : await deps.gw.get("Project", projectId, FIELDS.Project);
        if (!loaded) fail("not_found", "project.notFound");
        const project = toProject({ ...loaded, ItemId: projectId } as Row);
        const stepClosed = !isRequirementsStepOpen(project.stage);
        if (spec.requireOpenStep && stepClosed && !spec.closedStepChecked) fail("conflict", "requirements.closed");
        const workspaceId = project.workspaceId;
        const laneDeps = {
          gateway: { find: refuse, isDuplicateKey: refuse },
          scoped: refuse,
          files: laneFiles(deps.files, ctx.now, projectId),
          jobs: laneJobs(deps.jobs),
          access: refuse,
          operations: refuse,
          notify: (n: FactoryNoteInput) => deps.notify(n),
          now: () => ctx.now,
          after: (work: () => Promise<unknown>) => deps.after(work),
          flush: () => deps.flush(),
          audit: (e: LaneAuditInput) =>
            deps.audit({
              action: e.action ?? op.op,
              targetType: e.targetType,
              targetId: e.targetId,
              ...(e.details ? { details: e.details } : {}),
            }),
        } as unknown as LaneDeps;
        const laneCtx: LaneOpContext = {
          requestId: ctx.requestId,
          retry: ctx.attempt > 1,
          ...(spec.requireOpenStep && stepClosed ? { stepClosed: true } : {}),
          actorUserId: ctx.caller.userId,
          isSuperAdmin: ctx.viaPlatform,
          isMember: ctx.membership !== null,
          permissions: ctx.permissions,
          project,
          workspaceId,
          db: laneGateway(deps.gw, ctx.caller.userId, workspaceId, { ...loaded, ItemId: projectId } as Row),
          deps: laneDeps,
          now: ctx.now,
        };
        return await spec.run(laneCtx, args as never);
      } catch (e) {
        return rethrow(e);
      }
    },
  });
}

export function toDefinedOps(ops: Record<string, LaneOp>): OpDef<Record<string, unknown>, unknown>[] {
  return Object.values(ops).map(toDefinedOp);
}
