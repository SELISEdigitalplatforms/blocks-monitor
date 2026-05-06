using Blocks.Genesis;
using DomainService.Monitor.Entity;
using DomainService.Monitor.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;

namespace DomainService.Monitor.Services
{
    public class MonitorConfigurationRepoService : IMonitorConfigurationRepoService
    {
        private readonly ILogger<MonitorConfigurationRepoService> _logger;
        private readonly IMongoCollection<MonitorConfiguration> _monitorConfigurationCollection;

        public MonitorConfigurationRepoService(ILogger<MonitorConfigurationRepoService> logger, IDbContextProvider dbContextProvider, IConfiguration configuration, IBlocksSecret blocksSecret)
        {
            var db = dbContextProvider.GetDatabase(blocksSecret.DatabaseConnectionString, blocksSecret.RootDatabaseName);

            _logger = logger;
            _monitorConfigurationCollection = db.GetCollection<MonitorConfiguration>("MonitorConfigurations");
        }

        public async Task<bool> DeleteConfigurationAsync(string itemId)
        {
            try
            {
                var filter = Builders<MonitorConfiguration>.Filter.Eq(m => m.ItemId, itemId);
                var result = await _monitorConfigurationCollection.DeleteOneAsync(filter);

                return result.DeletedCount > 0;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting MonitorConfiguration with ItemId {ItemId}", itemId);
                return false;
            }
        }

        public async Task<MonitorConfiguration?> GetConfigurationAsync(string itemId)
        {
            try
            {
                var filter = Builders<MonitorConfiguration>.Filter.Eq(m => m.ItemId, itemId);
                var monitorConfig = await _monitorConfigurationCollection.Find(filter).FirstOrDefaultAsync();

                return monitorConfig;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving MonitorConfiguration with ItemId {ItemId}", itemId);
                return null;
            }
        }

        public async Task<(List<MonitorConfiguration> Items, int TotalCount)>GetConfigurationListAsync(string tenantId, string? monitorSourceType, int pageNumber, int pageSize)
        {
            try
            {
                var fb = Builders<MonitorConfiguration>.Filter;
                FilterDefinition<MonitorConfiguration> filter;

                if (!string.IsNullOrWhiteSpace(monitorSourceType))
                {
                    if (!Enum.TryParse<MonitorSourceTypes>(monitorSourceType, true, out var parsedType))
                    {
                        _logger.LogWarning("Invalid MonitorSourceType value: {MonitorSourceType}", monitorSourceType);
                        return (new List<MonitorConfiguration>(), 0);
                    }

                    if (parsedType == MonitorSourceTypes.Infrastructure ||
                        parsedType == MonitorSourceTypes.BlocksServices)
                    {
                        filter = fb.Eq(m => m.MonitorSourcetypes, parsedType);
                    }
                    else
                    {
                        filter = fb.And(
                            fb.Eq(m => m.MonitorSourcetypes, parsedType),
                            fb.Eq(m => m.TenantId, tenantId)
                        );
                    }
                }
                else
                {
                    filter = fb.Or(
                        fb.In(m => m.MonitorSourcetypes, new[]
                        {
                    MonitorSourceTypes.Infrastructure,
                    MonitorSourceTypes.BlocksServices
                        }),

                        fb.And(
                            fb.Eq(m => m.MonitorSourcetypes, MonitorSourceTypes.DeployedServices),
                            fb.Eq(m => m.TenantId, tenantId)
                        ),

                        fb.And(
                            fb.Eq(m => m.MonitorSourcetypes, MonitorSourceTypes.ExternalServices),
                            fb.Eq(m => m.TenantId, tenantId)
                        )
                    );
                }

                pageNumber = pageNumber < 0 ? 0 : pageNumber;
                pageSize = pageSize <= 0 ? 10 : pageSize;

                var skip = pageNumber * pageSize;

                var totalCount = (int)await _monitorConfigurationCollection.CountDocumentsAsync(filter);

                var items = await _monitorConfigurationCollection
                    .Find(filter)
                    .Skip(skip)
                    .Limit(pageSize)
                    .ToListAsync();

                return (items, totalCount);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Error retrieving MonitorConfigurations for TenantId {TenantId} and MonitorSourceType {MonitorSourceType}",
                    tenantId,
                    monitorSourceType);

                return (new List<MonitorConfiguration>(), 0);
            }
        }



