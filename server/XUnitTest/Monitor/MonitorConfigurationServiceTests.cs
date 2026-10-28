using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Blocks.Genesis;
using Blocks.Genesis.DataAccess.Rules;
using Blocks.Genesis.Entities.Monitor;
using DomainService.Monitor.Models;
using DomainService.Monitor.MonitorIncidentService;
using DomainService.Monitor.Services;
using DomainService.Shared.Entity;
using DomainService.Shared.Models;
using FluentAssertions;
using FluentValidation;
using FluentValidation.Results;
using Microsoft.Extensions.Logging;
using Moq;

namespace XUnitTest.Monitor
{
    public class MonitorConfigurationServiceTests
    {
        private readonly Mock<ILogger<MonitorConfigurationService>> _logger = new();
        private readonly Mock<IMessageClient> _messageClient = new();
        private readonly Mock<IMonitorConfigurationRepoService> _repo = new();
        private readonly Mock<IMonitorIncidentRepoService> _incidentRepo = new();
        private readonly Mock<IValidator<SaveMonitorConfigurationRequest>> _saveValidator = new();
        private readonly Mock<IValidator<UpdateMonitorConfigurationRequest>> _updateValidator = new();
        private readonly Mock<DomainService.AlertRecipients.Services.IAlertRecipientStore> _alertRecipientStore = new();

