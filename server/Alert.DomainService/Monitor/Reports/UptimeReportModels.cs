namespace DomainService.Monitor.Reports
{
    /// <summary>The file types the uptime report can be exported as.</summary>
    public enum UptimeReportFormat
    {
        Pdf,
        Xlsx,
    }

    /// <summary>
    /// Query of <c>GET Monitor/ExportUptimeReport</c>. With <see cref="MonitorId"/> the report covers that one
    /// monitor; otherwise every monitor of <see cref="ProjectKey"/> in the <see cref="MonitorSourceType"/> tab.
    /// </summary>
    public class UptimeReportQuery
    {
        public string? ProjectKey { get; set; }
        public string? MonitorSourceType { get; set; }
        public string? MonitorId { get; set; }

        /// <summary>Start of the period, an ISO-8601 instant (UTC or with an offset).</summary>
        public string? From { get; set; }

        /// <summary>End of the period, an ISO-8601 instant. A future end is clamped to now.</summary>
        public string? To { get; set; }

        /// <summary><c>pdf</c> or <c>xlsx</c>.</summary>
        public string? Format { get; set; }

        /// <summary>
        /// IANA time zone the dates in the file are written in (the browser's own). Unknown or blank falls back to UTC;
        /// the zone used is always printed in the report so a fallback never goes unnoticed.
        /// </summary>
        public string? TimeZone { get; set; }
    }

    /// <summary>A rendered report file.</summary>
    public sealed record UptimeReportFile(byte[] Content, string ContentType, string FileName);

    /// <summary>Outcome of an export: the file, or why there is none.</summary>
    public sealed class UptimeReportResult
    {
        public UptimeReportFile? File { get; init; }
        public string? Error { get; init; }
        public bool NotFound { get; init; }

        public static UptimeReportResult Ok(UptimeReportFile file) => new() { File = file };
        public static UptimeReportResult Invalid(string error) => new() { Error = error };
        public static UptimeReportResult Missing(string error) => new() { Error = error, NotFound = true };
    }

    /// <summary>Everything a renderer needs; all instants are UTC, renderers convert with <see cref="TimeZone"/>.</summary>
    public sealed class UptimeReport
    {
        public required string Title { get; init; }
        public required string ScopeLabel { get; init; }
        public required DateTime FromUtc { get; init; }
        public required DateTime ToUtc { get; init; }
        public required DateTime GeneratedAtUtc { get; init; }
        public required TimeZoneInfo TimeZone { get; init; }
        public required IReadOnlyList<MonitorUptimeRow> Monitors { get; init; }
        public required IReadOnlyList<UptimeReportIncident> Incidents { get; init; }

        /// <summary>Total observed time across monitors that existed in the period.</summary>
        public long ObservedMs => Monitors.Sum(m => m.ObservedMs);

        /// <summary>Total downtime inside the period across all monitors.</summary>
        public long DowntimeMs => Monitors.Sum(m => m.DowntimeMs);

        public int IncidentCount => Monitors.Sum(m => m.IncidentCount);

        /// <summary>Time-weighted uptime of all monitors; null when none existed during the period.</summary>
        public double? OverallUptimePercent => UptimeReportCalculator.UptimePercent(ObservedMs, DowntimeMs);

        public DateTime ToLocal(DateTime utc) => TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), TimeZone);
    }

    public sealed class MonitorUptimeRow
    {
        public required string MonitorId { get; init; }
        public required string Name { get; init; }
        public required string Url { get; init; }
        public required string MonitorType { get; init; }

        /// <summary>Up, Down or Paused, as of when the report was generated.</summary>
        public required string CurrentStatus { get; init; }

        /// <summary>
        /// Time inside the period the monitor existed for. A monitor created mid-period is only judged from its
        /// creation; 0 when it was created after the period ended.
        /// </summary>
        public long ObservedMs { get; init; }

        /// <summary>Downtime inside the period (outages straddling a boundary are clipped to it).</summary>
        public long DowntimeMs { get; init; }

        public long UptimeMs => Math.Max(0, ObservedMs - DowntimeMs);

        /// <summary>Null when the monitor did not exist during the period.</summary>
        public double? UptimePercent { get; init; }

        /// <summary>Outages that overlap the period, including ones that began before it or are still open.</summary>
        public int IncidentCount { get; init; }

        /// <summary>Full length of the longest of those outages (an open one counts up to generation time).</summary>
        public long LongestOutageMs { get; init; }

        /// <summary>Mean time to recovery over the outages that have ended; null when none has.</summary>
        public long? MeanTimeToRecoveryMs { get; init; }

        public DateTime? LastIncidentStartUtc { get; init; }
    }

    public sealed class UptimeReportIncident
    {
        public required string MonitorName { get; init; }
        public required DateTime StartUtc { get; init; }

        /// <summary>Null while the outage is still open.</summary>
        public DateTime? EndUtc { get; init; }

        /// <summary>Full length of the outage; an open one counts up to generation time.</summary>
        public long DurationMs { get; init; }

        /// <summary>The part of the outage that falls inside the report period.</summary>
        public long DowntimeInPeriodMs { get; init; }

        public int? LastStatusCode { get; init; }
        public string? FailureReason { get; init; }
        public bool IsOngoing => EndUtc is null;
    }
}
