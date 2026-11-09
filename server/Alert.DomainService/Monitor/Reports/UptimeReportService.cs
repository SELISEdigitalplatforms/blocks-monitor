using System.Globalization;
using Blocks.Genesis.Entities.Monitor;
using DomainService.Monitor.MonitorIncidentService;
using DomainService.Monitor.Services;
using Microsoft.Extensions.Logging;

namespace DomainService.Monitor.Reports
{
    public interface IUptimeReportService
    {
        Task<UptimeReportResult> ExportAsync(UptimeReportQuery query, CancellationToken cancellationToken = default);
    }

    /// <summary>
    /// Builds the uptime/downtime export for one monitor (details page) or every monitor of a tab (Monitor list).
    /// </summary>
    public class UptimeReportService : IUptimeReportService
    {
        /// <summary>A year plus a leap day; the period picker offers at most "last 365 days".</summary>
        public static readonly TimeSpan MaxPeriod = TimeSpan.FromDays(366);

        /// <summary>Bounds one export's work; a project with more monitors than this exports a single tab at a time.</summary>
        public const int MaxMonitors = 2000;

        private const int PageSize = 200;
        private static readonly TimeSpan DefaultPeriod = TimeSpan.FromDays(30);

        private readonly IMonitorConfigurationService _configurationService;
        private readonly IMonitorConfigurationRepoService _configurationRepo;
        private readonly IMonitorIncidentRepoService _incidentRepo;
        private readonly ILogger<UptimeReportService> _logger;
        private readonly TimeProvider _time;

        public UptimeReportService(
            IMonitorConfigurationService configurationService,
            IMonitorConfigurationRepoService configurationRepo,
            IMonitorIncidentRepoService incidentRepo,
            ILogger<UptimeReportService> logger,
            TimeProvider? time = null)
        {
            _configurationService = configurationService;
            _configurationRepo = configurationRepo;
            _incidentRepo = incidentRepo;
            _logger = logger;
            _time = time ?? TimeProvider.System;
        }

        public async Task<UptimeReportResult> ExportAsync(UptimeReportQuery query, CancellationToken cancellationToken = default)
        {
            var now = _time.GetUtcNow().UtcDateTime;

            if (!TryParseFormat(query.Format, out var format))
                return UptimeReportResult.Invalid("format must be 'pdf' or 'xlsx'.");

            if (!TryParseInstant(query.To, now, out var to))
                return UptimeReportResult.Invalid("to is not a valid date.");
            if (to > now) to = now;

            if (!TryParseInstant(query.From, to - DefaultPeriod, out var from))
                return UptimeReportResult.Invalid("from is not a valid date.");
            if (from >= to)
                return UptimeReportResult.Invalid("from must be earlier than to.");
            if (to - from > MaxPeriod)
                return UptimeReportResult.Invalid("The period cannot be longer than 366 days.");

            List<MonitorConfiguration> monitors;
            string scopeLabel;
            string fileScope;

            if (!string.IsNullOrWhiteSpace(query.MonitorId))
            {
                // Through the configuration service, not the repo, so the export applies exactly the tenant guard and
                // view masking GetMonitorById does: whoever cannot open the details page cannot export it either.
                var response = await _configurationService.GetConfigurationByIdAsync(query.MonitorId);
                if (response.Data is not MonitorConfiguration monitor || string.IsNullOrEmpty(monitor.ItemId))
                    return UptimeReportResult.Missing("Monitor not found.");

                monitors = new List<MonitorConfiguration> { monitor };
                scopeLabel = $"Monitor: {monitor.Name}" + (string.IsNullOrWhiteSpace(monitor.Url) ? string.Empty : $" ({monitor.Url})");
                fileScope = UptimeReportFormatting.Slug(monitor.Name ?? monitor.ItemId);
            }
            else
            {
                if (string.IsNullOrWhiteSpace(query.ProjectKey))
                    return UptimeReportResult.Invalid("projectKey or monitorId is required.");

                var loaded = await LoadMonitorsAsync(query.ProjectKey, query.MonitorSourceType, cancellationToken);
                if (loaded is null)
                    return UptimeReportResult.Invalid($"The project has more than {MaxMonitors} monitors; export one tab at a time.");
                monitors = loaded;
                scopeLabel = string.IsNullOrWhiteSpace(query.MonitorSourceType)
                    ? "All monitors"
                    : $"{SourceTypeLabel(query.MonitorSourceType)} monitors";
                fileScope = UptimeReportFormatting.Slug(scopeLabel);
            }

            cancellationToken.ThrowIfCancellationRequested();

            var incidents = await _incidentRepo.GetIncidentsOverlappingRangeAsync(
                monitors.Select(m => m.ItemId).ToList(), from, to);

            var (rows, reportIncidents) = UptimeReportCalculator.Calculate(monitors, incidents, from, to, now);

            var report = new UptimeReport
            {
                Title = "Uptime report",
                ScopeLabel = scopeLabel,
                FromUtc = from,
                ToUtc = to,
                GeneratedAtUtc = now,
                TimeZone = ResolveTimeZone(query.TimeZone),
                Monitors = rows,
                Incidents = reportIncidents,
            };

            cancellationToken.ThrowIfCancellationRequested();

            var fileName = string.Create(CultureInfo.InvariantCulture,
                $"uptime-report_{fileScope}_{report.ToLocal(from):yyyyMMdd}-{report.ToLocal(to):yyyyMMdd}");

            var file = format switch
            {
                UptimeReportFormat.Pdf => new UptimeReportFile(UptimeReportPdfRenderer.Render(report), "application/pdf", fileName + ".pdf"),
                _ => new UptimeReportFile(UptimeReportExcelRenderer.Render(report), XlsxContentType, fileName + ".xlsx"),
            };

            _logger.LogInformation(
                "Exported uptime report ({Format}) for {MonitorCount} monitors, {IncidentCount} incidents, {From} - {To}",
                format, rows.Count, reportIncidents.Count, from, to);

            return UptimeReportResult.Ok(file);
        }

