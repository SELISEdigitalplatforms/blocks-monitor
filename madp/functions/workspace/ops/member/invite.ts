// member.invite {workspaceId, email, roleKey, displayName?} (members.manage).
import { emailAllowed, emailDomainOf, parseAllowedEmailDomains, S1_SETTING_KEYS } from "../../../../src/domain/emailDomains";
import { normalizeEmail, isValidEmail } from "../../../../src/domain/platform";
import { checkAssignRole } from "../../../../src/domain/roles";
import {
  MAX_ACCESS_REQUEST_RECIPIENTS,
  displayNameOf,
  fromRoleCheck,
  invitePath,
  invitePathRefusal,
  type InvitePath,
} from "../../../../src/domain/tenancy";
import { audit, builtInOrCustomRole, fail, failCheck, finishWith, ok, notify, openOp, platformHolders, readArgs } from "../_shared/core";
import type { OpHandler } from "../_shared/ports";
import {
  ACCOUNT_FIELDS,
  ACCOUNT_SUPER_ADMIN_FIELD,
  INVITATION_FIELDS,
  PLATFORM_SETTING_FIELDS,
  SCHEMA,
  type AccountRow,
  type InvitationRow,
  type MembershipRow,
  type PlatformSettingRow,
} from "../_shared/records";

export interface MemberInviteResult {
  membership: MembershipRow;
  invitation: InvitationRow;
  path: InvitePath;
}

