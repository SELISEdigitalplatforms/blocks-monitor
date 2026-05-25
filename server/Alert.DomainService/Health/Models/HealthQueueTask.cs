using DomainService.Monitor.Entity;

namespace DomainService.Health.Models
{
    public class HealthQueueTask
    {
        public MonitorConfiguration Config { get; set; }
        public DateTime NextExecutionTime { get; set; }

        public HealthQueueTask(MonitorConfiguration config)
        {
            Config = config;
            NextExecutionTime = DateTime.UtcNow.AddSeconds(config.IntervalInSeconds + config.GracePeriodInSeconds);
        }
    }
}
