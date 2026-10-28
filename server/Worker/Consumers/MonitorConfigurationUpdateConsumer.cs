using Blocks.Genesis;
using DomainService.AlertRecipients.Services;
using DomainService.Monitor.Services;
using DomainService.Shared.Entity;

namespace MonitoringWorker.Consumers
{
    public class MonitorConfigurationUpdateConsumer : IConsumer<MonitorConfigurationUpdateQueue>
    {   
        private readonly IMonitorSchedulerService _monitorSchedulerService;
        private readonly IAlertRecipientReconciler _alertRecipientReconciler;
        private readonly ILogger<MonitorConfigurationUpdateConsumer> _logger;
        public MonitorConfigurationUpdateConsumer(IMonitorSchedulerService monitorSchedulerService, IAlertRecipientReconciler alertRecipientReconciler, ILogger<MonitorConfigurationUpdateConsumer> logger)
        {
            _monitorSchedulerService = monitorSchedulerService;
            _alertRecipientReconciler = alertRecipientReconciler;
            _logger = logger;
        }

        public async Task Consume(MonitorConfigurationUpdateQueue task)
        {
            _ = Task.Run(async () =>
            {
                // Monitors inserted elsewhere (blocks-release) get their "All monitors" people before the reload
                // schedules them (H18). A reconcile failure never stops the reload (C24).
                try
                {
                    await _alertRecipientReconciler.ReconcileAsync();
                }
                catch (Exception ex)
                {
                    _logger.LogError("Alert recipient reconciliation failed: {ErrorType}", ex.GetType().Name);
                }

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
