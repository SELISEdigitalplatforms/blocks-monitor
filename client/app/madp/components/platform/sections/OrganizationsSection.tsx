import { useMemo, useState } from "react";
import { Building2, ChevronLeft, ChevronRight, Layers, Search } from "lucide-react";
import { Button, Card, Chip, EmptyState, Input, Select } from "@/madp/ui/kit";
import { usePlatformAccess, type PlatformAccess } from "@/madp/blocks/admin";
import { messageOf, useApplyRoleTemplate, useOrganizations, usePlatformRolesView, type OrganizationRow } from "@/madp/blocks/platformRbac";
import { WorkspaceDetail } from "@/madp/components/admin/WorkspacesTab";
import { memberStatusLabel } from "@/madp/components/roles/WorkspaceMembersPanel";
import { AuditedChip } from "@/madp/components/roles/AuditedChip";
import { t, useT } from "@/madp/i18n";

const VIEW_PERMISSIONS = ["platform.orgs.manage", "platform.workspaces.view", "platform.workspaces.manage", "platform.workspaceRoles.view"];
const canSee = (a: PlatformAccess) => a.isSuperAdmin || VIEW_PERMISSIONS.some((p) => a.permissions.includes(p));
const canManage = (a: PlatformAccess) => a.isSuperAdmin || a.permissions.includes("platform.workspaces.manage");

// Classic, Speed and Enterprise are plan names; only "Free" is a word.
const PLAN_NAME: Record<string, string> = { free: "Free", classic: "Classic", speed: "Speed", enterprise: "Enterprise" };
export const planLabel = (key: string | null | undefined): string => {
  if (!key) return t("platform.organizations.noPlan", "No plan yet");
  if (key === "free") return t("platform.organizations.planFree", "Free");
  return PLAN_NAME[key] ?? key;
};

const ownerNames = (o: OrganizationRow): string => {
  const names = o.admins.map((a) => a.displayName || a.email).filter(Boolean);
  return names.length ? names.join(", ") : t("platform.organizations.noOwner", "No owner yet");
};

