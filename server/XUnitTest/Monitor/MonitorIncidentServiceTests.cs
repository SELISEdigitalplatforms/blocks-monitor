using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using Blocks.Genesis;
using DomainService.Shared.Services;
using DomainService.Alert.Entities;
using DomainService.Alert.Services;
using DomainService.Monitor.Entity;
using DomainService.Monitor.Models;
using DomainService.Monitor.MonitorIncidentService;
using DomainService.Monitor.Services;
using DomainService.Shared.Models;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using XUnitTest.Utilities;

namespace XUnitTest.Monitor
{
    public class MonitorIncidentServiceTests
    {
        private readonly Mock<IMonitorIncidentRepoService> _incidentRepo = new();
        private readonly Mock<IMonitorConfigurationRepoService> _configRepo = new();
        private readonly Mock<IHttpHelperServices> _http = new();

        public MonitorIncidentServiceTests()
        {
            // Notification HTTP call succeeds so the alert pipeline completes without faulting.
            _http.Setup(h => h.MakeHttpRequest<NotificationResponse>(
                    It.IsAny<string>(), It.IsAny<string>(), It.IsAny<HttpMethod>(),
                    It.IsAny<object>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<string>()))
                .ReturnsAsync((new NotificationResponse { IsSuccess = true }, new HttpResponseMessage(HttpStatusCode.OK)));
        }

        private MonitorIncidentService CreateSut()
        {
            var db = new MongoMocks.DbBuilder()
                .With(new List<ProjectPeople>())
                .With(new List<AlertMailTemplate>())
                .With(new List<MailServerConfiguration>());
            var alertRepo = new AlertRepoService(db.Provider, MongoMocks.BlocksSecret().Object);

            var crypto = new Mock<ICryptoService>();
            crypto.Setup(c => c.Hash(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<bool>())).Returns("h");
            var tenants = new Mock<ITenants>();
            tenants.Setup(t => t.GetTenantByID(It.IsAny<string>())).Returns((Tenant)null);
            var config = new Mock<IConfiguration>();

            var notification = new NotificationAlertService(
                new Mock<ILogger<NotificationAlertService>>().Object, _http.Object, crypto.Object, tenants.Object, alertRepo, config.Object);
            var email = new EmailAlertService(new Mock<ILogger<EmailAlertService>>().Object, alertRepo);

            return new MonitorIncidentService(
                _incidentRepo.Object, notification, _configRepo.Object, email, new Mock<ILogger<MonitorIncidentService>>().Object);
        }

        private static MonitorConfiguration Config() =>
            new() { ItemId = "m1", Name = "Api", Url = "http://api", TenantId = "proj" };

        private static MonitorPingLog Log(int statusCode) =>
            new() { MonitorId = "m1", StatusCode = statusCode, Timestamp = DateTime.UtcNow, ResponseMessage = "msg" };

        // ---------- HandleIncidentAsync ----------

        [Fact]
        public async Task HandleIncidentAsync_ServerError_NoActiveIncident_CreatesIncident()
        {
            _incidentRepo.Setup(r => r.GetActiveIncidentAsync("m1")).ReturnsAsync((MonitorIncident?)null);

            await CreateSut().HandleIncidentAsync(Config(), Log(500));

            _incidentRepo.Verify(r => r.CreateIncidentAsync(It.IsAny<MonitorIncident>()), Times.Once);
        }

        [Fact]
        public async Task HandleIncidentAsync_ServerError_WithActiveIncident_DoesNotCreateOrResolve()
        {
            _incidentRepo.Setup(r => r.GetActiveIncidentAsync("m1"))
                .ReturnsAsync(new MonitorIncident { ItemId = "i1", MonitorId = "m1" });

            await CreateSut().HandleIncidentAsync(Config(), Log(503));

            // Ongoing incident: only in-memory fields updated; no new incident, no resolution.
            _incidentRepo.Verify(r => r.CreateIncidentAsync(It.IsAny<MonitorIncident>()), Times.Never);
            _incidentRepo.Verify(r => r.UpdateIncidentAsync(It.IsAny<MonitorIncident>()), Times.Never);
        }

        [Fact]
        public async Task HandleIncidentAsync_Success_WithActiveIncident_ResolvesIncident()
        {
            _incidentRepo.Setup(r => r.GetActiveIncidentAsync("m1"))
                .ReturnsAsync(new MonitorIncident { ItemId = "i1", MonitorId = "m1" });

            await CreateSut().HandleIncidentAsync(Config(), Log(200));

            _incidentRepo.Verify(r => r.UpdateIncidentAsync(It.Is<MonitorIncident>(i => i.IsResolved)), Times.Once);
        }

