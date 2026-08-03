using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using Blocks.Genesis;
using DomainService.Shared.Services;
using DomainService.Alert.Entities;
using DomainService.Alert.Services;
using DomainService.Health.HealthWorkerService;
using DomainService.Health.Models;
using DomainService.Health.Services;
using DomainService.Monitor.Entity;
using DomainService.Shared.Models;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using XUnitTest.Utilities;

namespace XUnitTest.Health
{
    public class HealthConfigurationServiceTests
    {
        private HealthConfigurationService Build(
            IEnumerable<MonitorConfiguration> configs = null,
            IEnumerable<MonitorIncident> incidents = null)
        {
            var db = new MongoMocks.DbBuilder()
                .With(configs ?? new List<MonitorConfiguration>())
                .With(incidents ?? new List<MonitorIncident>())
                .With(new List<ProjectPeople>())
                .With(new List<AlertMailTemplate>())
                .With(new List<MailServerConfiguration>());
            var secret = MongoMocks.BlocksSecret().Object;

            var healthRepo = new HealthConfigurationRepoService(
                new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, secret);

            var alertRepo = new AlertRepoService(db.Provider, secret);
            var email = new EmailAlertService(new Mock<ILogger<EmailAlertService>>().Object, alertRepo);
            var http = new Mock<IHttpHelperServices>();
            http.Setup(h => h.MakeHttpRequest<NotificationResponse>(
                    It.IsAny<string>(), It.IsAny<string>(), It.IsAny<HttpMethod>(),
                    It.IsAny<object>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<string>()))
                .ReturnsAsync((new NotificationResponse { IsSuccess = true }, new HttpResponseMessage(HttpStatusCode.OK)));
            var crypto = new Mock<ICryptoService>();
            var tenants = new Mock<ITenants>();
            var notification = new NotificationAlertService(
                new Mock<ILogger<NotificationAlertService>>().Object, http.Object, crypto.Object, tenants.Object, alertRepo, new Mock<IConfiguration>().Object);

            var incidentService = new HealthIncidentService(
                new Mock<ILogger<HealthIncidentService>>().Object, db.Provider, healthRepo, email, notification, secret);

            var healthCheck = new HealthCheckService(
                new HealthQueueManager(), new Mock<ILogger<HealthCheckService>>().Object, healthRepo, incidentService, workerCount: 1);

            var configuration = new Mock<IConfiguration>();
            configuration.Setup(c => c["AlertServiceUrl"]).Returns("http://alert");

            return new HealthConfigurationService(
                new Mock<ILogger<HealthConfigurationService>>().Object, healthCheck, configuration.Object, healthRepo);
        }

        // Same wiring as Build, but with a caller-supplied MonitorConfiguration collection so that
        // read/write failures and specific stored documents can be simulated.
        private HealthConfigurationService BuildWithConfigCollection(
            Mock<MongoDB.Driver.IMongoCollection<MonitorConfiguration>> configColl)
        {
            var db = new MongoMocks.DbBuilder()
                .With(configColl)
                .With(new List<MonitorIncident>())
                .With(new List<ProjectPeople>())
                .With(new List<AlertMailTemplate>())
                .With(new List<MailServerConfiguration>());
            var secret = MongoMocks.BlocksSecret().Object;

            var healthRepo = new HealthConfigurationRepoService(
                new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, secret);
            var alertRepo = new AlertRepoService(db.Provider, secret);
            var email = new EmailAlertService(new Mock<ILogger<EmailAlertService>>().Object, alertRepo);
            var http = new Mock<IHttpHelperServices>();
            http.Setup(h => h.MakeHttpRequest<NotificationResponse>(
                    It.IsAny<string>(), It.IsAny<string>(), It.IsAny<HttpMethod>(),
                    It.IsAny<object>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<string>()))
                .ReturnsAsync((new NotificationResponse { IsSuccess = true }, new HttpResponseMessage(HttpStatusCode.OK)));
            var notification = new NotificationAlertService(
                new Mock<ILogger<NotificationAlertService>>().Object, http.Object,
                new Mock<ICryptoService>().Object, new Mock<ITenants>().Object, alertRepo, new Mock<IConfiguration>().Object);
            var incidentService = new HealthIncidentService(
                new Mock<ILogger<HealthIncidentService>>().Object, db.Provider, healthRepo, email, notification, secret);
            var healthCheck = new HealthCheckService(
                new HealthQueueManager(), new Mock<ILogger<HealthCheckService>>().Object, healthRepo, incidentService, workerCount: 1);
            var configuration = new Mock<IConfiguration>();
            configuration.Setup(c => c["AlertServiceUrl"]).Returns("http://alert");

            return new HealthConfigurationService(
                new Mock<ILogger<HealthConfigurationService>>().Object, healthCheck, configuration.Object, healthRepo);
        }

