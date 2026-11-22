// Leftovers of deleted projects (scripts/purge-orphans.mjs): for every schema with a ProjectId, the rows whose project
// no longer exists or is being deleted. The rules are the delete's own (src/domain/projects.ts):
//   - PROJECT_PURGE_SCHEMAS (a project's work and content, notifications included) lose those rows with --apply, each
//     row's Storage files first; a project still marked 'deleting' is finished by the purge itself (functions/_lib/
//     purge.ts: jobs cancelled, rows, the project.delete audit event, the Project row last);
//   - PROJECT_CASCADE_KEEP (command log, audit trail, credit ledger) is history: only counted, never touched.
// A row whose ProjectId names no project (empty, or the engine's host-level "system") is never a leftover.
// It prints counts and ids only, never a field value. Reads page by the stored key `_id` (the gateway ignores a sort on
// ItemId, so such pages overlap), de-duplicate by ItemId and refuse a short read.
import { loadEnv } from "vite";
import type { FnEnv } from "../../functions/_lib/env";
import { OpError } from "../../functions/_lib/errors";
import { createRawGateway, type RawGateway, type Row } from "../../functions/_lib/gateway";
import { runPurgeTick, type PurgeTickResult } from "../../functions/_lib/purge";
import { uuid5 } from "../../functions/_lib/ids";
import { defaultSdk, type SdkClient } from "../../functions/_lib/sdk";
import { serviceClient, serviceTokens } from "../../functions/_lib/serviceToken";
import { createFiles } from "../../functions/_lib/storage";
import {
  PROJECT_CASCADE_KEEP, PROJECT_PURGE_SCHEMAS, cascadeFieldsOf, fileIdsOf, isDeletingProject, namesProject,
} from "../../src/domain/projects";

/** Every row of `schema` with these fields, or null when the tenant has no such schema. */
export type ListAll = (schema: string, fields: readonly string[]) => Promise<Row[] | null>;

export type OrphanDecision = "delete" | "keep";

/** The schemas the scan covers, each with what the delete does to a deleted project's rows there. */
export const ORPHAN_SCHEMAS: readonly { schema: string; decision: OrphanDecision }[] = [
  ...PROJECT_PURGE_SCHEMAS.map((schema) => ({ schema, decision: "delete" as const })),
  ...PROJECT_CASCADE_KEEP.map(({ schema }) => ({ schema, decision: "keep" as const })),
];

export interface SchemaOrphans {
  schema: string;
  decision: OrphanDecision;
  /** Rows read; null when the schema is not on this tenant. */
  total: number | null;
  /** Rows of projects that no longer exist (ItemId and the Storage-file fields only). */
  gone: Row[];
  /** Rows of projects still marked 'deleting' (the purge removes them). */
  deleting: Row[];
}

