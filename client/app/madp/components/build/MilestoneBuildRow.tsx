/** One milestone on the build page: its status, its build.run job, the ticket count per column and its preview. */
import { Card, Chip } from "@/madp/ui/kit";
import { EngineJobStatus } from "@/madp/components/engine/EngineJobStatus";
import { columnName } from "@/madp/components/board/TicketHistory";
import { MilestonePreviewItem } from "@/madp/components/delivery/MilestonePreviews";
import { latestJobFor } from "@/madp/blocks/delivery/hooks";
import type { DeliveryMilestone, DeliveryPreview, DeliveryTicket } from "@/madp/blocks/delivery/types";
import { isActiveEngineJob, type EngineJob } from "@/madp/blocks/engine/types";
import { TICKET_COLUMNS } from "@/madp/domain/delivery";
import { columnCounts } from "./blocksBuild";
import { milestoneWord } from "./buildStep";
import { useT } from "@/madp/i18n";

export function MilestoneBuildRow({ milestone, tickets, jobs, preview, previewJob, stopped = false }: {
  milestone: DeliveryMilestone;
  tickets: readonly DeliveryTicket[];
  jobs: readonly EngineJob[];
  preview: DeliveryPreview | null;
  previewJob: EngineJob | null;
  /** Its newest build (or preview) failed or was cancelled (buildStep.ts milestoneStopped). */
  stopped?: boolean;
}) {
  const t = useT();
  const counts = columnCounts(tickets, milestone.id);
  const build = latestJobFor(jobs, "build.run", { milestoneId: milestone.id });
  return (
    <Card title={t("build.page.milestoneNamed", "Milestone {number}: {name}", { number: milestone.number, name: milestone.name })} action={<Chip tone="neutral">{milestoneWord(milestone, Boolean(build && isActiveEngineJob(build)), stopped)}</Chip>}>
      {milestone.goal && <p className="mb-3 max-w-[70ch] text-[14px] text-ink2">{milestone.goal}</p>}
      {/* the build's recorded progress, the Studio's number (never the eased one: the two must agree) */}
      <EngineJobStatus variant="compact" job={build} recorded />
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8" aria-label={t("build.row.perColumn", "Tickets per column, milestone {number}", { number: milestone.number })}>
        {TICKET_COLUMNS.map((c) => (
          <li key={c} className="rounded-block bg-surface2 px-3 py-2">
            <span className="block text-[12px] text-ink3">{columnName(c)}</span>
            <span className="font-mono text-[15px] font-medium">{counts[c]}</span>
          </li>
        ))}
      </ul>
      <ul className="mt-3">
        <MilestonePreviewItem compact milestone={milestone} preview={preview} job={previewJob} />
      </ul>
    </Card>
  );
}
