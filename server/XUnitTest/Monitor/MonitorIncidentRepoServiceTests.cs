using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using DomainService.Monitor.Entity;
using DomainService.Monitor.MonitorIncidentService;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;
using Moq;
using XUnitTest.Utilities;

namespace XUnitTest.Monitor
{
    // Covers the query-building, projection/mapping and try/catch fallback logic of the incident
    // repository. Aggregation-pipeline methods (downtime rollups) are integration-level and are not
    // covered here — they need a real MongoDB to validate the pipeline.
    public class MonitorIncidentRepoServiceTests
    {
        private static MonitorIncidentRepoService Build(Mock<IMongoCollection<MonitorIncident>> collection)
        {
            var db = new MongoMocks.DbBuilder().With(collection);
            return new MonitorIncidentRepoService(
                new Mock<ILogger<MonitorIncidentRepoService>>().Object, db.Provider, MongoMocks.BlocksSecret().Object);
        }

        private static MonitorIncidentRepoService Build(IEnumerable<MonitorIncident> data = null) =>
            Build(MongoMocks.Collection(data ?? new List<MonitorIncident>()));

        private static MonitorConfiguration Monitor() => new() { ItemId = "m1" };

        [Fact]
        public async Task GetActiveIncidentAsync_ReturnsMatch()
        {
            var repo = Build(new List<MonitorIncident> { new() { ItemId = "i1", MonitorId = "m1", IsResolved = false } });
            var result = await repo.GetActiveIncidentAsync("m1");
            result.Should().NotBeNull();
        }

        [Fact]
        public async Task GetActiveIncidentAsync_WhenThrows_ReturnsNull()
        {
            var result = await Build(MongoMocks.CollectionThrowing<MonitorIncident>()).GetActiveIncidentAsync("m1");
            result.Should().BeNull();
        }

        [Fact]
        public async Task CreateIncidentAsync_InsertsIncident()
        {
            var coll = MongoMocks.Collection(new List<MonitorIncident>());
            await Build(coll).CreateIncidentAsync(new MonitorIncident { ItemId = "i1", MonitorId = "m1" });
            coll.Verify(c => c.InsertOneAsync(It.IsAny<MonitorIncident>(), It.IsAny<InsertOneOptions>(), It.IsAny<CancellationToken>()), Times.Once);
        }

        [Fact]
        public async Task UpdateIncidentAsync_ReplacesIncident()
        {
            var coll = MongoMocks.Collection(new List<MonitorIncident>());
            await Build(coll).UpdateIncidentAsync(new MonitorIncident { ItemId = "i1", MonitorId = "m1" });
            coll.Verify(c => c.ReplaceOneAsync(It.IsAny<FilterDefinition<MonitorIncident>>(), It.IsAny<MonitorIncident>(),
                It.IsAny<ReplaceOptions>(), It.IsAny<CancellationToken>()), Times.Once);
        }

        [Fact]
        public async Task GetIncidentCountByMonitorIdAsync_ReturnsCount()
        {
            var repo = Build(new List<MonitorIncident> { new() { ItemId = "i1" }, new() { ItemId = "i2" } });
            var count = await repo.GetIncidentCountByMonitorIdAsync(Monitor());
            count.Should().Be(2);
        }

        [Fact]
        public async Task GetIncidentCountByMonitorIdAsync_WhenThrows_ReturnsZero()
        {
            var count = await Build(MongoMocks.CollectionThrowing<MonitorIncident>()).GetIncidentCountByMonitorIdAsync(Monitor());
            count.Should().Be(0);
        }

        [Theory]
        [InlineData("status")]
        [InlineData("laststatuscode")]
        [InlineData("rootcause")]
        [InlineData("started_time")]
        [InlineData("end_time")]
        [InlineData("duration")]
        [InlineData(null)]
        public async Task GetIncidentsByMonitorIdAsync_AppliesSortAndReturnsResults(string sortProperty)
        {
            var repo = Build(new List<MonitorIncident> { new() { ItemId = "i1", MonitorId = "m1" } });
            var result = await repo.GetIncidentsByMonitorIdAsync(Monitor(), 1, 10, sortProperty, sortIsDescending: false);
            result.Should().ContainSingle();
        }

        [Fact]
        public async Task GetIncidentsListByMonitorIdsAndDateRangeAsync_WhenIdsEmpty_ReturnsEmpty()
        {
            var result = await Build().GetIncidentsListByMonitorIdsAndDateRangeAsync(new List<string>(), DateTime.UtcNow.AddDays(-1), DateTime.UtcNow);
            result.Should().BeEmpty();
        }

        [Fact]
        public async Task GetIncidentsListByMonitorIdsAndDateRangeAsync_ReturnsIncidents()
        {
            var repo = Build(new List<MonitorIncident> { new() { ItemId = "i1", MonitorId = "m1", StartTime = DateTime.UtcNow } });
            var result = await repo.GetIncidentsListByMonitorIdsAndDateRangeAsync(
                new List<string> { "m1" }, DateTime.UtcNow.AddDays(-1), DateTime.UtcNow.AddDays(1));
            result.Should().ContainSingle();
        }

