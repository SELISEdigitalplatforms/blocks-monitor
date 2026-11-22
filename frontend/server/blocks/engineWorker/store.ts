// The Blocks worker's row store: the engine's writers read rows synchronously (RowStore: rows, get, conflict), so the
// worker keeps a snapshot of the Data Gateway rows a job needs and keeps it current itself:
//
//   - loadProject(id) reads every project schema of the tenant for the project (plus the workspace's members) right
//     before a job is claimed or resumed (driver.ts prepare), so a writer always starts from the current rows;
//   - refreshJobs() reads the active EngineJob rows on every poll, so a cancel by a person reaches run.check() (the
//     jobs' Project rows only when one is new, or in the background once a minute: loadProject reads it before every
//     job anyway);
//   - every write of a writer goes through mirrored(), which writes to the Data Gateway first and then puts the same
//     change into the snapshot (a writer reads back what it wrote, exactly like the local store).
//
// EngineJob updates are conditional (updateMany on ItemId + the Status and Attempts the worker last saw): a job is
// never claimed twice and a cancelled job is never moved on. A miss reads the row again, so the driver and run.check()
// see what really happened. Never logs row values or secrets.
import fs from "node:fs";
import path from "node:path";
import { f, type Filter } from "../../../functions/_lib/filter";
import type { RawGateway, Row } from "../../../functions/_lib/gateway";
import type { SdkClient } from "../../../functions/_lib/sdk";
import type { RowStore } from "../../local/rowStore.ts";
import { acceptsWorkerJob, type WorkerJobScope } from "./jobScope.ts";
import { HOST_MAINTENANCE_KIND } from "../../../src/domain/engineJob";

const ACTIVE = ["queued", "claimed", "running"] as const;
/** The ErrorCode of a design job a person asked to stop (functions/_lib/jobs.ts cancel). */
const DESIGN_STOP_REQUESTED = "design.stopRequested";

/** The projects this engine leaves to another engine of the owner (a test engine): one project id per line in the file
 *  MF_ENGINE_SKIP_PROJECTS_FILE, re-read when it changes. None when the setting or the file is missing. */
let skipCache: { file: string; mtimeMs: number; ids: Set<string> } | null = null;
export function skippedProjects(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const file = String(env.MF_ENGINE_SKIP_PROJECTS_FILE ?? "").trim();
  if (!file) return new Set();
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return new Set();
  }
  if (skipCache && skipCache.file === file && skipCache.mtimeMs === mtimeMs) return skipCache.ids;
  let ids = new Set<string>();
  try {
    ids = new Set(fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[A-Za-z0-9_-]{8,64}$/.test(l)));
  } catch {
    ids = new Set();
  }
  skipCache = { file, mtimeMs, ids };
  return ids;
}
/** Schemas no writer reads that can hold many rows per project (logs, audit, versions): never loaded. */
const SKIP = new Set(["AuditEvent", "Operation", "Notification", "ItemVersion"]);
const MAX_ROWS = 5000;

/** Retry transient gateway reads, never validation or access refusals. */
export async function retryPreparationRead<T>(read: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await read(); }
    catch (error) {
      const cause = (error as { cause?: { name?: string; errorText?: string } })?.cause;
      const messages = cause?.errorText?.split("\n").filter(Boolean);
      const observed = cause?.name === "GatewayErrors" && messages?.length && messages.every((message) => message === "Unexpected Execution Error");
      const transient = /internal|unavailable|unexpected execution|timed? ?out|econnreset|socket hang up|\b50[234]\b/i.test(error instanceof Error ? error.message : String(error));
      if (attempt >= 4 || (!observed && !transient)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt + Math.floor(Math.random() * 150)));
    }
  }
}

/** Keep preparation reads below the gateway's burst limit; a failed read still rejects the snapshot. */
export async function readProjectSchemas<T>(schemas: string[], read: (schema: string) => Promise<T>): Promise<T[]> {
  const results = new Array<T>(schemas.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, schemas.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= schemas.length) return;
      results[index] = await read(schemas[index]!);
    }
  }));
  return results;
}

