using DomainService.Health.Models;
using DomainService.Monitor.Entity;
using DomainService.Monitor.Models;
using DomainService.Shared.Models;

namespace ObservabilityDriver
{
    /// <summary>
    /// Defines the Monitor and Health operations exposed by the Blocks Observability service.
    /// Mirrors the public surface of <c>MonitorController</c> and <c>HealthController</c>.
    /// </summary>
    public interface IObservabilityDriverService
    {
        // -------- Monitor --------

        Task<PaginatedResponse> GetMonitorListAsync(
            string projectKey,
            string? monitorSourceType,
            int pageNumber = 0,
            int pageSize = 10);

        Task<BaseApiResponse> GetMonitorListByRepoIdAsync(string projectKey, string repoId);

        Task<BaseApiResponse> GetMonitorByIdAsync(string monitorId);

        Task<BaseApiResponse> SaveMonitorAsync(SaveMonitorConfigurationRequest request);

        Task<BaseApiResponse> UpdateMonitorAsync(UpdateMonitorConfigurationRequest request);

        Task<BaseApiResponse> DeleteMonitorAsync(string itemId);

        Task<PaginatedResponse> GetIncidentListAsync(string monitorId, int pageNumber = 0, int pageSize = 10);

        Task<MonitorDetailsResponse> GetMonitorDetailsAsync(string monitorId);

        Task<BaseApiResponse> GetMonitorResponseTimeAsync(string monitorId, string? startDate, string? endDate);

        Task<BaseApiResponse> GetMonitorDownTimeAsync(string monitorId, string? startDate, string? endDate);

        Task<BaseApiResponse> IsExternalServiceConfiguredAsync(string externalServiceId);

        // -------- Health --------

        Task<BaseApiResponse> SaveHealthAsync(SaveHealthConfigurationRequest request);

        Task<BaseApiResponse> UpdateHealthAsync(UpdateHealthConfigurationRequest request);

        Task HandlePingAsync(string itemId);

        Task<BaseApiResponse> DeleteHealthAsync(string itemId);
    }
}
