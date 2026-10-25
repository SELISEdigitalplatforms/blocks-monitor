using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Blocks.Genesis.DataAccess.Rules;
using Blocks.Genesis.Entities.Monitor;
using DomainService.Monitor.MonitorIncidentService;
using DomainService.Monitor.Services;
using DomainService.Shared.DataAccess;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;
using Moq;
using XUnitTest.Utilities;

namespace XUnitTest.Shared
{
    /// <summary>
    /// The repositories obey the wrapper: a denied read is empty, a denied write writes nothing, and a save the
    /// rules refuse is refused before Mongo is touched. The repositories catch most exceptions, so "not touched"
    /// is checked on the collection mock's recorded calls, not with a strict mock.
    /// </summary>
    public class MonitorRepositoryAccessTests
    {
        /// <summary>Denies every gate. Its rules methods throw, so a denied write must stop before them.</summary>
        private sealed class DenyAll : IMonitorDataAccess
        {
            public Task<ReadScope<T>> ReadAsync<T>(string schema, FilterDefinition<T> filter, string callSite, string? tenantId = null, bool useProjection = true) =>
                Task.FromResult(new ReadScope<T>(false, filter, null));
            public Task<FilterDefinition<T>?> EditFilterAsync<T>(string schema, FilterDefinition<T> filter, string callSite, string? tenantId = null) => Task.FromResult<FilterDefinition<T>?>(null);
            public Task<FilterDefinition<T>?> DeleteFilterAsync<T>(string schema, FilterDefinition<T> filter, string callSite, string? tenantId = null) => Task.FromResult<FilterDefinition<T>?>(null);
            public Task<bool> InsertAllowedAsync(string schema, string callSite, string? tenantId = null) => Task.FromResult(false);
            public Task<T> PrepareWriteAsync<T>(string schema, T entity, bool isInsert, string callSite, string? tenantId = null) => throw new InvalidOperationException("rules after a denial");
            public Task<T> PrepareUpsertAsync<T>(string schema, T entity, IMongoCollection<T> collection, FilterDefinition<T> filter, string callSite, string? tenantId = null) => throw new InvalidOperationException("rules after a denial");
            public Task<T> PrepareReplaceAsync<T>(string schema, T entity, IMongoCollection<T> collection, FilterDefinition<T> filter, string callSite, string? tenantId = null) => throw new InvalidOperationException("rules after a denial");
            public Task CheckUpdateAsync<T>(string schema, UpdateDefinition<T> update, string callSite, string? tenantId = null) => throw new InvalidOperationException("rules after a denial");
        }

        private static DataValidationException Refused()
        {
            var result = new DataValidationResult();
            result.AddError("Url", "Url must start with https://", "Regex");
            return new DataValidationException(result);
        }

        private static MonitorConfigurationRepoService Configurations(Mock<IMongoCollection<MonitorConfiguration>> collection, IMonitorDataAccess access) =>
            new(new Mock<ILogger<MonitorConfigurationRepoService>>().Object, new MongoMocks.DbBuilder().With(collection).Provider,
                new Mock<IConfiguration>().Object, MongoMocks.BlocksSecret().Object, access);

        [Fact]
        public async Task DeniedConfigurationCalls_ReadNothingAndWriteNothing()
        {
            var collection = new Mock<IMongoCollection<MonitorConfiguration>>();
            var repo = Configurations(collection, new DenyAll());

            var (items, total) = await repo.GetConfigurationListAsync("t1", null, 0, 10);
            items.Should().BeEmpty();
            total.Should().Be(0);
            (await repo.GetConfigurationAsync("m1")).Should().BeNull();
            (await repo.DeleteConfigurationAsync("m1")).Should().BeFalse();
            (await repo.UpdateConfigurationAsync(new MonitorConfiguration { ItemId = "m1" })).Should().BeFalse();
            await repo.Invoking(r => r.SaveConfigurationAsync(new MonitorConfiguration { ItemId = "m1" }))
                .Should().ThrowAsync<UnauthorizedAccessException>();
            collection.Invocations.Should().BeEmpty();
        }

        [Fact]
        public async Task ASaveTheRulesRefuse_Throws_AndTouchesNoDocument()
        {
            var access = new Mock<IMonitorDataAccess>();
            access.Setup(a => a.EditFilterAsync(MonitorSchemas.MonitorConfiguration, It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<string>(), null))
                .ReturnsAsync((string _, FilterDefinition<MonitorConfiguration> f, string _, string? _) => f);
            access.Setup(a => a.InsertAllowedAsync(MonitorSchemas.MonitorConfiguration, It.IsAny<string>(), null)).ReturnsAsync(true);
            access.Setup(a => a.PrepareUpsertAsync(MonitorSchemas.MonitorConfiguration, It.IsAny<MonitorConfiguration>(), It.IsAny<IMongoCollection<MonitorConfiguration>>(),
                It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<string>(), null)).ThrowsAsync(Refused());
            access.Setup(a => a.PrepareReplaceAsync(MonitorSchemas.MonitorConfiguration, It.IsAny<MonitorConfiguration>(), It.IsAny<IMongoCollection<MonitorConfiguration>>(),
                It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<string>(), null)).ThrowsAsync(Refused());
            var collection = new Mock<IMongoCollection<MonitorConfiguration>>();
            var repo = Configurations(collection, access.Object);

            await repo.Invoking(r => r.SaveConfigurationAsync(new MonitorConfiguration { ItemId = "m1", Url = "http://x" }))
                .Should().ThrowAsync<DataValidationException>();
            // The update path's catch-all must not turn the refusal into "false".
            await repo.Invoking(r => r.UpdateConfigurationAsync(new MonitorConfiguration { ItemId = "m1", Url = "http://x" }))
                .Should().ThrowAsync<DataValidationException>();
            collection.Invocations.Should().BeEmpty();
        }

        [Fact]
        public async Task DeniedIncidentReads_AreEmpty_WithoutRunningThePipelines()
        {
            var collection = new Mock<IMongoCollection<MonitorIncident>>();
            var repo = new MonitorIncidentRepoService(new Mock<ILogger<MonitorIncidentRepoService>>().Object,
                new MongoMocks.DbBuilder().With(collection).Provider, MongoMocks.BlocksSecret().Object, new DenyAll());
            var monitor = new MonitorConfiguration { ItemId = "m1" };

            var (incidents, total) = await repo.GetIncidentsWithCountByMonitorIdAsync(monitor, 0, 10);
            incidents.Should().BeEmpty();
            total.Should().Be(0);
            (await repo.GetIncidentCountByMonitorIdAsync(monitor)).Should().Be(0);
            (await repo.GetDowntimeByMultipleRangesAsync("m1")).Values.Should().AllBeEquivalentTo(0L);
            (await repo.GetActiveIncidentAsync("m1")).Should().BeNull();
            collection.Invocations.Should().BeEmpty();
        }
    }
}
