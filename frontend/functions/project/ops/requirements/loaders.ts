/**
 * Shared loaders for the requirements and design ops. Everything goes through
 * ctx.db (the workspace-scoped gateway), and every row is checked to belong to
 * the project in ctx (cross-project ids give not_found).
 */
import { insertWithNextNumber } from "../../../../src/domain/numbering";
import { REQUIREMENT_STATUSES, isActiveRequirementStatus } from "../../../../src/domain/requirements";
import { OpError, type LaneOpContext, type Row } from "./ports";
import { requirementRow, toRequirement, REMOVED_STATUS, type RequirementPriority } from "./records";

/** What a read needs: the handler's context and the prefetch's env both fit, so the same call fills the memo. */
export type ReadCtx = Pick<LaneOpContext, "db"> & { project: { id: string } };

const MAX_ACTIVE_REQUIREMENTS = 200;
const MAX_ROWS = 1000;

function byOrder(a: Row, b: Row): number {
  const ra = toRequirement(a);
  const rb = toRequirement(b);
  return ra.sortOrder - rb.sortOrder || (ra.number ?? 0) - (rb.number ?? 0);
}

const ACTIVE_STATUSES = REQUIREMENT_STATUSES.filter((s) => isActiveRequirementStatus(s));

/** The row with the highest Number of the project, any status (one sorted query). */
async function loadTopNumberRow(ctx: ReadCtx): Promise<Row | null> {
  const rows = await ctx.db.find("Requirement", { ProjectId: ctx.project.id }, { limit: 1, sort: [{ field: "Number", dir: "desc" }] });
  return rows[0] ?? null;
}

/**
 * The ACTIVE requirements of the project (at most 200), sorted by SortOrder then Number. Dropped rows are not
 * read, so they never count against the read limit. The row with the highest Number (any status) rides along in
 * the same round, so a new Number is max(all Numbers) + 1; callers filter by status where it matters.
 */
export async function loadRequirements(ctx: ReadCtx): Promise<Row[]> {
  // Number is unique per project: a stable sort for the 100-row pages.
  const [rows, top] = await Promise.all([
    ctx.db.find("Requirement", { ProjectId: ctx.project.id, Status: { in: ACTIVE_STATUSES } }, { limit: MAX_ROWS, sort: [{ field: "Number", dir: "asc" }] }),
    loadTopNumberRow(ctx),
  ]);
  const all = top && !rows.some((r) => r.ItemId === top.ItemId) ? [...rows, top] : rows;
  return all.slice().sort(byOrder);
}

/** The requirement with this Key, any status (a dropped one included), or null. */
export async function loadRequirementByKey(ctx: ReadCtx, key: string): Promise<Row | null> {
  const rows = await ctx.db.find("Requirement", { ProjectId: ctx.project.id, Key: key }, { limit: 1 });
  return rows[0] ?? null;
}

/** Refuses when the project already has the most ACTIVE requirements (removed rows never count). */
export function assertActiveCapacity(rows: Row[]): void {
  const active = rows.map(toRequirement).filter((r) => r.active);
  if (active.length >= MAX_ACTIVE_REQUIREMENTS) {
    throw new OpError("limit_reached", "requirement.limit", { max: MAX_ACTIVE_REQUIREMENTS });
  }
}

export async function loadRequirement(ctx: ReadCtx, id: string): Promise<Row> {
  const rows = await ctx.db.find("Requirement", { ItemId: id, ProjectId: ctx.project.id }, { limit: 1 });
  if (rows.length === 0 || rows[0].ProjectId !== ctx.project.id) throw new OpError("not_found", "requirement.notFound");
  return rows[0];
}

/** Next SortOrder after the active ones (steps of 10, the same as reorderPlan). */
function nextSortOrder(active: readonly number[]): number {
  return active.length === 0 ? 0 : Math.max(...active) + 10;
}

class KeyExists extends Error {
  constructor(readonly row: Row) {
    super("key exists");
  }
}

const byKey = loadRequirementByKey;

