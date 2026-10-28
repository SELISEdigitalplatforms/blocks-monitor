using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Blocks.Genesis;
using Blocks.Genesis.DataAccess.Rules;
using Blocks.Genesis.Entities.Monitor;
using DomainService.Monitor.Models;
using DomainService.Monitor.Services;
using DomainService.Shared.DataAccess;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using MongoDB.Driver;
using Moq;
using XUnitTest.Utilities;

namespace XUnitTest.Monitor
{
    /// <summary>
    /// The Alert recipients repository methods: the filters are rendered to BSON and asserted, since the in-memory
    /// tests can't run a real Mongo query.
    /// </summary>
    public class MonitorConfigurationRepoServiceAlertRecipientsTests
    {
        private static BsonDocument Render(FilterDefinition<MonitorConfiguration> filter) =>
            filter.Render(new RenderArgs<MonitorConfiguration>(BsonSerializer.LookupSerializer<MonitorConfiguration>(), BsonSerializer.SerializerRegistry));

        private static BsonDocument Render(UpdateDefinition<MonitorConfiguration> update) =>
            update.Render(new RenderArgs<MonitorConfiguration>(BsonSerializer.LookupSerializer<MonitorConfiguration>(), BsonSerializer.SerializerRegistry)).AsBsonDocument;

        private static void AssertBson(BsonDocument? actual, string expected) =>
            actual.Should().NotBeNull().And.Subject.As<BsonDocument>().Equals(BsonDocument.Parse(expected)).Should().BeTrue($"{actual} should equal {expected}");

        private static MonitorConfigurationRepoService Build(Mock<IMongoCollection<MonitorConfiguration>> collection, IMonitorDataAccess? access = null) =>
            new(new Mock<ILogger<MonitorConfigurationRepoService>>().Object, new MongoMocks.DbBuilder().With(collection).Provider,
                new Mock<IConfiguration>().Object, MongoMocks.BlocksSecret().Object, access ?? PassThroughMonitorDataAccess.Instance);

        private static MonitorEmailsUpdate Update(string id, IReadOnlyList<string>? previous, params string[] next) =>
            new(id, previous, next.ToList(), new DateTime(2026, 10, 28, 0, 0, 0, DateTimeKind.Utc), "user-1");

        [Fact]
        public void EditableFilter_ScopesToTheTenant_AndSpellsOutTheSourceTypePrecedence()
        {
            var rendered = Render(MonitorConfigurationRepoService.EditableMonitorsFilter("p1"));

            AssertBson(rendered, (
                "{ TenantId: 'p1', MonitorSourceType: { $nin: [0, 2] }, $nor: [ { MonitorSourceType: null, MonitorSourcetypes: { $in: [0, 2] } } ] }"));
        }

        [Fact]
        public void UpdateFilter_RequiresTheEditScope_TheMonitor_AndTheEmailsExactlyAsRead()
        {
            var edit = Builders<MonitorConfiguration>.Filter.Eq(m => m.TenantId, "p1");

            var rendered = Render(MonitorConfigurationRepoService.EmailsUpdateFilter(Update("m1", new[] { "ops@x.com" }, "ops@x.com", "a@x.com"), edit));

            AssertBson(rendered, ("{ TenantId: 'p1', _id: 'm1', Emails: ['ops@x.com'] }"));
        }

        [Theory]
        [InlineData(true)]
        [InlineData(false)]
        public void UpdateFilter_ForAnEmptyReadList_AlsoMatchesAMissingOrNullField(bool nullList)
        {
            var rendered = Render(MonitorConfigurationRepoService.EmailsUpdateFilter(
                Update("m1", nullList ? null : Array.Empty<string>(), "a@x.com"), Builders<MonitorConfiguration>.Filter.Empty));

            AssertBson(rendered, (
                "{ _id: 'm1', $or: [ { Emails: [] }, { Emails: { $exists: false } }, { Emails: null } ] }"));
        }

        [Fact]
        public void UpdateDefinition_SetsOnlyEmailsAndTheAuditFields()
        {
            var rendered = Render(MonitorConfigurationRepoService.EmailsUpdateDefinition(Update("m1", null, "a@x.com", "b@x.com")));

            rendered.Names.Should().Equal("$set");
            rendered["$set"].AsBsonDocument.Names.Should().Equal("Emails", "LastUpdatedDate", "LastUpdatedBy");
            rendered["$set"]["Emails"].AsBsonArray.Select(v => v.AsString).Should().Equal("a@x.com", "b@x.com");
        }

