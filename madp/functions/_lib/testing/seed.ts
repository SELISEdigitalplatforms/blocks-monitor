// Test kit only: real-shape rows for the tables every handler test needs.
import { uuid5 } from "../ids";
import type { MemoryGateway } from "./memoryGateway";
import { assertRowValid } from "./schemaRules";

type Row = Record<string, unknown>;

/** Validated insert that bypasses the RequestKey requirement. */
export function seedRow(gw: MemoryGateway, schema: string, row: Row): string {
  const { ItemId: _id, ...rest } = row;
  assertRowValid(schema, rest);
  return gw.seed(schema, row);
}

export function seedWorkspace(
  gw: MemoryGateway,
  o: {
    workspaceId?: string;
    name?: string;
    status?: string;
    members: { userId: string; email: string; roleKey: string; status?: string; displayName?: string }[];
    roles?: { key: string; name: string; permissions: string[] }[];
  },
): { workspaceId: string; membershipIds: string[] } {
  const name = o.name ?? "Test workspace";
  const status = o.status ?? "active";
  const workspaceId = o.workspaceId ?? uuid5(`test-workspace:${name}`);
  const members = o.members.map((m) => ({ ...m, status: m.status ?? "active" }));
  const readers = status === "active" ? [...new Set(members.filter((m) => m.status === "active").map((m) => m.userId))].sort() : [];
  seedRow(gw, "Workspace", { ItemId: workspaceId, WorkspaceId: workspaceId, ReaderIds: readers, Name: name, Status: status });
  const membershipIds = members.map((m) =>
    seedRow(gw, "Membership", {
      WorkspaceId: workspaceId,
      ReaderIds: readers,
      UserId: m.userId,
      Email: m.email,
      RoleKey: m.roleKey,
      Status: m.status,
    }),
  );
  for (const r of o.roles ?? []) {
    seedRow(gw, "WorkspaceRole", {
      WorkspaceId: workspaceId,
      ReaderIds: readers,
      Key: r.key,
      Name: r.name,
      Permissions: r.permissions,
      IsBuiltIn: false,
    });
  }
  for (const m of members) {
    if (gw.rows("Account").some((a) => a.UserId === m.userId)) continue;
    seedRow(gw, "Account", { UserId: m.userId, Email: m.email, Status: "active", ...(m.displayName ? { DisplayName: m.displayName } : {}) });
  }
  return { workspaceId, membershipIds };
}

export function seedProject(gw: MemoryGateway, o: { workspaceId: string } & Row): { projectId: string } {
  const { workspaceId, ...rest } = o;
  const ws = gw.rows("Workspace").find((w) => w.ItemId === workspaceId);
  const readers = ws && Array.isArray(ws.ReaderIds) ? ws.ReaderIds : [];
  const projectId = seedRow(gw, "Project", { Name: "Test project", Stage: "business", Rev: 0, WorkspaceId: workspaceId, ReaderIds: readers, ...rest });
  return { projectId };
}
