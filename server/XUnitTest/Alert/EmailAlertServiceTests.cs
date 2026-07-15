using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Blocks.Genesis;
using DomainService.Alert.Entities;
using DomainService.Alert.Services;
using DomainService.Monitor.Entity;
using DomainService.Shared.Models;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;
using XUnitTest.Utilities;

namespace XUnitTest.Alert
{
    public class EmailAlertServiceTests
    {
        private static AlertRepoService Repo(
            IEnumerable<AlertMailTemplate> templates = null,
            IEnumerable<MailServerConfiguration> configs = null,
            bool throwOnTemplateRead = false)
        {
            var db = new MongoMocks.DbBuilder()
                .With(new List<ProjectPeople>())
                .With(throwOnTemplateRead
                    ? MongoMocks.CollectionThrowing<AlertMailTemplate>()
                    : MongoMocks.Collection(templates ?? new List<AlertMailTemplate>()))
                .With(configs ?? new List<MailServerConfiguration>());
            return new AlertRepoService(db.Provider, MongoMocks.BlocksSecret().Object);
        }

        private static EmailAlertService Sut(AlertRepoService repo) =>
            new(new Mock<ILogger<EmailAlertService>>().Object, repo);

        private static MonitorConfiguration Monitor(params string[] emails) =>
            new() { Name = "Api", Url = "http://api", Emails = new List<string>(emails) };

        [Fact]
        public async Task HandleEmailAlertAsync_WhenTemplateMissing_ReturnsFalse()
        {
            var sut = Sut(Repo());
            var incident = new MonitorIncident { MonitorUrl = "http://api", IsResolved = false };

            var result = await sut.HandleEmailAlertAsync(Monitor("a@test.com"), incident);

            result.Should().BeFalse();
        }

        [Fact]
        public async Task HandleEmailAlertAsync_WhenMailConfigMissing_ReturnsFalse()
        {
            var repo = Repo(templates: new List<AlertMailTemplate>
            {
                new() { Name = "AlertIncident", MailConfigurationId = "cfg1", TemplateSubject = "S", TemplateBody = "B" }
            });
            var incident = new MonitorIncident { MonitorUrl = "http://api", IsResolved = false };

            var result = await Sut(repo).HandleEmailAlertAsync(Monitor("a@test.com"), incident);

            result.Should().BeFalse();
        }

        [Fact]
        public async Task HandleEmailAlertAsync_WithNoRecipients_ReturnsTrueWithoutSending()
        {
            // Template + config resolve, but there are no recipient emails, so the send loop is skipped.
            var repo = Repo(
                templates: new List<AlertMailTemplate> { new() { Name = "AlertIncident", MailConfigurationId = "cfg1", TemplateSubject = "S", TemplateBody = "B" } },
                configs: new List<MailServerConfiguration> { new() { ItemId = "cfg1", Host = "smtp.test", Port = 25 } });
            var incident = new MonitorIncident { MonitorUrl = "http://api", IsResolved = false, StartTime = DateTime.UtcNow };

            var result = await Sut(repo).HandleEmailAlertAsync(Monitor(), incident);

            result.Should().BeTrue();
        }

        [Fact]
        public async Task HandleEmailAlertAsync_ResolvedIncident_UsesResolvedTemplateAndReturnsTrue()
        {
            var repo = Repo(
                templates: new List<AlertMailTemplate> { new() { Name = "AlertResolved", MailConfigurationId = "cfg1", TemplateSubject = "S", TemplateBody = "B" } },
                configs: new List<MailServerConfiguration> { new() { ItemId = "cfg1", Host = "smtp.test", Port = 25 } });
            var incident = new MonitorIncident
            {
                MonitorUrl = "http://api",
                IsResolved = true,
                StartTime = DateTime.UtcNow.AddMinutes(-5),
                EndTime = DateTime.UtcNow
            };

            var result = await Sut(repo).HandleEmailAlertAsync(Monitor(), incident);

            result.Should().BeTrue();
        }

        [Fact]
        public async Task HandleEmailAlertAsync_WhenRepoThrows_ReturnsFalse()
        {
            var sut = Sut(Repo(throwOnTemplateRead: true));
            var incident = new MonitorIncident { MonitorUrl = "http://api", IsResolved = false };

            var result = await sut.HandleEmailAlertAsync(Monitor("a@test.com"), incident);

            result.Should().BeFalse();
        }
    }
}