        [Fact]
        public async Task ViewRead_UsesTheFeatureProjection_IncludingTheLegacySourceTypeAndTenant()
        {
            var collection = MongoMocks.Collection(new List<MonitorConfiguration> { new() { ItemId = "m1" } });
            FindOptions<MonitorConfiguration, MonitorConfiguration>? options = null;
            FilterDefinition<MonitorConfiguration>? filter = null;
            collection.Setup(c => c.FindAsync(It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<FindOptions<MonitorConfiguration, MonitorConfiguration>>(), It.IsAny<CancellationToken>()))
                .Callback<FilterDefinition<MonitorConfiguration>, FindOptions<MonitorConfiguration, MonitorConfiguration>, CancellationToken>((f, o, _) => { filter = f; options = o; })
                .ReturnsAsync(() => MongoMocks.Cursor(new[] { new MonitorConfiguration { ItemId = "m1" } }).Object);

            var items = await Build(collection).GetEditableMonitorsForViewAsync("p1");

            items.Should().ContainSingle();
            Render(filter!)["TenantId"].AsString.Should().Be("p1");
            var projection = options!.Projection.Render(new RenderArgs<MonitorConfiguration>(BsonSerializer.LookupSerializer<MonitorConfiguration>(), BsonSerializer.SerializerRegistry)).Document;
            projection.Names.Should().BeEquivalentTo("_id", "Name", "MonitorConfigurationType", "MonitorSourceType", "MonitorSourcetypes", "TenantId", "IsActive", "Emails");
        }

        [Fact]
        public async Task ViewRead_KeepsTheResolversProjection_WhenItHasOne()
        {
            var resolverProjection = new BsonDocumentProjectionDefinition<MonitorConfiguration>(new BsonDocument("Name", 1));
            var access = new Mock<IMonitorDataAccess>();
            access.Setup(a => a.ReadAsync(It.IsAny<string>(), It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<string>(), null, true))
                .ReturnsAsync((string _, FilterDefinition<MonitorConfiguration> f, string _, string? _, bool _) =>
                    new ReadScope<MonitorConfiguration>(true, f, resolverProjection));
            var collection = MongoMocks.Collection(new List<MonitorConfiguration>());
            FindOptions<MonitorConfiguration, MonitorConfiguration>? options = null;
            collection.Setup(c => c.FindAsync(It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<FindOptions<MonitorConfiguration, MonitorConfiguration>>(), It.IsAny<CancellationToken>()))
                .Callback<FilterDefinition<MonitorConfiguration>, FindOptions<MonitorConfiguration, MonitorConfiguration>, CancellationToken>((_, o, _) => options = o)
                .ReturnsAsync(() => MongoMocks.Cursor(new List<MonitorConfiguration>()).Object);

            await Build(collection, access.Object).GetEditableMonitorsForViewAsync("p1");

            AssertBson(options!.Projection.Render(new RenderArgs<MonitorConfiguration>(BsonSerializer.LookupSerializer<MonitorConfiguration>(), BsonSerializer.SerializerRegistry)).Document,
                "{ Name: 1 }");
        }

        [Fact]
        public async Task Reads_ReturnNothing_WhenTheReadPolicyDenies()
        {
            var access = new Mock<IMonitorDataAccess>();
            access.Setup(a => a.ReadAsync(It.IsAny<string>(), It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<string>(), null, It.IsAny<bool>()))
                .ReturnsAsync((string _, FilterDefinition<MonitorConfiguration> f, string _, string? _, bool _) => new ReadScope<MonitorConfiguration>(false, f, null));
            var repo = Build(MongoMocks.Collection(new List<MonitorConfiguration> { new() { ItemId = "m1" } }), access.Object);

            (await repo.GetEditableMonitorsForViewAsync("p1")).Should().BeEmpty();
            (await repo.GetEditableMonitorsAsync("p1")).Should().BeEmpty();
            (await repo.GetEditableMonitorsMissingEmailsAsync("p1", new[] { "a@x.com" })).Should().BeEmpty();
        }

