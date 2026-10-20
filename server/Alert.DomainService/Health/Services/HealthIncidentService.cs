using Microsoft.Extensions.Logging;
using MongoDB.Driver;
using Blocks.Genesis;
using DomainService.Shared.DataAccess;
using Blocks.Genesis.Entities.Monitor;
using DomainService.Alert.Services;

namespace DomainService.Health.Services
{
    public class HealthIncidentService
    {
        private readonly ILogger<HealthIncidentService> _logger;
        private readonly IMongoCollection<MonitorIncident> _incidentCollection;
        private readonly IMongoCollection<MonitorConfiguration> _healthConfigCollection;
        private readonly HealthConfigurationRepoService _healthConfigurationRepoService;
        private readonly EmailAlertService _emailAlertService;
        private readonly NotificationAlertService _notificationAlertService;
        private readonly IMonitorDataAccess _access;

        public HealthIncidentService(
            ILogger<HealthIncidentService> logger,
            IDbContextProvider dbContextProvider,
            HealthConfigurationRepoService healthConfigurationRepoService,
            EmailAlertService emailAlertService,
            NotificationAlertService notificationAlertService,
            IBlocksSecret blocksSecret,
            IMonitorDataAccess access)
        {
            _access = access;
            var db = dbContextProvider.GetDatabase(blocksSecret.DatabaseConnectionString, blocksSecret.RootDatabaseName);

            _logger = logger;
            _healthConfigurationRepoService = healthConfigurationRepoService;
            _emailAlertService = emailAlertService;
            _notificationAlertService = notificationAlertService;
            _incidentCollection = db.GetCollection<MonitorIncident>("MonitorIncidents");
            _healthConfigCollection = db.GetCollection<MonitorConfiguration>("MonitorConfigurations");
        }

        /// <summary>
        /// Creates a new incident when a monitored service is detected as DOWN.
        /// Skips if there is already an unresolved one.
        /// </summary>
        public async Task HandleIncidentAsync(string itemId)
        {
            if (string.IsNullOrEmpty(itemId))
            {
                _logger.LogWarning("[HealthCheck] HandleIncidentAsync called with empty itemId.");
                return;
            }

            var existingIncident = await FindOpenIncidentAsync(itemId, "HealthIncidentService.HandleIncidentAsync");

            if (existingIncident == null)
            {
                return;
            }

            var healthConfiguration = await _healthConfigurationRepoService.GetConfigurationAsync(itemId);
            if (healthConfiguration == null)
            {
                _logger.LogWarning("[HealthCheck] MonitorConfiguration not found for {ItemId}. Cannot resolve incident.", itemId);
                return;
            }

            await ResolveIncidentAsync(healthConfiguration);

            _logger.LogInformation("[HealthCheck] Resolved incident for {ItemId}.", itemId);
        }

        /// <summary>
        /// Creates a new incident when a monitored service is detected as DOWN.
        /// Skips if there is already an unresolved one.
        /// </summary>
        public async Task CreateIncidentAsync(MonitorConfiguration config)
        {
            if (config == null)
            {
                _logger.LogWarning("Null MonitorConfiguration provided to CreateIncidentAsync");
                return;
            }

            _logger.LogInformation("Incident triggered for {HealthName}", config.Name);

            try
            {
                _logger.LogInformation("Creating incident for {HealthName}", config.Name);

                var existingIncident = await FindOpenIncidentAsync(config.ItemId, "HealthIncidentService.CreateIncidentAsync");

                if (existingIncident is not null)
                {
                    return;
                }
                var incident = new MonitorIncident
                {
                    ItemId = Guid.NewGuid().ToString(),
                    MonitorId = config.ItemId,
                    MonitorName = config.Name,
                    MonitorUrl = config.Url,
                    MonitorConfigurationType = config.MonitorConfigurationType,
                    MonitorSourceType = config.EffectiveMonitorSourceType,
                    StartTime = DateTime.UtcNow,
                    IsResolved = false,
                    FailureReason = "No ping received",
                };

                if (!await _access.InsertAllowedAsync(MonitorSchemas.MonitorIncident, "HealthIncidentService.CreateIncidentAsync"))
                    throw new UnauthorizedAccessException("Creating a monitor incident was denied by the data access policy.");
                await _access.PrepareWriteAsync(MonitorSchemas.MonitorIncident, incident, isInsert: true, "HealthIncidentService.CreateIncidentAsync");
                await _incidentCollection.InsertOneAsync(incident);

                var update = Builders<MonitorConfiguration>.Update
                    .Set(x => x.CurrentStatus, false)
                    .Set(x => x.LastIncidentAt, DateTime.UtcNow)
                    .Set(x => x.LastCheckedAt, DateTime.UtcNow);

                await UpdateConfigurationAsync(config.ItemId, update, "HealthIncidentService.CreateIncidentAsync");
                await _notificationAlertService.HandleNotificationAlertAsync(config, incident);
                await _emailAlertService.HandleEmailAlertAsync(config, incident);
                _logger.LogInformation("Created new DOWN incident for {HealthName} ({Url})", config.Name, config.Url);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating incident for {HealthName}", config.Name);
                return;
            }
        }

