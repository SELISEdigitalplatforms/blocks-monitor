/**
 * Seed rules (pure). Shared by the seed ops (functions/admin/ops/seed) and the tests; imports no DOM, storage, timer or network.
 * Mirrors scripts/seed-plan.mjs validateScenario. The schema table below follows blocks/data/schemas/*.json
 * (every schema with a SeedKey field), minus the server-stamped and system fields.
 */

export const SEED_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const SCENARIO_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;
export const RELATIVE_AT_PATTERN = /^[+-][0-9]+d([+-][0-9]+h)?([+-][0-9]+m)?$/;

export const SEED_LIMITS = {
  recordsPerCall: 200,
  users: 20,
  removeKeys: 2000,
  budgetMarginMs: 5000,
  keysPerRead: 500,
  insertConcurrency: 5,
  anchorMaxAgeMs: 86400000,
  anchorSkewMs: 60000,
} as const;

export const SEED_STAMPED_FIELDS: readonly string[] = [
  "WorkspaceId",
  "ReaderIds",
  "CreatedByUserId",
  "UpdatedByUserId",
  "IsExample",
  "SeedKey",
  "RequestKey",
];
export const SEED_SYSTEM_FIELDS: readonly string[] = [
  "ItemId",
  "CreatedDate",
  "CreatedBy",
  "LastUpdatedDate",
  "LastUpdatedBy",
  "OrganizationId",
  "Tags",
  "Language",
];

export type SeedFieldType = "String" | "ID" | "Int" | "Float" | "Boolean" | "DateTime";
export interface SeedField {
  type: SeedFieldType;
  isArray: boolean;
}
export interface SeedSchema {
  name: string;
  fields: Record<string, SeedField>;
  hasIsExample: boolean;
  startOnly: boolean;
  /** S1's unique indexes (field names only), without the RequestKey index. */
  uniques: string[][];
}

