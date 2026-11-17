// seed.remove: removes what one scenario seeded into one workspace, children first, resumable and idempotent.
// The seed is single-process (the super admin's script). SeedKey indexes are non-unique on Blocks, so never run
// a seed apply and a seed remove, or two removes, at the same time.
// Library follow-up: _lib has no reusable resumable cascade; this file carries its own (see L4's projects/cascade.ts).
import { OpError, defineOp, f, v, type OpCtx, type OpDeps, type Row } from "../../../_lib";
import type { ScopedGateway } from "../../../_lib/types";
import { isEngineJobStatus, isTerminal } from "../../../../src/domain/engineJob";
import { PROJECT_CASCADE, PROJECT_FILE_FIELDS, cascadeFieldsOf, fileIdsOf } from "../../../../src/domain/projects";
import {
  SCENARIO_PATTERN,
  SEED_KEY_PATTERN,
  SEED_LIMITS,
  SEED_REMOVE_ORDER,
  seedKeyOf,
  seedSchema,
} from "../../../../src/domain/seed";
import { requireSuperAdmin } from "./gate";
import { budgetLeft, rowsBySeedKey } from "./resolve";

export type SeedKeyMap = Record<string, string[]>;

const bad = (field: string, rule: string): OpError => new OpError("invalid_input", undefined, { field, rule });

/** `{<Schema>: [<key>]}`: seedable schemas, keys of the seed key pattern, at most SEED_LIMITS.removeKeys in total. */
export const seedKeysArg = {
  kind: "mf.validator" as const,
  parse(raw: unknown, field: string): SeedKeyMap {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw bad(field, "type");
    const out: SeedKeyMap = {};
    let total = 0;
    for (const [schema, list] of Object.entries(raw as Record<string, unknown>)) {
      if (!seedSchema(schema)) throw bad(`${field}.${schema}`, "schema");
      if (!Array.isArray(list)) throw bad(`${field}.${schema}`, "type");
      const keys: string[] = [];
      for (let i = 0; i < list.length; i++) {
        const k = list[i];
        if (typeof k !== "string" || !SEED_KEY_PATTERN.test(k)) throw bad(`${field}.${schema}[${i}]`, "pattern");
        if (!keys.includes(k)) keys.push(k);
      }
      total += keys.length;
      if (total > SEED_LIMITS.removeKeys) throw bad(field, "max");
      out[schema] = keys;
    }
    return out;
  },
};

const PAGE = 100;
const JOB_SCHEMA = "EngineJob";
const WORKSPACE_LAST = new Set(["Workspace", "Membership"]);
const IN_USE_SCHEMAS = ["Project", "Membership", "WorkspaceRole", "Invitation"] as const;

interface ProjectRows {
  project: Row;
  /** schema -> the first page of the project's rows (the EngineJob rows carry their Status). */
  rows: Map<string, { items: Row[]; total: number }>;
}

interface Plan {
  workspaceRow: Row | null;
  seeded: Map<string, Row[]>;
  projects: ProjectRows[];
  inUse: boolean;
}

/**
 * Every read the removal needs: the workspace and the seeded rows (and the workspace scan) in one parallel step, then the
 * first page of every project's rows in a second one. The op's prefetch runs this too, so the handler's copy is answered
 * from the request memo.
 */
