import { AlertTriangle, FileSearch } from "lucide-react";
import { Button, Card, Skeleton } from "@/components/core";

/** Skeleton for a SAST / SCA report card: a header row, then a grid of metric tiles. */
export function ReportLoadingCard({ label = "Loading report…" }: Readonly<{ label?: string }>) {
  return (
    <Card data-testid="report-loading" className="overflow-hidden p-0">
      <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
        <Skeleton className="h-4 w-40 rounded-sm" />
        <Skeleton className="h-6 w-32 rounded-full" />
      </div>
      <div className="grid w-full grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-2 md:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-16 w-full rounded-sm" />
        ))}
      </div>
      <span className="sr-only">{label}</span>
    </Card>
  );
}

export function ReportNoDataCard() {
  return (
    <Card
      data-testid="report-no-data"
      className="flex min-h-[240px] flex-col items-center justify-center gap-3 px-5 py-12 text-center text-sm text-muted-foreground"
    >
      <FileSearch className="h-6 w-6" aria-hidden="true" />
      No report available for this build
    </Card>
  );
}

function ErrorCard({
  testId,
  message,
  onRetry,
}: Readonly<{
  testId: string;
  message: string;
  onRetry?: () => void;
}>) {
  return (
    <Card data-testid={testId} className="flex items-start gap-3 px-5 py-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-rose-soft text-rose-ink">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3">
        <p role="alert" className="text-sm font-medium text-high-emphasis">
          {message}
        </p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
    </Card>
  );
}

export function ReportErrorCard({ onRetry }: Readonly<{ onRetry?: () => void }>) {
  return <ErrorCard testId="report-error" message="Failed to load report." onRetry={onRetry} />;
}

export function PageErrorCard({
  message,
  onRetry,
}: Readonly<{
  message: string;
  onRetry?: () => void;
}>) {
  return <ErrorCard testId="page-error" message={message} onRetry={onRetry} />;
}

/** Detail-page skeleton: header, tab row, then a content card. */
export function PageLoadingSkeleton({ testId = "page-loading" }: Readonly<{ testId?: string }>) {
  return (
    <div data-testid={testId} className="space-y-5">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48 rounded-sm" />
        <Skeleton className="h-4 w-72 rounded-sm" />
      </div>
      <Skeleton className="h-9 w-72 rounded-sm" />
      <Skeleton className="h-40 w-full rounded-sm" />
      <Skeleton className="h-64 w-full rounded-sm" />
    </div>
  );
}
