/** Home: the latest projects, each with where it stands (step · who is working · what waits for you) and the one button
 *  that carries it on. */
import { useNavigate } from "react-router-dom";
import { ArrowRight, FolderKanban } from "lucide-react";
import { useMemberName, useProjectList, type ProjectRecord } from "@/madp/blocks/projects";
import { stepPath } from "@/madp/domain/phases";
import { phaseNameOf } from "@/madp/components/project/stepNames";
import { ArrowButton, Button, Card, Chip } from "@/madp/ui/kit";
import { TypeChip } from "@/madp/components/project/TypeChip";
import { relativeTime } from "./ProjectsView";
import { useProjectsNow, WaitingChips, WorkingLine } from "./ProjectNowParts";
import type { ProjectNow } from "@/madp/domain/projectNow";
import { projectActivityAt, projectsByActivity } from "@/madp/domain/dashboard";
import { useT } from "@/madp/i18n";

const MAX = 4;

function Assignee({ userId }: { userId: string }) {
  const name = useMemberName(userId);
  return <>{name}</>;
}

function Row({ p, now, activity }: { p: ProjectRecord; now?: ProjectNow; activity?: ReadonlyMap<string, number> }) {
  const t = useT();
  const navigate = useNavigate();
  const deleting = p.status === "deleting";
  const place = [p.clientName, p.clientRegion].filter(Boolean).join(" · ");
  const updated = relativeTime(projectActivityAt(p, activity));
  return (
    <li className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="break-words text-[15px] font-medium leading-snug">{p.name}</div>
        {place && <div className="break-words text-[13px] text-ink3">{place}</div>}
        {p.assigneeUserId && <div className="break-words text-[13px] text-ink3">{t("shell.projects.assignedTo", "Assigned to")} <Assignee userId={p.assigneeUserId} /></div>}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <TypeChip type={p.type} />
          <Chip tone={deleting ? "warning" : "accent"}>{deleting ? t("shell.projects.deleting", "Deleting…") : phaseNameOf(now?.step ?? p.step)}</Chip>
          {!deleting && now && <WorkingLine now={now} />}
        </div>
        {!deleting && now && now.waiting.length > 0 && <WaitingChips now={now} className="mt-2" />}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:shrink-0">
        {updated && <span className="whitespace-nowrap text-[13px] text-ink2">{updated}</span>}
        {!deleting && (
          <Button size="sm" variant="secondary" className="max-sm:w-full" onClick={() => navigate(stepPath(p.id, p.step))}
            iconRight={<ArrowRight size={14} strokeWidth={2} />}>
            {t("common.actions.continue", "Continue")}
          </Button>
        )}
      </div>
    </li>
  );
}

export function RecentProjects({ className }: { className?: string }) {
  const t = useT();
  const navigate = useNavigate();
  const { now, activity } = useProjectsNow();
  // newest first, by latest activity (as on Projects)
  const items = projectsByActivity(useProjectList().data ?? [], activity);
  return (
    <Card className={className} title={t("shell.home.recentProjects", "Recent projects")} icon={<FolderKanban size={18} strokeWidth={1.75} />}
      action={<ArrowButton label={t("shell.dashboard.allProjects", "All projects")} onClick={() => navigate("/projects")} />}>
      <ul className="flex flex-col divide-y divide-line">
        {items.slice(0, MAX).map((p) => <Row key={p.id} p={p} now={now.get(p.id)} activity={activity} />)}
      </ul>
    </Card>
  );
}
