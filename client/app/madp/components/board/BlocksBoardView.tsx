/** The board of a project on SELISE Blocks: the Board tab of the Build step (/p/:id/build?tab=board; the old /p/:id/board
 *  redirects there). Laid out as the original board: the summary line, the filters and the eight full-height pipeline
 *  columns with the ticket cards; the milestones sit in one slim strip above the columns. All read from the Data
 *  Gateway; tickets glide to their new column when a refresh shows they moved.
 *  No auto-lock and no generators here: the tickets come from the board.plan engine job. */
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Kanban } from "lucide-react";
import { useDeliveryContext } from "@/madp/blocks/delivery/context";
import { latestJobFor, useChangeRequests, useDeliveryJobs, useMilestones, usePreviews, useProjectTicketEvents, useTickets } from "@/madp/blocks/delivery/hooks";
import type { DeliveryTicket, DeliveryTicketEvent } from "@/madp/blocks/delivery/types";
import { useProject } from "@/madp/blocks/projects/reads";
import { changeCode } from "@/madp/domain/delivery";
import { changeOf as changeIdOf } from "@/madp/domain/buildQueue";
import { changeStopped } from "@/madp/components/changes/changeStopped";
import { attachedLive } from "@/madp/components/analysis-next/model";
import { worksByChanges } from "@/madp/components/build/buildStep";
import { latestPreviewFor } from "@/madp/components/delivery/MilestonePreviews";
import { EngineJobStatus } from "@/madp/components/engine/EngineJobStatus";
import { engineErrorMessage, retryEngineJob } from "@/madp/blocks/engine/actions";
import { Banner, Button, Card, EmptyState } from "@/madp/ui/kit";
import { groupTicketsByMilestone, NO_MILESTONE } from "../../domain/delivery";
import { BlocksBoardFilters } from "./BlocksBoardFilters";
import { BlocksTicketDrawer } from "./BlocksTicketDrawer";
import { BoardColumns } from "./BoardColumns";
import { BoardHeader } from "./BoardHeader";
import { MILESTONE_STRIP, MilestoneLane } from "./MilestoneLane";
import { boardCounts, creditedAgent, filterBlocksTickets, isBuilding, milestoneTag, NO_BLOCKS_FILTER, type BlocksBoardFilter } from "./blocksBoard";
import { useFeatureNames } from "./useFeatureNames";
import { useT } from "@/madp/i18n";

const PAGE = "flex w-full min-w-0 flex-col";

