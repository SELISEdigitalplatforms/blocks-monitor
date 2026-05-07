using System.Globalization;
using Blocks.Genesis;
using DomainService.Monitor.Entity;
using DomainService.Monitor.Models;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;

namespace DomainService.Monitor.MonitorIncidentService
{
    public class MonitorIncidentRepoService : IMonitorIncidentRepoService
    {
        private readonly ILogger<MonitorIncidentRepoService> _logger;
        private readonly IMongoCollection<MonitorIncident> _monitorIncidentsCollection;

        public MonitorIncidentRepoService(
            ILogger<MonitorIncidentRepoService> logger,
            IDbContextProvider dbContextProvider,
            IBlocksSecret blocksSecret)
        {
            var db = dbContextProvider.GetDatabase(blocksSecret.DatabaseConnectionString, blocksSecret.RootDatabaseName);

            _logger = logger;
            _monitorIncidentsCollection = db.GetCollection<MonitorIncident>("MonitorIncidents");
        }

        public async Task<MonitorIncident?> GetActiveIncidentAsync(string monitorId)
        {
            try
            {
                var filter = Builders<MonitorIncident>.Filter.And(
                    Builders<MonitorIncident>.Filter.Eq(i => i.MonitorId, monitorId),
                    Builders<MonitorIncident>.Filter.Eq(i => i.IsResolved, false)
                );
                return await _monitorIncidentsCollection.Find(filter).FirstOrDefaultAsync();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error retrieving active incident for MonitorId {MonitorId}", monitorId);
                return null;
            }
        }

        public async Task CreateIncidentAsync(MonitorIncident incident)
        {
            try
            {
                await _monitorIncidentsCollection.InsertOneAsync(incident);
                _logger.LogInformation("Created new incident for MonitorId {MonitorId}", incident.MonitorId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error creating incident for MonitorId {MonitorId}", incident.MonitorId);
            }
        }

        public async Task UpdateIncidentAsync(MonitorIncident incident)
        {
            try
            {
                var filter = Builders<MonitorIncident>.Filter.Eq(i => i.ItemId, incident.ItemId);
                await _monitorIncidentsCollection.ReplaceOneAsync(filter, incident, new ReplaceOptions { IsUpsert = false });
                _logger.LogInformation("Updated incident {IncidentId} for MonitorId {MonitorId}", incident.ItemId, incident.MonitorId);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error updating incident {IncidentId} for MonitorId {MonitorId}", incident.ItemId, incident.MonitorId);
            }
        }

        public async Task<int> GetIncidentCountByMonitorIdAsync(MonitorConfiguration monitor)
        {
            try
            {
                var filter = Builders<MonitorIncident>.Filter.Eq(i => i.MonitorId, monitor.ItemId);

                var totalCount = await _monitorIncidentsCollection.CountDocumentsAsync(filter);

                _logger.LogInformation("Total {Count} incidents found for MonitorId {MonitorId}", totalCount, monitor.ItemId);

                return (int)totalCount;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error counting incidents for MonitorId {MonitorId}", monitor.ItemId);
                return 0;
            }
        }


        public async Task<List<MonitorIncident>> GetIncidentsByMonitorIdAsync(MonitorConfiguration monitor, int pageNumber, int pageSize)
        {
            try
            {
                var filter = Builders<MonitorIncident>.Filter.Eq(i => i.MonitorId, monitor.ItemId);

                var incidents = await _monitorIncidentsCollection
                    .Find(filter)
                    .SortByDescending(i => i.StartTime)
                    .Skip((pageNumber - 1) * pageSize)
                    .Limit(pageSize)
                    .ToListAsync();

                _logger.LogInformation("Fetched {Count} incidents for MonitorId {MonitorId}", incidents.Count, monitor.ItemId);

                return incidents;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching incidents for MonitorId {MonitorId}", monitor.ItemId);
                return new List<MonitorIncident>();
            }
        }


        public async Task<int> GetIncidentsDurationByDateRangeAsync(string monitorId, DateTime startTime, DateTime endTime)
        {
            try
            {
                var filter = Builders<MonitorIncident>.Filter.And(
                    Builders<MonitorIncident>.Filter.Eq(i => i.MonitorId, monitorId),
                    Builders<MonitorIncident>.Filter.Gte(i => i.StartTime, startTime),
                    Builders<MonitorIncident>.Filter.Lte(i => i.StartTime, endTime)
                );

                var aggregate = _monitorIncidentsCollection.Aggregate()
                    .Match(filter)
                    .Project(new BsonDocument
                    {
                { "durationMs",
                    new BsonDocument("$cond", new BsonArray {
                        new BsonDocument("$ifNull", new BsonArray { "$EndTime", false }),
                        new BsonDocument("$subtract", new BsonArray { "$EndTime", "$StartTime" }),
                        new BsonDocument("$subtract", new BsonArray { DateTime.UtcNow, "$StartTime" })
                    })
                }
                    })
                    .Group(new BsonDocument
                    {
                { "_id", BsonNull.Value },
                { "totalDurationMs", new BsonDocument("$sum", "$durationMs") }
                    });

                var result = await aggregate.FirstOrDefaultAsync();

                var totalDurationMs = result?["totalDurationMs"].ToInt64() ?? 0;

                _logger.LogInformation(
                    "Aggregated total downtime {Duration} ms for MonitorId {MonitorId} between {Start} and {End}",
                    totalDurationMs, monitorId, startTime, endTime);

                return (int)totalDurationMs;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex,
                    "Error aggregating downtime duration for MonitorId {MonitorId} between {Start} and {End}",
                    monitorId, startTime, endTime);

                return 0;
            }
        }

