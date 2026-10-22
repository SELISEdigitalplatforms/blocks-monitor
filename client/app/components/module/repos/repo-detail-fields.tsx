import type { ReactNode } from "react";
import { Copy } from "lucide-react";
import { Button } from "@/components/core";
import { cn } from "@/lib/utils";

/** The console's details field grid (`repo-details.tsx` → Details tab). */
export function DetailList({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <dl className={cn("grid grid-cols-2 gap-x-5 gap-y-5 sm:gap-x-10 xl:grid-cols-3", className)}>
      {children}
    </dl>
  );
}

/** One label / value pair. `wide` spans both columns on phones, for URLs and other long values. */
export function DetailItem({
  label,
  children,
  wide = false,
}: Readonly<{ label: string; children: ReactNode; wide?: boolean }>) {
  return (
    <div className={cn("min-w-0", wide && "col-span-2 sm:col-span-1")}>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 min-w-0 text-sm font-medium text-high-emphasis">{children}</dd>
    </div>
  );
}

/** A muted placeholder for a missing value. */
export function MissingValue({ children = "N/A" }: Readonly<{ children?: ReactNode }>) {
  return <span className="text-sm font-normal text-muted-foreground">{children}</span>;
}

/** External link that truncates, with a quiet copy button beside it. */
export function ExternalValue({
  href,
  value,
  copyLabel = "Copy value",
}: Readonly<{ href: string; value: string; copyLabel?: string }>) {
  return (
    <span className="flex max-w-full items-center gap-1">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={value}
        className="block min-w-0 truncate text-sm font-normal text-primary hover:underline"
      >
        {value}
      </a>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0 rounded-sm text-muted-foreground hover:bg-surface-warm hover:text-high-emphasis"
        aria-label={copyLabel}
        title={copyLabel}
        onClick={() => void navigator.clipboard?.writeText(value)}
      >
        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </span>
  );
}