export interface OrphanPlan {
  liveProjects: number;
  deletingProjectIds: string[];
  /** Deleted projects with rows to remove. */
  goneProjectIds: string[];
  /** Deleted projects of which only kept history remains. */
  historyOnlyProjectIds: string[];
  schemas: SchemaOrphans[];
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/**
 * Reads the projects, then every covered schema, then the projects again: a project created while the scan runs is
 * known by the second read, so its new rows are never taken for leftovers.
 */
export async function planOrphans(listAll: ListAll, schemas = ORPHAN_SCHEMAS): Promise<OrphanPlan> {
  const readProjects = async () => {
    const rows = await listAll("Project", ["ItemId", "Status"]);
    if (!rows) throw new Error("The tenant has no Project schema.");
    return rows;
  };
  const before = await readProjects();
  const read: { schema: string; decision: OrphanDecision; rows: Row[] | null }[] = [];
  // one schema at a time: a scan never competes with people's requests for the gateway
  for (const { schema, decision } of schemas) read.push({ schema, decision, rows: await listAll(schema, [...cascadeFieldsOf(schema), "ProjectId"]) });
  const after = await readProjects();

  const known = new Set([...before, ...after].map((p) => str(p.ItemId)).filter(Boolean));
  // the newest status counts: a project marked 'deleting' during the scan is being deleted
  const status = new Map<string, Row>();
  for (const p of [...before, ...after]) status.set(str(p.ItemId), p);
  const deletingIds = new Set([...status.entries()].filter(([, p]) => isDeletingProject(p)).map(([id]) => id));
  const goneIds = new Set<string>();
  const historyIds = new Set<string>();

  const out: SchemaOrphans[] = read.map(({ schema, decision, rows }) => {
    const gone: Row[] = [];
    const deleting: Row[] = [];
    for (const row of rows ?? []) {
      const projectId = row.ProjectId;
      if (!namesProject(projectId) || !str(row.ItemId)) continue;
      const keep: Row = { ItemId: row.ItemId, ProjectId: projectId };
      for (const field of cascadeFieldsOf(schema)) if (field in row) keep[field] = row[field];
      if (deletingIds.has(projectId)) deleting.push(keep);
      else if (!known.has(projectId)) {
        gone.push(keep);
        (decision === "delete" ? goneIds : historyIds).add(projectId);
      }
    }
    return { schema, decision, total: rows ? rows.length : null, gone, deleting };
  });
  return {
    liveProjects: known.size - deletingIds.size,
    deletingProjectIds: [...deletingIds].sort(),
    goneProjectIds: [...goneIds].sort(),
    historyOnlyProjectIds: [...historyIds].filter((id) => !goneIds.has(id)).sort(),
    schemas: out,
  };
}

/** The report: per schema the decision, the counts and the leftover ids (ids only, never a value). */
export function orphanReport(plan: OrphanPlan, o: { ids?: boolean } = {}): string[] {
  const lines: string[] = [];
  lines.push(`Projects: ${plan.liveProjects} live, ${plan.deletingProjectIds.length} being deleted, ${plan.goneProjectIds.length} deleted with rows to remove, ${plan.historyOnlyProjectIds.length} deleted with only history kept`);
  if (plan.deletingProjectIds.length) lines.push(`  being deleted: ${plan.deletingProjectIds.join(", ")}`);
  if (plan.goneProjectIds.length) lines.push(`  deleted, rows to remove: ${plan.goneProjectIds.join(", ")}`);
  lines.push("schema | decision | rows | of deleted projects | of projects being deleted");
  for (const s of plan.schemas) {
    lines.push(`${s.schema} | ${s.decision} | ${s.total === null ? "not on this tenant" : s.total} | ${s.gone.length} | ${s.deleting.length}`);
    if (o.ids !== false && s.decision === "delete") {
      if (s.gone.length) lines.push(`  deleted projects' rows: ${s.gone.map((r) => str(r.ItemId)).join(", ")}`);
      if (s.deleting.length) lines.push(`  rows of projects being deleted: ${s.deleting.map((r) => str(r.ItemId)).join(", ")}`);
    }
  }
  const del = plan.schemas.filter((s) => s.decision === "delete");
  const keep = plan.schemas.filter((s) => s.decision === "keep");
  const sum = (list: SchemaOrphans[], k: "gone" | "deleting") => list.reduce((n, s) => n + s[k].length, 0);
  lines.push(`To remove: ${sum(del, "gone")} rows of deleted projects; ${sum(del, "deleting")} rows of projects being deleted (finished by the purge)`);
  lines.push(`Kept as history: ${sum(keep, "gone") + sum(keep, "deleting")} rows (${keep.map((s) => s.schema).join(", ")})`);
  return lines;
}

export interface ApplyDeps {
  raw: Pick<RawGateway, "remove">;
  /** Deletes one Storage file; a file already gone is fine. */
  removeFile(fileId: string): Promise<void>;
  /** One tick of the durable project purge (functions/_lib/purge.ts). */
  purgeTick(): Promise<PurgeTickResult>;
  log?: (line: string) => void;
}

export interface ApplyResult {
  removed: Record<string, number>;
  filesRemoved: number;
  purged: string[];
  /** Projects the purge could not finish now (it retries them with backoff on every host). */
  purgeLeft: string[];
}

const MAX_PURGE_TICKS = 200;

/** Removes what the plan lists for removal, by the delete's rules. Kept history is never touched. */
export async function applyOrphans(plan: OrphanPlan, deps: ApplyDeps, o: { concurrency?: number } = {}): Promise<ApplyResult> {
  const log = deps.log ?? (() => undefined);
  const result: ApplyResult = { removed: {}, filesRemoved: 0, purged: [], purgeLeft: [] };

  // 1. Projects still being deleted: the purge finishes them (the same code every host runs).
  if (plan.deletingProjectIds.length) {
    const left = new Set(plan.deletingProjectIds);
    for (let i = 0; i < MAX_PURGE_TICKS && left.size; i += 1) {
      const tick = await deps.purgeTick();
      for (const id of tick.finished) {
        if (left.delete(id)) result.purged.push(id);
      }
      if (tick.picked === 0) break;
    }
    result.purgeLeft = [...left].sort();
    log(`purge: ${result.purged.length} finished, ${result.purgeLeft.length} left for the purge worker`);
  }

  // 2. Rows of projects that no longer exist: Storage files first, then the row.
  const items = plan.schemas.filter((s) => s.decision === "delete").flatMap((s) => s.gone.map((row) => ({ schema: s.schema, row })));
  let next = 0;
  const notFound = (e: unknown) => e instanceof OpError && e.code === "not_found";
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const { schema, row } = items[next++]!;
      for (const fileId of fileIdsOf(schema, row)) {
        await deps.removeFile(fileId);
        result.filesRemoved += 1;
      }
      try {
        await deps.raw.remove(schema, str(row.ItemId));
      } catch (e) {
        if (!notFound(e)) throw e;
      }
      result.removed[schema] = (result.removed[schema] ?? 0) + 1;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(o.concurrency ?? 4, items.length)) }, worker));
  return result;
}

const PAGE = 100;
const MAX_PAGES = 500;

const errorText = (e: unknown): string => {
  const body = (e as { body?: unknown })?.body;
  return `${e instanceof Error ? e.message : String(e)} ${typeof body === "string" ? body : JSON.stringify(body ?? "")}`;
};

