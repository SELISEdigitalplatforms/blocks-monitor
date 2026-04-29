namespace DomainService.Monitor.Models
{
    public class MonitorDateRangeSummaryDto
    {
        public string Range { get; set; }
        public long TotalDurationMs { get; set; }
        public long IncidentCount { get; set; }
    }
}