/** Organizations: every organization with its plan, status, members and owner; open one to manage it. */
export default function OrganizationsSection() {
  const t = useT();
  const access = usePlatformAccess();
  const allowed = access.ready && canSee(access);
  const [page, setPage] = useState(1);
  const q = useOrganizations(page, allowed);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<OrganizationRow | null>(null);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    const all = q.data?.items ?? [];
    if (!term) return all;
    return all.filter((o) => o.name.toLowerCase().includes(term) || o.admins.some((a) => `${a.displayName} ${a.email}`.toLowerCase().includes(term)));
  }, [q.data, search]);

  if (!access.ready) return <div aria-busy="true" aria-hidden className="h-64 rounded-card bg-surface/60" />;
  if (!allowed) {
    return <EmptyState icon={<Building2 size={28} strokeWidth={1.75} />} title={t("platform.organizations.deniedTitle", "Organizations need a platform role")}
      text={t("platform.organizations.deniedText", "Ask the super admin for a role that includes seeing organizations.")} />;
  }

  if (selected) {
    const current = q.data?.items.find((o) => o.workspaceId === selected.workspaceId) ?? selected;
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink2">
          <Chip>{planLabel(current.planKey)}</Chip>
          <span>{current.memberCount === 1
            ? t("platform.organizations.membersOne", "{count} member", { count: 1 })
            : t("platform.organizations.membersMany", "{count} members", { count: current.memberCount })}</span>
          <span aria-hidden>·</span>
          <span className="[overflow-wrap:anywhere]">{t("platform.organizations.owner", "Owner: {names}", { names: ownerNames(current) })}</span>
        </div>
        <WorkspaceDetail access={access} workspace={{ ItemId: current.workspaceId, Name: current.name, Status: current.status }} onBack={() => setSelected(null)} />
        {canManage(access) && current.status === "active" && <AddFromTemplate workspaceId={current.workspaceId} workspaceName={current.name} />}
      </div>
    );
  }

  const total = q.data?.totalCount ?? 0;
  const pageSize = q.data?.pageSize ?? 50;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Card title={total
        ? (total === 1 ? t("platform.organizations.countOne", "{count} organization", { count: 1 }) : t("platform.organizations.countMany", "{count} organizations", { count: total }))
        : t("platform.organizations.title", "Organizations")} icon={<Building2 size={18} strokeWidth={1.75} />}
        action={<AuditedChip />} bodyClassName="flex flex-col gap-4">
        <label className="relative block max-w-md">
          <span className="sr-only">{t("platform.organizations.searchLabel", "Search organizations")}</span>
          <Search size={16} strokeWidth={1.75} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink3" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("platform.organizations.searchPlaceholder", "Search by name or owner")} className="pl-9" />
        </label>
        {q.error ? (
          <p role="alert" className="text-[14px] text-danger">{messageOf(q.error)}</p>
        ) : q.isPending ? (
          <p aria-busy="true" className="text-[14px] text-ink3">{t("platform.organizations.loading", "Loading organizations…")}</p>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Building2 size={18} strokeWidth={1.75} />} title={search ? t("platform.organizations.noMatchTitle", "No organization matches") : t("platform.organizations.emptyTitle", "No organizations yet")}
            text={search ? t("platform.organizations.noMatchText", "Try another name or owner.") : t("platform.organizations.emptyText", "An organization appears here once someone signs up and creates one.")} />
        ) : (
          <ul className="flex flex-col gap-2" aria-label={t("platform.organizations.title", "Organizations")}>
            {rows.map((o) => {
              const active = !o.status || o.status === "active";
              return (
                <li key={o.workspaceId} className="grid gap-2 rounded-block bg-surface2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium [overflow-wrap:anywhere]">{o.name}</div>
                    <div className="text-[13px] text-ink3 [overflow-wrap:anywhere]">{t("platform.organizations.owner", "Owner: {names}", { names: ownerNames(o) })}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Chip>{planLabel(o.planKey)}</Chip>
                    <span className="text-[13px] text-ink2">{o.memberCount === 1
                      ? t("platform.organizations.membersOne", "{count} member", { count: 1 })
                      : t("platform.organizations.membersMany", "{count} members", { count: o.memberCount })}</span>
                    {active ? <Chip tone="success">{t("platform.organizations.active", "Active")}</Chip> : <Chip tone={o.status === "suspended" ? "danger" : "warning"}>{memberStatusLabel(o.status)}</Chip>}
                    <Button size="sm" variant="ghost" aria-label={t("platform.organizations.openOrg", "Open {name}", { name: o.name })} iconRight={<ChevronRight size={16} strokeWidth={1.75} />}
                      onClick={() => setSelected(o)}>{t("platform.organizations.open", "Open")}</Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" icon={<ChevronLeft size={16} strokeWidth={1.75} />} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t("platform.organizations.previous", "Previous")}</Button>
            <span className="text-[13px] text-ink2">{t("platform.organizations.page", "Page {page} of {pages}", { page, pages })}</span>
            <Button size="sm" variant="ghost" iconRight={<ChevronRight size={16} strokeWidth={1.75} />} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>{t("platform.organizations.next", "Next")}</Button>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Adds one of the platform's role templates to this organization as its own role. */
function AddFromTemplate({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const t = useT();
  const templates = usePlatformRolesView().data?.templates ?? [];
  const apply = useApplyRoleTemplate();
  const [key, setKey] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  if (templates.length === 0) return null;
  const onAdd = async () => {
    if (!key) { setNote({ ok: false, text: t("platform.organizations.chooseTemplateFirst", "Choose a template first.") }); return; }
    setNote(null);
    try {
      await apply.mutateAsync({ workspaceId, templateKey: key });
      const name = templates.find((tpl) => tpl.key === key)?.name ?? key;
      setNote({ ok: true, text: t("platform.organizations.templateAdded", "{name} is now a role in {organization}.", { name, organization: workspaceName }) });
      setKey("");
    } catch (e) {
      setNote({ ok: false, text: messageOf(e) });
    }
  };
  return (
    <Card title={t("platform.organizations.templateTitle", "Add a role from a template")} icon={<Layers size={18} strokeWidth={1.75} />}>
      <p className="mb-3 text-[14px] text-ink2">{t("platform.organizations.templateText", "The organization gets its own copy, which its admins can then change.")}</p>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,18rem)_auto] sm:items-end">
        <Select label={t("platform.organizations.template", "Template")} value={key} onChange={setKey} placeholder={t("platform.organizations.chooseTemplate", "Choose a template")}
          options={templates.map((tpl) => ({ value: tpl.key, label: tpl.name }))} />
        <Button variant="secondary" disabled={apply.isPending} aria-busy={apply.isPending} onClick={() => void onAdd()}>{t("platform.organizations.addRole", "Add role")}</Button>
      </div>
      {note && <p role={note.ok ? "status" : "alert"} className={note.ok ? "mt-3 text-[13px] text-ink2" : "mt-3 text-[13px] text-danger"}>{note.text}</p>}
    </Card>
  );
}
