import { useState } from "react";
import { Building2, KeyRound, Lock, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button, Card, Chip, EmptyState, IconButton, Modal } from "@/madp/ui/kit";
import type { PlatformAccess } from "@/madp/blocks/admin";
import { useDeleteIamRole, useIamRoles, useSaveIamRole, type IamRole } from "@/madp/blocks/iam";
import { PLATFORM_PERMISSION_AREAS, WORKSPACE_PERMISSIONS, WORKSPACE_PERMISSION_AREAS } from "@/madp/domain/rbac";
import { checkOrgRoleTemplateChange, checkPlatformRoleChange, platformChecklist, roleKeyFromName, workspaceChecklist } from "@/madp/domain/roles";
import { RoleMatrix } from "@/madp/components/roles/RoleMatrix";
import { RoleEditorModal, type RoleDraft } from "@/madp/components/roles/RoleEditorModal";
import { AuditedChip } from "@/madp/components/roles/AuditedChip";
import { localizedAreas, permissionLabels } from "@/madp/components/roles/permissionText";
import { useT } from "@/madp/i18n";

const canManageRoles = (a: PlatformAccess) => a.isSuperAdmin || a.permissions.includes("platform.roles.manage");

/**
 * The roles Blocks OS IAM holds, read from IAM: platform roles ("platform"), or the built-in organization roles,
 * templates and organization-only roles ("organization"). Ticking a permission saves the role to IAM (and the Factory).
 */