        private static BsonArray BuildDowntimeFacetPipeline(DateTime rangeStart) => new BsonArray
        {
            new BsonDocument("$match", new BsonDocument("StartTime", new BsonDocument("$gte", rangeStart))),
            new BsonDocument("$project", new BsonDocument("durationMs", new BsonDocument("$cond", new BsonArray
            {
                new BsonDocument("$ne", new BsonArray { "$EndTime", BsonNull.Value }),
                new BsonDocument("$subtract", new BsonArray { "$EndTime", "$StartTime" }),
                new BsonDocument("$subtract", new BsonArray { "$$NOW", "$StartTime" })
            })))
            ,
            new BsonDocument("$group", new BsonDocument { { "_id", BsonNull.Value }, { "totalDurationMs", new BsonDocument("$sum", "$durationMs") } })
        };

        public async Task<Dictionary<string, long>> GetDowntimeByMultipleRangesAsync(string monitorId)
        {
            try
            {
                var now = DateTime.UtcNow;
                var ranges = new Dictionary<string, DateTime>
                {
                    { "last7Days", now.AddDays(-7) },
                    { "last30Days", now.AddDays(-30) },
                    { "last365Days", now.AddDays(-365) }
                };

                        var match = new BsonDocument("$match", new BsonDocument { { "MonitorId", monitorId } });

                        var facet = new BsonDocument("$facet", new BsonDocument
                        {
                            { "last7Days",   BuildDowntimeFacetPipeline(ranges["last7Days"]) },
                            { "last30Days",  BuildDowntimeFacetPipeline(ranges["last30Days"]) },
                            { "last365Days", BuildDowntimeFacetPipeline(ranges["last365Days"]) }
                        });

                        var pipeline = new[] { match, facet };
                        var result = await _monitorIncidentsCollection.Aggregate<BsonDocument>(pipeline).FirstOrDefaultAsync();

                        return ranges.Keys.ToDictionary(
                            k => k,
                            k => result[k].AsBsonArray.FirstOrDefault()?["totalDurationMs"].ToInt64() ?? 0
                        );
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching downtime for multiple ranges for monitor {MonitorId}", monitorId);
                return new Dictionary<string, long>
                {
                    { "last7Days", 0 },
                    { "last30Days", 0 },
                    { "last365Days", 0 }
                };
            }
        }


