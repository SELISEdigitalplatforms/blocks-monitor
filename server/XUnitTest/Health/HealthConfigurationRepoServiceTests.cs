using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using DomainService.Health.Services;
using DomainService.Monitor.Entity;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;
using Moq;
using XUnitTest.Utilities;

namespace XUnitTest.Health
{
    public class HealthConfigurationRepoServiceTests
    {
        private static HealthConfigurationRepoService Build(
            IEnumerable<MonitorConfiguration> configs = null,
            IEnumerable<MonitorIncident> incidents = null)
        {
            var db = new MongoMocks.DbBuilder()
                .With(configs ?? new List<MonitorConfiguration>())
                .With(incidents ?? new List<MonitorIncident>());
            return new HealthConfigurationRepoService(
                new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, MongoMocks.BlocksSecret().Object);
        }

        [Fact]
        public async Task GetAllActiveConfigurationsAsync_ReturnsConfigs()
        {
            var repo = Build(configs: new List<MonitorConfiguration> { new() { ItemId = "m1", IsActive = true } });
            var result = await repo.GetAllActiveConfigurationsAsync();
            result.Should().ContainSingle();
        }

        [Fact]
        public async Task GetConfigurationListAsync_ReturnsConfigs()
        {
            var repo = Build(configs: new List<MonitorConfiguration> { new() { ItemId = "m1", TenantId = "t" } });
            var result = await repo.GetConfigurationListAsync("t");
            result.Should().ContainSingle();
        }

        [Fact]
        public async Task GetConfigurationAsync_ReturnsMatch()
        {
            var repo = Build(configs: new List<MonitorConfiguration> { new() { ItemId = "m1" } });
            var result = await repo.GetConfigurationAsync("m1");
            result.Should().NotBeNull();
        }

        [Fact]
        public async Task SaveOrUpdateConfigurationAsync_ReturnsTrue()
        {
            var result = await Build().SaveOrUpdateConfigurationAsync(new MonitorConfiguration { ItemId = "m1" });
            result.Should().BeTrue();
        }

        [Fact]
        public async Task DeleteConfigurationAsync_ReturnsTrue()
        {
            var result = await Build().DeleteConfigurationAsync("m1");
            result.Should().BeTrue();
        }

        [Fact]
        public async Task UpdateConfigurationIncidentStateAsync_ReturnsTrue()
        {
            var result = await Build().UpdateConfigurationIncidentStateAsync("m1", isUp: true, timestamp: System.DateTime.UtcNow);
            result.Should().BeTrue();
        }

        [Fact]
        public async Task GetActiveIncidentAsync_ReturnsMatch()
        {
            var repo = Build(incidents: new List<MonitorIncident> { new() { ItemId = "i1", MonitorId = "m1", IsResolved = false } });
            var result = await repo.GetActiveIncidentAsync("m1");
            result.Should().NotBeNull();
        }

        [Fact]
        public async Task CreateIncidentAsync_ReturnsIncident()
        {
            var incident = new MonitorIncident { ItemId = "i1", MonitorId = "m1" };
            var result = await Build().CreateIncidentAsync(incident);
            result.Should().BeSameAs(incident);
        }

        [Fact]
        public async Task ResolveIncidentAsync_WhenActiveIncidentExists_ResolvesAndReturnsTrue()
        {
            var repo = Build(incidents: new List<MonitorIncident> { new() { ItemId = "i1", MonitorId = "m1", IsResolved = false } });
            var result = await repo.ResolveIncidentAsync("m1");
            result.Should().BeTrue();
        }

        [Fact]
        public async Task ResolveIncidentAsync_WhenNoActiveIncident_ReturnsFalse()
        {
            var result = await Build(incidents: new List<MonitorIncident>()).ResolveIncidentAsync("m1");
            result.Should().BeFalse();
        }

        [Fact]
        public async Task GetAllActiveConfigurationsAsync_WhenThrows_ReturnsEmpty()
        {
            var db = new MongoMocks.DbBuilder()
                .With(MongoMocks.CollectionThrowing<MonitorConfiguration>())
                .With(new List<MonitorIncident>());
            var repo = new HealthConfigurationRepoService(
                new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, MongoMocks.BlocksSecret().Object);

            var result = await repo.GetAllActiveConfigurationsAsync();

            result.Should().BeEmpty();
        }

        [Fact]
        public async Task SaveOrUpdateConfigurationAsync_WhenThrows_Rethrows()
        {
            var coll = MongoMocks.Collection(new List<MonitorConfiguration>());
            coll.Setup(c => c.ReplaceOneAsync(It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<MonitorConfiguration>(),
                    It.IsAny<ReplaceOptions>(), It.IsAny<CancellationToken>()))
                .ThrowsAsync(new MongoException("boom"));
            var db = new MongoMocks.DbBuilder().With(coll).With(new List<MonitorIncident>());
            var repo = new HealthConfigurationRepoService(
                new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, MongoMocks.BlocksSecret().Object);

            var act = async () => await repo.SaveOrUpdateConfigurationAsync(new MonitorConfiguration { ItemId = "m1" });

            await act.Should().ThrowAsync<MongoException>();
        }

