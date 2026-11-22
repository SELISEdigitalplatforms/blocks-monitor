// me.bootstrap: the Account mirror, then accept the caller's invitations by the verified token email.
// Round plan (early: true, so round 1 shares the router's first round trip):
//   round 1: Account, active platform-role assignments (not for a super admin), memberships by email and by user,
//            the two platform settings;
//   round 2: workspaces, the platform roles the caller holds, pending invitations (only when a pending membership
//            exists), and the Account mirror write (only when something changed);
//   then, only when invitations are accepted: membership + invitation updates, restamp, audit.
import { emailAllowed, parseAllowedEmailDomains, S1_SETTING_KEYS } from "../../../../src/domain/emailDomains";
import { displayNameOf, IAM_SUPER_ADMIN_ROLE, resolvePlatformAccess } from "../../../../src/domain/tenancy";
import { audit, findOne, iamFirst, ok, rbacChanged, readArgs, type Caller } from "../_shared/core";
import { linkedWorkspaceOrg, orgRoleSlug } from "../_shared/iamSync";
import type { OpAnswer, OpCtx, OpDeps } from "../_shared/ports";
import {
  ACCOUNT_FIELDS,
  ACCOUNT_SUPER_ADMIN_FIELD,
  INVITATION_FIELDS,
  MEMBERSHIP_FIELDS,
  PLATFORM_ROLE_ASSIGNMENT_FIELDS,
  PLATFORM_ROLE_FIELDS,
  PLATFORM_SETTING_FIELDS,
  SCHEMA,
  toRoleDef,
  WORKSPACE_FIELDS,
  type AccountRow,
  type InvitationRow,
  type MembershipRow,
  type PlatformRoleAssignmentRow,
  type PlatformRoleRow,
  type PlatformSettingRow,
  type WorkspaceRow,
} from "../_shared/records";
import { deactivatedAccounts, freshReaders, restampWorkspace, sameReaders, stampReaders } from "../_shared/restamp";

export interface BootstrapResult {
  account: { userId: string; email: string; displayName: string; status: "active" | "deactivated" };
  isSuperAdmin?: boolean;
  platformPermissions?: string[];
  allowedEmailDomains?: string[];
  workspaces?: { workspaceId: string; name: string; status: string; membershipId: string; roleKey: string }[];
  accepted?: { workspaceId: string; name: string; membershipId: string }[];
  blocked?: { workspaceId: string; name: string }[];
  suspended?: { workspaceId: string; name: string }[];
}

/** An account seen within this window is not written again (the sign-in time is refreshed at most once per window). */
export const ACCOUNT_SIGNIN_REFRESH_MS = 3_600_000;

