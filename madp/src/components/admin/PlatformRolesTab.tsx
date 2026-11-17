import { useRef, useState, type FormEvent } from "react";
import { Copy, ShieldCheck, Pencil, Plus, Trash2, UserPlus, X } from "lucide-react";
import { Button, Card, Chip, EmptyState, IconButton, Input, Label, Modal } from "@/ui/kit";
import {
  MSG_ASK_SUPER_ADMIN, adminErrorMessage, applyIamRoleChange, findAccountUserId, settleWrite, toRoleDef, useAssignPlatformRole, useDeletePlatformRole, usePlatformRoleAssignments, usePlatformRoles,
  useSavePlatformRole, useUnassignPlatformRole,
  type AssignResult, type PlatformAccess, type PlatformRoleAssignmentView, type PlatformRoleRecord,
} from "@/blocks/admin";
import {
  PLATFORM_ADMIN_ROLE, checkAssignPlatformRole, checkDeletePlatformRole, checkPlatformRoleChange, checkUnassignPlatformRole,
  platformChecklist, roleKeyFromName, type Granter,
} from "@/domain/roles";
import { permissionLabelText } from "@/components/roles/permissionText";
import { useT } from "@/i18n";
import { RoleEditorModal } from "@/components/roles/RoleEditorModal";
import { PermissionChecklist } from "@/components/roles/PermissionChecklist";

type Notice = { tone: "status" | "alert"; text: string } | null;
/** record: the role being changed (null for a new one); from: what a new role starts from when cloned. */
type Editing = { record: PlatformRoleRecord | null; from?: { name: string; description: string; permissions: string[] } } | null;

const SUPER: Granter = { isSuperAdmin: true, permissions: [] };

