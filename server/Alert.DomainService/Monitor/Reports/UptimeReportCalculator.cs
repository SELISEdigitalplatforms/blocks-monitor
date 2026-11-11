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
                var window = ObservationWindow(monitor, fromUtc, toUtc, nowUtc);
                var own = byMonitor.TryGetValue(monitor.ItemId, out var list) ? list : new List<MonitorIncident>();
                var outages = OverlappingOutages(own, fromUtc, toUtc, nowUtc);

                rows.Add(BuildRow(monitor, outages, window));
                reportIncidents.AddRange(outages.Select(o => BuildIncident(monitor, o, window)));
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

        /// <summary>One outage as the report sees it: UTC start, end (now while open) and the stored incident.</summary>
        private readonly record struct Outage(DateTime Start, DateTime End, MonitorIncident Source)
        {
            public long DurationMs => (long)(End - Start).TotalMilliseconds;
        }

        /// <summary>The part of the period a monitor is judged on.</summary>
        private readonly record struct Window(DateTime Start, DateTime End)
        {
            public long Ms => End > Start ? (long)(End - Start).TotalMilliseconds : 0L;
        }

        /// <summary>
        /// The monitor is judged only while it existed, and only up to now. CreatedDate defaults to MinValue on legacy
        /// rows, which simply means "the whole period".
        /// </summary>
        private static Window ObservationWindow(MonitorConfiguration monitor, DateTime fromUtc, DateTime toUtc, DateTime nowUtc)
        {
            var created = AsUtc(monitor.CreatedDate);
            return new Window(created > fromUtc ? created : fromUtc, toUtc < nowUtc ? toUtc : nowUtc);
        }

        private static List<Outage> OverlappingOutages(List<MonitorIncident> incidents, DateTime fromUtc, DateTime toUtc, DateTime nowUtc)
        {
            var outages = new List<Outage>();
            foreach (var incident in incidents)
            {
                var start = AsUtc(incident.StartTime);
                var end = OutageEnd(incident, start, nowUtc);
                if (start < toUtc && end > fromUtc) outages.Add(new Outage(start, end, incident));
            }
            return outages;
        }

        /// <summary>
        /// An open outage lasts until now. EndTime is also null on a resolved row written before EndTime existed;
        /// IsResolved without an end is treated as zero-length rather than as still down.
        /// </summary>
        private static DateTime OutageEnd(MonitorIncident incident, DateTime start, DateTime nowUtc)
        {
            DateTime end;
            if (incident.EndTime is { } endTime) end = AsUtc(endTime);
            else end = incident.IsResolved ? start : nowUtc;
            return end < start ? start : end;
        }

        private static MonitorUptimeRow BuildRow(MonitorConfiguration monitor, List<Outage> outages, Window window)
        {
            var downtimeMs = MergedOverlapMs(outages.Select(o => (o.Start, o.End)), window.Start, window.End);
            var resolved = outages.Where(o => o.Source.EndTime is not null).ToList();
            var hasOutages = outages.Count > 0;

            return new MonitorUptimeRow
            {
                MonitorId = monitor.ItemId,
                Name = DisplayName(monitor),
                Url = monitor.Url ?? string.Empty,
                MonitorType = (int)monitor.MonitorConfigurationType == 0 ? "HTTP Check" : "Heartbeat",
                CurrentStatus = StatusLabel(monitor),
                ObservedMs = window.Ms,
                DowntimeMs = downtimeMs,
                UptimePercent = UptimePercent(window.Ms, downtimeMs),
                IncidentCount = outages.Count,
                LongestOutageMs = hasOutages ? outages.Max(o => o.DurationMs) : 0,
                MeanTimeToRecoveryMs = resolved.Count > 0 ? (long)resolved.Average(o => o.DurationMs) : null,
                LastIncidentStartUtc = hasOutages ? outages.Max(o => o.Start) : null,
            };
        }

        private static UptimeReportIncident BuildIncident(MonitorConfiguration monitor, Outage outage, Window window) => new()
        {
            MonitorName = DisplayName(monitor),
            StartUtc = outage.Start,
            EndUtc = outage.Source.EndTime is null && !outage.Source.IsResolved ? null : outage.End,
            DurationMs = outage.DurationMs,
            DowntimeInPeriodMs = OverlapMs(outage.Start, outage.End, window.Start, window.End),
            LastStatusCode = outage.Source.LastStatusCode == 0 ? null : outage.Source.LastStatusCode,
            FailureReason = outage.Source.FailureReason,
        };

        private static string DisplayName(MonitorConfiguration monitor) =>
            string.IsNullOrWhiteSpace(monitor.Name) ? monitor.ItemId : monitor.Name;

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

            if (clipped.Count == 0) return 0;

            long total = 0;
            var (curStart, curEnd) = clipped[0];
            foreach (var (start, end) in clipped.Skip(1))
            {
                if (start > curEnd)
                {
                    total += (long)(curEnd - curStart).TotalMilliseconds;
                    curStart = start;
                    curEnd = end;
                }
                else if (end > curEnd)
                {
                    curEnd = end;
                }
            }
            return total + (long)(curEnd - curStart).TotalMilliseconds;
        }

        /// <summary>Paused wins: a paused monitor is not checked, so its last up/down says nothing current.</summary>
        private static string StatusLabel(MonitorConfiguration monitor)
        {
            if (!monitor.IsActive) return "Paused";
            return monitor.CurrentStatus ? "Up" : "Down";
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
