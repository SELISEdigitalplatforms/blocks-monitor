// Workspaces, their custom roles, memberships and invitations, with the audit entries and notes the ops would write.
import { WORKSPACE_ROLE_LABEL } from "../../src/domain/rbac";
import { person } from "../data/people";
import type { MemberDef, WorkspaceDef } from "../model";
import { SCENARIO, type WsScope } from "../core/writer";
import { audit, notify, uid, type World } from "./world";

function roleName(def: WorkspaceDef, role: string): string {
  if (role === "owner" || role === "member" || role === "viewer") return WORKSPACE_ROLE_LABEL[role];
  return def.roles.find((r) => r.key === role)?.name ?? role;
}

/** Sorted ids of the active members whose account is active: the ReaderIds of every row of the workspace. */
function readersOf(w: World, def: WorkspaceDef): string[] {
  const ids = def.members
    .filter((m) => (m.status ?? "active") === "active" && !person(m.person).deactivated && !person(m.person).noAccount)
    .map((m) => uid(w, m.person));
  return [...new Set(ids)].sort();
}

export async function seedWorkspace(w: World, def: WorkspaceDef): Promise<WsScope> {
  const { s } = w;
  const created = s.clock.at(def.created);
  const by = uid(w, def.createdBy);
  const readers = readersOf(w, def);
  // Like workspace.create: inserted with a placeholder WorkspaceId, then pointed at its own ItemId.
  const placeholder = `pending:${SCENARIO}-${def.key}`;
  const tmp: WsScope = { key: def.key, id: placeholder, readers };
  const id = await s.insert("Workspace", { WorkspaceId: placeholder, Name: def.name, Status: "active" }, { key: def.key, ws: tmp, by, at: created });
  await s.update("Workspace", id, { WorkspaceId: id, UpdatedByUserId: by }, created);
  const ws: WsScope = { key: def.key, id, readers };
  w.ws.set(def.key, ws);
  w.wsDefs.set(def.key, def);
  await audit(w, { actor: def.createdBy, action: "workspace.create", targetType: "workspace", targetId: id, targetLabel: def.name, at: created, ws, details: { name: def.name, viaPlatform: false } });

  for (const r of def.roles) {
    const at = s.clock.at(r.at);
    const roleId = await s.insert(
      "WorkspaceRole",
      { Key: r.key, Name: r.name, Description: r.description, Permissions: r.permissions, IsBuiltIn: false },
      { key: `role-${r.key}`, ws, by: uid(w, r.by), at },
    );
    await audit(w, { actor: r.by, action: "workspaceRole.save", targetType: "workspace-role", targetId: roleId, targetLabel: r.name, at, ws, details: { before: null, after: { name: r.name, permissions: r.permissions } } });
  }

  for (const m of def.members) await seedMember(w, def, ws, m);
  return ws;
}

async function seedMember(w: World, def: WorkspaceDef, ws: WsScope, m: MemberDef): Promise<void> {
  const { s } = w;
  const p = person(m.person);
  const status = m.status ?? "active";
  const invitedAt = s.clock.at(m.invited);
  const inviter = uid(w, m.invitedBy);
  const self = m.person === m.invitedBy;
  const userId = p.noAccount ? "" : uid(w, m.person);
  const joined = m.joined ? s.clock.at(m.joined) : undefined;
  const suspended = m.suspended ? s.clock.at(m.suspended) : undefined;
  const membershipId = await s.insert(
    "Membership",
    {
      UserId: status === "pending-account" ? "" : userId,
      Email: p.email,
      DisplayName: status === "pending-account" ? "" : p.name,
      RoleKey: m.role,
      Status: status,
      InvitedByUserId: inviter,
      InvitedAt: invitedAt,
      ...(joined ? { JoinedAt: joined } : {}),
      ...(suspended ? { SuspendedAt: suspended } : {}),
    },
    {
      key: `member-${m.person}`,
      ws,
      by: inviter,
      at: invitedAt,
      updatedAt: suspended ?? joined ?? invitedAt,
      updatedBy: suspended ? uid(w, p.deactivated?.by ?? m.invitedBy) : joined && !self ? userId : inviter,
    },
  );
  if (self) return;

  // The invitation behind the membership: accepted when the person joined, still pending otherwise.
  const kind = status === "pending-account" ? "pending-account" : "existing-account";
  const accepted = status === "active" || status === "suspended";
  const invitationId = await s.insert(
    "Invitation",
    {
      Email: p.email,
      RoleKey: m.role,
      Kind: kind,
      Status: accepted ? "accepted" : "pending",
      MembershipId: membershipId,
      InvitedByUserId: inviter,
      InvitedAt: invitedAt,
      ...(accepted && joined ? { ResolvedByUserId: userId, ResolvedAt: joined } : {}),
    },
    { key: `invite-${m.person}`, ws, by: inviter, at: invitedAt, updatedAt: accepted ? joined : invitedAt, updatedBy: accepted ? userId : inviter },
  );
  const domain = p.email.split("@")[1];
  await audit(w, {
    actor: m.invitedBy,
    action: "member.invite",
    targetType: "membership",
    targetId: membershipId,
    targetLabel: p.email,
    at: invitedAt,
    ws,
    details: { emailDomain: domain, roleKey: m.role, path: kind, invitationId, viaPlatform: false },
  });
  if (kind === "existing-account") {
    await notify(w, {
      kind: "invited",
      to: [m.person],
      params: { workspaceId: ws.id, workspaceName: def.name, roleName: roleName(def, m.role), actorName: person(m.invitedBy).name, email: p.email },
      link: "/home",
      at: invitedAt,
      eventKey: `member.invite:${ws.id}:invited:${membershipId}`,
      actor: m.invitedBy,
      ws,
      email: true,
    });
  } else {
    await notify(w, {
      kind: "access-requested",
      to: [w.superAdmin],
      params: { workspaceName: def.name, email: p.email, actorName: person(m.invitedBy).name, workspaceId: ws.id },
      link: "/admin",
      at: invitedAt,
      eventKey: `member.invite:${ws.id}:access-requested:${membershipId}`,
      actor: m.invitedBy,
      ws,
      email: true,
    });
  }
  if (accepted && joined) {
    await audit(w, { actor: m.person, action: "me.bootstrap", targetType: "membership", targetId: membershipId, targetLabel: p.email, at: joined, ws, details: { roleKey: m.role, from: "invited", viaPlatform: false } });
  }
  if (status === "suspended" && p.deactivated && suspended) {
    await audit(w, {
      actor: p.deactivated.by,
      action: "account.deactivate",
      targetType: "account",
      targetId: userId,
      targetLabel: p.email,
      at: suspended,
      ws,
      details: { before: { status: "active" }, after: { status: "deactivated", reason: "Left the company", workspaces: 1, ownerless: 0 } },
    });
  }
}
