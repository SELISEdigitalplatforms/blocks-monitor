using System.Text.Json;
using Blocks.Genesis;
using DomainService.Health.Services;
using MongoDB.Bson;
using MongoDB.Driver;
using Moq;

namespace XUnitTest.Health;

public class DatabasePlacementDiagnosticsTests
{
    private readonly Mock<IDbContextProvider> _provider = new(MockBehavior.Strict);
    private readonly BlocksSecret _secret = new()
    {
        DatabaseConnectionString = "mongodb://main.invalid",
        DevDatabaseConnectionString = "mongodb://dev.invalid",
        OtherDatabaseConnectionString = "mongodb://other.invalid"
    };

    private Mock<IMongoDatabase> Configure(string connection, Task<BsonDocument>? result = null)
    {
        var database = new Mock<IMongoDatabase>(MockBehavior.Strict);
        _provider.Setup(p => p.GetDatabase(connection, "admin", false)).Returns(database.Object);
        database.Setup(d => d.RunCommandAsync(It.IsAny<Command<BsonDocument>>(),
                It.IsAny<ReadPreference>(), It.IsAny<CancellationToken>()))
            .Returns(result ?? Task.FromResult(new BsonDocument("ok", 1)));
        return database;
    }

    [Fact]
    public async Task FailedDev_IsReportedSeparately_WithoutLeakingDriverDetails()
    {
        Configure(_secret.DatabaseConnectionString);
        Configure(_secret.DevDatabaseConnectionString,
            Task.FromException<BsonDocument>(new Exception("mongodb://user:password@private-host")));
        Configure(_secret.OtherDatabaseConnectionString);

        var result = await new DatabasePlacementDiagnostics(_provider.Object, _secret).CheckAsync();

        Assert.False(result.IsHealthy);
        Assert.Equal("healthy", result.Placements["main"]);
        Assert.Equal("unhealthy", result.Placements["dev"]);
        Assert.Equal("healthy", result.Placements["other"]);
        var json = JsonSerializer.Serialize(result);
        Assert.DoesNotContain("mongodb", json);
        Assert.DoesNotContain("password", json);
        Assert.DoesNotContain("private-host", json);
        _provider.Verify(p => p.GetDatabase(It.IsAny<string>()), Times.Never);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public async Task MissingOptionalConnections_AreNotProbed(string? absent)
    {
        _secret.DevDatabaseConnectionString = absent;
        _secret.OtherDatabaseConnectionString = absent;
        var main = Configure(_secret.DatabaseConnectionString);

        var result = await new DatabasePlacementDiagnostics(_provider.Object, _secret).CheckAsync();

        Assert.True(result.IsHealthy);
        Assert.Equal("not_configured", result.Placements["dev"]);
        Assert.Equal("not_configured", result.Placements["other"]);
        main.Verify(d => d.RunCommandAsync(It.IsAny<Command<BsonDocument>>(),
            It.IsAny<ReadPreference>(), It.IsAny<CancellationToken>()), Times.Once);
        _provider.Verify(p => p.GetDatabase(It.IsAny<string>(), It.IsAny<string>(), false), Times.Once);
    }

    [Fact]
    public async Task MissingMain_IsUnhealthy_EvenWhenOptionalClustersWork()
    {
        _secret.DatabaseConnectionString = " ";
        Configure(_secret.DevDatabaseConnectionString);
        Configure(_secret.OtherDatabaseConnectionString);
        var result = await new DatabasePlacementDiagnostics(_provider.Object, _secret).CheckAsync();
        Assert.False(result.IsHealthy);
        Assert.Equal("unhealthy", result.Placements["main"]);
    }

    [Fact]
    public async Task UnresponsiveDev_TimesOut_WithoutLosingHealthyResults()
    {
        Configure(_secret.DatabaseConnectionString);
        Configure(_secret.DevDatabaseConnectionString, new TaskCompletionSource<BsonDocument>().Task);
        Configure(_secret.OtherDatabaseConnectionString);
        var result = await new DatabasePlacementDiagnostics(_provider.Object, _secret).CheckAsync()
            .WaitAsync(TimeSpan.FromSeconds(10));
        Assert.Equal("unhealthy", result.Placements["dev"]);
        Assert.Equal("healthy", result.Placements["main"]);
        Assert.Equal("healthy", result.Placements["other"]);
    }

    [Fact]
    public async Task CallerCancellation_IsNotReportedAsAClusterOutage()
    {
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            new DatabasePlacementDiagnostics(_provider.Object, _secret).CheckAsync(cancellation.Token));
        _provider.VerifyNoOtherCalls();
    }
}
