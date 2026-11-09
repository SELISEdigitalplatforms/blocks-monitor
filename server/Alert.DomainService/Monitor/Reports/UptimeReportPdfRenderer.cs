using System.Globalization;
using PdfSharp;
using PdfSharp.Drawing;
using PdfSharp.Pdf;

namespace DomainService.Monitor.Reports
{
    /// <summary>
    /// Renders the report as a landscape A4 PDF: header, headline figures, a per-monitor table and the incident log.
    /// Drawn directly with PDFsharp (already vetted in blocks-utilities) rather than pulling in a layout engine.
    /// </summary>
    public static class UptimeReportPdfRenderer
    {
        /// <summary>
        /// A PDF is for reading, not analysis: past this many incidents the log stops and points at the Excel export,
        /// which always carries the full list. Totals above it are computed from every incident regardless.
        /// </summary>
        public const int MaxPdfIncidents = 500;

        private const double Margin = 36;
        private const double RowHeight = 18;
        private const string Family = "Arial";

        private static readonly XColor Ink = XColor.FromArgb(0x1D, 0x29, 0x39);
        private static readonly XColor Muted = XColor.FromArgb(0x66, 0x70, 0x85);
        private static readonly XColor Rule = XColor.FromArgb(0xE4, 0xE7, 0xEC);
        private static readonly XColor HeaderFill = XColor.FromArgb(0x1F, 0x4E, 0x79);
        private static readonly XColor Zebra = XColor.FromArgb(0xF7, 0xF8, 0xFA);
        private static readonly XColor Bad = XColor.FromArgb(0xB4, 0x23, 0x18);
        private static readonly XColor Good = XColor.FromArgb(0x06, 0x76, 0x47);

        public static byte[] Render(UptimeReport report)
        {
            ReportFontResolver.EnsureRegistered();

            using var document = new PdfDocument();
            document.Info.Title = report.Title;
            document.Info.Creator = "Blocks Monitor";

            var ctx = new Context(document);
            ctx.NewPage();

            DrawHeader(ctx, report);
            DrawHeadlines(ctx, report);
            DrawMonitorTable(ctx, report);
            DrawIncidentTable(ctx, report);
            DrawNotes(ctx);
            ctx.Finish();

            DrawFooters(document, report);

            using var stream = new MemoryStream();
            document.Save(stream, false);
            return stream.ToArray();
        }

        private static void DrawHeader(Context ctx, UptimeReport report)
        {
            ctx.Text(report.Title, ctx.Font(18, bold: true), Ink, ctx.Left, ctx.Y, ctx.Width);
            ctx.Y += 26;
            ctx.Text(report.ScopeLabel, ctx.Font(11), Muted, ctx.Left, ctx.Y, ctx.Width);
            ctx.Y += 16;
            var period = $"{Format(report, report.FromUtc)}  to  {Format(report, report.ToUtc)}   ·   {UptimeReportFormatting.ZoneLabel(report.TimeZone, report.ToUtc)}";
            ctx.Text(period, ctx.Font(10), Muted, ctx.Left, ctx.Y, ctx.Width);
            ctx.Y += 14;
            ctx.Text($"Generated {Format(report, report.GeneratedAtUtc)}", ctx.Font(9), Muted, ctx.Left, ctx.Y, ctx.Width);
            ctx.Y += 22;
        }

        private static void DrawHeadlines(Context ctx, UptimeReport report)
        {
            var tiles = new (string Label, string Value, XColor Color)[]
            {
                ("Overall uptime", UptimeReportFormatting.Percent(report.OverallUptimePercent), UptimeColor(report.OverallUptimePercent)),
                ("Total downtime", UptimeReportFormatting.Duration(report.DowntimeMs), Ink),
                ("Incidents", report.IncidentCount.ToString(CultureInfo.InvariantCulture), Ink),
                ("Monitors", report.Monitors.Count.ToString(CultureInfo.InvariantCulture), Ink),
            };

            const double gap = 12;
            const double height = 54;
            var width = (ctx.Width - gap * (tiles.Length - 1)) / tiles.Length;
            for (var i = 0; i < tiles.Length; i++)
            {
                var x = ctx.Left + i * (width + gap);
                ctx.Gfx.DrawRectangle(new XPen(Rule, 1), new XSolidBrush(Zebra), x, ctx.Y, width, height);
                ctx.Text(tiles[i].Label, ctx.Font(9), Muted, x + 10, ctx.Y + 8, width - 20);
                ctx.Text(tiles[i].Value, ctx.Font(18, bold: true), tiles[i].Color, x + 10, ctx.Y + 24, width - 20);
            }
            ctx.Y += height + 24;
        }