        [Fact]
        public async Task SaveConfigurationAsync_WhenSourceTypeUnparseable_ReturnsError()
        {
            var request = new SaveHealthConfigurationRequest { ProjectKey = "p", Name = "n", MonitorSourceType = "Nope" };

            var result = await Build().SaveConfigurationAsync(request);

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("Invalid MonitorSourceType: Nope");
        }

        [Fact]
        public async Task SaveConfigurationAsync_WhenSourceTypeIsInfrastructure_ReturnsError()
        {
            var request = new SaveHealthConfigurationRequest { ProjectKey = "p", Name = "n", MonitorSourceType = "Infrastructure" };

            var result = await Build().SaveConfigurationAsync(request);

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("Invalid MonitorSourceType");
        }

        [Fact]
        public async Task SaveConfigurationAsync_ValidRequest_CreatesInboundPingConfiguration()
        {
            var request = new SaveHealthConfigurationRequest
            {
                ProjectKey = "p",
                Name = "svc",
                IntervalInSeconds = 30,
                GracePeriodInSeconds = 10,
                IsActive = true
            };

            var result = await Build().SaveConfigurationAsync(request);

            result.IsSuccess.Should().BeTrue();
            var saved = result.Data.Should().BeOfType<MonitorConfiguration>().Subject;
            saved.MonitorConfigurationType.Should().Be(MonitorConfigurationTypes.InboundPing);
            saved.Url.Should().StartWith("http://alert/");
        }

        [Fact]
        public async Task SaveConfigurationAsync_ExternalServiceType_SetsExternalServiceId()
        {
            var request = new SaveHealthConfigurationRequest
            {
                ProjectKey = "p",
                Name = "svc",
                MonitorSourceType = "ExternalServices",
                ExternalServiceId = "ext-1",
                IntervalInSeconds = 30,
                GracePeriodInSeconds = 5
            };

            var result = await Build().SaveConfigurationAsync(request);

            result.IsSuccess.Should().BeTrue();
            var saved = result.Data.Should().BeOfType<MonitorConfiguration>().Subject;
            saved.MonitorSourceType.Should().Be(MonitorSourceTypes.ExternalServices);
            saved.ExternalServiceId.Should().Be("ext-1");
        }

        [Fact]
        public async Task UpdateConfigurationAsync_WhenNotFound_ReturnsNotFound()
        {
            var request = new UpdateHealthConfigurationRequest { ItemId = "missing", Name = "n" };

            var result = await Build().UpdateConfigurationAsync(request);

            result.IsSuccess.Should().BeFalse();
            result.StatusCode.Should().Be(HttpStatusCode.NotFound);
        }

        [Fact]
        public async Task UpdateConfigurationAsync_WhenFound_UpdatesAllowedFields()
        {
            var existing = new MonitorConfiguration { ItemId = "m1", Name = "old", IntervalInSeconds = 10, IsActive = false };
            var request = new UpdateHealthConfigurationRequest
            {
                ItemId = "m1",
                Name = "new",
                IntervalInSeconds = 60,
                GracePeriodInSeconds = 20,
                IsActive = true
            };

            var result = await Build(configs: new List<MonitorConfiguration> { existing }).UpdateConfigurationAsync(request);

            result.IsSuccess.Should().BeTrue();
            var updated = result.Data.Should().BeOfType<MonitorConfiguration>().Subject;
            updated.Name.Should().Be("new");
            updated.IntervalInSeconds.Should().Be(60);
            updated.IsActive.Should().BeTrue();
        }

