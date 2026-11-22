// Walk-in access: a person who signs in with an e-mail the store does not know yet gets an account on the spot and,
// unless the e-mail was invited somewhere, joins every active workspace as owner, so they land in the full data.
// Written the way the member ops write a joined member: an active Membership row, and the person added to ReaderIds of
// every row of the workspace (the ACL schemas).
import { aclSchemaNames } from "../virtualModules.ts";
import type { LocalRuntime } from "../runtime.ts";
import type { IamUserRecord } from "./store.ts";

export const WALK_IN_ROLE = "owner";

/** "sandra.keller@x.ch" -> Sandra / Keller; "jdoe@x.ch" -> Jdoe. */
export function nameFromEmail(email: string): { firstName: string; lastName: string } {
  const local = (email.split("@")[0] ?? "").replace(/\+.*$/, "");
  const parts = local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
  if (parts.length === 0) return { firstName: email, lastName: "" };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: "" };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1]! };
}

/** Joins every active workspace, unless someone already invited this e-mail: then the invitation decides (me.bootstrap
 *  accepts it at the first sign-in), exactly as for a real invited person. Answers how many workspaces were joined. */
export function grantWorkspaceAccess(rt: LocalRuntime, user: IamUserRecord): number {
  const { store } = rt;
  if (store.rows("Membership").some((m) => typeof m.Email === "string" && m.Email.toLowerCase() === user.email.toLowerCase())) return 0;
  const schemas = aclSchemaNames(rt.paths.root);
  const at = new Date().toISOString();
  let joined = 0;
  store.transaction(() => {
    for (const ws of store.rows("Workspace")) {
      if (ws.Status !== "active") continue;
      const wsId = String(ws.WorkspaceId || ws.ItemId);
      const member = store.rows("Membership").find((m) => m.WorkspaceId === wsId && m.UserId === user.userId);
      if (member && member.Status === "active") continue;
      const readers = [...new Set([...(Array.isArray(ws.ReaderIds) ? (ws.ReaderIds as string[]) : []), user.userId])].sort();
      const fields = {
        UserId: user.userId,
        Email: user.email,
        DisplayName: user.displayName,
        RoleKey: WALK_IN_ROLE,
        Status: "active",
        InvitedByUserId: user.userId,
        InvitedAt: at,
        JoinedAt: at,
        UpdatedByUserId: user.userId,
      };
      if (member) store.update("Membership", [member.ItemId as string], fields);
      else store.insert("Membership", { WorkspaceId: wsId, ReaderIds: readers, ...fields, CreatedByUserId: user.userId, RequestKey: `walk-in:membership:${wsId}:${user.userId}` });
      for (const schema of schemas) {
        const ids = store
          .rows(schema)
          .filter((r) => r.WorkspaceId === wsId && Array.isArray(r.ReaderIds) && !(r.ReaderIds as string[]).includes(user.userId))
          .map((r) => r.ItemId as string);
        for (const id of ids) {
          const row = store.get(schema, id);
          if (!row) continue;
          // LastUpdatedDate stays: an access grant is not an edit of the row.
          store.update(schema, [id], { ReaderIds: [...new Set([...(row.ReaderIds as string[]), user.userId])].sort(), LastUpdatedDate: String(row.LastUpdatedDate ?? at) });
        }
      }
      joined += 1;
    }
  });
  return joined;
}
