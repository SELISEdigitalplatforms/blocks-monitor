import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  RadioGroup,
  RadioGroupItem,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/core";
import { toast } from "@/hooks/use-toast";
import { alertsService } from "@/services/alerts.service";
import {
  REPORT_MIME,
  REPORT_PERIODS,
  type ReportFormat,
  type ReportPeriod,
  reportFileName,
  resolveReportPeriod,
  saveFile,
  toDateInputValue,
} from "@/utils/uptime-report.util";
import { useT } from "@seliseblocks/genesis-os/i18n";
import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";

/** One monitor (details page) or every monitor of a tab (Monitor list). */
export type ExportReportScope =
  | { kind: "monitor"; monitorId: string; name: string }
  | { kind: "project"; projectKey: string; monitorSourceType: string | null; name: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: ExportReportScope;
};

/** The server's message from a 400/404 body, else the fallback. */
const errorMessage = (error: unknown, fallback: string): string => {
  const value = error as { errors?: { message?: unknown } | null } | null | undefined;
  const message = value?.errors?.message;
  return typeof message === "string" && message.trim() ? message : fallback;
};

const browserTimeZone = (): string | undefined => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
};

export const ExportReportDialog = ({ open, onOpenChange, scope }: Props) => {
  const { t } = useT("monitor.monitors");
  // Lazy initialisers: read the clock once when the dialog mounts, not on every render.
  const [today] = useState(() => toDateInputValue(new Date()));
  const [format, setFormat] = useState<ReportFormat>("pdf");
  const [period, setPeriod] = useState<ReportPeriod>("30d");
  // A custom range starts as the last 30 days, today included.
  const [customFrom, setCustomFrom] = useState(() =>
    toDateInputValue(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)),
  );
  const [customTo, setCustomTo] = useState(today);
  const [isExporting, setIsExporting] = useState(false);

  // Only custom ranges can be invalid; presets always resolve.
  const customError = useMemo(() => {
    if (period !== "custom") return null;
    const resolved = resolveReportPeriod(period, { from: customFrom, to: customTo });
    return "error" in resolved ? resolved.error : null;
  }, [period, customFrom, customTo]);

  const handleExport = async () => {
    const resolved = resolveReportPeriod(period, { from: customFrom, to: customTo });
    if ("error" in resolved) return;

    setIsExporting(true);
    try {
      const blob = await alertsService.exportUptimeReport({
        format,
        from: resolved.from.toISOString(),
        to: resolved.to.toISOString(),
        timeZone: browserTimeZone(),
        ...(scope.kind === "monitor"
          ? { monitorId: scope.monitorId }
          : { projectKey: scope.projectKey, monitorSourceType: scope.monitorSourceType }),
      });
      if (!(blob instanceof Blob)) throw new Error("Unexpected response");

      saveFile(blob, reportFileName(scope.name, resolved.from, resolved.to, format), REPORT_MIME[format]);
      toast({
        variant: "success",
        title: t("EXPORT_REPORT.SUCCESS_TITLE"),
        description: t("EXPORT_REPORT.SUCCESS_DESCRIPTION"),
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: t("EXPORT_REPORT.FAILED_TITLE"),
        description: errorMessage(error, t("EXPORT_REPORT.FAILED_DESCRIPTION")),
      });
    } finally {
      setIsExporting(false);
    }
  };

  const formats: { value: ReportFormat; icon: typeof FileText; label: string; hint: string }[] = [
    {
      value: "pdf",
      icon: FileText,
      label: t("EXPORT_REPORT.FORMAT_PDF"),
      hint: t("EXPORT_REPORT.FORMAT_PDF_HINT"),
    },
    {
      value: "xlsx",
      icon: FileSpreadsheet,
      label: t("EXPORT_REPORT.FORMAT_EXCEL"),
      hint: t("EXPORT_REPORT.FORMAT_EXCEL_HINT"),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={(next) => !isExporting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md" data-testid="export-report-dialog">
        <DialogHeader>
          <DialogTitle>{t("EXPORT_REPORT.TITLE")}</DialogTitle>
          <DialogDescription>
            {scope.kind === "monitor"
              ? t("EXPORT_REPORT.DESCRIPTION_MONITOR", { name: scope.name })
              : t("EXPORT_REPORT.DESCRIPTION_PROJECT", { name: scope.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label>{t("EXPORT_REPORT.FORMAT")}</Label>
            <RadioGroup
              value={format}
              onValueChange={(value) => setFormat(value as ReportFormat)}
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              {formats.map(({ value, icon: Icon, label, hint }) => (
                <label
                  key={value}
                  htmlFor={`export-format-${value}`}
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition-colors ${
                    format === value ? "border-primary bg-primary/5" : "border-border"
                  }`}
                >
                  <RadioGroupItem value={value} id={`export-format-${value}`} className="mt-0.5" />
                  <span className="flex flex-col gap-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <Icon className="h-4 w-4" />
                      {label}
                    </span>
                    <span className="text-xs text-medium-emphasis">{hint}</span>
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="export-period">{t("EXPORT_REPORT.PERIOD")}</Label>
            <Select value={period} onValueChange={(value) => setPeriod(value as ReportPeriod)}>
              <SelectTrigger id="export-period" data-testid="export-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPORT_PERIODS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(`EXPORT_REPORT.PERIOD_${value.toUpperCase()}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {period === "custom" && (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="export-from" className="text-xs">
                    {t("EXPORT_REPORT.FROM")}
                  </Label>
                  <Input
                    id="export-from"
                    type="date"
                    max={today}
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="export-to" className="text-xs">
                    {t("EXPORT_REPORT.TO")}
                  </Label>
                  <Input
                    id="export-to"
                    type="date"
                    max={today}
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                  />
                </div>
              </div>
              {customError && (
                <p role="alert" className="text-xs text-destructive">
                  {t(`EXPORT_REPORT.ERROR_${customError}`)}
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={isExporting} onClick={() => onOpenChange(false)}>
            {t("common:CANCEL")}
          </Button>
          <Button
            data-testid="export-report-submit"
            disabled={isExporting || customError !== null}
            onClick={handleExport}
            className="gap-2"
          >
            {isExporting && <Loader2 className="h-4 w-4 animate-spin" />}
            {isExporting ? t("EXPORT_REPORT.EXPORTING") : t("EXPORT_REPORT.EXPORT")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