        public MonitorConfigurationServiceTests()
        {
            // Default: validators pass.
            _saveValidator.Setup(v => v.ValidateAsync(It.IsAny<SaveMonitorConfigurationRequest>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new ValidationResult());
            _updateValidator.Setup(v => v.ValidateAsync(It.IsAny<UpdateMonitorConfigurationRequest>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new ValidationResult());
            _incidentRepo.Setup(r => r.GetIncidentsListByMonitorIdsAndDateRangeAsync(
                    It.IsAny<List<string>>(), It.IsAny<DateTime>(), It.IsAny<DateTime>()))
                .ReturnsAsync(new List<MonitorIncident>());
            // Default: the project has no "All monitors" people.
            _alertRecipientStore.Setup(s => s.GetEmailsForNewMonitorAsync(It.IsAny<string?>())).ReturnsAsync(new List<string>());
        }

        private MonitorConfigurationService CreateSut() =>
            new(_logger.Object, _messageClient.Object, _repo.Object, _saveValidator.Object, _incidentRepo.Object, _updateValidator.Object, _alertRecipientStore.Object);

        private static SaveMonitorConfigurationRequest ValidSaveRequest() => new()
        {
            ProjectKey = "proj",
            Name = "Api Monitor",
            Url = "http://api.test",
            IsActive = true
        };

        // ---------- GetConfigurationByIdAsync ----------

        [Fact]
        public async Task GetConfigurationByIdAsync_ReturnsConfig()
        {
            var config = new MonitorConfiguration { ItemId = "m1" };
            _repo.Setup(r => r.GetConfigurationForViewAsync("m1")).ReturnsAsync(config);

            var result = await CreateSut().GetConfigurationByIdAsync("m1");

            result.IsSuccess.Should().BeTrue();
            result.Data.Should().BeSameAs(config);
        }

        [Fact]
        public async Task GetConfigurationByIdAsync_WhenRepoThrows_StillSucceedsWithEmptyConfig()
        {
            _repo.Setup(r => r.GetConfigurationForViewAsync("m1")).ThrowsAsync(new Exception("db"));

            var result = await CreateSut().GetConfigurationByIdAsync("m1");

            result.IsSuccess.Should().BeTrue();
            result.Data.Should().BeOfType<MonitorConfiguration>();
        }

        // ---------- GetConfigurationListAsync ----------

        [Fact]
        public async Task GetConfigurationListAsync_MapsIncidentSummariesOntoConfigurations()
        {
            var configs = new List<MonitorConfiguration> { new() { ItemId = "m1" } };
            _repo.Setup(r => r.GetConfigurationListAsync("t", null, 0, 10, null, false))
                .ReturnsAsync((configs, 1));
            _incidentRepo.Setup(r => r.GetIncidentsListByMonitorIdsAndDateRangeAsync(
                    It.IsAny<List<string>>(), It.IsAny<DateTime>(), It.IsAny<DateTime>()))
                .ReturnsAsync(new List<MonitorIncident>
                {
                    new() { MonitorId = "m1", StartTime = DateTime.UtcNow, IsResolved = true, EndTime = DateTime.UtcNow.AddMinutes(5) }
                });

            var result = await CreateSut().GetConfigurationListAsync("t", null, 0, 10);

            result.IsSuccess.Should().BeTrue();
            result.TotalCount.Should().Be(1);
            configs[0].IncidentSummaries.Should().HaveCount(1);
        }

        [Fact]
        public async Task GetConfigurationListAsync_WhenRepoThrows_ReturnsEmptySuccess()
        {
            _repo.Setup(r => r.GetConfigurationListAsync(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<int>(), It.IsAny<int>(), It.IsAny<string>(), It.IsAny<bool>()))
                .ThrowsAsync(new Exception("db"));

            var result = await CreateSut().GetConfigurationListAsync("t", null, 0, 10);

            result.IsSuccess.Should().BeTrue();
            result.TotalCount.Should().Be(0);
        }

        // ---------- GetConfigurationListByRepoIdAsync ----------

        [Fact]
        public async Task GetConfigurationListByRepoIdAsync_ReturnsList()
        {
            var configs = new List<MonitorConfiguration> { new() { ItemId = "m1" } };
            _repo.Setup(r => r.GetConfigurationListByRepoIdAsync("t", "repo1")).ReturnsAsync(configs);

            var result = await CreateSut().GetConfigurationListByRepoIdAsync("t", "repo1");

            result.IsSuccess.Should().BeTrue();
            result.Data.Should().BeSameAs(configs);
        }

        // ---------- SaveConfigurationAsync ----------

        [Fact]
        public async Task SaveConfigurationAsync_WhenValidationFails_ReturnsErrorMessages()
        {
            _saveValidator.Setup(v => v.ValidateAsync(It.IsAny<SaveMonitorConfigurationRequest>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new ValidationResult(new[] { new ValidationFailure("Url", "URL is required.") }));

            var result = await CreateSut().SaveConfigurationAsync(ValidSaveRequest());

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("URL is required.");
        }

        [Fact]
        public async Task SaveConfigurationAsync_WhenMonitorSourceTypeUnparseable_ReturnsError()
        {
            var request = ValidSaveRequest();
            request.MonitorSourceType = "NotAThing";

            var result = await CreateSut().SaveConfigurationAsync(request);

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("Invalid MonitorSourceType: NotAThing");
        }

        [Fact]
        public async Task SaveConfigurationAsync_WhenSourceTypeIsInfrastructure_ReturnsError()
        {
            var request = ValidSaveRequest();
            request.MonitorSourceType = MonitorSourceTypes.Infrastructure.ToString();

            var result = await CreateSut().SaveConfigurationAsync(request);

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("Invalid MonitorSourceType");
        }

        [Fact]
        public async Task SaveConfigurationAsync_ValidRequest_SavesAndPublishesUpdate()
        {
            var request = ValidSaveRequest();

            var result = await CreateSut().SaveConfigurationAsync(request);

            result.IsSuccess.Should().BeTrue();
            var saved = result.Data.Should().BeOfType<MonitorConfiguration>().Subject;
            saved.MonitorConfigurationType.Should().Be(MonitorConfigurationTypes.OutboundPing);
            saved.Name.Should().Be("Api Monitor");
            _repo.Verify(r => r.SaveConfigurationAsync(It.IsAny<MonitorConfiguration>()), Times.Once);
            _messageClient.Verify(m => m.SendToConsumerAsync(
                It.IsAny<ConsumerMessage<MonitorConfigurationUpdateQueue>>()), Times.Once);
        }

        [Fact]
        public async Task SaveConfigurationAsync_RefusedByAValidationRule_ReturnsItsFieldMessage()
        {
            var refused = new DataValidationResult();
            refused.AddError("Url", "Url must start with https://", "Regex");
            _repo.Setup(r => r.SaveConfigurationAsync(It.IsAny<MonitorConfiguration>())).ThrowsAsync(new DataValidationException(refused));

            var result = await CreateSut().SaveConfigurationAsync(ValidSaveRequest());

            result.IsSuccess.Should().BeFalse();
            result.StatusCode.Should().Be(System.Net.HttpStatusCode.BadRequest);
            result.Errors.Should().Equal(new Dictionary<string, string> { ["Url"] = "Url must start with https://" });
            _messageClient.Verify(m => m.SendToConsumerAsync(It.IsAny<ConsumerMessage<MonitorConfigurationUpdateQueue>>()), Times.Never);
        }

        [Fact]
        public async Task SaveConfigurationAsync_ExternalServiceType_SetsExternalServiceId()
        {
            var request = ValidSaveRequest();
            request.MonitorSourceType = MonitorSourceTypes.ExternalServices.ToString();
            request.ExternalServiceId = "ext-123";

            var result = await CreateSut().SaveConfigurationAsync(request);

            var saved = result.Data.Should().BeOfType<MonitorConfiguration>().Subject;
            saved.MonitorSourceType.Should().Be(MonitorSourceTypes.ExternalServices);
            saved.ExternalServiceId.Should().Be("ext-123");
        }

        [Fact]
        public async Task SaveConfigurationAsync_WhenPublishFails_StillSucceeds()
        {
            _messageClient.Setup(m => m.SendToConsumerAsync(It.IsAny<ConsumerMessage<MonitorConfigurationUpdateQueue>>()))
                .ThrowsAsync(new Exception("bus down"));

            var result = await CreateSut().SaveConfigurationAsync(ValidSaveRequest());

            result.IsSuccess.Should().BeTrue();
            _repo.Verify(r => r.SaveConfigurationAsync(It.IsAny<MonitorConfiguration>()), Times.Once);
        }

        [Fact]
        public async Task SaveConfigurationAsync_WhenSaveThrows_ReturnsFailure()
        {
            _repo.Setup(r => r.SaveConfigurationAsync(It.IsAny<MonitorConfiguration>())).ThrowsAsync(new Exception("db"));

            var result = await CreateSut().SaveConfigurationAsync(ValidSaveRequest());

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("Error saving");
        }

        // ---------- UpdateConfigurationAsync ----------

        [Fact]
        public async Task UpdateConfigurationAsync_WhenValidationFails_ReturnsError()
        {
            _updateValidator.Setup(v => v.ValidateAsync(It.IsAny<UpdateMonitorConfigurationRequest>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(new ValidationResult(new[] { new ValidationFailure("ItemId", "ItemId is required for update.") }));

            var result = await CreateSut().UpdateConfigurationAsync(new UpdateMonitorConfigurationRequest());

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("ItemId is required");
        }

        [Fact]
        public async Task UpdateConfigurationAsync_WhenNotFound_ReturnsFailure()
        {
            _repo.Setup(r => r.GetConfigurationAsync("m1")).ReturnsAsync((MonitorConfiguration?)null);

            var result = await CreateSut().UpdateConfigurationAsync(new UpdateMonitorConfigurationRequest { ItemId = "m1", Url = "http://x" });

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("not found");
        }

        [Fact]
        public async Task UpdateConfigurationAsync_WhenBlocksServices_IsRejected()
        {
            _repo.Setup(r => r.GetConfigurationAsync("m1"))
                .ReturnsAsync(new MonitorConfiguration { ItemId = "m1", MonitorSourceType = MonitorSourceTypes.BlocksServices });

            var result = await CreateSut().UpdateConfigurationAsync(new UpdateMonitorConfigurationRequest { ItemId = "m1", Url = "http://x" });

            result.IsSuccess.Should().BeFalse();
            _repo.Verify(r => r.SaveConfigurationAsync(It.IsAny<MonitorConfiguration>()), Times.Never);
        }

        [Fact]
        public async Task UpdateConfigurationAsync_ValidRequest_UpdatesAndPublishes()
        {
            _repo.Setup(r => r.GetConfigurationAsync("m1"))
                .ReturnsAsync(new MonitorConfiguration { ItemId = "m1", MonitorSourceType = MonitorSourceTypes.DeployedServices });

            var result = await CreateSut().UpdateConfigurationAsync(new UpdateMonitorConfigurationRequest
            {
                ItemId = "m1",
                Url = "http://updated",
                Name = "Updated"
            });

            result.IsSuccess.Should().BeTrue();
            _repo.Verify(r => r.SaveConfigurationAsync(It.Is<MonitorConfiguration>(c => c.Url == "http://updated")), Times.Once);
            _messageClient.Verify(m => m.SendToConsumerAsync(It.IsAny<ConsumerMessage<MonitorConfigurationUpdateQueue>>()), Times.Once);
        }

        // ---------- DeleteConfigurationAsync ----------

        [Fact]
        public async Task DeleteConfigurationAsync_WhenNotFound_ReturnsFailure()
        {
            _repo.Setup(r => r.GetConfigurationAsync("m1")).ReturnsAsync((MonitorConfiguration?)null);

            var result = await CreateSut().DeleteConfigurationAsync("m1");

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("not found");
        }

        [Fact]
        public async Task DeleteConfigurationAsync_WhenInfrastructure_IsRejected()
        {
            _repo.Setup(r => r.GetConfigurationAsync("m1"))
                .ReturnsAsync(new MonitorConfiguration { ItemId = "m1", MonitorSourceType = MonitorSourceTypes.Infrastructure });

            var result = await CreateSut().DeleteConfigurationAsync("m1");

            result.IsSuccess.Should().BeFalse();
            _repo.Verify(r => r.DeleteConfigurationAsync(It.IsAny<string>()), Times.Never);
        }

        [Fact]
        public async Task DeleteConfigurationAsync_WhenDeleted_ReturnsSuccess()
        {
            _repo.Setup(r => r.GetConfigurationAsync("m1"))
                .ReturnsAsync(new MonitorConfiguration { ItemId = "m1", MonitorSourceType = MonitorSourceTypes.DeployedServices });
            _repo.Setup(r => r.DeleteConfigurationAsync("m1")).ReturnsAsync(true);

            var result = await CreateSut().DeleteConfigurationAsync("m1");

            result.IsSuccess.Should().BeTrue();
            result.Message.Should().Contain("deleted successfully");
        }

        [Fact]
        public async Task DeleteConfigurationAsync_WhenDeleteReturnsFalse_StillReportsSuccess()
        {
            _repo.Setup(r => r.GetConfigurationAsync("m1"))
                .ReturnsAsync(new MonitorConfiguration { ItemId = "m1", MonitorSourceType = MonitorSourceTypes.OtherServices });
            _repo.Setup(r => r.DeleteConfigurationAsync("m1")).ReturnsAsync(false);

            var result = await CreateSut().DeleteConfigurationAsync("m1");

            result.IsSuccess.Should().BeTrue();
        }

        [Fact]
        public async Task DeleteConfigurationAsync_WhenRepoThrows_ReturnsFailure()
        {
            _repo.Setup(r => r.GetConfigurationAsync("m1")).ThrowsAsync(new Exception("db"));

            var result = await CreateSut().DeleteConfigurationAsync("m1");

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("Error deleting");
        }

        // ---------- GetConfigurationListWithDowntimeByRepoIdAsync ----------

        [Fact]
        public async Task GetConfigurationListWithDowntimeByRepoIdAsync_WhenNoConfigs_ReturnsEmptySuccess()
        {
            _repo.Setup(r => r.GetConfigurationListByRepoIdAsync("t", "repo1")).ReturnsAsync(new List<MonitorConfiguration>());

            var result = await CreateSut().GetConfigurationListWithDowntimeByRepoIdAsync("t", "repo1");

            result.IsSuccess.Should().BeTrue();
            result.Message.Should().Contain("No monitors found");
        }

        [Fact]
        public async Task GetConfigurationListWithDowntimeByRepoIdAsync_MapsIncidentSummaries()
        {
            var configs = new List<MonitorConfiguration> { new() { ItemId = "m1" } };
            _repo.Setup(r => r.GetConfigurationListByRepoIdAsync("t", "repo1")).ReturnsAsync(configs);
            _incidentRepo.Setup(r => r.GetIncidentsListByMonitorIdsAndDateRangeAsync(
                    It.IsAny<List<string>>(), It.IsAny<DateTime>(), It.IsAny<DateTime>()))
                .ReturnsAsync(new List<MonitorIncident>
                {
                    new() { MonitorId = "m1", StartTime = DateTime.UtcNow }
                });

            var result = await CreateSut().GetConfigurationListWithDowntimeByRepoIdAsync("t", "repo1");

            result.IsSuccess.Should().BeTrue();
            configs[0].IncidentSummaries.Should().HaveCount(1);
        }

        [Fact]
        public async Task GetConfigurationListWithDowntimeByRepoIdAsync_WhenRepoThrows_ReturnsFailure()
        {
            _repo.Setup(r => r.GetConfigurationListByRepoIdAsync("t", "repo1")).ThrowsAsync(new Exception("db"));

            var result = await CreateSut().GetConfigurationListWithDowntimeByRepoIdAsync("t", "repo1");

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("An error occurred");
        }

        // ---------- cross-tenant isolation ----------

        [Fact]
        public async Task GetConfigurationByIdAsync_WhenCrossTenant_ReturnsEmptyConfig()
        {
            _repo.Setup(r => r.GetConfigurationForViewAsync("m1"))
                .ReturnsAsync(new MonitorConfiguration { ItemId = "m1", TenantId = "tenant-a" });
            try
            {
                SetCaller("tenant-b");
                var result = await CreateSut().GetConfigurationByIdAsync("m1");

                result.IsSuccess.Should().BeTrue();
                // The stored monitor is hidden from a different tenant: a fresh, empty config is returned.
                result.Data.Should().BeOfType<MonitorConfiguration>().Which.ItemId.Should().NotBe("m1");
            }
            finally
            {
                BlocksContext.ClearContext();
            }
        }

        [Fact]
        public async Task UpdateConfigurationAsync_WhenCrossTenant_IsRejected()
        {
            _repo.Setup(r => r.GetConfigurationAsync("m1"))
                .ReturnsAsync(new MonitorConfiguration { ItemId = "m1", TenantId = "tenant-a", MonitorSourceType = MonitorSourceTypes.DeployedServices });
            try
            {
                SetCaller("tenant-b");
                var result = await CreateSut().UpdateConfigurationAsync(new UpdateMonitorConfigurationRequest { ItemId = "m1", Url = "http://x" });

                result.IsSuccess.Should().BeFalse();
                _repo.Verify(r => r.SaveConfigurationAsync(It.IsAny<MonitorConfiguration>()), Times.Never);
            }
            finally
            {
                BlocksContext.ClearContext();
            }
        }

        [Fact]
        public async Task DeleteConfigurationAsync_WhenCrossTenant_IsRejected()
        {
            _repo.Setup(r => r.GetConfigurationAsync("m1"))
                .ReturnsAsync(new MonitorConfiguration { ItemId = "m1", TenantId = "tenant-a", MonitorSourceType = MonitorSourceTypes.DeployedServices });
            try
            {
                SetCaller("tenant-b");
                var result = await CreateSut().DeleteConfigurationAsync("m1");

                result.IsSuccess.Should().BeFalse();
                _repo.Verify(r => r.DeleteConfigurationAsync(It.IsAny<string>()), Times.Never);
            }
            finally
            {
                BlocksContext.ClearContext();
            }
        }

        // ---------- remaining branches ----------

        [Fact]
        public async Task GetConfigurationListByRepoIdAsync_WhenRepoThrows_ReturnsEmptySuccess()
        {
            _repo.Setup(r => r.GetConfigurationListByRepoIdAsync("t", "repo1")).ThrowsAsync(new Exception("db"));

            var result = await CreateSut().GetConfigurationListByRepoIdAsync("t", "repo1");

            result.IsSuccess.Should().BeTrue();
            result.Data.Should().BeOfType<List<MonitorConfiguration>>().Which.Should().BeEmpty();
        }

        [Fact]
        public async Task SaveConfigurationAsync_AppliesAllOptionalFields_AndOnlyTheAllMonitorsPeopleAsEmails()
        {
            // C11: Emails is no longer on the request; a new monitor gets only the "All monitors" people.
            _alertRecipientStore.Setup(s => s.GetEmailsForNewMonitorAsync("proj")).ReturnsAsync(new List<string> { "ops@x.com" });
            var request = ValidSaveRequest();
            request.MonitorType = "HTTP";
            request.ProtocolType = "HTTPS";
            request.HttpMethodType = "GET";
            request.AuthorizationType = "BEARER";
            request.IntervalInSeconds = 45;
            request.TimeoutInSeconds = 90;
            request.ExpectedContent = "OK";
            request.CustomHttpHeaders = "{}";
            request.CustomPayload = "{}";
            request.SuccessHttpResponseCodes = new List<string> { "200" };
            request.Regions = new List<string> { "eu" };

            var result = await CreateSut().SaveConfigurationAsync(request);

            var saved = result.Data.Should().BeOfType<MonitorConfiguration>().Subject;
            saved.MonitorType.Should().Be(MonitorTypes.HTTP);
            saved.ProtocolType.Should().Be(ProtocolTypes.HTTPS);
            saved.HttpMethodType.Should().Be(HttpMethodTypes.GET);
            saved.AuthorizationType.Should().Be(AuthorizationTypes.BEARER);
            saved.IntervalInSeconds.Should().Be(45);
            saved.TimeoutInSeconds.Should().Be(90);
            saved.SuccessHttpResponseCodes.Should().ContainSingle();
            saved.Regions.Should().ContainSingle();
            saved.Emails.Should().Equal("ops@x.com");
        }

        [Fact]
        public async Task UpdateConfigurationAsync_WhenPublishFails_StillSucceeds()
        {
            _repo.Setup(r => r.GetConfigurationAsync("m1"))
                .ReturnsAsync(new MonitorConfiguration { ItemId = "m1", MonitorSourceType = MonitorSourceTypes.DeployedServices });
            _messageClient.Setup(m => m.SendToConsumerAsync(It.IsAny<ConsumerMessage<MonitorConfigurationUpdateQueue>>()))
                .ThrowsAsync(new Exception("bus down"));

            var result = await CreateSut().UpdateConfigurationAsync(new UpdateMonitorConfigurationRequest { ItemId = "m1", Url = "http://x" });

            result.IsSuccess.Should().BeTrue();
            _repo.Verify(r => r.SaveConfigurationAsync(It.IsAny<MonitorConfiguration>()), Times.Once);
        }

        [Fact]
        public async Task UpdateConfigurationAsync_WhenSaveThrows_ReturnsFailure()
        {
            _repo.Setup(r => r.GetConfigurationAsync("m1"))
                .ReturnsAsync(new MonitorConfiguration { ItemId = "m1", MonitorSourceType = MonitorSourceTypes.DeployedServices });
            _repo.Setup(r => r.SaveConfigurationAsync(It.IsAny<MonitorConfiguration>())).ThrowsAsync(new Exception("db"));

            var result = await CreateSut().UpdateConfigurationAsync(new UpdateMonitorConfigurationRequest { ItemId = "m1", Url = "http://x" });

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("Error saving");
        }

        // ---------- Alert recipients create hook (H9, C10, C11, E8, E10) ----------

        [Theory]
        [InlineData(null)]
        [InlineData("DeployedServices")]
        [InlineData("ExternalServices")]
        [InlineData("OtherServices")]
        public async Task SaveConfigurationAsync_E8_ANewEditableMonitorStartsWithTheAllMonitorsPeople(string? sourceType)
        {
            _alertRecipientStore.Setup(s => s.GetEmailsForNewMonitorAsync("proj")).ReturnsAsync(new List<string> { "ops@x.com" });
            var request = ValidSaveRequest();
            request.MonitorSourceType = sourceType;
            MonitorConfiguration? saved = null;
            _repo.Setup(r => r.SaveConfigurationAsync(It.IsAny<MonitorConfiguration>())).Callback<MonitorConfiguration>(m => saved = m).ReturnsAsync(true);

            var result = await CreateSut().SaveConfigurationAsync(request);

            result.IsSuccess.Should().BeTrue();
            saved!.Emails.Should().Equal("ops@x.com");
        }

        [Fact]
        public async Task SaveConfigurationAsync_ABlocksServicesMonitor_GetsNoRecipients()
        {
            var request = ValidSaveRequest();
            request.MonitorSourceType = "BlocksServices";

            var result = await CreateSut().SaveConfigurationAsync(request);

            result.Data.Should().BeOfType<MonitorConfiguration>().Which.Emails.Should().BeEmpty();
            _alertRecipientStore.Verify(s => s.GetEmailsForNewMonitorAsync(It.IsAny<string?>()), Times.Never);
        }

        [Fact]
        public async Task SaveConfigurationAsync_C10_WhenThePeopleCantBeRead_TheMonitorIsStillCreatedWithNoEmails()
        {
            // The store never throws for the create hook: it logs and returns nobody (AlertRecipientStoreTests).
            _alertRecipientStore.Setup(s => s.GetEmailsForNewMonitorAsync("proj")).ReturnsAsync(new List<string>());

            var result = await CreateSut().SaveConfigurationAsync(ValidSaveRequest());

            result.IsSuccess.Should().BeTrue();
            result.Data.Should().BeOfType<MonitorConfiguration>().Which.Emails.Should().BeEmpty();
            _repo.Verify(r => r.SaveConfigurationAsync(It.IsAny<MonitorConfiguration>()), Times.Once);
        }

        [Fact]
        public async Task C11_AnOldClientsEmails_AreIgnoredWhenTheRequestBinds()
        {
            // The SPA ships with the API, but an old client's `emails` must not fail or apply.
            var web = new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web);
            var create = System.Text.Json.JsonSerializer.Deserialize<SaveMonitorConfigurationRequest>(
                "{\"projectKey\":\"proj\",\"name\":\"n\",\"url\":\"http://x\",\"emails\":[\"new@x.com\"]}", web)!;
            typeof(SaveMonitorConfigurationRequest).GetProperty("Emails").Should().BeNull();
            typeof(DomainService.Health.Models.SaveHealthConfigurationRequest).GetProperty("Emails").Should().BeNull();

            var created = await CreateSut().SaveConfigurationAsync(create);

            created.Data.Should().BeOfType<MonitorConfiguration>().Which.Emails.Should().BeEmpty();
        }

        [Fact]
        public async Task UpdateConfigurationAsync_E10_KeepsTheMonitorsEmails()
        {
            var stored = new MonitorConfiguration
            {
                ItemId = "m1", MonitorSourceType = MonitorSourceTypes.DeployedServices, Emails = new List<string> { "ops@x.com", "ali@x.com" },
            };
            _repo.Setup(r => r.GetConfigurationAsync("m1")).ReturnsAsync(stored);
            var request = System.Text.Json.JsonSerializer.Deserialize<UpdateMonitorConfigurationRequest>(
                "{\"itemId\":\"m1\",\"isActive\":true,\"emails\":[\"new@x.com\"]}",
                new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))!;

            var result = await CreateSut().UpdateConfigurationAsync(request);

            result.IsSuccess.Should().BeTrue();
            result.Data.Should().BeOfType<MonitorConfiguration>().Which.Emails.Should().Equal("ops@x.com", "ali@x.com");
            _alertRecipientStore.Verify(s => s.GetEmailsForNewMonitorAsync(It.IsAny<string?>()), Times.Never);
        }

        private static void SetCaller(string tenantId)
        {
            var ctx = BlocksContext.Create(
                tenantId, null, "user-1", true, null, null,
                DateTime.UtcNow.AddHours(1), null, null, null, null, null, null, null);
            BlocksContext.SetContext(ctx);
        }
    }
}
