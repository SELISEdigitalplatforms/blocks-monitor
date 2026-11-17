/** Must / Should / Could as three small chips: the chosen one filled. Editable rows change the priority in one click;
 *  otherwise only the chosen chip shows. Also the list's filter (All · Must · Should · Could, with counts). */
import { useT } from "@/i18n";
import { useRef, type KeyboardEvent } from "react";
import type { RequirementPriority } from "@/domain/requirements";
import { Chip } from "@/ui/kit";
import { cn } from "@/lib/cn";
import { PRIORITY_HINT, PRIORITY_ORDER, PRIORITY_TONE, PRIORITY_WORD, type PriorityCounts, type PriorityFilter } from "./priority";

const FILLED: Record<RequirementPriority, string> = {
  must: "bg-accent-soft text-[rgb(var(--c-accent-text))] ring-transparent",
  nice: "bg-surface text-ink shadow-card ring-transparent dark:bg-ink/[0.14]",
  later: "bg-warning-soft text-[rgb(var(--c-warning-text))] ring-transparent",
};

function arrows(e: KeyboardEvent<HTMLDivElement>, count: number, current: number, pick: (i: number) => void) {
  const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!d) return;
  e.preventDefault();
  const i = (current + d + count) % count;
  pick(i);
  (e.currentTarget.children[i] as HTMLElement | undefined)?.focus();
}

export function PriorityChips({ value, editable, busy, label, onChange }: {
  value: RequirementPriority; editable: boolean; busy?: boolean; label: string; onChange?: (p: RequirementPriority) => void;
}) {
  useT();
  const box = useRef<HTMLDivElement>(null);
  if (!editable || !onChange) {
    return <Chip tone={PRIORITY_TONE[value]} title={PRIORITY_HINT[value]}>{PRIORITY_WORD[value]}</Chip>;
  }
  const at = PRIORITY_ORDER.indexOf(value);
  return (
    <div ref={box} role="radiogroup" aria-label={label} aria-busy={busy || undefined}
      className={cn("inline-flex items-center gap-0.5 rounded-full bg-surface2 p-0.5 ring-1 ring-inset ring-line", busy && "opacity-70")}
      onKeyDown={(e) => arrows(e, PRIORITY_ORDER.length, at, (i) => onChange(PRIORITY_ORDER[i]))}>
      {PRIORITY_ORDER.map((p) => {
        const on = p === value;
        return (
          <button key={p} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} disabled={busy} title={PRIORITY_HINT[p]}
            onClick={() => { if (!on) onChange(p); }}
            className={cn("h-6 whitespace-nowrap rounded-full px-2.5 text-[12px] font-medium outline-none ring-1 ring-inset transition focus-visible:ring-2 focus-visible:ring-accent/50",
              on ? FILLED[p] : "text-ink3 ring-transparent hover:text-ink")}>
            {PRIORITY_WORD[p]}
          </button>
        );
      })}
    </div>
  );
}

const FILTERS: readonly PriorityFilter[] = ["all", ...PRIORITY_ORDER];

export function PriorityFilterBar({ value, counts, grouped, onChange, onGroup }: {
  value: PriorityFilter; counts: PriorityCounts; grouped: boolean; onChange: (f: PriorityFilter) => void; onGroup: (g: boolean) => void;
}) {
  const t = useT();
  const total = counts.must + counts.nice + counts.later;
  const at = FILTERS.indexOf(value);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div role="radiogroup" aria-label={t("analysis.requirements.filterByPriority", "Show requirements by priority")} className="inline-flex rounded-full bg-surface2 p-1 ring-1 ring-inset ring-line"
        onKeyDown={(e) => arrows(e, FILTERS.length, at, (i) => onChange(FILTERS[i]))}>
        {FILTERS.map((f) => {
          const on = f === value;
          const n = f === "all" ? total : counts[f];
          return (
            <button key={f} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => onChange(f)}
              className={cn("h-7 whitespace-nowrap rounded-full px-3 text-[13px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50",
                on ? "bg-accent-soft text-[rgb(var(--c-accent-text))]" : "text-ink2 hover:text-ink")}>
              {f === "all" ? t("analysis.requirements.filterAll", "All") : PRIORITY_WORD[f]} <span className="num text-ink3">{n}</span>
            </button>
          );
        })}
      </div>
      <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-ink2">
        <input type="checkbox" className="h-4 w-4 accent-[rgb(var(--c-accent-text))]" checked={grouped} onChange={(e) => onGroup(e.target.checked)} />
        {t("analysis.requirements.groupByPriority", "Group by priority")}
      </label>
    </div>
  );
}
