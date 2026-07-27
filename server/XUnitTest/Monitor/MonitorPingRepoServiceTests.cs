using System.Collections.Generic;
using System.Threading.Tasks;
using DomainService.Monitor.Entity;
using DomainService.Monitor.Models;
using DomainService.Monitor.MonitorSchedulingService;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;
using Moq;
using XUnitTest.Utilities;

namespace XUnitTest.Monitor
{
    public class MonitorPingRepoServiceTests
    {
        private static MonitorPingRepoService Build(Mock<IMongoCollection<MonitorPingLog>> collection)
        {
            var db = new MongoMocks.DbBuilder().With(collection);
            return new MonitorPingRepoService(
                new Mock<ILogger<MonitorPingRepoService>>().Object, db.Provider, MongoMocks.BlocksSecret().Object);
        }

        [Fact]
        public async Task SavePingLogAsync_InsertsLog()
        {
            var coll = MongoMocks.Collection(new List<MonitorPingLog>());
            var sut = Build(coll);

            await sut.SavePingLogAsync(new MonitorPingLog { MonitorId = "m1", Url = "http://x" });

            coll.Verify(c => c.InsertOneAsync(It.IsAny<MonitorPingLog>(), It.IsAny<InsertOneOptions>(), It.IsAny<System.Threading.CancellationToken>()), Times.Once);
        }

        [Fact]
        public async Task SavePingLogAsync_WhenInsertThrows_Swallows()
        {
            var coll = MongoMocks.Collection(new List<MonitorPingLog>());
            coll.Setup(c => c.InsertOneAsync(It.IsAny<MonitorPingLog>(), It.IsAny<InsertOneOptions>(), It.IsAny<System.Threading.CancellationToken>()))
                .ThrowsAsync(new MongoException("boom"));
            var sut = Build(coll);

            var act = async () => await sut.SavePingLogAsync(new MonitorPingLog { Url = "http://x" });

            await act.Should().NotThrowAsync();
        }

        [Fact]
        public async Task GetPingLogsByDateRangeAsync_WhenMonitorIdEmpty_ReturnsEmpty()
        {
            var result = await Build(MongoMocks.Collection(new List<MonitorPingLog>()))
                .GetPingLogsByDateRangeAsync("", "2024-01-01", "2024-01-02");
            result.Should().BeEmpty();
        }

        [Fact]
        public async Task GetPingLogsByDateRangeAsync_WhenDatesInvalid_ReturnsEmpty()
        {
            var result = await Build(MongoMocks.Collection(new List<MonitorPingLog>()))
                .GetPingLogsByDateRangeAsync("m1", "not-a-date", "also-bad");
            result.Should().BeEmpty();
        }

        [Fact]
        public async Task GetPingLogsByDateRangeAsync_ReturnsProjectedSummaries()
        {
            var coll = MongoMocks.Collection(new List<MonitorPingLog>());
            MongoMocks.SetupProjectedFind(coll, new List<MonitorPingLogSummary>
            {
                new() { MonitorId = "m1", StatusCode = 200 }
            });
            var sut = Build(coll);

            var result = await sut.GetPingLogsByDateRangeAsync("m1", "2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z");

            result.Should().ContainSingle().Which.StatusCode.Should().Be(200);
        }

        [Fact]
        public async Task GetPingLogsByDateRangeAsync_WhenQueryThrows_ReturnsEmpty()
        {
            var coll = MongoMocks.Collection(new List<MonitorPingLog>());
            coll.Setup(c => c.FindAsync(
                    It.IsAny<FilterDefinition<MonitorPingLog>>(),
                    It.IsAny<FindOptions<MonitorPingLog, MonitorPingLogSummary>>(),
                    It.IsAny<System.Threading.CancellationToken>()))
                .ThrowsAsync(new MongoException("boom"));
            var sut = Build(coll);

            var result = await sut.GetPingLogsByDateRangeAsync("m1", "2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z");

            result.Should().BeEmpty();
        }
    }
}
