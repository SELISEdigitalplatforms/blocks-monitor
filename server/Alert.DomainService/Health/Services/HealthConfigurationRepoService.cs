using Blocks.Genesis;
using Blocks.Genesis.DataAccess.Rules;
using DomainService.Shared.DataAccess;
using Blocks.Genesis.Entities.Monitor;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;
namespace DomainService.Health.Services
{
    public class HealthConfigurationRepoService
    {
        private readonly ILogger<HealthConfigurationRepoService> _logger;
        private readonly IMongoCollection<MonitorConfiguration> _healthConfigCollection;
        private readonly IMonitorDataAccess _access;

        public HealthConfigurationRepoService(
            ILogger<HealthConfigurationRepoService> logger,
            IDbContextProvider dbContextProvider,
            IBlocksSecret blocksSecret,
            IMonitorDataAccess access)
        {
            _access = access;
            var db = dbContextProvider.GetDatabase(blocksSecret.DatabaseConnectionString, blocksSecret.RootDatabaseName);
            
            _logger = logger;
            _healthConfigCollection = db.GetCollection<MonitorConfiguration>("MonitorConfigurations");
        }

        // =====================================================
        // =============== CONFIGURATION METHODS ===============
        // =====================================================

        public async Task<List<MonitorConfiguration>> GetAllActiveConfigurationsAsync()
        {
            // Read failures propagate so the scheduler keeps the last known heartbeat schedule
            // instead of treating an unavailable root database as an empty configuration set.
            // The polling loop logs and handles the failure.
            var filter = Builders<MonitorConfiguration>.Filter.And(
                Builders<MonitorConfiguration>.Filter.Eq(m => m.IsActive, true),
                Builders<MonitorConfiguration>.Filter.Eq(m => m.MonitorConfigurationType, MonitorConfigurationTypes.InboundPing)
            );
            var scope = await _access.ReadAsync(MonitorSchemas.MonitorConfiguration, filter, "HealthConfigurationRepoService.GetAllActiveConfigurationsAsync");
            return scope.Granted ? await scope.Apply(_healthConfigCollection).ToListAsync() : new List<MonitorConfiguration>();
        }

        public async Task<List<MonitorConfiguration>> GetConfigurationListAsync(string tenantId)
        {
            try
            {
                var filter = Builders<MonitorConfiguration>.Filter.And(
                                    Builders<MonitorConfiguration>.Filter.Eq(m => m.TenantId, tenantId),
                                    Builders<MonitorConfiguration>.Filter.Eq(m => m.MonitorConfigurationType, MonitorConfigurationTypes.InboundPing)
                                );
                var scope = await _access.ReadAsync(MonitorSchemas.MonitorConfiguration, filter, "HealthConfigurationRepoService.GetConfigurationListAsync");
                return scope.Granted ? await scope.Apply(_healthConfigCollection).ToListAsync() : new List<MonitorConfiguration>();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving HealthConfigurations for TenantId {TenantId}", tenantId);
                return new List<MonitorConfiguration>();
            }
        }

        public async Task<MonitorConfiguration?> GetConfigurationAsync(string itemId)
        {
            try
            {
                var filter = Builders<MonitorConfiguration>.Filter.Eq(c => c.ItemId, itemId);
                // Whole document on purpose: UpdateConfigurationAsync writes this entity back with a whole-doc replace.
                var scope = await _access.ReadAsync(MonitorSchemas.MonitorConfiguration, filter, "HealthConfigurationRepoService.GetConfigurationAsync", useProjection: false);
                return scope.Granted ? await scope.Apply(_healthConfigCollection).FirstOrDefaultAsync() : null;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving MonitorConfiguration with ItemId {ItemId}", itemId);
                return null;
            }
        }

        public async Task<bool> SaveOrUpdateConfigurationAsync(MonitorConfiguration config)
        {
            try
            {
                const string callSite = "HealthConfigurationRepoService.SaveOrUpdateConfigurationAsync";
                var filter = await _access.EditFilterAsync(MonitorSchemas.MonitorConfiguration,
                    Builders<MonitorConfiguration>.Filter.Eq(c => c.ItemId, config.ItemId), callSite);
                if (filter is null || !await _access.InsertAllowedAsync(MonitorSchemas.MonitorConfiguration, callSite))
                    throw new UnauthorizedAccessException("Access to the health configuration was denied by the data access policy.");
                await _access.PrepareUpsertAsync(MonitorSchemas.MonitorConfiguration, config, _healthConfigCollection, filter, callSite);

                var result = await _healthConfigCollection.ReplaceOneAsync(
                    filter,
                    config,
                    new ReplaceOptions { IsUpsert = true });

                return result.UpsertedId != null || result.ModifiedCount > 0;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error saving/updating MonitorConfiguration");
                throw;
            }
        }

        public async Task<bool> DeleteConfigurationAsync(string itemId)
        {
            try
            {
                var filter = await _access.DeleteFilterAsync(MonitorSchemas.MonitorConfiguration,
                    Builders<MonitorConfiguration>.Filter.Eq(c => c.ItemId, itemId), "HealthConfigurationRepoService.DeleteConfigurationAsync");
                if (filter is null) return false;
                var result = await _healthConfigCollection.DeleteOneAsync(filter);
                return result.DeletedCount > 0;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting MonitorConfiguration with ItemId {ItemId}", itemId);
                return false;
            }
        }

        public async Task<bool> UpdateConfigurationIncidentStateAsync(string configId, bool isUp, DateTime timestamp)
        {
            try
            {
                const string callSite = "HealthConfigurationRepoService.UpdateConfigurationIncidentStateAsync";
                var filter = await _access.EditFilterAsync(MonitorSchemas.MonitorConfiguration, Builders<MonitorConfiguration>.Filter.Eq(c => c.ItemId, configId), callSite);
                if (filter is null) return false;
                var update = Builders<MonitorConfiguration>.Update
                    .Set(c => c.CurrentStatus, isUp)
                    .Set(c => c.LastCheckedAt, timestamp);
                await _access.CheckUpdateAsync(MonitorSchemas.MonitorConfiguration, update, callSite);

                var result = await _healthConfigCollection.UpdateOneAsync(filter, update);
                return result.ModifiedCount > 0;
            }
            catch (Exception ex) when (ex is not DataValidationException)
            {
                _logger.LogError(ex, "Error updating incident state for MonitorConfiguration {ConfigId}", configId);
                return false;
            }
        }
    }
}
