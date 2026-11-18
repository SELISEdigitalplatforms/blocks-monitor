import { useId, useRef, useState } from "react";
import { Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button, EmptyState, IconButton, Modal, Select } from "@/madp/ui/kit";
import { WORKSPACE_PERMISSION_AREAS } from "@/madp/domain/rbac";
import {
  MAX_CUSTOM_ROLES, builtInWorkspaceRoles, checkCreateCustomRole, checkDeleteCustomRole, checkUpdateCustomRole,
  roleKeyFromName, workspaceChecklist, type RoleDef,
} from "@/madp/domain/roles";
import {
  settleWrite, toRoleDef, useDeleteWorkspaceRole, useMemberships, useSaveWorkspaceRole, useWorkspaceRoles,
  type WorkspaceRoleRecord,
} from "@/madp/blocks/admin";
import { ViewOnlyNote } from "@/madp/components/workspace/ViewOnlyNote";
import { RoleEditorModal } from "./RoleEditorModal";
import { RoleMatrix } from "./RoleMatrix";
import { AuditedChip } from "./AuditedChip";
import { localizedAreas, localizedRoles, permissionLabels } from "./permissionText";
import { useT } from "@/madp/i18n";

export type WorkspacePanelProps = {
  workspaceId: string;
  workspaceName: string;
  crossWorkspace: boolean;
  granterPermissions: readonly string[];
  canManage: boolean;
  manageTip: string | null;
};