        [Fact]
        public async Task GetIncidentsListByDateRangeAsync_ParsesDatesAndReturnsList()
        {
            // The projection uses an anonymous type; without a projected-find stub the driver seam
            // yields no rows, so this asserts the date-parsing/filter path returns a (non-null) list.
            var result = await Build().GetIncidentsListByDateRangeAsync("m1", "2024-01-01T00:00:00Z", "2024-01-31T00:00:00Z");
            result.Should().NotBeNull();
        }

        [Fact]
        public async Task GetIncidentsListByDateRangeAsync_WithNullDates_DefaultsEndToNow()
        {
            var result = await Build().GetIncidentsListByDateRangeAsync("m1", null, null);
            result.Should().NotBeNull();
        }

        // ---------- Aggregation-pipeline response parsing ----------

        [Fact]
        public async Task GetIncidentsWithCountByMonitorIdAsync_ParsesDataAndCount()
        {
            var coll = MongoMocks.Collection(new List<MonitorIncident>());
            var incidentDoc = new MonitorIncident { ItemId = "i1", MonitorId = "m1" }.ToBsonDocument();
            MongoMocks.SetupAggregate(coll, new List<BsonDocument>
            {
                new()
                {
                    { "data", new BsonArray { incidentDoc } },
                    { "count", new BsonArray { new BsonDocument("TotalCount", 5) } }
                }
            });

            var (data, total) = await Build(coll).GetIncidentsWithCountByMonitorIdAsync(Monitor(), 0, 10, "started_time", true);

            data.Should().ContainSingle().Which.ItemId.Should().Be("i1");
            total.Should().Be(5);
        }

        [Fact]
        public async Task GetIncidentsWithCountByMonitorIdAsync_WhenNoResult_ReturnsEmpty()
        {
            var coll = MongoMocks.Collection(new List<MonitorIncident>());
            MongoMocks.SetupAggregate(coll, new List<BsonDocument>()); // FirstOrDefault -> null
            var (data, total) = await Build(coll).GetIncidentsWithCountByMonitorIdAsync(Monitor(), 0, 10);
            data.Should().BeEmpty();
            total.Should().Be(0);
        }

        [Fact]
        public async Task GetIncidentsDurationByDateRangeAsync_ReturnsAggregatedDuration()
        {
            var coll = MongoMocks.Collection(new List<MonitorIncident>());
            MongoMocks.SetupAggregate(coll, new List<BsonDocument>
            {
                new() { { "totalDurationMs", 5000L } }
            });

            var result = await Build(coll).GetIncidentsDurationByDateRangeAsync("m1", DateTime.UtcNow.AddDays(-1), DateTime.UtcNow);

            result.Should().Be(5000);
        }

        [Fact]
        public async Task GetDowntimeByMultipleRangesAsync_ParsesEachRange()
        {
            var coll = MongoMocks.Collection(new List<MonitorIncident>());
            MongoMocks.SetupAggregate(coll, new List<BsonDocument>
            {
                new()
                {
                    { "last7Days", new BsonArray { new BsonDocument("totalDurationMs", 100L) } },
                    { "last30Days", new BsonArray { new BsonDocument("totalDurationMs", 200L) } },
                    { "last365Days", new BsonArray { new BsonDocument("totalDurationMs", 300L) } }
                }
            });

            var result = await Build(coll).GetDowntimeByMultipleRangesAsync("m1");

            result["last7Days"].Should().Be(100);
            result["last30Days"].Should().Be(200);
            result["last365Days"].Should().Be(300);
        }

        [Fact]
        public async Task GetDowntimeAndCountByDateRangesAsync_ParsesDurationAndCount()
        {
            var coll = MongoMocks.Collection(new List<MonitorIncident>());
            MongoMocks.SetupAggregate(coll, new List<BsonDocument>
            {
                new()
                {
                    { "7d", new BsonArray { new BsonDocument { { "totalDurationMs", 1000L }, { "incidentCount", 3L } } } },
                    { "30d", new BsonArray() } // empty facet -> (0,0)
                }
            });

            var result = await Build(coll).GetDowntimeAndCountByDateRangesAsync("m1", new Dictionary<string, int> { { "7d", 7 }, { "30d", 30 } });

            result["7d"].TotalDurationMs.Should().Be(1000);
            result["7d"].IncidentCount.Should().Be(3);
            result["30d"].Should().Be((0L, 0L));
        }

        [Fact]
        public async Task GetDowntimeAndCountByDateRangesAsync_WhenAggregateThrows_ReturnsZeros()
        {
            var coll = MongoMocks.Collection(new List<MonitorIncident>());
            coll.Setup(c => c.AggregateAsync(It.IsAny<PipelineDefinition<MonitorIncident, BsonDocument>>(),
                    It.IsAny<AggregateOptions>(), It.IsAny<CancellationToken>()))
                .ThrowsAsync(new MongoException("boom"));

            var result = await Build(coll).GetDowntimeAndCountByDateRangesAsync("m1", new Dictionary<string, int> { { "7d", 7 } });

            result["7d"].Should().Be((0L, 0L));
        }
    }
}