        public async Task<Dictionary<string, (long TotalDurationMs, long IncidentCount)>> GetDowntimeAndCountByDateRangesAsync(string monitorId, Dictionary<string, int> rangesInDays)
        {
            try
            {
                var now = DateTime.UtcNow;

                var facetDoc = new BsonDocument();
                foreach (var kvp in rangesInDays)
                {
                    string rangeName = kvp.Key;
                    DateTime rangeStart = now.AddDays(-kvp.Value);

                    facetDoc[rangeName] = new BsonArray
            {
                new BsonDocument("$match", new BsonDocument
                {
                    { "MonitorId", monitorId },
                    { "StartTime", new BsonDocument("$gte", rangeStart) }
                }),
                new BsonDocument("$project", new BsonDocument
                {
                    { "durationMs", new BsonDocument("$cond", new BsonArray
                        {
                            new BsonDocument("$ne", new BsonArray { "$EndTime", BsonNull.Value }),
                            new BsonDocument("$subtract", new BsonArray { "$EndTime", "$StartTime" }),
                            new BsonDocument("$subtract", new BsonArray { "$$NOW", "$StartTime" })
                        })
                    }
                }),
                new BsonDocument("$group", new BsonDocument
                {
                    { "_id", BsonNull.Value },
                    { "totalDurationMs", new BsonDocument("$sum", "$durationMs") },
                    { "incidentCount", new BsonDocument("$sum", 1) }
                })
            };
                }

                var pipeline = new[] { new BsonDocument("$facet", facetDoc) };
                var result = await _monitorIncidentsCollection.Aggregate<BsonDocument>(pipeline).FirstOrDefaultAsync();

                var output = new Dictionary<string, (long TotalDurationMs, long IncidentCount)>();
                foreach (var rangeName in rangesInDays.Keys)
                {
                    var facetArray = result[rangeName].AsBsonArray;
                    var facetResult = facetArray.FirstOrDefault() as BsonDocument;

                    if (facetResult != null)
                    {
                        output[rangeName] = (
                            facetResult.GetValue("totalDurationMs", 0).ToInt64(),
                            facetResult.GetValue("incidentCount", 0).ToInt64()
                        );
                    }
                    else
                    {
                        output[rangeName] = (0, 0);
                    }
                }

                return output;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching downtime and incident counts for monitor {MonitorId}", monitorId);
                return rangesInDays.Keys.ToDictionary(k => k, k => (0L, 0L));
            }
        }

        public async Task<(List<MonitorIncident>, int)> GetIncidentsWithCountByMonitorIdAsync(MonitorConfiguration monitor, int pageNumber, int pageSize)
        {
            try
            {
                var skip = pageNumber * pageSize;

                // Build the match filter
                var matchStage = new BsonDocument("$match", new BsonDocument("MonitorId", monitor.ItemId));

                // Build the facet pipeline manually (no ToBsonDocument)
                var facetStage = new BsonDocument("$facet", new BsonDocument
                {
                    {
                        "data",
                        new BsonArray
                        {
                            new BsonDocument("$sort", new BsonDocument("StartTime", -1)),
                            new BsonDocument("$skip", skip),
                            new BsonDocument("$limit", pageSize)
                        }
                    },
                    {
                        "count",
                        new BsonArray
                        {
                            new BsonDocument("$count", "TotalCount")
                        }
                    }
                });

                // Run pipeline
                var pipeline = new[] { matchStage, facetStage };
                var result = await _monitorIncidentsCollection.Aggregate<BsonDocument>(pipeline).FirstOrDefaultAsync();

                if (result == null)
                    return (new List<MonitorIncident>(), 0);

                // Extract incidents
                var dataArray = result["data"].AsBsonArray;
                var data = dataArray
                    .Select(b => MongoDB.Bson.Serialization.BsonSerializer.Deserialize<MonitorIncident>(b.AsBsonDocument))
                    .ToList();

                // Extract count
                var countArray = result["count"].AsBsonArray;
                var totalCount = countArray.Any() ? (int)countArray.First()["TotalCount"].ToInt64() : 0;

                _logger.LogInformation(
                    "Fetched {Count} incidents out of {TotalCount} for MonitorId {MonitorId}",
                    data.Count, totalCount, monitor.ItemId
                );

                return (data, totalCount);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching incidents for MonitorId {MonitorId}", monitor.ItemId);
                return (new List<MonitorIncident>(), 0);
            }
        }

