// Cross-reference checks: every id a handler takes from its args is proven to
// belong to the op's workspace. Missing or foreign -> not_found, never revealed.
import { OpError } from "./errors";
import { LIB_FIELDS } from "./fields";
import { f } from "./filter";
import type { RawGateway, Row } from "./gateway";

export interface Refs {
  project(id: string, fields?: readonly string[]): Promise<Row>;
  inWorkspace(schema: string, id: string, fields?: readonly string[]): Promise<Row>;
  child(schema: string, id: string, parentField: string, parentId: string, fields?: readonly string[]): Promise<Row>;
  activeMembers(userIds: readonly string[]): Promise<Row[]>;
}

const MAX_MEMBERS = 200;

/** What the router already read for this request: the Project row and (commands) the active member ids. */
export interface RefsPreloaded {
  projectId: string | null;
  project: Row | null;
  activeMemberUserIds: readonly string[] | null;
}

export function createRefs({
  raw,
  workspaceId,
  preloaded,
}: {
  raw: RawGateway;
  workspaceId: string | null;
  preloaded?: RefsPreloaded;
}): Refs {
  const ws = (): string => {
    if (!workspaceId) throw new OpError("internal");
    return workspaceId;
  };
  const fieldList = (extra: readonly string[] | undefined, base: readonly string[] = ["ItemId", "WorkspaceId"]): string[] => [
    ...new Set([...base, ...(extra ?? [])]),
  ];

  async function one(schema: string, where: ReturnType<typeof f.and>, fields: string[]): Promise<Row> {
    const r = await raw.find(schema, { where, fields, page: 1, pageSize: 1 });
    const row = r.items[0];
    if (!row) throw new OpError("not_found");
    return row;
  }

  return {
    async project(id, fields) {
      const wanted = fieldList(fields, [...LIB_FIELDS.Project]);
      const row = preloaded?.project;
      if (row && preloaded.projectId === id && ws() === row.WorkspaceId && wanted.every((k) => k in row)) {
        const out: Row = {};
        for (const k of wanted) out[k] = row[k];
        return out;
      }
      return one("Project", f.and(f.eq("ItemId", id), f.eq("WorkspaceId", ws())), fieldList(fields, [...LIB_FIELDS.Project]));
    },
    async inWorkspace(schema, id, fields) {
      return one(schema, f.and(f.eq("ItemId", id), f.eq("WorkspaceId", ws())), fieldList(fields));
    },
    async child(schema, id, parentField, parentId, fields) {
      return one(
        schema,
        f.and(f.eq("ItemId", id), f.eq("WorkspaceId", ws()), f.eq(parentField, parentId)),
        fieldList(fields, ["ItemId", "WorkspaceId", parentField]),
      );
    },
    async activeMembers(userIds) {
      const ids = [...new Set(userIds)];
      if (ids.length > MAX_MEMBERS) throw new OpError("invalid_input", undefined, { field: "userIds", rule: "max" });
      if (ids.length === 0) return [];
      if (preloaded?.activeMemberUserIds) {
        const active = new Set(preloaded.activeMemberUserIds);
        const absent = ids.filter((u) => !active.has(u));
        if (absent.length > 0) throw new OpError("invalid_input", undefined, { userIds: absent });
        return ids.map((u) => ({ UserId: u, WorkspaceId: ws(), Status: "active" }));
      }
      const rows = await raw.findAll("Membership", {
        where: f.and(f.in("UserId", ids), f.eq("WorkspaceId", ws()), f.eq("Status", "active")),
        fields: ["ItemId", "UserId", "WorkspaceId", "RoleKey", "Status"],
        max: MAX_MEMBERS + 1,
      });
      const found = new Set(rows.map((r) => String(r.UserId)));
      const missing = ids.filter((u) => !found.has(u));
      if (missing.length > 0) throw new OpError("invalid_input", undefined, { userIds: missing });
      return rows;
    },
  };
}
