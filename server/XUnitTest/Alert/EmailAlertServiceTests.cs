using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Blocks.Genesis;
using Blocks.Secrets;
using DomainService.Alert.Entities;
using DomainService.Alert.Services;
using Blocks.Genesis.Entities.Monitor;
using DomainService.Monitor.Models;
using DomainService.Monitor.MonitorIncidentService;
using DomainService.Monitor.Services;
using DomainService.Shared.Models;
using DomainService.Shared.Services;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
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
            new(new Mock<ILogger<EmailAlertService>>().Object, repo, AlertMailTestDoubles.PasswordResolver());

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
            var sut = new EmailAlertService(logger.Object, Repo(), AlertMailTestDoubles.PasswordResolver());
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
            var sut = new EmailAlertService(logger.Object, repo, AlertMailTestDoubles.PasswordResolver());

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

        // ---------- Alert-mail password from Blocks Secrets (blocks-monitor#253) ----------

        private const string Reference = "secret-ref-7f3a";
        private const string SecretPassword = "new-pass-9c1e";
        private const string LegacyPassword = "old-pass-4b2d";

        private static readonly MonitorIncident OpenIncident =
            new() { MonitorUrl = "http://api", IsResolved = false, StartTime = DateTime.UtcNow, LastStatusCode = 500, FailureReason = "down" };

        private static Mock<ISecretService> Secrets(string value = SecretPassword)
        {
            var secrets = new Mock<ISecretService>(MockBehavior.Strict);
            secrets.Setup(s => s.GetValueAsync(Reference, It.IsAny<CancellationToken>())).ReturnsAsync(value);
            return secrets;
        }

        private static Mock<ISecretService> SecretsThrowing(Exception exception)
        {
            var secrets = new Mock<ISecretService>(MockBehavior.Strict);
            secrets.Setup(s => s.GetValueAsync(Reference, It.IsAny<CancellationToken>())).ThrowsAsync(exception);
            return secrets;
        }

        // Every exception message deliberately carries the reference id, as the real Secret* ones do.
        private static Exception SecretFailure(string kind) => kind switch
        {
            nameof(SecretNotFoundException) => new SecretNotFoundException(Reference),
            nameof(SecretStateException) => new SecretStateException("deleted", $"read {Reference}"),
            nameof(SecretAccessDeniedException) => new SecretAccessDeniedException("denied", $"no access to {Reference}"),
            nameof(SecretVaultException) => new SecretVaultException($"vault down for {Reference}", "get", Reference),
            nameof(SecretValidationException) => new SecretValidationException($"bad id {Reference}"),
            nameof(InvalidOperationException) => new InvalidOperationException($"Required Azure config value 'KeyVault:KeyVaultUrl' is missing ({Reference})"),
            _ => throw new ArgumentOutOfRangeException(nameof(kind))
        };

        private static AlertRepoService SmtpRepo(FakeSmtpServer smtp, SmtpClient client, string accountPassword, string? reference) =>
            Repo(
                templates: new List<EmailTemplate> { new() { Name = "AlertIncident", MailConfigurationId = "cfg1", TemplateSubject = "S {{MonitorName}}", TemplateBody = "B {{MonitorUrl}}" } },
                configs: new List<MailServerConfiguration>
                {
                    new()
                    {
                        ItemId = "cfg1", Host = smtp.Host, Port = smtp.Port, EnableSSL = false,
                        SenderAddress = "from@test.com", SenderName = "Blocks", SenderUserName = "mailer",
                        UseDefaultCredentials = false, AccountPassword = accountPassword,
                        AccountPasswordReference = reference, SmtpClient = client
                    }
                });

        private static EmailAlertService Sut(
            AlertRepoService repo,
            Mock<ISecretService> secrets,
            ILogger<EmailAlertService>? logger = null,
            string? rootTenantId = AlertMailTestDoubles.RootTenantId) =>
            new(logger ?? new Mock<ILogger<EmailAlertService>>().Object, repo, AlertMailTestDoubles.PasswordResolver(secrets, rootTenantId));

        // C4: nothing logged - message, structured values or exception - may carry a password or the reference id.
        private static void AssertNoSecretMaterialLogged(CapturingLogger<EmailAlertService> logger)
        {
            foreach (var entry in logger.Entries)
            {
                entry.AllText.Should().NotContain(Reference).And.NotContain(SecretPassword).And.NotContain(LegacyPassword);
            }
        }

        private static void AssertCredentialFailureLogged(CapturingLogger<EmailAlertService> logger, string exceptionType, string failureClass)
        {
            var entry = logger.Entries.Should().ContainSingle(e => e.Message.Contains("ALERT MAIL FAILED (credential)")).Subject;
            entry.Level.Should().Be(LogLevel.Error);
            entry.Exception.Should().BeNull("the exception object carries the reference id");
            entry.State["ConfigId"].Should().Be("cfg1");
            entry.State["ExceptionType"].Should().Be(exceptionType);
            entry.State["FailureClass"].Should().Be(failureClass);
        }

        [Theory]
        [InlineData(SmtpClient.Default)]   // H5: MailKit path
        [InlineData(SmtpClient.MsMailKit)] // H6: System.Net SMTP path
        public async Task HandleEmailAlertAsync_ReferencedConfig_AuthenticatesWithSecretValue(SmtpClient client)
        {
            // E2/E3: AccountPassword is empty, the password comes from the secret.
            using var smtp = new FakeSmtpServer();
            var secrets = Secrets();
            var logger = new CapturingLogger<EmailAlertService>();

            var result = await Sut(SmtpRepo(smtp, client, "", Reference), secrets, logger).HandleEmailAlertAsync(Monitor("a@test.com"), OpenIncident);

            result.Should().BeTrue();
            smtp.Credentials.Should().Equal(("mailer", SecretPassword));
            secrets.Verify(s => s.GetValueAsync(Reference, It.IsAny<CancellationToken>()), Times.Once);
            AssertNoSecretMaterialLogged(logger);
        }

        [Theory]
        [InlineData(SmtpClient.Default)]
        [InlineData(SmtpClient.MsMailKit)]
        public async Task HandleEmailAlertAsync_LegacyConfig_UsesAccountPasswordWithNoSecretRead(SmtpClient client)
        {
            // H7, C8, E1: no reference means plaintext exactly as today and 0 Blocks Secrets calls.
            using var smtp = new FakeSmtpServer();
            var secrets = new Mock<ISecretService>(MockBehavior.Strict);

            var result = await Sut(SmtpRepo(smtp, client, LegacyPassword, null), secrets).HandleEmailAlertAsync(Monitor("a@test.com"), OpenIncident);

            result.Should().BeTrue();
            smtp.Credentials.Should().Equal(("mailer", LegacyPassword));
            secrets.Verify(s => s.GetValueAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        }

        [Fact]
        public async Task HandleEmailAlertAsync_EmptyReference_IsTreatedAsLegacy()
        {
            // An empty reference means AccountPassword holds the password.
            using var smtp = new FakeSmtpServer();
            var secrets = new Mock<ISecretService>(MockBehavior.Strict);

            var result = await Sut(SmtpRepo(smtp, SmtpClient.Default, LegacyPassword, ""), secrets).HandleEmailAlertAsync(Monitor("a@test.com"), OpenIncident);

            result.Should().BeTrue();
            smtp.Credentials.Should().Equal(("mailer", LegacyPassword));
        }

        [Theory]
        [InlineData(SmtpClient.Default)]
        [InlineData(SmtpClient.MsMailKit)]
        public async Task HandleEmailAlertAsync_SeveralRecipients_ResolvesPasswordOnce(SmtpClient client)
        {
            // H9, C8, E6: 5 recipients, 5 SMTP sessions, exactly 1 secret read.
            using var smtp = new FakeSmtpServer();
            var secrets = Secrets();
            var recipients = new[] { "a@test.com", "b@test.com", "c@test.com", "d@test.com", "e@test.com" };

            var result = await Sut(SmtpRepo(smtp, client, "", Reference), secrets).HandleEmailAlertAsync(Monitor(recipients), OpenIncident);

            result.Should().BeTrue();
            smtp.Connections.Should().Be(5);
            smtp.Credentials.Should().HaveCount(5).And.OnlyContain(c => c.Password == SecretPassword);
            secrets.Verify(s => s.GetValueAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Once);
        }

        [Fact]
        public async Task HandleEmailAlertAsync_ReferenceAndPlaintextBothPresent_UsesOnlyTheReference()
        {
            // C3: the reference wins over a non-empty AccountPassword.
            using var smtp = new FakeSmtpServer();

            var result = await Sut(SmtpRepo(smtp, SmtpClient.Default, LegacyPassword, Reference), Secrets()).HandleEmailAlertAsync(Monitor("a@test.com"), OpenIncident);

            result.Should().BeTrue();
            smtp.Credentials.Should().Equal(("mailer", SecretPassword));
        }

        [Fact]
        public async Task HandleEmailAlertAsync_ReferenceFailsWithPlaintextPresent_DoesNotFallBack()
        {
            // C3, E5: Key Vault unreachable - the old plaintext is never tried.
            using var smtp = new FakeSmtpServer();
            var logger = new CapturingLogger<EmailAlertService>();

            var result = await Sut(SmtpRepo(smtp, SmtpClient.Default, LegacyPassword, Reference), SecretsThrowing(SecretFailure(nameof(SecretVaultException))), logger)
                .HandleEmailAlertAsync(Monitor("a@test.com"), OpenIncident);

            result.Should().BeFalse();
            smtp.Connections.Should().Be(0);
            smtp.Credentials.Should().BeEmpty();
            AssertCredentialFailureLogged(logger, nameof(SecretVaultException), "vault_unavailable");
            AssertNoSecretMaterialLogged(logger);
        }

        [Fact]
        public async Task HandleEmailAlertAsync_TemplateMissing_MakesNoSecretRead()
        {
            // C10
            var secrets = new Mock<ISecretService>(MockBehavior.Strict);

            var result = await Sut(Repo(configs: new List<MailServerConfiguration> { new() { ItemId = "cfg1", AccountPasswordReference = Reference } }), secrets)
                .HandleEmailAlertAsync(Monitor("a@test.com"), OpenIncident);

            result.Should().BeFalse();
            secrets.Verify(s => s.GetValueAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        }

        [Fact]
        public async Task HandleEmailAlertAsync_MailConfigMissing_MakesNoSecretRead()
        {
            // C10
            var secrets = new Mock<ISecretService>(MockBehavior.Strict);
            var repo = Repo(templates: new List<EmailTemplate> { new() { Name = "AlertIncident", MailConfigurationId = "cfg9", TemplateSubject = "S", TemplateBody = "B" } });

            var result = await Sut(repo, secrets).HandleEmailAlertAsync(Monitor("a@test.com"), OpenIncident);

            result.Should().BeFalse();
            secrets.Verify(s => s.GetValueAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
        }

        [Theory]
        [InlineData(nameof(SecretNotFoundException), SmtpClient.Default)]
        [InlineData(nameof(SecretStateException), SmtpClient.Default)]
        [InlineData(nameof(SecretAccessDeniedException), SmtpClient.MsMailKit)]
        [InlineData(nameof(SecretNotFoundException), SmtpClient.MsMailKit)]
        public async Task HandleEmailAlertAsync_SecretUnreadable_FailsWithoutSmtpConnection(string failure, SmtpClient client)
        {
            // C1, C4, E4: missing, archived/locked or denied secret.
            using var smtp = new FakeSmtpServer();
            var logger = new CapturingLogger<EmailAlertService>();

            var result = await Sut(SmtpRepo(smtp, client, "", Reference), SecretsThrowing(SecretFailure(failure)), logger)
                .HandleEmailAlertAsync(Monitor("a@test.com", "b@test.com"), OpenIncident);

            result.Should().BeFalse();
            smtp.Connections.Should().Be(0);
            AssertCredentialFailureLogged(logger, failure, "credential");
            AssertNoSecretMaterialLogged(logger);
        }

        [Fact]
        public async Task HandleEmailAlertAsync_VaultUnavailable_FailsAsVaultUnavailable()
        {
            // C2
            using var smtp = new FakeSmtpServer();
            var logger = new CapturingLogger<EmailAlertService>();

            var result = await Sut(SmtpRepo(smtp, SmtpClient.MsMailKit, "", Reference), SecretsThrowing(SecretFailure(nameof(SecretVaultException))), logger)
                .HandleEmailAlertAsync(Monitor("a@test.com"), OpenIncident);

            result.Should().BeFalse();
            smtp.Connections.Should().Be(0);
            AssertCredentialFailureLogged(logger, nameof(SecretVaultException), "vault_unavailable");
            AssertNoSecretMaterialLogged(logger);
        }

        [Theory]
        [InlineData(nameof(InvalidOperationException))]
        [InlineData(nameof(SecretValidationException))]
        public async Task HandleEmailAlertAsync_UnexpectedResolutionError_FailsAsUnexpected(string failure)
        {
            // Q3: any other exception fails the email like C1, failure class "unexpected", type only.
            using var smtp = new FakeSmtpServer();
            var logger = new CapturingLogger<EmailAlertService>();

            var result = await Sut(SmtpRepo(smtp, SmtpClient.Default, LegacyPassword, Reference), SecretsThrowing(SecretFailure(failure)), logger)
                .HandleEmailAlertAsync(Monitor("a@test.com"), OpenIncident);

            result.Should().BeFalse();
            smtp.Connections.Should().Be(0);
            AssertCredentialFailureLogged(logger, failure, "unexpected");
            AssertNoSecretMaterialLogged(logger);
        }

        [Fact]
        public async Task HandleEmailAlertAsync_RootTenantMissing_FailsReferencedConfigWithoutSecretCall()
        {
            // C5
            using var smtp = new FakeSmtpServer();
            var secrets = new Mock<ISecretService>(MockBehavior.Strict);
            var logger = new CapturingLogger<EmailAlertService>();

            var result = await Sut(SmtpRepo(smtp, SmtpClient.Default, "", Reference), secrets, logger, rootTenantId: null)
                .HandleEmailAlertAsync(Monitor("a@test.com"), OpenIncident);

            result.Should().BeFalse();
            smtp.Connections.Should().Be(0);
            secrets.Verify(s => s.GetValueAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
            AssertCredentialFailureLogged(logger, "none", "root_tenant_not_configured");
            AssertNoSecretMaterialLogged(logger);
        }

        [Fact]
        public async Task HandleEmailAlertAsync_RootTenantMissing_LegacyConfigStillSends()
        {
            // C5: only referenced configurations need RootTenantId.
            using var smtp = new FakeSmtpServer();

            var result = await Sut(SmtpRepo(smtp, SmtpClient.Default, LegacyPassword, null), new Mock<ISecretService>(MockBehavior.Strict), rootTenantId: null)
                .HandleEmailAlertAsync(Monitor("a@test.com"), OpenIncident);

            result.Should().BeTrue();
            smtp.Credentials.Should().Equal(("mailer", LegacyPassword));
        }

        [Fact]
        public async Task CredentialFailure_IncidentProcessingContinues()
        {
            // C7: a credential failure is an ordinary email failure; the monitor incident is still
            // created, the configuration updated and the in-app notification sent.
            using var smtp = new FakeSmtpServer();
            var repo = SmtpRepo(smtp, SmtpClient.Default, "", Reference);
            var email = Sut(repo, SecretsThrowing(SecretFailure(nameof(SecretNotFoundException))));

            var http = new Mock<IHttpHelperServices>();
            http.Setup(h => h.MakeHttpRequest<NotificationResponse>(
                    It.IsAny<string>(), It.IsAny<string>(), It.IsAny<HttpMethod>(),
                    It.IsAny<object>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<string>()))
                .ReturnsAsync((new NotificationResponse { IsSuccess = true }, new HttpResponseMessage(HttpStatusCode.OK)));
            var notification = new NotificationAlertService(
                new Mock<ILogger<NotificationAlertService>>().Object, http.Object, new Mock<ICryptoService>().Object,
                new Mock<ITenants>().Object, repo, new Mock<IConfiguration>().Object);
            var incidentRepo = new Mock<IMonitorIncidentRepoService>();
            incidentRepo.Setup(r => r.GetActiveIncidentAsync("m1")).ReturnsAsync((MonitorIncident?)null);
            var configRepo = new Mock<IMonitorConfigurationRepoService>();
            var incidentLogger = new CapturingLogger<MonitorIncidentService>();
            var sut = new MonitorIncidentService(incidentRepo.Object, notification, configRepo.Object, email, incidentLogger);

            var monitor = new MonitorConfiguration { ItemId = "m1", Name = "Api", Url = "http://api", TenantId = "proj", Emails = new List<string> { "a@test.com" } };
            await sut.HandleIncidentAsync(monitor, new MonitorPingLog { MonitorId = "m1", StatusCode = 500, Timestamp = DateTime.UtcNow, ResponseMessage = "down" });

            incidentRepo.Verify(r => r.CreateIncidentAsync(It.IsAny<MonitorIncident>()), Times.Once);
            configRepo.Verify(r => r.UpdateConfigurationIncidentAsync(It.IsAny<MonitorConfigurationIncidentUpdate>()), Times.Once);
            incidentLogger.Entries.Should().Contain(e => e.Message.StartsWith("Incident started for http://api"));
            incidentLogger.Entries.Should().NotContain(e => e.Level == LogLevel.Error);
            smtp.Connections.Should().Be(0);
        }
    }
}