        private static void DrawMonitorTable(Context ctx, UptimeReport report)
        {
            ctx.Section("Uptime by monitor");

            var columns = new[]
            {
                new Column("Monitor", 0.27),
                new Column("Type", 0.08),
                new Column("Status", 0.07),
                new Column("Uptime", 0.08, XStringFormats.CenterRight),
                new Column("Downtime", 0.10, XStringFormats.CenterRight),
                new Column("Incidents", 0.07, XStringFormats.CenterRight),
                new Column("Longest outage", 0.10, XStringFormats.CenterRight),
                new Column("Mean recovery", 0.10, XStringFormats.CenterRight),
                new Column("Last incident", 0.13, XStringFormats.CenterRight),
            };

            if (report.Monitors.Count == 0)
            {
                ctx.Text("No monitors in this scope.", ctx.Font(10), Muted, ctx.Left, ctx.Y, ctx.Width);
                ctx.Y += 24;
                return;
            }

            var table = new Table(ctx, columns);
            table.Header();
            foreach (var m in report.Monitors)
            {
                // Two lines per monitor: the name, and its URL underneath in grey.
                table.Row(
                    new[]
                    {
                        new Cell(m.Name, Ink, Sub: m.Url),
                        new Cell(m.MonitorType, Ink),
                        new Cell(m.CurrentStatus, m.CurrentStatus switch { "Up" => Good, "Down" => Bad, _ => Muted }),
                        new Cell(UptimeReportFormatting.Percent(m.UptimePercent), UptimeColor(m.UptimePercent), Bold: true),
                        new Cell(UptimeReportFormatting.Duration(m.DowntimeMs), Ink),
                        new Cell(m.IncidentCount.ToString(CultureInfo.InvariantCulture), Ink),
                        new Cell(m.IncidentCount == 0 ? "-" : UptimeReportFormatting.Duration(m.LongestOutageMs), Ink),
                        new Cell(m.MeanTimeToRecoveryMs is { } mttr ? UptimeReportFormatting.Duration(mttr) : "-", Ink),
                        new Cell(m.LastIncidentStartUtc is { } last ? Format(report, last) : "-", Ink),
                    },
                    height: RowHeight * 1.7);
            }
            ctx.EndTable();
            ctx.Y += 20;
        }

        private static void DrawIncidentTable(Context ctx, UptimeReport report)
        {
            ctx.Section($"Incidents ({report.Incidents.Count})");

            if (report.Incidents.Count == 0)
            {
                ctx.Text("No incidents in this period.", ctx.Font(10), Muted, ctx.Left, ctx.Y, ctx.Width);
                ctx.Y += 24;
                return;
            }

            var columns = new[]
            {
                new Column("Monitor", 0.20),
                new Column("Started", 0.14),
                new Column("Ended", 0.14),
                new Column("Duration", 0.09, XStringFormats.CenterRight),
                new Column("Status code", 0.08, XStringFormats.CenterRight),
                new Column("Failure reason", 0.35),
            };

            var table = new Table(ctx, columns);
            table.Header();
            foreach (var i in report.Incidents.Take(MaxPdfIncidents))
            {
                table.Row(new[]
                {
                    new Cell(i.MonitorName, Ink),
                    new Cell(Format(report, i.StartUtc), Ink),
                    i.EndUtc is { } end ? new Cell(Format(report, end), Ink) : new Cell("Ongoing", Bad, Bold: true),
                    new Cell(UptimeReportFormatting.Duration(i.DurationMs), Ink),
                    new Cell(i.LastStatusCode?.ToString(CultureInfo.InvariantCulture) ?? "-", Ink),
                    new Cell(string.IsNullOrWhiteSpace(i.FailureReason) ? "-" : i.FailureReason!, Muted),
                }, RowHeight);
            }
            ctx.EndTable();

            if (report.Incidents.Count > MaxPdfIncidents)
            {
                ctx.EnsureSpace(RowHeight);
                ctx.Y += 6;
                ctx.Text(
                    $"Showing the {MaxPdfIncidents} most recent of {report.Incidents.Count} incidents. Export as Excel for the full list.",
                    ctx.Font(9), Muted, ctx.Left, ctx.Y, ctx.Width);
                ctx.Y += RowHeight;
            }
            ctx.Y += 20;
        }

