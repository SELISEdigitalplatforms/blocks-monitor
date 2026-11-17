import { useState } from "react";
import { Building2, ShieldCheck, X } from "lucide-react";
import { Button, Chip, IconButton, Select } from "@/ui/kit";
import { useSetMemberRole, useWorkspaceRoles, type PlatformAccess } from "@/blocks/admin";
import { useIamAccess, useIamRoles, useSetIamAccess, type IamPersonAccess as Access } from "@/blocks/iam";
import { PLATFORM_ADMIN_ROLE, builtInWorkspaceRoles } from "@/domain/roles";
import type { PersonRow } from "@/blocks/people";
import { t, useT } from "@/i18n";

const canAssign = (a: PlatformAccess) => a.isSuperAdmin || a.permissions.includes("platform.users.manage");
const canChangeOrgRoles = (a: PlatformAccess) => a.isSuperAdmin || a.permissions.includes("platform.workspaces.manage");
const errorText = (e: unknown) => (e instanceof Error ? e.message : t("platform.iam.person.genericError", "Something went wrong. Please try again."));

/** One person's roles as Blocks OS IAM holds them: platform-wide, and one role per organization. Changes save to IAM first. */
export function IamPersonAccess({ access, person }: { access: PlatformAccess; person: PersonRow }) {
  const t = useT();
  const q = useIamAccess(person.userId);
  const roles = useIamRoles();
  const set = useSetIamAccess();
  const [roleKey, setRoleKey] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const who = person.displayName || person.email;
  const platformRoles = (roles.data?.roles ?? []).filter((r) => r.scope === "platform");
  const roleName = (key: string) => (key === PLATFORM_ADMIN_ROLE.key ? PLATFORM_ADMIN_ROLE.name : platformRoles.find((r) => r.key === key)?.name ?? key);
  const held = q.data?.platformRoles ?? [];
  const options = [PLATFORM_ADMIN_ROLE.key, ...platformRoles.filter((r) => !r.builtIn).map((r) => r.key)]
    .filter((k, i, all) => all.indexOf(k) === i && !held.includes(k))
    .filter((k) => access.isSuperAdmin || k !== PLATFORM_ADMIN_ROLE.key)
    .map((k) => ({ value: k, label: roleName(k) }));

  const setPlatform = async (next: string[], done: string) => {
    setNote(null);
    try {
      const out = await set.mutateAsync({ userId: person.userId, roleKeys: next });
      setNote({ ok: true, text: out.factoryInStep === false ? t("platform.iam.person.factoryBehind", "{done} Blocks OS IAM is updated; the Factory copy could not be, run Check in IAM sync.", { done }) : done });
      setRoleKey("");
    } catch (e) { setNote({ ok: false, text: errorText(e) }); }
  };

  if (q.error) return <p role="alert" className="text-[14px] text-danger">{errorText(q.error)}</p>;
  if (q.isPending) return <p aria-busy="true" className="text-[14px] text-ink3">{t("platform.iam.person.loading", "Loading access from Blocks OS IAM…")}</p>;
  const data = q.data;
  if (!data) return null;
  return (
    <>
      {note && <p role={note.ok ? "status" : "alert"} className={note.ok ? "text-[13px] text-ink2" : "text-[13px] text-danger"}>{note.text}</p>}
      <section aria-label={t("platform.iam.person.platformRolesLabel", "Platform roles")} className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2 text-[14px] font-medium"><ShieldCheck size={16} strokeWidth={1.75} aria-hidden />{t("platform.iam.person.platformRolesTitle", "Platform roles in Blocks OS IAM")}</h3>
        {person.superAdmin && <p className="text-[13px] text-ink2">{t("platform.iam.person.superAdminNote", "As super admin they hold every platform permission whatever roles they have.")}</p>}
        {held.length === 0 ? <p className="text-[13px] text-ink3">{t("platform.iam.person.noPlatformRole", "No platform role.")}</p> : (
          <ul className="flex flex-wrap gap-2">
            {held.map((k) => (
              <li key={k} className="flex items-center gap-1 rounded-full bg-surface2 py-1 pl-3 pr-1 text-[13px]">
                {roleName(k)}
                {canAssign(access) && (access.isSuperAdmin || k !== PLATFORM_ADMIN_ROLE.key) && (
                  <IconButton icon={<X size={14} strokeWidth={1.75} />} label={t("platform.iam.person.removeRoleLabel", "Remove {role} from {who}", { role: roleName(k), who })} className="h-7 w-7"
                    disabled={set.isPending} onClick={() => void setPlatform(held.filter((x) => x !== k), t("platform.iam.person.roleRemoved", "{role} removed from {who}.", { role: roleName(k), who }))} />
                )}
              </li>
            ))}
          </ul>
        )}
        {canAssign(access) && options.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-[minmax(0,18rem)_auto] sm:items-end">
            <Select label={t("platform.iam.person.giveRoleLabel", "Give a platform role")} value={roleKey} onChange={setRoleKey} placeholder={t("platform.iam.person.chooseRole", "Choose a role")} options={options} />
            <Button variant="secondary" disabled={set.isPending || !roleKey} aria-busy={set.isPending}
              onClick={() => void setPlatform([...held, roleKey], t("platform.iam.person.roleGiven", "{who} now holds {role}.", { who, role: roleName(roleKey) }))}>{t("platform.iam.person.giveRole", "Give role")}</Button>
          </div>
        )}
      </section>
      <section aria-label={t("platform.iam.person.organizationsLabel", "Organizations")} className="flex flex-col gap-2">
        <h3 className="flex items-center gap-2 text-[14px] font-medium"><Building2 size={16} strokeWidth={1.75} aria-hidden />{t("platform.iam.person.orgRolesTitle", "Role in each organization")}</h3>
        {data.organizations.length === 0 ? <p className="text-[13px] text-ink3">{t("platform.iam.person.noOrganization", "Not a member of any organization.")}</p> : (
          <ul className="flex flex-col gap-2">
            {data.organizations.map((o) => (
              <OrganizationLine key={o.workspaceId} line={o} userId={person.userId} editable={canChangeOrgRoles(access)} />
            ))}
          </ul>
        )}
        {data.unlinked.length > 0 && (
          <p className="text-[13px] text-ink2">{data.unlinked.length === 1
            ? t("platform.iam.person.unlinkedOne", "Blocks OS IAM also holds Factory roles for this person in {n} organization the Factory doesn't know. Run Check in IAM sync.", { n: data.unlinked.length })
            : t("platform.iam.person.unlinkedMany", "Blocks OS IAM also holds Factory roles for this person in {n} organizations the Factory doesn't know. Run Check in IAM sync.", { n: data.unlinked.length })}</p>
        )}
      </section>
    </>
  );
}

