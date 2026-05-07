using DomainService.Monitor.Entity;
using DomainService.Monitor.Models;

namespace DomainService.Monitor.MonitorIncidentService
{
    public interface IMonitorIncidentRepoService
    {
        Task<MonitorIncident?> GetActiveIncidentAsync(string monitorId);
        Task CreateIncidentAsync(MonitorIncident incident);
        Task UpdateIncidentAsync(MonitorIncident incident);
        Task<int> GetIncidentCountByMonitorIdAsync(MonitorConfiguration monitor);
        Task<List<MonitorIncident>> GetIncidentsByMonitorIdAsync(MonitorConfiguration monitor, int pageNumber, int pageSize);
        Task<List<IncidentListSummary>> GetIncidentsListByDateRangeAsync(string monitorId, string? startDateStr, string? endDateStr);
        Task<(List<MonitorIncident>, int)> GetIncidentsWithCountByMonitorIdAsync(MonitorConfiguration monitor, int pageNumber, int pageSize);
        Task<int> GetIncidentsDurationByDateRangeAsync(string monitorId, DateTime startTime, DateTime endTime);
        Task<Dictionary<string, long>> GetDowntimeByMultipleRangesAsync(string monitorId);
        Task<Dictionary<string, (long TotalDurationMs, long IncidentCount)>> GetDowntimeAndCountByDateRangesAsync(string monitorId, Dictionary<string, int> rangesInDays);
        Task<List<MonitorIncident>> GetIncidentsListByMonitorIdsAndDateRangeAsync(List<string> monitorIds, DateTime startDateUtc, DateTime endDateUtc);
    }
}