/** Every seedable schema in a valid apply order (every $ref points to an earlier entry). */
export const SEED_SCHEMAS: readonly SeedSchema[] = [
  {
    name: "Workspace",
    hasIsExample: true,
    startOnly: true,
    uniques: [["WorkspaceId"]],
    fields: {
      Name: { type: "String", isArray: false },
      Status: { type: "String", isArray: false },
    },
  },
  {
    name: "Membership",
    hasIsExample: false,
    startOnly: true,
    uniques: [["WorkspaceId","Email"]],
    fields: {
      UserId: { type: "String", isArray: false },
      Email: { type: "String", isArray: false },
      DisplayName: { type: "String", isArray: false },
      RoleKey: { type: "String", isArray: false },
      Status: { type: "String", isArray: false },
      InvitedByUserId: { type: "String", isArray: false },
      InvitedAt: { type: "DateTime", isArray: false },
      JoinedAt: { type: "DateTime", isArray: false },
      SuspendedAt: { type: "DateTime", isArray: false },
      RemovedAt: { type: "DateTime", isArray: false },
    },
  },
  {
    name: "Project",
    hasIsExample: true,
    startOnly: false,
    uniques: [],
    fields: {
      Name: { type: "String", isArray: false },
      ClientName: { type: "String", isArray: false },
      ClientContact: { type: "String", isArray: false },
      ClientIndustry: { type: "String", isArray: false },
      ClientRegion: { type: "String", isArray: false },
      Status: { type: "String", isArray: false },
      BusinessHandedOverByUserId: { type: "String", isArray: false },
      Brief: { type: "String", isArray: false },
      NameSuggested: { type: "Boolean", isArray: false },
      Stage: { type: "String", isArray: false },
      ResumeTo: { type: "String", isArray: false },
      CurrentScopeVersion: { type: "Int", isArray: false },
      AssigneeUserId: { type: "String", isArray: false },
      BusinessHandedOverAt: { type: "DateTime", isArray: false },
      SanitizationCompletedAt: { type: "DateTime", isArray: false },
      RequirementsConfirmedAt: { type: "DateTime", isArray: false },
      ScopeLockedAt: { type: "DateTime", isArray: false },
      RepoProvider: { type: "String", isArray: false },
      RepoOwner: { type: "String", isArray: false },
      RepoName: { type: "String", isArray: false },
      RepoMode: { type: "String", isArray: false },
      RepoVisibility: { type: "String", isArray: false },
      RepoBranch: { type: "String", isArray: false },
      RepoExisting: { type: "String", isArray: false },
      RepoNameEdited: { type: "Boolean", isArray: false },
      Rev: { type: "Int", isArray: false },
    },
  },
  {
    name: "ProjectAssignment",
    hasIsExample: false,
    startOnly: false,
    uniques: [],
    fields: {
      ProjectId: { type: "String", isArray: false },
      AssigneeUserId: { type: "String", isArray: false },
      AssignedByUserId: { type: "String", isArray: false },
      At: { type: "DateTime", isArray: false },
    },
  },
  {
    name: "DocFolder",
    hasIsExample: false,
    startOnly: false,
    uniques: [],
    fields: {
      ProjectId: { type: "String", isArray: false },
      ParentId: { type: "String", isArray: false },
      Name: { type: "String", isArray: false },
      Kind: { type: "String", isArray: false },
      SortOrder: { type: "Int", isArray: false },
      Status: { type: "String", isArray: false },
    },
  },
  {
    name: "DocNote",
    hasIsExample: false,
    startOnly: false,
    uniques: [],
    fields: {
      ProjectId: { type: "String", isArray: false },
      FolderId: { type: "String", isArray: false },
      Title: { type: "String", isArray: false },
      BodyMd: { type: "String", isArray: false },
      SortOrder: { type: "Int", isArray: false },
      IsScratchPad: { type: "Boolean", isArray: false },
    },
  },
  {
    name: "Clarification",
    hasIsExample: false,
    startOnly: false,
    uniques: [["ProjectId","Number"]],
    fields: {
      ProjectId: { type: "String", isArray: false },
      Number: { type: "Int", isArray: false },
      Question: { type: "String", isArray: false },
      Answer: { type: "String", isArray: false },
      Status: { type: "String", isArray: false },
      OwnerUserId: { type: "String", isArray: false },
      SourceType: { type: "String", isArray: false },
      SourceRef: { type: "String", isArray: false },
      DeferReason: { type: "String", isArray: false },
      AnsweredByUserId: { type: "String", isArray: false },
      AnsweredAt: { type: "DateTime", isArray: false },
      SortOrder: { type: "Int", isArray: false },
    },
  },
  {
    name: "Decision",
    hasIsExample: false,
    startOnly: false,
    uniques: [["ProjectId","Number"]],
    fields: {
      ProjectId: { type: "String", isArray: false },
      Number: { type: "Int", isArray: false },
      Title: { type: "String", isArray: false },
      Statement: { type: "String", isArray: false },
      Rationale: { type: "String", isArray: false },
      ClarificationId: { type: "String", isArray: false },
      Status: { type: "String", isArray: false },
      SourceRef: { type: "String", isArray: false },
      DecidedByUserId: { type: "String", isArray: false },
      DecidedAt: { type: "DateTime", isArray: false },
      SupersededById: { type: "String", isArray: false },
    },
  },
  {
    name: "TechDecision",
    hasIsExample: false,
    startOnly: false,
    uniques: [["ProjectId","Number"]],
    fields: {
      ProjectId: { type: "String", isArray: false },
      Number: { type: "Int", isArray: false },
      Area: { type: "String", isArray: false },
      Title: { type: "String", isArray: false },
      Choice: { type: "String", isArray: false },
      Rationale: { type: "String", isArray: false },
      Alternatives: { type: "String", isArray: true },
      NfrCategory: { type: "String", isArray: false },
      NfrTarget: { type: "String", isArray: false },
      IntegrationSystem: { type: "String", isArray: false },
      ExpertUserIds: { type: "String", isArray: true },
      Status: { type: "String", isArray: false },
      DecidedByUserId: { type: "String", isArray: false },
      DecidedAt: { type: "DateTime", isArray: false },
    },
  },
  {
    name: "Requirement",
    hasIsExample: false,
    startOnly: false,
    uniques: [["ProjectId","Number"], ["ProjectId","Key"]],
    fields: {
      ProjectId: { type: "String", isArray: false },
      Number: { type: "Int", isArray: false },
      Key: { type: "String", isArray: false },
      Title: { type: "String", isArray: false },
      Text: { type: "String", isArray: false },
      Category: { type: "String", isArray: false },
      Priority: { type: "String", isArray: false },
      Status: { type: "String", isArray: false },
      AcceptanceCriteria: { type: "String", isArray: true },
      SourceRefs: { type: "String", isArray: true },
      SpecVersion: { type: "Int", isArray: false },
      SortOrder: { type: "Int", isArray: false },
    },
  },
  {
    name: "Objective",
    hasIsExample: false,
    startOnly: false,
    uniques: [["ProjectId"]],
    fields: {
      ProjectId: { type: "String", isArray: false },
      Statement: { type: "String", isArray: false },
      AcceptanceCriteria: { type: "String", isArray: true },
      HighLevelMd: { type: "String", isArray: false },
      ArchitectureMd: { type: "String", isArray: false },
      SpecVersion: { type: "Int", isArray: false },
      Status: { type: "String", isArray: false },
      ConfirmedByUserId: { type: "String", isArray: false },
      ConfirmedAt: { type: "DateTime", isArray: false },
    },
  },
  {
    name: "DesignBrief",
    hasIsExample: false,
    startOnly: false,
    uniques: [["ProjectId"]],
    fields: {
      ProjectId: { type: "String", isArray: false },
      Mode: { type: "String", isArray: false },
      Instructions: { type: "String", isArray: false },
      References: { type: "String", isArray: true },
      SampleFileIds: { type: "String", isArray: true },
      Status: { type: "String", isArray: false },
      ConfirmedByUserId: { type: "String", isArray: false },
      ConfirmedAt: { type: "DateTime", isArray: false },
    },
  },
  {
    name: "ScopeVersion",
    hasIsExample: false,
    startOnly: false,
    uniques: [["ProjectId","Number"]],
    fields: {
      ProjectId: { type: "String", isArray: false },
      Number: { type: "Int", isArray: false },
      Title: { type: "String", isArray: false },
      Summary: { type: "String", isArray: false },
      Status: { type: "String", isArray: false },
      PlanHours: { type: "Float", isArray: false },
      LockedByUserId: { type: "String", isArray: false },
      LockedAt: { type: "DateTime", isArray: false },
      UnlockedAt: { type: "DateTime", isArray: false },
      EngineJobId: { type: "String", isArray: false },
    },
  },
  {
    name: "Feature",
    hasIsExample: false,
    startOnly: false,
    uniques: [["ProjectId","ScopeVersion","Key"]],
    fields: {
      ProjectId: { type: "String", isArray: false },
      ScopeVersion: { type: "Int", isArray: false },
      Key: { type: "String", isArray: false },
      Title: { type: "String", isArray: false },
      Description: { type: "String", isArray: false },
      Priority: { type: "String", isArray: false },
      Status: { type: "String", isArray: false },
      RequirementRefs: { type: "String", isArray: true },
      SortOrder: { type: "Int", isArray: false },
    },
  },
  {
    name: "Story",
    hasIsExample: false,
    startOnly: false,
    uniques: [["ProjectId","ScopeVersion","Key"]],
    fields: {
      ProjectId: { type: "String", isArray: false },
      ScopeVersion: { type: "Int", isArray: false },
      FeatureRef: { type: "String", isArray: false },
      Key: { type: "String", isArray: false },
      Title: { type: "String", isArray: false },
      Text: { type: "String", isArray: false },
      ActorRole: { type: "String", isArray: false },
      AcceptanceCriteria: { type: "String", isArray: true },
      Priority: { type: "String", isArray: false },
      EstimateHours: { type: "Float", isArray: false },
      SortOrder: { type: "Int", isArray: false },
    },
  },
  {
    name: "Milestone",
    hasIsExample: false,
    startOnly: false,
    uniques: [["ProjectId","ScopeVersion","Number"]],
    fields: {
      ProjectId: { type: "String", isArray: false },
      ScopeVersion: { type: "Int", isArray: false },
      Number: { type: "Int", isArray: false },
      Name: { type: "String", isArray: false },
      Goal: { type: "String", isArray: false },
      FeatureRefs: { type: "String", isArray: true },
      SortOrder: { type: "Int", isArray: false },
      PreviewPoint: { type: "String", isArray: false },
      Status: { type: "String", isArray: false },
      EngineJobId: { type: "String", isArray: false },
    },
  },
  {
    name: "ApprovalPolicy",
    hasIsExample: false,
    startOnly: false,
    uniques: [["ProjectId","Environment"]],
    fields: {
      ProjectId: { type: "String", isArray: false },
      Environment: { type: "String", isArray: false },
      Status: { type: "String", isArray: false },
      AllApproversRequired: { type: "Boolean", isArray: false },
      Note: { type: "String", isArray: false },
    },
  },
  {
    name: "ApprovalStep",
    hasIsExample: false,
    startOnly: false,
    uniques: [["ParentId","StepKey"]],
    fields: {
      ProjectId: { type: "String", isArray: false },
      ParentType: { type: "String", isArray: false },
      ParentId: { type: "String", isArray: false },
      StepKey: { type: "String", isArray: false },
      StepType: { type: "String", isArray: false },
      Label: { type: "String", isArray: false },
      Required: { type: "Boolean", isArray: false },
      ApproverUserIds: { type: "String", isArray: true },
      Decision: { type: "String", isArray: false },
      DecidedByUserId: { type: "String", isArray: false },
      DecidedAt: { type: "DateTime", isArray: false },
      Comment: { type: "String", isArray: false },
      SortOrder: { type: "Int", isArray: false },
    },
  },
];