        [Fact]
        public async Task HandleIncidentAsync_ClientError404_NoActiveIncident_CreatesIncident()
        {
            // Failure is computed as (StatusCode < 200 || StatusCode >= 400), so a 4xx response is
            // treated as a failure. A 404 with no active incident should OPEN a new incident.
            _incidentRepo.Setup(r => r.GetActiveIncidentAsync("m1")).ReturnsAsync((MonitorIncident?)null);

            await CreateSut().HandleIncidentAsync(Config(), Log(404));

            _incidentRepo.Verify(r => r.CreateIncidentAsync(It.IsAny<MonitorIncident>()), Times.Once);
        }

        [Fact]
        public async Task HandleIncidentAsync_ClientError404_WithActiveIncident_DoesNotResolve()
        {
            // A 404 is a failure, not a recovery. An existing open incident must stay open: no new
            // incident is created and the active one is not resolved (only in-memory fields update).
            _incidentRepo.Setup(r => r.GetActiveIncidentAsync("m1"))
                .ReturnsAsync(new MonitorIncident { ItemId = "i1", MonitorId = "m1" });

            await CreateSut().HandleIncidentAsync(Config(), Log(404));

            _incidentRepo.Verify(r => r.CreateIncidentAsync(It.IsAny<MonitorIncident>()), Times.Never);
            _incidentRepo.Verify(r => r.UpdateIncidentAsync(It.IsAny<MonitorIncident>()), Times.Never);
        }

        [Fact]
        public async Task HandleIncidentAsync_ConnectionFailureStatusMinusOne_CreatesIncident()
        {
            // StatusCode -1 (< 200) is a genuine failure and should open an incident.
            _incidentRepo.Setup(r => r.GetActiveIncidentAsync("m1")).ReturnsAsync((MonitorIncident?)null);

            await CreateSut().HandleIncidentAsync(Config(), Log(-1));

            _incidentRepo.Verify(r => r.CreateIncidentAsync(It.IsAny<MonitorIncident>()), Times.Once);
        }

        [Fact]
        public async Task HandleIncidentAsync_WhenRepoThrows_SwallowsException()
        {
            _incidentRepo.Setup(r => r.GetActiveIncidentAsync("m1")).ThrowsAsync(new Exception("db"));

            var act = async () => await CreateSut().HandleIncidentAsync(Config(), Log(500));

            await act.Should().NotThrowAsync();
        }

        // ---------- GetIncidentsByMonitorIdAsync ----------

        [Fact]
        public async Task GetIncidentsByMonitorIdAsync_WhenConfigNotFound_ReturnsEmpty()
        {
            _configRepo.Setup(r => r.GetConfigurationAsync("m1")).ReturnsAsync((MonitorConfiguration?)null);

            var result = await CreateSut().GetIncidentsByMonitorIdAsync("m1", 0, 10);

            result.TotalCount.Should().Be(0);
            result.Data.Should().BeAssignableTo<List<MonitorIncident>>().Which.Should().BeEmpty();
        }

        [Fact]
        public async Task GetIncidentsByMonitorIdAsync_NormalizesInvalidPaging_AndReturnsResults()
        {
            _configRepo.Setup(r => r.GetConfigurationAsync("m1")).ReturnsAsync(Config());
            _incidentRepo.Setup(r => r.GetIncidentsWithCountByMonitorIdAsync(It.IsAny<MonitorConfiguration>(), 0, 10, null, true))
                .ReturnsAsync((new List<MonitorIncident> { new() { ItemId = "i1" } }, 1));

            var result = await CreateSut().GetIncidentsByMonitorIdAsync("m1", -5, 0);

            result.PageNumber.Should().Be(0);
            result.PageSize.Should().Be(10);
            result.TotalCount.Should().Be(1);
        }

        [Fact]
        public async Task GetIncidentsByMonitorIdAsync_WhenRepoThrows_ReturnsEmpty()
        {
            _configRepo.Setup(r => r.GetConfigurationAsync("m1")).ThrowsAsync(new Exception("db"));

            var result = await CreateSut().GetIncidentsByMonitorIdAsync("m1", 1, 10);

            result.TotalCount.Should().Be(0);
        }

        // ---------- GetIncidentsDurationByDateRangeAsync ----------

        [Fact]
        public async Task GetIncidentsDurationByDateRangeAsync_WhenMonitorIdEmpty_ReturnsFailure()
        {
            var result = await CreateSut().GetIncidentsDurationByDateRangeAsync("  ");
            result.IsSuccess.Should().BeFalse();
        }

        [Fact]
        public async Task GetIncidentsDurationByDateRangeAsync_WhenConfigNotFound_ReturnsFailure()
        {
            _configRepo.Setup(r => r.GetConfigurationAsync("m1")).ReturnsAsync((MonitorConfiguration?)null);

            var result = await CreateSut().GetIncidentsDurationByDateRangeAsync("m1");

            result.IsSuccess.Should().BeFalse();
        }

