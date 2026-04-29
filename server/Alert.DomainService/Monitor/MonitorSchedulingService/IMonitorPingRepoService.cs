using DomainService.Monitor.Entity;
using DomainService.Monitor.Models;

namespace DomainService.Monitor.MonitorSchedulingService
{
    public interface IMonitorPingRepoService
    {
        Task SavePingLogAsync(MonitorPingLog log);
        Task<List<MonitorPingLogSummary>> GetPingLogsByDateRangeAsync(string monitorId, string startDateStr, string endDateStr);
    }
}
