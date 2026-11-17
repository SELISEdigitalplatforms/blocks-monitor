/** The instructions field with a live count; detected https references are listed below as safe external links. Also the notes field in sample mode. */
import { useId } from "react";
import { ExternalLink } from "lucide-react";
import { Label, Textarea } from "@/ui/kit";
import { extractReferences } from "@/domain/designBrief";
import { MAX_INSTRUCTIONS, MIN_INSTRUCTIONS } from "./designUi";
import { useT } from "@/i18n";

export function DescribeEditor({ value, disabled, onChange, onBlur, label, minHint }: {
  value: string; disabled: boolean; onChange: (v: string) => void; onBlur: () => void; label: string; minHint: boolean;
}) {
  const t = useT();
  const id = useId();
  const refs = extractReferences(value).filter((u) => u.startsWith("https://"));
  const short = minHint && value.trim().length < MIN_INSTRUCTIONS;
  return (
    <div>
      <label htmlFor={id}><Label>{label}</Label></label>
      <Textarea id={id} value={value} disabled={disabled} rows={8} maxLength={MAX_INSTRUCTIONS}
        aria-describedby={`${id}-count`}
        placeholder={minHint ? t("analysis.design.describe.placeholderDescribe", "For example: calm and friendly, our green and white, big buttons, like the app of our bank") : t("analysis.design.describe.placeholderSample", "What should we take from these samples? For example: the colours, the big photos, the simple menu")}
        onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
      <div id={`${id}-count`} className="mt-1.5 flex flex-wrap justify-between gap-2 text-[12px] text-ink3">
        <span>{short ? t("analysis.design.describe.enough", "A sentence or two is enough.") : ""}</span>
        <span>{value.length} / 10 000</span>
      </div>
      {refs.length > 0 && (
        <div className="mt-3">
          <Label>{t("analysis.design.describe.references", "References")}</Label>
          <ul className="space-y-1">
            {refs.map((u) => (
              <li key={u} className="min-w-0">
                <a href={u} target="_blank" rel="noopener noreferrer nofollow"
                  className="inline-flex max-w-full items-center gap-1.5 text-[13px] text-accent underline-offset-2 hover:underline">
                  <span className="truncate">{u}</span><ExternalLink size={13} strokeWidth={1.75} aria-hidden className="shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
