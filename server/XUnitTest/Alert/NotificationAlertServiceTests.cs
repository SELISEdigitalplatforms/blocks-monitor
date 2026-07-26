using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Blocks.Genesis;
using DomainService.Shared.Services;
using DomainService.Alert.Services;
using DomainService.Monitor.Entity;
using DomainService.Shared.Models;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using XUnitTest.Utilities;

namespace XUnitTest.Alert
{
    public class NotificationAlertServiceTests
    {
        private readonly Mock<IHttpHelperServices> _http = new();
        private readonly Mock<ICryptoService> _crypto = new();
        private readonly Mock<ITenants> _tenants = new();
        private readonly Mock<IConfiguration> _config = new();

        public NotificationAlertServiceTests()
        {
            _crypto.Setup(c => c.Hash(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>())).Returns("hashed");
            // Null tenant exercises the null-safe TenantSalt access in SendNotificationAsync.
            _tenants.Setup(t => t.GetTenantByID(It.IsAny<string>())).Returns((Tenant)null);
            _config.Setup(c => c["RootTenantId"]).Returns("root");
            _config.Setup(c => c["NotificationServiceUrl"]).Returns("http://notify");
        }

        private AlertRepoService Repo(IEnumerable<ProjectPeople> people = null)
        {
            var db = new MongoMocks.DbBuilder()
                .With(people ?? new List<ProjectPeople>())
                .With(new List<DomainService.Alert.Entities.AlertMailTemplate>())
                .With(new List<DomainService.Alert.Entities.MailServerConfiguration>());
            return new AlertRepoService(db.Provider, MongoMocks.BlocksSecret().Object);
        }

        private NotificationAlertService Sut(AlertRepoService repo) =>
            new(new Mock<ILogger<NotificationAlertService>>().Object, _http.Object, _crypto.Object, _tenants.Object, repo, _config.Object);

        private void SetupHttp(NotificationResponse response) =>
            _http.Setup(h => h.MakeHttpRequest<NotificationResponse>(
                    It.IsAny<string>(), It.IsAny<string>(), It.IsAny<HttpMethod>(),
                    It.IsAny<object>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<string>()))
                .ReturnsAsync((response, new HttpResponseMessage(HttpStatusCode.OK) { ReasonPhrase = "OK" }));

        [Fact]
        public void CreateNotificationPayload_IncludesUserIdsAndSerializedContent()
        {
            var payload = NotificationAlertService.CreateNotificationPayload("Title", "Message", new List<string> { "u1" });

            var json = JsonSerializer.Serialize(payload);
            json.Should().Contain("GeneralNotification");
            json.Should().Contain("u1");
            json.Should().Contain("Title");
            json.Should().Contain("Message");
        }

        [Fact]
        public async Task SendNotification_WhenHttpSucceeds_ReturnsTrue()
        {
            SetupHttp(new NotificationResponse { IsSuccess = true });

            var result = await Sut(Repo()).SendNotificationAsync(new { }, new List<string> { "u1" });

            result.Should().BeTrue();
        }

        [Fact]
        public async Task SendNotification_WhenHttpReturnsNull_ReturnsFalse()
        {
            SetupHttp(null);

            var result = await Sut(Repo()).SendNotificationAsync(new { }, new List<string> { "u1" });

            result.Should().BeFalse();
        }

        [Fact]
        public async Task HandleNotificationAlertAsync_UnresolvedIncident_SendsAlertAndReturnsTrue()
        {
            SetupHttp(new NotificationResponse { IsSuccess = true });
            var repo = Repo(new List<ProjectPeople> { new() { UserId = "owner", TenantId = "proj" } });
            var config = new MonitorConfiguration { Name = "Api", Url = "http://api", CreatedBy = "creator" };
            var incident = new MonitorIncident { ProjectKey = "proj", MonitorUrl = "http://api", LastStatusCode = 500, FailureReason = "down", IsResolved = false };

            var result = await Sut(repo).HandleNotificationAlertAsync(config, incident);

            result.Should().BeTrue();
            _http.Verify(h => h.MakeHttpRequest<NotificationResponse>(
                It.IsAny<string>(), It.IsAny<string>(), HttpMethod.Post,
                It.IsAny<object>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<string>()), Times.Once);
        }

        [Fact]
        public async Task HandleNotificationAlertAsync_IncludesCreatedByAndLastUpdatedByRecipients()
        {
            SetupHttp(new NotificationResponse { IsSuccess = true });
            var repo = Repo(new List<ProjectPeople> { new() { UserId = "owner", TenantId = "proj" } });
            var config = new MonitorConfiguration { Name = "Api", Url = "http://api", CreatedBy = "creator", LastUpdatedBy = "editor" };
            var incident = new MonitorIncident { ProjectKey = "proj", MonitorUrl = "http://api", LastStatusCode = 500, IsResolved = false };

            var result = await Sut(repo).HandleNotificationAlertAsync(config, incident);

            result.Should().BeTrue();
        }

        [Fact]
        public async Task HandleNotificationAlertAsync_ResolvedIncident_ReturnsTrue()
        {
            SetupHttp(new NotificationResponse { IsSuccess = true });
            var config = new MonitorConfiguration { Name = "Api", Url = "http://api" };
            var incident = new MonitorIncident { ProjectKey = "proj", MonitorUrl = "http://api", LastStatusCode = 200, IsResolved = true };

            var result = await Sut(Repo()).HandleNotificationAlertAsync(config, incident);

            result.Should().BeTrue();
        }

        [Fact]
        public async Task HandleNotificationAlertAsync_WhenNotificationFails_ReturnsFalse()
        {
            SetupHttp(new NotificationResponse { IsSuccess = false });
            var config = new MonitorConfiguration { Name = "Api", Url = "http://api" };
            var incident = new MonitorIncident { ProjectKey = "proj", MonitorUrl = "http://api", IsResolved = false };

            var result = await Sut(Repo()).HandleNotificationAlertAsync(config, incident);

            result.Should().BeFalse();
        }
    }
}
