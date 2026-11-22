import { ExternalLink } from "lucide-react";
import { isActiveEngineJob, type EngineJob } from "@/blocks/engine/types";
import type { DeliveryMilestone, DeliveryPreview, DeliveryTicket } from "@/blocks/delivery/types";
import { latestJobFor } from "@/blocks/delivery/hooks";
import { EngineJobStatus } from "@/components/engine/EngineJobStatus";
import { notDeployedText } from "@/components/delivery/releaseUi";
import { useT } from "@/i18n";
import { appLink } from "@/domain/appPreview";
import { Bar, Chip } from "@/ui/kit";
import type { ChipTone } from "@/data/types";
import { cn } from "@/lib/cn";
import { milestoneStopped, milestoneWord } from "@/components/build/buildStep";
import { laneCounts } from "./blocksBoard";

// the same words as the Build step's milestone list (Planned, Being built, Stopped, Ready to try, Accepted, Delivered)
const TONE: Record<DeliveryMilestone["status"], ChipTone> = { planned: "neutral", building: "accent", "preview-ready": "success", done: "success" };

/** The board's milestones as one slim strip above the columns, so the eight columns keep the page as on the original
 *  board. Every lane in SortOrder; the strip scrolls sideways when the milestones do not fit. */
export const MILESTONE_STRIP = "scroll-thin mb-4 grid auto-cols-[minmax(260px,1fr)] grid-flow-col gap-3 overflow-x-auto overscroll-x-contain pb-1";

/** The milestone's real preview in one line: the https preview to open, a stored preview that is not deployed, the
 *  state of its preview.deploy job, or that it comes after the build. Copy link and the version history are on the
 *  Timeline tab's milestone rows and the Release page. */
function PreviewLine({ milestone, preview, job }: { milestone: DeliveryMilestone; preview: DeliveryPreview | null; job: EngineJob | null }) {
  const t = useT();
  const url = preview ? appLink(preview)?.href ?? null : null;
  if (preview && url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" aria-label={t("build.board.lane.openPreviewOf", "Open preview of milestone {number}: {name}", { number: milestone.number, name: milestone.name })}
        className="inline-flex items-center gap-1 rounded text-[12px] font-medium text-[rgb(var(--c-accent-text))] underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50">
        <ExternalLink size={12} strokeWidth={1.75} aria-hidden />{t("build.board.lane.openPreview", "Open preview")}<span className="num font-mono font-normal text-ink3">{`v${preview.version}`}</span>
      </a>
    );
  }
  if (preview) return <span className="text-[12px] text-ink3">{notDeployedText()}</span>;
  if (job) return <EngineJobStatus variant="compact" job={job} className="text-[12px]" />;
  return <span className="text-[12px] text-ink3" title={t("build.board.lane.previewLaterTitle", "Preview after this milestone is built")}>{t("build.board.lane.previewLater", "Preview after the build")}</span>;
}

/** One milestone of the board (or "Changes and fixes" for tickets without one): its stored status, its tickets done,
 *  its latest preview, and a toggle that shows only its tickets in the columns below. The goal is its tooltip. */
export function MilestoneLane({ milestone, tickets, preview, jobs, selected = false, onSelect }: {
  milestone: DeliveryMilestone | null; tickets: DeliveryTicket[]; preview: DeliveryPreview | null; jobs: EngineJob[];
  selected?: boolean; onSelect?: () => void;
}) {
  const t = useT();
  const { done, total } = laneCounts(tickets);
  const title = milestone ? t("build.page.milestoneNamed", "Milestone {number}: {name}", { number: milestone.number, name: milestone.name }) : t("build.queue.changesAndFixes", "Changes and fixes");
  const build = milestone ? latestJobFor(jobs, "build.run", { milestoneId: milestone.id }) : null;
  const running = Boolean(build && isActiveEngineJob(build));
  // its newest build (or preview) failed or was cancelled: "Stopped", as on the Build page (buildStep.ts milestoneStopped)
  const stopped = milestone ? milestoneStopped(jobs, milestone.id) : false;
  // the changes and fixes lane: "Being built" while a change request's build runs
  const changeRunning = !milestone && jobs.some((j) => j.kind === "change.build" && isActiveEngineJob(j));
  const word = milestone ? milestoneWord(milestone, running, stopped) : null;
  const status = milestone && word ? { label: word, tone: running ? "accent" as ChipTone : word === t("build.step.milestone.stopped", "Stopped") ? "danger" as ChipTone : TONE[milestone.status] ?? "neutral" }
    : changeRunning ? { label: t("build.step.milestone.building", "Being built"), tone: "accent" as ChipTone } : null;
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <section aria-label={title} title={milestone?.goal || undefined}
      className={cn("flex min-w-0 flex-col gap-1.5 rounded-card bg-surface px-4 py-3 shadow-card", selected && "ring-2 ring-accent")}>
      <header className="flex min-w-0 items-center gap-2">
        <h3 className="min-w-0 flex-1 truncate text-[14px] font-medium">
          {onSelect ? (
            <button type="button" aria-pressed={selected} onClick={onSelect} title={selected ? t("build.board.lane.showAll", "Show every ticket") : t("build.board.lane.showThese", "Show only these tickets")}
              className="max-w-full truncate rounded text-left outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50">{title}</button>
          ) : title}
        </h3>
        {status && <Chip tone={status.tone} className="shrink-0">{status.label}</Chip>}
      </header>
      <div className="flex min-w-0 items-center gap-3 text-[12px] text-ink2">
        <span className="num shrink-0">{t("build.board.lane.done", "{done}/{total} done", { done, total })}</span>
        <Bar value={pct} tone={total > 0 && done === total ? "success" : "accent"} className="h-1.5 min-w-12 flex-1" />
        {milestone && (
          <span className="min-w-0 max-w-[55%] shrink-0 truncate">
            <PreviewLine milestone={milestone} preview={preview} job={latestJobFor(jobs, "preview.deploy", { milestoneId: milestone.id })} />
          </span>
        )}
      </div>
    </section>
  );
}