        [Fact]
        public async Task Reads_FailLoudly()
        {
            // Unlike GetConfigurationListByTenantIdAsync, an unreachable database is never an empty project.
            var repo = Build(MongoMocks.CollectionThrowing<MonitorConfiguration>());

            await FluentActions.Awaiting(() => repo.GetEditableMonitorsForViewAsync("p1")).Should().ThrowAsync<MongoException>();
            await FluentActions.Awaiting(() => repo.GetEditableMonitorsAsync("p1")).Should().ThrowAsync<MongoException>();
            await FluentActions.Awaiting(() => repo.GetEditableMonitorsMissingEmailsAsync("p1", new[] { "a@x.com" })).Should().ThrowAsync<MongoException>();
        }

        [Fact]
        public async Task FullRead_ByIds_AndMissingRead_RenderTheirFilters()
        {
            var collection = MongoMocks.Collection(new List<MonitorConfiguration>());
            var filters = new List<BsonDocument>();
            var access = new Mock<IMonitorDataAccess>();
            access.Setup(a => a.ReadAsync(It.IsAny<string>(), It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<string>(), null, false))
                .ReturnsAsync((string _, FilterDefinition<MonitorConfiguration> f, string _, string? _, bool _) =>
                {
                    filters.Add(Render(f));
                    return new ReadScope<MonitorConfiguration>(true, f, null);
                });
            var repo = Build(collection, access.Object);

            await repo.GetEditableMonitorsAsync("p1", new[] { "m1", "m2" });
            await repo.GetEditableMonitorsMissingEmailsAsync("p1", new[] { "a@x.com", "b@x.com" });

            filters[0].ToString().Should().Contain("\"_id\" : { \"$in\" : [\"m1\", \"m2\"] }");
            filters[1].ToString().Should().Contain("\"Emails\" : { \"$not\" : { \"$all\" : [\"a@x.com\", \"b@x.com\"] } }");
            filters.Should().OnlyContain(f => f.ToString().Contains("\"TenantId\" : \"p1\""));
        }

        [Fact]
        public async Task EditFilter_IsOneCallForTheTenantAndAllIds()
        {
            var access = new Mock<IMonitorDataAccess>();
            BsonDocument? sent = null;
            access.Setup(a => a.EditFilterAsync(It.IsAny<string>(), It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<string>(), null))
                .Callback<string, FilterDefinition<MonitorConfiguration>, string, string?>((_, f, _, _) => sent = Render(f))
                .ReturnsAsync((FilterDefinition<MonitorConfiguration>?)null);

            var result = await Build(MongoMocks.Collection<MonitorConfiguration>(), access.Object).GetEmailsEditFilterAsync("p1", new[] { "m1", "m2" });

            result.Should().BeNull();
            AssertBson(sent, ("{ TenantId: 'p1', _id: { $in: ['m1', 'm2'] } }"));
            access.Verify(a => a.EditFilterAsync(MonitorSchemas.MonitorConfiguration, It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<string>(), null), Times.Once);
        }

        /// <summary>Counts how many rule checks run at once.</summary>
        private sealed class ConcurrencyProbe : IMonitorDataAccess
        {
            private int _current;
            public int Max;
            public int Calls;
            public HashSet<string> Refuse { get; } = new();

            public async Task CheckUpdateAsync<T>(string schema, UpdateDefinition<T> update, string callSite, string? tenantId = null)
            {
                Interlocked.Increment(ref Calls);
                var now = Interlocked.Increment(ref _current);
                lock (this) Max = Math.Max(Max, now);
                await Task.Delay(20);
                Interlocked.Decrement(ref _current);
                var rendered = update.Render(new RenderArgs<T>(BsonSerializer.LookupSerializer<T>(), BsonSerializer.SerializerRegistry)).AsBsonDocument;
                var first = rendered["$set"]["Emails"].AsBsonArray.FirstOrDefault()?.AsString;
                if (first is not null && Refuse.Contains(first))
                    throw FailedRule();
            }

            private static DataValidationException FailedRule()
            {
                var result = new DataValidationResult();
                result.AddError("Emails", "not allowed", "Custom");
                return new DataValidationException(result);
            }

