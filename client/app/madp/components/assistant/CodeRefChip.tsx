import { Check, FileCode2 } from "lucide-react";
import type { CodeRef } from "@/madp/domain/assistant";
import { useCopy } from "@/madp/components/delivery/shared";
import { cn } from "@/madp/lib/cn";
import { useT } from "@/madp/i18n";

export const refLabel = (r: CodeRef): string => (r.line === null ? r.path : `${r.path}:${r.line}`);

/** A source reference of the generated app (path and line), shown as text; a click copies it. */
export function CodeRefChip({ source }: { source: CodeRef }) {
  const t = useT();
  const label = refLabel(source);
  const { state, copy, target } = useCopy(label);
  return (
    <button
      type="button"
      onClick={copy}
      title={source.why || undefined}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full bg-surface2 px-2.5 py-1 text-left font-mono text-[12px] text-ink2",
        "transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
      )}
    >
      {state === "copied" ? <Check size={13} strokeWidth={1.75} className="shrink-0" /> : <FileCode2 size={13} strokeWidth={1.75} className="shrink-0" />}
      <span ref={target as React.RefObject<HTMLSpanElement>} className="[overflow-wrap:anywhere]">{label}</span>
      <span className="sr-only" aria-live="polite">{state === "copied" ? t("assistant.codeRef.copied", "Copied") : ""}</span>
    </button>
  );
}
