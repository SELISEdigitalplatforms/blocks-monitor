import { useState } from "react";
import { BookOpen, Building2, Copy, KeyRound, Lock, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button, Card, Chip, EmptyState, IconButton, Modal, Tabs } from "@/madp/ui/kit";
import { usePlatformAccess, type PlatformAccess } from "@/madp/blocks/admin";
import {
  messageOf, useDeleteRoleTemplate, usePlatformRolesView, useSaveRoleTemplate, type RoleTemplate,
} from "@/madp/blocks/platformRbac";
import {
  PLATFORM_PERMISSION_AREAS, WORKSPACE_PERMISSIONS, WORKSPACE_PERMISSION_AREAS,
} from "@/madp/domain/rbac";
import {
  PLATFORM_ADMIN_ROLE, builtInWorkspaceRoles, checkOrgRoleTemplateChange, roleKeyFromName, workspaceChecklist,
} from "@/madp/domain/roles";
import { useT } from "@/madp/i18n";
import {
  localizedAreas, localizedRoles, permissionDescriptionText, permissionLabelText, permissionLabels, platformAdminRoleName,
} from "@/madp/components/roles/permissionText";
import { PlatformRolesTab } from "@/madp/components/admin/PlatformRolesTab";
import { RoleEditorModal, type RoleDraft } from "@/madp/components/roles/RoleEditorModal";
import { RoleMatrix } from "@/madp/components/roles/RoleMatrix";
import { AuditedChip } from "@/madp/components/roles/AuditedChip";
import { useIamStatus } from "@/madp/blocks/iam";
import { IamSourceLine } from "@/madp/components/platform/iam/IamSourceLine";
import { IamSyncCard } from "@/madp/components/platform/iam/IamSyncCard";
import { IamRolesPanel } from "@/madp/components/platform/iam/IamRolesPanel";

type View = "platform" | "organization" | "catalogue" | "iam-sync";

const canManageRoles = (a: PlatformAccess) => a.isSuperAdmin || a.permissions.includes("platform.roles.manage");

/** Roles & permissions: platform roles, organization role templates and the permission catalogue, in plain words. */
export default function RolesSection() {
  const t = useT();
  const access = usePlatformAccess();
  const [view, setView] = useState<View>("platform");
  const status = useIamStatus(access.ready);
  // Until iam.status answers (or where it can't) the screens work as they always have, from the Factory.
  const iam = status.data?.source === "iam";
  if (!access.ready) return <div aria-busy="true" aria-hidden className="h-64 rounded-card bg-surface/60" />;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <p className="max-w-[72ch] text-[14px] text-ink2">
        {t("platform.roles.intro", "A role is a named set of permissions. Platform roles give rights across the whole platform; organization roles decide what members may do inside one organization. Built-in roles are locked; every change is kept in the audit log.")}
      </p>
      <IamSourceLine status={status.data} />
      <Tabs idPrefix="roles-section" label={t("platform.roles.tabsLabel", "Roles & permissions")} value={view} onChange={setView}
        tabs={[
          { value: "platform", label: t("platform.roles.tabPlatform", "Platform roles") },
          { value: "organization", label: t("platform.roles.tabOrganization", "Organization roles") },
          { value: "catalogue", label: t("platform.roles.tabCatalogue", "All permissions") },
          ...(status.data ? [{ value: "iam-sync" as const, label: t("platform.roles.tabIamSync", "IAM sync") }] : []),
        ]} />
      <div role="tabpanel" id={`roles-section-panel-${view}`} aria-labelledby={`roles-section-tab-${view}`} className="min-w-0">
        {view === "platform" && (iam ? <IamRolesPanel access={access} view="platform" /> : <PlatformRolesView access={access} />)}
        {view === "organization" && (iam ? <IamRolesPanel access={access} view="organization" /> : <OrganizationRolesView access={access} />)}
        {view === "catalogue" && <PermissionCatalogue />}
        {view === "iam-sync" && status.data && <IamSyncCard status={status.data} canCheck={canManageRoles(access)} />}
      </div>
    </div>
  );
}

function PlatformRolesView({ access }: { access: PlatformAccess }) {
  const t = useT();
  const q = usePlatformRolesView();
  const roles = [{ ...PLATFORM_ADMIN_ROLE, name: platformAdminRoleName(PLATFORM_ADMIN_ROLE.name) }, ...(q.data?.roles ?? []).filter((r) => r.key !== PLATFORM_ADMIN_ROLE.key)];
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <PlatformRolesTab access={access} />
      <Card title={t("platform.roles.platformMatrix", "Platform roles side by side")} icon={<ShieldCheck size={18} strokeWidth={1.75} />}>
        {q.error ? <p role="alert" className="text-[14px] text-danger">{messageOf(q.error)}</p> : (
          <RoleMatrix caption={t("platform.roles.platformMatrix", "Platform roles side by side")} roles={roles} areas={localizedAreas(PLATFORM_PERMISSION_AREAS, "platform")} labels={permissionLabels()} />
        )}
      </Card>
    </div>
  );
}

