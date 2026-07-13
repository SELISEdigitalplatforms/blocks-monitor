using DomainService.Monitor.Models;
using DomainService.Shared.Models;

namespace DomainService.Monitor.Services
{
    public interface IMonitorConfigurationService
    {
        Task<BaseApiResponse> GetConfigurationByIdAsync(string monitorId);
        Task<PaginatedResponse> GetConfigurationListAsync(string tenantId, string monitorSourcetype, int pageNumber, int pageSize, string? sortProperty = null, bool sortIsDescending = false);
        Task<BaseApiResponse> GetConfigurationListByRepoIdAsync(string tenantId, string repoId);
        Task<BaseApiResponse> SaveConfigurationAsync(SaveMonitorConfigurationRequest request);
        Task<BaseApiResponse> UpdateConfigurationAsync(UpdateMonitorConfigurationRequest request);
        Task<BaseApiResponse> DeleteConfigurationAsync(string itemId);
        Task<BaseApiResponse> GetConfigurationListWithDowntimeByRepoIdAsync(string tenantId, string repoId);

    }
}
