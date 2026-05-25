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
        private readonly IMongoCollection<MonitorIncident> _incidentCollection;

        public HealthConfigurationRepoService(
            ILogger<HealthConfigurationRepoService> logger,
            IDbContextProvider dbContextProvider,
            IBlocksSecret blocksSecret)
        {
            var db = dbContextProvider.GetDatabase(blocksSecret.DatabaseConnectionString, blocksSecret.RootDatabaseName);
            
            _logger = logger;
            _healthConfigCollection = db.GetCollection<MonitorConfiguration>("MonitorConfigurations");
            _incidentCollection = db.GetCollection<MonitorIncident>("HealthIncidents");
        }

        // =====================================================
        // =============== CONFIGURATION METHODS ===============
        // =====================================================

        public async Task<List<MonitorConfiguration>> GetAllActiveConfigurationsAsync()
        {
            try
            {
                var filter = Builders<MonitorConfiguration>.Filter.And(
                    Builders<MonitorConfiguration>.Filter.Eq(m => m.IsActive, true),
                    Builders<MonitorConfiguration>.Filter.Eq(m => m.MonitorConfigurationType, MonitorConfigurationTypes.InboundPing)
                );
                return await _healthConfigCollection.Find(filter).ToListAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving active HealthConfigurations");
                return new List<MonitorConfiguration>();
            }
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

        // =====================================================
        // ================= INCIDENT METHODS =================
        // =====================================================

        public async Task<MonitorIncident?> GetActiveIncidentAsync(string configId)
        {
            try
            {
                var filter = Builders<MonitorIncident>.Filter.And(
                    Builders<MonitorIncident>.Filter.Eq(i => i.MonitorId, configId),
                    Builders<MonitorIncident>.Filter.Eq(i => i.IsResolved, false));

                return await _incidentCollection.Find(filter).FirstOrDefaultAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving active incident for MonitorConfiguration {ConfigId}", configId);
                return null;
            }
        }

        public async Task<MonitorIncident?> CreateIncidentAsync(MonitorIncident incident)
        {
            try
            {
                await _incidentCollection.InsertOneAsync(incident);
                return incident;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating MonitorIncident for ConfigId {ConfigId}", incident.MonitorId);
                return null;
            }
        }

        public async Task<bool> ResolveIncidentAsync(string configId)
        {
            try
            {
                var activeIncident = await GetActiveIncidentAsync(configId);
                if (activeIncident == null)
                    return false;

                var filter = Builders<MonitorIncident>.Filter.Eq(i => i.ItemId, activeIncident.ItemId);
                var update = Builders<MonitorIncident>.Update
                    .Set(i => i.IsResolved, true)
                    .Set(i => i.EndTime, DateTime.UtcNow);

                var result = await _incidentCollection.UpdateOneAsync(filter, update);
                return result.ModifiedCount > 0;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error resolving MonitorIncident for ConfigId {ConfigId}", configId);
                return false;
            }
        }
    }
}