type Editing = { record: RoleTemplate | null; from?: RoleDraft } | null;

export function OrganizationRolesView({ access }: { access: PlatformAccess }) {
  const t = useT();
  const q = usePlatformRolesView();
  const save = useSaveRoleTemplate();
  const del = useDeleteRoleTemplate();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<RoleTemplate | null>(null);
  const [notice, setNotice] = useState<{ tone: "status" | "alert"; text: string } | null>(null);
  const canEdit = canManageRoles(access);
  const granter = { isSuperAdmin: access.isSuperAdmin, permissions: access.permissions };
  const templates = q.data?.templates ?? [];
  const builtIns = localizedRoles(builtInWorkspaceRoles());
  const takenKeys = [...(q.data?.roles ?? []).map((r) => r.key), ...templates.map((r) => r.key)];

  async function onSave(draft: RoleDraft): Promise<{ ok: true } | { ok: false; error: string }> {
    const rec = editing?.record ?? null;
    const key = rec ? rec.key : roleKeyFromName(draft.name, takenKeys);
    try {
      await save.mutateAsync({ key, name: draft.name.trim(), description: draft.description.trim(), permissions: draft.permissions, scope: "organization" });
      setEditing(null);
      setNotice({ tone: "status", text: t("platform.roles.templateSaved", "Template \"{name}\" saved.", { name: draft.name.trim() }) });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: messageOf(e) };
    }
  }

  async function onDelete() {
    if (!deleting) return;
    try {
      await del.mutateAsync({ key: deleting.key });
      setNotice({ tone: "status", text: t("platform.roles.templateDeleted", "Template \"{name}\" deleted. Organizations keep the roles already made from it.", { name: deleting.name }) });
    } catch (e) {
      setNotice({ tone: "alert", text: messageOf(e) });
    }
    setDeleting(null);
  }

  const rec = editing?.record ?? null;
  return (
    <div className="flex min-w-0 flex-col gap-5" aria-busy={q.isPending}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-[14px] text-ink2">
          {t("platform.roles.orgIntro", "Every organization has the three built-in roles. Templates are roles you define once here and add to any organization from Organizations; organization admins can also make their own roles.")}
        </p>
        {canEdit && (
          <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setEditing({ record: null })}>{t("platform.roles.newTemplate", "New template")}</Button>
        )}
      </div>
      {notice && <p role={notice.tone === "alert" ? "alert" : "status"} className={notice.tone === "alert" ? "text-[14px] text-danger" : "text-[14px] text-ink2"}>{notice.text}</p>}

      <Card title={t("platform.roles.builtInTitle", "Built-in organization roles")} icon={<Lock size={18} strokeWidth={1.75} />} action={<Chip tone="accent">{t("platform.roles.locked", "Locked")}</Chip>}>
        <ul className="grid gap-3 sm:grid-cols-3">
          {builtIns.map((r) => (
            <li key={r.key} className="flex flex-col gap-2 rounded-block bg-surface2 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-[14px] font-medium">{r.name}</span>
                {canEdit && (
                  <IconButton icon={<Copy size={16} strokeWidth={1.75} />} label={t("platform.roles.cloneAsTemplate", "Clone {name} as a template", { name: r.name })} className="h-9 w-9"
                    onClick={() => setEditing({ record: null, from: { name: t("platform.roles.copyName", "{name} copy", { name: r.name }), description: r.description ?? "", permissions: [...r.permissions] } })} />
                )}
              </div>
              <p className="text-[13px] text-ink2">{r.description}</p>
              <p className="text-[13px] text-ink3">{t("platform.roles.permissionsOf", "{count} of {total} permissions", { count: r.permissions.length, total: WORKSPACE_PERMISSIONS.length })}</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={t("platform.roles.templatesTitle", "Role templates")} icon={<Building2 size={18} strokeWidth={1.75} />} action={<AuditedChip />}>
        {q.error ? <p role="alert" className="text-[14px] text-danger">{messageOf(q.error)}</p>
          : templates.length === 0 ? (
            q.isPending ? <p className="text-[14px] text-ink2">{t("platform.roles.loadingTemplates", "Loading templates…")}</p> : (
              <EmptyState icon={<Building2 size={18} strokeWidth={1.75} />} title={t("platform.roles.noTemplatesTitle", "No role templates yet")}
                text={t("platform.roles.noTemplatesText", "A template such as Reviewer or Project lead can be added to any organization in one step.")} />
            )
          ) : (
            <ul className="flex flex-col gap-3">
              {templates.map((tpl) => (
                <li key={tpl.key} className="flex flex-col gap-2 rounded-block bg-surface2 px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 text-[14px] font-medium [overflow-wrap:anywhere]">{tpl.name}</span>
                    <span className="text-[13px] text-ink3">{tpl.permissions.length === 1 ? t("platform.roles.permissionCountOne", "{count} permission", { count: 1 }) : t("platform.roles.permissionCountMany", "{count} permissions", { count: tpl.permissions.length })}</span>
                    {canEdit && (
                      <span className="flex items-center gap-1">
                        <IconButton icon={<Pencil size={16} strokeWidth={1.75} />} label={t("platform.roles.editNamed", "Edit {name}", { name: tpl.name })} className="h-9 w-9" onClick={() => setEditing({ record: tpl })} />
                        <IconButton icon={<Copy size={16} strokeWidth={1.75} />} label={t("platform.roles.cloneNamed", "Clone {name}", { name: tpl.name })} className="h-9 w-9"
                          onClick={() => setEditing({ record: null, from: { name: t("platform.roles.copyName", "{name} copy", { name: tpl.name }).slice(0, 60), description: tpl.description, permissions: [...tpl.permissions] } })} />
                        <IconButton icon={<Trash2 size={16} strokeWidth={1.75} />} label={t("platform.roles.deleteNamed", "Delete {name}", { name: tpl.name })} className="h-9 w-9" onClick={() => setDeleting(tpl)} />
                      </span>
                    )}
                  </div>
                  {tpl.description && <p className="text-[13px] text-ink2">{tpl.description}</p>}
                </li>
              ))}
            </ul>
          )}
      </Card>

      <Card title={t("platform.roles.orgMatrix", "Organization roles side by side")} icon={<KeyRound size={18} strokeWidth={1.75} />}>
        <RoleMatrix caption={t("platform.roles.orgMatrix", "Organization roles side by side")} roles={[...builtIns, ...templates]} areas={localizedAreas(WORKSPACE_PERMISSION_AREAS, "workspace")} labels={permissionLabels()} />
      </Card>

      {editing && (
        <RoleEditorModal open onClose={() => setEditing(null)} idPrefix="org-role-template"
          title={rec ? t("platform.roles.editNamed", "Edit {name}", { name: rec.name }) : editing.from ? t("platform.roles.cloneTitle", "Clone as a new template") : t("platform.roles.newTemplateTitle", "New role template")}
          initial={editing.from ?? { name: rec?.name ?? "", description: rec?.description ?? "", permissions: rec?.permissions ?? [] }}
          checklist={(selected) => workspaceChecklist(selected, WORKSPACE_PERMISSIONS)}
          check={(draft) => checkOrgRoleTemplateChange({ key: rec?.key ?? roleKeyFromName(draft.name, takenKeys), name: draft.name, permissions: draft.permissions }, granter)}
          note={<span className="text-[13px] text-ink2">{t("platform.roles.templateNote", "Organizations that already added this template keep their copy; add it again to update it.")}</span>}
          saveLabel={t("platform.roles.saveTemplate", "Save template")} onSave={onSave} />
      )}

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title={deleting ? t("platform.roles.deleteQuestion", "Delete {name}?", { name: deleting.name }) : t("platform.roles.deleteTemplate", "Delete template")}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>{t("platform.roles.cancel", "Cancel")}</Button>
            <Button variant="danger" icon={<Trash2 size={16} strokeWidth={1.75} />} onClick={() => void onDelete()} disabled={del.isPending}>{t("platform.roles.deleteTemplate", "Delete template")}</Button>
          </>
        )}>
        <p className="text-[14px] text-ink2">{t("platform.roles.deleteText", "The template goes away. Organizations keep the roles they already made from it.")}</p>
      </Modal>
    </div>
  );
}

