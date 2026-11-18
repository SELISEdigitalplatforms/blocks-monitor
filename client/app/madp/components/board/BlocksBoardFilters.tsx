import { X } from "lucide-react";
import type { DeliveryMilestone, DeliveryTicket } from "@/madp/blocks/delivery/types";
import { Button, Input, Select } from "@/madp/ui/kit";
import { NO_MILESTONE } from "../../domain/delivery";
import { agentName, changeFilterValue, CROSS_FEATURE, NO_BLOCKS_FILTER, type BlocksBoardFilter } from "./blocksBoard";
import { useT } from "@/madp/i18n";

/** One row of filters, the same look as the local board's; the milestone filter comes first. A product that works
 *  through change requests (`changes` given and no milestone) filters by change request instead: it has no milestones. */
export function BlocksBoardFilters({ tickets, milestones, features, changes = [], agentOf = (t) => t.agent, value, onChange }: {
  tickets: DeliveryTicket[]; milestones: DeliveryMilestone[]; features: { id: string; name: string }[];
  /** The change requests that have tickets on the board ("CR-006" and its title). */
  changes?: readonly { id: string; code: string; title: string }[];
  /** The role a ticket is credited to (blocksBoard.ts creditedAgent). */
  agentOf?: (t: DeliveryTicket) => string;
  value: BlocksBoardFilter; onChange: (f: BlocksBoardFilter) => void;
}) {
  const t = useT();
  const used = new Set(tickets.map((tk) => tk.featureRef));
  const agents = Array.from(new Set(tickets.map((tk) => agentName(agentOf(tk)))));
  const byChanges = milestones.length === 0 && changes.length > 0;
  const changeOptions = changes.map((c) => ({ value: changeFilterValue(c.id), label: c.title ? `${c.code}: ${c.title}` : c.code }));
  const set = (patch: Partial<BlocksBoardFilter>) => onChange({ ...value, ...patch });
  const active = value.milestone || value.feature || value.agent || value.type || value.q;
  return (
    <div className="mb-4 flex flex-wrap gap-2">
      {byChanges ? (
        <Select label={t("changes.page.title", "Change request")} className="min-w-[200px]" value={value.milestone} onChange={(v) => set({ milestone: v })}
          options={[{ value: "", label: t("changes.overview.all", "All change requests") }, ...changeOptions]} />
      ) : (
        <Select label={t("build.step.chip.milestone", "Milestone")} className="min-w-[200px]" value={value.milestone} onChange={(v) => set({ milestone: v })}
          options={[{ value: "", label: t("build.overview.allMilestones", "All milestones") },
            ...milestones.map((m) => ({ value: m.id, label: t("build.page.milestoneNamed", "Milestone {number}: {name}", { number: m.number, name: m.name }) })),
            { value: NO_MILESTONE, label: t("build.queue.changesAndFixes", "Changes and fixes") }, ...changeOptions]} />
      )}
      <Select label={t("changes.panel.feature", "Feature")} className="min-w-[160px]" value={value.feature} onChange={(v) => set({ feature: v })}
        options={[{ value: "", label: t("build.board.filter.allFeatures", "All features") },
          ...features.filter((f) => used.has(f.id)).map((f) => ({ value: f.id, label: f.name })),
          ...(used.has("") ? [{ value: CROSS_FEATURE, label: t("build.queue.crossCutting", "Cross-cutting") }] : [])]} />
      <Select label={t("build.board.filter.agent", "Agent")} className="min-w-[160px]" value={value.agent} onChange={(v) => set({ agent: v })}
        options={[{ value: "", label: t("build.board.filter.allAgents", "All agents") }, ...agents.map((a) => ({ value: a, label: a }))]} />
      <Select label={t("build.board.filter.type", "Type")} className="min-w-[140px]" value={value.type} onChange={(v) => set({ type: v })}
        options={[{ value: "", label: t("build.board.filter.allTypes", "All types") }, { value: "story", label: t("build.board.type.story", "Story") }, { value: "task", label: t("build.board.type.task", "Task") }, { value: "fix", label: t("build.board.type.fix", "Fix") }]} />
      <label className="min-w-[180px] flex-1 sm:max-w-xs"><span className="sr-only">{t("build.board.filter.search", "Search tickets")}</span>
        <Input type="search" placeholder={t("build.board.filter.search", "Search tickets")} value={value.q} onChange={(e) => set({ q: e.target.value })} />
      </label>
      {active && <Button variant="ghost" icon={<X size={16} strokeWidth={1.75} aria-hidden />} onClick={() => onChange(NO_BLOCKS_FILTER)}>{t("build.board.filter.clear", "Clear")}</Button>}
    </div>
  );
}
