using Blocks.Genesis.Entities.Monitor;

namespace DomainService.Monitor.Services
{
    public class MonitorQueueTask
    {
        public MonitorConfiguration Config { get; set; }
        public DateTime NextExecutionTime { get; set; }

        public MonitorQueueTask(MonitorConfiguration config)
        {
            Config = config;
            NextExecutionTime = DateTime.UtcNow.AddSeconds(config.IntervalInSeconds);
        }
    }
}
