import { RefreshCw } from "lucide-react";
import { useDataRefreshing } from "@/madp/blocks/data/freshness";
import { cn } from "@/madp/lib/cn";
import { useT } from "@/madp/i18n";

/** Top-bar hint shown while on-screen data is the last good answer, served stale after a Blocks deadline.
 *  Always mounted so screen readers announce the change; collapsed (sr-only, no content) when idle. */
export function RefreshingHint() {
  const t = useT();
  const refreshing = useDataRefreshing();
  return (
    <span
      role="status"
      aria-live="polite"
      title={refreshing ? t("shell.hints.refreshingTitle", "Showing the last loaded data while the server catches up.") : undefined}
      className={cn(refreshing
        ? "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface px-2.5 py-1.5 text-[12px] text-ink3 dark:ring-1 dark:ring-line"
        : "sr-only")}>
      {refreshing ? (
        <>
          <RefreshCw size={14} strokeWidth={1.75} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          <span className="sr-only sm:not-sr-only">{t("shell.hints.refreshing", "Refreshing…")}</span>
        </>
      ) : null}
    </span>
  );
}
