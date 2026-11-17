import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Card, Tabs } from "@/ui/kit";
import { can } from "@/domain/rbac";
import { workspaceGranterPermissions } from "@/domain/roles";
import { usePlatformAccess, useWorkspaceAccess } from "@/blocks/admin";
import { useCurrentWorkspace, useMe } from "@/state/workspaces";
import { WorkspaceRolesPanel } from "@/components/roles/WorkspaceRolesPanel";
import { WorkspaceMembersPanel } from "@/components/roles/WorkspaceMembersPanel";
import { useT } from "@/i18n";

type Tab = "roles" | "members";

export function WorkspaceRolesCard() {
  const t = useT();
  const ws = useCurrentWorkspace();
  const me = useMe();
  const platform = usePlatformAccess();
  const access = useWorkspaceAccess(ws?.id ?? "", me?.role);
  const [tab, setTab] = useState<Tab>("roles");
  if (!ws) return null;

  const granterPermissions = workspaceGranterPermissions({
    isSuperAdmin: platform.isSuperAdmin, platformPermissions: platform.permissions,
    memberPermissions: access.permissions, crossWorkspace: false,
  });
  const canRoles = can(access.permissions, "roles.manage");
  const canMembers = can(access.permissions, "members.manage");
  const base = { workspaceId: ws.id, workspaceName: ws.name, crossWorkspace: false, granterPermissions };

  return (
    <div id="roles" tabIndex={-1} className="min-w-0 max-w-full scroll-mt-6 outline-none">
      <Card title={t("settings.roles.title", "Roles")} icon={<ShieldCheck size={18} strokeWidth={1.75} />} bodyClassName="flex flex-col gap-5">
        <p className="max-w-[68ch] text-[14px] text-ink2">{t("settings.roles.intro", "What each role may do in this workspace, and who has which role.")}</p>
        <Tabs idPrefix="ws-roles" label={t("settings.roles.tabsLabel", "Roles and members")} value={tab} onChange={setTab}
          tabs={[{ value: "roles", label: t("settings.roles.tabRoles", "Roles") }, { value: "members", label: t("settings.roles.tabMembers", "Members") }]} />
        <div role="tabpanel" id="ws-roles-panel-roles" className="min-w-0 max-w-full" aria-labelledby="ws-roles-tab-roles" hidden={tab !== "roles"}>
          {tab === "roles" && (
            <WorkspaceRolesPanel {...base} canManage={canRoles}
              manageTip={canRoles ? null : t("settings.roles.rolesTip", "Only people who manage roles can change them.")} />
          )}
        </div>
        <div role="tabpanel" id="ws-roles-panel-members" className="min-w-0 max-w-full" aria-labelledby="ws-roles-tab-members" hidden={tab !== "members"}>
          {tab === "members" && (
            <WorkspaceMembersPanel {...base} canManage={canMembers}
              manageTip={canMembers ? null : t("settings.roles.membersTip", "Only people who manage the team can change someone's role.")} />
          )}
        </div>
      </Card>
    </div>
  );
}