async function loadPlan(gw: ScopedGateway, workspaceId: string, scenario: string, keys: SeedKeyMap): Promise<Plan> {
  const seedKeysOf = (schema: string): string[] => (keys[schema] ?? []).map((key) => seedKeyOf({ workspaceId, scenario, schema, key }));
  const readSchemas = Object.keys(keys).filter((s) => s !== "Workspace" && keys[s].length > 0);
  const scanInUse = (keys.Workspace ?? []).length > 0;
  const [workspaceRow, inUseRows, ...maps] = await Promise.all([
    gw.get("Workspace", workspaceId, ["ItemId", "SeedKey", "Status"]),
    Promise.all(
      (scanInUse ? IN_USE_SCHEMAS : []).map(async (schema) => {
        const ours = new Set(seedKeysOf(schema));
        const rows = await gw.findAll(schema, { where: f.eq("WorkspaceId", workspaceId), fields: ["ItemId", "SeedKey"] });
        return rows.some((r) => typeof r.SeedKey !== "string" || !ours.has(r.SeedKey));
      }),
    ),
    ...readSchemas.map((s) =>
      rowsBySeedKey(gw, s, seedKeysOf(s), s === "Project" ? ["ItemId", "SeedKey", "Status"] : ["ItemId", "SeedKey"]),
    ),
  ]);
  const seeded = new Map<string, Row[]>();
  readSchemas.forEach((s, i) => seeded.set(s, [...(maps[i] as Map<string, Row>).values()]));
  const cascade = PROJECT_CASCADE.filter((s) => s !== "Project");
  const projects = await Promise.all(
    (seeded.get("Project") ?? []).map(async (project): Promise<ProjectRows> => {
      const projectId = String(project.ItemId);
      const pages = await Promise.all(
        cascade.map(async (schema) => {
          const fields = schema === JOB_SCHEMA ? ["ItemId", "Status"] : cascadeFieldsOf(schema);
          const r = await gw.find(schema, { where: f.eq("ProjectId", projectId), fields, page: 1, pageSize: PAGE });
          return [schema, { items: r.items, total: r.totalCount ?? r.items.length }] as const;
        }),
      );
      return { project, rows: new Map(pages) };
    }),
  );
  return { workspaceRow, seeded, projects, inUse: inUseRows.some(Boolean) };
}

