using ClosedXML.Excel;

namespace DomainService.Monitor.Reports
{
    /// <summary>
    /// Renders the report as a workbook: a Summary sheet (one row per monitor) and an Incidents sheet (every outage in
    /// the period). Durations appear twice, readable ("2h 5m") and as plain minutes, so the sheet can be sorted,
    /// filtered and summed without parsing text.
    /// </summary>
    /// <remarks>
    /// Every value from the monitor (name, URL, failure reason) is written as a typed string, never as a formula, so a
    /// monitor named "=HYPERLINK(...)" stays inert text.
    /// </remarks>
    public static class UptimeReportExcelRenderer
    {
        private const string DurationMinutesFormat = "#,##0.00";
        private const string PercentFormat = "0.00%";

        public static byte[] Render(UptimeReport report)
        {
            using var workbook = new XLWorkbook();
            WriteSummary(workbook.AddWorksheet("Summary"), report);
            WriteIncidents(workbook.AddWorksheet("Incidents"), report);

            using var stream = new MemoryStream();
            workbook.SaveAs(stream);
            return stream.ToArray();
        }

        private static void WriteSummary(IXLWorksheet sheet, UptimeReport report)
        {
            sheet.Cell(1, 1).SetValue(report.Title);
            sheet.Cell(1, 1).Style.Font.SetBold().Font.SetFontSize(16);

            var zone = UptimeReportFormatting.ZoneLabel(report.TimeZone, report.ToUtc);
            var meta = new (string Label, XLCellValue Value, string? Format)[]
            {
                ("Scope", report.ScopeLabel, null),
                ("Period from", report.ToLocal(report.FromUtc), UptimeReportFormatting.DateTimeFormat),
                ("Period to", report.ToLocal(report.ToUtc), UptimeReportFormatting.DateTimeFormat),
                ("Time zone", zone, null),
                ("Generated", report.ToLocal(report.GeneratedAtUtc), UptimeReportFormatting.DateTimeFormat),
                ("Monitors", report.Monitors.Count, null),
                ("Overall uptime", report.OverallUptimePercent is { } p ? p / 100d : "n/a", PercentFormat),
                ("Total downtime", UptimeReportFormatting.Duration(report.DowntimeMs), null),
                ("Incidents", report.IncidentCount, null),
            };

            var row = 3;
            foreach (var (label, value, format) in meta)
            {
                sheet.Cell(row, 1).SetValue(label).Style.Font.SetBold();
                var cell = sheet.Cell(row, 2).SetValue(value);
                if (format is not null) cell.Style.NumberFormat.Format = format;
                cell.Style.Alignment.SetHorizontal(XLAlignmentHorizontalValues.Left);
                row++;
            }

            row++;
            var headerRow = row;
            string[] headers =
            {
                "Monitor", "URL", "Type", "Current status", "Uptime", "Downtime", "Downtime (min)",
                "Incidents", "Longest outage", "Mean time to recovery", "Last incident started", "Observed (hours)",
            };
            for (var c = 0; c < headers.Length; c++) sheet.Cell(headerRow, c + 1).SetValue(headers[c]);

            foreach (var m in report.Monitors)
            {
                row++;
                sheet.Cell(row, 1).SetValue(m.Name);
                sheet.Cell(row, 2).SetValue(m.Url);
                sheet.Cell(row, 3).SetValue(m.MonitorType);
                sheet.Cell(row, 4).SetValue(m.CurrentStatus);
                var uptime = sheet.Cell(row, 5);
                if (m.UptimePercent is { } up)
                {
                    uptime.SetValue(up / 100d);
                    uptime.Style.NumberFormat.Format = PercentFormat;
                    if (up < 99d) uptime.Style.Font.SetFontColor(XLColor.FromHtml("#B42318"));
                }
                else
                {
                    uptime.SetValue("n/a");
                }
                sheet.Cell(row, 6).SetValue(UptimeReportFormatting.Duration(m.DowntimeMs));
                sheet.Cell(row, 7).SetValue(m.DowntimeMs / 60000d).Style.NumberFormat.Format = DurationMinutesFormat;
                sheet.Cell(row, 8).SetValue(m.IncidentCount);
                sheet.Cell(row, 9).SetValue(m.IncidentCount == 0 ? "-" : UptimeReportFormatting.Duration(m.LongestOutageMs));
                sheet.Cell(row, 10).SetValue(m.MeanTimeToRecoveryMs is { } mttr ? UptimeReportFormatting.Duration(mttr) : "-");
                var last = sheet.Cell(row, 11);
                if (m.LastIncidentStartUtc is { } lastUtc)
                {
                    last.SetValue(report.ToLocal(lastUtc));
                    last.Style.NumberFormat.Format = UptimeReportFormatting.DateTimeFormat;
                }
                else
                {
                    last.SetValue("-");
                }
                sheet.Cell(row, 12).SetValue(m.ObservedMs / 3_600_000d).Style.NumberFormat.Format = DurationMinutesFormat;
            }

            // No frozen panes here: the table starts below a dozen metadata rows, and freezing them would eat the
            // screen. The Incidents sheet, whose header is row 1, does freeze.
            StyleTable(sheet, headerRow, row, headers.Length, freezeHeader: false);

            row += 2;
            foreach (var note in UptimeReportNotes.Lines)
            {
                sheet.Cell(row, 1).SetValue(note);
                sheet.Cell(row, 1).Style.Font.SetItalic().Font.SetFontColor(XLColor.Gray);
                row++;
            }

            sheet.Column(1).Width = 32;
            sheet.Column(2).Width = 40;
            for (var c = 3; c <= headers.Length; c++) sheet.Column(c).AdjustToContents(headerRow, row, 10d, 28d);
        }

