/**
 * Helpers shared by the scope op files: the Outcome shape, argument parsing, and the common reads. No import from
 * functions/_lib (the ports are in ./ports, bind.ts binds them).
 */
import type { WorkspacePermission } from "../../../../src/domain/rbac";
import type { ScopeOpName } from "../../../../src/domain/scope";
import type { FnErrorCode, Row, ScopeEnv, ScopeReadEnv } from "./ports";
import { SCHEMA, versionRec, type VersionRec } from "./records";

export type Outcome<D> =
  | { ok: true; data: D }
  | { ok: false; code: FnErrorCode; messageKey?: string; params?: Record<string, unknown> };

export function ok<D>(data: D): Outcome<D> {
  return { ok: true, data };
}

export function fail(code: FnErrorCode, messageKey?: string, params?: Record<string, unknown>): Outcome<never> {
  const out: Outcome<never> = { ok: false, code };
  if (messageKey !== undefined) out.messageKey = messageKey;
  if (params !== undefined) out.params = params;
  return out;
}

export type Parsed<A> = { ok: true; value: A } | { ok: false; messageKey: string; params?: Record<string, unknown> };

/**
 * One op of this lane: the op table of SCOPE_OPS is built from these in bind.ts. Never give it a key named
 * `handler`: L2's discovery rejects op-shaped objects that carry both `op` and `handler` unless defineOp made them.
 */
export interface ScopeOpDef<A = any, D = any> {
  op: ScopeOpName;
  kind: "command" | "view";
  permission: WorkspacePermission;
  parse(raw: unknown): Parsed<A>;
  run(env: ScopeEnv, args: A): Promise<Outcome<D>>;
  /** Read-only; started inside the router's round 1 so the handler's identical reads cost no round. */
  prefetch?: (env: ScopeReadEnv, args: A) => unknown;
  /** false = no Operation record after the handler (every write must then be keyed or idempotent). */
  record?: (data: D) => boolean;
}