/** The service identity's full read of one schema, paged by `_id` (stable), with retries on the gateway's random faults. */
export function sdkListAll(client: () => Promise<SdkClient>, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): ListAll {
  const page = async (schema: string, fields: readonly string[], pageNo: number): Promise<{ items: Row[]; total: number | null } | null> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const body = (await (await client()).data.collection(schema, { fields: [...fields] }).list({ pageNo, pageSize: PAGE, filter: {}, sort: { _id: 1 } })) as {
          data?: Record<string, { items?: Row[]; totalCount?: number }>; errors?: { message?: string }[];
        };
        if (Array.isArray(body?.errors) && body.errors.length) {
          const text = body.errors.map((x) => x?.message ?? "").join("; ");
          if (/does not exist on type `Query`/.test(text)) return null;
          throw new Error(`read ${schema}: ${text.slice(0, 200)}`);
        }
        const r = body?.data?.[`get${schema}s`];
        if (!r || !Array.isArray(r.items)) throw new Error(`read ${schema}: no items in the answer`);
        return { items: r.items, total: typeof r.totalCount === "number" ? r.totalCount : null };
      } catch (e) {
        if (/does not exist on type `Query`/.test(errorText(e))) return null;
        const status = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : 0;
        if (attempt >= 3 || (status >= 400 && status < 500 && status !== 408 && status !== 429)) throw e;
        await sleep(400 * 2 ** attempt);
      }
    }
  };
  return async (schema, fields) => {
    const cols = [...new Set(["ItemId", ...fields])];
    const byId = new Map<string, Row>();
    let total: number | null = null;
    for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo += 1) {
      const p = await page(schema, cols, pageNo);
      if (!p) return null;
      if (p.total !== null) total = p.total;
      const known = byId.size;
      for (const r of p.items) byId.set(str(r.ItemId), r);
      // a full page with nothing new: the paging repeats itself (the short-read check below decides)
      if (p.items.length < PAGE || (total !== null && byId.size >= total) || byId.size === known) break;
    }
    if (total !== null && byId.size !== total) throw new Error(`read ${schema}: ${byId.size} unique rows of ${total}; not trusting a short read`);
    return [...byId.values()];
  };
}

/** `node scripts/purge-orphans.mjs [--dry-run | --apply]`: the dry run (the default) only reads and reports. */
export async function orphansMain(argv: readonly string[], root: string): Promise<number> {
  const apply = argv.includes("--apply");
  if (apply && argv.includes("--dry-run")) {
    console.error("Choose one: --dry-run (the default) or --apply.");
    return 1;
  }
  const e = { ...loadEnv("development", root, ""), ...process.env } as Record<string, string | undefined>;
  const env: FnEnv = {
    apiUrl: (e.VITE_BLOCKS_API_URL || "https://blocksapi.slsblx.com").replace(/\/+$/, ""),
    tenant: e.MF_BLOCKS_TENANT || e.VITE_BLOCKS_PROJECT_KEY || "",
    clientId: e.MF_SVC_CLIENT_ID || "",
    clientSecret: e.MF_SVC_CLIENT_SECRET || "",
  };
  if (!env.tenant || !env.clientId || !env.clientSecret) {
    console.error("MF_BLOCKS_TENANT, MF_SVC_CLIENT_ID and MF_SVC_CLIENT_SECRET are needed (frontend/.env.local).");
    return 1;
  }
  const tokens = serviceTokens(env, defaultSdk);
  const client = serviceClient(env, defaultSdk, tokens);
  console.log(`Tenant ${env.tenant.slice(0, 8)}…: ${apply ? "removing" : "dry run, nothing is written"}`);
  const plan = await planOrphans(sdkListAll(client));
  for (const line of orphanReport(plan)) console.log(line);
  if (!apply) {
    console.log("Dry run: nothing written. Add --apply to remove the rows listed for removal.");
    return 0;
  }
  const raw = createRawGateway({ env, sdk: defaultSdk, tokens, batch: false });
  const files = createFiles({ client, workspaceIdOf: async () => { throw new OpError("internal"); } });
  const removeFile = async (fileId: string) => {
    try {
      await files.remove(fileId);
    } catch (err) {
      if (!(err instanceof OpError && err.code === "not_found")) throw err;
    }
  };
  const res = await applyOrphans(plan, {
    raw,
    removeFile,
    purgeTick: () => runPurgeTick({ raw, files: { remove: removeFile }, ids: { uuid5: (name) => uuid5(name) }, now: () => new Date(),
      log: (level, line) => (level === "info" ? console.log(line) : console.warn(line)) }, { maxProjects: 1, concurrency: 2, budgetMs: 20_000 }),
    log: (line) => console.log(line),
  });
  for (const [schema, n] of Object.entries(res.removed)) console.log(`${schema}: ${n} removed`);
  console.log(`${Object.values(res.removed).reduce((a, b) => a + b, 0)} rows and ${res.filesRemoved} Storage files removed; ${res.purged.length} projects finished by the purge${res.purgeLeft.length ? `, ${res.purgeLeft.length} left for the purge worker (${res.purgeLeft.join(", ")})` : ""}`);
  return 0;
}