        [Fact]
        public async Task UpdateConfigurationAsync_WhenEmailsProvided_ReplacesEmails()
        {
            var existing = new MonitorConfiguration { ItemId = "m1", Name = "old", Emails = new List<string> { "old@test" } };
            var request = new UpdateHealthConfigurationRequest
            {
                ItemId = "m1",
                Name = "new",
                Emails = new List<string> { "a@test", "b@test" }
            };

            var result = await Build(configs: new List<MonitorConfiguration> { existing }).UpdateConfigurationAsync(request);

            var updated = result.Data.Should().BeOfType<MonitorConfiguration>().Subject;
            updated.Emails.Should().BeEquivalentTo("a@test", "b@test");
        }

        [Fact]
        public async Task SaveConfigurationAsync_WhenRepositoryThrows_ReturnsError()
        {
            var coll = MongoMocks.Collection(new List<MonitorConfiguration>());
            coll.Setup(c => c.ReplaceOneAsync(It.IsAny<MongoDB.Driver.FilterDefinition<MonitorConfiguration>>(), It.IsAny<MonitorConfiguration>(),
                    It.IsAny<MongoDB.Driver.ReplaceOptions>(), It.IsAny<System.Threading.CancellationToken>()))
                .ThrowsAsync(new MongoDB.Driver.MongoException("boom"));

            var result = await BuildWithConfigCollection(coll).SaveConfigurationAsync(
                new SaveHealthConfigurationRequest { ProjectKey = "p", Name = "n" });

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("Error saving configuration");
        }

        [Fact]
        public async Task UpdateConfigurationAsync_WhenRepositoryThrows_ReturnsError()
        {
            var coll = MongoMocks.Collection(new List<MonitorConfiguration> { new() { ItemId = "m1", Name = "old" } });
            coll.Setup(c => c.ReplaceOneAsync(It.IsAny<MongoDB.Driver.FilterDefinition<MonitorConfiguration>>(), It.IsAny<MonitorConfiguration>(),
                    It.IsAny<MongoDB.Driver.ReplaceOptions>(), It.IsAny<System.Threading.CancellationToken>()))
                .ThrowsAsync(new MongoDB.Driver.MongoException("boom"));

            var result = await BuildWithConfigCollection(coll).UpdateConfigurationAsync(
                new UpdateHealthConfigurationRequest { ItemId = "m1", Name = "new" });

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("Error updating configuration");
        }

        [Fact]
        public async Task UpdateConfigurationAsync_WhenCrossTenant_ReturnsNotFound()
        {
            var existing = new MonitorConfiguration { ItemId = "m1", Name = "old", TenantId = "tenant-a" };
            try
            {
                SetCaller("tenant-b");
                var result = await Build(configs: new List<MonitorConfiguration> { existing }).UpdateConfigurationAsync(
                    new UpdateHealthConfigurationRequest { ItemId = "m1", Name = "new" });

                result.IsSuccess.Should().BeFalse();
                result.StatusCode.Should().Be(HttpStatusCode.NotFound);
            }
            finally
            {
                Blocks.Genesis.BlocksContext.ClearContext();
            }
        }

        [Fact]
        public async Task DeleteConfigurationAsync_WhenNotFound_ReturnsFailure()
        {
            var result = await Build().DeleteConfigurationAsync("missing");

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("not found");
        }

        [Fact]
        public async Task DeleteConfigurationAsync_WhenFound_DeletesSuccessfully()
        {
            var existing = new MonitorConfiguration { ItemId = "m1", MonitorSourceType = MonitorSourceTypes.DeployedServices };

            var result = await Build(configs: new List<MonitorConfiguration> { existing }).DeleteConfigurationAsync("m1");

            result.IsSuccess.Should().BeTrue();
            result.Message.Should().Contain("deleted successfully");
        }

        [Fact]
        public async Task DeleteConfigurationAsync_WhenBlocksServices_IsRejected()
        {
            var existing = new MonitorConfiguration { ItemId = "m1", MonitorSourceType = MonitorSourceTypes.BlocksServices };

            var result = await Build(configs: new List<MonitorConfiguration> { existing }).DeleteConfigurationAsync("m1");

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("not found");
        }