/**
 * Creates a Requirement unless the project already has one with this Key
 * (then created:false: the idempotency of a retry). The Number is allocated
 * with insertWithNextNumber behind the unique (ProjectId, Number) index; the
 * gateway assigns the ItemId.
 */
export async function insertRequirement(
  ctx: LaneOpContext,
  f: { key: string; title: string; detail: string; priority: RequirementPriority; criteria: string[]; sourceRefs: string[] },
  /** The project's requirements, when the caller already loaded them in this request (saves a round). */
  preloaded?: Row[],
  /** The caller already looked the Key up (any status) and found nothing. */
  keyKnownAbsent = false,
): Promise<{ row: Row; created: boolean }> {
  // The key lookup (any status) and the list run in one round. With a preloaded list a dropped row of this Key
  // is not in it: the Key index then answers the insert and the duplicate path below finds the row.
  const [existing, all] = await Promise.all([
    preloaded || keyKnownAbsent ? Promise.resolve(preloaded?.find((r) => r.Key === f.key) ?? null) : byKey(ctx, f.key),
    preloaded ? Promise.resolve(preloaded) : loadRequirements(ctx),
  ]);
  if (existing) return { row: existing, created: false };

  const active = all.map(toRequirement).filter((r) => r.active);
  assertActiveCapacity(all);
  const sortOrder = nextSortOrder(active.map((r) => r.sortOrder));

  let first = true;
  try {
    const { value } = await insertWithNextNumber<Row>({
      readMax: async () => {
        if (first) {
          first = false;
          return all.reduce((m, r) => Math.max(m, toRequirement(r).number ?? 0), 0);
        }
        const top = await loadTopNumberRow(ctx);
        return top ? (toRequirement(top).number ?? 0) : 0;
      },
      insert: async (n) => {
        try {
          return await ctx.db.insert(
            "Requirement",
            requirementRow({
              projectId: ctx.project.id,
              number: n,
              key: f.key,
              title: f.title,
              detail: f.detail,
              priority: f.priority,
              criteria: f.criteria,
              sourceRefs: f.sourceRefs,
              sortOrder,
              status: "draft",
            }),
          );
        } catch (e) {
          // A duplicate may come from the Number index (retry with a fresh number) or from the Key index (done already).
          if (ctx.db.isDuplicateKey(e)) {
            const again = await byKey(ctx, f.key);
            if (again) throw new KeyExists(again);
          }
          throw e;
        }
      },
      isDuplicateKey: ctx.db.isDuplicateKey,
    });
    return { row: value, created: true };
  } catch (e) {
    if (e instanceof KeyExists) return { row: e.row, created: false };
    throw e;
  }
}

/**
 * An update the router writes in its bookkeeping round (deps.after): answers the merged row at once, so the
 * handler spends no round on it. A failed write marks the run failed, so a retry runs the handler again.
 */
export function deferUpdate(ctx: LaneOpContext, schema: string, row: Row, patch: Record<string, unknown>): Row {
  ctx.deps.after(() => ctx.db.update(schema, row.ItemId, patch));
  return { ...row, ...patch, ItemId: row.ItemId, UpdatedByUserId: ctx.actorUserId } as Row;
}

/** True when the requirement row is removed (soft deleted). */
export function isRemoved(row: Row): boolean {
  return row.Status === REMOVED_STATUS;
}

// ---- Objective ----

/** The project's Objective, whatever ItemId sanitization gave it. */
export async function loadObjective(ctx: ReadCtx): Promise<Row | null> {
  const rows = await ctx.db.find("Objective", { ProjectId: ctx.project.id }, { limit: 1 });
  return rows[0] ?? null;
}

export async function ensureObjective(ctx: LaneOpContext, statement: string, known?: Row | null): Promise<{ row: Row; created: boolean }> {
  const existing = known === undefined ? await loadObjective(ctx) : known;
  if (existing) return { row: existing, created: false };
  try {
    const row = await ctx.db.insert("Objective", {
      ProjectId: ctx.project.id,
      Statement: statement,
      AcceptanceCriteria: [],
      Status: "draft",
    });
    return { row, created: true };
  } catch (e) {
    if (!ctx.db.isDuplicateKey(e)) throw e;
    const again = await loadObjective(ctx);
    if (!again) throw e;
    return { row: again, created: false };
  }
}

