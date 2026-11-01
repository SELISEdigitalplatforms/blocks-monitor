import { useT } from "@seliseblocks/genesis-os/i18n";
import { Button, Card, CardContent, Skeleton } from "@/components/core";

export function ReportLoadingCard({ label }: Readonly<{ label?: string }>) {
  const { t } = useT("monitor.repos");
  return (
    <Card data-testid="report-loading" className="p-0">
      <div className="px-6 py-4">
        <div className="flex items-center justify-between">
          <Skeleton className="mb-2 h-6 w-48" />
          <Skeleton className="h-8 w-40" />
        </div>
        <div className="mt-3 flex items-center gap-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="p-6">
        <Skeleton className="mb-4 h-8 w-64" />
        <div className="grid w-full grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      </div>
      <span className="sr-only">{label ?? t("REPORT_STATES.LOADING_REPORT")}</span>
    </Card>
  );
}

export function ReportNoDataCard() {
  const { t } = useT("monitor.repos");
  return (
    <Card data-testid="report-no-data">
      <CardContent className="p-6 text-sm text-muted-foreground">
        {t("REPORT_STATES.NO_REPORT")}
      </CardContent>
    </Card>
  );
}

export function ReportErrorCard({ onRetry }: Readonly<{ onRetry?: () => void }>) {
  const { t } = useT("monitor.repos");
  return (
    <Card data-testid="report-error">
      <CardContent className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-destructive">{t("REPORT_STATES.LOAD_FAILED")}</p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t("common:RETRY")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function PageErrorCard({
  message,
  onRetry,
}: Readonly<{
  message: string;
  onRetry?: () => void;
}>) {
  const { t } = useT("monitor.repos");
  return (
    <Card data-testid="page-error">
      <CardContent className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-destructive">{message}</p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            {t("common:RETRY")}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function PageLoadingSkeleton({ testId = "page-loading" }: Readonly<{ testId?: string }>) {
  return (
    <div data-testid={testId} className="space-y-4">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
