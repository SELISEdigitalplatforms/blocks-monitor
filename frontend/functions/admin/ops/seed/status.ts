// seed.status: what a scenario has seeded so far (present / missing SeedKeys per schema, the example projects).
// A view: reads through the service gateway, writes nothing.
import { OpError, defineOp, f, v, type OpCtx, type OpDeps, type Row } from "../../../_lib";
import type { ScopedGateway } from "../../../_lib/types";
import { SCENARIO_PATTERN, SEED_SCHEMAS, SEED_KEY_PATTERN, seedKeyOf } from "../../../../src/domain/seed";
import { requireSuperAdmin } from "./gate";
import { rowsBySeedKey } from "./resolve";
import { seedKeysArg, type SeedKeyMap } from "./remove";

const WORKSPACE_FIELDS = ["ItemId", "Name", "Status", "IsExample", "SeedKey"];

interface StatusArgs {
  scenario: string;
  workspaceId?: string;
  workspaceKey?: string;
  keys: SeedKeyMap;
}

/**
 * Every read of the status in one parallel round. With a workspaceId the workspace, the counts and the example projects
 * are all read together; with a workspaceKey the workspace is found first (two rounds). The op's prefetch runs this too.
 */
async function readStatus(svc: ScopedGateway, args: StatusArgs): Promise<{ workspace: Row | null; counts: { schema: string; present: number; missing: number }[]; examples: Row[] }> {
  const { scenario, keys } = args;
  const listed = SEED_SCHEMAS.map((s) => s.name).filter((s) => (keys[s] ?? []).length > 0);
  const counted = async (schema: string, workspaceId: string) => {
    const list = keys[schema];
    const seedKeys = list.map((key) => seedKeyOf({ workspaceId: schema === "Workspace" ? "" : workspaceId, scenario, schema, key }));
    const found = await rowsBySeedKey(svc, schema, seedKeys, ["ItemId", "SeedKey"]);
    return { schema, present: found.size, missing: list.length - found.size };
  };
  const projects = (workspaceId: string) =>
    svc
      .find("Project", {
        where: f.and(f.eq("WorkspaceId", workspaceId), f.eq("IsExample", true)),
        fields: ["ItemId", "Name", "Stage"],
        page: 1,
        pageSize: 100,
      })
      .then((r) => r.items);

  if (args.workspaceId !== undefined) {
    const workspaceId = args.workspaceId;
    const [workspace, counts, examples] = await Promise.all([
      svc.get("Workspace", workspaceId, WORKSPACE_FIELDS),
      Promise.all(listed.map((schema) => counted(schema, workspaceId))),
      projects(workspaceId),
    ]);
    // A workspace that does not exist has nothing seeded in it.
    if (!workspace) {
      return { workspace, counts: counts.map((c) => (c.schema === "Workspace" ? c : { schema: c.schema, present: 0, missing: keys[c.schema].length })), examples: [] };
    }
    return { workspace, counts, examples };
  }
  const seedKey = seedKeyOf({ workspaceId: "", scenario, schema: "Workspace", key: args.workspaceKey as string });
  const workspace = (await rowsBySeedKey(svc, "Workspace", [seedKey], WORKSPACE_FIELDS)).get(seedKey) ?? null;
  const workspaceId = workspace ? String(workspace.ItemId) : null;
  const [counts, examples] = await Promise.all([
    Promise.all(listed.map((schema) => (schema !== "Workspace" && workspaceId === null ? { schema, present: 0, missing: keys[schema].length } : counted(schema, workspaceId ?? "")))),
    workspaceId === null ? Promise.resolve<Row[]>([]) : projects(workspaceId),
  ]);
  return { workspace, counts, examples };
}

export const seedStatus = defineOp({
  op: "seed.status",
  kind: "view",
  scope: "platform",
  permission: "platform.workspaces.view",
  args: v.object({
    scenario: v.string({ pattern: SCENARIO_PATTERN, max: 63 }),
    workspaceId: v.optional(v.id()),
    workspaceKey: v.optional(v.string({ pattern: SEED_KEY_PATTERN, max: 63 })),
    keys: seedKeysArg,
  }),
  prefetch: (p) =>
    p.svc && (p.args.workspaceId === undefined) !== (p.args.workspaceKey === undefined)
      ? readStatus(p.svc, p.args as StatusArgs)
      : undefined,
  async handler(ctx: OpCtx, args, deps: OpDeps) {
    requireSuperAdmin(ctx, deps);
    const svc = deps.svc;
    if (!svc) throw new OpError("internal");
    if ((args.workspaceId === undefined) === (args.workspaceKey === undefined)) {
      throw new OpError("invalid_input", undefined, { field: "workspaceId", rule: "exactlyOne" });
    }

    const { workspace, counts, examples } = await readStatus(svc, args as StatusArgs);
    const workspaceId = workspace ? String(workspace.ItemId) : null;
    return {
      workspace: workspace
        ? {
            workspaceId,
            name: String(workspace.Name ?? ""),
            status: String(workspace.Status ?? ""),
            isExample: workspace.IsExample === true,
          }
        : null,
      schemas: counts,
      exampleProjects: examples.map((p) => ({
        itemId: String(p.ItemId),
        name: String(p.Name ?? ""),
        stage: String(p.Stage ?? ""),
      })),
    };
  },
});
