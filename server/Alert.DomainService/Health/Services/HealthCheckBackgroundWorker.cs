using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace DomainService.Health.Services
{
    public class HealthCheckBackgroundWorker : BackgroundService
    {
        private readonly HealthCheckService _healthCheckService;
        private readonly ILogger<HealthCheckBackgroundWorker> _logger;

        public HealthCheckBackgroundWorker(
            HealthCheckService healthCheckService,
            ILogger<HealthCheckBackgroundWorker> logger)
        {
            _healthCheckService = healthCheckService;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation("[HealthCheckBackgroundWorker] Starting background health checks...");
            await _healthCheckService.StartAsync(stoppingToken);
            _logger.LogInformation("[HealthCheckBackgroundWorker] Health check service stopped.");
        }
    }
}
