/** The Build step's Queue tab: the development team's planned work as MADP Studio's Queue page (madp-studio
 *  web/src/pages/Queue.tsx) in the Factory's layout — "Dependencies" (the map, its legend and a milestone filter, the
 *  current milestone first) and "Planned work" (every task with its status, when it started and finished, its pull
 *  request and what it still waits for; cards on a phone). A task opens the same ticket drawer as the Board. Reads
 *  only real records (tickets with their DependsOn, ticket events, milestones, build jobs). */
import { useMemo, useState } from "react";
import { GitPullRequest, ListOrdered, Network } from "lucide-react";
import type { DeliveryContext } from "@/blocks/delivery/context";
import type { DeliveryChangeRequest, DeliveryMilestone, DeliveryTicket, DeliveryTicketEvent } from "@/blocks/delivery/types";
import type { EngineJob } from "@/blocks/engine/types";
import { latestJobFor } from "@/blocks/delivery/hooks";
import { BlocksTicketDrawer } from "@/components/board/BlocksTicketDrawer";
import { milestoneTag } from "@/components/board/blocksBoard";
import { useFeatureNames } from "@/components/board/useFeatureNames";
import { EngineJobStatus } from "@/components/engine/EngineJobStatus";
import { FLOW_STATUS_LOOK, FlowStatusBadge } from "@/components/flow/FlowMap";
import {
  buildQueue, changesAndFixes, queueFlowStatus, queueGroups, queueStatusText, swissStamp, waitingOn, type QueueItem,
} from "@/domain/buildQueue";
import { cn } from "@/lib/cn";
import { Button, Card, Chip, EmptyState, Segmented } from "@/ui/kit";
import { QueueGraph } from "./QueueGraph";
import { t, useCulture, useT } from "@/i18n";
import { ParallelStreams } from "./ParallelStreams";

const ALL = "all";
const CHANGES = "changes";
const TH = "px-3 py-2 text-left text-[12px] font-medium uppercase tracking-wider text-ink3 whitespace-nowrap";
const TD = "px-3 py-2.5 align-top";

/** The badge of a task in the table: "Waiting" / "Ready to start" / "In progress · In review" / … */
function statusWord(item: QueueItem, all: readonly QueueItem[]): string {
  if (item.status === "pending") return waitingOn(item, all).length ? t("build.queue.status.waiting", "Waiting") : t("build.queue.status.ready", "Ready to start");
  return queueStatusText(item, all);
}

/** The line under a task's title: its milestone (when several are shown), the change request it belongs to and, while
 *  it is worked on, who has it (a task that never started has nobody on it, also when its build stopped). */
function whoLine(item: QueueItem, showMilestone: boolean): string {
  const busy = item.status === "running" || item.status === "recovering" || (item.status === "failed" && item.startedAt !== null);
  const where = showMilestone ? item.milestone : null;
  return [where, item.change && item.change !== where ? item.change : null, busy ? item.agent : null].filter(Boolean).join(" · ");
}

/** What a task still waits for: one badge per unfinished dependency (its key and state), or "Ready". */
function WaitingOn({ item, all }: { item: QueueItem; all: readonly QueueItem[] }) {
  const t = useT();
  if (item.status !== "pending") return <span className="text-ink3">–</span>;
  const waits = waitingOn(item, all);
  if (!waits.length) return <span className="text-[13px] font-medium text-success">{t("build.queue.ready", "Ready")}</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {waits.map((id) => {
        const dep = all.find((x) => x.id === id);
        if (!dep) return <Chip key={id}>{t("build.queue.earlierTask", "An earlier task · not planned")}</Chip>;
        const s = queueFlowStatus(dep, all);
        return <Chip key={id} tone={FLOW_STATUS_LOOK[s].tone} title={dep.title}>{`${dep.key} · ${statusWord(dep, all)}`}</Chip>;
      })}
    </span>
  );
}

function PullRequest({ item }: { item: QueueItem }) {
  if (item.pullRequest) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap font-mono text-[12px] text-ink2">
        <GitPullRequest size={13} strokeWidth={1.75} aria-hidden className="text-ink3" />{item.pullRequest}
      </span>
    );
  }
  if (item.commit) return <span className="font-mono text-[12px] text-ink2" title={item.commit}>{item.commit.slice(0, 7)}</span>;
  return <span className="text-ink3">–</span>;
}