        [Fact]
        public async Task GetIncidentsDurationByDateRangeAsync_BuildsSummaryForConfiguredRanges()
        {
            _configRepo.Setup(r => r.GetConfigurationAsync("m1")).ReturnsAsync(Config());
            _incidentRepo.Setup(r => r.GetDowntimeAndCountByDateRangesAsync("m1", It.IsAny<Dictionary<string, int>>()))
                .ReturnsAsync(new Dictionary<string, (long TotalDurationMs, long IncidentCount)>
                {
                    { "7d", (1000, 2) }, { "30d", (2000, 3) }, { "365d", (3000, 4) }
                });
            _incidentRepo.Setup(r => r.GetIncidentsByMonitorIdAsync(It.IsAny<MonitorConfiguration>(), 1, 5, null, true))
                .ReturnsAsync(new List<MonitorIncident> { new() { ItemId = "i1" } });

            var result = await CreateSut().GetIncidentsDurationByDateRangeAsync("m1");

            result.IsSuccess.Should().BeTrue();
            result.DateRangeSummary.Should().HaveCount(3);
            result.MonitorIncidents.Should().HaveCount(1);
        }

        [Fact]
        public async Task GetIncidentsDurationByDateRangeAsync_WhenRepoThrows_ReturnsFailure()
        {
            _configRepo.Setup(r => r.GetConfigurationAsync("m1")).ReturnsAsync(Config());
            _incidentRepo.Setup(r => r.GetDowntimeAndCountByDateRangesAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, int>>()))
                .ThrowsAsync(new Exception("db"));

            var result = await CreateSut().GetIncidentsDurationByDateRangeAsync("m1");

            result.IsSuccess.Should().BeFalse();
        }

        // ---------- GetDownTimeLogsByDateRangeAsync ----------

        [Fact]
        public async Task GetDownTimeLogsByDateRangeAsync_WhenMonitorIdEmpty_ReturnsFailure()
        {
            var result = await CreateSut().GetDownTimeLogsByDateRangeAsync("", null, null);
            result.IsSuccess.Should().BeFalse();
        }

        [Fact]
        public async Task GetDownTimeLogsByDateRangeAsync_WhenEndBeforeStart_ReturnsFailure()
        {
            var result = await CreateSut().GetDownTimeLogsByDateRangeAsync("m1", "2024-05-10T00:00:00Z", "2024-05-01T00:00:00Z");
            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("earlier");
        }

        [Fact]
        public async Task GetDownTimeLogsByDateRangeAsync_WhenConfigNotFound_ReturnsFailure()
        {
            _configRepo.Setup(r => r.GetConfigurationAsync("m1")).ReturnsAsync((MonitorConfiguration?)null);

            var result = await CreateSut().GetDownTimeLogsByDateRangeAsync("m1", null, null);

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("not found");
        }

        [Fact]
        public async Task GetDownTimeLogsByDateRangeAsync_WhenNoIncidents_ReturnsEmptySuccess()
        {
            _configRepo.Setup(r => r.GetConfigurationAsync("m1")).ReturnsAsync(Config());
            _incidentRepo.Setup(r => r.GetIncidentsListByDateRangeAsync("m1", It.IsAny<string>(), It.IsAny<string>()))
                .ReturnsAsync(new List<IncidentListSummary>());

            var result = await CreateSut().GetDownTimeLogsByDateRangeAsync("m1", null, null);

            result.IsSuccess.Should().BeTrue();
            result.Message.Should().Contain("No ping logs");
        }

        [Fact]
        public async Task GetDownTimeLogsByDateRangeAsync_WhenIncidentsExist_ReturnsThem()
        {
            var incidents = new List<IncidentListSummary> { new() { StartTime = DateTime.UtcNow } };
            _configRepo.Setup(r => r.GetConfigurationAsync("m1")).ReturnsAsync(Config());
            _incidentRepo.Setup(r => r.GetIncidentsListByDateRangeAsync("m1", It.IsAny<string>(), It.IsAny<string>()))
                .ReturnsAsync(incidents);

            var result = await CreateSut().GetDownTimeLogsByDateRangeAsync("m1", "2024-05-01T00:00:00Z", "2024-05-10T00:00:00Z");

            result.IsSuccess.Should().BeTrue();
            result.Data.Should().BeSameAs(incidents);
        }

        [Fact]
        public async Task GetDownTimeLogsByDateRangeAsync_WhenRepoThrows_ReturnsFailure()
        {
            _configRepo.Setup(r => r.GetConfigurationAsync("m1")).ThrowsAsync(new Exception("db"));

            var result = await CreateSut().GetDownTimeLogsByDateRangeAsync("m1", null, null);

            result.IsSuccess.Should().BeFalse();
        }
    }
}
