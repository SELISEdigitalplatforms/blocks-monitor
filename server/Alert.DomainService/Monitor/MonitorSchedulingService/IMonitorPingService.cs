using DomainService.Monitor.Entity;
using DomainService.Shared.Models;

namespace DomainService.Monitor.Services
{
    public interface IMonitorPingService
    {
        Task InitializeQueueAsync();
        Task<MonitorPingLog> MonitorPingAsync(MonitorConfiguration config);
        Task<BaseApiResponse> GetPingLogsByDateRangeAsync(string monitorId, string? startDateStr, string? endDateStr);
    }
}