export async function meBootstrap(ctx: OpCtx, args: unknown, deps: OpDeps): Promise<OpAnswer<BootstrapResult>> {
  // An args email is ignored (never read); every other unknown key is still refused.
  const { email: _ignored, ...rest } = (typeof args === "object" && args !== null && !Array.isArray(args) ? args : {}) as Record<string, unknown>;
  const a = readArgs(args === undefined || args === null ? args : rest, { displayName: "string?" });
  if (!a.ok) return { ok: false, error: a.error };
  const { gateway } = deps;
  const c = ctx.context;
  const cloudIam = deps.identitySource === "iam";
  if (!c.isAuthenticated || !c.userId) {
    return { ok: false, error: { code: "forbidden", messageKey: "tenancy.signInRequired" } };
  }
  // The verified token email only; an args email is never read.
  const email = (c.email ?? "").trim().toLowerCase();
  const userId = c.userId;
  const tokenSuperAdmin = (c.roles ?? []).includes(IAM_SUPER_ADMIN_ROLE);
  // The roles source (PlatformSetting rbac.source): with "iam" the super admin flag and platform permissions come from IAM.
  const viewP = deps.rbac ? deps.rbac.view() : null;
  viewP?.catch(() => undefined);
  const accountFields = [...new Set<string>([...ACCOUNT_FIELDS, "LastSignInAt", ...(ACCOUNT_SUPER_ADMIN_FIELD ? [ACCOUNT_SUPER_ADMIN_FIELD] : [])])];

  // Round 1. A super admin holds every platform permission without any role rows, so its assignments are not read.
  const [existing, assignments, byEmail, byUser, settingRows] = await Promise.all([
    cloudIam ? null : findOne<AccountRow>(gateway, SCHEMA.account, { UserId: userId }, accountFields),
    tokenSuperAdmin
      ? Promise.resolve([] as PlatformRoleAssignmentRow[])
      : gateway.listAll<PlatformRoleAssignmentRow>(SCHEMA.platformRoleAssignment, {
          filter: { UserId: userId, Status: "active" },
          fields: PLATFORM_ROLE_ASSIGNMENT_FIELDS,
        }),
    email
      ? gateway.listAll<MembershipRow>(SCHEMA.membership, { filter: { Email: email }, fields: MEMBERSHIP_FIELDS, maxItems: 200 })
      : Promise.resolve([] as MembershipRow[]),
    gateway.listAll<MembershipRow>(SCHEMA.membership, {
      filter: { UserId: userId, Status: "active" },
      fields: MEMBERSHIP_FIELDS,
      maxItems: 200,
    }),
    gateway.listAll<PlatformSettingRow>(SCHEMA.platformSetting, {
      filter: { Key: { in: [S1_SETTING_KEYS.domains, S1_SETTING_KEYS.exceptions] } },
      fields: PLATFORM_SETTING_FIELDS,
    }),
  ]);

  // An IAM outage never blocks the sign-in: the Factory rows answer (the ops themselves still ask IAM and refuse).
  let view: Awaited<NonNullable<typeof viewP>> | null = null;
  try {
    view = viewP ? await viewP : null;
  } catch {
    view = null;
  }
  const fromIam = view?.source === "iam" && view.platform !== null;
  const isSuperAdmin = fromIam ? view!.isSuperAdmin : tokenSuperAdmin;

  if (!cloudIam && existing?.Status === "deactivated") {
    return ok({
      account: { userId, email: existing.Email, displayName: existing.DisplayName ?? "", status: "deactivated" },
    });
  }

  const valuesOf = (key: string) => settingRows.find((r) => r.Key === key)?.Values ?? null;
  const allowed = parseAllowedEmailDomains({
    domains: valuesOf(S1_SETTING_KEYS.domains),
    exceptions: valuesOf(S1_SETTING_KEYS.exceptions),
  });

  const now = deps.clock.now();
  const displayName = displayNameOf(a.value.displayName) || existing?.DisplayName || "";
  const superField: Record<string, unknown> = ACCOUNT_SUPER_ADMIN_FIELD ? { [ACCOUNT_SUPER_ADMIN_FIELD]: isSuperAdmin } : {};

  const mine = new Map<string, MembershipRow>();
  for (const m of [...byEmail, ...byUser]) mine.set(m.ItemId, m);
  const wsIds = [...new Set([...mine.values()].map((m) => m.WorkspaceId))];
  const roleKeys = [...new Set(assignments.filter((x) => x.Status === "active").map((x) => x.RoleKey))];
  const hasPending = byEmail.some((m) => m.Status === "invited" || m.Status === "pending-account");

  const lastSignIn = existing?.LastSignInAt ? Date.parse(existing.LastSignInAt) : NaN;
  const changed =
    existing !== null &&
    (existing.Email !== email ||
      displayName !== (existing.DisplayName ?? "") ||
      (ACCOUNT_SUPER_ADMIN_FIELD !== null && Boolean((existing as unknown as Record<string, unknown>)[ACCOUNT_SUPER_ADMIN_FIELD]) !== isSuperAdmin) ||
      Number.isNaN(lastSignIn) ||
      Date.parse(now) - lastSignIn > ACCOUNT_SIGNIN_REFRESH_MS);

  // Round 2.
  // The workspaces an invitation could be accepted in: their active members and the deactivated accounts are read here
  // too, so accepting needs no read of its own (the restamp knows its readers).
  const pendingWsIds = [...new Set(byEmail.filter((m) => m.Status === "invited" || m.Status === "pending-account").map((m) => m.WorkspaceId))];
  const [account, workspaces, roleRows, invitations, activeMembers, deactivated] = await Promise.all([
    !existing && !cloudIam
      ? gateway
          .insertOnce<AccountRow>(
            SCHEMA.account,
            {
              UserId: userId,
              Email: email,
              DisplayName: displayName,
              Status: "active",
              LastSignInAt: now,
              CreatedByUserId: userId,
              UpdatedByUserId: userId,
              ...superField,
            },
            `account:${userId}`,
          )
          .then((r) => r.item)
      : changed
        ? gateway
            .update(SCHEMA.account, existing.ItemId, {
              Email: email,
              DisplayName: displayName,
              LastSignInAt: now,
              UpdatedByUserId: userId,
              ...superField,
            })
            .then((): AccountRow => ({ ...existing, Email: email, DisplayName: displayName, LastSignInAt: now }))
        : Promise.resolve(existing),
    wsIds.length
      ? gateway.listAll<WorkspaceRow>(SCHEMA.workspace, { filter: { ItemId: { in: wsIds } }, fields: WORKSPACE_FIELDS })
      : Promise.resolve([] as WorkspaceRow[]),
    roleKeys.length
      ? gateway.listAll<PlatformRoleRow>(SCHEMA.platformRole, { filter: { Key: { in: roleKeys } }, fields: PLATFORM_ROLE_FIELDS })
      : Promise.resolve([] as PlatformRoleRow[]),
    email && hasPending
      ? gateway.listAll<InvitationRow>(SCHEMA.invitation, {
          filter: { Email: email, Status: "pending" },
          fields: INVITATION_FIELDS,
          maxItems: 200,
        })
      : Promise.resolve([] as InvitationRow[]),
    email && hasPending && pendingWsIds.length
      ? gateway.listAll<MembershipRow>(SCHEMA.membership, {
          filter: { WorkspaceId: { in: pendingWsIds }, Status: "active" },
          fields: MEMBERSHIP_FIELDS,
          maxItems: 1000,
        })
      : Promise.resolve([] as MembershipRow[]),
    !cloudIam && email && hasPending ? deactivatedAccounts(deps) : Promise.resolve([] as AccountRow[]),
  ]);
  const wsById = new Map(workspaces.map((w) => [w.ItemId, w]));

  const access = fromIam
    ? view!.platform!
    : resolvePlatformAccess({
        isSuperAdmin,
        assignments: assignments.map((x) => ({ roleKey: x.RoleKey, status: x.Status })),
        platformRoles: roleRows.map(toRoleDef),
      });
  const caller: Caller = {
    userId,
    email,
    isSuperAdmin,
    impersonated: Boolean(c.impersonated),
    account: cloudIam ? null : account,
    actorName: account?.DisplayName || c.displayName || email,
    platform: { permissions: [...access.permissions], roleKeys: [...access.roleKeys] },
    workspace: null,
    membership: null,
    team: [],
    customRoles: [],
    access: null,
    granter: [],
    extra: {},
  };

  const pendingRows = byEmail.filter(
    (m) => (m.Status === "invited" || m.Status === "pending-account") && wsById.get(m.WorkspaceId)?.Status === "active",
  );
  const blocked: { workspaceId: string; name: string }[] = [];
  const toAccept: MembershipRow[] = [];
  if (pendingRows.length) {
    if (!emailAllowed(caller.email, allowed)) {
      for (const m of pendingRows) blocked.push({ workspaceId: m.WorkspaceId, name: wsById.get(m.WorkspaceId)!.Name });
    } else {
      toAccept.push(...pendingRows);
    }
  }

  // rbac.source "iam": an accepted invitation gets its role in the workspace's IAM organization first; one IAM refuses
  // stays pending (accepted at a later sign-in), so the Factory never shows a membership IAM does not know.
  if (toAccept.length && view?.source === "iam") {
    const refused = await Promise.all(
      toAccept.map((m) =>
        iamFirst(deps, async (iam) => {
          const orgId = await linkedWorkspaceOrg(deps, m.WorkspaceId);
          if (orgId) await iam.grant(userId, { roles: [orgRoleSlug(m.RoleKey, m.WorkspaceId)], organizationId: orgId });
        }),
      ),
    );
    const keep = toAccept.filter((_, i) => refused[i] === null);
    toAccept.length = 0;
    toAccept.push(...keep);
    if (keep.length) await rbacChanged(deps, [userId]);
  }

  // The accepted memberships, their invitations and the restamp of every accepted workspace are one write round. With the
  // router that round is its bookkeeping round (deps.after: the audit rows and the Operation record go with it), so the
  // whole run takes three rounds; without it the writes run here, followed by the two-pass restamp.
  const acceptedWs = [...new Set(toAccept.map((m) => m.WorkspaceId))];
  const deactivatedUserIds = deactivated.map((x) => x.UserId);
  const knownFor = (id: string) => ({
    workspaceStatus: "active",
    memberships: [
      ...activeMembers.filter((m) => m.WorkspaceId === id),
      ...toAccept.filter((m) => m.WorkspaceId === id).map((m) => ({ ...m, UserId: userId, Status: "active" as const })),
    ],
    deactivatedUserIds,
  });
  const acceptWrites = (): Promise<unknown>[] =>
    toAccept.map(async (m) => {
      const inv = invitations.find((i) => i.MembershipId === m.ItemId);
      await Promise.all([
        deps.gateway.update(SCHEMA.membership, m.ItemId, { Status: "active", UserId: userId, JoinedAt: now, UpdatedByUserId: userId }),
        inv
          ? deps.gateway.update(SCHEMA.invitation, inv.ItemId, {
              Status: "accepted",
              ResolvedByUserId: userId,
              ResolvedAt: now,
              UpdatedByUserId: userId,
            })
          : Promise.resolve(),
      ]);
    });
  if (toAccept.length && deps.after) {
    deps.after(async () => {
      await Promise.all([
        ...acceptWrites(),
        ...acceptedWs.map(async (id) => {
          // A change that landed while this round ran is caught by reading the readers once more, in the same round.
          const [stamped, again] = await Promise.all([
            stampReaders(deps, id, knownFor(id)),
            freshReaders(deps, id, [userId]).catch(() => null),
          ]);
          if (again && !sameReaders(again, stamped.readerIds)) await deps.acl.restamp(id, again);
        }),
      ]);
    });
  } else if (toAccept.length) {
    await Promise.all(acceptWrites());
    await Promise.all(acceptedWs.map((id) => restampWorkspace(deps, id, knownFor(id))));
  }
  for (const [n, m] of toAccept.entries()) {
    await audit(deps, ctx, caller, {
      workspaceId: m.WorkspaceId,
      targetType: "membership",
      targetId: m.ItemId,
      details: { roleKey: m.RoleKey, from: m.Status },
    }, n);
  }

  const acceptedIds = new Set(toAccept.map((m) => m.ItemId));
  const activeMine: MembershipRow[] = [
    ...byUser.filter((m) => !acceptedIds.has(m.ItemId)),
    ...toAccept.map((m) => ({ ...m, Status: "active" as const })),
  ];
  const named = (m: MembershipRow) => ({ workspaceId: m.WorkspaceId, name: wsById.get(m.WorkspaceId)?.Name ?? "" });

  return ok({
    account: cloudIam
      ? { userId, email, displayName: c.displayName ?? "", status: "active" }
      : { userId, email: account?.Email ?? email, displayName: account?.DisplayName ?? "", status: "active" },
    isSuperAdmin: caller.isSuperAdmin,
    platformPermissions: caller.platform.permissions,
    allowedEmailDomains: allowed.domains,
    workspaces: activeMine
      .filter((m) => wsById.get(m.WorkspaceId)?.Status === "active")
      .map((m) => ({ ...named(m), status: "active", membershipId: m.ItemId, roleKey: m.RoleKey })),
    accepted: toAccept.map((m) => ({ ...named(m), membershipId: m.ItemId })),
    blocked,
    suspended: activeMine.filter((m) => wsById.get(m.WorkspaceId)?.Status === "suspended").map(named),
  });
}
