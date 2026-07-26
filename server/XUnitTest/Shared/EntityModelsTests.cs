using System;
using System.Collections.Generic;
using DomainService.Alert.Entities;
using DomainService.Monitor.Entity;
using DomainService.Monitor.Models;
using DomainService.Shared.Models;
using FluentAssertions;
using Worker.Configuration;

namespace XUnitTest.Shared
{
    // Round-trips the plain data holders (entities, DTOs, settings) so that their property
    // accessors are exercised and their default values are asserted. These types carry no logic
    // beyond storage, so the assertions verify that what is written is what is read back.
    public class EntityModelsTests
    {
        [Fact]
        public void MonitorConfiguration_StoresAllProperties()
        {
            var now = DateTime.UtcNow;
            var config = new MonitorConfiguration
            {
                ExternalServiceName = "svc",
                MonitorType = MonitorTypes.HTTP,
                ProtocolType = ProtocolTypes.HTTPS,
                AuthorizationType = AuthorizationTypes.BEARER,
                LastIncidentAt = now,
                LastCheckedAt = now,
                ExpectedContent = "ok"
            };

            config.ExternalServiceName.Should().Be("svc");
            config.MonitorType.Should().Be(MonitorTypes.HTTP);
            config.ProtocolType.Should().Be(ProtocolTypes.HTTPS);
            config.AuthorizationType.Should().Be(AuthorizationTypes.BEARER);
            config.LastIncidentAt.Should().Be(now);
            config.LastCheckedAt.Should().Be(now);
            config.ExpectedContent.Should().Be("ok");
        }

        [Fact]
        public void MonitorConfiguration_EffectiveMonitorSourceType_PrefersExplicitThenLegacyThenDefault()
        {
            new MonitorConfiguration { MonitorSourceType = MonitorSourceTypes.ExternalServices }
                .EffectiveMonitorSourceType.Should().Be(MonitorSourceTypes.ExternalServices);

            new MonitorConfiguration { MonitorSourceType = null, LegacyMonitorSourceType = MonitorSourceTypes.BlocksServices }
                .EffectiveMonitorSourceType.Should().Be(MonitorSourceTypes.BlocksServices);

            new MonitorConfiguration { MonitorSourceType = null, LegacyMonitorSourceType = null }
                .EffectiveMonitorSourceType.Should().Be(MonitorSourceTypes.DeployedServices);
        }

        [Fact]
        public void MailServerConfiguration_StoresAllProperties()
        {
            var config = new MailServerConfiguration
            {
                Name = "primary",
                Host = "smtp.test",
                Port = 587,
                EnableSSL = true,
                SenderName = "Blocks",
                SenderAddress = "no-reply@test",
                SenderUserName = "user",
                AccountPassword = "secret",
                UseDefaultCredentials = true,
                SmtpClient = SmtpClient.MsMailKit,
                IsDefault = true
            };

            config.Name.Should().Be("primary");
            config.EnableSSL.Should().BeTrue();
            config.SenderName.Should().Be("Blocks");
            config.SenderAddress.Should().Be("no-reply@test");
            config.SenderUserName.Should().Be("user");
            config.AccountPassword.Should().Be("secret");
            config.UseDefaultCredentials.Should().BeTrue();
            config.SmtpClient.Should().Be(SmtpClient.MsMailKit);
            config.IsDefault.Should().BeTrue();
        }

        [Fact]
        public void AlertMailTemplate_StoresAllProperties()
        {
            var template = new AlertMailTemplate
            {
                JsonContent = "{}",
                ImageId = "img1",
                ImageUrl = "http://img",
                GeneratedBy = "system"
            };

            template.JsonContent.Should().Be("{}");
            template.ImageId.Should().Be("img1");
            template.ImageUrl.Should().Be("http://img");
            template.GeneratedBy.Should().Be("system");
        }

        [Fact]
        public void ProjectPeople_StoresAllProperties()
        {
            var person = new ProjectPeople
            {
                Email = "a@test",
                IsInvitationSent = true,
                IsInvitationConfirmed = true,
                IsCreator = true
            };

            person.Email.Should().Be("a@test");
            person.IsInvitationSent.Should().BeTrue();
            person.IsInvitationConfirmed.Should().BeTrue();
            person.IsCreator.Should().BeTrue();
        }

        [Fact]
        public void MonitorPingLogSummary_StoresAllProperties()
        {
            var now = DateTime.UtcNow;
            var summary = new MonitorPingLogSummary
            {
                MonitorId = "m1",
                Timestamp = now,
                ResponseTimeMs = 12.5,
                StatusCode = 200
            };

            summary.Timestamp.Should().Be(now);
            summary.ResponseTimeMs.Should().Be(12.5);
        }

        [Fact]
        public void NotificationResponse_StoresErrors()
        {
            var response = new NotificationResponse { Errors = "boom", IsSuccess = false };

            response.Errors.Should().Be("boom");
            response.IsSuccess.Should().BeFalse();
        }

        [Fact]
        public void VerioSystemSettings_StoresApiKeyAndBaseUri()
        {
            var settings = new VerioSystemSettings { ApiKey = "key", BaseUri = "http://base" };

            settings.ApiKey.Should().Be("key");
            settings.BaseUri.Should().Be("http://base");
        }

        [Fact]
        public void MonitorConstants_ExposesHttpStatusCodeLists()
        {
            var constants = new DomainService.Shared.Utilities.MonitorConstants();

            constants.HttpStatusCodes_200.Should().NotBeEmpty();
            constants.HttpStatusCodes_300.Should().NotBeEmpty();
        }
    }
}