export function BlocksBoardView({ projectId, highlightTicketId }: { projectId: string; highlightTicketId?: string | null }) {
  const t = useT();
  const ctx = useDeliveryContext(projectId);
  const navigate = useNavigate();
  const tickets = useTickets(ctx);
  const milestones = useMilestones(ctx);
  const previews = usePreviews(ctx);
  const { jobs } = useDeliveryJobs(ctx);
  const changes = useChangeRequests(ctx);
  const events = useProjectTicketEvents(ctx);
  const record = useProject(projectId).data ?? null;
  const names = useFeatureNames(projectId, ctx.project?.currentScopeVersion ?? null);
  const [filter, setFilter] = useState<BlocksBoardFilter>(NO_BLOCKS_FILTER);
  const [open, setOpen] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const featureName = (ref: string) => (ref ? names.get(ref) ?? t("build.queue.aFeature", "A feature") : t("build.queue.crossCutting", "Cross-cutting"));
  const milestoneName = (id: string | null) => milestoneTag(id, milestones.data);
  // the change request of each change ticket ("CR-006") and whether its build stopped (the one rule)
  const crOf = useMemo(() => {
    const out = new Map<string, { code: string; stopped: boolean; title: string }>();
    for (const c of changes.data) {
      out.set(c.id, { code: changeCode(c), title: c.title, stopped: changeStopped(c, latestJobFor(jobs, "change.build", { changeRequestId: c.id })) });
    }
    return out;
  }, [changes.data, jobs]);
  const changeOfTicket = (tk: DeliveryTicket) => {
    const id = tk.milestoneId === null ? changeIdOf(tk.planRef) : null;
    return id ? crOf.get(id) ?? null : null;
  };
  // each ticket is credited to the role that did (or will do) its work, from its recorded moves
  const eventsOf = useMemo(() => {
    const out = new Map<string, DeliveryTicketEvent[]>();
    for (const e of events.data) (out.get(e.ticketId) ?? out.set(e.ticketId, []).get(e.ticketId)!).push(e);
    return out;
  }, [events.data]);
  const agentOf = (tk: DeliveryTicket) => creditedAgent(tk, eventsOf.get(tk.id));
  const byChanges = worksByChanges({ milestones: milestones.data.length, attachedLive: attachedLive(record), changes: changes.data.length });
  const boardChanges = useMemo(() => {
    const ids = new Set(tickets.data.map((tk) => (tk.milestoneId === null ? changeIdOf(tk.planRef) : null)).filter(Boolean));
    return [...changes.data].filter((c) => ids.has(c.id)).sort((a, b) => b.number - a.number)
      .map((c) => ({ id: c.id, code: changeCode(c), title: c.title }));
  }, [changes.data, tickets.data]);
  const features = useMemo(() => {
    const refs = new Set<string>();
    for (const tk of tickets.data) if (tk.featureRef) refs.add(tk.featureRef);
    return Array.from(refs, (id) => ({ id, name: names.get(id) ?? id }));
  }, [tickets.data, names]);
  // every lane, in milestone SortOrder; the columns keep that order inside each column
  const lanes = useMemo(() => groupTicketsByMilestone(tickets.data, milestones.data), [tickets.data, milestones.data]);
  const shown = useMemo(() => groupTicketsByMilestone(filterBlocksTickets(tickets.data, filter, featureName, agentOf), milestones.data).flatMap((l) => l.tickets),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickets.data, milestones.data, filter, names, eventsOf]);
  const counts = useMemo(() => boardCounts(tickets.data), [tickets.data]);
  const live = isBuilding(jobs);

  if (ctx.status === "loading" || (ctx.status === "ready" && tickets.isLoading)) {
    return (
      <div className={PAGE}>
        <div aria-hidden className="flex flex-col gap-6">
          <div className="h-9 w-72 max-w-full rounded-full bg-ink/[0.06]" />
          <div className="hatched h-64 rounded-card bg-surface/60" />
        </div>
      </div>
    );
  }
  if (ctx.status === "not_found") {
    return (
      <div className={PAGE}>
        <Card>
          <EmptyState icon={<Kanban size={28} strokeWidth={1.75} aria-hidden />} title={t("build.board.notAvailable", "This project isn't available")}
            action={<Button variant="primary" data-primary="true" onClick={() => navigate("/projects")}>{t("build.board.openProjects", "Open projects")}</Button>} />
        </Card>
      </div>
    );
  }
  if (ctx.status === "error" || !ctx.project) {
    return <div className={PAGE}><Banner tone="danger" title={t("build.board.loadFailed", "The board could not be loaded")} text={t("build.board.reload", "Reload the page to try again.")} /></div>;
  }
  const project = ctx.project;

  if (tickets.data.length === 0) {
    const planJob = latestJobFor(jobs, "board.plan", {});
    const retry = async () => {
      if (!planJob) return;
      setRetrying(true); setRetryError(null);
      try { await retryEngineJob(planJob.id); } catch (e) { setRetryError(engineErrorMessage(e)); } finally { setRetrying(false); }
    };
    return (
      <div className={PAGE}>
        {!project.scopeLocked ? (
          <Card>
            <EmptyState icon={<Kanban size={28} strokeWidth={1.75} aria-hidden />} title={t("build.board.lockFirst", "Lock the scope and milestones first")}
              text={t("build.board.lockFirstText", "The task board is planned from the locked scope and its milestones.")}
              action={<Button variant="primary" data-primary="true" onClick={() => navigate(`/p/${projectId}/scope`)}>{t("build.page.openScope", "Open the scope")}</Button>} />
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            <Card>
              <EmptyState icon={<Kanban size={28} strokeWidth={1.75} aria-hidden />} title={t("build.board.waitingTitle", "MADP plans the board")}
                text={byChanges ? t("build.board.emptyChanges", "No tickets yet. The tickets of a change request appear here once it is approved.")
                  : t("build.board.emptyMilestones", "No tickets yet. MADP agents plan the tickets milestone by milestone from the locked scope.")} />
              <EngineJobStatus job={planJob} variant="full" canRetry={ctx.can("board.edit")} onRetry={() => void retry()} retrying={retrying} requestError={retryError} />
            </Card>
            {lanes.length > 0 && (
              <div className={MILESTONE_STRIP}>
                {lanes.map((l) => (
                  <MilestoneLane key={l.milestone?.id ?? NO_MILESTONE} milestone={l.milestone} tickets={l.tickets} jobs={jobs}
                    preview={l.milestone ? latestPreviewFor(previews.data, l.milestone.id) : null} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  const ticket = open ? tickets.data.find((tk) => tk.id === open) ?? null : null;
  const pick = (id: string) => setFilter((f) => ({ ...f, milestone: f.milestone === id ? "" : id }));
  return (
    <div className={PAGE}>
      {tickets.error && <Banner tone="danger" className="mb-4" title={t("build.board.refreshFailed", "The tickets could not be refreshed")} />}
      {tickets.unreadable.length > 0 && <Banner tone="warning" className="mb-4" title={t("build.board.unreadable", "{count} ticket(s) can't be read", { count: tickets.unreadable.length })} />}
      <BoardHeader project={project} counts={counts} live={live} />
      <BlocksBoardFilters tickets={tickets.data} milestones={milestones.data} features={features} changes={boardChanges} agentOf={agentOf}
        value={filter} onChange={setFilter} />
      <div className={MILESTONE_STRIP}>
        {lanes.map((l) => {
          const id = l.milestone?.id ?? NO_MILESTONE;
          return (
            <MilestoneLane key={id} milestone={l.milestone} tickets={l.tickets} jobs={jobs}
              preview={l.milestone ? latestPreviewFor(previews.data, l.milestone.id) : null}
              selected={filter.milestone === id} onSelect={() => pick(id)} />
          );
        })}
      </div>
      {shown.length === 0 && <p role="status" className="mb-3 text-[14px] text-ink2">{t("build.board.noMatch", "No tickets match these filters.")}</p>}
      <BoardColumns tickets={shown} all={tickets.data} featureName={featureName} milestoneName={milestoneName} changeOf={changeOfTicket} agentOf={agentOf} live={live}
        filterKey={JSON.stringify(filter)} onOpen={setOpen} highlightTicketId={highlightTicketId} />
      <BlocksTicketDrawer ctx={ctx} ticket={ticket} featureName={featureName} milestoneName={milestoneName} onClose={() => setOpen(null)} />
    </div>
  );
}