// ---- Suggestion ----

export async function loadSuggestion(ctx: ReadCtx, id: string): Promise<Row> {
  const rows = await ctx.db.find("Suggestion", { ItemId: id, ProjectId: ctx.project.id }, { limit: 1 });
  if (rows.length === 0 || rows[0].ProjectId !== ctx.project.id) throw new OpError("not_found", "suggestion.notFound");
  return rows[0];
}

// ---- DesignBrief and its samples ----

export async function loadDesignBrief(ctx: ReadCtx): Promise<Row | null> {
  const rows = await ctx.db.find("DesignBrief", { ProjectId: ctx.project.id }, { limit: 1 });
  return rows[0] ?? null;
}

export async function ensureDesignBrief(ctx: LaneOpContext, mode: "sample" | "describe", known?: Row | null): Promise<{ row: Row; created: boolean }> {
  const existing = known === undefined ? await loadDesignBrief(ctx) : known;
  if (existing) return { row: existing, created: false };
  try {
    const row = await ctx.db.insert("DesignBrief", {
      ProjectId: ctx.project.id,
      Mode: mode,
      Instructions: "",
      SampleFileIds: [],
      Status: "draft",
    });
    return { row, created: true };
  } catch (e) {
    if (!ctx.db.isDuplicateKey(e)) throw e;
    const again = await loadDesignBrief(ctx);
    if (!again) throw e;
    return { row: again, created: false };
  }
}

function byCreated(a: Row, b: Row): number {
  return String(a.CreatedDate ?? "").localeCompare(String(b.CreatedDate ?? ""));
}

export async function loadBriefAttachments(ctx: ReadCtx, briefId: string): Promise<Row[]> {
  const rows = await ctx.db.find(
    "Attachment",
    { ProjectId: ctx.project.id, OwnerType: "design-brief", OwnerId: briefId },
    { limit: MAX_ROWS },
  );
  return rows.slice().sort(byCreated);
}

/** Every design-brief attachment of the project (the project has one brief), oldest first. */
export async function loadProjectBriefAttachments(ctx: ReadCtx): Promise<Row[]> {
  const rows = await ctx.db.find("Attachment", { ProjectId: ctx.project.id, OwnerType: "design-brief" }, { limit: MAX_ROWS });
  return rows.slice().sort(byCreated);
}

/** An attachment of this project's design brief that is not deleted; anything else is not_found. */
export async function loadAttachment(ctx: LaneOpContext, attachmentId: string, briefId: string | null): Promise<Row> {
  return checkAttachment(await findAttachment(ctx, attachmentId), ctx, briefId);
}

export async function findAttachment(ctx: ReadCtx, attachmentId: string): Promise<Row | undefined> {
  const rows = await ctx.db.find("Attachment", { ItemId: attachmentId, ProjectId: ctx.project.id }, { limit: 1 });
  return rows[0];
}

export function checkAttachment(a: Row | undefined, ctx: LaneOpContext, briefId: string | null): Row {
  if (!a || a.ProjectId !== ctx.project.id || a.OwnerType !== "design-brief" || briefId === null || a.OwnerId !== briefId || a.Status === "deleted") {
    throw new OpError("not_found", "attachment.notFound");
  }
  return a;
}

// ---- ItemVersion ----

/** The versions of one item key, sorted by N ascending; Text only when asked for. */
export async function loadVersions(ctx: ReadCtx, itemKey: string, opts: { withText: boolean }): Promise<Row[]> {
  const fields = ["ItemId", "ProjectId", "ItemKey", "N", "Origin", "CreatedByUserId", "CreatedDate", ...(opts.withText ? ["Text"] : [])];
  const rows = await ctx.db.find("ItemVersion", { ProjectId: ctx.project.id, ItemKey: itemKey }, { fields, limit: MAX_ROWS });
  return rows.slice().sort((a, b) => Number(a.N) - Number(b.N));
}