export function PermissionCatalogue() {
  const t = useT();
  const groups = [
    { id: "platform", title: t("platform.roles.catalogue.platformTitle", "Platform permissions"), hint: t("platform.roles.catalogue.platformHint", "Held through platform roles. The super admin always holds every one."), areas: localizedAreas(PLATFORM_PERMISSION_AREAS, "platform") },
    { id: "organization", title: t("platform.roles.catalogue.orgTitle", "Organization permissions"), hint: t("platform.roles.catalogue.orgHint", "Held through a member's role inside one organization."), areas: localizedAreas(WORKSPACE_PERMISSION_AREAS, "workspace") },
  ];
  return (
    <div className="flex min-w-0 flex-col gap-5">
      {groups.map((g) => (
        <Card key={g.id} title={g.title} icon={<BookOpen size={18} strokeWidth={1.75} />}>
          <p className="mb-3 text-[14px] text-ink2">{g.hint}</p>
          <div className="flex flex-col gap-4">
            {g.areas.map((area) => (
              <section key={area.key} aria-label={area.name} className="flex flex-col gap-2">
                <h3 className="text-[12px] font-medium uppercase tracking-wider text-ink3">{area.name}</h3>
                <dl className="grid gap-2">
                  {area.permissions.map((p) => (
                    <div key={p} className="grid gap-0.5 rounded-block bg-surface2 px-4 py-2 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] sm:gap-4">
                      <dt className="text-[14px] font-medium text-ink">{permissionLabelText(p)}</dt>
                      <dd className="text-[13px] text-ink2">{permissionDescriptionText(p)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
