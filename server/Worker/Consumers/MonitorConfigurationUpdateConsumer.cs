using Blocks.Genesis;
using DomainService.Monitor.Services;
using DomainService.Shared.Entity;

namespace MonitoringWorker.Consumers
{
    public class MonitorConfigurationUpdateConsumer : IConsumer<MonitorConfigurationUpdateQueue>
    {   
        private readonly IMonitorSchedulerService _monitorSchedulerService;
        private readonly ILogger<MonitorConfigurationUpdateConsumer> _logger;
        public MonitorConfigurationUpdateConsumer(IMonitorSchedulerService monitorSchedulerService, ILogger<MonitorConfigurationUpdateConsumer> logger)
        {
            _monitorSchedulerService = monitorSchedulerService;
            _logger = logger;
        }

        public async Task Consume(MonitorConfigurationUpdateQueue task)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await _monitorSchedulerService.LoadMonitorsFromDatabaseAsync();
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex.Message, "Failed to initiate queue.");
                }
            });
        }
    }
}
