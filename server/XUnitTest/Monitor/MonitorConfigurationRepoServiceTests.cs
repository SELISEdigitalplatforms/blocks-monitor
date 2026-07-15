using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using DomainService.Monitor.Entity;
using DomainService.Monitor.Models;
using DomainService.Monitor.Services;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Driver;
using Moq;
using XUnitTest.Utilities;

namespace XUnitTest.Monitor
{
    // These exercise the real C# logic in the repository (enum parsing, filter/branch selection,
    // page clamping, sort switch, projection mapping and try/catch fallbacks). The MongoDB driver
    // is mocked at the IMongoCollection seam; query-shape correctness is out of scope for unit tests.
    public class MonitorConfigurationRepoServiceTests
    {
        private static MonitorConfigurationRepoService Build(
            Mock<MongoDB.Driver.IMongoCollection<MonitorConfiguration>> collection)
        {
            var db = new MongoMocks.DbBuilder().With(collection);
            return new MonitorConfigurationRepoService(
                new Mock<ILogger<MonitorConfigurationRepoService>>().Object,
                db.Provider,
                new Mock<IConfiguration>().Object,
                MongoMocks.BlocksSecret().Object);
        }

        private static MonitorConfigurationRepoService Build(IEnumerable<MonitorConfiguration> data = null) =>
            Build(MongoMocks.Collection(data ?? new List<MonitorConfiguration>()));

        [Fact]
        public async Task GetConfigurationAsync_ReturnsMatch()
        {
            var repo = Build(new List<MonitorConfiguration> { new() { ItemId = "m1" } });
            var result = await repo.GetConfigurationAsync("m1");
            result.Should().NotBeNull();
            result!.ItemId.Should().Be("m1");
        }

        [Fact]
        public async Task GetConfigurationAsync_WhenCollectionThrows_ReturnsNull()
        {
            var repo = Build(MongoMocks.CollectionThrowing<MonitorConfiguration>());
            var result = await repo.GetConfigurationAsync("m1");
            result.Should().BeNull();
        }

        [Fact]
        public async Task DeleteConfigurationAsync_WhenDeleted_ReturnsTrue()
        {
            var result = await Build().DeleteConfigurationAsync("m1");
            result.Should().BeTrue();
        }

        [Fact]
        public async Task UpdateConfigurationAsync_WhenModified_ReturnsTrue()
        {
            var result = await Build().UpdateConfigurationAsync(new MonitorConfiguration { ItemId = "m1" });
            result.Should().BeTrue();
        }

        [Fact]
        public async Task UpdateConfigurationIncidentAsync_WhenModified_ReturnsTrue()
        {
            var result = await Build().UpdateConfigurationIncidentAsync(
                new MonitorConfigurationIncidentUpdate { MonitorId = "m1", CurrentStatus = false });
            result.Should().BeTrue();
        }

        [Fact]
        public async Task GetConfigurationListByTenantIdAsync_ReturnsList()
        {
            var repo = Build(new List<MonitorConfiguration> { new() { ItemId = "m1", TenantId = "t" } });
            var result = await repo.GetConfigurationListByTenantIdAsync("t");
            result.Should().ContainSingle();
        }

        [Fact]
        public async Task GetConfigurationListByRepoIdAsync_ReturnsList()
        {
            var repo = Build(new List<MonitorConfiguration> { new() { ItemId = "m1", RepoId = "r" } });
            var result = await repo.GetConfigurationListByRepoIdAsync("t", "r");
            result.Should().ContainSingle();
        }

        [Fact]
        public async Task GetAllConfigurationListAsync_ReturnsList()
        {
            var repo = Build(new List<MonitorConfiguration> { new() { ItemId = "m1", IsActive = true } });
            var result = await repo.GetAllConfigurationListAsync();
            result.Should().ContainSingle();
        }

        [Fact]
        public async Task GetByUrlAsync_ReturnsMatch()
        {
            var repo = Build(new List<MonitorConfiguration> { new() { ItemId = "m1", Url = "http://x" } });
            var result = await repo.GetByUrlAsync("http://x");
            result.Should().NotBeNull();
        }

        [Fact]
        public async Task GetExternalServiceConfigurationAsync_WhenIdEmpty_ReturnsNull()
        {
            var result = await Build().GetExternalServiceConfigurationAsync("  ");
            result.Should().BeNull();
        }