        private static void WriteIncidents(IXLWorksheet sheet, UptimeReport report)
        {
            string[] headers =
            {
                "Monitor", "Started", "Ended", "Duration", "Duration (min)", "Downtime in period (min)",
                "Last status code", "Failure reason",
            };
            for (var c = 0; c < headers.Length; c++) sheet.Cell(1, c + 1).SetValue(headers[c]);

            var row = 1;
            foreach (var i in report.Incidents)
            {
                row++;
                sheet.Cell(row, 1).SetValue(i.MonitorName);
                sheet.Cell(row, 2).SetValue(report.ToLocal(i.StartUtc)).Style.NumberFormat.Format = UptimeReportFormatting.DateTimeFormat;
                var ended = sheet.Cell(row, 3);
                if (i.EndUtc is { } end)
                {
                    ended.SetValue(report.ToLocal(end));
                    ended.Style.NumberFormat.Format = UptimeReportFormatting.DateTimeFormat;
                }
                else
                {
                    ended.SetValue("Ongoing");
                    ended.Style.Font.SetFontColor(XLColor.FromHtml("#B42318"));
                }
                sheet.Cell(row, 4).SetValue(UptimeReportFormatting.Duration(i.DurationMs));
                sheet.Cell(row, 5).SetValue(i.DurationMs / 60000d).Style.NumberFormat.Format = DurationMinutesFormat;
                sheet.Cell(row, 6).SetValue(i.DowntimeInPeriodMs / 60000d).Style.NumberFormat.Format = DurationMinutesFormat;
                if (i.LastStatusCode is { } code) sheet.Cell(row, 7).SetValue(code);
                else sheet.Cell(row, 7).SetValue("-");
                sheet.Cell(row, 8).SetValue(Truncate(i.FailureReason, 1000));
            }

            if (report.Incidents.Count == 0)
            {
                sheet.Cell(2, 1).SetValue("No incidents in this period.");
                sheet.Cell(2, 1).Style.Font.SetItalic();
                row = 2;
            }

            StyleTable(sheet, 1, row, headers.Length, freezeHeader: true);
            sheet.Column(1).Width = 32;
            for (var c = 2; c <= 7; c++) sheet.Column(c).AdjustToContents(1, row, 10d, 24d);
            sheet.Column(8).Width = 70;
        }

        private static void StyleTable(IXLWorksheet sheet, int headerRow, int lastRow, int columns, bool freezeHeader)
        {
            var header = sheet.Range(headerRow, 1, headerRow, columns);
            header.Style.Font.SetBold()
                .Font.SetFontColor(XLColor.White)
                .Fill.SetBackgroundColor(XLColor.FromHtml("#1F4E79"));

            if (lastRow > headerRow)
            {
                sheet.Range(headerRow, 1, lastRow, columns).SetAutoFilter();
            }
            if (freezeHeader) sheet.SheetView.FreezeRows(headerRow);
        }

        private static string Truncate(string? value, int max)
        {
            if (string.IsNullOrEmpty(value)) return "-";
            return value.Length <= max ? value : value[..max] + "…";
        }
    }

    /// <summary>The caveats printed under both the Excel and PDF summaries.</summary>
    internal static class UptimeReportNotes
    {
        public static readonly string[] Lines =
        {
            "Uptime = (observed time - downtime) / observed time, rounded down to two decimals.",
            "Observed time starts at the monitor's creation when it was created during the period, and ends at generation time when the period has not ended yet.",
            "Outages that began before the period or are still ongoing are counted, clipped to the period.",
            "Paused monitors are not checked, so a paused stretch counts as up. Current status is as of generation time.",
        };
    }
}
