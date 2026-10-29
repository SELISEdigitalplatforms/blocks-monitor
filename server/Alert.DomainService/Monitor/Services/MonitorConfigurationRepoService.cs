using System.Linq;
using Blocks.Genesis;
using Blocks.Genesis.DataAccess.Rules;
using DomainService.Shared.DataAccess;
using DomainService.AlertRecipients.Models;
using Blocks.Genesis.Entities.Monitor;
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
        private readonly IMonitorDataAccess _access;

        public MonitorConfigurationRepoService(ILogger<MonitorConfigurationRepoService> logger, IDbContextProvider dbContextProvider, IConfiguration configuration, IBlocksSecret blocksSecret, IMonitorDataAccess access)
        {
            var db = dbContextProvider.GetDatabase(blocksSecret.DatabaseConnectionString, blocksSecret.RootDatabaseName);

            _logger = logger;
            _access = access;
            _monitorConfigurationCollection = db.GetCollection<MonitorConfiguration>("MonitorConfigurations");
        }

        public async Task<bool> DeleteConfigurationAsync(string itemId)
        {
            try
            {
                var filter = await _access.DeleteFilterAsync(MonitorSchemas.MonitorConfiguration,
                    Builders<MonitorConfiguration>.Filter.Eq(m => m.ItemId, itemId), "MonitorConfigurationRepoService.DeleteConfigurationAsync");
                if (filter is null) return false;
                var result = await _monitorConfigurationCollection.DeleteOneAsync(filter);

                return result.DeletedCount > 0;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error deleting MonitorConfiguration with ItemId {ItemId}", itemId);
                return false;
            }
        }

        public async Task<MonitorConfiguration?> GetConfigurationForViewAsync(string itemId)
        {
            try
            {
                var filter = Builders<MonitorConfiguration>.Filter.Eq(m => m.ItemId, itemId);
                // Masked: View column (property) rules clear what the caller may not see. Never save it back.
                var scope = await _access.ReadAsync(MonitorSchemas.MonitorConfiguration, filter, "MonitorConfigurationRepoService.GetConfigurationForViewAsync");
                if (!scope.Granted) return null;
                return scope.ForView(await scope.Apply(_monitorConfigurationCollection).FirstOrDefaultAsync());
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving MonitorConfiguration with ItemId {ItemId}", itemId);
                return null;
            }
        }

        public async Task<MonitorConfiguration?> GetConfigurationAsync(string itemId)
        {
            try
            {
                var filter = Builders<MonitorConfiguration>.Filter.Eq(m => m.ItemId, itemId);
                // Whole document on purpose: the update flow writes this entity back with a whole-doc replace.
                var scope = await _access.ReadAsync(MonitorSchemas.MonitorConfiguration, filter, "MonitorConfigurationRepoService.GetConfigurationAsync", useProjection: false);
                if (!scope.Granted) return null;
                var monitorConfig = await scope.Apply(_monitorConfigurationCollection).FirstOrDefaultAsync();

                return monitorConfig;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving MonitorConfiguration with ItemId {ItemId}", itemId);
                return null;
            }
        }

        public async Task<(List<MonitorConfiguration> Items, int TotalCount)>GetConfigurationListAsync(string tenantId, string? monitorSourceType, int pageNumber, int pageSize, string? sortProperty = null, bool sortIsDescending = false)
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

                    var sourceTypeFilter = fb.Or(
                        fb.Eq(m => m.MonitorSourceType, parsedType),
                        fb.Eq(m => m.LegacyMonitorSourceType, parsedType)
                    );

                    if (parsedType == MonitorSourceTypes.Infrastructure ||
                        parsedType == MonitorSourceTypes.BlocksServices)
                    {
                        filter = sourceTypeFilter;
                    }
                    else
                    {
                        filter = fb.And(
                            sourceTypeFilter,
                            fb.Eq(m => m.TenantId, tenantId)
                        );
                    }
                }
                else
                {
                    var tenantScopedTypes = new[]
                    {
                        MonitorSourceTypes.DeployedServices,
                        MonitorSourceTypes.ExternalServices,
                        MonitorSourceTypes.OtherServices,
                    };
                    var tenantScopedTypesNullable = tenantScopedTypes
                        .Select(type => (MonitorSourceTypes?)type)
                        .ToArray();

                    filter = fb.Or(
                        fb.Eq(m => m.MonitorSourceType, MonitorSourceTypes.Infrastructure),
                        fb.Eq(m => m.LegacyMonitorSourceType, MonitorSourceTypes.Infrastructure),

                        fb.And(
                            fb.Or(
                                fb.In(m => m.MonitorSourceType, tenantScopedTypesNullable),
                                fb.In(m => m.LegacyMonitorSourceType, tenantScopedTypesNullable)
                            ),
                            fb.Eq(m => m.TenantId, tenantId)
                        )
                    );
                }

                pageNumber = pageNumber < 0 ? 0 : pageNumber;
                pageSize = pageSize <= 0 ? 10 : pageSize;

                var skip = pageNumber * pageSize;

                var scope = await _access.ReadAsync(MonitorSchemas.MonitorConfiguration, filter, "MonitorConfigurationRepoService.GetConfigurationListAsync");
                if (!scope.Granted) return (new List<MonitorConfiguration>(), 0);

                var totalCount = (int)await _monitorConfigurationCollection.CountDocumentsAsync(scope.Filter);

                var sort = BuildSortDefinition(monitorSourceType, sortProperty, sortIsDescending);

                var items = await scope.Apply(_monitorConfigurationCollection)
                    .Sort(sort)
                    .Skip(skip)
                    .Limit(pageSize)
                    .ToListAsync();

                // The API lists these: View column (property) rules clear what the caller may not see.
                return (scope.ForView(items), totalCount);
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

        private static SortDefinition<MonitorConfiguration> BuildSortDefinition(
            string? monitorSourceType,
            string? sortProperty,
            bool sortIsDescending)
        {
            var sortBuilder = Builders<MonitorConfiguration>.Sort;
            var direction = sortIsDescending
                ? SortDirection.Descending
                : SortDirection.Ascending;

            return (sortProperty ?? string.Empty).ToLowerInvariant() switch
            {
                "monitor_type" => direction == SortDirection.Descending
                    ? sortBuilder.Descending(x => x.MonitorConfigurationType)
                    : sortBuilder.Ascending(x => x.MonitorConfigurationType),
                "url" => direction == SortDirection.Descending
                    ? sortBuilder.Descending(x => x.Url)
                    : sortBuilder.Ascending(x => x.Url),
                "tagged_service" => BuildTaggedServiceSort(sortBuilder, monitorSourceType, direction),
                "uptime" => direction == SortDirection.Descending
                    ? sortBuilder.Descending(x => x.LastIncidentAt)
                    : sortBuilder.Ascending(x => x.LastIncidentAt),
                "status" => direction == SortDirection.Descending
                    ? sortBuilder.Descending(x => x.CurrentStatus)
                    : sortBuilder.Ascending(x => x.CurrentStatus),
                _ => direction == SortDirection.Descending
                    ? sortBuilder.Descending(x => x.Name)
                    : sortBuilder.Ascending(x => x.Name),
            };
        }

        private static SortDefinition<MonitorConfiguration> BuildTaggedServiceSort(
            SortDefinitionBuilder<MonitorConfiguration> sortBuilder,
            string? monitorSourceType,
            SortDirection direction)
        {
            if (string.Equals(monitorSourceType, MonitorSourceTypes.DeployedServices.ToString(), StringComparison.OrdinalIgnoreCase))
            {
                return direction == SortDirection.Descending
                    ? sortBuilder.Descending(x => x.RepoName)
                    : sortBuilder.Ascending(x => x.RepoName);
            }

            if (string.Equals(monitorSourceType, MonitorSourceTypes.ExternalServices.ToString(), StringComparison.OrdinalIgnoreCase))
            {
                return direction == SortDirection.Descending
                    ? sortBuilder.Descending(x => x.ExternalServiceName)
                    : sortBuilder.Ascending(x => x.ExternalServiceName);
            }

            return direction == SortDirection.Descending
                ? sortBuilder.Descending(x => x.RepoName)
                : sortBuilder.Ascending(x => x.RepoName);
        }



        public async Task<List<MonitorConfiguration>> GetConfigurationListByRepoIdAsync(string tenantId, string repoId)
        {
            try
            {
                var filter = Builders<MonitorConfiguration>.Filter.And(
                    Builders<MonitorConfiguration>.Filter.Eq(m => m.TenantId, tenantId),
                    Builders<MonitorConfiguration>.Filter.Eq(m => m.RepoId, repoId)
                );
                var scope = await _access.ReadAsync(MonitorSchemas.MonitorConfiguration, filter, "MonitorConfigurationRepoService.GetConfigurationListByRepoIdAsync");
                if (!scope.Granted) return new List<MonitorConfiguration>();
                var monitorConfig = await scope.Apply(_monitorConfigurationCollection).ToListAsync();

                // The API lists these: View column (property) rules clear what the caller may not see.
                return scope.ForView(monitorConfig);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving MonitorConfigurations for TenantId {TenantId}", tenantId);
                return new List<MonitorConfiguration>();
            }
        }

        public async Task<List<MonitorConfiguration>> GetAllConfigurationListAsync()
        {
            // Read failures propagate: an unavailable root database is not an empty configuration
            // set, and the scheduler would otherwise remove every cached monitor until the next
            // successful poll. The polling loop logs and handles the failure.
            var filter = Builders<MonitorConfiguration>.Filter.And(
                Builders<MonitorConfiguration>.Filter.Eq(m => m.IsActive, true),
                Builders<MonitorConfiguration>.Filter.Eq(m => m.MonitorConfigurationType, MonitorConfigurationTypes.OutboundPing)
            );

            var scope = await _access.ReadAsync(MonitorSchemas.MonitorConfiguration, filter, "MonitorConfigurationRepoService.GetAllConfigurationListAsync");
            var monitorConfig = scope.Granted ? await scope.Apply(_monitorConfigurationCollection).ToListAsync() : new List<MonitorConfiguration>();
            _logger.LogInformation(
                "Retrieved {Count} active OutboundPing MonitorConfigurations from database.",
                monitorConfig.Count);
            return monitorConfig;
        }

        public async Task<bool> SaveConfigurationAsync(MonitorConfiguration monitorConfiguration)
        {
            try
            {
                const string callSite = "MonitorConfigurationRepoService.SaveConfigurationAsync";
                var filter = await _access.EditFilterAsync(MonitorSchemas.MonitorConfiguration,
                    Builders<MonitorConfiguration>.Filter.Eq(m => m.ItemId, monitorConfiguration.ItemId), callSite);
                if (filter is null || !await _access.InsertAllowedAsync(MonitorSchemas.MonitorConfiguration, callSite))
                    throw new UnauthorizedAccessException("Access to the monitor configuration was denied by the data access policy.");
                await _access.PrepareUpsertAsync(MonitorSchemas.MonitorConfiguration, monitorConfiguration, _monitorConfigurationCollection, filter, callSite);

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
                const string callSite = "MonitorConfigurationRepoService.UpdateConfigurationAsync";
                var filter = await _access.EditFilterAsync(MonitorSchemas.MonitorConfiguration,
                    Builders<MonitorConfiguration>.Filter.Eq(m => m.ItemId, monitorConfiguration.ItemId), callSite);
                if (filter is null) return false;
                await _access.PrepareReplaceAsync(MonitorSchemas.MonitorConfiguration, monitorConfiguration, _monitorConfigurationCollection, filter, callSite);
                var result = await _monitorConfigurationCollection.ReplaceOneAsync(filter, monitorConfiguration, new ReplaceOptions { IsUpsert = false });

                return result.ModifiedCount > 0;
            }
            catch (Exception ex) when (ex is not DataValidationException)
            {
                _logger.LogError(ex, "Error updating MonitorConfiguration with ItemId {ItemId}", monitorConfiguration.ItemId);
                return false;
            }
        }

        public async Task<bool> UpdateConfigurationIncidentAsync(MonitorConfigurationIncidentUpdate monitorConfigurationUpdate)
        {
            try
            {
                const string callSite = "MonitorConfigurationRepoService.UpdateConfigurationIncidentAsync";
                var filter = await _access.EditFilterAsync(MonitorSchemas.MonitorConfiguration,
                    Builders<MonitorConfiguration>.Filter.Eq(m => m.ItemId, monitorConfigurationUpdate.MonitorId), callSite);
                if (filter is null) return false;

                var update = Builders<MonitorConfiguration>.Update
                    .Set(m => m.LastIncidentAt, monitorConfigurationUpdate.LastIncidentAt)
                    .Set(m => m.CurrentStatus, monitorConfigurationUpdate.CurrentStatus);
                await _access.CheckUpdateAsync(MonitorSchemas.MonitorConfiguration, update, callSite);

                var result = await _monitorConfigurationCollection.UpdateOneAsync(filter, update);

                return result.ModifiedCount > 0;
            }
            catch (Exception ex) when (ex is not DataValidationException)
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

                var scope = await _access.ReadAsync(MonitorSchemas.MonitorConfiguration, filter, "MonitorConfigurationRepoService.GetConfigurationListByTenantIdAsync");
                if (!scope.Granted) return new List<MonitorConfiguration>();
                var monitorConfigs = await scope.Apply(_monitorConfigurationCollection).ToListAsync();

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
            var scope = await _access.ReadAsync(MonitorSchemas.MonitorConfiguration, filter, "MonitorConfigurationRepoService.GetByUrlAsync");
            return scope.Granted ? await scope.Apply(_monitorConfigurationCollection).FirstOrDefaultAsync() : null!;
        }

        public async Task<MonitorConfiguration?> GetExternalServiceConfigurationAsync(string externalServiceId)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(externalServiceId))
                    return null;

                var filter = Builders<MonitorConfiguration>.Filter.And(
                    Builders<MonitorConfiguration>.Filter.Or(
                        Builders<MonitorConfiguration>.Filter.Eq(m => m.MonitorSourceType, MonitorSourceTypes.ExternalServices),
                        Builders<MonitorConfiguration>.Filter.Eq(m => m.LegacyMonitorSourceType, MonitorSourceTypes.ExternalServices)
                    ),
                    Builders<MonitorConfiguration>.Filter.Eq(m => m.ExternalServiceId, externalServiceId)
                );

                var scope = await _access.ReadAsync(MonitorSchemas.MonitorConfiguration, filter, "MonitorConfigurationRepoService.GetExternalServiceConfigurationAsync");
                if (!scope.Granted) return null;
                // Returned to the API caller: View column (property) rules clear what the caller may not see.
                return scope.ForView(await scope.Apply(_monitorConfigurationCollection).FirstOrDefaultAsync());
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Error retrieving MonitorConfiguration for ExternalServiceId {ExternalServiceId}",
                    externalServiceId);

                return null;
            }
        }

        // ---------------------------------------------------------------- //
        // Alert recipients                                                  //
        // ---------------------------------------------------------------- //

        private static readonly MonitorSourceTypes?[] NotEditableSourceTypes =
            { MonitorSourceTypes.Infrastructure, MonitorSourceTypes.BlocksServices };

        /// <summary>
        /// The fields the Alert recipients page needs. The legacy <c>MonitorSourcetypes</c> element and <c>TenantId</c>
        /// are included so a projected legacy Blocks-services monitor still computes as not editable.
        /// </summary>
        public static readonly ProjectionDefinition<MonitorConfiguration> AlertRecipientsViewProjection =
            Builders<MonitorConfiguration>.Projection
                .Include(m => m.ItemId)
                .Include(m => m.Name)
                .Include(m => m.MonitorConfigurationType)
                .Include(m => m.MonitorSourceType)
                .Include(m => m.LegacyMonitorSourceType)
                .Include(m => m.TenantId)
                .Include(m => m.IsActive)
                .Include(m => m.Emails);

        /// <summary>
        /// Editable monitors of <paramref name="tenantId"/>. <c>EffectiveMonitorSourceType</c> is not stored, so its
        /// precedence is spelled out: <c>MonitorSourceType</c> is not Infrastructure/BlocksServices (a missing or null
        /// value passes <c>$nin</c>), and when it is null the legacy <c>MonitorSourcetypes</c> is not either.
        /// </summary>
        public static FilterDefinition<MonitorConfiguration> EditableMonitorsFilter(string tenantId)
        {
            var fb = Builders<MonitorConfiguration>.Filter;
            return fb.And(
                fb.Eq(m => m.TenantId, tenantId),
                fb.Nin(m => m.MonitorSourceType, NotEditableSourceTypes),
                fb.Not(fb.And(
                    fb.Eq(m => m.MonitorSourceType, null),
                    fb.In(m => m.LegacyMonitorSourceType, NotEditableSourceTypes))));
        }

        /// <summary>
        /// The write filter of one update: the request's EDIT row filter, the monitor, and its Emails exactly as read.
        /// An empty read list also matches a missing or null field, so such monitors don't always conflict.
        /// </summary>
        public static FilterDefinition<MonitorConfiguration> EmailsUpdateFilter(MonitorEmailsUpdate update, FilterDefinition<MonitorConfiguration> editFilter)
        {
            var fb = Builders<MonitorConfiguration>.Filter;
            var previous = update.PreviousEmails is { Count: > 0 }
                ? fb.Eq(m => m.Emails, update.PreviousEmails.ToList())
                : fb.Or(
                    fb.Eq(m => m.Emails, new List<string>()),
                    fb.Exists(m => m.Emails, false),
                    fb.Eq(m => m.Emails, null));
            return fb.And(editFilter, fb.Eq(m => m.ItemId, update.ItemId), previous);
        }

        /// <summary><c>$set</c> only: Emails and the audit fields. Nothing else on the monitor is written.</summary>
        public static UpdateDefinition<MonitorConfiguration> EmailsUpdateDefinition(MonitorEmailsUpdate update) =>
            Builders<MonitorConfiguration>.Update
                .Set(m => m.Emails, update.NewEmails)
                .Set(m => m.LastUpdatedDate, update.UpdatedAt)
                .Set(m => m.LastUpdatedBy, update.UpdatedBy);

        public async Task<List<MonitorConfiguration>> GetEditableMonitorsForViewAsync(string tenantId)
        {
            var scope = await _access.ReadAsync(MonitorSchemas.MonitorConfiguration, EditableMonitorsFilter(tenantId),
                "MonitorConfigurationRepoService.GetEditableMonitorsForViewAsync");
            if (!scope.Granted) return new List<MonitorConfiguration>();

            // The resolver's projection wins when there is one, so columns hidden from the caller stay hidden.
            var items = scope.Projection is null
                ? await _monitorConfigurationCollection.Find(scope.Filter).Project<MonitorConfiguration>(AlertRecipientsViewProjection).ToListAsync()
                : await scope.Apply(_monitorConfigurationCollection).ToListAsync();
            return scope.ForView(items);
        }

        public async Task<List<MonitorConfiguration>> GetEditableMonitorsAsync(string tenantId, IReadOnlyCollection<string>? itemIds = null)
        {
            var filter = EditableMonitorsFilter(tenantId);
            if (itemIds is not null)
                filter = Builders<MonitorConfiguration>.Filter.And(filter, Builders<MonitorConfiguration>.Filter.In(m => m.ItemId, itemIds));
            // Whole documents: the write compares and rewrites the stored Emails list.
            var scope = await _access.ReadAsync(MonitorSchemas.MonitorConfiguration, filter,
                "MonitorConfigurationRepoService.GetEditableMonitorsAsync", useProjection: false);
            return scope.Granted ? await scope.Apply(_monitorConfigurationCollection).ToListAsync() : new List<MonitorConfiguration>();
        }

        public async Task<List<MonitorConfiguration>> GetEditableMonitorsMissingPeopleAsync(string tenantId, IReadOnlyCollection<string> people)
        {
            var fb = Builders<MonitorConfiguration>.Filter;
            var filter = fb.And(EditableMonitorsFilter(tenantId), fb.Not(fb.All(m => m.Emails, people)));
            var scope = await _access.ReadAsync(MonitorSchemas.MonitorConfiguration, filter,
                "MonitorConfigurationRepoService.GetEditableMonitorsMissingPeopleAsync", useProjection: false);
            return scope.Granted ? await scope.Apply(_monitorConfigurationCollection).ToListAsync() : new List<MonitorConfiguration>();
        }

        public Task<FilterDefinition<MonitorConfiguration>?> GetEmailsEditFilterAsync(string tenantId) =>
            // No ItemId $in here: the filter is ANDed into every UpdateOne, which adds its own ItemId, so an id list
            // would be repeated in each of up to 500 filters (review m3). Same rows, a fraction of the payload.
            _access.EditFilterAsync(MonitorSchemas.MonitorConfiguration,
                Builders<MonitorConfiguration>.Filter.Eq(m => m.TenantId, tenantId),
                "MonitorConfigurationRepoService.GetEmailsEditFilterAsync");

        public async Task<IReadOnlyList<MonitorEmailsCheckFailure>> CheckEmailsUpdatesAsync(IReadOnlyList<MonitorEmailsUpdate> updates)
        {
            const string callSite = "MonitorConfigurationRepoService.CheckEmailsUpdatesAsync";
            // The resolver caches nothing, so each check costs several tenant-DB reads: run them side by side, bounded.
            var failures = new MonitorEmailsCheckFailure?[updates.Count];
            await Parallel.ForEachAsync(Enumerable.Range(0, updates.Count),
                new ParallelOptions { MaxDegreeOfParallelism = AlertRecipientRules.CheckParallelism },
                async (index, _) =>
                {
                    try
                    {
                        await _access.CheckUpdateAsync(MonitorSchemas.MonitorConfiguration, EmailsUpdateDefinition(updates[index]), callSite);
                    }
                    catch (DataValidationException ex)
                    {
                        failures[index] = new MonitorEmailsCheckFailure(updates[index].ItemId, ex);
                    }
                });
            return failures.OfType<MonitorEmailsCheckFailure>().ToList();
        }

        public async Task<long> BulkUpdateEmailsAsync(IReadOnlyList<MonitorEmailsUpdate> updates, FilterDefinition<MonitorConfiguration> editFilter)
        {
            if (updates.Count == 0) return 0;
            var models = updates
                .Select(u => (WriteModel<MonitorConfiguration>)new UpdateOneModel<MonitorConfiguration>(EmailsUpdateFilter(u, editFilter), EmailsUpdateDefinition(u)))
                .ToList();
            long matched;
            int writeErrors;
            try
            {
                var result = await _monitorConfigurationCollection.BulkWriteAsync(models, new BulkWriteOptions { IsOrdered = false });
                return result.MatchedCount;
            }
            catch (MongoBulkWriteException<MonitorConfiguration> ex)
            {
                // Unordered: the other updates still ran. The failed ones are found by the caller's re-read.
                // Per C20 only counts leave the catch, because a write error's errInfo can quote the new Emails values.
                matched = ex.Result.MatchedCount;
                writeErrors = ex.WriteErrors.Count;
            }

            _logger.LogError("Bulk update of monitor alert recipients had {Count} write errors ({ErrorType}).",
                writeErrors, nameof(MongoBulkWriteException));
            return matched;
        }

        public async Task<bool> UpdateEmailsAsync(MonitorEmailsUpdate update, FilterDefinition<MonitorConfiguration> editFilter)
        {
            var result = await _monitorConfigurationCollection.UpdateOneAsync(EmailsUpdateFilter(update, editFilter), EmailsUpdateDefinition(update));
            return result.MatchedCount > 0;
        }
    }
}