function OrganizationLine({ line, userId, editable }: { line: Access["organizations"][number]; userId: string; editable: boolean }) {
  const t = useT();
  const custom = useWorkspaceRoles(editable ? line.workspaceId : null);
  const set = useSetIamAccess();
  const setFactory = useSetMemberRole();
  const [error, setError] = useState<string | null>(null);
  const current = line.iamRoles[0] ?? line.factoryRole ?? "";
  const options = [
    ...builtInWorkspaceRoles().map((r) => ({ value: r.key, label: r.name })),
    ...(custom.data ?? []).map((r) => ({ value: r.Key, label: r.Name })),
  ];
  for (const k of [current, ...line.iamRoles]) if (k && !options.some((o) => o.value === k)) options.push({ value: k, label: k });
  const label = (k: string) => options.find((o) => o.value === k)?.label ?? k;
  const changeable = editable && Boolean(line.membershipId) && line.factoryRole !== null && line.workspaceStatus === "active";
  const busy = set.isPending || setFactory.isPending;
  const onChange = async (roleKey: string) => {
    if (roleKey === current && line.inStep) return;
    setError(null);
    try {
      const out = await set.mutateAsync({ userId, workspaceId: line.workspaceId, roleKeys: [roleKey] });
      // The Factory membership in step, through the organization's own member op (owner guard, reader stamps).
      if (out.factory?.needsUpdate) {
        await setFactory.mutateAsync({ workspaceId: line.workspaceId, membershipId: out.factory.membershipId, userId, roleKey, crossWorkspace: true });
      }
    } catch (e) { setError(errorText(e)); }
  };
  return (
    <li className="grid gap-2 rounded-block bg-surface2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="text-[14px] font-medium [overflow-wrap:anywhere]">{line.workspaceName || t("platform.iam.person.organizationFallback", "Organization")}</div>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink3">
          {line.inStep ? <span>{t("platform.iam.person.inStep", "In step with the Factory")}</span> : (
            <Chip tone="warning">
              {line.iamRoles.length === 0
                ? t("platform.iam.person.notInIam", "Not in Blocks OS IAM yet")
                : line.factoryRole
                  ? t("platform.iam.person.factorySays", "Factory says {role}", { role: label(line.factoryRole) })
                  : t("platform.iam.person.factorySaysNone", "Factory says no role")}
            </Chip>
          )}
        </div>
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      </div>
      {changeable
        ? <Select size="sm" label={t("platform.iam.person.roleIn", "Role in {organization}", { organization: line.workspaceName })} value={current} onChange={(v) => void onChange(v)} options={options} disabled={busy} />
        : <Chip>{current ? label(current) : t("platform.iam.person.noRole", "No role")}</Chip>}
    </li>
  );
}
