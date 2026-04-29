using DomainService.Monitor.Entity;

namespace DomainService.Monitor.Services
{
    public interface IMonitorSchedulerService
    {
        Task StartAsync(CancellationToken cancellationToken = default);
        Task LoadMonitorsFromDatabaseAsync();
    }
}
