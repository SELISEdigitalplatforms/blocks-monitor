using Blocks.Genesis;
using MongoDB.Bson;
using MongoDB.Driver;

namespace DomainService.Health.Services;

public interface IDatabasePlacementDiagnostics
{
    Task<DatabasePlacementStatusResponse> CheckAsync(CancellationToken cancellationToken = default);
}

public sealed record DatabasePlacementStatusResponse(bool IsHealthy, IReadOnlyDictionary<string, string> Placements);

/// <summary>Read-only cluster diagnostics, separate from shared API readiness.</summary>
public sealed class DatabasePlacementDiagnostics(IDbContextProvider provider, IBlocksSecret secret) : IDatabasePlacementDiagnostics
{
    public async Task<DatabasePlacementStatusResponse> CheckAsync(CancellationToken cancellationToken = default)
    {
        var targets = new[]
        {
            (Name: "main", Connection: secret.DatabaseConnectionString),
            (Name: "dev", Connection: secret.DevDatabaseConnectionString),
            (Name: "other", Connection: secret.OtherDatabaseConnectionString)
        };
        var checks = targets.Select(async target =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (string.IsNullOrWhiteSpace(target.Connection))
                return (target.Name, Status: target.Name == "main" ? "unhealthy" : "not_configured");

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(3));
            try
            {
                var database = provider.GetDatabase(target.Connection, "admin");
                await database.RunCommandAsync<BsonDocument>(new BsonDocument("ping", 1), cancellationToken: timeout.Token)
                    .WaitAsync(timeout.Token);
                return (target.Name, Status: "healthy");
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { throw; }
            catch (Exception)
            {
                // Driver exceptions may contain hosts or credentials. Expose only the placement status.
                return (target.Name, Status: "unhealthy");
            }
        });
        var results = await Task.WhenAll(checks);
        return new DatabasePlacementStatusResponse(results.All(r => r.Status != "unhealthy"),
            results.ToDictionary(r => r.Name, r => r.Status));
    }
}
