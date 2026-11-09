using Blocks.Genesis.Entities.Monitor;

namespace DomainService.Monitor.MonitorIncidentService
{
    public interface IMonitorIncidentRepoService
    {
        Task<MonitorIncident?> GetActiveIncidentAsync(string monitorId);
        Task CreateIncidentAsync(MonitorIncident incident);
        Task UpdateIncidentAsync(MonitorIncident incident);
        Task<int> GetIncidentCountByMonitorIdAsync(MonitorConfiguration monitor);
        Task<List<MonitorIncident>> GetIncidentsByMonitorIdAsync(MonitorConfiguration monitor, int pageNumber, int pageSize, string? sortProperty = null, bool sortIsDescending = true);
        Task<List<IncidentListSummary>> GetIncidentsListByDateRangeAsync(string monitorId, string? startDateStr, string? endDateStr);
        Task<(List<MonitorIncident>, int)> GetIncidentsWithCountByMonitorIdAsync(MonitorConfiguration monitor, int pageNumber, int pageSize, string? sortProperty = null, bool sortIsDescending = true);
        Task<int> GetIncidentsDurationByDateRangeAsync(string monitorId, DateTime startTime, DateTime endTime);
        Task<Dictionary<string, long>> GetDowntimeByMultipleRangesAsync(string monitorId);
        Task<Dictionary<string, (long TotalDurationMs, long IncidentCount)>> GetDowntimeAndCountByDateRangesAsync(string monitorId, Dictionary<string, int> rangesInDays);
        Task<List<MonitorIncident>> GetIncidentsListByMonitorIdsAndDateRangeAsync(List<string> monitorIds, DateTime startDateUtc, DateTime endDateUtc);

        /// <summary>
        /// Incidents of <paramref name="monitorIds"/> that OVERLAP [from, to): started before <paramref name="toUtc"/> and
        /// not ended before <paramref name="fromUtc"/> (open ones included). Unlike the StartTime-only query above, an
        /// outage that began before the period is not missed. Throws on failure: an export must fail loudly rather than
        /// report 100% uptime because the read broke.
        /// </summary>
        Task<List<MonitorIncident>> GetIncidentsOverlappingRangeAsync(IReadOnlyCollection<string> monitorIds, DateTime fromUtc, DateTime toUtc);
    }
}
