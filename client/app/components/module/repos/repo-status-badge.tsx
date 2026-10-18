import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";

type StatusTone = "success" | "error" | "running" | "pending" | "neutral";

const SUCCESS_STATUSES = new Set([
  "Succeeded",
  "Success",
  "Completed",
  "Passed",
  "Published",
  "EventFinished",
]);
const ERROR_STATUSES = new Set(["Failed", "Error", "EventFailed"]);
const RUNNING_STATUSES = new Set(["Running", "Started", "EventStarted", "Queued", "Resumed"]);
const NEUTRAL_STATUSES = new Set(["NoBuild", "No build", "Unknown", "-"]);

const TONE_CLASS: Record<StatusTone, string> = {
  success: "bg-forest-soft text-forest-ink",
  error: "bg-rose-soft text-rose-ink",
  running: "bg-lavender-soft text-lavender-ink",
  pending: "bg-sunset-soft text-warn-ink",
  neutral: "bg-surface-warm text-muted-foreground",
};

/** Maps a build / deployment / quality-gate status onto one of the console's soft status tones. */
export function getRepoStatusTone(status?: string | null): StatusTone {
  if (!status) return "neutral";
  if (SUCCESS_STATUSES.has(status)) return "success";
  if (ERROR_STATUSES.has(status)) return "error";
  if (RUNNING_STATUSES.has(status)) return "running";
  if (NEUTRAL_STATUSES.has(status)) return "neutral";
  return "pending";
}

/**
 * Soft status pill (console `StatusBadge` from `domain-table.tsx`): a check for success,
 * a cross for failure, a dot for everything else.
 */
export function RepoStatusBadge({
  status,
  label,
  className,
  testId,
}: Readonly<{
  status?: string | null;
  /** Text to show; defaults to the status itself. */
  label?: string;
  className?: string;
  testId?: string;
}>) {
  const tone = getRepoStatusTone(status);
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      className={cn(
        "inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium",
        TONE_CLASS[tone],
        className,
      )}
    >
      {tone === "success" && <Check className="h-3 w-3" aria-hidden="true" />}
      {tone === "error" && <X className="h-3 w-3" aria-hidden="true" />}
      {tone !== "success" && tone !== "error" && (
        <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      )}
      {label ?? status ?? "Unknown"}
    </span>
  );
}