            public Task<ReadScope<T>> ReadAsync<T>(string schema, FilterDefinition<T> filter, string callSite, string? tenantId = null, bool useProjection = true) => throw new NotSupportedException();
            public Task<FilterDefinition<T>?> EditFilterAsync<T>(string schema, FilterDefinition<T> filter, string callSite, string? tenantId = null) => throw new NotSupportedException();
            public Task<FilterDefinition<T>?> DeleteFilterAsync<T>(string schema, FilterDefinition<T> filter, string callSite, string? tenantId = null) => throw new NotSupportedException();
            public Task<bool> InsertAllowedAsync(string schema, string callSite, string? tenantId = null) => throw new NotSupportedException();
            public Task<T> PrepareWriteAsync<T>(string schema, T entity, bool isInsert, string callSite, string? tenantId = null) => throw new NotSupportedException();
            public Task<T> PrepareUpsertAsync<T>(string schema, T entity, IMongoCollection<T> collection, FilterDefinition<T> filter, string callSite, string? tenantId = null) => throw new NotSupportedException();
            public Task<T> PrepareReplaceAsync<T>(string schema, T entity, IMongoCollection<T> collection, FilterDefinition<T> filter, string callSite, string? tenantId = null) => throw new NotSupportedException();
        }

        [Fact]
        public async Task Section5_RuleChecks_RunInParallel_AtMost16AtOnce_AndReportRefusalsInInputOrder()
        {
            // Q1: one CheckUpdateAsync per changed monitor at bounded parallelism 16.
            var probe = new ConcurrencyProbe();
            probe.Refuse.UnionWith(new[] { "e7@x.com", "e3@x.com" });
            var updates = Enumerable.Range(0, 64).Select(i => Update($"m{i}", null, $"e{i}@x.com")).ToList();

            var failures = await Build(MongoMocks.Collection<MonitorConfiguration>(), probe).CheckEmailsUpdatesAsync(updates);

            probe.Calls.Should().Be(64);
            probe.Max.Should().BeGreaterThan(1).And.BeLessThanOrEqualTo(16);
            failures.Select(f => f.ItemId).Should().Equal("m3", "m7");
            failures[0].Error.Result.Errors.Should().ContainSingle();
        }

        [Fact]
        public async Task BulkUpdate_IsOneUnorderedWriteOfUpdateOnes_ReturningTheMatchedCount()
        {
            var collection = MongoMocks.Collection<MonitorConfiguration>();
            IEnumerable<WriteModel<MonitorConfiguration>>? models = null;
            BulkWriteOptions? options = null;
            collection.Setup(c => c.BulkWriteAsync(It.IsAny<IEnumerable<WriteModel<MonitorConfiguration>>>(), It.IsAny<BulkWriteOptions>(), It.IsAny<CancellationToken>()))
                .Callback<IEnumerable<WriteModel<MonitorConfiguration>>, BulkWriteOptions, CancellationToken>((m, o, _) => { models = m.ToList(); options = o; })
                .ReturnsAsync(new BulkWriteResult<MonitorConfiguration>.Acknowledged(2, 1, 0, 0, 1, Array.Empty<WriteModel<MonitorConfiguration>>(), Array.Empty<BulkWriteUpsert>()));
            var repo = Build(collection);

            var matched = await repo.BulkUpdateEmailsAsync(new[] { Update("m1", null, "a@x.com"), Update("m2", new[] { "b@x.com" }, "b@x.com", "a@x.com") },
                Builders<MonitorConfiguration>.Filter.Eq(m => m.TenantId, "p1"));

            matched.Should().Be(1);
            options!.IsOrdered.Should().BeFalse();
            models.Should().HaveCount(2).And.AllBeOfType<UpdateOneModel<MonitorConfiguration>>();
            var second = (UpdateOneModel<MonitorConfiguration>)models!.Last();
            AssertBson(Render(second.Filter), ("{ TenantId: 'p1', _id: 'm2', Emails: ['b@x.com'] }"));
            (await repo.BulkUpdateEmailsAsync(Array.Empty<MonitorEmailsUpdate>(), Builders<MonitorConfiguration>.Filter.Empty)).Should().Be(0);
            collection.Verify(c => c.BulkWriteAsync(It.IsAny<IEnumerable<WriteModel<MonitorConfiguration>>>(), It.IsAny<BulkWriteOptions>(), It.IsAny<CancellationToken>()), Times.Once);
        }

        [Theory]
        [InlineData(1, true)]
        [InlineData(0, false)]
        public async Task SingleUpdate_ReportsWhetherItMatched(long matchedCount, bool expected)
        {
            var collection = MongoMocks.Collection<MonitorConfiguration>();
            collection.Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<UpdateDefinition<MonitorConfiguration>>(), It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new UpdateResult.Acknowledged(matchedCount, matchedCount, null));

            (await Build(collection).UpdateEmailsAsync(Update("m1", null, "a@x.com"), Builders<MonitorConfiguration>.Filter.Empty)).Should().Be(expected);
        }
    }
}
