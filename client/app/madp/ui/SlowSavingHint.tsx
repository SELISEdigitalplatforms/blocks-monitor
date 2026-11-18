import { Save } from "lucide-react";
import { useSlowSaving } from "@/madp/blocks/slowSave";
import { cn } from "@/madp/lib/cn";
import { useT } from "@/madp/i18n";

/** Top-bar hint shown while a save has been running for 3 s or more because SELISE Blocks is slow.
 *  A calm state, not an error. Always mounted so screen readers announce the change; collapsed (sr-only, no content) when idle. */
export function SlowSavingHint() {
  const t = useT();
  const slow = useSlowSaving();
  return (
    <span
      role="status"
      aria-live="polite"
      title={slow ? t("shell.hints.slowSavingTitle", "The server is slow right now. Your change is still being saved.") : undefined}
      className={cn(slow
        ? "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-2.5 py-1.5 text-[12px] text-ink3 dark:ring-1 dark:ring-line"
        : "sr-only")}>
      {slow ? (
        <>
          <Save size={14} strokeWidth={1.75} aria-hidden="true" />
          <span>{t("common.status.saving", "Saving…")}<span className="sr-only sm:not-sr-only"> {t("shell.hints.serverSlow", "The server is slow right now")}</span></span>
        </>
      ) : null}
    </span>
  );
}
