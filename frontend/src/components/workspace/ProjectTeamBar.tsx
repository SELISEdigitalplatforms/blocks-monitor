import { UserPlus } from "lucide-react";
import { AssignControl } from "@/components/workspace/AssignControl";
import { useMemberName } from "@/blocks/projects/context";
import { useProject, useProjectAssignee } from "@/blocks/projects/reads";
import { isBlocksProjectId } from "@/domain/projects";
import { ROLE_NAME } from "@/data/rbac";
import { initialsOf, useCan } from "@/state/workspaces";
import type { Member } from "@/state/workspaces";
import { Avatar, Chip } from "@/ui/kit";
import { t, useT } from "@/i18n";

/** The compact Assign card of the project navigation: the assignee (or Unassigned) and the Assign button. */
export function ProjectTeamBar({ projectId }: { projectId: string }) {
  return isBlocksProjectId(projectId) ? <BlocksTeamBar projectId={projectId} /> : null;
}

function BlocksTeamBar({ projectId }: { projectId: string }) {
  useT();
  const name = useProject(projectId).data?.name;
  const { assigneeUserId } = useProjectAssignee(projectId);
  const memberName = useMemberName(assigneeUserId);
  return <TeamBarView projectId={projectId} projectName={name || t("shell.workspace.thisProject", "this project")} assignee={assigneeUserId ? { name: memberName, role: null, status: "active" } : null} />;
}

type Assignee = { name: string; role: Member["role"] | null; status: Member["status"] };

function TeamBarView({ projectId, projectName, assignee }: { projectId: string; projectName: string; assignee: Assignee | null }) {
  useT();
  const canAssign = useCan("project.assign");
  const label = assigneeLabel(assignee, canAssign);
  return (
    <div title={canAssign ? undefined : viewerAssignTip()} className="flex h-16 min-w-0 items-center gap-3 rounded-card bg-surface px-3 xl:px-5 shadow-[0_6px_20px_-10px_rgb(10_12_20/0.16)] dark:ring-1 dark:ring-line">
      {assignee ? (
        <Avatar initials={initialsOf(assignee.name)} size={36} tone="soft" />
      ) : (
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-dashed border-line text-ink3"><UserPlus size={16} strokeWidth={1.75} /></span>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[11px] font-medium uppercase leading-none tracking-[0.08em] text-ink3 max-xl:sr-only">{t("shell.workspace.assign.assignee", "Assignee")}</span>
        <div className="flex min-w-0 items-center gap-2">
          <span title={label.name} className={`min-w-0 truncate text-[14px] font-medium max-xl:max-w-[9rem] ${assignee ? "text-ink" : "text-ink2"}`}>{label.name}</span>
          {label.role && <Chip className="shrink-0 !px-2 !py-0.5 !text-[11px] max-xl:hidden">{label.role}</Chip>}
          {label.invited && <Chip tone="warning" className="shrink-0 !px-2 !py-0.5 !text-[11px]">{t("shell.workspace.invited", "Invited")}</Chip>}
        </div>
      </div>
      {canAssign && <AssignControl projectId={projectId} projectName={projectName} className="shrink-0 rounded-full" compact />}
    </div>
  );
}

export const VIEWER_ASSIGN_TIP = "Viewers can't assign";
/** VIEWER_ASSIGN_TIP in the chosen language. */
export const viewerAssignTip = () => t("shell.workspace.viewerAssignTip", "Viewers can't assign");

/** What the Assign field shows: the name, the role chip and the Invited chip; the button is hidden for viewers. */
export function assigneeLabel(assignee: { name: string; role: Member["role"] | null; status: Member["status"] } | null, canAssign: boolean) {
  return {
    name: assignee ? assignee.name : t("shell.workspace.assign.unassigned", "Unassigned"),
    role: assignee?.role ? ROLE_NAME[assignee.role] : null,
    invited: assignee?.status === "invited",
    showButton: canAssign,
    tip: canAssign ? null : viewerAssignTip(),
  };
}
