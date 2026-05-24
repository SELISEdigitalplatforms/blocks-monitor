using DomainService.Monitor.Services;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace MonitoringWorker.Consumers
{
    public class MonitorSchedulerBackgroundWorker : BackgroundService
    {
        private readonly IMonitorSchedulerService _monitorSchedulerService;
        private readonly ILogger<MonitorSchedulerBackgroundWorker> _logger;

        public MonitorSchedulerBackgroundWorker(
            IMonitorSchedulerService monitorSchedulerService,
            ILogger<MonitorSchedulerBackgroundWorker> logger)
        {
            _monitorSchedulerService = monitorSchedulerService;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("[MonitorSchedulerBackgroundWorker] Starting outbound monitor scheduler...");

            try
            {
                await _monitorSchedulerService.StartAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
            }

            _logger.LogInformation("[MonitorSchedulerBackgroundWorker] Outbound monitor scheduler stopped.");
        }
    }
}