        [Fact]
        public async Task GetExternalServiceConfigurationAsync_ReturnsMatch()
        {
            var repo = Build(new List<MonitorConfiguration> { new() { ItemId = "m1", ExternalServiceId = "ext" } });
            var result = await repo.GetExternalServiceConfigurationAsync("ext");
            result.Should().NotBeNull();
        }

        [Fact]
        public async Task GetConfigurationListAsync_WhenSourceTypeInvalid_ReturnsEmpty()
        {
            var (items, total) = await Build().GetConfigurationListAsync("t", "NotAType", 0, 10);
            items.Should().BeEmpty();
            total.Should().Be(0);
        }

        [Fact]
        public async Task GetConfigurationListAsync_TenantScoped_ReturnsItemsAndCount()
        {
            var repo = Build(new List<MonitorConfiguration> { new() { ItemId = "m1", TenantId = "t" } });
            var (items, total) = await repo.GetConfigurationListAsync("t", null, -5, 0);
            items.Should().ContainSingle();
            total.Should().Be(1);
        }

        [Fact]
        public async Task SaveConfigurationAsync_WhenUpserted_ReturnsTrue()
        {
            var coll = MongoMocks.Collection(new List<MonitorConfiguration>());
            coll.Setup(c => c.ReplaceOneAsync(It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<MonitorConfiguration>(),
                    It.IsAny<ReplaceOptions>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new ReplaceOneResult.Acknowledged(0, 0, new BsonString("new-id")));

            var result = await Build(coll).SaveConfigurationAsync(new MonitorConfiguration { ItemId = "m1" });

            result.Should().BeTrue();
        }

        [Fact]
        public async Task UpdateConfigurationAsync_WhenThrows_ReturnsFalse()
        {
            var coll = MongoMocks.Collection(new List<MonitorConfiguration>());
            coll.Setup(c => c.ReplaceOneAsync(It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<MonitorConfiguration>(),
                    It.IsAny<ReplaceOptions>(), It.IsAny<CancellationToken>()))
                .ThrowsAsync(new MongoException("boom"));

            var result = await Build(coll).UpdateConfigurationAsync(new MonitorConfiguration { ItemId = "m1" });

            result.Should().BeFalse();
        }

        [Fact]
        public async Task UpdateConfigurationIncidentAsync_WhenThrows_ReturnsFalse()
        {
            var coll = MongoMocks.Collection(new List<MonitorConfiguration>());
            coll.Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<UpdateDefinition<MonitorConfiguration>>(),
                    It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
                .ThrowsAsync(new MongoException("boom"));

            var result = await Build(coll).UpdateConfigurationIncidentAsync(new MonitorConfigurationIncidentUpdate { MonitorId = "m1" });

            result.Should().BeFalse();
        }

        [Fact]
        public async Task GetConfigurationListAsync_WhenThrows_ReturnsEmpty()
        {
            var coll = MongoMocks.Collection(new List<MonitorConfiguration>());
            coll.Setup(c => c.CountDocumentsAsync(It.IsAny<FilterDefinition<MonitorConfiguration>>(),
                    It.IsAny<CountOptions>(), It.IsAny<CancellationToken>()))
                .ThrowsAsync(new MongoException("boom"));

            var (items, total) = await Build(coll).GetConfigurationListAsync("t", null, 0, 10);

            items.Should().BeEmpty();
            total.Should().Be(0);
        }

        [Fact]
        public async Task GetConfigurationListByTenantIdAsync_WhenThrows_ReturnsEmpty()
        {
            var result = await Build(MongoMocks.CollectionThrowing<MonitorConfiguration>()).GetConfigurationListByTenantIdAsync("t");
            result.Should().BeEmpty();
        }

        [Theory]
        [InlineData("Infrastructure", "status")]
        [InlineData("DeployedServices", "tagged_service")]
        [InlineData("ExternalServices", "tagged_service")]
        [InlineData("DeployedServices", "url")]
        [InlineData("DeployedServices", "uptime")]
        [InlineData("DeployedServices", "monitor_type")]
        public async Task GetConfigurationListAsync_WithSourceTypeAndSort_ReturnsResults(string sourceType, string sortProperty)
        {
            var repo = Build(new List<MonitorConfiguration> { new() { ItemId = "m1", TenantId = "t" } });
            var (items, total) = await repo.GetConfigurationListAsync("t", sourceType, 0, 10, sortProperty, sortIsDescending: true);
            total.Should().Be(1);
            items.Should().ContainSingle();
        }
    }
}
