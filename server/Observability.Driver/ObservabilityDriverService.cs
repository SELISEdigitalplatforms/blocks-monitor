using DomainService.Health.Models;
using DomainService.Health.Services;
using DomainService.Monitor.Entity;
using DomainService.Monitor.Models;
using DomainService.Monitor.MonitorIncidentService;
using DomainService.Monitor.Services;
using DomainService.Shared.Models;

namespace ObservabilityDriver
{
    public class ObservabilityDriverService : IObservabilityDriverService
    {
        private readonly IMonitorConfigurationService _monitorConfigurationService;
        private readonly IMonitorConfigurationRepoService _monitorConfigurationRepoService;
        private readonly IMonitorIncidentService _monitorIncidentService;
        private readonly IMonitorPingService _monitorPingService;
        private readonly HealthConfigurationService _healthConfigurationService;
        private readonly HealthCheckService _healthCheckService;

        public ObservabilityDriverService(
            IMonitorConfigurationService monitorConfigurationService,
            IMonitorConfigurationRepoService monitorConfigurationRepoService,
            IMonitorIncidentService monitorIncidentService,
            IMonitorPingService monitorPingService,
            HealthConfigurationService healthConfigurationService,
            HealthCheckService healthCheckService)
        {
            _monitorConfigurationService = monitorConfigurationService;
            _monitorConfigurationRepoService = monitorConfigurationRepoService;
            _monitorIncidentService = monitorIncidentService;
            _monitorPingService = monitorPingService;
            _healthConfigurationService = healthConfigurationService;
            _healthCheckService = healthCheckService;
        }

        // -------- Monitor --------

        public Task<PaginatedResponse> GetMonitorListAsync(
            string projectKey,
            string? monitorSourceType,
            int pageNumber = 0,
            int pageSize = 10)
            => _monitorConfigurationService.GetConfigurationListAsync(projectKey, monitorSourceType, pageNumber, pageSize);

        public Task<BaseApiResponse> GetMonitorListByRepoIdAsync(string projectKey, string repoId)
            => _monitorConfigurationService.GetConfigurationListWithDowntimeByRepoIdAsync(projectKey, repoId);

        public Task<BaseApiResponse> GetMonitorByIdAsync(string monitorId)
            => _monitorConfigurationService.GetConfigurationByIdAsync(monitorId);

        public Task<BaseApiResponse> SaveMonitorAsync(SaveMonitorConfigurationRequest request)
            => _monitorConfigurationService.SaveConfigurationAsync(request);

        public Task<BaseApiResponse> UpdateMonitorAsync(UpdateMonitorConfigurationRequest request)
            => _monitorConfigurationService.UpdateConfigurationAsync(request);

        public Task<BaseApiResponse> DeleteMonitorAsync(string itemId)
            => _monitorConfigurationService.DeleteConfigurationAsync(itemId);

        public Task<PaginatedResponse> GetIncidentListAsync(string monitorId, int pageNumber = 0, int pageSize = 10)
            => _monitorIncidentService.GetIncidentsByMonitorIdAsync(monitorId, pageNumber, pageSize);

        public Task<MonitorDetailsResponse> GetMonitorDetailsAsync(string monitorId)
            => _monitorIncidentService.GetIncidentsDurationByDateRangeAsync(monitorId);

        public Task<BaseApiResponse> GetMonitorResponseTimeAsync(string monitorId, string? startDate, string? endDate)
            => _monitorPingService.GetPingLogsByDateRangeAsync(monitorId, startDate, endDate);

        public Task<BaseApiResponse> GetMonitorDownTimeAsync(string monitorId, string? startDate, string? endDate)
            => _monitorIncidentService.GetDownTimeLogsByDateRangeAsync(monitorId, startDate, endDate);

        public async Task<BaseApiResponse> IsExternalServiceConfiguredAsync(string externalServiceId)
        {
            var result = await _monitorConfigurationRepoService.GetExternalServiceConfigurationAsync(externalServiceId);
            return new BaseApiResponse
            {
                Data = result!,
                IsSuccess = true
            };
        }

        // -------- Health --------

        public Task<BaseApiResponse> SaveHealthAsync(SaveHealthConfigurationRequest request)
            => _healthConfigurationService.SaveConfigurationAsync(request);

        public Task<BaseApiResponse> UpdateHealthAsync(UpdateHealthConfigurationRequest request)
            => _healthConfigurationService.UpdateConfigurationAsync(request);

        public Task HandlePingAsync(string itemId)
            => _healthCheckService.HandlePingEventAsync(itemId);

        public Task<BaseApiResponse> DeleteHealthAsync(string itemId)
            => _monitorConfigurationService.DeleteConfigurationAsync(itemId);
    }
}