/** The readable (scalar or scalar-list) fields of every type the tenant's Data Gateway has. */
export async function tenantFields(client: () => Promise<SdkClient>): Promise<Map<string, string[]>> {
  const c = await client();
  const body = (await c.data.graphql({
    query: `{ __schema { types { name kind fields { name type { kind ofType { kind ofType { kind ofType { kind } } } } } } } }`,
  })) as { data?: { __schema?: { types?: { name: string; kind: string; fields?: { name: string; type: unknown }[] | null }[] } } };
  const types = body?.data?.__schema?.types;
  if (!Array.isArray(types)) throw new Error("schema introspection answered nothing");
  const leaf = (t: unknown): boolean => {
    let cur = t as { kind?: string; ofType?: unknown } | null;
    while (cur && (cur.kind === "NON_NULL" || cur.kind === "LIST")) cur = cur.ofType as typeof cur;
    return cur?.kind === "SCALAR" || cur?.kind === "ENUM";
  };
  const out = new Map<string, string[]>();
  for (const t of types) {
    if (t.kind !== "OBJECT" || !Array.isArray(t.fields) || t.name.startsWith("__")) continue;
    out.set(t.name, t.fields.filter((x) => leaf(x.type)).map((x) => x.name));
  }
  return out;
}

/** Local schema files that carry ProjectId (blocks/data/schemas/*.json). */
export function projectSchemas(root: string): string[] {
  const dir = path.join(root, "blocks", "data", "schemas");
  const out: string[] = [];
  for (const file of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    try {
      const doc = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8")) as { schemaName?: string; fields?: { name?: string }[] };
      if (typeof doc.schemaName === "string" && (doc.fields ?? []).some((x) => x?.name === "ProjectId")) out.push(doc.schemaName);
    } catch {
      /* a schema file being edited is read on the next catalog refresh */
    }
  }
  return out;
}

/** Unique field lists per schema (blocks/data/indexes.json), RequestKey first. */
function uniqueIndexes(root: string): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(root, "blocks", "data", "indexes.json"), "utf8")) as {
      schemas?: { schemaName: string; indexes: { fields: string[]; unique?: boolean }[] }[];
    };
    for (const s of doc.schemas ?? []) {
      out.set(s.schemaName, s.indexes.filter((i) => i.unique === true).map((i) => i.fields.map((x) => x.split(":")[0]!)));
    }
  } catch {
    /* RequestKey only */
  }
  return out;
}

export interface Catalog {
  /** Fields to read for a schema the tenant has; null when the tenant does not have the schema (yet). */
  fields(schema: string): string[] | null;
  /** The project schemas the tenant has, minus the skipped ones. */
  projectSchemas(): string[];
  /** Schemas in the repository that the tenant does not have (logged once per refresh). */
  missing(): string[];
}

export async function loadCatalog(root: string, client: () => Promise<SdkClient>): Promise<Catalog> {
  const tenant = await tenantFields(client);
  const local = projectSchemas(root);
  const missing = local.filter((s) => !tenant.has(s));
  return {
    fields: (schema) => tenant.get(schema) ?? null,
    projectSchemas: () => local.filter((s) => tenant.has(s) && !SKIP.has(s)),
    missing: () => missing,
  };
}

export interface GatewayStore extends RowStore {
  /** Reads the project's rows of every project schema (or only the `only` ones) and the workspace's members into the
   *  snapshot, in one parallel round when the workspace is known (the job row's WorkspaceId). */
  loadProject(projectId: string, keepJobs?: ReadonlySet<string>, hint?: { workspaceId?: string; only?: readonly string[]; dropIf?: () => boolean }): Promise<boolean>;
  /** Reads the active EngineJob rows (created at or after `since`) and their Project rows; answers the jobs. */
  refreshJobs(since: string | null, scope?: WorkerJobScope): Promise<Row[]>;
  /** Reads one row again (null when it is gone). */
  refreshRow(schema: string, itemId: string): Promise<Row | null>;
  /** The gateway the engine writes through: Data Gateway first, then the snapshot. */
  mirrored(): RawGateway;
  setCatalog(c: Catalog): void;
}