const BY_NAME: Record<string, SeedSchema> = Object.fromEntries(SEED_SCHEMAS.map((s) => [s.name, s]));

export function seedSchema(name: string): SeedSchema | undefined {
  return Object.prototype.hasOwnProperty.call(BY_NAME, name) ? BY_NAME[name] : undefined;
}

/** Children first. */
export const SEED_REMOVE_ORDER: readonly string[] = SEED_SCHEMAS.map((s) => s.name).reverse();

export function seedKeyOf(a: { workspaceId: string; scenario: string; schema: string; key: string }): string {
  return a.schema === "Workspace" ? `${a.scenario}:${a.key}` : `${a.workspaceId}:${a.scenario}:${a.key}`;
}

export function seedRequestKey(seedKey: string): string {
  return `seed:${seedKey}`;
}

export type SeedScalar = string | number | boolean | string[] | number[] | boolean[];

export interface SeedRecord {
  key: string;
  fields: Record<string, SeedScalar>;
  /** field -> "Schema:key" token(s) */
  refs: Record<string, string | string[]>;
  /** field -> "user", "user#email" or "user#name" token(s) */
  users: Record<string, string | string[]>;
  /** field -> relative time like "-3d+2h" */
  at: Record<string, string>;
}

export interface SeedFieldError {
  field: string;
  rule: string;
}