/** The plan as a table (tablet and up) and as cards (phone). */
function PlannedWork({ items, all, showMilestone, onOpen }: { items: QueueItem[]; all: QueueItem[]; showMilestone: boolean; onOpen: (id: string) => void }) {
  const t = useT();
  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full border-collapse text-[14px]">
          <thead>
            <tr>
              <th scope="col" className={TH}>{t("build.queue.col.key", "Key")}</th><th scope="col" className={TH}>{t("build.queue.col.task", "Task")}</th><th scope="col" className={TH}>{t("build.queue.col.status", "Status")}</th>
              <th scope="col" className={TH}>{t("build.queue.col.started", "Started")}</th><th scope="col" className={TH}>{t("build.queue.col.finished", "Finished")}</th>
              <th scope="col" className={TH}>{t("build.queue.col.pullRequest", "Pull request")}</th><th scope="col" className={TH}>{t("build.queue.col.waitingOn", "Waiting on")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-t border-line">
                <td className={cn(TD, "whitespace-nowrap")}>
                  <button type="button" onClick={() => onOpen(item.id)} aria-label={t("build.queue.openItem", "Open {key}: {title}", { key: item.key, title: item.title })}
                    className="num rounded-md font-mono text-[13px] text-accent underline-offset-2 hover:underline">{item.key}</button>
                </td>
                <td className={cn(TD, "min-w-[14rem] max-w-[24rem]")}>
                  <div className="text-ink [overflow-wrap:anywhere]">{item.title}</div>
                  {whoLine(item, showMilestone) && <div className="text-[12px] text-ink3">{whoLine(item, showMilestone)}</div>}
                </td>
                <td className={TD}><FlowStatusBadge status={queueFlowStatus(item, all)} label={statusWord(item, all)} /></td>
                <td className={cn(TD, "num whitespace-nowrap text-ink2")}>{swissStamp(item.startedAt)}</td>
                <td className={cn(TD, "num whitespace-nowrap text-ink2")}>{swissStamp(item.endedAt)}</td>
                <td className={TD}><PullRequest item={item} /></td>
                <td className={TD}><WaitingOn item={item} all={all} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="flex flex-col gap-3 sm:hidden">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onOpen(item.id)} aria-label={t("build.queue.openItem", "Open {key}: {title}", { key: item.key, title: item.title })}
              className="flex w-full flex-col gap-2 rounded-block bg-surface2 p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              <span className="flex flex-wrap items-center gap-2">
                <span className="num rounded-md bg-ink/[0.06] px-1.5 py-0.5 font-mono text-[12px] text-ink2">{item.key}</span>
                <span className="ml-auto"><FlowStatusBadge status={queueFlowStatus(item, all)} label={statusWord(item, all)} /></span>
              </span>
              <span className="text-[14px] font-medium text-ink [overflow-wrap:anywhere]">{item.title}</span>
              {whoLine(item, showMilestone) && <span className="text-[12px] text-ink3">{whoLine(item, showMilestone)}</span>}
              <span className="num flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink2">
                <span>{t("build.queue.startedAt", "Started {at}", { at: swissStamp(item.startedAt) })}</span><span>{t("build.queue.finishedAt", "Finished {at}", { at: swissStamp(item.endedAt) })}</span>
                {(item.pullRequest || item.commit) && <PullRequest item={item} />}
              </span>
              {item.status === "pending" && <WaitingOn item={item} all={all} />}
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function BuildQueue({ ctx, projectId, tickets, loading, events, milestones, jobs, changes, byChanges = false, currentMilestoneId, onOpenBoard }: {
  ctx: DeliveryContext;
  projectId: string;
  tickets: DeliveryTicket[];
  loading: boolean;
  events: DeliveryTicketEvent[];
  milestones: DeliveryMilestone[];
  jobs: EngineJob[];
  /** The project's change requests: a change's tasks name it and follow its stopped build. */
  changes?: readonly DeliveryChangeRequest[];
  /** The product works through change requests (a live product without milestones): the words say so. */
  byChanges?: boolean;
  /** the milestone the Build step is about: the filter starts there */
  currentMilestoneId: string | null;
  onOpenBoard: () => void;
}) {
  const t = useT();
  // the queue's words are made with the records: made again when the language changes
  const culture = useCulture();
  const names = useFeatureNames(projectId, ctx.project?.currentScopeVersion ?? null);
  const items = useMemo(() => buildQueue({ tickets, events, milestones, jobs, changes }), [tickets, events, milestones, jobs, changes, culture]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => queueGroups(milestones), [milestones, culture]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setPicked] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  // the filter: All, each milestone with tasks, then the work after go-live
  const options = useMemo(() => {
    const used = new Set(items.map((x) => x.milestoneId ?? CHANGES));
    const ms = [...milestones].sort((a, b) => a.sortOrder - b.sortOrder || a.number - b.number).filter((m) => used.has(m.id));
    return [{ value: ALL, label: t("build.queue.all", "All") }, ...ms.map((m) => ({ value: m.id, label: t("build.queue.milestoneN", "Milestone {number}", { number: m.number }) })),
      ...(used.has(CHANGES) ? [{ value: CHANGES, label: changesAndFixes() }] : [])];
  }, [items, milestones, t]);
  const fallback = currentMilestoneId && options.some((o) => o.value === currentMilestoneId) ? currentMilestoneId : ALL;
  const filter = picked && options.some((o) => o.value === picked) ? picked : fallback;
  const shown = useMemo(() => (filter === ALL ? items : items.filter((x) => (x.milestoneId ?? CHANGES) === filter)), [items, filter]);

  if (loading) {
    return (
      <div aria-hidden className="flex flex-col gap-5">
        <div className="hatched h-80 rounded-card bg-surface/60" />
        <div className="hatched h-48 rounded-card bg-surface/60" />
      </div>
    );
  }
  // the head of the queue where the work is steered: how many change requests build side by side (parallel streams)
  const streams = byChanges || (changes?.length ?? 0) > 0
    ? <ParallelStreams ctx={ctx} projectId={projectId} jobs={jobs} changes={changes ?? []} tickets={tickets} events={events} />
    : null;
  if (tickets.length === 0) {
    const planJob = latestJobFor(jobs, "board.plan", {});
    return (
      <div className="flex min-w-0 flex-col gap-5">
        {streams}
        <Card>
          <EmptyState icon={<ListOrdered size={28} strokeWidth={1.75} aria-hidden />} title={t("build.queue.emptyTitle", "The plan of work is on its way")}
            text={byChanges
              ? t("build.queue.emptyChanges", "The tasks of a change request appear here once it is approved: what can start, what waits for what, and what is done.")
              : t("build.queue.emptyMilestones", "The development team plans the tasks from the locked scope, milestone by milestone. As soon as they are planned, you see here what can start, what waits for what, and what is done.")}
            action={<Button variant="secondary" onClick={onOpenBoard}>{t("build.queue.openBoard", "Open the board")}</Button>} />
          {planJob && <EngineJobStatus job={planJob} variant="full" className="mt-4" />}
        </Card>
      </div>
    );
  }

  const ticket = open ? tickets.find((x) => x.id === open) ?? null : null;
  const done = shown.filter((x) => x.status === "landed").length;
  const working = shown.filter((x) => x.status === "running" || x.status === "recovering").length;
  const ready = shown.filter((x) => x.status === "pending" && waitingOn(x, items).length === 0).length;
  const waiting = shown.filter((x) => x.status === "pending").length - ready;
  const stopped = shown.filter((x) => x.status === "failed").length;
  const multi = new Set(shown.map((x) => x.milestoneId ?? CHANGES)).size > 1;
  const summary = [shown.length === 1 ? t("build.queue.sum.taskOne", "1 task") : t("build.queue.sum.tasks", "{count} tasks", { count: shown.length }),
    t("build.queue.sum.done", "{count} done", { count: done }), t("build.queue.sum.working", "{count} in progress", { count: working }),
    t("build.queue.sum.ready", "{count} ready to start", { count: ready }), t("build.queue.sum.waiting", "{count} waiting", { count: waiting }),
    ...(stopped ? [t("build.queue.sum.stopped", "{count} stopped", { count: stopped })] : [])].join(" · ");

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {streams}
      <p className="max-w-[80ch] text-[14px] text-ink2">
        {t("build.queue.intro", "The development team's plan of work: what can start now, what waits for what, and what is already done.")}
      </p>
      <Card title={t("build.queue.dependencies", "Dependencies")} icon={<Network size={18} strokeWidth={1.75} aria-hidden />}>
        <div className="mb-4 flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <p className="text-[13px] text-ink2">{t("build.queue.mapHint", "Left to right in the order the work can happen; each arrow runs from a task to the task that waits for it.")}</p>
          {options.length > 2 && (
            // its own scrolling row on a phone: the card never gets wider than the screen
            <div className="scroll-thin -mx-1 min-w-0 max-w-full shrink-0 overflow-x-auto px-1 py-0.5">
              <Segmented<string> label={t("build.queue.milestoneShown", "Milestone shown")} options={options} value={filter} onChange={setPicked} />
            </div>
          )}
        </div>
        <QueueGraph items={shown} all={items} groups={multi ? groups : undefined} onOpen={setOpen} />
      </Card>
      <Card title={t("build.queue.plannedWork", "Planned work")} icon={<ListOrdered size={18} strokeWidth={1.75} aria-hidden />}>
        <p className="mb-3 text-[13px] text-ink2">{summary}</p>
        <PlannedWork items={shown} all={items} showMilestone={multi} onOpen={setOpen} />
      </Card>
      <BlocksTicketDrawer ctx={ctx} ticket={ticket} featureName={(ref) => (ref ? names.get(ref) ?? t("build.queue.aFeature", "A feature") : t("build.queue.crossCutting", "Cross-cutting"))}
        milestoneName={(id) => milestoneTag(id, milestones)} onClose={() => setOpen(null)} />
    </div>
  );
}
