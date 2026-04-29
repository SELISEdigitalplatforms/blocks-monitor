namespace DomainService.Monitor.Models
{
    public class MonitorConfigurationIncidentUpdate
    {
        public string MonitorId { get; set; }
        public DateTime LastIncidentAt { get; set; }
        public bool CurrentStatus { get; set; }
    }
}
