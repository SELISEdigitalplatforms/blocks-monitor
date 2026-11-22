import { useRef, useState } from "react";
import { LogOut, UserMinus, UserPlus, Users, X } from "lucide-react";
import { Avatar, Button, Card, Chip, EmptyState, IconButton, Modal, Select } from "@/ui/kit";
import { deniedTip, can } from "@/data/rbac";
import { builtInWorkspaceRoles, checkAssignRole, type RoleDef } from "@/domain/roles";
import { checkLastOwner, checkOutranks, granterPermissions } from "@/domain/tenancy";
import { ViewOnlyNote } from "@/components/workspace/ViewOnlyNote";
import { InviteForm } from "@/components/workspace/InviteForm";
import { useWorkspaces } from "@/blocks/workspaces/store";
import { leaveWorkspace, removeMember, setMemberRole } from "@/blocks/workspaces/ops";
import { initialsOf, whenLabel } from "@/state/workspaces";
import { byNewest } from "@/lib/newest";
import { t, useT } from "@/i18n";

const lastOwnerText = () => t("settings.team.lastOwner", "A workspace needs at least one Workspace admin.");
const outrankedText = () => t("settings.team.outranked", "This person has rights you don't have, so you can't change their role.");

type Row = ReturnType<typeof useWorkspaces.getState>["team"][number];

/** The team, newest first: by when each person joined, or was invited while they have not joined yet. */
export function newestMembersFirst<T extends { joinedAt: string | null; invitedAt: string | null }>(team: readonly T[]): T[] {
  return byNewest(team, (m) => m.joinedAt || m.invitedAt);
}
type Action = { kind: "remove" | "cancel" | "leave"; member: Row };

