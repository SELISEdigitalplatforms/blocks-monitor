import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, ShieldCheck, UserCog, Users, X } from "lucide-react";
import { Button, Card, Chip, EmptyState, IconButton, Select } from "@/madp/ui/kit";
import {
  applyIamRoleChange, useAssignPlatformRole, usePlatformAccess, useSetMemberRole, useUnassignPlatformRole, useWorkspaceRoles,
  type AssignResult, type PlatformAccess, MSG_ASK_SUPER_ADMIN,
} from "@/madp/blocks/admin";
import { messageOf, usePersonAccess, usePlatformRolesView, type PersonAccess } from "@/madp/blocks/platformRbac";
import { meKeys } from "@/madp/blocks/workspaces/queries";
import { useSession } from "@/madp/blocks/session";
import type { PersonRow } from "@/madp/blocks/people";
import { PLATFORM_ADMIN_ROLE, builtInWorkspaceRoles } from "@/madp/domain/roles";
import { PeopleCard } from "@/madp/components/settings/PeopleCard";
import { memberStatusLabel } from "@/madp/components/roles/WorkspaceMembersPanel";
import { AuditedChip } from "@/madp/components/roles/AuditedChip";
import { useIamStatus } from "@/madp/blocks/iam";
import { IamSourceLine } from "@/madp/components/platform/iam/IamSourceLine";
import { IamPersonAccess } from "@/madp/components/platform/iam/IamPersonAccess";
import { localizedRoles, platformAdminRoleName } from "@/madp/components/roles/permissionText";
import { useT } from "@/madp/i18n";

const canSeePeople = (a: PlatformAccess) => a.isSuperAdmin || a.permissions.includes("platform.people.manage");
const canAssign = (a: PlatformAccess) => a.isSuperAdmin || a.permissions.includes("platform.users.manage");
const canChangeOrgRoles = (a: PlatformAccess) => a.isSuperAdmin || a.permissions.includes("platform.workspaces.manage");

/** People: everyone who can sign in, their platform roles and the organizations they belong to. */
export default function PeopleSection() {
  const t = useT();
  const access = usePlatformAccess();
  const [person, setPerson] = useState<PersonRow | null>(null);
  const status = useIamStatus(access.ready && canSeePeople(access));
  if (!access.ready) return <div aria-busy="true" aria-hidden className="h-64 rounded-card bg-surface/60" />;
  if (!canSeePeople(access)) {
    return <EmptyState icon={<Users size={28} strokeWidth={1.75} />} title={t("platform.people.deniedTitle", "People need a platform role")}
      text={t("platform.people.deniedText", "Ask the super admin for a role that includes seeing people.")} />;
  }
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <p className="max-w-[72ch] text-[14px] text-ink2">
        {access.isSuperAdmin
          ? t("platform.people.introSuperAdmin", "Invite someone or create an account, open a person's access to change their platform roles and their role in each organization, or deactivate them.")
          : t("platform.people.intro", "Open a person's access to change their platform roles and their role in each organization. Inviting people and changing accounts is for the super admin.")}
      </p>
      <IamSourceLine status={status.data} />
      {person && <PersonAccessCard access={access} person={person} onClose={() => setPerson(null)} iam={status.data?.source === "iam"} />}
      {access.isSuperAdmin ? <PeopleCard onOpenAccess={setPerson} /> : <RoleHolders onOpen={setPerson} />}
    </div>
  );
}

/** Everyone holding a platform role (the IAM directory itself is the super admin's), each with their access. */
function RoleHolders({ onOpen }: { onOpen: (p: PersonRow) => void }) {
  const t = useT();
  const q = usePlatformRolesView();
  const byUser = new Map<string, { userId: string; email: string; displayName: string; roles: string[] }>();
  for (const a of q.data?.assignments ?? []) {
    if (a.status !== "active") continue;
    const e = byUser.get(a.userId) ?? { userId: a.userId, email: a.email, displayName: a.displayName, roles: [] };
    e.roles.push(a.roleKey);
    byUser.set(a.userId, e);
  }
  const names = new Map((q.data?.roles ?? []).map((r) => [r.key, r.name]));
  const people = [...byUser.values()].sort((x, y) => (x.displayName || x.email).localeCompare(y.displayName || y.email));
  return (
    <Card title={t("platform.people.roleHoldersTitle", "People with a platform role")} icon={<Users size={18} strokeWidth={1.75} />}>
      {q.error ? <p role="alert" className="text-[14px] text-danger">{messageOf(q.error)}</p>
        : q.isPending ? <p aria-busy="true" className="text-[14px] text-ink3">{t("platform.people.loadingPeople", "Loading people…")}</p>
        : people.length === 0 ? <p className="text-[14px] text-ink3">{t("platform.people.noRoleHolders", "Nobody holds a platform role yet.")}</p> : (
          <ul className="flex flex-col gap-2">
            {people.map((p) => (
              <li key={p.userId} className="grid gap-2 rounded-block bg-surface2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <div className="min-w-0">
                  <div className="text-[14px] font-medium [overflow-wrap:anywhere]">{p.displayName || p.email}</div>
                  <div className="text-[13px] text-ink3 [overflow-wrap:anywhere]">{p.roles.map((k) => names.get(k) ?? (k === PLATFORM_ADMIN_ROLE.key ? platformAdminRoleName(PLATFORM_ADMIN_ROLE.name) : k)).join(", ")}</div>
                </div>
                <Button size="sm" variant="ghost" aria-label={t("platform.people.openAccess", "Open {name}'s access", { name: p.displayName || p.email })}
                  onClick={() => onOpen({ userId: p.userId, email: p.email, firstName: "", lastName: "", displayName: p.displayName || p.email, roles: [], active: true, superAdmin: false })}>
                  {t("platform.people.access", "Access")}
                </Button>
              </li>
            ))}
          </ul>
        )}
    </Card>
  );
}