        public async Task<List<MonitorConfiguration>> GetConfigurationListByRepoIdAsync(string tenantId, string repoId)
        {
            try
            {
                var filter = Builders<MonitorConfiguration>.Filter.And(
                    Builders<MonitorConfiguration>.Filter.Eq(m => m.TenantId, tenantId),
                    Builders<MonitorConfiguration>.Filter.Eq(m => m.RepoId, repoId)
                );
                var monitorConfig = await _monitorConfigurationCollection.Find(filter).ToListAsync();

                return monitorConfig;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving MonitorConfigurations for TenantId {TenantId}", tenantId);
                return new List<MonitorConfiguration>();
            }
        }

        public async Task<List<MonitorConfiguration>> GetAllConfigurationListAsync()
        {
            try
            {
                var filter = Builders<MonitorConfiguration>.Filter.And(
                    Builders<MonitorConfiguration>.Filter.Eq(m => m.IsActive, true),
                    Builders<MonitorConfiguration>.Filter.Eq(m => m.MonitorConfigurationType, MonitorConfigurationTypes.OutboundPing)
                );

                var monitorConfig = await _monitorConfigurationCollection.Find(filter).ToListAsync();

                return monitorConfig;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving all MonitorConfigurations");
                return new List<MonitorConfiguration>();
            }
        }

        public async Task<bool> SaveConfigurationAsync(MonitorConfiguration monitorConfiguration)
        {
            try
            {
                var filter = Builders<MonitorConfiguration>.Filter.Eq(m => m.ItemId, monitorConfiguration.ItemId);

                var result = await _monitorConfigurationCollection.ReplaceOneAsync(
                    filter,
                    monitorConfiguration,
                    new ReplaceOptions { IsUpsert = true }  // this enables upsert
                );

                // result.UpsertedId is non-null if it was inserted
                return result.UpsertedId != null;
            }
            catch (MongoWriteException e)
            {
                _logger.LogError(e, "Error saving MonitorConfiguration");
                return false;
            }
        }


        public async Task<bool> UpdateConfigurationAsync(MonitorConfiguration monitorConfiguration)
        {
            try
            {
                var filter = Builders<MonitorConfiguration>.Filter.Eq(m => m.ItemId, monitorConfiguration.ItemId);
                var result = await _monitorConfigurationCollection.ReplaceOneAsync(filter, monitorConfiguration, new ReplaceOptions { IsUpsert = false });

                return result.ModifiedCount > 0;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating MonitorConfiguration with ItemId {ItemId}", monitorConfiguration.ItemId);
                return false;
            }
        }

        public async Task<bool> UpdateConfigurationIncidentAsync(MonitorConfigurationIncidentUpdate monitorConfigurationUpdate)
        {
            try
            {
                var filter = Builders<MonitorConfiguration>.Filter.Eq(m => m.ItemId, monitorConfigurationUpdate.MonitorId);

                var update = Builders<MonitorConfiguration>.Update
                    .Set(m => m.LastIncidentAt, monitorConfigurationUpdate.LastIncidentAt)
                    .Set(m => m.CurrentStatus, monitorConfigurationUpdate.CurrentStatus);

                var result = await _monitorConfigurationCollection.UpdateOneAsync(filter, update);

                return result.ModifiedCount > 0;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Error updating incident fields for MonitorConfiguration with ItemId {MonitorId}",
                    monitorConfigurationUpdate.MonitorId);
                return false;
            }
        }

        public async Task<List<MonitorConfiguration>> GetConfigurationListByTenantIdAsync(string tenantId)
        {
            try
            {
                var filter = Builders<MonitorConfiguration>.Filter.Eq(m => m.TenantId, tenantId);

                var monitorConfigs = await _monitorConfigurationCollection
                    .Find(filter)
                    .ToListAsync();

                return monitorConfigs;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Error retrieving MonitorConfigurations for TenantId {TenantId}",
                    tenantId);

                return new List<MonitorConfiguration>();
            }
        }

        public async Task<MonitorConfiguration> GetByUrlAsync(string url)
        {
            var filter = Builders<MonitorConfiguration>.Filter.Eq(m => m.Url, url);
            return await _monitorConfigurationCollection.Find(filter).FirstOrDefaultAsync();
        }

        public async Task<MonitorConfiguration?> GetExternalServiceConfigurationAsync(string externalServiceId)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(externalServiceId))
                    return null;

                var filter = Builders<MonitorConfiguration>.Filter.And(
                    Builders<MonitorConfiguration>.Filter.Eq(m => m.MonitorSourcetypes, MonitorSourceTypes.ExternalServices),
                    Builders<MonitorConfiguration>.Filter.Eq(m => m.ExternalServiceId, externalServiceId)
                );

                return await _monitorConfigurationCollection
                    .Find(filter)
                    .FirstOrDefaultAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Error retrieving MonitorConfiguration for ExternalServiceId {ExternalServiceId}",
                    externalServiceId);

                return null;
            }
        }
    }
}
