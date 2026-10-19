using DomainService.Shared.DataAccess;
using MongoDB.Driver;

namespace XUnitTest.Utilities;

/// <summary>Allows everything and leaves filters and entities as they are: the repositories' behaviour before data access.</summary>
public sealed class PassThroughMonitorDataAccess : IMonitorDataAccess
{
    public static readonly PassThroughMonitorDataAccess Instance = new();

    public Task<ReadScope<T>> ReadAsync<T>(string schema, FilterDefinition<T> filter, string callSite, string? tenantId = null, bool useProjection = true) =>
        Task.FromResult(new ReadScope<T>(true, filter, null));

    public Task<FilterDefinition<T>?> EditFilterAsync<T>(string schema, FilterDefinition<T> filter, string callSite, string? tenantId = null) =>
        Task.FromResult<FilterDefinition<T>?>(filter);

    public Task<FilterDefinition<T>?> DeleteFilterAsync<T>(string schema, FilterDefinition<T> filter, string callSite, string? tenantId = null) =>
        Task.FromResult<FilterDefinition<T>?>(filter);

    public Task<bool> InsertAllowedAsync(string schema, string callSite, string? tenantId = null) => Task.FromResult(true);

    public Task<T> PrepareWriteAsync<T>(string schema, T entity, bool isInsert, string callSite, string? tenantId = null) => Task.FromResult(entity);

    public Task<T> PrepareUpsertAsync<T>(string schema, T entity, IMongoCollection<T> collection, FilterDefinition<T> filter, string callSite, string? tenantId = null) =>
        Task.FromResult(entity);

    public Task CheckUpdateAsync<T>(string schema, UpdateDefinition<T> update, string callSite, string? tenantId = null) => Task.CompletedTask;
}