export function PersonAccessCard({ access, person, onClose, iam = false }: { access: PlatformAccess; person: PersonRow; onClose: () => void; iam?: boolean }) {
  // With Blocks OS IAM as the source the person's roles are read from and saved to IAM.
  const t = useT();
  const q = usePersonAccess(iam ? null : person.userId);
  const rolesQ = usePlatformRolesView();
  const assign = useAssignPlatformRole();
  const unassign = useUnassignPlatformRole();
  const client = useQueryClient();
  const uid = useSession((s) => s.profile?.userId ?? "");
  const [roleKey, setRoleKey] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => { heading.current?.focus(); setNote(null); setRoleKey(""); }, [person.userId]);

  const custom = (rolesQ.data?.roles ?? []).filter((r) => r.key !== PLATFORM_ADMIN_ROLE.key);
  const roleName = (key: string) => (key === PLATFORM_ADMIN_ROLE.key ? platformAdminRoleName(PLATFORM_ADMIN_ROLE.name) : custom.find((r) => r.key === key)?.name ?? key);
  const held = q.data?.platformRoles.map((r) => r.roleKey) ?? [];
  const options = [PLATFORM_ADMIN_ROLE.key, ...custom.map((r) => r.key)]
    .filter((k) => !held.includes(k))
    .filter((k) => access.isSuperAdmin || k !== PLATFORM_ADMIN_ROLE.key)
    .map((k) => ({ value: k, label: roleName(k) }));
  const who = person.displayName || person.email;

  const refresh = () => client.invalidateQueries({ queryKey: meKeys.admin(uid, "people.access") });
  const iamNote = async (out: AssignResult | undefined): Promise<string> => {
    const change = out?.iamRoleChange;
    if (!change) return "";
    if (!access.isSuperAdmin) return ` ${MSG_ASK_SUPER_ADMIN}`;
    const r = await applyIamRoleChange(change, person.email);
    return r.ok
      ? ` ${t("platform.people.iamUpdated", "User-management access updated.")}`
      : ` ${t("platform.people.iamNotUpdated", "User-management access was not updated: {error}", { error: r.error })}`;
  };

  const onAssign = async () => {
    if (!roleKey) { setNote({ ok: false, text: t("platform.people.chooseRole", "Choose the role to give.") }); return; }
    setNote(null);
    try {
      const out = await assign.mutateAsync({ userId: person.userId, roleKey });
      await refresh();
      setNote({ ok: true, text: `${t("platform.people.roleGiven", "{who} now holds {role}.", { who, role: roleName(roleKey) })}${await iamNote(out)}` });
      setRoleKey("");
    } catch (e) { setNote({ ok: false, text: messageOf(e) }); }
  };
  const onRemove = async (key: string) => {
    setNote(null);
    try {
      const out = await unassign.mutateAsync({ userId: person.userId, roleKey: key });
      await refresh();
      setNote({ ok: true, text: `${t("platform.people.roleRemoved", "{role} removed from {who}.", { role: roleName(key), who })}${await iamNote(out)}` });
    } catch (e) { setNote({ ok: false, text: messageOf(e) }); }
  };

  return (
    <Card title={<span ref={heading} tabIndex={-1} className="outline-none [overflow-wrap:anywhere]">{who}</span>}
      icon={<UserCog size={18} strokeWidth={1.75} />}
      action={(
        <>
          <AuditedChip />
          <IconButton icon={<X size={16} strokeWidth={1.75} />} label={t("platform.people.close", "Close")} className="h-9 w-9" onClick={onClose} />
        </>
      )}
      bodyClassName="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink2">
        <span className="[overflow-wrap:anywhere]">{person.email}</span>
        {person.superAdmin && <Chip tone="accent">{t("platform.people.superAdmin", "Super admin")}</Chip>}
        {!person.active && <Chip tone="warning">{t("platform.people.deactivated", "Deactivated")}</Chip>}
      </div>
      {iam && <IamPersonAccess access={access} person={person} />}
      {!iam && note && <p role={note.ok ? "status" : "alert"} className={note.ok ? "text-[13px] text-ink2" : "text-[13px] text-danger"}>{note.text}</p>}
      {iam ? null : q.error ? <p role="alert" className="text-[14px] text-danger">{messageOf(q.error)}</p>
        : q.isPending ? <p aria-busy="true" className="text-[14px] text-ink3">{t("platform.people.loadingAccess", "Loading access…")}</p>
        : q.data && (
          <>
            <section aria-label={t("platform.people.platformRoles", "Platform roles")} className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 text-[14px] font-medium"><ShieldCheck size={16} strokeWidth={1.75} aria-hidden />{t("platform.people.platformRoles", "Platform roles")}</h3>
              {person.superAdmin && <p className="text-[13px] text-ink2">{t("platform.people.superAdminNote", "As super admin they hold every platform permission whatever roles they have.")}</p>}
              {held.length === 0 ? <p className="text-[13px] text-ink3">{t("platform.people.noPlatformRole", "No platform role.")}</p> : (
                <ul className="flex flex-wrap gap-2">
                  {held.map((k) => (
                    <li key={k} className="flex items-center gap-1 rounded-full bg-surface2 py-1 pl-3 pr-1 text-[13px]">
                      {roleName(k)}
                      {canAssign(access) && (
                        <IconButton icon={<X size={14} strokeWidth={1.75} />} label={t("platform.people.removeRole", "Remove {role} from {who}", { role: roleName(k), who })} className="h-7 w-7"
                          disabled={unassign.isPending} onClick={() => void onRemove(k)} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canAssign(access) && options.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,18rem)_auto] sm:items-end">
                  <Select label={t("platform.people.giveRoleLabel", "Give a platform role")} value={roleKey} onChange={setRoleKey} placeholder={t("platform.people.chooseRolePlaceholder", "Choose a role")} options={options} />
                  <Button variant="secondary" disabled={assign.isPending} aria-busy={assign.isPending} onClick={() => void onAssign()}>{t("platform.people.giveRole", "Give role")}</Button>
                </div>
              )}
            </section>
            <section aria-label={t("platform.people.organizations", "Organizations")} className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 text-[14px] font-medium"><Building2 size={16} strokeWidth={1.75} aria-hidden />{t("platform.people.organizations", "Organizations")}</h3>
              {q.data.memberships.length === 0 ? <p className="text-[13px] text-ink3">{t("platform.people.noOrganizations", "Not a member of any organization.")}</p> : (
                <ul className="flex flex-col gap-2">
                  {q.data.memberships.map((m) => (
                    <MembershipLine key={m.membershipId} m={m} userId={person.userId} editable={canChangeOrgRoles(access)} onChanged={refresh} />
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
    </Card>
  );
}

function MembershipLine({ m, userId, editable, onChanged }: {
  m: PersonAccess["memberships"][number]; userId: string; editable: boolean; onChanged: () => Promise<unknown>;
}) {
  const t = useT();
  const roles = useWorkspaceRoles(editable ? m.workspaceId : null);
  const setRole = useSetMemberRole();
  const [error, setError] = useState<string | null>(null);
  const options = [
    ...localizedRoles(builtInWorkspaceRoles()).map((r) => ({ value: r.key, label: r.name })),
    ...(roles.data ?? []).map((r) => ({ value: r.Key, label: r.Name })),
  ];
  if (!options.some((o) => o.value === m.roleKey)) options.push({ value: m.roleKey, label: m.roleKey });
  const label = options.find((o) => o.value === m.roleKey)?.label ?? m.roleKey;
  const changeable = editable && m.status === "active" && m.workspaceStatus === "active";
  const onChange = async (roleKey: string) => {
    if (roleKey === m.roleKey) return;
    setError(null);
    try {
      await setRole.mutateAsync({ workspaceId: m.workspaceId, membershipId: m.membershipId, userId, roleKey, crossWorkspace: true });
      await onChanged();
    } catch (e) { setError(messageOf(e)); }
  };
  return (
    <li className="grid gap-2 rounded-block bg-surface2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="text-[14px] font-medium [overflow-wrap:anywhere]">{m.workspaceName || t("platform.people.organizationFallback", "Organization")}</div>
        <div className="flex flex-wrap gap-2 text-[13px] text-ink3">
          <span>{memberStatusLabel(m.status)}</span>
          {m.workspaceStatus && m.workspaceStatus !== "active" && <Chip tone="warning">{t("platform.people.organizationStatus", "Organization {status}", { status: memberStatusLabel(m.workspaceStatus).toLowerCase() })}</Chip>}
        </div>
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      </div>
      {changeable
        ? <Select size="sm" label={t("platform.people.roleIn", "Role in {organization}", { organization: m.workspaceName })} value={m.roleKey} onChange={(v) => void onChange(v)} options={options} disabled={setRole.isPending} />
        : <Chip>{label}</Chip>}
    </li>
  );
}