export function TeamCard() {
  const t = useT();
  const ready = useWorkspaces((s) => s.ready);
  const workspaceId = useWorkspaces((s) => s.workspaceId);
  const workspace = useWorkspaces((s) => s.workspaces.find((w) => w.id === workspaceId) ?? null);
  const team = useWorkspaces((s) => s.team);
  const me = useWorkspaces((s) => s.me);
  const isSuperAdmin = useWorkspaces((s) => s.isSuperAdmin);
  const customRoles = useWorkspaces((s) => s.customRoles);
  const [inviting, setInviting] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  const myPermissions: readonly string[] = me?.permissions ?? [];
  const canManage = can(myPermissions, "members.manage");
  const tip = !ready || canManage ? null : (deniedTip(me?.role ?? null, "members.manage") ?? t("settings.team.manageTip", "Only people who can manage members change them."));
  const granter: readonly string[] = me
    ? granterPermissions({ permissions: me.permissions, viaPlatform: me.viaPlatform === true, roleKey: me.roleKey, isSuperAdmin })
    : [];
  const roles: RoleDef[] = [...builtInWorkspaceRoles(), ...customRoles];
  const activeOwners = team.filter((m) => m.status === "active" && m.roleKey === "owner");
  const roleOptions = roles.map((r) => ({ value: r.key, label: r.name, disabled: !checkAssignRole(r, granter).ok }));
  const anyNotHeld = roleOptions.some((o) => o.disabled);

  const setRowError = (id: string, msg: string | null) =>
    setRowErrors((e) => { const n = { ...e }; if (msg) n[id] = msg; else delete n[id]; return n; });

  const lockReason = (m: Row, isMe: boolean, next: string | "remove"): string | null => {
    const owner = checkLastOwner({
      target: { membershipId: m.membershipId, roleKey: m.roleKey, status: m.status },
      next: next === "remove" ? { kind: "remove" } : { kind: "role", roleKey: next },
      activeOwners,
    });
    if (!owner.ok) return lastOwnerText();
    if (!isMe) {
      const out = checkOutranks({
        granterPermissions: granter, targetPermissions: m.permissions,
        exempt: isSuperAdmin || me?.viaPlatform === true,
      });
      if (!out.ok) return outrankedText();
    }
    return null;
  };

  const onRole = async (m: Row, roleKey: string) => {
    if (!workspaceId || roleKey === m.roleKey) return;
    setRowError(m.membershipId, null);
    setStatus(null);
    const r = await setMemberRole({ workspaceId, membershipId: m.membershipId, roleKey });
    if (r.ok) setStatus(t("settings.team.roleSaved", "Role of {name} saved.", { name: m.name }));
    else setRowError(m.membershipId, r.error);
  };

  const confirm = async () => {
    if (!action || !workspaceId || busy || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setActionError(null);
    let r: Awaited<ReturnType<typeof leaveWorkspace>>;
    try {
      r = action.kind === "leave"
        ? await leaveWorkspace(workspaceId)
        : await removeMember({ workspaceId, membershipId: action.member.membershipId });
    } finally { inFlight.current = false; }
    setBusy(false);
    if (r.ok) {
      setStatus(action.kind === "leave"
        ? (workspace ? t("settings.team.youLeft", "You left {workspace}.", { workspace: workspace.name }) : t("settings.team.youLeftWorkspace", "You left the workspace."))
        : action.kind === "cancel" ? t("settings.team.invitationCancelled", "Invitation for {email} cancelled.", { email: action.member.email })
        : t("settings.team.removed", "{name} removed.", { name: action.member.name }));
      setAction(null);
    } else setActionError(r.error);
  };

  const dialog = action && ({
    remove: {
      title: workspace
        ? t("settings.team.removeTitle", "Remove {name} from {workspace}?", { name: action.member.name, workspace: workspace.name })
        : t("settings.team.removeTitleThis", "Remove {name} from this workspace?", { name: action.member.name }),
      go: t("settings.team.removeGo", "Remove"),
      text: t("settings.team.removeText", "They lose access to its projects and shared items."),
    },
    cancel: {
      title: t("settings.team.cancelTitle", "Cancel the invitation for {email}?", { email: action.member.email }),
      go: t("settings.team.cancelGo", "Cancel invitation"),
      text: t("settings.team.cancelText", "They will no longer join this workspace when they sign in."),
    },
    leave: {
      title: workspace
        ? t("settings.team.leaveTitle", "Leave {workspace}?", { workspace: workspace.name })
        : t("settings.team.leaveTitleThis", "Leave this workspace?"),
      go: t("settings.team.leaveGo", "Leave workspace"),
      text: t("settings.team.leaveText", "You lose access to its projects and shared items until someone invites you again."),
    },
  })[action.kind];

  return (
    <div id="team" tabIndex={-1} className="scroll-mt-6 outline-none">
      <Card title={t("settings.team.title", "Team")} icon={<Users size={18} strokeWidth={1.75} />} bodyClassName="flex flex-col gap-4"
        action={
          <div className="flex flex-col items-end gap-1">
            <Button size="sm" variant="secondary" icon={<UserPlus size={16} strokeWidth={1.75} />} disabled={!canManage} aria-busy={!ready || undefined}
              title={tip ?? undefined} aria-describedby={tip ? "team-invite-note" : undefined}
              onClick={() => { setStatus(null); setInviting(true); }}>{t("settings.team.invite", "Invite someone")}</Button>
            {tip && <ViewOnlyNote id="team-invite-note" text={tip} />}
          </div>
        }>
        <p className="max-w-[68ch] text-[14px] text-ink2">
          {t("settings.team.intro", "Who works in this workspace. Workspace admins manage the team, members create and run projects, viewers look and comment.")}
        </p>
        {status && <p role="status" className="text-[13px] text-ink2">{status}</p>}
        {!ready ? (
          <div className="flex flex-col gap-3" role="status" aria-label={t("settings.team.loading", "Loading the team")}>
            {[0, 1].map((i) => <div key={i} className="h-16 animate-pulse rounded-block bg-surface2" />)}
          </div>
        ) : team.length === 0 ? (
          <EmptyState icon={<Users size={24} strokeWidth={1.75} />} title={t("settings.team.emptyTitle", "No one in the team yet")} text={t("settings.team.emptyText", "Invite the people who work on your projects.")} />
        ) : (
          <ul className="flex flex-col gap-3">
            {newestMembersFirst(team).map((m) => {
              const isMe = m.membershipId === me?.membershipId || (!!m.userId && m.userId === me?.userId);
              const pending = m.status !== "active";
              const roleLock = canManage && !pending ? lockReason(m, isMe, "viewer") : null;
              const removeLock = canManage || isMe ? lockReason(m, isMe, "remove") : null;
              const noteId = `team-${m.membershipId}-note`;
              return (
                <li key={m.membershipId} className="flex flex-col gap-3 rounded-block bg-surface2 px-4 py-3 sm:flex-row sm:items-center">
                  <Avatar initials={initialsOf(m.name)} size={36} tone={isMe ? "accent" : "soft"} />
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium [overflow-wrap:anywhere]">{isMe ? t("settings.team.nameYou", "{name} (you)", { name: m.name }) : m.name}</div>
                    <div className="text-[13px] text-ink3 [overflow-wrap:anywhere]">{m.email}</div>
                    {m.status === "pending-account" && (
                      <p className="mt-1 text-[13px] text-ink2">{t("settings.team.waitingAccount", "Waiting for an account: a platform admin has been asked to create it.")}</p>
                    )}
                    {removeLock && !pending && <p id={noteId} className="mt-1 text-[12px] text-ink3">{removeLock}</p>}
                    {rowErrors[m.membershipId] && <p role="alert" className="mt-1 text-[13px] text-danger">{rowErrors[m.membershipId]}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
                    {m.status === "active"
                      ? <Chip tone="success">{t("settings.team.active", "Active")}</Chip>
                      : <Chip tone="warning" title={m.invitedAt ? t("settings.team.invitedWhen", "Invited {when}", { when: whenLabel(m.invitedAt) }) : t("settings.team.invitedRecently", "Invited recently")}>{t("settings.team.invited", "Invited")}</Chip>}
                    {canManage && !pending
                      ? (
                        <Select size="sm" className="w-44" label={t("settings.team.roleOf", "Role of {name}", { name: m.name })} value={m.roleKey} disabled={!!roleLock}
                          options={roleOptions.some((o) => o.value === m.roleKey) ? roleOptions : [...roleOptions, { value: m.roleKey, label: m.roleName, disabled: true }]}
                          onChange={(r) => void onRole(m, r)} />
                      )
                      : <Chip>{m.roleName}</Chip>}
                    {isMe && !pending ? (
                      <Button size="sm" variant="ghost" icon={<LogOut size={16} strokeWidth={1.75} />} disabled={!!removeLock}
                        aria-describedby={removeLock ? noteId : undefined}
                        onClick={() => { setActionError(null); setAction({ kind: "leave", member: m }); }}>{t("settings.team.leaveGo", "Leave workspace")}</Button>
                    ) : canManage && (
                      pending ? (
                        <IconButton icon={<X size={18} strokeWidth={1.75} />} label={t("settings.team.cancelFor", "Cancel invitation for {email}", { email: m.email })}
                          onClick={() => { setActionError(null); setAction({ kind: "cancel", member: m }); }} />
                      ) : (
                        <IconButton icon={<UserMinus size={18} strokeWidth={1.75} />} label={t("settings.team.removeName", "Remove {name}", { name: m.name })}
                          disabled={!!removeLock} title={removeLock ?? undefined}
                          onClick={() => { setActionError(null); setAction({ kind: "remove", member: m }); }} />
                      )
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {canManage && anyNotHeld && team.length > 0 && <p className="text-[12px] text-ink3">{t("settings.team.notHeld", "You can only give a role whose rights you have yourself; the others are greyed out.")}</p>}
      </Card>
      <Modal open={inviting} onClose={() => setInviting(false)} title={t("settings.team.invite", "Invite someone")} width={520}>
        <InviteForm onCancel={() => setInviting(false)}
          onDone={(m) => { setInviting(false); setStatus(t("settings.team.invitedStatus", "{name} is invited. They join when they sign in with {email}.", { name: m.name, email: m.email })); }} />
      </Modal>
      <Modal open={!!action} onClose={() => !busy && setAction(null)} width={480} title={dialog?.title ?? ""}
        footer={<>
          <Button variant="ghost" disabled={busy} onClick={() => setAction(null)}>{t("settings.team.keep", "Keep")}</Button>
          <Button variant="danger" disabled={busy} onClick={() => void confirm()}>{dialog?.go ?? t("settings.team.confirm", "Confirm")}</Button>
        </>}>
        <p className="text-[14px] text-ink2">{dialog?.text}</p>
        {actionError && <p role="alert" className="mt-3 text-[13px] text-danger">{actionError}</p>}
      </Modal>
    </div>
  );
}
