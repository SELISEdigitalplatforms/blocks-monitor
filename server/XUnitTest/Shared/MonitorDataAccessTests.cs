using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Blocks.Genesis;
using Blocks.Genesis.DataAccess;
using Blocks.Genesis.DataAccess.Rules;
using Blocks.Genesis.Entities.Monitor;
using DomainService.Shared.DataAccess;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using MongoDB.Bson;
using MongoDB.Driver;
using Moq;

namespace XUnitTest.Shared
{
    /// <summary>
    /// The Monitor data-access wrapper (a copy of OS's): row filters from the access policies, and the Genesis
    /// rules and defaults on writes, only for schemas the allow-list opens, only with a signed-in user.
    /// </summary>
    public class MonitorDataAccessTests : IDisposable
    {
        private readonly Mock<IDataAccessResolver> _resolver = new();
        private readonly MonitorDataAccess _sut;
        private BsonDocument? _sent;

        public MonitorDataAccessTests()
        {
            BlocksContext.IsTestMode = true;
            SetContext(authenticated: true);
            _sut = new MonitorDataAccess(_resolver.Object, NullLogger<MonitorDataAccess>.Instance);
        }

        public void Dispose()
        {
            BlocksContext.SetContext(null);
            BlocksContext.IsTestMode = false;
        }

        private static void SetContext(bool authenticated) =>
            BlocksContext.SetContext(BlocksContext.Create(
                "t1", new[] { "role" }, "user-1", authenticated, "uri", "org",
                DateTime.UtcNow.AddHours(1), "e@x.com", new[] { "perm" }, "octo",
                "phone", "display", "oauth", "t1"));

        /// <summary>The resolver answers with <paramref name="change"/> applied to the document it was sent.</summary>
        private void Resolves(Action<BsonDocument>? change = null, DataValidationResult? validation = null) =>
            _resolver.Setup(r => r.ResolveWriteAsync(It.IsAny<string>(), It.IsAny<BsonDocument>(), It.IsAny<bool>(), null, It.IsAny<CancellationToken>()))
                .ReturnsAsync((string _, BsonDocument document, bool _, BsonDocument? _, CancellationToken _) =>
                {
                    _sent = document;
                    change?.Invoke(document);
                    return new ResolvedWrite(document, validation ?? new DataValidationResult(), DefaultsApplied: change is not null);
                });

        private static DataValidationResult Failed(string field, string message)
        {
            var result = new DataValidationResult();
            result.AddError(field, message, "MaxLength");
            return result;
        }

        private void NeverWrites() =>
            _resolver.Verify(r => r.ResolveWriteAsync(It.IsAny<string>(), It.IsAny<BsonDocument>(), It.IsAny<bool>(), It.IsAny<BsonDocument?>(), It.IsAny<CancellationToken>()), Times.Never);

        [Fact]
        public async Task Insert_DefaultsLandInTheCallersOwnInstance()
        {
            Resolves(document => document["ExpectedContent"] = "OK");
            var monitor = new MonitorConfiguration { ItemId = "m1", Name = "api", Url = "https://api.test" };

            var returned = await _sut.PrepareWriteAsync(MonitorSchemas.MonitorConfiguration, monitor, isInsert: true, "test");

            returned.Should().BeSameAs(monitor);
            monitor.ExpectedContent.Should().Be("OK");
            monitor.Url.Should().Be("https://api.test");
            _resolver.Verify(r => r.ResolveWriteAsync("MonitorConfiguration", It.IsAny<BsonDocument>(), true, null, It.IsAny<CancellationToken>()), Times.Once);
        }

        [Fact]
        public async Task Insert_AddsTheRequesterToReadUpdateAndDeleteUserIds_KeepingIdsAlreadyThere()
        {
            Resolves();
            var record = new MonitorConfiguration { ItemId = "m1", Name = "api", Url = "https://api.test" };
            record.Read = new OperationAccess { UserIds = ["user-9"], Roles = ["admin"] };
            record.Update = new OperationAccess { UserIds = ["user-1"] };

            await _sut.PrepareWriteAsync(MonitorSchemas.MonitorConfiguration, record, isInsert: true, "test");

            record.Read!.UserIds.Should().Equal("user-9", "user-1");
            record.Read.Roles.Should().Equal("admin");
            record.Update!.UserIds.Should().Equal("user-1");   // once
            record.Delete!.UserIds.Should().Equal("user-1");
            record.Create.Should().BeNull();
        }

        [Fact]
        public async Task Insert_OnASchemaWithoutRules_StillAddsTheRequester()
        {
            var record = new MonitorConfiguration { ItemId = "m1", Name = "api", Url = "https://api.test" };

            await _sut.PrepareWriteAsync(MonitorSchemas.MonitorIncident, record, isInsert: true, "test");

            record.Read!.UserIds.Should().Equal("user-1");
        }

