/** The two ways to give the design instruction. With no brief yet nothing is selected; choosing one saves the mode at once (the container does the write). */
import { useId } from "react";
import { cn } from "@/lib/cn";
import type { DesignMode } from "./designUi";
import { t, useT } from "@/i18n";

const options = (): { value: DesignMode; label: string; help: string }[] => [
  { value: "figma", label: "Figma Make", help: t("analysis.design.mode.figmaHelp", "Let the business analyst turn your requirements into an interactive product design") },
  { value: "sample", label: t("analysis.design.mode.sample", "From a sample"), help: t("analysis.design.mode.sampleHelp", "Upload screens you like (pictures or PDFs) and say what to take from them") },
  { value: "describe", label: t("analysis.design.mode.describe", "Describe it"), help: t("analysis.design.mode.describeHelp", "Say in your own words how it should look: colours, logo, mood, apps you like") },
];

export function ModeChoice({ value, disabled, busy, onChange }: { value: DesignMode | null; disabled: boolean; busy?: boolean; onChange: (mode: DesignMode) => void }) {
  const t = useT();
  const name = useId();
  return (
    <div role="radiogroup" aria-label={t("analysis.design.mode.aria", "How to show the look & feel")} aria-busy={busy || undefined} className="grid gap-3 sm:grid-cols-2">
      {options().map((o) => (
        <label key={o.value} className={cn("relative block", disabled || busy ? "cursor-not-allowed" : "cursor-pointer")}>
          <input type="radio" name={name} value={o.value} checked={value === o.value} disabled={disabled || busy}
            onChange={() => onChange(o.value)} className="peer sr-only" />
          <span className={cn("block h-full rounded-block bg-surface2 p-4 ring-1 ring-line transition",
            "peer-checked:bg-accent-soft peer-checked:ring-2 peer-checked:ring-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60",
            disabled && "opacity-70")}>
            <span className="block text-[14px] font-medium text-ink">{o.label}</span>
            <span className="mt-1 block text-[13px] text-ink2">{o.help}</span>
          </span>
        </label>
      ))}
    </div>
  );
}