export type SeedParse<T> = { ok: true; value: T } | { ok: false; errors: SeedFieldError[] };

const INT_MIN = -(2 ** 31);
const INT_MAX = 2 ** 31 - 1;
const ISO_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;
const DIRECTIVES = ["$key", "$ref", "$user", "$at"];
const REF_RE = /^([A-Za-z0-9]+):(.+)$/;
const USER_RE = /^([^#]+)(?:#(email|name))?$/;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function parseRef(token: string): { schema: string; key: string } | null {
  if (typeof token !== "string") return null;
  const m = REF_RE.exec(token);
  if (!m || !seedSchema(m[1])) return null;
  return { schema: m[1], key: m[2] };
}

export function parseUserRef(token: string): { user: string; part: "id" | "email" | "name" } | null {
  if (typeof token !== "string") return null;
  const m = USER_RE.exec(token);
  if (!m) return null;
  return { user: m[1], part: (m[2] as "email" | "name" | undefined) ?? "id" };
}

function scalarOk(f: SeedField, x: unknown): boolean {
  switch (f.type) {
    case "String":
    case "ID":
      return typeof x === "string";
    case "Int":
      return Number.isInteger(x) && (x as number) >= INT_MIN && (x as number) <= INT_MAX;
    case "Float":
      return typeof x === "number" && Number.isFinite(x);
    case "Boolean":
      return typeof x === "boolean";
    case "DateTime":
      return typeof x === "string" && ISO_RE.test(x) && !Number.isNaN(Date.parse(x));
  }
}

function typeRule(f: SeedField, v: unknown): string | null {
  if (f.isArray) {
    if (!Array.isArray(v)) return "array";
    return v.every((x) => scalarOk(f, x)) ? null : "type";
  }
  if (Array.isArray(v)) return "notArray";
  return scalarOk(f, v) ? null : "type";
}

export function parseSeedRecord(schema: string, raw: unknown): SeedParse<SeedRecord> {
  const errors: SeedFieldError[] = [];
  const def = seedSchema(schema);
  if (!def) return { ok: false, errors: [{ field: "$schema", rule: "unknown" }] };
  if (!isObj(raw)) return { ok: false, errors: [{ field: "$record", rule: "object" }] };
  const key = raw.$key;
  if (typeof key !== "string" || !SEED_KEY_PATTERN.test(key)) errors.push({ field: "$key", rule: "pattern" });

  const value: SeedRecord = { key: typeof key === "string" ? key : "", fields: {}, refs: {}, users: {}, at: {} };
  const set = new Set<string>();
  const known = (f: string): boolean => {
    if (SEED_STAMPED_FIELDS.includes(f)) return errors.push({ field: f, rule: "stamped" }), false;
    if (SEED_SYSTEM_FIELDS.includes(f)) return errors.push({ field: f, rule: "system" }), false;
    if (!Object.prototype.hasOwnProperty.call(def.fields, f)) return errors.push({ field: f, rule: "unknown" }), false;
    return true;
  };
  const claim = (f: string): boolean => {
    if (set.has(f)) {
      errors.push({ field: f, rule: "duplicate" });
      return false;
    }
    set.add(f);
    return true;
  };

  for (const [f, v] of Object.entries(raw)) {
    if (f.startsWith("$")) {
      if (!DIRECTIVES.includes(f)) errors.push({ field: f, rule: "directive" });
      continue;
    }
    if (!known(f) || !claim(f)) continue;
    const rule = typeRule(def.fields[f], v);
    if (rule) errors.push({ field: f, rule });
    else value.fields[f] = v as SeedScalar;
  }

  for (const dir of ["$ref", "$user", "$at"] as const) {
    const d = raw[dir];
    if (d === undefined) continue;
    if (!isObj(d)) {
      errors.push({ field: dir, rule: "object" });
      continue;
    }
    for (const [f, v] of Object.entries(d)) {
      if (!known(f) || !claim(f)) continue;
      const field = def.fields[f];
      if (dir === "$at") {
        if (field.type !== "DateTime") errors.push({ field: f, rule: "atType" });
        else if (field.isArray) errors.push({ field: f, rule: "notArray" });
        else if (typeof v !== "string" || !RELATIVE_AT_PATTERN.test(v)) errors.push({ field: f, rule: "atPattern" });
        else value.at[f] = v;
        continue;
      }
      if (field.type !== "String" && field.type !== "ID") {
        errors.push({ field: f, rule: `${dir === "$ref" ? "ref" : "user"}Type` });
        continue;
      }
      if (Array.isArray(v) !== field.isArray) {
        errors.push({ field: f, rule: field.isArray ? "array" : "notArray" });
        continue;
      }
      const toks = Array.isArray(v) ? v : [v];
      let bad = false;
      for (const t of toks) {
        if (typeof t !== "string" || (dir === "$ref" ? !parseRef(t) : !parseUserRef(t))) {
          errors.push({ field: f, rule: dir === "$ref" ? "refToken" : "userToken" });
          bad = true;
          break;
        }
      }
      if (bad) continue;
      (dir === "$ref" ? value.refs : value.users)[f] = v as string | string[];
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, value };
}

export function parseSeedRecords(schema: string, raws: readonly unknown[]): SeedParse<SeedRecord[]> {
  const errors: SeedFieldError[] = [];
  const out: SeedRecord[] = [];
  const keys = new Set<string>();
  for (const raw of raws) {
    const r = parseSeedRecord(schema, raw);
    if (!r.ok) {
      errors.push(...r.errors);
      continue;
    }
    if (keys.has(r.value.key)) errors.push({ field: "$key", rule: "duplicate" });
    keys.add(r.value.key);
    out.push(r.value);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

/** anchor + a relative offset like "-3d+2h" or "+1d-30m"; null when malformed. */
export function relativeAt(anchorIso: string, rel: string): string | null {
  if (typeof rel !== "string" || !RELATIVE_AT_PATTERN.test(rel)) return null;
  const t = Date.parse(anchorIso);
  if (Number.isNaN(t)) return null;
  const unit: Record<string, number> = { d: 86400000, h: 3600000, m: 60000 };
  let ms = 0;
  for (const m of rel.matchAll(/([+-])([0-9]+)([dhm])/g)) ms += (m[1] === "-" ? -1 : 1) * Number(m[2]) * unit[m[3]];
  const d = new Date(t + ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** The anchor may not be in the future (beyond the skew) nor older than 24 h. */
export function anchorAllowed(anchorIso: string, nowIso: string): boolean {
  const a = Date.parse(anchorIso);
  const n = Date.parse(nowIso);
  if (Number.isNaN(a) || Number.isNaN(n)) return false;
  return a <= n + SEED_LIMITS.anchorSkewMs && a >= n - SEED_LIMITS.anchorMaxAgeMs;
}

export interface ResolvedUser {
  userId: string;
  email: string;
  displayName: string;
}

const tokensOf = (v: string | string[]): string[] => (Array.isArray(v) ? v : [v]);

export function refTargets(rec: SeedRecord): { field: string; schema: string; key: string }[] {
  const out: { field: string; schema: string; key: string }[] = [];
  for (const [field, v] of Object.entries(rec.refs)) {
    for (const t of tokensOf(v)) {
      const p = parseRef(t);
      if (p) out.push({ field, schema: p.schema, key: p.key });
    }
  }
  return out;
}

export function userKeysOf(rec: SeedRecord): string[] {
  const out = new Set<string>();
  for (const v of Object.values(rec.users)) {
    for (const t of tokensOf(v)) {
      const p = parseUserRef(t);
      if (p) out.add(p.user);
    }
  }
  return [...out];
}

export type ResolveResult =
  | { ok: true; row: Record<string, SeedScalar> }
  | { ok: false; missingRefs: { field: string; ref: string }[]; missingUsers: string[] };

export function resolveRecord(
  rec: SeedRecord,
  ctx: { refs: Record<string, string>; users: Record<string, ResolvedUser>; anchorIso: string },
): ResolveResult {
  const missingRefs: { field: string; ref: string }[] = [];
  const missingUsers = new Set<string>();
  const row: Record<string, SeedScalar> = { ...rec.fields };

  for (const [field, v] of Object.entries(rec.refs)) {
    const ids: string[] = [];
    for (const t of tokensOf(v)) {
      const id = Object.prototype.hasOwnProperty.call(ctx.refs, t) ? ctx.refs[t] : undefined;
      if (id === undefined) missingRefs.push({ field, ref: t });
      else ids.push(id);
    }
    row[field] = Array.isArray(v) ? ids : ids[0];
  }
  for (const [field, v] of Object.entries(rec.users)) {
    const vals: string[] = [];
    for (const t of tokensOf(v)) {
      const p = parseUserRef(t);
      const u = p && Object.prototype.hasOwnProperty.call(ctx.users, p.user) ? ctx.users[p.user] : undefined;
      if (!p || !u) {
        if (p) missingUsers.add(p.user);
        continue;
      }
      vals.push(p.part === "email" ? u.email : p.part === "name" ? u.displayName : u.userId);
    }
    row[field] = Array.isArray(v) ? vals : vals[0];
  }
  for (const [field, rel] of Object.entries(rec.at)) {
    const iso = relativeAt(ctx.anchorIso, rel);
    if (iso) row[field] = iso;
  }
  if (missingRefs.length || missingUsers.size) return { ok: false, missingRefs, missingUsers: [...missingUsers] };
  return { ok: true, row };
}
