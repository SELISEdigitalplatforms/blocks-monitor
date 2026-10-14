using Blocks.Genesis;
using DomainService.Monitor.Entity;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;
namespace DomainService.Health.Services
{
    public class HealthConfigurationRepoService
    {
        private readonly ILogger<HealthConfigurationRepoService> _logger;
        private readonly IMongoCollection<MonitorConfiguration> _healthConfigCollection;

        public HealthConfigurationRepoService(
            ILogger<HealthConfigurationRepoService> logger,
            IDbContextProvider dbContextProvider,
            IBlocksSecret blocksSecret)
        {
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
            return await _healthConfigCollection.Find(filter).ToListAsync();
        }

        public async Task<List<MonitorConfiguration>> GetConfigurationListAsync(string tenantId)
        {
            try
            {
                var filter = Builders<MonitorConfiguration>.Filter.And(
                                    Builders<MonitorConfiguration>.Filter.Eq(m => m.TenantId, tenantId),
                                    Builders<MonitorConfiguration>.Filter.Eq(m => m.MonitorConfigurationType, MonitorConfigurationTypes.InboundPing)
                                ); return await _healthConfigCollection.Find(filter).ToListAsync();
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
                return await _healthConfigCollection.Find(filter).FirstOrDefaultAsync();
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
                var filter = Builders<MonitorConfiguration>.Filter.Eq(c => c.ItemId, config.ItemId);

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
                var filter = Builders<MonitorConfiguration>.Filter.Eq(c => c.ItemId, itemId);
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
                var filter = Builders<MonitorConfiguration>.Filter.Eq(c => c.ItemId, configId);
                var update = Builders<MonitorConfiguration>.Update
                    .Set(c => c.CurrentStatus, isUp)
                    .Set(c => c.LastCheckedAt, timestamp);

                var result = await _healthConfigCollection.UpdateOneAsync(filter, update);
                return result.ModifiedCount > 0;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating incident state for MonitorConfiguration {ConfigId}", configId);
                return false;
            }
        }
    }
}
