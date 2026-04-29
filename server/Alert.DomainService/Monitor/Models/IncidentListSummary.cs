namespace DomainService.Monitor.Models
{
    public class IncidentListSummary
    {
        public DateTime StartTime { get; set; }
        public DateTime? EndTime { get; set; }
        public double? DowntimeDurationSeconds { get; set; }
    }
}