export function WorkspaceRolesPanel(p: WorkspacePanelProps) {
  const t = useT();
  const auditNote = t("platform.workspaceRoles.auditNote", "This change is recorded in the audit log.");
  const id = useId();
  const roles = useWorkspaceRoles(p.workspaceId);
  const members = useMemberships(p.workspaceId);
  const save = useSaveWorkspaceRole();
  const del = useDeleteWorkspaceRole();
  const [editing, setEditing] = useState<WorkspaceRoleRecord | "new" | null>(null);
  const [deleting, setDeleting] = useState<WorkspaceRoleRecord | null>(null);
  const [moveTo, setMoveTo] = useState("member");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [delError, setDelError] = useState<string | null>(null);

  const custom = roles.data ?? [];
  const builtIn = localizedRoles(builtInWorkspaceRoles());
  const existing: RoleDef[] = [...builtIn, ...custom.map(toRoleDef)];
  const holders = (key: string) => (members.data ?? []).filter((m) => m.RoleKey === key).length;
  const loaded = !roles.isPending && !roles.error;
  const atLimit = loaded && custom.length >= MAX_CUSTOM_ROLES;
  const deleteInFlight = useRef(false);
  const limitId = `${id}-limit`;
  const noteId = `${id}-view`;
  const limitText = t("platform.workspaceRoles.limit", "A workspace can have at most {max} custom roles.", { max: MAX_CUSTOM_ROLES });

  const editorProps = () => {
    if (editing === "new") {
      return {
        title: t("platform.workspaceRoles.newRole", "New role"),
        initial: { name: "", description: "", permissions: [] as string[] },
        checklist: (sel: readonly string[]) => workspaceChecklist(sel, p.granterPermissions),
        check: (d: { name: string; permissions: readonly string[] }) =>
          checkCreateCustomRole(
            { key: roleKeyFromName(d.name, existing.map((r) => r.key)), name: d.name, permissions: d.permissions },
            { existing, granterPermissions: p.granterPermissions }),
        onSave: async (d: { name: string; description: string; permissions: string[] }) => {
          const r = await settleWrite(save.mutateAsync({
            workspaceId: p.workspaceId, key: roleKeyFromName(d.name, existing.map((x) => x.key)), name: d.name,
            description: d.description, permissions: d.permissions, crossWorkspace: p.crossWorkspace,
          }));
          report(r, t("platform.workspaceRoles.saved", "Role saved."));
          return r;
        },
      };
    }
    const rec = editing as WorkspaceRoleRecord;
    const prev = toRoleDef(rec);
    return {
      title: t("platform.workspaceRoles.editTitle", "Edit {name}", { name: rec.Name }),
      initial: { name: rec.Name, description: rec.Description ?? "", permissions: [...rec.Permissions] },
      checklist: (sel: readonly string[]) => workspaceChecklist(sel, p.granterPermissions, prev.permissions),
      check: (d: { name: string; permissions: readonly string[] }) =>
        checkUpdateCustomRole(prev, { name: d.name, permissions: d.permissions }, p.granterPermissions),
      onSave: async (d: { name: string; description: string; permissions: string[] }) => {
        const r = await settleWrite(save.mutateAsync({
          workspaceId: p.workspaceId, itemId: rec.ItemId, key: rec.Key, name: d.name,
          description: d.description, permissions: d.permissions, crossWorkspace: p.crossWorkspace,
        }));
        report(r, t("platform.workspaceRoles.saved", "Role saved."));
        return r;
      },
    };
  };

  const report = (r: { ok: true } | { ok: false; error: string }, ok: string) => {
    if (r.ok) { setStatus(ok); setFailure(null); } else { setFailure(r.error); setStatus(null); }
  };

  const openDelete = (r: WorkspaceRoleRecord) => {
    setDelError(null);
    setMoveTo("member");
    setDeleting(r);
  };
  const delCount = deleting ? holders(deleting.Key) : 0;
  const moveOptions = existing.filter((r) => r.key !== deleting?.Key).map((r) => ({ value: r.key, label: r.name }));

  const confirmDelete = async () => {
    if (!deleting || busy || deleteInFlight.current) return;
    const reassignTo = delCount > 0 ? moveTo : null;
    const chk = checkDeleteCustomRole(toRoleDef(deleting), {
      memberCount: delCount, reassignTo, existing: existing.filter((r) => r.key !== deleting.Key),
    });
    if (!chk.ok) { setDelError(chk.message); return; }
    deleteInFlight.current = true;
    setBusy(true);
    setDelError(null);
    const r = await settleWrite(del.mutateAsync({
      workspaceId: p.workspaceId, itemId: deleting.ItemId, key: deleting.Key, reassignTo, crossWorkspace: p.crossWorkspace,
    })).finally(() => { deleteInFlight.current = false; });
    setBusy(false);
    if (r.ok) { setDeleting(null); report(r, t("platform.workspaceRoles.deleted", "Role deleted.")); } else setDelError(r.error);
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      {p.crossWorkspace && <div><AuditedChip /></div>}
      {status && <p role="status" className="text-[13px] text-success">{status}</p>}
      {failure && <p role="alert" className="text-[13px] text-danger">{failure}</p>}

      <section className="flex min-w-0 flex-col gap-3" aria-labelledby={`${id}-built`}>
        <h4 id={`${id}-built`} className="text-[15px] font-medium">{t("platform.workspaceRoles.builtInTitle", "Built-in roles")}</h4>
        <RoleMatrix caption={t("platform.workspaceRoles.matrixCaption", "What each built-in workspace role may do")} roles={builtIn}
          areas={localizedAreas(WORKSPACE_PERMISSION_AREAS, "workspace")} labels={permissionLabels()} />
      </section>

      <section className="flex min-w-0 flex-col gap-3" aria-labelledby={`${id}-custom`} aria-busy={roles.isPending}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h4 id={`${id}-custom`} className="text-[15px] font-medium">{t("platform.workspaceRoles.customTitle", "Custom roles")}</h4>
          {loaded && <span className="text-[13px] text-ink3">{t("platform.workspaceRoles.customCount", "{count} of {max} custom roles", { count: custom.length, max: MAX_CUSTOM_ROLES })}</span>}
          {p.canManage && (
            <Button size="sm" className="ml-auto" icon={<Plus size={16} strokeWidth={1.75} />} disabled={!loaded || atLimit}
              aria-describedby={atLimit ? limitId : undefined} onClick={() => { setStatus(null); setFailure(null); setEditing("new"); }}>
              {t("platform.workspaceRoles.newRole", "New role")}
            </Button>
          )}
        </div>
        {p.canManage && atLimit && <p id={limitId} className="text-[12px] text-ink3">{limitText}</p>}
        {roles.error ? (
          <p role="alert" className="text-[13px] text-danger">{roles.error.message}</p>
        ) : roles.isPending ? (
          <p className="text-[13px] text-ink3">{t("platform.workspaceRoles.loading", "Loading roles…")}</p>
        ) : custom.length === 0 ? (
          <EmptyState icon={<ShieldCheck size={24} strokeWidth={1.75} />} title={t("platform.workspaceRoles.emptyTitle", "No custom roles yet")}
            text={t("platform.workspaceRoles.emptyText", "Add a role when someone needs more or fewer rights than the built-in roles give.")} />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {custom.map((r) => (
              <li key={r.ItemId} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[14px] font-medium">{r.Name}</div>
                  {r.Description && <p className="text-[13px] text-ink2">{r.Description}</p>}
                  <p className="text-[12px] text-ink3">
                    {r.Permissions.length === 1
                      ? t("platform.workspaceRoles.rightsOne", "{count} right", { count: 1 })
                      : t("platform.workspaceRoles.rightsMany", "{count} rights", { count: r.Permissions.length })}
                    {" · "}
                    {holders(r.Key) === 1
                      ? t("platform.workspaceRoles.peopleOne", "{count} person", { count: 1 })
                      : t("platform.workspaceRoles.peopleMany", "{count} people", { count: holders(r.Key) })}
                  </p>
                </div>
                {p.canManage && (
                  <div className="flex gap-2">
                    <IconButton label={t("platform.workspaceRoles.editTitle", "Edit {name}", { name: r.Name })} className="h-9 w-9" icon={<Pencil size={16} strokeWidth={1.75} />}
                      onClick={() => { setStatus(null); setFailure(null); setEditing(r); }} />
                    <IconButton label={t("platform.workspaceRoles.deleteTitle", "Delete {name}", { name: r.Name })} className="h-9 w-9" icon={<Trash2 size={16} strokeWidth={1.75} />}
                      onClick={() => openDelete(r)} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {!p.canManage && <ViewOnlyNote id={noteId} text={p.manageTip ?? undefined} />}
      </section>

      {editing && (
        <RoleEditorModal open onClose={() => setEditing(null)} idPrefix={`${id}-editor`}
          note={p.crossWorkspace ? auditNote : undefined} {...editorProps()} />
      )}

      <Modal open={deleting !== null} onClose={() => !busy && setDeleting(null)} title={deleting ? t("platform.workspaceRoles.deleteTitle", "Delete {name}", { name: deleting.Name }) : t("platform.workspaceRoles.deleteRole", "Delete role")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)} disabled={busy}>{t("platform.workspaceRoles.cancel", "Cancel")}</Button>
            <Button variant="danger" onClick={confirmDelete} disabled={busy}>{delCount > 0 ? t("platform.workspaceRoles.moveAndDelete", "Move and delete") : t("platform.workspaceRoles.deleteRole", "Delete role")}</Button>
          </>
        }>
        <div className="flex flex-col gap-3">
          {delCount > 0 ? (
            <>
              <p className="text-[14px] text-ink2">
                {delCount === 1
                  ? t("platform.workspaceRoles.holdersOne", "1 person holds this role. Choose the role they move to before it is deleted.")
                  : t("platform.workspaceRoles.holdersMany", "{count} people hold this role. Choose the role they move to before it is deleted.", { count: delCount })}
              </p>
              <Select label={t("platform.workspaceRoles.moveTo", "Move them to")} value={moveTo} onChange={setMoveTo} options={moveOptions} />
            </>
          ) : (
            <p className="text-[14px] text-ink2">{t("platform.workspaceRoles.noHolders", "No one holds this role. Deleting it cannot be undone.")}</p>
          )}
          {p.crossWorkspace && <AuditedChip />}
          {p.crossWorkspace && <p className="text-[12px] text-ink3">{auditNote}</p>}
          {delError && <p role="alert" className="text-[13px] text-danger">{delError}</p>}
        </div>
      </Modal>
    </div>
  );
}