export function createGatewayStore(o: { root: string; raw: RawGateway; client: () => Promise<SdkClient>; invalidateToken(): void; catalog: Catalog; now?: () => Date }): GatewayStore {
  const tables = new Map<string, Map<string, Row>>();
  const unique = uniqueIndexes(o.root);
  let catalog = o.catalog;
  const now = o.now ?? (() => new Date());
  /** When each Project row was last read (refreshJobs reads a known one again only after PROJECT_REFRESH_MS). */
  const projectReadAt = new Map<string, number>();
  /** When this worker last wrote each EngineJob row: a read that started before it is older than the snapshot. */
  const jobWrittenAt = new Map<string, number>();
  const newerHere = (id: string, readStarted: number): boolean => (jobWrittenAt.get(id) ?? 0) >= readStarted;
  const PROJECT_REFRESH_MS = 60_000;

  const table = (schema: string): Map<string, Row> => {
    let t = tables.get(schema);
    if (!t) tables.set(schema, (t = new Map()));
    return t;
  };
  const put = (schema: string, row: Row): void => {
    const id = row.ItemId;
    if (typeof id !== "string" || !id) return;
    table(schema).set(id, row);
  };
  const fieldsOf = (schema: string): string[] => {
    const list = catalog.fields(schema);
    if (!list || list.length === 0) throw new Error(`the Data Gateway has no schema ${schema}`);
    return list;
  };

  // The tenant's Data Gateway fails a share of reads at random ("Unexpected Execution Error" / internal, unavailable).
  // A project load reads every project schema, so one such answer would stop the job: each read is tried again a few
  // times with short pauses before it counts as failed. Other errors are not retried.
  async function readAll(schema: string, where: Filter): Promise<Row[]> {
    const fields = fieldsOf(schema);
    const sort = fields.includes("CreatedDate") ? { field: "CreatedDate", dir: "asc" as const } : undefined;
    try {
      return await retryPreparationRead(() => o.raw.findAll(schema, { where, fields, sort, max: MAX_ROWS }));
    } catch (cause) {
      throw new Error(`Project preparation could not read ${schema}`, { cause });
    }
  }

  /** Replaces the snapshot's rows of a schema that match `belongs` with `rows` (kept: the ids in `keep`). */
  function replace(schema: string, belongs: (r: Row) => boolean, rows: Row[], keep?: ReadonlySet<string>, readStarted?: number): void {
    const t = table(schema);
    // an EngineJob this worker wrote after the read started keeps the snapshot's (newer) state
    const kept = (id: string) => keep?.has(id) || (schema === "EngineJob" && readStarted !== undefined && newerHere(id, readStarted));
    for (const [id, r] of t) if (belongs(r) && !kept(id)) t.delete(id);
    for (const r of rows) if (!kept(String(r.ItemId))) put(schema, r);
  }

  /** updateMany with a filter, straight through the SDK: true when a row matched (the gateway's updateMany treats a miss
   *  as an error, and a miss is an ordinary answer here). */
  async function updateWhere(schema: string, filter: Record<string, unknown>, patch: Row): Promise<boolean> {
    const name = `updateMany${schema}`;
    const query = `mutation ${name}($filter: String, $input: ${schema}UpdateInput!) {
  ${name}(filter: $filter, input: $input) { acknowledged message totalImpactedData }
}`;
    for (let attempt = 0; ; attempt += 1) {
      try {
        const c = await o.client();
        const body = (await c.data.graphql({ operationName: name, query, variables: { filter: JSON.stringify(filter), input: patch } })) as {
          data?: Record<string, { acknowledged?: boolean; totalImpactedData?: number } | null>;
          errors?: unknown[];
        };
        if (Array.isArray(body?.errors) && body.errors.length > 0) throw new Error(`${schema} update was refused by the Data Gateway`);
        const r = body?.data?.[name];
        return r?.acknowledged === true && (r.totalImpactedData ?? 1) > 0;
      } catch (e) {
        const status = (e as { status?: unknown } | null)?.status;
        if (status === 401 && attempt === 0) {
          o.invalidateToken();
          continue;
        }
        // never the SDK's message (it can carry row values): the status only
        throw new Error(`${schema} update failed (${typeof status === "number" ? `HTTP ${status}` : e instanceof Error ? e.name : "error"})`);
      }
    }
  }

  const store: GatewayStore = {
    rows: (schema) => [...table(schema).values()],
    get: (schema, itemId) => table(schema).get(itemId),
    conflict(schema, row, exceptId) {
      const lists = [["RequestKey"], ...(unique.get(schema) ?? [])];
      for (const fields of lists) {
        if (fields.some((x) => row[x] === undefined || row[x] === null)) continue;
        const key = JSON.stringify(fields.map((x) => row[x]));
        for (const r of table(schema).values()) {
          if (r.ItemId === exceptId) continue;
          if (JSON.stringify(fields.map((x) => r[x])) === key) return { fields, itemId: String(r.ItemId) };
        }
      }
      return null;
    },
    insert() {
      throw new Error("the Blocks worker's store is written through its gateway");
    },
    update() {
      throw new Error("the Blocks worker's store is written through its gateway");
    },
    remove() {
      throw new Error("the Blocks worker's store is written through its gateway");
    },
    transaction: (fn) => fn(),
    onChange() {
      /* no listeners: the worker polls */
    },
    schemaNames: () => [...tables.keys()],
    reload() {
      tables.clear();
    },
    setCatalog(c) {
      catalog = c;
    },

    async loadProject(projectId, keepJobs, hint) {
      // the workspace's members and their accounts (ProjectView.personName / members)
      const loadMembers = async (workspaceId: string): Promise<void> => {
        if (!workspaceId || !catalog.fields("Membership")) return;
        const members = await readAll("Membership", f.eq("WorkspaceId", workspaceId));
        const userIds = [...new Set(members.map((m) => m.UserId).filter((x): x is string => typeof x === "string" && x !== ""))];
        const accounts = userIds.length > 0 && catalog.fields("Account") ? await readAll("Account", f.in("UserId", userIds.slice(0, 500))) : [];
        replace("Membership", (r) => r.WorkspaceId === workspaceId, members);
        if (userIds.length > 0 && catalog.fields("Account")) {
          const ids = new Set(userIds);
          replace("Account", (r) => ids.has(String(r.UserId)), accounts);
        }
      };
      const where = f.eq("ProjectId", projectId);
      // `only`: a light refresh of these schemas (the rows of the others stay as the last full load read them)
      const schemas = hint?.only ? catalog.projectSchemas().filter((s) => hint.only!.includes(s)) : catalog.projectSchemas();
      const hinted = hint?.workspaceId ?? "";
      const readStarted = Date.now();
      // Load every schema before replacing the snapshot; limit concurrent collection reads.
      const [project, results] = await Promise.all([
        retryPreparationRead(() => o.raw.get("Project", projectId, fieldsOf("Project"))),
        readProjectSchemas(schemas, (s) => readAll(s, where)),
        loadMembers(hinted),
      ]);
      // `dropIf`: the answer is thrown away when it says so now (a job of the project started meanwhile: its own load
      // is the current one, and an older answer must never replace what the job wrote since)
      if (hint?.dropIf?.()) return false;
      if (!project) {
        table("Project").delete(projectId);
        return true;
      }
      put("Project", project);
      projectReadAt.set(projectId, Date.now());
      const mine = (r: Row) => r.ProjectId === projectId;
      schemas.forEach((s, i) => replace(s, mine, results[i]!, s === "EngineJob" ? keepJobs : undefined, readStarted));
      const workspaceId = typeof project.WorkspaceId === "string" ? project.WorkspaceId : "";
      if (workspaceId !== hinted) await loadMembers(workspaceId);
      return true;
    },

    async refreshJobs(since, scope) {
      // The Data Gateway does not compare its date fields with a string range ($gte answers nothing): the cutoff is
      // applied here. Active jobs are few.
      const readStarted = Date.now();
      const active = f.in("Status", [...ACTIVE]);
      // An operator scope (projects or kinds) filters the project work; the host-maintenance kind belongs to no
      // project and must stay visible to every worker, so it is read separately and merged (the filter lib has no or).
      const filtered = (scope?.projectIds.length ?? 0) > 0 || (scope?.kinds.length ?? 0) > 0;
      const all = (await Promise.all([
        filtered
          ? readAll("EngineJob", f.and(active,
              ...(scope?.projectIds.length ? [f.in("ProjectId", scope.projectIds)] : []),
              ...(scope?.kinds.length ? [f.in("Kind", scope.kinds)] : [])))
          : readAll("EngineJob", active),
        ...(filtered ? [readAll("EngineJob", f.and(active, f.eq("Kind", HOST_MAINTENANCE_KIND)))] : []),
      ])).flat();
      const rows = [...new Map(all.map((j) => [String(j.ItemId), j])).values()];
      const seen = new Set(rows.map((j) => String(j.ItemId)));
      const cutoff = since ? Date.parse(since) : NaN;
      const recent = Number.isFinite(cutoff) ? rows.filter((j) => Date.parse(String(j.CreatedDate ?? "")) >= cutoff) : rows;
      // projects another engine of the owner works on (a test engine): left to it entirely
      const skip = skippedProjects();
      const jobs = skip.size ? recent.filter((j) => !skip.has(String(j.ProjectId ?? ""))) : recent;
      // a job this worker moved on (finished, progressed) after the read started keeps its newer state
      for (const j of jobs) if (!newerHere(String(j.ItemId), readStarted)) put("EngineJob", j);
      // active in the snapshot but no longer in the answer: cancelled, finished elsewhere or removed
      const gone = [...table("EngineJob").values()].filter((j) => (!scope || acceptsWorkerJob(scope, j)) && (ACTIVE as readonly unknown[]).includes(j.Status) && !seen.has(String(j.ItemId)) && !newerHere(String(j.ItemId), readStarted));
      const readProjects = async (ids: string[]): Promise<void> => {
        if (ids.length === 0) return;
        const projects = await readAll("Project", f.in("ItemId", ids));
        const found = new Set(projects.map((p) => String(p.ItemId)));
        for (const p of projects) put("Project", p);
        for (const id of ids) if (!found.has(id)) table("Project").delete(id);
      };
      const at = Date.now();
      const ids = [...new Set(jobs.map((j) => j.ProjectId).filter((x): x is string => typeof x === "string" && x !== ""))];
      // a project new to the snapshot is read before the jobs are looked at; a known one again now and then, in the
      // background (loadProject reads it before each job anyway)
      const unknown = ids.filter((id) => !table("Project").has(id));
      const stale = ids.filter((id) => table("Project").has(id) && at - (projectReadAt.get(id) ?? 0) > PROJECT_REFRESH_MS);
      for (const id of [...unknown, ...stale]) projectReadAt.set(id, at);
      if (stale.length > 0) void readProjects(stale).catch(() => undefined);
      await Promise.all([...gone.map((j) => store.refreshRow("EngineJob", String(j.ItemId))), readProjects(unknown)]);
      return jobs;
    },

    async refreshRow(schema, itemId) {
      const row = await retryPreparationRead(() => o.raw.get(schema, itemId, fieldsOf(schema)));
      if (row) put(schema, row);
      else table(schema).delete(itemId);
      return row;
    },

    mirrored() {
      const raw = o.raw;
      const stamp = (): Row => {
        const at = now().toISOString();
        return { CreatedDate: at, LastUpdatedDate: at, IsDeleted: false };
      };
      return {
        get: (schema, itemId, fields) => raw.get(schema, itemId, fields),
        find: (schema, opts) => raw.find(schema, opts),
        findAll: (schema, opts) => raw.findAll(schema, opts),
        async insert(schema, row) {
          const res = await raw.insert(schema, row);
          if (res.itemId && !table(schema).has(res.itemId)) put(schema, { ...stamp(), ...row, ItemId: res.itemId });
          return res;
        },
        async insertMany(schema, rows) {
          const res = await raw.insertMany(schema, rows);
          // the gateway answers no ids: read the rows back by their RequestKeys
          const keys = rows.map((r) => r.RequestKey).filter((k): k is string => typeof k === "string");
          if (keys.length > 0) for (const r of await readAll(schema, f.in("RequestKey", keys))) put(schema, r);
          return res;
        },
        async update(schema, itemId, patch) {
          if (schema !== "EngineJob") {
            await raw.update(schema, itemId, patch);
            const cur = table(schema).get(itemId);
            if (cur) put(schema, { ...cur, ...patch, LastUpdatedDate: now().toISOString() });
            return;
          }
          // EngineJob: only from the state the worker saw (its Status and Attempts). Never a date field: the tenant
          // stores LastUpdatedDate as a date, so an ISO string never equals it, and this worker's own stamp after a
          // write is not the platform's either; a condition on it made every write of a design job miss (08.11.2026:
          // the job stayed "claimed" through its whole run and never got its outcome). A design stop request
          // (jobs.ts cancel: ErrorCode only) wins over any write but the cancellation's own acknowledgement.
          const filterOf = (r: Row | undefined): Record<string, unknown> => {
            const filter: Record<string, unknown> = { ItemId: itemId };
            if (r && typeof r.Status === "string") filter.Status = r.Status;
            if (r && typeof r.Attempts === "number") filter.Attempts = r.Attempts;
            if (r?.Kind === "design.generate" && patch.Status !== "cancelled") filter.ErrorCode = { $ne: DESIGN_STOP_REQUESTED };
            return filter;
          };
          const cur = table(schema).get(itemId);
          // A stop request must win over progress/success written from an older snapshot.
          if (cur?.Kind === "design.generate" && cur.ErrorCode === DESIGN_STOP_REQUESTED && patch.Status !== "cancelled") return;
          if (await updateWhere(schema, filterOf(cur), patch)) {
            jobWrittenAt.set(itemId, Date.now());
            if (cur) put(schema, { ...cur, ...patch, LastUpdatedDate: now().toISOString() });
            return;
          }
          // A miss: read the row. When the snapshot was only behind (a poll answer that arrived after this worker's own
          // write) and the job is still in a state this write may move, try once more from the state read now. A job a
          // person cancelled, or another attempt's, stays as it is.
          const fresh = await store.refreshRow(schema, itemId);
          if (!fresh || !cur) return;
          // (a claim is never retried: its Attempts came from the state it missed)
          const movable = fresh.ErrorCode !== DESIGN_STOP_REQUESTED && patch.Status !== "claimed" && (fresh.Status === "claimed" || fresh.Status === "running") && fresh.Attempts === cur.Attempts && fresh.ClaimedBy === cur.ClaimedBy;
          if (movable && fresh.Status !== cur.Status && (await updateWhere(schema, filterOf(fresh), patch))) {
            jobWrittenAt.set(itemId, Date.now());
            put(schema, { ...fresh, ...patch, LastUpdatedDate: now().toISOString() });
          }
        },
        async updateMany(schema, where, patch) {
          const res = await raw.updateMany(schema, where, patch);
          for (const r of await readAll(schema, where)) put(schema, r);
          return res;
        },
        async remove(schema, itemId) {
          await raw.remove(schema, itemId);
          table(schema).delete(itemId);
        },
      };
    },
  };
  return store;
}