        [Fact]
        public async Task AReplace_OrAnInsertWithoutASignedInUser_AddsNoRequester()
        {
            Resolves();
            var replaced = new MonitorConfiguration { ItemId = "m1", Name = "api", Url = "https://api.test" };
            await _sut.PrepareWriteAsync(MonitorSchemas.MonitorConfiguration, replaced, isInsert: false, "test");
            replaced.Read.Should().BeNull();

            SetContext(authenticated: false);
            var anonymous = new MonitorConfiguration { ItemId = "m1", Name = "api", Url = "https://api.test" };
            await _sut.PrepareWriteAsync(MonitorSchemas.MonitorConfiguration, anonymous, isInsert: true, "test");
            anonymous.Read.Should().BeNull();
        }

        [Fact]
        public async Task ABrokenRule_Throws_WithThePropertyAndMessage()
        {
            Resolves(validation: Failed("Name", "Name must be at most 5 characters"));

            var act = () => _sut.PrepareWriteAsync(MonitorSchemas.MonitorConfiguration, new MonitorConfiguration { ItemId = "m1", Name = "a long name" }, isInsert: false, "test");

            (await act.Should().ThrowAsync<DataValidationException>()).Which.Result.Errors.Should().ContainSingle()
                .Which.FieldName.Should().Be("Name");
        }

        [Theory]
        [InlineData(MonitorSchemas.MonitorIncident)]
        [InlineData(MonitorSchemas.MonitorPingLog)]
        public async Task AccessOnlySchemas_NeverReachTheRules(string schema)
        {
            await _sut.PrepareWriteAsync(schema, new MonitorIncident(), isInsert: true, "test");
            await _sut.CheckUpdateAsync(schema, Builders<MonitorIncident>.Update.Set(i => i.FailureReason, "x"), "test");

            NeverWrites();
        }

        [Fact]
        public async Task WithoutASignedInUser_NothingRuns_AndTheOriginalFilterIsKept()
        {
            SetContext(authenticated: false);
            var filter = Builders<MonitorConfiguration>.Filter.Eq(m => m.ItemId, "m1");

            await _sut.PrepareWriteAsync(MonitorSchemas.MonitorConfiguration, new MonitorConfiguration(), isInsert: true, "test");
            var scope = await _sut.ReadAsync(MonitorSchemas.MonitorConfiguration, filter, "test");

            scope.Granted.Should().BeTrue();
            scope.Filter.Should().BeSameAs(filter);
            NeverWrites();
            _resolver.Verify(r => r.ResolveReadAsync(It.IsAny<string>(), It.IsAny<BsonDocument>(), It.IsAny<IReadOnlyList<string>?>(), It.IsAny<CancellationToken>()), Times.Never);
        }

        [Fact]
        public async Task APartialUpdate_SendsOnlyItsSetFields()
        {
            Resolves();
            var update = Builders<MonitorConfiguration>.Update
                .Set(m => m.IntervalInSeconds, 15)
                .Set("Regions.0", "eu")
                .Set(m => m.Name, "api");

            await _sut.CheckUpdateAsync(MonitorSchemas.MonitorConfiguration, update, "test");

            _sent.Should().BeEquivalentTo(new BsonDocument { { "IntervalInSeconds", 15 }, { "Name", "api" } });
        }

        [Fact]
        public async Task AMissingSchema_IsAllowed()
        {
            _resolver.Setup(r => r.ResolveWriteAsync(It.IsAny<string>(), It.IsAny<BsonDocument>(), It.IsAny<bool>(), null, It.IsAny<CancellationToken>()))
                .ThrowsAsync(new KeyNotFoundException("no schema"));
            var monitor = new MonitorConfiguration { ItemId = "m1" };

            (await _sut.PrepareWriteAsync(MonitorSchemas.MonitorConfiguration, monitor, isInsert: true, "test")).Should().BeSameAs(monitor);
        }

        [Fact]
        public void AReadScope_GivesAHandBuiltPipelineThePolicyFilterAsItsFirstMatchStage()
        {
            var policyFilter = new BsonDocument { { "MonitorId", "m1" }, { "Read.Roles", "admin" } };
            var scope = new ReadScope<MonitorIncident>(true, new BsonDocumentFilterDefinition<MonitorIncident>(policyFilter), null);

            scope.MatchStage().Should().BeEquivalentTo(new BsonDocument("$match", policyFilter));
        }

        [Fact]
        public void Registration_IsIdempotent_AndReusesAResolverTheHostAlreadyHas()
        {
            var services = new ServiceCollection();
            services.AddBlocksDataAccess();   // e.g. Logic's own registration, before the Monitor driver's

            services.AddMonitorDataAccess();
            services.AddMonitorDataAccess();

            services.Count(d => d.ServiceType == typeof(IMonitorDataAccess)).Should().Be(1);
            services.Count(d => d.ServiceType == typeof(IDataAccessResolver)).Should().Be(1);
        }
    }
}