        public async Task<List<IncidentListSummary>> GetIncidentsListByDateRangeAsync(
    string monitorId, string? startDateStr, string? endDateStr)
        {
            try
            {
                var filterBuilder = Builders<MonitorIncident>.Filter;
                var filters = new List<FilterDefinition<MonitorIncident>>
        {
            filterBuilder.Eq(x => x.MonitorId, monitorId)
        };

                if (DateTime.TryParse(startDateStr, CultureInfo.InvariantCulture, DateTimeStyles.None, out var startDate))
                    startDate = startDate.ToUniversalTime();

                if (DateTime.TryParse(endDateStr, CultureInfo.InvariantCulture, DateTimeStyles.None, out var endDate))
                    endDate = endDate.ToUniversalTime();
                else
                    endDate = DateTime.UtcNow;

                var overlapFilter = filterBuilder.And(
                    filterBuilder.Lte(i => i.StartTime, endDate),
                    filterBuilder.Or(
                        filterBuilder.Eq(i => i.EndTime, null),
                        filterBuilder.Gte(i => i.EndTime, startDate)
                    )
                );

                filters.Add(overlapFilter);

                var finalFilter = filterBuilder.And(filters);

                var partialResults = await _monitorIncidentsCollection
                    .Find(finalFilter)
                    .Project(x => new
                    {
                        x.StartTime,
                        x.EndTime
                    })
                    .ToListAsync();

                return partialResults.Select(x => new IncidentListSummary
                {
                    StartTime = x.StartTime,
                    EndTime = x.EndTime,
                    DowntimeDurationSeconds = x.EndTime.HasValue
                        ? (x.EndTime.Value - x.StartTime).TotalSeconds
                        : null
                }).ToList();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching incident list by date range for MonitorId {MonitorId}", monitorId);
                return new List<IncidentListSummary>();
            }
        }


        public async Task<List<MonitorIncident>> GetIncidentsListByMonitorIdsAndDateRangeAsync(List<string> monitorIds, DateTime startDateUtc, DateTime endDateUtc)
        {
            if (monitorIds == null || monitorIds.Count == 0)
            {
                _logger.LogWarning("MonitorIds list is empty. Skipping incident query.");
                return new List<MonitorIncident>();
            }

            try
            {
                var filterBuilder = Builders<MonitorIncident>.Filter;
                var filter = filterBuilder.In(x => x.MonitorId, monitorIds) &
                                filterBuilder.Gte(x => x.StartTime, startDateUtc) &
                                filterBuilder.Lte(x => x.StartTime, endDateUtc);

                var incidents = await _monitorIncidentsCollection
                    .Find(filter)
                    .SortByDescending(x => x.StartTime)
                    .ToListAsync();

                _logger.LogInformation(
                    "Fetched {Count} incidents for {MonitorCount} monitors between {Start} and {End}",
                    incidents.Count, monitorIds.Count, startDateUtc, endDateUtc);

                return incidents;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching incidents for multiple monitors between {Start} and {End}", startDateUtc, endDateUtc);
                return new List<MonitorIncident>();
            }
        }
    }
}