export function PlatformRolesTab({ access }: { access: PlatformAccess }) {
  const t = useT();
  const rolesQ = usePlatformRoles();
  const holdersQ = usePlatformRoleAssignments();
  const save = useSavePlatformRole();
  const del = useDeletePlatformRole();
  const assign = useAssignPlatformRole();
  const unassign = useUnassignPlatformRole();

  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<PlatformRoleRecord | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [holderError, setHolderError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const assignForm = useRef<HTMLFormElement>(null);
  const deleteInFlight = useRef(false);
  const assignInFlight = useRef(false);
  // no role is preselected: Platform admin is the most powerful one and must be a deliberate choice
  const [assignKey, setAssignKey] = useState<string>("");
  const [removing, setRemoving] = useState<string | null>(null);

  const granter: Granter = { isSuperAdmin: access.isSuperAdmin, permissions: access.permissions };
  const canEditRoles = access.isSuperAdmin || access.permissions.includes("platform.roles.manage");
  const canAssign = access.isSuperAdmin || access.permissions.includes("platform.users.manage");

  const custom = (rolesQ.data ?? []).filter(r => r.Key !== PLATFORM_ADMIN_ROLE.key);
  const assignments = holdersQ.data ?? [];
  const holdersOf = (key: string) => assignments.filter(a => a.RoleKey === key);
  const allKeys = [PLATFORM_ADMIN_ROLE.key, ...custom.map(r => r.Key)];
  const adminName = PLATFORM_ADMIN_ROLE.name === "Platform admin" ? t("platform.admin.roles.platformAdmin", "Platform admin") : PLATFORM_ADMIN_ROLE.name;
  const roleName = (key: string) => key === PLATFORM_ADMIN_ROLE.key ? adminName : custom.find(r => r.Key === key)?.Name ?? key;
  const defOf = (key: string) => key === PLATFORM_ADMIN_ROLE.key ? PLATFORM_ADMIN_ROLE : (() => {
    const rec = custom.find(r => r.Key === key);
    return rec ? toRoleDef(rec) : PLATFORM_ADMIN_ROLE;
  })();

  async function onSave(draft: { name: string; description: string; permissions: string[] }) {
    const rec = editing?.record ?? null;
    const taken = allKeys.filter(k => k !== rec?.Key);
    const key = rec ? rec.Key : roleKeyFromName(draft.name, taken);
    const res = await settleWrite(save.mutateAsync({ itemId: rec?.ItemId, key, name: draft.name.trim(), description: draft.description.trim(), permissions: draft.permissions }));
    if (res.ok) { setEditing(null); setNotice({ tone: "status", text: t("platform.admin.roles.saved", "Role \"{name}\" saved.", { name: draft.name.trim() }) }); }
    else setNotice({ tone: "alert", text: res.error });
    return res;
  }

  async function onDelete() {
    if (!deleting || deleteInFlight.current) return;
    const verdict = checkDeletePlatformRole(toRoleDef(deleting), { holderCount: holdersOf(deleting.Key).length, granter });
    if (!verdict.ok) { setNotice({ tone: "alert", text: verdict.message }); setDeleting(null); return; }
    deleteInFlight.current = true;
    const res = await settleWrite(del.mutateAsync({ itemId: deleting.ItemId, key: deleting.Key })).finally(() => { deleteInFlight.current = false; });
    setNotice(res.ok ? { tone: "status", text: t("platform.admin.roles.deleted", "Role \"{name}\" deleted.", { name: deleting.Name }) } : { tone: "alert", text: res.error });
    setDeleting(null);
  }

  async function onAssign(e: FormEvent) {
    e.preventDefault();
    if (assignInFlight.current) return;
    setHolderError(null);
    if (!assignKey) { setHolderError(t("platform.admin.roles.chooseRoleError", "Choose the role to assign.")); return; }
    const verdict = checkAssignPlatformRole(defOf(assignKey), granter);
    if (!verdict.ok) { setHolderError(verdict.message); return; }
    const address = email.trim();
    if (!address) { setHolderError(t("platform.admin.roles.enterEmail", "Enter the person's email.")); return; }
    assignInFlight.current = true;
    let userId: string | null;
    try { userId = await findAccountUserId(address); } catch (e) { assignInFlight.current = false; setHolderError(adminErrorMessage(e)); return; }
    if (!userId) { assignInFlight.current = false; setHolderError(t("platform.admin.roles.noAccount", "No account found for that email. They need to sign in once first.")); return; }
    try {
      const out = await assign.mutateAsync({ userId, roleKey: assignKey });
      setEmail("");
      setNotice({ tone: "status", text: t("platform.admin.roles.assigned", "{email} now holds {role}.", { email: address, role: roleName(assignKey) }) + await iamNote(out, address) });
    } catch (e) { setHolderError(adminErrorMessage(e)); } finally { assignInFlight.current = false; }
  }

  /** The IAM side of a change: the super admin applies it with their own token; anyone else is told who can. */
  async function iamNote(out: AssignResult | undefined, address: string): Promise<string> {
    const change = out?.iamRoleChange;
    if (!change) return "";
    if (!access.isSuperAdmin) return ` ${MSG_ASK_SUPER_ADMIN}`;
    const r = await applyIamRoleChange(change, address);
    return r.ok ? t("platform.admin.roles.iamUpdated", " User-management access updated.")
      : t("platform.admin.roles.iamNotUpdated", " User-management access was not updated: {error}", { error: r.error });
  }

  async function onRemove(a: PlatformRoleAssignmentView) {
    setHolderError(null);
    const verdict = checkUnassignPlatformRole(defOf(a.RoleKey), { granter, holderCount: holdersOf(a.RoleKey).length, isSelf: a.UserId === access.userId });
    if (!verdict.ok) { setHolderError(verdict.message); return; }
    try {
      const out = await unassign.mutateAsync({ userId: a.UserId, roleKey: a.RoleKey });
      setRemoving(null);
      setNotice({ tone: "status", text: t("platform.admin.roles.removed", "{role} removed from {name}.", { role: roleName(a.RoleKey), name: a.DisplayName || a.Email }) + await iamNote(out, a.Email) });
    } catch (e) { setHolderError(adminErrorMessage(e)); }
  }

  const Holders = ({ roleKey }: { roleKey: string }) => {
    const list = holdersOf(roleKey);
    return (
      <div className="mt-4">
        <Label>{t("platform.admin.roles.holders", "Holders")}</Label>
        {holdersQ.error ? <p role="alert" className="text-[14px] text-danger">{holdersQ.error.message}</p>
          : list.length === 0 ? <p className="text-[14px] text-ink2">{holdersQ.isPending ? t("platform.admin.roles.loadingPeople", "Loading people…") : t("platform.admin.roles.noHolders", "Nobody holds this role yet.")}</p>
          : (
            <ul className="divide-y divide-line">
              {list.map(a => (
                <li key={a.ItemId} className="flex items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-medium">{a.DisplayName || a.Email}</div>
                    {a.DisplayName && <div className="truncate text-[13px] text-ink2">{a.Email}</div>}
                  </div>
                  {canAssign && (removing === a.ItemId ? (
                    // taking a platform role away is confirmed in place, like the role delete
                    <span className="flex shrink-0 flex-wrap items-center gap-2">
                      <Button size="sm" variant="ghost" disabled={unassign.isPending} onClick={() => setRemoving(null)}>{t("platform.admin.roles.keep", "Keep")}</Button>
                      <Button size="sm" variant="danger" disabled={unassign.isPending} aria-busy={unassign.isPending} onClick={() => void onRemove(a)}>
                        {t("platform.admin.roles.removeRole", "Remove role")}
                      </Button>
                    </span>
                  ) : (
                    <IconButton icon={<X size={16} strokeWidth={1.75} />} label={t("platform.admin.roles.removeFrom", "Remove {role} from {name}", { role: roleName(roleKey), name: a.DisplayName || a.Email })}
                      className="h-9 w-9" onClick={() => { setHolderError(null); setRemoving(a.ItemId); }} />
                  ))}
                </li>
              ))}
            </ul>
          )}
      </div>
    );
  };

  const editingRec = editing?.record ?? null;

  return (
    <div className="grid gap-5" aria-busy={rolesQ.isPending || holdersQ.isPending}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="min-w-0 flex-1 text-[14px] text-ink2">
          {t("platform.admin.roles.intro", "Platform roles give people rights across the whole platform. The super admin always has every right.")}
        </p>
        {canEditRoles && (
          <Button variant="primary" icon={<Plus size={16} strokeWidth={1.75} />} onClick={() => setEditing({ record: null })}>{t("platform.admin.roles.newRole", "New role")}</Button>
        )}
      </div>

      {notice && (
        <p role={notice.tone === "alert" ? "alert" : "status"} className={notice.tone === "alert" ? "text-[14px] text-danger" : "text-[14px] text-ink2"}>{notice.text}</p>
      )}
      {holderError && <p role="alert" className="text-[14px] text-danger">{holderError}</p>}

      <Card title={adminName} icon={<ShieldCheck size={18} strokeWidth={1.75} />}
        action={(
          <>
            <Chip tone="accent">{t("platform.admin.roles.builtIn", "Built-in")}</Chip>
            {canEditRoles && (
              <IconButton icon={<Copy size={16} strokeWidth={1.75} />} label={t("platform.admin.roles.cloneName", "Clone {name}", { name: adminName })} className="h-9 w-9"
                onClick={() => setEditing({ record: null, from: { name: t("platform.admin.roles.copyName", "{name} copy", { name: adminName }), description: "", permissions: [...PLATFORM_ADMIN_ROLE.permissions] } })} />
            )}
          </>
        )}>
        <p className="text-[14px] text-ink2">{t("platform.admin.roles.adminText", "Has every platform right. Only the super admin can give this role.")}</p>
        <div className="mt-4">
          <PermissionChecklist areas={platformChecklist([...PLATFORM_ADMIN_ROLE.permissions], SUPER)} onToggle={() => {}} idPrefix="platform-admin-builtin" readOnly />
        </div>
        <Holders roleKey={PLATFORM_ADMIN_ROLE.key} />
      </Card>

      {rolesQ.error ? (
        <p role="alert" className="text-[14px] text-danger">{rolesQ.error.message}</p>
      ) : custom.length === 0 ? (
        rolesQ.isPending ? <p className="text-[14px] text-ink2">{t("platform.admin.roles.loading", "Loading platform roles…")}</p> : (
          <EmptyState icon={<ShieldCheck size={18} strokeWidth={1.75} />} title={t("platform.admin.roles.emptyTitle", "No custom platform roles yet")}
            text={t("platform.admin.roles.emptyText", "Add one to give a person some platform rights without making them Platform admin.")} />
        )
      ) : custom.map(r => (
        <Card key={r.ItemId} title={r.Name}
          action={canEditRoles ? (
            <>
              <IconButton icon={<Pencil size={16} strokeWidth={1.75} />} label={t("platform.admin.roles.editName", "Edit {name}", { name: r.Name })} className="h-9 w-9" onClick={() => setEditing({ record: r })} />
              <IconButton icon={<Copy size={16} strokeWidth={1.75} />} label={t("platform.admin.roles.cloneName", "Clone {name}", { name: r.Name })} className="h-9 w-9"
                onClick={() => setEditing({ record: null, from: { name: t("platform.admin.roles.copyName", "{name} copy", { name: r.Name }).slice(0, 60), description: r.Description ?? "", permissions: [...r.Permissions] } })} />
              <IconButton icon={<Trash2 size={16} strokeWidth={1.75} />} label={t("platform.admin.roles.deleteName", "Delete {name}", { name: r.Name })} className="h-9 w-9" onClick={() => setDeleting(r)} />
            </>
          ) : undefined}>
          {r.Description && <p className="text-[14px] text-ink2">{r.Description}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {r.Permissions.length === 0 ? <span className="text-[14px] text-ink2">{t("platform.admin.roles.noRights", "No rights yet.")}</span>
              : r.Permissions.map(p => <Chip key={p}>{permissionLabelText(p)}</Chip>)}
          </div>
          <Holders roleKey={r.Key} />
        </Card>
      ))}

      {canAssign && (
        <Card title={t("platform.admin.roles.assignTitle", "Assign person")} icon={<UserPlus size={18} strokeWidth={1.75} />}>
          <form ref={assignForm} onSubmit={e => void onAssign(e)} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)_auto] sm:items-end">
            <div>
              <label htmlFor="platform-assign-email"><Label>{t("platform.admin.roles.email", "Email")}</Label></label>
              <Input id="platform-assign-email" type="email" autoComplete="off" value={email} onChange={e => setEmail(e.target.value)} placeholder={t("platform.admin.roles.emailPlaceholder", "name@company.com")} />
            </div>
            <div>
              <label htmlFor="platform-assign-role"><Label>{t("platform.admin.roles.role", "Role")}</Label></label>
              <select id="platform-assign-role" value={assignKey} onChange={e => setAssignKey(e.target.value)}
                className="h-11 w-full rounded-block bg-surface2 px-4 text-[14px] text-ink outline-none ring-accent/40 focus:ring-2">
                <option value="" disabled>{t("platform.admin.roles.chooseRole", "Choose a role")}</option>
                {allKeys.map(k => <option key={k} value={k}>{roleName(k)}</option>)}
              </select>
            </div>
            <Button type="submit" variant="secondary" icon={<UserPlus size={16} strokeWidth={1.75} />} disabled={assign.isPending}>{t("platform.admin.roles.assignTitle", "Assign person")}</Button>
          </form>
        </Card>
      )}

      {editing && (
        <RoleEditorModal open onClose={() => setEditing(null)} idPrefix="platform-role"
          title={editingRec ? t("platform.admin.roles.editName", "Edit {name}", { name: editingRec.Name })
            : editing.from ? t("platform.admin.roles.cloneTitle", "Clone platform role") : t("platform.admin.roles.newTitle", "New platform role")}
          initial={editing.from ?? { name: editingRec?.Name ?? "", description: editingRec?.Description ?? "", permissions: editingRec?.Permissions ?? [] }}
          checklist={selected => platformChecklist(selected, granter, editingRec?.Permissions)}
          check={draft => checkPlatformRoleChange({ key: editingRec?.Key ?? roleKeyFromName(draft.name, allKeys), name: draft.name, permissions: draft.permissions }, granter)}
          onSave={onSave} />
      )}

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title={deleting ? t("platform.admin.roles.deleteQuestion", "Delete {name}?", { name: deleting.Name }) : t("platform.admin.roles.deleteRole", "Delete role")}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>{t("platform.admin.roles.cancel", "Cancel")}</Button>
            <Button variant="danger" icon={<Trash2 size={16} strokeWidth={1.75} />} onClick={() => void onDelete()} disabled={del.isPending}>{t("platform.admin.roles.deleteRole", "Delete role")}</Button>
          </>
        )}>
        <p className="text-[14px] text-ink2">{t("platform.admin.roles.deleteText", "This removes the role. A role that someone still has can't be deleted.")}</p>
      </Modal>
    </div>
  );
}
