/** Shared priority control for reviewing the business agent's document findings. */
import { useId } from "react";
import { cn } from "@/lib/cn";
import { PRIORITIES, type Priority } from "@/domain/setupDetails";
import { t, useT } from "@/i18n";

const PRIORITY_TONE: Record<Priority, string> = {
  must: "bg-accent text-white ring-accent",
  should: "bg-accent-soft text-ink ring-accent/60",
  could: "bg-surface text-ink ring-line dark:bg-canvas",
};

/** The shown name of a priority (the stored value and the Project brief keep the English PRIORITY_LABEL). */
export function priorityLabel(p: Priority): string {
  switch (p) {
    case "must": return t("shell.setup.priority.must", "Must");
    case "should": return t("shell.setup.priority.should", "Should");
    default: return t("shell.setup.priority.could", "Could");
  }
}

/** What each priority means, in a tooltip. */
export function priorityHint(p: Priority): string {
  switch (p) {
    case "must": return t("shell.setup.priority.mustHint", "We can't go live without it");
    case "should": return t("shell.setup.priority.shouldHint", "Important, but it could follow soon after");
    default: return t("shell.setup.priority.couldHint", "Nice to have, if there is time");
  }
}

/** Must / Should / Could as a small radio group. */
export function PriorityPicker({ value, onChange, label, size = "md", disabled }: { value: Priority; onChange: (p: Priority) => void; label: string; size?: "sm" | "md"; disabled?: boolean }) {
  const name = useId();
  useT();
  return (
    <div role="radiogroup" aria-label={label} className="flex shrink-0 gap-1 rounded-full bg-surface2 p-1 ring-1 ring-line dark:bg-ink/[0.06]">
      {PRIORITIES.map((p) => (
        <label key={p} title={priorityHint(p)}
          className={cn("relative inline-flex cursor-pointer items-center rounded-full font-medium transition", size === "md" ? "h-9 px-4 text-[14px]" : "h-7 px-3 text-[12px]",
            value === p ? cn("ring-1", PRIORITY_TONE[p]) : "text-ink2 hover:text-ink", disabled && "cursor-not-allowed opacity-50")}>
          <input type="radio" name={name} value={p} checked={value === p} disabled={disabled} onChange={() => onChange(p)} className="peer sr-only" />
          {priorityLabel(p)}
          <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60" />
        </label>
      ))}
    </div>
  );
}
