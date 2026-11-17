import { useEffect, useRef, useState } from "react";
import { Building2, ChevronLeft, ChevronRight } from "lucide-react";
import { Button, Card, Chip, EmptyState, Input } from "@/ui/kit";
import {
  settleWrite, useSuspendWorkspace, useWorkspaceSummaries,
  type PlatformAccess, type WorkspaceRecord,
} from "@/blocks/admin";
import { workspaceGranterPermissions } from "@/domain/roles";
import { WorkspaceRolesPanel } from "@/components/roles/WorkspaceRolesPanel";
import { WorkspaceMembersPanel, memberStatusLabel } from "@/components/roles/WorkspaceMembersPanel";
import { AuditedChip } from "@/components/roles/AuditedChip";
import { t, useT } from "@/i18n";

const VIEW_PERMISSIONS = ["platform.workspaces.view", "platform.workspaces.manage", "platform.workspaceRoles.view"];
const ROLES_VIEW_PERMISSIONS = ["platform.workspaceRoles.view", "platform.workspaces.manage"];

const canSeeWorkspaces = (a: PlatformAccess) => a.isSuperAdmin || VIEW_PERMISSIONS.some((p) => a.permissions.includes(p));

const adminNames = (admins: string[]): string => (admins.length ? admins.join(", ") : t("platform.admin.workspaces.noAdmin", "No admin yet"));

