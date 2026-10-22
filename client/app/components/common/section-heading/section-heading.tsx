import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SectionHeadingProps = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  titleAccessory?: ReactNode;
  className?: string;
  titleClassName?: string;
};

/**
 * Small uppercase section title with an inline muted description and actions on the right.
 * Copied from blocks-console (`components/section-heading`) — app-kit 0.1.1 does not export it.
 */
export function SectionHeading({
  title,
  description,
  actions,
  titleAccessory,
  className,
  titleClassName,
}: SectionHeadingProps) {
  return (
    <div className={cn("flex items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h2
          className={cn(
            "text-[13px] font-bold uppercase tracking-[0.06em] text-high-emphasis",
            titleClassName,
          )}
        >
          {title}
        </h2>
        {titleAccessory}
        {description ? <p className="text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