        /// <summary>
        /// Marks the monitored service as UP, resolving any open incidents.
        /// </summary>
        public async Task ResolveIncidentAsync(MonitorConfiguration config)
        {
            if (config == null)
            {
                _logger.LogWarning("Null MonitorConfiguration provided to ResolveIncidentAsync");
                return;
            }

            try
            {
                _logger.LogInformation("Checking for unresolved incident for {HealthName}", config.Name);

                var openIncident = await FindOpenIncidentAsync(config.ItemId, "HealthIncidentService.ResolveIncidentAsync");

                if (openIncident == null)
                {
                    _logger.LogInformation("No unresolved incident found for {HealthName}", config.Name);
                }
                else
                {
                    var updateIncident = Builders<MonitorIncident>.Update
                        .Set(x => x.IsResolved, true)
                        .Set(x => x.EndTime, DateTime.UtcNow);

                    openIncident.IsResolved = true;
                    openIncident.EndTime = DateTime.UtcNow;

                    var incidentFilter = await _access.EditFilterAsync(MonitorSchemas.MonitorIncident,
                        Builders<MonitorIncident>.Filter.Eq(x => x.ItemId, openIncident.ItemId), "HealthIncidentService.ResolveIncidentAsync");
                    if (incidentFilter is not null)
                        await _incidentCollection.UpdateOneAsync(incidentFilter, updateIncident);
                    await _notificationAlertService.HandleNotificationAlertAsync(config, openIncident);
                    await _emailAlertService.HandleEmailAlertAsync(config, openIncident);
                    _logger.LogInformation("Resolved incident for {HealthName} ({Url})", config.Name, config.Url);
                }

                // Always mark config as UP
                var updateHealth = Builders<MonitorConfiguration>.Update
                    .Set(x => x.CurrentStatus, true)
                    .Set(x => x.LastCheckedAt, DateTime.UtcNow);

                await UpdateConfigurationAsync(config.ItemId, updateHealth, "HealthIncidentService.ResolveIncidentAsync");

            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error resolving incident for {HealthName}", config.Name);
                throw;
            }
        }

        private async Task<MonitorIncident?> FindOpenIncidentAsync(string monitorId, string callSite)
        {
            var scope = await _access.ReadAsync(MonitorSchemas.MonitorIncident,
                Builders<MonitorIncident>.Filter.Where(x => x.MonitorId == monitorId && !x.IsResolved), callSite);
            return scope.Granted ? await scope.Apply(_incidentCollection).FirstOrDefaultAsync() : null;
        }

        /// <summary>A <c>$set</c> on the configuration's status fields, behind the edit gate and its rules.</summary>
        private async Task UpdateConfigurationAsync(string configId, UpdateDefinition<MonitorConfiguration> update, string callSite)
        {
            var filter = await _access.EditFilterAsync(MonitorSchemas.MonitorConfiguration,
                Builders<MonitorConfiguration>.Filter.Eq(x => x.ItemId, configId), callSite);
            if (filter is null) return;
            await _access.CheckUpdateAsync(MonitorSchemas.MonitorConfiguration, update, callSite);
            await _healthConfigCollection.UpdateOneAsync(filter, update);
        }
    }
}
