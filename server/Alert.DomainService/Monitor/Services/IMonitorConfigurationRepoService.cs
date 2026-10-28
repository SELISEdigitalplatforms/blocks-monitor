using Blocks.Genesis.Entities.Monitor;
using DomainService.Monitor.Models;
using MongoDB.Driver;

namespace DomainService.Monitor.Services
{
    public interface IMonitorConfigurationRepoService
    {
        Task<MonitorConfiguration?> GetConfigurationAsync(string itemId);
        /// <summary>The configuration as the caller may see it: properties a View column rule hides are cleared. Never save it back.</summary>
        Task<MonitorConfiguration?> GetConfigurationForViewAsync(string itemId);
        Task<(List<MonitorConfiguration> Items, int TotalCount)> GetConfigurationListAsync(string tenantId, string? monitorSourceType, int pageNumber, int pageSize, string? sortProperty = null, bool sortIsDescending = false);
        Task<List<MonitorConfiguration>> GetConfigurationListByTenantIdAsync(string tenantId);
        Task<List<MonitorConfiguration>> GetConfigurationListByRepoIdAsync(string tenantId, string repoId);
        Task<List<MonitorConfiguration>> GetAllConfigurationListAsync();
        Task<bool> SaveConfigurationAsync(MonitorConfiguration monitorConfiguration);
        Task<bool> UpdateConfigurationAsync(MonitorConfiguration monitorConfiguration);
        Task<bool> UpdateConfigurationIncidentAsync(MonitorConfigurationIncidentUpdate monitorConfigurationUpdate);
        Task<bool> DeleteConfigurationAsync(string itemId);
        Task<MonitorConfiguration> GetByUrlAsync(string url);
        Task<MonitorConfiguration?> GetExternalServiceConfigurationAsync(string externalServiceId);

        // ---- Alert recipients. "Editable" = TenantId matches and the effective source type is neither
        // Infrastructure nor BlocksServices. Every read here throws on failure: an unreachable database
        // must never look like a project without monitors.

        /// <summary>Editable monitors for the Alert recipients page, as the caller may see them (projected, column-masked).</summary>
        Task<List<MonitorConfiguration>> GetEditableMonitorsForViewAsync(string tenantId);

        /// <summary>Whole documents of the editable monitors, optionally only <paramref name="itemIds"/>.</summary>
        Task<List<MonitorConfiguration>> GetEditableMonitorsAsync(string tenantId, IReadOnlyCollection<string>? itemIds = null);

        /// <summary>Whole documents of the editable monitors that lack at least one of <paramref name="emails"/> (exact match).</summary>
        Task<List<MonitorConfiguration>> GetEditableMonitorsMissingEmailsAsync(string tenantId, IReadOnlyCollection<string> emails);

        /// <summary>One EDIT row filter for all of <paramref name="itemIds"/>; null when the caller may edit none.</summary>
        Task<FilterDefinition<MonitorConfiguration>?> GetEmailsEditFilterAsync(string tenantId, IReadOnlyCollection<string> itemIds);

        /// <summary>The data validation rules for each update (bounded parallelism); the updates they refuse, in input order.</summary>
        Task<IReadOnlyList<MonitorEmailsCheckFailure>> CheckEmailsUpdatesAsync(IReadOnlyList<MonitorEmailsUpdate> updates);

        /// <summary>All updates in one unordered bulk write; returns how many documents matched.</summary>
        Task<long> BulkUpdateEmailsAsync(IReadOnlyList<MonitorEmailsUpdate> updates, FilterDefinition<MonitorConfiguration> editFilter);

        /// <summary>One update; true when the document matched.</summary>
        Task<bool> UpdateEmailsAsync(MonitorEmailsUpdate update, FilterDefinition<MonitorConfiguration> editFilter);
    }
}
