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
    }
}