export interface ArgSpec {
  type: "id" | "uuid" | "string" | "int" | "boolean" | "ids" | "strings" | "string[]" | "object" | "objects";
  optional?: boolean;
  /** string: max length; int: max value; ids / strings: max length of one item. */
  max?: number;
  /** string: min length; int: min value. */
  min?: number;
  /** ids / strings / objects: the most entries. */
  maxItems?: number;
  enum?: readonly string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_MAX = 128;
const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const wrong = (key: string): { ok: false; messageKey: string; params: Record<string, unknown> } => ({
  ok: false,
  messageKey: "input.wrongType",
  params: { key },
});

function parseOne(key: string, v: unknown, s: ArgSpec): Parsed<unknown> {
  const tooLong = (max: number) => ({ ok: false as const, messageKey: "input.tooLong", params: { key, max } });
  const textOk = (x: unknown, max: number | undefined, min: number | undefined): Parsed<string> => {
    if (typeof x !== "string") return wrong(key);
    if (max !== undefined && x.length > max) return tooLong(max);
    if (min !== undefined && x.length < min) return { ok: false, messageKey: "input.tooShort", params: { key, min } };
    return { ok: true, value: x };
  };
  switch (s.type) {
    case "id": {
      const r = textOk(v, s.max ?? ID_MAX, 1);
      return r.ok || r.messageKey !== "input.tooShort" ? r : wrong(key);
    }
    case "uuid":
      return typeof v === "string" && UUID.test(v) ? { ok: true, value: v.toLowerCase() } : wrong(key);
    case "string": {
      const r = textOk(v, s.max, s.min);
      if (!r.ok) return r;
      if (s.enum && !s.enum.includes(r.value)) return wrong(key);
      return r;
    }
    case "int":
      if (typeof v !== "number" || !Number.isInteger(v)) return wrong(key);
      if ((s.min !== undefined && v < s.min) || (s.max !== undefined && v > s.max)) return wrong(key);
      return { ok: true, value: v };
    case "boolean":
      return typeof v === "boolean" ? { ok: true, value: v } : wrong(key);
    case "ids":
    case "strings":
    case "string[]":
    case "objects": {
      if (!Array.isArray(v)) return wrong(key);
      if (s.maxItems !== undefined && v.length > s.maxItems) {
        return { ok: false, messageKey: "input.tooMany", params: { key, max: s.maxItems } };
      }
      if (s.type === "objects") return v.every(isPlain) ? { ok: true, value: v } : wrong(key);
      const itemMax = s.max ?? (s.type === "ids" ? ID_MAX : undefined);
      for (const x of v) {
        const r = textOk(x, itemMax, s.type === "ids" ? 1 : undefined);
        if (!r.ok) return r.messageKey === "input.tooLong" ? r : wrong(key);
      }
      return { ok: true, value: v };
    }
    case "object":
      return isPlain(v) ? { ok: true, value: v } : wrong(key);
  }
}

type Spec = Record<string, ArgSpec>;

/**
 * Validates and narrows the raw args to the keys of `spec` (projectId is always a required id). Unknown keys are
 * DROPPED, never refused. Usable both as parseArgs(raw, spec) and curried as `parse: parseArgs(spec)`.
 */
export function parseArgs(raw: unknown, spec: Spec): Parsed<Record<string, any>>;
export function parseArgs(spec: Spec): (raw: unknown) => Parsed<Record<string, any>>;
export function parseArgs(a: unknown, b?: Spec): any {
  if (b === undefined) return (raw: unknown) => parseArgs(raw, a as Spec);
  const spec: Spec = { projectId: { type: "id" }, ...b };
  if (!isPlain(a)) return wrong("args");
  const out: Record<string, unknown> = {};
  for (const [key, s] of Object.entries(spec)) {
    const v = a[key];
    if (v === undefined || v === null) {
      if (s.optional) continue;
      return wrong(key);
    }
    const r = parseOne(key, v, s);
    if (!r.ok) return r;
    out[key] = r.value;
  }
  return { ok: true, value: out };
}

export function stepOf(project: Row): string {
  return typeof project.Stage === "string" ? project.Stage : "";
}

/**
 * The RequestKey natural key of a row a command writes. A leading env (any object carrying projectId) stands for
 * its project id, so naturalKey(env, "milestone", clientKey) and naturalKey(projectId, ...) agree.
 */
export function naturalKey(...parts: unknown[]): string {
  const norm = parts.map((p) => (isPlain(p) && typeof p.projectId === "string" ? p.projectId : String(p)));
  return "l7:" + norm.join(":");
}

/** A readable version, carrying its raw stored fields too (Status, Number, ...) next to the mapped ones. */
export type VersionView = VersionRec & Record<string, unknown>;

function viewOf(row: Row): VersionView | null {
  const rec = versionRec(row);
  return rec ? { ...row, ...rec } : null;
}

/** The highest Number of the project, or null when none (or an unreadable one). */
export async function latestVersion(env: ScopeReadEnv): Promise<VersionView | null> {
  const rows = await env.db.query(SCHEMA.scopeVersion, { ProjectId: env.projectId }, { sort: { field: "Number", dir: "desc" }, limit: 1 });
  return rows[0] ? viewOf(rows[0]) : null;
}

/** Null unless the version is this project's. */
export async function loadVersion(env: ScopeReadEnv, id: string): Promise<VersionView | null> {
  const row = await findInProject(env, SCHEMA.scopeVersion, id);
  return row ? viewOf(row) : null;
}

const bySortOrder = { field: "SortOrder", dir: "asc" } as const;

/** The raw rows of one scope version, read in parallel; milestones are those with ScopeVersion = version.number. */
export async function loadScopeState(
  env: ScopeEnv,
  version: { number: number },
): Promise<{ features: Row[]; stories: Row[]; milestones: Row[] }> {
  const where = { ProjectId: env.projectId, ScopeVersion: version.number };
  const [features, stories, milestones] = await Promise.all([
    env.db.query(SCHEMA.feature, where, { sort: bySortOrder }),
    env.db.query(SCHEMA.story, where, { sort: bySortOrder }),
    env.db.query(SCHEMA.milestone, where, { sort: bySortOrder }),
  ]);
  return { features, stories, milestones };
}

/**
 * loadScopeState without needing the version first: all rows of the project in ONE parallel round, so a handler can read
 * the version (or latest version) beside them. Narrow with scopeStateOf(rows, version.number).
 */
export async function loadProjectScopeRows(env: ScopeReadEnv): Promise<{ features: Row[]; stories: Row[]; milestones: Row[] }> {
  const where = { ProjectId: env.projectId };
  const [features, stories, milestones] = await Promise.all([
    env.db.query(SCHEMA.feature, where, { sort: bySortOrder }),
    env.db.query(SCHEMA.story, where, { sort: bySortOrder }),
    env.db.query(SCHEMA.milestone, where, { sort: bySortOrder }),
  ]);
  return { features, stories, milestones };
}

export function scopeStateOf(
  rows: { features: Row[]; stories: Row[]; milestones: Row[] },
  version: { number: number },
): { features: Row[]; stories: Row[]; milestones: Row[] } {
  const mine = (r: Row) => Number(r.ScopeVersion) === version.number;
  return { features: rows.features.filter(mine), stories: rows.stories.filter(mine), milestones: rows.milestones.filter(mine) };
}

/** The row only if it belongs to THIS project; otherwise null (the handler answers not_found). */
export async function findInProject(env: ScopeReadEnv, schema: string, id: string): Promise<Row | null> {
  const rows = await env.db.query(schema, { ItemId: id, ProjectId: env.projectId }, { limit: 1 });
  return rows[0] ?? null;
}

/** conflict scope.locked for a locked version, conflict scope.notOpen outside the scope step, otherwise null. */
export function refuseUnlessDraftOpen(env: ScopeEnv, version: { status: string } | null): Outcome<never> | null {
  if (version && version.status === "locked") return fail("conflict", "scope.locked");
  if (stepOf(env.project) !== "scope") return fail("conflict", "scope.notOpen");
  return null;
}

export interface NumberPlan {
  /** id -> final Number (position + 1) for every id of orderedIds. */
  final: Map<string, number>;
  /** Written straight to the final Number: no other stored row holds it. */
  direct: { id: string; number: number }[];
  /** Written first to a temporary Number above every stored one (the final Number is held by another row). */
  temp: { id: string; number: number }[];
  /** The second write of each temp id: the final Number, once the first round has freed it. */
  phase2: { id: string; number: number }[];
}

/**
 * Numbers a milestone arrangement by its order (Number = position + 1) under the UNIQUE (ProjectId, ScopeVersion,
 * Number) index. `rows` are the stored milestones of the version; `orderedIds` the final order (a stored ItemId, or
 * any other key for a milestone that is not stored yet). A stored row that already holds its final Number is in no
 * list; a target held at read time by ANOTHER row (removed in this same save too) goes through a temporary Number.
 */
export function planNumbers(rows: Row[], orderedIds: string[]): NumberPlan {
  const holder = new Map<number, string>();
  let max = 0;
  for (const r of rows) {
    const n = Number(r.Number);
    if (!Number.isFinite(n)) continue;
    holder.set(n, r.ItemId);
    max = Math.max(max, n);
  }
  const stored = new Map(rows.map((r) => [r.ItemId, Number(r.Number)]));
  const out: NumberPlan = { final: new Map(), direct: [], temp: [], phase2: [] };
  const base = max + rows.length + orderedIds.length;
  orderedIds.forEach((id, i) => {
    const number = i + 1;
    out.final.set(id, number);
    if (stored.get(id) === number) return;
    const held = holder.get(number);
    if (held === undefined || held === id) out.direct.push({ id, number });
    else {
      out.temp.push({ id, number: base + 1 + out.temp.length });
      out.phase2.push({ id, number });
    }
  });
  return out;
}

/** Version's milestones in plan order: SortOrder, then Number, then ItemId. */
export function byPlanOrder(rows: Row[]): Row[] {
  return [...rows].sort(
    (a, b) =>
      Number(a.SortOrder ?? 0) - Number(b.SortOrder ?? 0) || Number(a.Number ?? 0) - Number(b.Number ?? 0) || (a.ItemId < b.ItemId ? -1 : a.ItemId > b.ItemId ? 1 : 0),
  );
}

const VIEW_KEYS = ["id", "number", "status", "lockedAt", "lockedByUserId", "updatedAt"] as const;

/** The stored fields of a loaded version, without the mapped keys loadVersion adds (what a byIds read would give). */
export function rawVersion(view: VersionView): Row {
  const out: Record<string, unknown> = { ...view };
  for (const k of VIEW_KEYS) delete out[k];
  return out as Row;
}