        private static void DrawNotes(Context ctx)
        {
            ctx.EnsureSpace(16 + UptimeReportNotes.Lines.Length * 13);
            ctx.Text("Notes", ctx.Font(9, bold: true), Muted, ctx.Left, ctx.Y, ctx.Width);
            ctx.Y += 14;
            foreach (var line in UptimeReportNotes.Lines)
            {
                ctx.Text("• " + line, ctx.Font(8), Muted, ctx.Left, ctx.Y, ctx.Width);
                ctx.Y += 13;
            }
        }

        private static void DrawFooters(PdfDocument document, UptimeReport report)
        {
            var font = new XFont(Family, 8);
            for (var i = 0; i < document.PageCount; i++)
            {
                var page = document.Pages[i];
                using var gfx = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);
                var y = page.Height.Point - Margin + 12;
                var width = page.Width.Point - 2 * Margin;
                gfx.DrawString(report.Title, font, new XSolidBrush(Muted), new XRect(Margin, y, width, 12), XStringFormats.TopLeft);
                gfx.DrawString($"Page {i + 1} of {document.PageCount}", font, new XSolidBrush(Muted), new XRect(Margin, y, width, 12), XStringFormats.TopRight);
            }
        }

        private static string Format(UptimeReport report, DateTime utc) =>
            report.ToLocal(utc).ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture);

        private static XColor UptimeColor(double? percent) => percent switch
        {
            null => Muted,
            < 99d => Bad,
            _ => Good,
        };

        private sealed record Column(string Title, double Share, XStringFormat? Align = null);

        private sealed record Cell(string Text, XColor Color, bool Bold = false, string? Sub = null);

        /// <summary>Page cursor: owns the current page's graphics and breaks pages when content would overflow.</summary>
        private sealed class Context
        {
            private readonly PdfDocument _document;
            private readonly Dictionary<(double, bool), XFont> _fonts = new();
            private XGraphics? _gfx;
            private Table? _activeTable;

            public Context(PdfDocument document) => _document = document;

            public XGraphics Gfx => _gfx ?? throw new InvalidOperationException("No page.");
            public double Y { get; set; }
            public double Left => Margin;
            public double Width { get; private set; }
            private double Bottom { get; set; }

            public XFont Font(double size, bool bold = false)
            {
                if (!_fonts.TryGetValue((size, bold), out var font))
                {
                    font = new XFont(Family, size, bold ? XFontStyleEx.Bold : XFontStyleEx.Regular);
                    _fonts[(size, bold)] = font;
                }
                return font;
            }

            public void NewPage()
            {
                _gfx?.Dispose();
                var page = _document.AddPage();
                page.Size = PageSize.A4;
                page.Orientation = PageOrientation.Landscape;
                _gfx = XGraphics.FromPdfPage(page);
                Width = page.Width.Point - 2 * Margin;
                Bottom = page.Height.Point - Margin - 8; // room for the footer
                Y = Margin;
            }

            /// <summary>Starts a new page when <paramref name="height"/> does not fit; repeats an open table's header.</summary>
            public void EnsureSpace(double height)
            {
                if (Y + height <= Bottom) return;
                NewPage();
                _activeTable?.Header();
            }

            public void Section(string title)
            {
                _activeTable = null;
                // Keep a heading with at least its table header and first row.
                EnsureSpace(22 + RowHeight * 3);
                Text(title, Font(12, bold: true), Ink, Left, Y, Width);
                Y += 20;
            }

            public void Track(Table table) => _activeTable = table;

            /// <summary>Stops repeating a table header on page breaks once the table is done.</summary>
            public void EndTable() => _activeTable = null;

            public void Text(string text, XFont font, XColor color, double x, double y, double width, XStringFormat? format = null)
            {
                var fitted = Fit(text, font, width);
                Gfx.DrawString(fitted, font, new XSolidBrush(color), new XRect(x, y, width, font.Size * 1.3), format ?? XStringFormats.TopLeft);
            }

            /// <summary>Cuts <paramref name="text"/> with an ellipsis so it never spills into the next column.</summary>
            public string Fit(string text, XFont font, double width)
            {
                text = (text ?? string.Empty).Replace('\r', ' ').Replace('\n', ' ');
                if (width <= 0 || Gfx.MeasureString(text, font).Width <= width) return text;
                int lo = 0, hi = text.Length;
                while (lo < hi)
                {
                    var mid = (lo + hi + 1) / 2;
                    if (Gfx.MeasureString(text[..mid] + "…", font).Width <= width) lo = mid;
                    else hi = mid - 1;
                }
                return text[..lo].TrimEnd() + "…";
            }

            public void Finish()
            {
                _gfx?.Dispose();
                _gfx = null;
            }
        }

        private sealed class Table
        {
            private const double Pad = 6;
            private readonly Context _ctx;
            private readonly Column[] _columns;
            private int _rowIndex;

            public Table(Context ctx, Column[] columns)
            {
                _ctx = ctx;
                _columns = columns;
                ctx.Track(this);
            }

            public void Header()
            {
                var y = _ctx.Y;
                _ctx.Gfx.DrawRectangle(new XSolidBrush(HeaderFill), _ctx.Left, y, _ctx.Width, RowHeight);
                var x = _ctx.Left;
                foreach (var col in _columns)
                {
                    var w = col.Share * _ctx.Width;
                    var font = _ctx.Font(8.5, bold: true);
                    _ctx.Gfx.DrawString(_ctx.Fit(col.Title, font, w - 2 * Pad), font, XBrushes.White,
                        new XRect(x + Pad, y, w - 2 * Pad, RowHeight), col.Align ?? XStringFormats.CenterLeft);
                    x += w;
                }
                _ctx.Y += RowHeight;
            }

            public void Row(Cell[] cells, double height)
            {
                _ctx.EnsureSpace(height);
                var y = _ctx.Y;
                if (_rowIndex++ % 2 == 1)
                    _ctx.Gfx.DrawRectangle(new XSolidBrush(Zebra), _ctx.Left, y, _ctx.Width, height);
                _ctx.Gfx.DrawLine(new XPen(Rule, 0.5), _ctx.Left, y + height, _ctx.Left + _ctx.Width, y + height);

                var x = _ctx.Left;
                for (var c = 0; c < _columns.Length; c++)
                {
                    var col = _columns[c];
                    var cell = cells[c];
                    var w = col.Share * _ctx.Width;
                    var inner = w - 2 * Pad;
                    var font = _ctx.Font(8.5, cell.Bold);
                    if (cell.Sub is null)
                    {
                        _ctx.Gfx.DrawString(_ctx.Fit(cell.Text, font, inner), font, new XSolidBrush(cell.Color),
                            new XRect(x + Pad, y, inner, height), col.Align ?? XStringFormats.CenterLeft);
                    }
                    else
                    {
                        var half = height / 2;
                        _ctx.Gfx.DrawString(_ctx.Fit(cell.Text, font, inner), font, new XSolidBrush(cell.Color),
                            new XRect(x + Pad, y + 2, inner, half), XStringFormats.CenterLeft);
                        var subFont = _ctx.Font(7.5);
                        _ctx.Gfx.DrawString(_ctx.Fit(cell.Sub, subFont, inner), subFont, new XSolidBrush(Muted),
                            new XRect(x + Pad, y + half - 2, inner, half), XStringFormats.CenterLeft);
                    }
                    x += w;
                }
                _ctx.Y += height;
            }
        }
    }
}
