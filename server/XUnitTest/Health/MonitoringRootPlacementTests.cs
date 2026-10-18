using Blocks.Genesis;
using DomainService.Monitor.Entity;
using DomainService.Monitor.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using MongoDB.Bson;
using MongoDB.Driver;
using Moq;

namespace XUnitTest.Health;

public class MonitoringRootPlacementTests
{
    [Fact]
    public async Task TenantMonitoringConfiguration_StillWritesToConfiguredMainRoot()
    {
        var provider = new Mock<IDbContextProvider>(MockBehavior.Strict);
        var root = new Mock<IMongoDatabase>(MockBehavior.Strict);
        var collection = new Mock<IMongoCollection<MonitorConfiguration>>();
        var secret = new BlocksSecret { DatabaseConnectionString = "main", RootDatabaseName = "custom-root" };
        provider.Setup(p => p.GetDatabase("main", "custom-root", false)).Returns(root.Object);
        root.Setup(d => d.GetCollection<MonitorConfiguration>("MonitorConfigurations", null)).Returns(collection.Object);
        var record = new MonitorConfiguration { ItemId = "dev-monitor", TenantId = "dev" };
        collection.Setup(c => c.ReplaceOneAsync(It.IsAny<FilterDefinition<MonitorConfiguration>>(), record,
            It.IsAny<ReplaceOptions>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new ReplaceOneResult.Acknowledged(0, 0, new BsonString("dev-monitor")));
        var repository = new MonitorConfigurationRepoService(NullLogger<MonitorConfigurationRepoService>.Instance,
            provider.Object, new ConfigurationBuilder().Build(), secret);

        Assert.True(await repository.SaveConfigurationAsync(record));

        collection.Verify(c => c.ReplaceOneAsync(It.IsAny<FilterDefinition<MonitorConfiguration>>(), record,
            It.Is<ReplaceOptions>(o => o.IsUpsert), It.IsAny<CancellationToken>()), Times.Once);
        provider.Verify(p => p.GetDatabase("main", "custom-root", false), Times.Once);
        provider.VerifyNoOtherCalls();
    }
}
