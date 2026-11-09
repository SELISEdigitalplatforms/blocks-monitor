using Blocks.Genesis.Entities.Monitor;

namespace DomainService.Monitor.Reports
{
    /// <summary>
    /// Pure uptime arithmetic for the export, kept apart from data access and rendering so it can be tested exactly.
    /// </summary>
    /// <remarks>
    /// Differs from the 7/30/365-day cards on the details page in one deliberate way: those count only outages that
    /// STARTED inside the range, so an outage that began just before it is missed entirely. A report someone may use
    /// to argue an SLA must not do that, so here every outage overlapping the period counts, clipped to the period.
    /// </remarks>
    public static class UptimeReportCalculator
    {
        /// <summary>
        /// Uptime percentage rounded DOWN to two decimals, like the UI's <c>formatUptime</c>, so any downtime at all
        /// reads below 100.00%. Null when nothing was observed.
        /// </summary>
        public static double? UptimePercent(long observedMs, long downtimeMs)
        {
            if (observedMs <= 0) return null;
            var percent = (observedMs - downtimeMs) / (double)observedMs * 100d;
            var clamped = Math.Clamp(percent, 0d, 100d);
            // The epsilon absorbs float error (28.999999999999996 for 29) before flooring.
            return Math.Floor(clamped * 100d + 1e-9) / 100d;
        }

