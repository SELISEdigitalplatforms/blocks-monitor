import { useId, useState } from "react";
import { Users } from "lucide-react";
import { Chip, EmptyState, Select } from "@/madp/ui/kit";
import { WORKSPACE_ROLE_LABEL } from "@/madp/domain/rbac";
import { builtInWorkspaceRoles, checkAssignRole, checkSetMemberRole, type RoleDef } from "@/madp/domain/roles";
import { settleWrite, toRoleDef, useMemberships, useSetMemberRole, useWorkspaceRoles, type MembershipRecord } from "@/madp/blocks/admin";
import { ViewOnlyNote } from "@/madp/components/workspace/ViewOnlyNote";
import { t, useT } from "@/madp/i18n";
import { AuditedChip } from "./AuditedChip";
import { builtInRoleName, localizedRoles } from "./permissionText";
import type { WorkspacePanelProps } from "./WorkspaceRolesPanel";

/** A membership status in plain words ("pending-account" → "Waiting for an account"). */
export function memberStatusLabel(status: string): string {
  const s = status.trim();
  switch (s) {
    case "active": return t("platform.workspaceMembers.status.active", "Active");
    case "invited": return t("platform.workspaceMembers.status.invited", "Invited");
    case "pending-account": return t("platform.workspaceMembers.status.pendingAccount", "Waiting for an account");
    case "suspended": return t("platform.workspaceMembers.status.suspended", "Suspended");
    case "removed": return t("platform.workspaceMembers.status.removed", "Removed");
    default: return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/[-_]/g, " ") : "";
  }
}

export function WorkspaceMembersPanel(p: WorkspacePanelProps) {
  const t = useT();
  const id = useId();
  const members = useMemberships(p.workspaceId);
  const roles = useWorkspaceRoles(p.workspaceId);
  const setRole = useSetMemberRole();
  const [rowStatus, setRowStatus] = useState<Record<string, { ok: boolean; text: string }>>({});

  const options: RoleDef[] = [...localizedRoles(builtInWorkspaceRoles()), ...(roles.data ?? []).map(toRoleDef)];
  const rows = members.data ?? [];
  const adminCount = rows.filter((m) => m.RoleKey === "owner").length;
  const roleName = (key: string) =>
    ((WORKSPACE_ROLE_LABEL as Record<string, string>)[key] ? builtInRoleName(key, (WORKSPACE_ROLE_LABEL as Record<string, string>)[key]) : undefined)
      ?? options.find((o) => o.key === key)?.name ?? key;
  const selectOptions = options.map((o) => ({
    value: o.key, label: o.name, disabled: !checkAssignRole(o, p.granterPermissions).ok,
  }));
  const anyDisabled = selectOptions.some((o) => o.disabled);

  const onChange = async (m: MembershipRecord, next: string) => {
    const name = m.DisplayName || m.Email;
    const set = (v: { ok: boolean; text: string }) => setRowStatus((s) => ({ ...s, [m.ItemId]: v }));
    const chk = checkSetMemberRole({
      currentRoleKey: m.RoleKey, next: options.find((o) => o.key === next) ?? ({ key: next } as RoleDef),
      granterPermissions: p.granterPermissions, workspaceAdminCount: adminCount,
    });
    if (!chk.ok) { set({ ok: false, text: chk.message }); return; }
    const r = await settleWrite(setRole.mutateAsync({
      workspaceId: p.workspaceId, membershipId: m.ItemId, userId: m.UserId, roleKey: next, crossWorkspace: p.crossWorkspace,
    }));
    set(r.ok ? { ok: true, text: t("platform.workspaceMembers.roleSaved", "Role of {name} saved.", { name }) } : { ok: false, text: r.error });
  };

  return (
    <div className="flex flex-col gap-4" aria-busy={members.isPending}>
      {p.crossWorkspace && <div><AuditedChip /></div>}
      {members.error ? (
        <p role="alert" className="text-[13px] text-danger">{members.error.message}</p>
      ) : members.isPending ? (
        <p className="text-[13px] text-ink3">{t("platform.workspaceMembers.loading", "Loading members…")}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Users size={24} strokeWidth={1.75} />} title={t("platform.workspaceMembers.emptyTitle", "No members yet")} text={t("platform.workspaceMembers.emptyText", "People invited to this workspace appear here.")} />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {rows.map((m) => {
            const name = m.DisplayName || m.Email;
            const st = rowStatus[m.ItemId];
            return (
              <li key={m.ItemId} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{name}</div>
                  <div className="truncate text-[13px] text-ink2">{m.Email}</div>
                  {st && (st.ok
                    ? <p role="status" className="text-[12px] text-success">{st.text}</p>
                    : <p role="alert" className="text-[12px] text-danger">{st.text}</p>)}
                </div>
                {m.Status && <Chip tone={m.Status === "active" ? "success" : m.Status === "suspended" ? "danger" : "warning"}>{memberStatusLabel(m.Status)}</Chip>}
                {p.canManage
                  ? <Select size="sm" className="w-48" label={t("platform.workspaceMembers.roleOf", "Role of {name}", { name })} value={m.RoleKey} options={
                      selectOptions.some((o) => o.value === m.RoleKey) ? selectOptions : [...selectOptions, { value: m.RoleKey, label: roleName(m.RoleKey), disabled: true }]
                    } onChange={(v) => onChange(m, v)} />
                  : <Chip>{roleName(m.RoleKey)}</Chip>}
              </li>
            );
          })}
        </ul>
      )}
      {p.canManage && anyDisabled && rows.length > 0 && (
        <p id={`${id}-note`} className="text-[12px] text-ink3">{t("platform.workspaceMembers.greyedOutNote", "You can only give a role whose rights you have yourself; the others are greyed out.")}</p>
      )}
      {!p.canManage && <ViewOnlyNote id={`${id}-view`} text={p.manageTip ?? undefined} />}
    </div>
  );
}