        [Fact]
        public async Task GetConfigurationAsync_WhenThrows_ReturnsNull()
        {
            var db = new MongoMocks.DbBuilder()
                .With(MongoMocks.CollectionThrowing<MonitorConfiguration>())
                .With(new List<MonitorIncident>());
            var repo = new HealthConfigurationRepoService(
                new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, MongoMocks.BlocksSecret().Object);

            (await repo.GetConfigurationAsync("m1")).Should().BeNull();
        }

        [Fact]
        public async Task GetConfigurationListAsync_WhenThrows_ReturnsEmpty()
        {
            var db = new MongoMocks.DbBuilder()
                .With(MongoMocks.CollectionThrowing<MonitorConfiguration>())
                .With(new List<MonitorIncident>());
            var repo = new HealthConfigurationRepoService(
                new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, MongoMocks.BlocksSecret().Object);

            (await repo.GetConfigurationListAsync("t")).Should().BeEmpty();
        }

        [Fact]
        public async Task GetActiveIncidentAsync_WhenThrows_ReturnsNull()
        {
            var db = new MongoMocks.DbBuilder()
                .With(new List<MonitorConfiguration>())
                .With(MongoMocks.CollectionThrowing<MonitorIncident>());
            var repo = new HealthConfigurationRepoService(
                new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, MongoMocks.BlocksSecret().Object);

            (await repo.GetActiveIncidentAsync("m1")).Should().BeNull();
        }

        [Fact]
        public async Task CreateIncidentAsync_WhenInsertThrows_ReturnsNull()
        {
            var incidentColl = MongoMocks.Collection(new List<MonitorIncident>());
            incidentColl.Setup(c => c.InsertOneAsync(It.IsAny<MonitorIncident>(), It.IsAny<InsertOneOptions>(), It.IsAny<CancellationToken>()))
                .ThrowsAsync(new MongoException("boom"));
            var db = new MongoMocks.DbBuilder().With(new List<MonitorConfiguration>()).With(incidentColl);
            var repo = new HealthConfigurationRepoService(
                new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, MongoMocks.BlocksSecret().Object);

            (await repo.CreateIncidentAsync(new MonitorIncident { ItemId = "i1" })).Should().BeNull();
        }

        [Fact]
        public async Task DeleteConfigurationAsync_WhenDeleteThrows_ReturnsFalse()
        {
            var coll = MongoMocks.Collection(new List<MonitorConfiguration>());
            coll.Setup(c => c.DeleteOneAsync(It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<CancellationToken>()))
                .ThrowsAsync(new MongoException("boom"));
            var db = new MongoMocks.DbBuilder().With(coll).With(new List<MonitorIncident>());
            var repo = new HealthConfigurationRepoService(
                new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, MongoMocks.BlocksSecret().Object);

            var result = await repo.DeleteConfigurationAsync("m1");

            result.Should().BeFalse();
        }

        [Fact]
        public async Task ResolveIncidentAsync_WhenUpdateThrows_ReturnsFalse()
        {
            // Active incident is found, but the resolving update fails, exercising the catch path.
            var incidentColl = MongoMocks.Collection(new List<MonitorIncident>
            {
                new() { ItemId = "i1", MonitorId = "m1", IsResolved = false }
            });
            incidentColl.Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<MonitorIncident>>(), It.IsAny<UpdateDefinition<MonitorIncident>>(),
                    It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
                .ThrowsAsync(new MongoException("boom"));
            var db = new MongoMocks.DbBuilder().With(new List<MonitorConfiguration>()).With(incidentColl);
            var repo = new HealthConfigurationRepoService(
                new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, MongoMocks.BlocksSecret().Object);

            var result = await repo.ResolveIncidentAsync("m1");

            result.Should().BeFalse();
        }

        [Fact]
        public async Task UpdateConfigurationIncidentStateAsync_WhenThrows_ReturnsFalse()
        {
            var coll = MongoMocks.Collection(new List<MonitorConfiguration>());
            coll.Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<UpdateDefinition<MonitorConfiguration>>(),
                    It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
                .ThrowsAsync(new MongoException("boom"));
            var db = new MongoMocks.DbBuilder().With(coll).With(new List<MonitorIncident>());
            var repo = new HealthConfigurationRepoService(
                new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, MongoMocks.BlocksSecret().Object);

            var result = await repo.UpdateConfigurationIncidentStateAsync("m1", true, System.DateTime.UtcNow);

            result.Should().BeFalse();
        }
    }
}
