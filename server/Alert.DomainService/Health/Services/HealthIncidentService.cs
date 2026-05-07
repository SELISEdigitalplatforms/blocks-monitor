using Microsoft.Extensions.Logging;
using MongoDB.Driver;
using Blocks.Genesis;
using DomainService.Monitor.Entity;
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

        public HealthIncidentService(
            ILogger<HealthIncidentService> logger,
            IDbContextProvider dbContextProvider,
            HealthConfigurationRepoService healthConfigurationRepoService,
            EmailAlertService emailAlertService,
            NotificationAlertService notificationAlertService,
            IBlocksSecret blocksSecret)
        {
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

            var existingIncident = await _incidentCollection
                .Find(x => x.MonitorId == itemId && !x.IsResolved)
                .FirstOrDefaultAsync();

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

                var existingIncident = await _incidentCollection
                .Find(x => x.MonitorId == config.ItemId && !x.IsResolved)
                .FirstOrDefaultAsync();

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
                    MonitorSourcetypes = config.MonitorSourcetypes,
                    StartTime = DateTime.UtcNow,
                    IsResolved = false,
                    FailureReason = "No ping received",
                };

                await _incidentCollection.InsertOneAsync(incident);

                var update = Builders<MonitorConfiguration>.Update
                    .Set(x => x.CurrentStatus, false)
                    .Set(x => x.LastIncidentAt, DateTime.UtcNow)
                    .Set(x => x.LastCheckedAt, DateTime.UtcNow);

                await _healthConfigCollection.UpdateOneAsync(x => x.ItemId == config.ItemId, update);
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

                var openIncident = await _incidentCollection
                    .Find(x => x.MonitorId == config.ItemId && !x.IsResolved)
                    .FirstOrDefaultAsync();

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

                    await _incidentCollection.UpdateOneAsync(x => x.ItemId == openIncident.ItemId, updateIncident);
                    await _notificationAlertService.HandleNotificationAlertAsync(config, openIncident);
                    await _emailAlertService.HandleEmailAlertAsync(config, openIncident);
                    _logger.LogInformation("Resolved incident for {HealthName} ({Url})", config.Name, config.Url);
                }

                // Always mark config as UP
                var updateHealth = Builders<MonitorConfiguration>.Update
                    .Set(x => x.CurrentStatus, true)
                    .Set(x => x.LastCheckedAt, DateTime.UtcNow);

                await _healthConfigCollection.UpdateOneAsync(x => x.ItemId == config.ItemId, updateHealth);

            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error resolving incident for {HealthName}", config.Name);
                throw;
            }
        }
    }
}
