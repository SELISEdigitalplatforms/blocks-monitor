import { Badge } from "@/components/core";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { coverageText } from "./alert-recipients.utils";

type CoverageBadgeProps = {
  /** Editable monitors in the project. */
  total: number;
  /** Editable monitors with no email at all. */
  withoutRecipients: number;
};

/**
 * "All N monitors email someone" or "K of N monitors email no one" (H13). The OK state takes only
 * its border and icon from `--success` and keeps the text in the foreground colour, because
 * `--success` text fails AA contrast (#256 Q11).
 */
const CoverageBadge = ({ total, withoutRecipients }: CoverageBadgeProps) => {
  const ok = withoutRecipients === 0;
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <Badge
      variant="outline"
      data-testid="coverage-badge"
      data-state={ok ? "ok" : "warning"}
      className={cn(
        "inline-flex w-fit gap-2 rounded-full px-3 py-1.5 text-[13px]",
        ok ? "border-success text-foreground" : "border-warning-200 bg-warning-50 text-warning-800",
      )}
    >
      <Icon aria-hidden="true" className={cn("h-4 w-4 shrink-0", ok && "text-success")} />
      {coverageText(total, withoutRecipients)}
    </Badge>
  );
};

export default CoverageBadge;