export function IamRolesPanel({ access, view }: { access: PlatformAccess; view: "platform" | "organization" }) {
  const t = useT();
  const q = useIamRoles();
  const save = useSaveIamRole();
  const del = useDeleteIamRole();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<IamRole | null>(null);
  const canEdit = canManageRoles(access);
  const granter = { isSuperAdmin: access.isSuperAdmin, permissions: access.permissions };
  const all = q.data?.roles ?? [];
  const inView = all.filter((r) => (view === "platform" ? r.scope === "platform" : r.scope !== "platform"));
  const matrixRoles = inView.filter((r) => r.scope !== "organization" || r.builtIn);
  const orgOnly = inView.filter((r) => r.scope === "organization" && !r.builtIn);
  const bySlug = new Map(all.map((r) => [r.slug, r]));
  const takenKeys = all.map((r) => r.key);

  const saveRole = async (r: IamRole, permissions: string[], name = r.name, description = r.description) => {
    await save.mutateAsync({ scope: r.scope, key: r.key, name, description, permissions, ...(r.workspaceId ? { workspaceId: r.workspaceId } : {}) });
  };
  const onToggle = async (slug: string, permission: string, next: boolean) => {
    const r = bySlug.get(slug);
    if (!r) return;
    setNote(null);
    const permissions = next ? [...r.permissions, permission] : r.permissions.filter((p) => p !== permission);
    try {
      await saveRole(r, permissions);
      setNote({ ok: true, text: t("platform.iam.roles.saved", "{role} saved to Blocks OS IAM.", { role: r.name }) });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : genericError() });
    }
  };
  const onCreate = async (draft: RoleDraft): Promise<{ ok: true } | { ok: false; error: string }> => {
    const scope = view === "platform" ? "platform" : "template";
    try {
      await save.mutateAsync({ scope, key: roleKeyFromName(draft.name, takenKeys), name: draft.name.trim(), description: draft.description.trim(), permissions: draft.permissions });
      setCreating(false);
      setNote({ ok: true, text: t("platform.iam.roles.saved", "{role} saved to Blocks OS IAM.", { role: draft.name.trim() }) });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : genericError() };
    }
  };
  const onDelete = async () => {
    if (!deleting) return;
    setNote(null);
    try {
      await del.mutateAsync({ scope: deleting.scope, key: deleting.key, ...(deleting.workspaceId ? { workspaceId: deleting.workspaceId } : {}) });
      setNote({ ok: true, text: t("platform.iam.roles.deleted", "{role} deleted from Blocks OS IAM.", { role: deleting.name }) });
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : genericError() });
    }
    setDeleting(null);
  };

  const scopeLabel = (r: IamRole) => (r.builtIn ? t("platform.iam.roles.scopeBuiltIn", "Built-in")
    : r.scope === "template" ? t("platform.iam.roles.scopeTemplate", "Template")
    : r.scope === "organization" ? t("platform.iam.roles.scopeOrganization", "Organization")
    : t("platform.iam.roles.scopePlatform", "Platform"));
  const genericError = () => t("platform.iam.roles.genericError", "Something went wrong. Please try again.");
  const title = view === "platform"
    ? t("platform.iam.roles.platformTitle", "Platform roles in Blocks OS IAM")
    : t("platform.iam.roles.organizationTitle", "Organization roles in Blocks OS IAM");
  const custom = matrixRoles.filter((r) => !r.builtIn);
  return (
    <div className="flex min-w-0 flex-col gap-5" aria-busy={q.isPending}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-[14px] text-ink2">
          {view === "platform"
            ? t("platform.iam.roles.platformIntro", "These platform roles are read from Blocks OS IAM. Tick or clear a permission to save the role there; built-in roles are locked.")
            : t("platform.iam.roles.organizationIntro", "Organization roles and templates are read from Blocks OS IAM. Templates can be edited here; organization-only roles are changed in their organization.")}
        </p>
        {canEdit && q.data && (
          <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setCreating(true)}>
            {view === "platform" ? t("platform.iam.roles.newRole", "New role") : t("platform.iam.roles.newTemplate", "New template")}
          </Button>
        )}
      </div>
      {note && <p role={note.ok ? "status" : "alert"} className={note.ok ? "text-[14px] text-ink2" : "text-[14px] text-danger"}>{note.text}</p>}

      <Card title={title}
        icon={<ShieldCheck size={18} strokeWidth={1.75} />} action={<AuditedChip />}>
        {q.error ? <p role="alert" className="text-[14px] text-danger">{q.error instanceof Error ? q.error.message : t("platform.iam.roles.unreachable", "Blocks OS IAM can't be reached right now.")}</p>
          : q.isPending ? <p aria-busy="true" className="text-[14px] text-ink3">{t("platform.iam.roles.loading", "Loading roles from Blocks OS IAM…")}</p>
          : matrixRoles.length === 0 ? (
            <EmptyState icon={<KeyRound size={18} strokeWidth={1.75} />} title={t("platform.iam.roles.emptyTitle", "Blocks OS IAM holds no roles yet")}
              text={t("platform.iam.roles.emptyText", "Run Check in IAM sync to see what Sync now would add.")} />
          ) : (
            <div className="flex flex-col gap-4">
              <ul className="flex flex-wrap gap-2">
                {matrixRoles.map((r) => (
                  <li key={r.slug} className="flex items-center gap-1 rounded-full bg-surface2 py-1 pl-3 pr-1 text-[13px]">
                    <span className="[overflow-wrap:anywhere]">{r.name}</span>
                    <Chip tone={r.builtIn ? "accent" : "neutral"} icon={r.builtIn ? <Lock size={12} strokeWidth={1.75} /> : undefined}>{scopeLabel(r)}</Chip>
                    {canEdit && !r.builtIn ? (
                      <IconButton icon={<Trash2 size={14} strokeWidth={1.75} />} label={t("platform.iam.roles.deleteLabel", "Delete {role}", { role: r.name })} className="h-7 w-7" onClick={() => setDeleting(r)} />
                    ) : <span className="w-1" />}
                  </li>
                ))}
              </ul>
              <RoleMatrix caption={title}
                roles={matrixRoles.map((r) => ({ key: r.slug, name: r.name, permissions: r.permissions }))}
                areas={view === "platform" ? localizedAreas(PLATFORM_PERMISSION_AREAS, "platform") : localizedAreas(WORKSPACE_PERMISSION_AREAS, "workspace")} labels={permissionLabels()}
                editable={(slug) => canEdit && custom.some((r) => r.slug === slug)}
                onToggle={(slug, p, next) => void onToggle(slug, p, next)} busy={save.isPending} />
            </div>
          )}
      </Card>

      {view === "organization" && (
        <Card title={t("platform.iam.roles.orgOnlyTitle", "Organization-only roles")} icon={<Building2 size={18} strokeWidth={1.75} />}>
          {orgOnly.length === 0 ? <p className="text-[14px] text-ink3">{t("platform.iam.roles.orgOnlyEmpty", "No organization has its own role in Blocks OS IAM.")}</p> : (
            <ul className="flex flex-col gap-2">
              {orgOnly.map((r) => (
                <li key={r.slug} className="grid gap-1 rounded-block bg-surface2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium [overflow-wrap:anywhere]">{r.name}</div>
                    <div className="text-[13px] text-ink3 [overflow-wrap:anywhere]">{r.workspaceName ?? t("platform.iam.roles.unknownOrganization", "An organization not in the Factory")}</div>
                  </div>
                  <span className="text-[13px] text-ink2">{t("platform.iam.roles.permissionCount", "{n} of {total} permissions", { n: r.permissions.length, total: WORKSPACE_PERMISSIONS.length })}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {creating && (
        <RoleEditorModal open onClose={() => setCreating(false)} idPrefix={`iam-${view}-role`}
          title={view === "platform" ? t("platform.iam.roles.newPlatformRoleTitle", "New platform role") : t("platform.iam.roles.newTemplateTitle", "New role template")}
          initial={{ name: "", description: "", permissions: [] }}
          checklist={(selected) => (view === "platform" ? platformChecklist(selected, granter) : workspaceChecklist(selected, WORKSPACE_PERMISSIONS))}
          check={(draft) => {
            const role = { key: roleKeyFromName(draft.name, takenKeys), name: draft.name, permissions: draft.permissions };
            return view === "platform" ? checkPlatformRoleChange(role, granter) : checkOrgRoleTemplateChange(role, granter);
          }}
          note={<span className="text-[13px] text-ink2">{t("platform.iam.roles.saveNote", "Saved to Blocks OS IAM first, then kept in the Factory.")}</span>}
          saveLabel={view === "platform" ? t("platform.iam.roles.saveRole", "Save role") : t("platform.iam.roles.saveTemplate", "Save template")} onSave={onCreate} />
      )}

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title={deleting ? t("platform.iam.roles.deleteTitle", "Delete {role}?", { role: deleting.name }) : t("platform.iam.roles.deleteRole", "Delete role")}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>{t("platform.iam.roles.cancel", "Cancel")}</Button>
            <Button variant="danger" icon={<Trash2 size={16} strokeWidth={1.75} />} onClick={() => void onDelete()} disabled={del.isPending}>{t("platform.iam.roles.deleteRole", "Delete role")}</Button>
          </>
        )}>
        <p className="text-[14px] text-ink2">{t("platform.iam.roles.deleteText", "The role is removed from the Factory and from Blocks OS IAM. A role someone still holds can't be deleted.")}</p>
      </Modal>
    </div>
  );
}