export const memberInvite: OpHandler<MemberInviteResult> = async (ctx, args, deps) => {
  const parsed = readArgs(args, { workspaceId: "string", email: "string", roleKey: "string", displayName: "string?" });
  if (!parsed.ok) {
    return ctx.context.isAuthenticated && ctx.context.userId
      ? { ok: false, error: parsed.error }
      : fail("forbidden", "tenancy.signInRequired");
  }
  const a = parsed.value;
  const email = normalizeEmail(a.email);
  const { gateway } = deps;
  const superField = ACCOUNT_SUPER_ADMIN_FIELD as string | null;
  let iamUnavailable = false;

  const opened = await openOp(ctx, deps, {
    scope: "workspace",
    workspaceId: a.workspaceId,
    permission: "members.manage",
    loadTeam: true,
    extra: {
      account: async () => {
        if (deps.identitySource === "iam") {
          if (!deps.iam) { iamUnavailable = true; return null; }
          const result = await deps.iam.exists(email);
          if (!result.ok) {
            iamUnavailable = result.status !== 403;
            return null;
          }
          return result.userId ? { UserId: result.userId, Email: email, Status: "active" } : null;
        }
        return (
          await gateway.list<AccountRow>(SCHEMA.account, {
            filter: { Email: email },
            fields: superField ? [...ACCOUNT_FIELDS, superField] : ACCOUNT_FIELDS,
            page: 1,
            pageSize: 1,
          })
        ).items[0] ?? null;
      },
      settings: () =>
        gateway.listAll<PlatformSettingRow>(SCHEMA.platformSetting, {
          filter: { Key: { in: [S1_SETTING_KEYS.domains, S1_SETTING_KEYS.exceptions] } },
          fields: PLATFORM_SETTING_FIELDS,
        }),
      invitations: () =>
        gateway.listAll<InvitationRow>(SCHEMA.invitation, {
          filter: { WorkspaceId: a.workspaceId, Email: email, Status: "pending" },
          fields: INVITATION_FIELDS,
        }),
      holders: () => platformHolders(deps, "platform.users.manage"),
      superAdmins: async () =>
        superField && deps.identitySource !== "iam"
          ? (
              await gateway.listAll<AccountRow>(SCHEMA.account, {
                filter: { [superField]: true },
                fields: ["ItemId", "UserId", "Email"],
                maxItems: MAX_ACCESS_REQUEST_RECIPIENTS,
              })
            ).map((x) => ({ userId: x.UserId, email: x.Email }))
          : [],
    },
  });
  if (!opened.ok) return { ok: false, error: opened.error };
  if (iamUnavailable) return fail("unavailable");
  const { caller } = opened;
  const workspace = caller.workspace!;
  const account = caller.extra.account as AccountRow | null;
  const settings = caller.extra.settings as PlatformSettingRow[];
  const pendingInvites = caller.extra.invitations as InvitationRow[];
  const holders = caller.extra.holders as string[];
  const superAdmins = caller.extra.superAdmins as { userId: string; email: string }[];

  if (!isValidEmail(email)) return fail("invalid_input", "tenancy.invalidEmail");
  const allowed = parseAllowedEmailDomains({
    domains: settings.find((s) => s.Key === S1_SETTING_KEYS.domains)?.Values,
    exceptions: settings.find((s) => s.Key === S1_SETTING_KEYS.exceptions)?.Values,
  });
  if (!emailAllowed(email, allowed)) {
    return fail("invalid_input", "tenancy.domainNotAllowed", { domain: emailDomainOf(email) });
  }

  const role = builtInOrCustomRole(a.roleKey, caller.customRoles);
  if (!role) return fail("invalid_input", "tenancy.unknownRole");
  const assign = fromRoleCheck(checkAssignRole(role, caller.granter));
  if (!assign.ok) return failCheck(assign);

  const existing = caller.team.find((m) => m.Email === email) ?? null;
  // A row left half-written by a failed first attempt (invited, but nothing pending) is resumed, not refused.
  const resume =
    existing !== null &&
    (existing.Status === "invited" || existing.Status === "pending-account") &&
    existing.InvitedByUserId === caller.userId &&
    (pendingInvites.length === 0 || pendingInvites.some((i) => i.Note === `request:${ctx.requestId}`));
  let path: InvitePath;
  if (resume) {
    path = existing!.Status === "pending-account" ? "pending-account" : "invite";
  } else {
    const route = invitePath({
      existingMembership: existing ? { status: existing.Status } : null,
      account: account ? { status: account.Status } : null,
    });
    if (!route.ok) {
      const refusal = invitePathRefusal(route.reason);
      if (!refusal.ok) return failCheck(refusal);
    }
    path = (route as { ok: true; path: InvitePath }).path;
  }
  const pending = path === "pending-account" || path === "reinvite-pending";
  const status = pending ? "pending-account" : "invited";
  const now = deps.clock.now();
  const userId = pending ? "" : (account?.UserId ?? "");
  const displayName = displayNameOf(a.displayName) || account?.DisplayName || "";
  const readers = workspace.ReaderIds ?? [];

  // The invitation row names its membership. A new membership has no id before its insert, so both rows are inserted
  // in one round with a provisional reference; the router's bookkeeping round (deps.after) points the invitation at
  // the real id. A retry finds the invitation by its request note and repeats only that step.
  const requestNote = `request:${ctx.requestId}`;
  const provisional = `pending:${ctx.requestId}`;
  const kind = pending ? "pending-account" : "existing-account";
  const invitationRow = (membershipId: string) => ({
    WorkspaceId: workspace.ItemId,
    ReaderIds: readers,
    Email: email,
    RoleKey: role.key,
    Kind: kind,
    Status: "pending",
    MembershipId: membershipId,
    InvitedByUserId: caller.userId,
    InvitedAt: now,
    Note: requestNote,
    CreatedByUserId: caller.userId,
    UpdatedByUserId: caller.userId,
  });
  // Who is told about an access request, and their addresses: read in the same round as the inserts so the router's
  // notification write finds every address already known.
  const requestRecipients = [...new Set([...superAdmins.map((x) => x.userId), ...holders])].filter((id) => id !== caller.userId).slice(0, MAX_ACCESS_REQUEST_RECIPIENTS);
  const holderIds = holders.filter((id) => requestRecipients.includes(id) && !superAdmins.some((x) => x.userId === id));
  const holderAccounts =
    pending && holderIds.length && deps.identitySource !== "iam"
      ? gateway.listAll<AccountRow>(SCHEMA.account, { filter: { UserId: { in: holderIds } }, fields: ["ItemId", "UserId", "Email", "Status"] })
      : Promise.resolve([] as AccountRow[]);
  holderAccounts.catch(() => undefined);
  const keyed = pendingInvites.find((i) => i.Note === requestNote) ?? null;

  let membership: MembershipRow;
  let invitation: InvitationRow;
  let finalize: (() => Promise<void>) | null = null;
  if (existing) {
    const set = {
      Status: status,
      RoleKey: role.key,
      UserId: userId,
      InvitedByUserId: caller.userId,
      InvitedAt: now,
      RemovedAt: "",
      UpdatedByUserId: caller.userId,
      ...(displayName ? { DisplayName: displayName } : {}),
    };
    membership = resume ? existing : ({ ...existing, ...set } as MembershipRow);
    // The state change comes last, so a retry still sees the removed row and replays the children.
    if (!resume) finalize = () => gateway.update(SCHEMA.membership, existing.ItemId, set);
    invitation =
      keyed ??
      (await gateway.insertOnce<InvitationRow>(SCHEMA.invitation, invitationRow(existing.ItemId), `invitation:${existing.ItemId}:${ctx.requestId}`)).item;
  } else {
    const [created, invited] = await Promise.all([
      gateway.insertOnce<MembershipRow>(
        SCHEMA.membership,
        {
          WorkspaceId: workspace.ItemId,
          ReaderIds: readers,
          UserId: userId,
          Email: email,
          DisplayName: displayName,
          RoleKey: role.key,
          Status: status,
          InvitedByUserId: caller.userId,
          InvitedAt: now,
          CreatedByUserId: caller.userId,
          UpdatedByUserId: caller.userId,
        },
        `membership:${workspace.ItemId}:${email}`,
      ),
      keyed
        ? Promise.resolve({ item: keyed })
        : gateway.insertOnce<InvitationRow>(SCHEMA.invitation, invitationRow(provisional), `invitation:${provisional}`),
    ]);
    membership = created.item;
    invitation = invited.item;
  }
  const membershipId = membership.ItemId;
  if (invitation.MembershipId !== membershipId) {
    const fixed = { MembershipId: membershipId, UpdatedByUserId: caller.userId };
    const invitationId = invitation.ItemId;
    const link = () => gateway.update(SCHEMA.invitation, invitationId, fixed);
    const before = finalize;
    finalize = before ? () => Promise.all([before(), link()]).then(() => undefined) : link;
    invitation = { ...invitation, MembershipId: membershipId };
  }

  if (pending) {
    const known: Record<string, string> = {};
    for (const x of superAdmins) if (x.email) known[x.userId] = x.email;
    for (const a of await holderAccounts) if (a.Status === "active" && a.Email) known[a.UserId] = a.Email;
    deps.knownEmails?.(known);
    await notify(deps, ctx, caller, {
      kind: "access-requested",
      recipients: requestRecipients,
      params: { workspaceId: workspace.ItemId, workspaceName: workspace.Name, email, actorName: caller.actorName },
      link: "/admin",
      workspaceId: workspace.ItemId,
      local: `access:${membershipId}`,
      emailStatus: "pending",
    });
  } else {
    if (account?.Status === "active" && account.Email) deps.knownEmails?.({ [account.UserId]: account.Email });
    await notify(deps, ctx, caller, {
      kind: "invited",
      recipients: [account!.UserId],
      params: { workspaceId: workspace.ItemId, workspaceName: workspace.Name, roleName: role.name, actorName: caller.actorName, email },
      link: "/dashboard",
      workspaceId: workspace.ItemId,
      local: `invited:${membershipId}`,
      emailStatus: deps.identitySource === "iam" ? "none" : "pending",
    });
  }
  await audit(deps, ctx, caller, {
    workspaceId: workspace.ItemId,
    targetType: "membership",
    targetId: membershipId,
    details: { emailDomain: emailDomainOf(email), roleKey: role.key, path, invitationId: invitation.ItemId ?? null },
    viaPlatform: caller.access!.viaPlatform,
  });

  if (finalize) await finishWith(deps, finalize);
  return ok({ membership, invitation, path });
};
