using DomainService.Monitor.Entity;
using DomainService.Monitor.Models;

namespace DomainService.Monitor.Services
{
    public interface IMonitorConfigurationRepoService
    {
        Task<MonitorConfiguration?> GetConfigurationAsync(string itemId);
        Task<(List<MonitorConfiguration> Items, int TotalCount)> GetConfigurationListAsync(string tenantId, string? monitorSourcetype, int pageNumber, int pageSize, string? sortProperty = null, bool sortIsDescending = false);
        Task<List<MonitorConfiguration>> GetConfigurationListByTenantIdAsync(string tenantId);
        Task<List<MonitorConfiguration>> GetConfigurationListByRepoIdAsync(string tenantId, string repoId);
        Task<List<MonitorConfiguration>> GetAllConfigurationListAsync();
        Task<bool> SaveConfigurationAsync(MonitorConfiguration monitorConfiguration);
        Task<bool> UpdateConfigurationAsync(MonitorConfiguration monitorConfiguration);
        Task<bool> UpdateConfigurationIncidentAsync(MonitorConfigurationIncidentUpdate monitorConfigurationUpdate);
        Task<bool> DeleteConfigurationAsync(string itemId);
        Task<MonitorConfiguration> GetByUrlAsync(string url);
        Task<MonitorConfiguration?> GetExternalServiceConfigurationAsync(string externalServiceId);

    }
}
