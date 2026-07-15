using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using Api.Controllers;
using Blocks.Genesis;
using Devops.DomainService.Shared.Interfaces;
using DomainService.Alert.Entities;
using DomainService.Alert.Services;
using DomainService.Health.HealthWorkerService;
using DomainService.Health.Models;
using DomainService.Health.Services;
using DomainService.Monitor.Entity;
using DomainService.Monitor.Services;
using DomainService.Shared.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using XUnitTest.Utilities;

namespace XUnitTest.Api
{
    public class HealthControllerTests
    {
        private readonly Mock<IMonitorConfigurationService> _monitorService = new();

        private HealthController Build(IEnumerable<MonitorConfiguration> configs = null)
        {
            var db = new MongoMocks.DbBuilder()
                .With(configs ?? new List<MonitorConfiguration>())
                .With(new List<MonitorIncident>())
                .With(new List<ProjectPeople>())
                .With(new List<AlertMailTemplate>())
                .With(new List<MailServerConfiguration>());
            var secret = MongoMocks.BlocksSecret().Object;

            var healthRepo = new HealthConfigurationRepoService(new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, secret);
            var alertRepo = new AlertRepoService(db.Provider, secret);
            var email = new EmailAlertService(new Mock<ILogger<EmailAlertService>>().Object, alertRepo);
            var http = new Mock<IHttpHelperServices>();
            http.Setup(h => h.MakeHttpRequest<NotificationResponse>(
                    It.IsAny<string>(), It.IsAny<string>(), It.IsAny<HttpMethod>(),
                    It.IsAny<object>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<string>()))
                .ReturnsAsync((new NotificationResponse { IsSuccess = true }, new HttpResponseMessage(HttpStatusCode.OK)));
            var notification = new NotificationAlertService(new Mock<ILogger<NotificationAlertService>>().Object, http.Object,
                new Mock<ICryptoService>().Object, new Mock<ITenants>().Object, alertRepo, new Mock<IConfiguration>().Object);
            var incidentService = new HealthIncidentService(new Mock<ILogger<HealthIncidentService>>().Object, db.Provider, healthRepo, email, notification, secret);
            var healthCheck = new HealthCheckService(new HealthQueueManager(), new Mock<ILogger<HealthCheckService>>().Object, healthRepo, incidentService, 1);

            var configuration = new Mock<IConfiguration>();
            configuration.Setup(c => c["AlertServiceUrl"]).Returns("http://alert");
            var healthConfig = new HealthConfigurationService(new Mock<ILogger<HealthConfigurationService>>().Object, healthCheck, configuration.Object, healthRepo);

            return new HealthController(healthConfig, healthCheck, _monitorService.Object);
        }

        [Fact]
        public async Task SaveHealth_ReturnsOkWithServiceResult()
        {
            var request = new SaveHealthConfigurationRequest { ProjectKey = "p", Name = "svc", IntervalInSeconds = 30, GracePeriodInSeconds = 5 };

            var result = await Build().SaveHealth(request);

            var body = (BaseApiResponse)result.Should().BeOfType<OkObjectResult>().Subject.Value;
            body.IsSuccess.Should().BeTrue();
        }

        [Fact]
        public async Task UpdateHealth_WhenNotFound_ReturnsOkWithFailureBody()
        {
            var request = new UpdateHealthConfigurationRequest { ItemId = "missing", Name = "n" };

            var result = await Build().UpdateHealth(request);

            var body = (BaseApiResponse)result.Should().BeOfType<OkObjectResult>().Subject.Value;
            body.IsSuccess.Should().BeFalse();
        }

        [Fact]
        public async Task Ping_ReturnsAcknowledgement()
        {
            var result = await Build().Ping("m1");

            result.Should().BeOfType<OkObjectResult>();
        }

        [Fact]
        public async Task DeleteHealth_DelegatesToMonitorService()
        {
            var expected = new BaseApiResponse { IsSuccess = true };
            _monitorService.Setup(s => s.DeleteConfigurationAsync("m1")).ReturnsAsync(expected);

            var result = await Build().DeleteHealth("m1");

            var body = result.Should().BeOfType<OkObjectResult>().Subject.Value;
            body.Should().BeSameAs(expected);
        }
    }
}