        public static (List<MonitorUptimeRow> Rows, List<UptimeReportIncident> Incidents) Calculate(
            IReadOnlyList<MonitorConfiguration> monitors,
            IReadOnlyList<MonitorIncident> incidents,
            DateTime fromUtc,
            DateTime toUtc,
            DateTime nowUtc)
        {
            var byMonitor = incidents
                .Where(i => !string.IsNullOrEmpty(i.MonitorId))
                .GroupBy(i => i.MonitorId)
                .ToDictionary(g => g.Key, g => g.ToList());

            var rows = new List<MonitorUptimeRow>(monitors.Count);
            var reportIncidents = new List<UptimeReportIncident>();

            foreach (var monitor in monitors)
            {
                // The monitor is judged only while it existed. CreatedDate defaults to MinValue on legacy rows, which
                // simply means "the whole period".
                var created = AsUtc(monitor.CreatedDate);
                var windowStart = created > fromUtc ? created : fromUtc;
                var windowEnd = toUtc < nowUtc ? toUtc : nowUtc;
                var observedMs = windowEnd > windowStart ? (long)(windowEnd - windowStart).TotalMilliseconds : 0L;

                byMonitor.TryGetValue(monitor.ItemId, out var own);
                own ??= new List<MonitorIncident>();

                var overlapping = new List<(DateTime Start, DateTime End, MonitorIncident Source)>();
                foreach (var incident in own)
                {
                    var start = AsUtc(incident.StartTime);
                    // An open outage lasts until now. EndTime is also null on a resolved row written before EndTime
                    // existed; IsResolved without an end is treated as zero-length rather than as still down.
                    DateTime end;
                    if (incident.EndTime is { } endTime) end = AsUtc(endTime);
                    else end = incident.IsResolved ? start : nowUtc;
                    if (end < start) end = start;

                    if (start < toUtc && end > fromUtc)
                        overlapping.Add((start, end, incident));
                }

                var downtimeMs = MergedOverlapMs(overlapping.Select(o => (o.Start, o.End)), windowStart, windowEnd);
                var resolved = overlapping.Where(o => o.Source.EndTime is not null).ToList();

                rows.Add(new MonitorUptimeRow
                {
                    MonitorId = monitor.ItemId,
                    Name = string.IsNullOrWhiteSpace(monitor.Name) ? monitor.ItemId : monitor.Name,
                    Url = monitor.Url ?? string.Empty,
                    MonitorType = (int)monitor.MonitorConfigurationType == 0 ? "HTTP Check" : "Heartbeat",
                    CurrentStatus = !monitor.IsActive ? "Paused" : monitor.CurrentStatus ? "Up" : "Down",
                    ObservedMs = observedMs,
                    DowntimeMs = downtimeMs,
                    UptimePercent = UptimePercent(observedMs, downtimeMs),
                    IncidentCount = overlapping.Count,
                    LongestOutageMs = overlapping.Count == 0 ? 0 : overlapping.Max(o => (long)(o.End - o.Start).TotalMilliseconds),
                    MeanTimeToRecoveryMs = resolved.Count == 0
                        ? null
                        : (long)resolved.Average(o => (o.End - o.Start).TotalMilliseconds),
                    LastIncidentStartUtc = overlapping.Count == 0 ? null : overlapping.Max(o => o.Start),
                });

                reportIncidents.AddRange(overlapping.Select(o => new UptimeReportIncident
                {
                    MonitorName = string.IsNullOrWhiteSpace(monitor.Name) ? monitor.ItemId : monitor.Name,
                    StartUtc = o.Start,
                    EndUtc = o.Source.EndTime is null && !o.Source.IsResolved ? null : o.End,
                    DurationMs = (long)(o.End - o.Start).TotalMilliseconds,
                    DowntimeInPeriodMs = OverlapMs(o.Start, o.End, windowStart, windowEnd),
                    LastStatusCode = o.Source.LastStatusCode == 0 ? null : o.Source.LastStatusCode,
                    FailureReason = o.Source.FailureReason,
                }));
            }

            // Worst first: that is what a reader of an uptime report looks for.
            rows = rows
                .OrderBy(r => r.UptimePercent ?? double.MaxValue)
                .ThenByDescending(r => r.DowntimeMs)
                .ThenBy(r => r.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();
            reportIncidents = reportIncidents.OrderByDescending(i => i.StartUtc).ToList();

            return (rows, reportIncidents);
        }

        /// <summary>Total length of the union of <paramref name="intervals"/> inside [windowStart, windowEnd).</summary>
        public static long MergedOverlapMs(IEnumerable<(DateTime Start, DateTime End)> intervals, DateTime windowStart, DateTime windowEnd)
        {
            if (windowEnd <= windowStart) return 0;

            // Clip first, then merge: incidents of one monitor should never overlap, but two open rows left behind by a
            // crashed worker would otherwise count the same minutes twice.
            var clipped = intervals
                .Select(i => (Start: i.Start < windowStart ? windowStart : i.Start, End: i.End > windowEnd ? windowEnd : i.End))
                .Where(i => i.End > i.Start)
                .OrderBy(i => i.Start)
                .ToList();

            long total = 0;
            DateTime? curStart = null, curEnd = null;
            foreach (var (start, end) in clipped)
            {
                if (curEnd is null || start > curEnd)
                {
                    if (curStart is not null) total += (long)(curEnd!.Value - curStart.Value).TotalMilliseconds;
                    curStart = start;
                    curEnd = end;
                }
                else if (end > curEnd)
                {
                    curEnd = end;
                }
            }
            if (curStart is not null) total += (long)(curEnd!.Value - curStart.Value).TotalMilliseconds;
            return total;
        }

        private static long OverlapMs(DateTime start, DateTime end, DateTime windowStart, DateTime windowEnd)
        {
            var s = start > windowStart ? start : windowStart;
            var e = end < windowEnd ? end : windowEnd;
            return e > s ? (long)(e - s).TotalMilliseconds : 0;
        }

        /// <summary>Mongo returns UTC; Unspecified values (tests, legacy rows) are taken as UTC rather than local.</summary>
        private static DateTime AsUtc(DateTime value) => value.Kind switch
        {
            DateTimeKind.Utc => value,
            DateTimeKind.Local => value.ToUniversalTime(),
            _ => DateTime.SpecifyKind(value, DateTimeKind.Utc),
        };
    }
}