        public const string XlsxContentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

        /// <summary>Every monitor of the tab, paging through the same query the Monitor list uses. Null past <see cref="MaxMonitors"/>.</summary>
        private async Task<List<MonitorConfiguration>?> LoadMonitorsAsync(string projectKey, string? monitorSourceType, CancellationToken cancellationToken)
        {
            var all = new List<MonitorConfiguration>();
            for (var page = 0; ; page++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                // Default sort (by name, as the list shows it): a stable order keeps the pages from skipping or repeating.
                var (items, total) = await _configurationRepo.GetConfigurationListAsync(projectKey, monitorSourceType, page, PageSize, null, false);
                if (total > MaxMonitors) return null;
                all.AddRange(items);
                if (items.Count < PageSize || all.Count >= total) break;
            }
            return all;
        }

        private static bool TryParseFormat(string? value, out UptimeReportFormat format)
        {
            switch (value?.Trim().ToLowerInvariant())
            {
                case "pdf":
                    format = UptimeReportFormat.Pdf;
                    return true;
                case "xlsx":
                case "excel":
                    format = UptimeReportFormat.Xlsx;
                    return true;
                default:
                    format = default;
                    return false;
            }
        }

        private static bool TryParseInstant(string? value, DateTime fallbackUtc, out DateTime utc)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                utc = fallbackUtc;
                return true;
            }

            // A value without an offset is taken as UTC, never as the server's local time.
            if (DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed))
            {
                utc = parsed.UtcDateTime;
                return true;
            }

            utc = default;
            return false;
        }

        private TimeZoneInfo ResolveTimeZone(string? id)
        {
            if (string.IsNullOrWhiteSpace(id)) return TimeZoneInfo.Utc;
            if (TimeZoneInfo.TryFindSystemTimeZoneById(id, out var zone)) return zone;

            // The value is not logged: it comes straight from the query string (CodeQL cs/log-forging). The report
            // itself prints the zone it used, so a fallback is still visible to the reader.
            _logger.LogWarning("Unknown time zone requested for uptime report; using UTC.");
            return TimeZoneInfo.Utc;
        }

        /// <summary>The client sends the enum's number ("2"); names are accepted too, as the list endpoint does.</summary>
        private static string SourceTypeLabel(string sourceType) =>
            Enum.TryParse<MonitorSourceTypes>(sourceType, true, out var parsed)
                ? parsed switch
                {
                    MonitorSourceTypes.BlocksServices => "Blocks services",
                    MonitorSourceTypes.DeployedServices => "Deployed services",
                    MonitorSourceTypes.ExternalServices => "External services",
                    MonitorSourceTypes.OtherServices => "Other services",
                    MonitorSourceTypes.Infrastructure => "Infrastructure",
                    _ => parsed.ToString(),
                }
                : sourceType;
    }
}