export const seedRemove = defineOp({
  op: "seed.remove",
  kind: "command",
  scope: "workspace",
  permission: "workspace.manage",
  platformOverride: "platform.workspaces.manage",
  args: v.object({
    workspaceId: v.id(),
    scenario: v.string({ pattern: SCENARIO_PATTERN, max: 63 }),
    keys: seedKeysArg,
  }),
  prefetch: (p) => (p.gw ? loadPlan(p.gw, p.args.workspaceId, p.args.scenario, p.args.keys as SeedKeyMap) : undefined),
  async handler(ctx: OpCtx, args, deps: OpDeps) {
    requireSuperAdmin(ctx, deps);

    const { workspaceId, scenario } = args;
    const keys = args.keys as SeedKeyMap;
    const seedKeysOf = (schema: string): string[] =>
      (keys[schema] ?? []).map((key) => seedKeyOf({ workspaceId, scenario, schema, key }));

    const deleted: Record<string, number> = {};
    const gone = new Set<string>();
    let stopped = false;
    let remaining = 0;

    /** Deletes one row (its Storage object first); a row that is already gone counts as done. */
    const dropRow = async (schema: string, row: Row, withFiles?: boolean): Promise<boolean> => {
      const id = String(row.ItemId);
      if (gone.has(id)) return true;
      if (!budgetLeft(ctx)) {
        stopped = true;
        return false;
      }
      for (const fileId of withFiles ? fileIdsOf(schema, row) : []) {
        try {
          await deps.files.remove(fileId);
        } catch (e) {
          if (!(e instanceof OpError && e.code === "not_found")) throw e;
        }
      }
      try {
        await deps.gw.remove(schema, id);
        deleted[schema] = (deleted[schema] ?? 0) + 1;
      } catch (e) {
        if (!(e instanceof OpError && e.code === "not_found")) throw e;
      }
      gone.add(id);
      return true;
    };

    /** One delete round: at most insertConcurrency deletes at a time, in the order given. Returns false when the time budget stopped the pool. */
    type Item = { schema: string; row: Row; withFiles?: boolean };
    const dropAll = async (items: Item[]): Promise<boolean> => {
      let next = 0;
      const worker = async (): Promise<void> => {
        while (next < items.length && !stopped) {
          const it = items[next++];
          if (!(await dropRow(it.schema, it.row, it.withFiles))) return;
        }
      };
      await Promise.all(Array.from({ length: Math.min(SEED_LIMITS.insertConcurrency, items.length) }, worker));
      return !stopped;
    };

    // 1. Everything to read (prefetched into the router's first round trip).
    const plan = await loadPlan(deps.gw, workspaceId, scenario, keys);
    const { workspaceRow } = plan;

    // 2. Round A: the projects' status, their live jobs cancelled and every child row except the jobs, together with the
    //    other seeded rows (children first). A project with more than one page of rows stays for the next call.
    const items: Item[] = [];
    const heldProjects = new Set<string>();
    const left = new Map<string, number>();
    for (const { project, rows } of plan.projects) {
      const projectId = String(project.ItemId);
      for (const [schema, page] of rows) {
        if (schema === JOB_SCHEMA) continue;
        for (const row of page.items) items.push({ schema, row, withFiles: schema in PROJECT_FILE_FIELDS });
        if (page.total > page.items.length) {
          heldProjects.add(projectId);
          left.set(projectId, (left.get(projectId) ?? 0) + page.total - page.items.length);
        }
      }
      if ((rows.get(JOB_SCHEMA)?.total ?? 0) > (rows.get(JOB_SCHEMA)?.items.length ?? 0)) heldProjects.add(projectId);
    }
    for (const schema of SEED_REMOVE_ORDER) {
      if (WORKSPACE_LAST.has(schema) || schema === "Project") continue;
      for (const row of plan.seeded.get(schema) ?? []) if (!items.some((i) => i.row.ItemId === row.ItemId)) items.push({ schema, row });
    }
    const marks = plan.projects
      .filter(({ project }) => project.Status !== "deleting")
      .map(({ project }) => deps.gw.update("Project", String(project.ItemId), { Status: "deleting" }));
    const cancelJobs = plan.projects.flatMap(({ rows }) =>
      (rows.get(JOB_SCHEMA)?.items ?? [])
        .filter((job) => isEngineJobStatus(job.Status) && !isTerminal(job.Status))
        .map(async (job) => {
          try {
            await deps.jobs.cancel(String(job.ItemId), { actor: "system" });
          } catch (e) {
            if (!(e instanceof OpError && (e.code === "conflict" || e.code === "not_found"))) throw e;
          }
        }),
    );
    await Promise.all([...marks, ...cancelJobs, dropAll(items)]);
    for (const it of items) if (!gone.has(String(it.row.ItemId))) remaining += 1;
    for (const n of left.values()) remaining += n;

    // 3. Round B: the jobs and the projects (once all their other rows are gone), then, as one more round, the memberships.
    const readyProjects = plan.projects.filter(({ project }) => !heldProjects.has(String(project.ItemId)) && !stopped && remaining === 0);
    const lastRows: Item[] = [
      ...readyProjects.flatMap(({ rows }) => (rows.get(JOB_SCHEMA)?.items ?? []).map((row) => ({ schema: JOB_SCHEMA, row }))),
      ...readyProjects.map(({ project }) => ({ schema: "Project", row: project })),
    ];
    if (remaining === 0 && !stopped) {
      await dropAll(lastRows);
      for (const it of lastRows) if (!gone.has(String(it.row.ItemId))) remaining += 1;
    } else {
      remaining += plan.projects.length - readyProjects.length + lastRows.length;
    }
    if (stopped && remaining === 0) remaining = 1;

    // 4. Workspace and memberships, only for the workspace this scenario created (mode "new").
    let keptWorkspace: { messageKey: string } | undefined;
    const createdByScenario =
      workspaceRow !== null && typeof workspaceRow.SeedKey === "string" && seedKeysOf("Workspace").includes(workspaceRow.SeedKey);
    if (createdByScenario) {
      if (stopped || remaining > 0) {
        remaining += 1;
      } else if (plan.inUse) {
        keptWorkspace = { messageKey: "seed.workspaceInUse" };
      } else {
        const members = (plan.seeded.get("Membership") ?? []).filter((r) => !gone.has(String(r.ItemId)));
        if (await dropAll(members.map((row) => ({ schema: "Membership", row })))) await dropRow("Workspace", workspaceRow);
        if (stopped) remaining += 1;
      }
    }

    deps.audit({
      action: "seed.removed",
      targetType: "workspace",
      targetId: workspaceId,
      details: { scenario, done: !stopped && remaining === 0, deleted, ...(keptWorkspace ? { keptWorkspace: keptWorkspace.messageKey } : {}) },
    });

    return { done: !stopped && remaining === 0, remaining, deleted, ...(keptWorkspace ? { keptWorkspace } : {}) };
  },
});
