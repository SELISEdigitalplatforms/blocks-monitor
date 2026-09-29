import { Button, Card, CardContent, Skeleton } from "@/components/core";

export function ReportLoadingCard({ label = "Loading report…" }: { label?: string }) {
  return (
    <Card data-testid="report-loading">
      <CardContent className="space-y-3 p-6">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <span className="sr-only">{label}</span>
      </CardContent>
    </Card>
  );
}

export function ReportNoDataCard() {
  return (
    <Card data-testid="report-no-data">
      <CardContent className="p-6 text-sm text-muted-foreground">
        No report available for this build
      </CardContent>
    </Card>
  );
}

export function ReportErrorCard({ onRetry }: { onRetry?: () => void }) {
  return (
    <Card data-testid="report-error">
      <CardContent className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-destructive">Failed to load report.</p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function PageErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Card data-testid="page-error">
      <CardContent className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-destructive">{message}</p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function PageLoadingSkeleton({ testId = "page-loading" }: { testId?: string }) {
  return (
    <div data-testid={testId} className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
