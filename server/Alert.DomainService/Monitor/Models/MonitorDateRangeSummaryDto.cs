using System;

namespace DomainService.Monitor.Models
{
    public class MonitorDateRangeSummaryResponse
    {
        public string Range { get; set; }
        public long TotalDurationMs { get; set; }
        public long IncidentCount { get; set; }
    }

    [Obsolete("Renamed to MonitorDateRangeSummaryResponse.")]
    public class MonitorDateRangeSummaryDto : MonitorDateRangeSummaryResponse
    {
    }
}
