using MongoDB.Bson.Serialization.Attributes;

namespace DomainService.Monitor.Models
{
    [BsonIgnoreExtraElements]
    public class MonitorPingLogSummary
    {
        public string MonitorId { get; set; }
        public DateTime Timestamp { get; set; }
        public double ResponseTimeMs { get; set; }
        public int StatusCode { get; set; }
    }
}
