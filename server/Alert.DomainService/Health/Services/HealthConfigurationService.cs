using System.Net;
using Blocks.Genesis;
using DomainService.Health.Models;
using DomainService.Monitor.Entity;
using DomainService.Shared.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DomainService.Health.Services
{
    public class HealthConfigurationService
    {
        private readonly ILogger<HealthConfigurationService> _logger;
        private readonly HealthConfigurationRepoService _healthConfigurationRepoService;
        private readonly HealthCheckService _healthCheckService;
        private readonly IConfiguration _configuration;

        public HealthConfigurationService(
            ILogger<HealthConfigurationService> logger,
            HealthCheckService healthCheckService,
            IConfiguration configuration,
            HealthConfigurationRepoService healthConfigurationRepoService)
        {
            _logger = logger;
            _healthConfigurationRepoService = healthConfigurationRepoService;
            _healthCheckService = healthCheckService;
            _configuration = configuration;
        }

        public async Task<BaseApiResponse> SaveConfigurationAsync(SaveHealthConfigurationRequest request)
        {
            try
            {
                string guid = Guid.NewGuid().ToString();
                var url = $"{_configuration["AlertServiceUrl"]}/{guid}";
                MonitorSourceTypes monitorSourceTypeEnum = MonitorSourceTypes.DeployedServices;
                if (!string.IsNullOrEmpty(request.MonitorSourceType))
                {
                    if (!Enum.TryParse<MonitorSourceTypes>(request.MonitorSourceType, true, out var parsedEnum))
                    {
                        return new BaseApiResponse
                        {
                            IsSuccess = false,
                            Message = $"Invalid MonitorSourceType: {request.MonitorSourceType}"
                        };
                    }

                    if (parsedEnum != MonitorSourceTypes.ExternalServices &&
                        parsedEnum != MonitorSourceTypes.BlocksServices &&
                        parsedEnum != MonitorSourceTypes.DeployedServices &&
                        parsedEnum != MonitorSourceTypes.OtherServices
)
                    {
                        return new BaseApiResponse
                        {
                            IsSuccess = false,
                            Message = $"Invalid MonitorSourceType"
                        };
                    }

                    monitorSourceTypeEnum = parsedEnum;
                }

                var healthConfiguration = new MonitorConfiguration
                {
                    ItemId = guid,
                    TenantId = request.ProjectKey,
                    Name = request.Name,
                    RepoName = request.RepoName,
                    RepoId = request.RepoId,
                    Url = url,
                    IntervalInSeconds = request.IntervalInSeconds,
                    GracePeriodInSeconds = request.GracePeriodInSeconds,
                    IsActive = request.IsActive,
                    MonitorConfigurationType = MonitorConfigurationTypes.InboundPing,
                    MonitorSourcetypes = monitorSourceTypeEnum,
                    ExternalServiceId = monitorSourceTypeEnum == MonitorSourceTypes.ExternalServices
                               ? request.ExternalServiceId
                               : null,
                    CreatedDate = DateTime.UtcNow,
                    CreatedBy = BlocksContext.GetContext()?.UserId
                };

                await _healthConfigurationRepoService.SaveOrUpdateConfigurationAsync(healthConfiguration);

                return new BaseApiResponse
                {
                    Data = healthConfiguration,
                    IsSuccess = true,
                    Message = $"HealthConfiguration created successfully ({healthConfiguration.ItemId})."
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error saving HealthConfiguration {Name}", request.Name);
                return new BaseApiResponse
                {
                    IsSuccess = false,
                    Message = $"Error saving configuration: {ex.Message}"
                };
            }
        }

        public async Task<BaseApiResponse> UpdateConfigurationAsync(UpdateHealthConfigurationRequest request)
        {
            try
            {
                var existing = await _healthConfigurationRepoService.GetConfigurationAsync(request.ItemId);
                if (existing == null)
                {
                    _logger.LogWarning("HealthConfiguration with ItemId {ItemId} not found.", request.ItemId);
                    return new BaseApiResponse
                    {
                        IsSuccess = false,
                        StatusCode = HttpStatusCode.NotFound,
                        Message = $"HealthConfiguration not found: {request.ItemId}"
                    };
                }

                // Update only allowed fields
                existing.Name = request.Name ?? existing.Name;
                existing.IntervalInSeconds = request.IntervalInSeconds > 0
                    ? request.IntervalInSeconds
                    : existing.IntervalInSeconds;
                existing.GracePeriodInSeconds = request.GracePeriodInSeconds > 0
                    ? request.GracePeriodInSeconds
                    : existing.GracePeriodInSeconds;
                existing.IsActive = request.IsActive;
                existing.LastUpdatedDate = DateTime.UtcNow;
                existing.LastUpdatedBy = BlocksContext.GetContext()?.UserId;
                if (request.Emails != null && request.Emails.Count > 0)
                    existing.Emails = request.Emails;

                await _healthConfigurationRepoService.SaveOrUpdateConfigurationAsync(existing);
                await _healthCheckService.LoadMonitorsFromDatabaseAsync();

                return new BaseApiResponse
                {
                    Data = existing,
                    IsSuccess = true,
                    Message = $"HealthConfiguration {request.ItemId} updated successfully."
                };
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating HealthConfiguration {ItemId}", request.ItemId);
                return new BaseApiResponse
                {
                    IsSuccess = false,
                    Message = $"Error updating configuration: {ex.Message}"
                };
            }
        }
    }
}
