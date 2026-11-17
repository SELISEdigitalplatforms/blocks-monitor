/** The Build queue's dependency map: MADP Studio's QueueGraph (madp-studio web/src/components/queue/QueueGraph.tsx)
 *  on the shared FlowMap — the project's tickets left to right in the order the work can happen (a task sits one
 *  column right of its deepest dependency), each arrow from a task to the task that waits for it, dashed while that
 *  task is not done, moving while the waiting task is worked on. Read-only; clicking a task opens its ticket. With
 *  more than one milestone shown, each milestone is a lane. */
import { useCallback, useMemo } from "react";
import { FlowLegend, FlowMap, type FlowGroup, type FlowNode } from "@/components/flow/FlowMap";
import { queueCounts, queueFlow, type QueueItem } from "@/domain/buildQueue";
import { useCulture, useT } from "@/i18n";

export function QueueGraph({ items, all = items, groups, onOpen, className }: {
  /** the tasks shown (e.g. one milestone's) */
  items: QueueItem[];
  /** every task of the project: decides what is still waited for across milestones */
  all?: QueueItem[];
  /** milestone lanes; used when the shown tasks span more than one milestone */
  groups?: FlowGroup[];
  onOpen?: (ticketId: string) => void;
  className?: string;
}) {
  const t = useT();
  const culture = useCulture();
  const { nodes, edges } = useMemo(() => queueFlow(items, all), [items, all, culture]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => queueCounts(items, all), [items, all]);
  const open = useCallback((n: FlowNode) => onOpen?.(n.id), [onOpen]);
  return (
    <FlowMap label={t("build.queue.mapLabel", "Dependency map")} nodes={nodes} edges={edges} groups={groups} grouping="lanes"
      onOpen={onOpen ? open : undefined} openLabel={t("build.queue.open", "Open")}
      emptyText={t("build.queue.mapEmpty", "No tasks in this part of the plan yet.")}
      legend={<FlowLegend counts={counts} />} className={className} />
  );
}
