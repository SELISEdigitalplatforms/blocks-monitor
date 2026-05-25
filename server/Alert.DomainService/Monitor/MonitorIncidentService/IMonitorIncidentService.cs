using DomainService.Monitor.Entity;
using DomainService.Monitor.Models;
using DomainService.Shared.Models;

namespace DomainService.Monitor.MonitorIncidentService
{
    public interface IMonitorIncidentService
    {
        Task HandleIncidentAsync(MonitorConfiguration config, MonitorPingLog response);
        Task<PaginatedResponse> GetIncidentsByMonitorIdAsync(string monitorId, int pageNumber, int pageSize);
        Task<MonitorDetailsResponse> GetIncidentsDurationByDateRangeAsync(string monitorId);
        Task<BaseApiResponse> GetDownTimeLogsByDateRangeAsync(string monitorId, string? startDateStr, string? endDateStr);
    }
}
