/** Home: the projects assigned to the signed-in member (real Blocks records), newest first. "Take over" opens the project
 *  at its current step and continues its steps with the member's own rights; a Viewer opens it read-only. */
import { useNavigate } from "react-router-dom";
import { UserCheck } from "lucide-react";
import { useAssignedToMe, useMemberName, useProjectsContext } from "@/blocks/projects";
import { stepPath } from "@/domain/phases";
import { can } from "@/domain/rbac";
import { Button, Card } from "@/ui/kit";
import { relativeTime } from "./ProjectsView";
import { useT } from "@/i18n";

type Row = NonNullable<ReturnType<typeof useAssignedToMe>["data"]>[number];

function AssignedBy({ row }: { row: Row }) {
  const t = useT();
  const name = useMemberName(row.latest?.assignedByUserId ?? "");
  const when = relativeTime(row.latest?.at);
  const place = [row.project.clientName].filter(Boolean).join(" · ");
  return (
    <div className="break-words text-[13px] text-ink3">
      {[place, row.latest ? t("shell.home.assignedBy", "Assigned by {name}", { name }) : "", when].filter(Boolean).join(" · ")}
    </div>
  );
}

export function AssignedToYou({ className }: { className?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const ctx = useProjectsContext();
  const rows = (useAssignedToMe().data ?? []).filter((r) => r.project.status === "active");
  if (rows.length === 0) return null;
  const canEdit = ctx.isSuperAdmin || can(ctx.permissions, "project.edit");
  return (
    <Card title={t("shell.home.assignedToYou", "Assigned to you")} icon={<UserCheck size={18} strokeWidth={1.75} />} className={className}
      action={<span className="num text-[12px] text-ink3">{rows.length}</span>}>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.project.id} className="flex flex-col gap-3 rounded-block bg-surface2 px-4 py-3 sm:flex-row sm:items-center">
            <div className="min-w-0">
              <div className="break-words text-[14px] font-medium">{row.project.name || t("shell.search.untitledProject", "Untitled project")}</div>
              <AssignedBy row={row} />
            </div>
            <Button size="sm" variant="secondary" className="sm:ml-auto" onClick={() => navigate(stepPath(row.project.id, row.project.step))}>
              {canEdit ? t("shell.home.takeOver", "Take over") : t("common.actions.open", "Open")}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