        [Fact]
        public async Task DeleteConfigurationAsync_WhenInfrastructure_IsRejected()
        {
            // Infrastructure heartbeats are platform-owned. This is the sibling guard to the
            // BlocksServices case above and was the only one of the two left unexercised.
            var existing = new MonitorConfiguration { ItemId = "m1", MonitorSourceType = MonitorSourceTypes.Infrastructure };

            var result = await Build(configs: new List<MonitorConfiguration> { existing }).DeleteConfigurationAsync("m1");

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("not found");
        }

        [Theory]
        [InlineData(MonitorSourceTypes.DeployedServices)]
        [InlineData(MonitorSourceTypes.ExternalServices)]
        [InlineData(MonitorSourceTypes.OtherServices)]
        public async Task DeleteConfigurationAsync_AllowsTheTenantOwnedSourceTypes(MonitorSourceTypes sourceType)
        {
            // Pins which side of the guard each source type falls on, so adding a new member to
            // the enum cannot quietly become deletable or undeletable.
            var existing = new MonitorConfiguration { ItemId = "m1", MonitorSourceType = sourceType };

            var result = await Build(configs: new List<MonitorConfiguration> { existing }).DeleteConfigurationAsync("m1");

            result.IsSuccess.Should().BeTrue();
        }

        [Fact]
        public async Task DeleteConfigurationAsync_RefusalsAreIndistinguishableFromAbsence()
        {
            // All three refusal paths deliberately return the same "not found" message, so a
            // caller cannot probe for the existence of a heartbeat it may not touch. If one of
            // them ever starts saying "forbidden", that becomes an enumeration oracle.
            var platformOwned = new MonitorConfiguration { ItemId = "m1", MonitorSourceType = MonitorSourceTypes.Infrastructure };

            var missing = await Build().DeleteConfigurationAsync("m1");
            var refused = await Build(configs: new List<MonitorConfiguration> { platformOwned }).DeleteConfigurationAsync("m1");

            refused.Message.Should().Be(missing.Message);
            refused.StatusCode.Should().Be(missing.StatusCode);
        }

        [Fact]
        public async Task DeleteConfigurationAsync_WhenCrossTenant_ReturnsNotFound()
        {
            var existing = new MonitorConfiguration { ItemId = "m1", TenantId = "tenant-a", MonitorSourceType = MonitorSourceTypes.DeployedServices };
            try
            {
                SetCaller("tenant-b");
                var result = await Build(configs: new List<MonitorConfiguration> { existing }).DeleteConfigurationAsync("m1");

                result.IsSuccess.Should().BeFalse();
                result.Message.Should().Contain("not found");
            }
            finally
            {
                Blocks.Genesis.BlocksContext.ClearContext();
            }
        }

        [Fact]
        public async Task DeleteConfigurationAsync_WhenDeleteReturnsFalse_StillReportsSuccess()
        {
            // The repository reports nothing was deleted (0 rows); the service logs a warning but still
            // returns a success response so the caller sees an idempotent delete.
            var coll = MongoMocks.Collection(new List<MonitorConfiguration> { new() { ItemId = "m1", MonitorSourceType = MonitorSourceTypes.DeployedServices } });
            coll.Setup(c => c.DeleteOneAsync(It.IsAny<MongoDB.Driver.FilterDefinition<MonitorConfiguration>>(), It.IsAny<System.Threading.CancellationToken>()))
                .ReturnsAsync(new MongoDB.Driver.DeleteResult.Acknowledged(0));

            var result = await BuildWithConfigCollection(coll).DeleteConfigurationAsync("m1");

            result.IsSuccess.Should().BeTrue();
        }

        private static void SetCaller(string tenantId)
        {
            var ctx = Blocks.Genesis.BlocksContext.Create(
                tenantId, null, "user-1", true, null, null,
                System.DateTime.UtcNow.AddHours(1), null, null, null, null, null, null, null);
            Blocks.Genesis.BlocksContext.SetContext(ctx);
        }
    }
}
