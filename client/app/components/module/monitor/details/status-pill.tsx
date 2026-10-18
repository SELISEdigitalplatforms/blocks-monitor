import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  STATUS_PILL_CLASS,
  STATUS_TONE_CLASS,
  type StatusTone,
} from "@/components/module/monitor/details/surface-styles";

type StatusPillProps = {
  tone: StatusTone;
  children: ReactNode;
  /** `lg` is the stat-tile value; the default is the table's `text-[11px]` pill. */
  size?: "sm" | "lg";
  className?: string;
};

/** The console's soft status pill: tinted surface, matching ink text and a leading dot. */
export const StatusPill = ({ tone, children, size = "sm", className }: StatusPillProps) => (
  <span
    data-tone={tone}
    className={cn(
      STATUS_PILL_CLASS,
      size === "lg" && "px-3 text-sm font-semibold",
      STATUS_TONE_CLASS[tone],
      className,
    )}
  >
    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
    {children}
  </span>
);
