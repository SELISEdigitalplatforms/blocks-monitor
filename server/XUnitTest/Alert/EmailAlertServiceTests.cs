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
            IEnumerable<EmailTemplate> templates = null,
            IEnumerable<MailServerConfiguration> configs = null,
            bool throwOnTemplateRead = false)
        {
            var db = new MongoMocks.DbBuilder()
                .With(new List<ProjectPeople>())
                .With(throwOnTemplateRead
                    ? MongoMocks.CollectionThrowing<EmailTemplate>()
                    : MongoMocks.Collection(templates ?? new List<EmailTemplate>()))
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
        public async Task HandleEmailAlertAsync_WhenTemplateMissing_LogsNotFoundWarning()
        {
            // C2: the missing template is logged by name and the mail is skipped.
            var logger = new Mock<ILogger<EmailAlertService>>();
            var sut = new EmailAlertService(logger.Object, Repo());
            var incident = new MonitorIncident { MonitorUrl = "http://api", IsResolved = true };

            var result = await sut.HandleEmailAlertAsync(Monitor("a@test.com"), incident);

            result.Should().BeFalse();
            logger.Verify(l => l.Log(LogLevel.Warning, It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, _) => v.ToString()!.Contains("Mail template AlertResolved not found")),
                It.IsAny<Exception>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Once);
        }

        [Fact]
        public async Task HandleEmailAlertAsync_WhenMailConfigMissing_LogsConfigNotFoundWarning()
        {
            // C3: unchanged behavior, no throw.
            var logger = new Mock<ILogger<EmailAlertService>>();
            var repo = Repo(templates: new List<EmailTemplate>
            {
                new() { Name = "AlertIncident", MailConfigurationId = "cfg9", TemplateSubject = "S", TemplateBody = "B" }
            });
            var sut = new EmailAlertService(logger.Object, repo);

            var result = await sut.HandleEmailAlertAsync(Monitor("a@test.com"), new MonitorIncident { MonitorUrl = "http://api", IsResolved = false });

            result.Should().BeFalse();
            logger.Verify(l => l.Log(LogLevel.Warning, It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, _) => v.ToString()!.Contains("Mail config cfg9 not found")),
                It.IsAny<Exception>(), It.IsAny<Func<It.IsAnyType, Exception?, string>>()), Times.Once);
        }

        [Fact]
        public async Task HandleEmailAlertAsync_WhenMailConfigMissing_ReturnsFalse()
        {
            var repo = Repo(templates: new List<EmailTemplate>
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
                templates: new List<EmailTemplate> { new() { Name = "AlertIncident", MailConfigurationId = "cfg1", TemplateSubject = "S", TemplateBody = "B" } },
                configs: new List<MailServerConfiguration> { new() { ItemId = "cfg1", Host = "smtp.test", Port = 25 } });
            var incident = new MonitorIncident { MonitorUrl = "http://api", IsResolved = false, StartTime = DateTime.UtcNow };

            var result = await Sut(repo).HandleEmailAlertAsync(Monitor(), incident);

            result.Should().BeTrue();
        }

        [Fact]
        public async Task HandleEmailAlertAsync_ResolvedIncident_UsesResolvedTemplateAndReturnsTrue()
        {
            var repo = Repo(
                templates: new List<EmailTemplate> { new() { Name = "AlertResolved", MailConfigurationId = "cfg1", TemplateSubject = "S", TemplateBody = "B" } },
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

        [Fact]
        public async Task HandleEmailAlertAsync_WithRecipientAndMailKitClient_AttemptsSendAndReturnsFalseOnFailure()
        {
            // SmtpClient.Default routes through the MailKit sender. Pointing it at a closed loopback port
            // makes the connection fail fast, exercising the MailKit send path and its catch block.
            var repo = Repo(
                templates: new List<EmailTemplate> { new() { Name = "AlertIncident", MailConfigurationId = "cfg1", TemplateSubject = "S {{MonitorName}}", TemplateBody = "B {{MonitorUrl}}" } },
                configs: new List<MailServerConfiguration>
                {
                    new() { ItemId = "cfg1", Host = "127.0.0.1", Port = 1, EnableSSL = false, SenderAddress = "from@test", SenderName = "Blocks", SmtpClient = SmtpClient.Default }
                });
            var incident = new MonitorIncident { MonitorUrl = "http://api", IsResolved = false, StartTime = DateTime.UtcNow, LastStatusCode = 500, FailureReason = "down" };

            var result = await Sut(repo).HandleEmailAlertAsync(Monitor("a@test.com"), incident);

            result.Should().BeFalse();
        }

        [Fact]
        public async Task HandleEmailAlertAsync_WithRecipientAndSystemSmtpClient_AttemptsSendAndReturnsFalseOnFailure()
        {
            // A non-default SmtpClient routes through the System.Net.Mail sender.
            var repo = Repo(
                templates: new List<EmailTemplate> { new() { Name = "AlertIncident", MailConfigurationId = "cfg1", TemplateSubject = "S", TemplateBody = "B {{MonitorName}}" } },
                configs: new List<MailServerConfiguration>
                {
                    new() { ItemId = "cfg1", Host = "127.0.0.1", Port = 1, EnableSSL = false, SenderAddress = "from@test", SenderName = "Blocks", UseDefaultCredentials = false, SenderUserName = "u", AccountPassword = "p", SmtpClient = SmtpClient.MsMailKit }
                });
            var incident = new MonitorIncident { MonitorUrl = "http://api", IsResolved = false, StartTime = DateTime.UtcNow, LastStatusCode = 500 };

            var result = await Sut(repo).HandleEmailAlertAsync(Monitor("a@test.com"), incident);

            result.Should().BeFalse();
        }
    }
}