export function WorkspacesTab({ access }: { access: PlatformAccess }) {
  const t = useT();
  const allowed = canSeeWorkspaces(access);
  const workspaces = useWorkspaceSummaries(allowed);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!allowed) return null;

  const rows = workspaces.data ?? [];
  const selected = selectedId ? rows.find((w) => w.workspaceId === selectedId) : undefined;
  if (selected) {
    return <WorkspaceDetail access={access} workspace={{ ItemId: selected.workspaceId, Name: selected.name, Status: selected.status }} onBack={() => setSelectedId(null)} />;
  }

  const error = workspaces.error;
  const pending = workspaces.isPending;

  return (
    <Card title={t("platform.admin.workspaces.title", "Workspaces")} icon={<Building2 size={18} strokeWidth={1.75} />} bodyClassName="flex flex-col gap-4"
      action={<AuditedChip />}>
      <p className="max-w-[68ch] text-[14px] text-ink2">{t("platform.admin.workspaces.intro", "Every workspace on the platform. Opening or changing one is kept in the audit log.")}</p>
      {error ? (
        <p role="alert" className="text-[13px] text-danger">{error.message}</p>
      ) : pending ? (
        <p aria-busy="true" className="text-[13px] text-ink3">{t("platform.admin.workspaces.loading", "Loading workspaces…")}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Building2 size={18} strokeWidth={1.75} />} title={t("platform.admin.workspaces.emptyTitle", "No workspaces yet")} text={t("platform.admin.workspaces.emptyText", "A workspace appears here once someone creates one.")} />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((w) => {
            const count = w.memberCount;
            const active = !w.status || w.status === "active";
            return (
              <li key={w.workspaceId} className="flex flex-col gap-3 rounded-block bg-surface2 px-4 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium [overflow-wrap:anywhere]">{w.name}</div>
                  <div className="text-[13px] text-ink3 [overflow-wrap:anywhere]">{adminNames(w.admins)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-3 sm:ml-auto">
                  <span className="text-[13px] text-ink2">{count === 1 ? t("platform.admin.workspaces.memberOne", "{n} member", { n: count }) : t("platform.admin.workspaces.memberMany", "{n} members", { n: count })}</span>
                  {active ? <Chip tone="success">{t("platform.admin.workspaces.active", "Active")}</Chip> : <Chip tone={w.status === "suspended" ? "danger" : "warning"}>{memberStatusLabel(w.status)}</Chip>}
                  <Button size="sm" variant="ghost" aria-label={t("platform.admin.workspaces.openName", "Open {name}", { name: w.name })}
                    iconRight={<ChevronRight size={16} strokeWidth={1.75} />} onClick={() => setSelectedId(w.workspaceId)}>{t("platform.admin.workspaces.open", "Open")}</Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function WorkspaceDetail({ access, workspace, onBack }: { access: PlatformAccess; workspace: WorkspaceRecord; onBack: () => void }) {
  const t = useT();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);

  const canManage = access.isSuperAdmin || access.permissions.includes("platform.workspaces.manage");
  const manageTip = canManage ? null : t("platform.admin.workspaces.manageTip", "You can look here. Changing this workspace needs a platform role that manages workspaces.");
  const granterPermissions = workspaceGranterPermissions({
    isSuperAdmin: access.isSuperAdmin, platformPermissions: access.permissions, memberPermissions: [], crossWorkspace: true,
  });
  const seeRoles = access.isSuperAdmin || ROLES_VIEW_PERMISSIONS.some((p) => access.permissions.includes(p));
  const suspend = useSuspendWorkspace();
  const [suspendNote, setSuspendNote] = useState<{ ok: boolean; text: string } | null>(null);
  // suspending locks every member out at once: it is confirmed first, with an optional reason for the audit log
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const isSuspended = workspace.Status === "suspended";
  const onSuspend = async () => {
    setSuspendNote(null);
    const why = reason.trim();
    const r = await settleWrite(suspend.mutateAsync({ workspaceId: workspace.ItemId, suspended: !isSuspended, ...(!isSuspended && why ? { reason: why } : {}) }));
    if (r.ok) { setConfirming(false); setReason(""); }
    setSuspendNote(r.ok
      ? { ok: true, text: isSuspended
        ? t("platform.admin.workspaces.resumed", "{name} is active again.", { name: workspace.Name })
        : t("platform.admin.workspaces.suspended", "{name} is suspended. Its members lose access until it is resumed.", { name: workspace.Name }) }
      : { ok: false, text: r.error });
  };
  const panel = { workspaceId: workspace.ItemId, workspaceName: workspace.Name, crossWorkspace: true, granterPermissions, canManage, manageTip };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" variant="ghost" icon={<ChevronLeft size={16} strokeWidth={1.75} />} onClick={onBack}>{t("platform.admin.workspaces.all", "All workspaces")}</Button>
        <h2 ref={heading} tabIndex={-1} className="font-display text-[20px] font-semibold outline-none [overflow-wrap:anywhere]">{workspace.Name}</h2>
        <AuditedChip />
        {canManage && (
          <Button size="sm" variant="secondary" className="sm:ml-auto" disabled={suspend.isPending || confirming}
            onClick={() => (isSuspended ? void onSuspend() : setConfirming(true))}>
            {isSuspended ? t("platform.admin.workspaces.resume", "Resume workspace") : t("platform.admin.workspaces.suspend", "Suspend workspace")}
          </Button>
        )}
      </div>
      {confirming && !isSuspended && (
        <div role="group" aria-label={t("platform.admin.workspaces.suspendName", "Suspend {name}", { name: workspace.Name })} className="flex flex-col gap-3 rounded-block bg-warning-soft px-4 py-3 text-[14px]">
          <div className="font-medium [overflow-wrap:anywhere]">{t("platform.admin.workspaces.suspendQuestion", "Suspend {name}? Every member loses access until it is resumed.", { name: workspace.Name })}</div>
          <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} aria-label={t("platform.admin.workspaces.reason", "Reason (optional)")} placeholder={t("platform.admin.workspaces.reasonPlaceholder", "Reason (optional, kept in the audit log)")} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" disabled={suspend.isPending} onClick={() => { setConfirming(false); setReason(""); }}>{t("platform.admin.workspaces.keepActive", "Keep it active")}</Button>
            <Button size="sm" variant="danger" disabled={suspend.isPending} aria-busy={suspend.isPending} onClick={() => void onSuspend()}>{t("platform.admin.workspaces.suspend", "Suspend workspace")}</Button>
          </div>
        </div>
      )}
      {suspendNote && (suspendNote.ok
        ? <p role="status" className="text-[13px] text-ink2">{suspendNote.text}</p>
        : <p role="alert" className="text-[13px] text-danger">{suspendNote.text}</p>)}
      <WorkspaceMembersPanel {...panel} />
      {seeRoles
        ? <WorkspaceRolesPanel {...panel} />
        : <p className="text-[13px] text-ink3">{t("platform.admin.workspaces.rolesNeedRole", "Seeing this workspace's custom roles needs a platform role that includes them.")}</p>}
    </div>
  );
}
