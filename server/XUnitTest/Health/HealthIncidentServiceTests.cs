using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Blocks.Genesis;
using Blocks.Secrets;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using MongoDB.Driver;
using DomainService.Shared.Services;
using DomainService.Alert.Entities;
using DomainService.Alert.Services;
using DomainService.Health.Services;
using Blocks.Genesis.Entities.Monitor;
using DomainService.Shared.Models;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Moq;
using XUnitTest.Utilities;

namespace XUnitTest.Health
{
    public class HealthIncidentServiceTests
    {
        private HealthIncidentService Build(
            IEnumerable<MonitorConfiguration> configs = null,
            IEnumerable<MonitorIncident> incidents = null)
        {
            var db = new MongoMocks.DbBuilder()
                .With(configs ?? new List<MonitorConfiguration>())
                .With(incidents ?? new List<MonitorIncident>())
                .With(new List<ProjectPeople>())
                .With(new List<EmailTemplate>())
                .With(new List<MailServerConfiguration>());
            var secret = MongoMocks.BlocksSecret().Object;

            var healthRepo = new HealthConfigurationRepoService(
                new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, secret, PassThroughMonitorDataAccess.Instance);
            var alertRepo = new AlertRepoService(db.Provider, secret);
            var email = new EmailAlertService(new Mock<ILogger<EmailAlertService>>().Object, alertRepo, AlertMailTestDoubles.PasswordResolver());
            var http = new Mock<IHttpHelperServices>();
            http.Setup(h => h.MakeHttpRequest<NotificationResponse>(
                    It.IsAny<string>(), It.IsAny<string>(), It.IsAny<HttpMethod>(),
                    It.IsAny<object>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<string>()))
                .ReturnsAsync((new NotificationResponse { IsSuccess = true }, new HttpResponseMessage(HttpStatusCode.OK)));
            var notification = new NotificationAlertService(
                new Mock<ILogger<NotificationAlertService>>().Object, http.Object,
                new Mock<ICryptoService>().Object, new Mock<ITenants>().Object, alertRepo, new Mock<IConfiguration>().Object);

            return new HealthIncidentService(
                new Mock<ILogger<HealthIncidentService>>().Object, db.Provider, healthRepo, email, notification, secret, PassThroughMonitorDataAccess.Instance);
        }

        // Builds the service with caller-supplied collections so writes can be captured or made to fail.
        private HealthIncidentService BuildWithIncidentCollection(
            Mock<IMongoCollection<MonitorIncident>> incidentColl,
            IEnumerable<MonitorConfiguration> configs = null,
            Mock<IMongoCollection<MonitorConfiguration>> configColl = null)
        {
            var db = new MongoMocks.DbBuilder()
                .With(configColl ?? MongoMocks.Collection(configs ?? new List<MonitorConfiguration>()))
                .With(incidentColl)
                .With(new List<ProjectPeople>())
                .With(new List<EmailTemplate>())
                .With(new List<MailServerConfiguration>());
            var secret = MongoMocks.BlocksSecret().Object;

            var healthRepo = new HealthConfigurationRepoService(
                new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, secret, PassThroughMonitorDataAccess.Instance);
            var alertRepo = new AlertRepoService(db.Provider, secret);
            var email = new EmailAlertService(new Mock<ILogger<EmailAlertService>>().Object, alertRepo, AlertMailTestDoubles.PasswordResolver());
            var http = new Mock<IHttpHelperServices>();
            http.Setup(h => h.MakeHttpRequest<NotificationResponse>(
                    It.IsAny<string>(), It.IsAny<string>(), It.IsAny<HttpMethod>(),
                    It.IsAny<object>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<string>()))
                .ReturnsAsync((new NotificationResponse { IsSuccess = true }, new HttpResponseMessage(HttpStatusCode.OK)));
            var notification = new NotificationAlertService(
                new Mock<ILogger<NotificationAlertService>>().Object, http.Object,
                new Mock<ICryptoService>().Object, new Mock<ITenants>().Object, alertRepo, new Mock<IConfiguration>().Object);

            return new HealthIncidentService(
                new Mock<ILogger<HealthIncidentService>>().Object, db.Provider, healthRepo, email, notification, secret, PassThroughMonitorDataAccess.Instance);
        }

        private static MonitorConfiguration Config() => new() { ItemId = "m1", Name = "Api", Url = "http://api" };

        [Fact]
        public async Task HandleIncidentAsync_WhenItemIdEmpty_ReturnsWithoutThrowing()
        {
            var act = async () => await Build().HandleIncidentAsync("");
            await act.Should().NotThrowAsync();
        }

        [Fact]
        public async Task HandleIncidentAsync_WhenNoUnresolvedIncident_ReturnsEarly()
        {
            var act = async () => await Build(incidents: new List<MonitorIncident>()).HandleIncidentAsync("m1");
            await act.Should().NotThrowAsync();
        }

        [Fact]
        public async Task HandleIncidentAsync_WithUnresolvedIncidentAndConfig_ResolvesWithoutThrowing()
        {
            var sut = Build(
                configs: new List<MonitorConfiguration> { Config() },
                incidents: new List<MonitorIncident> { new() { ItemId = "i1", MonitorId = "m1", IsResolved = false } });

            var act = async () => await sut.HandleIncidentAsync("m1");

            await act.Should().NotThrowAsync();
        }

        [Fact]
        public async Task CreateIncidentAsync_WhenConfigNull_ReturnsWithoutThrowing()
        {
            var act = async () => await Build().CreateIncidentAsync(null);
            await act.Should().NotThrowAsync();
        }

        [Fact]
        public async Task CreateIncidentAsync_WhenExistingUnresolvedIncident_SkipsCreation()
        {
            var sut = Build(incidents: new List<MonitorIncident> { new() { ItemId = "i1", MonitorId = "m1", IsResolved = false } });

            var act = async () => await sut.CreateIncidentAsync(Config());

            await act.Should().NotThrowAsync();
        }

        [Fact]
        public async Task CreateIncidentAsync_WhenNoExistingIncident_CreatesAndNotifiesWithoutThrowing()
        {
            var sut = Build(incidents: new List<MonitorIncident>());

            var act = async () => await sut.CreateIncidentAsync(Config());

            await act.Should().NotThrowAsync();
        }

        [Fact]
        public async Task ResolveIncidentAsync_WhenConfigNull_ReturnsWithoutThrowing()
        {
            var act = async () => await Build().ResolveIncidentAsync(null);
            await act.Should().NotThrowAsync();
        }

        [Fact]
        public async Task ResolveIncidentAsync_WhenNoOpenIncident_MarksConfigUpWithoutThrowing()
        {
            var sut = Build(incidents: new List<MonitorIncident>());

            var act = async () => await sut.ResolveIncidentAsync(Config());

            await act.Should().NotThrowAsync();
        }

        [Fact]
        public async Task ResolveIncidentAsync_WhenOpenIncidentExists_ResolvesWithoutThrowing()
        {
            var sut = Build(incidents: new List<MonitorIncident> { new() { ItemId = "i1", MonitorId = "m1", IsResolved = false } });

            var act = async () => await sut.ResolveIncidentAsync(Config());

            await act.Should().NotThrowAsync();
        }

        [Fact]
        public async Task HandleIncidentAsync_WhenIncidentExistsButConfigMissing_ReturnsWithoutThrowing()
        {
            // An unresolved incident exists, but the matching health configuration has been removed,
            // so the resolve path is skipped after logging a warning.
            var sut = Build(
                configs: new List<MonitorConfiguration>(),
                incidents: new List<MonitorIncident> { new() { ItemId = "i1", MonitorId = "m1", IsResolved = false } });

            var act = async () => await sut.HandleIncidentAsync("m1");

            await act.Should().NotThrowAsync();
        }

        [Fact]
        public async Task CreateIncidentAsync_WhenInsertThrows_SwallowsError()
        {
            var incidentColl = MongoMocks.Collection(new List<MonitorIncident>());
            incidentColl.Setup(c => c.InsertOneAsync(It.IsAny<MonitorIncident>(), It.IsAny<InsertOneOptions>(), It.IsAny<CancellationToken>()))
                .ThrowsAsync(new MongoException("boom"));

            var act = async () => await BuildWithIncidentCollection(incidentColl).CreateIncidentAsync(Config());

            await act.Should().NotThrowAsync();
        }

        [Fact]
        public async Task ResolveIncidentAsync_WhenUpdateThrows_Rethrows()
        {
            var incidentColl = MongoMocks.Collection(new List<MonitorIncident>
            {
                new() { ItemId = "i1", MonitorId = "m1", IsResolved = false }
            });
            incidentColl.Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<MonitorIncident>>(), It.IsAny<UpdateDefinition<MonitorIncident>>(),
                    It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
                .ThrowsAsync(new MongoException("boom"));

            var act = async () => await BuildWithIncidentCollection(incidentColl).ResolveIncidentAsync(Config());

            await act.Should().ThrowAsync<MongoException>();
        }

        // Resolves with the given incidents and returns the $set sent to the monitor configuration.
        private async Task<BsonDocument> ResolveAndCaptureConfigSet(List<MonitorIncident> incidents)
        {
            UpdateDefinition<MonitorConfiguration>? captured = null;
            var configColl = MongoMocks.Collection(new List<MonitorConfiguration> { Config() });
            configColl.Setup(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<UpdateDefinition<MonitorConfiguration>>(),
                    It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()))
                .Callback<FilterDefinition<MonitorConfiguration>, UpdateDefinition<MonitorConfiguration>, UpdateOptions, CancellationToken>((_, u, _, _) => captured = u)
                .ReturnsAsync(new UpdateResult.Acknowledged(1, 1, null));

            await BuildWithIncidentCollection(MongoMocks.Collection(incidents), configColl: configColl).ResolveIncidentAsync(Config());

            captured.Should().NotBeNull();
            var rendered = captured!.Render(new RenderArgs<MonitorConfiguration>(
                BsonSerializer.LookupSerializer<MonitorConfiguration>(), BsonSerializer.SerializerRegistry));
            return rendered.AsBsonDocument["$set"].AsBsonDocument;
        }

        [Fact]
        public async Task ResolveIncidentAsync_WhenOpenIncidentExists_MovesLastIncidentAtToTheRecovery()
        {
            // "Currently up for" counts from LastIncidentAt, so a recovery must move it, as it does for HTTP monitors.
            var before = DateTime.UtcNow;

            var set = await ResolveAndCaptureConfigSet(new List<MonitorIncident>
            {
                new() { ItemId = "i1", MonitorId = "m1", IsResolved = false, StartTime = before.AddMinutes(-3) }
            });

            set["CurrentStatus"].AsBoolean.Should().BeTrue();
            set.Contains("LastIncidentAt").Should().BeTrue();
            set["LastIncidentAt"].ToUniversalTime().Should().BeOnOrAfter(before.AddMilliseconds(-1));
            set["LastIncidentAt"].Should().Be(set["LastCheckedAt"]);
        }

        [Fact]
        public async Task ResolveIncidentAsync_WhenNoOpenIncident_LeavesLastIncidentAtAlone()
        {
            // A ping while already up is not a status change.
            var set = await ResolveAndCaptureConfigSet(new List<MonitorIncident>());

            set["CurrentStatus"].AsBoolean.Should().BeTrue();
            set.Contains("LastIncidentAt").Should().BeFalse();
        }

        // ---------- Alert-mail password from Blocks Secrets (blocks-monitor#253) ----------

        private const string MailReference = "secret-ref-7f3a";
        private const string MailSecretPassword = "new-pass-9c1e";
        private const string MailLegacyPassword = "old-pass-4b2d";

        // A HealthIncidentService whose alert email goes to `smtp` through a referenced mail configuration.
        private static HealthIncidentService BuildWithReferencedMail(
            FakeSmtpServer smtp,
            Mock<ISecretService> secrets,
            Mock<IMongoCollection<MonitorIncident>> incidentColl,
            Mock<IMongoCollection<MonitorConfiguration>> configColl,
            ILogger<HealthIncidentService> logger)
        {
            var db = new MongoMocks.DbBuilder()
                .With(configColl)
                .With(incidentColl)
                .With(new List<ProjectPeople>())
                .With(new List<EmailTemplate>
                {
                    new() { Name = "AlertIncident", MailConfigurationId = "cfg1", TemplateSubject = "S {{MonitorName}}", TemplateBody = "B {{MonitorUrl}}" },
                })
                .With(new List<MailServerConfiguration>
                {
                    new()
                    {
                        ItemId = "cfg1", Host = smtp.Host, Port = smtp.Port, EnableSSL = false,
                        SenderAddress = "from@test.com", SenderName = "Blocks", SenderUserName = "mailer",
                        UseDefaultCredentials = false, AccountPassword = MailLegacyPassword,
                        AccountPasswordReference = MailReference, SmtpClient = SmtpClient.Default,
                    },
                });
            var secret = MongoMocks.BlocksSecret().Object;

            var healthRepo = new HealthConfigurationRepoService(
                new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, secret, PassThroughMonitorDataAccess.Instance);
            var alertRepo = new AlertRepoService(db.Provider, secret);
            var email = new EmailAlertService(new Mock<ILogger<EmailAlertService>>().Object, alertRepo, AlertMailTestDoubles.PasswordResolver(secrets));
            var http = new Mock<IHttpHelperServices>();
            http.Setup(h => h.MakeHttpRequest<NotificationResponse>(
                    It.IsAny<string>(), It.IsAny<string>(), It.IsAny<HttpMethod>(),
                    It.IsAny<object>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<string>()))
                .ReturnsAsync((new NotificationResponse { IsSuccess = true }, new HttpResponseMessage(HttpStatusCode.OK)));
            var notification = new NotificationAlertService(
                new Mock<ILogger<NotificationAlertService>>().Object, http.Object,
                new Mock<ICryptoService>().Object, new Mock<ITenants>().Object, alertRepo, new Mock<IConfiguration>().Object);

            return new HealthIncidentService(logger, db.Provider, healthRepo, email, notification, secret, PassThroughMonitorDataAccess.Instance);
        }

        private static MonitorConfiguration HeartbeatWithRecipient() =>
            new() { ItemId = "m1", Name = "Api", Url = "http://api", Emails = new List<string> { "a@test.com" } };

        [Fact]
        public async Task CreateIncidentAsync_ReferencedMailConfig_AuthenticatesWithSecretValue()
        {
            // H10: the heartbeat path resolves the password exactly like the monitor path.
            using var smtp = new FakeSmtpServer();
            var secrets = new Mock<ISecretService>(MockBehavior.Strict);
            secrets.Setup(s => s.GetValueAsync(MailReference, It.IsAny<CancellationToken>())).ReturnsAsync(MailSecretPassword);
            var logger = new CapturingLogger<HealthIncidentService>();
            var sut = BuildWithReferencedMail(smtp, secrets, MongoMocks.Collection(new List<MonitorIncident>()),
                MongoMocks.Collection(new List<MonitorConfiguration> { HeartbeatWithRecipient() }), logger);

            await sut.CreateIncidentAsync(HeartbeatWithRecipient());

            smtp.Credentials.Should().Equal(new[] { ("mailer", MailSecretPassword) }, smtp.Describe());
            secrets.Verify(s => s.GetValueAsync(MailReference, It.IsAny<CancellationToken>()), Times.Once);
            logger.Entries.Should().NotContain(e => e.Level == LogLevel.Error);
        }

        [Fact]
        public async Task CreateIncidentAsync_CredentialFailure_IncidentProcessingContinues()
        {
            // C7 on the heartbeat path: the incident is still created and the configuration marked
            // down; only the email fails, with no SMTP connection and no fallback to the plaintext
            // AccountPassword.
            using var smtp = new FakeSmtpServer();
            var secrets = new Mock<ISecretService>(MockBehavior.Strict);
            secrets.Setup(s => s.GetValueAsync(MailReference, It.IsAny<CancellationToken>())).ThrowsAsync(new SecretNotFoundException(MailReference));
            var incidentColl = MongoMocks.Collection(new List<MonitorIncident>());
            var configColl = MongoMocks.Collection(new List<MonitorConfiguration> { HeartbeatWithRecipient() });
            var logger = new CapturingLogger<HealthIncidentService>();
            var sut = BuildWithReferencedMail(smtp, secrets, incidentColl, configColl, logger);

            await sut.CreateIncidentAsync(HeartbeatWithRecipient());

            incidentColl.Verify(c => c.InsertOneAsync(It.Is<MonitorIncident>(i => i.MonitorId == "m1" && !i.IsResolved),
                It.IsAny<InsertOneOptions>(), It.IsAny<CancellationToken>()), Times.Once);
            configColl.Verify(c => c.UpdateOneAsync(It.IsAny<FilterDefinition<MonitorConfiguration>>(), It.IsAny<UpdateDefinition<MonitorConfiguration>>(),
                It.IsAny<UpdateOptions>(), It.IsAny<CancellationToken>()), Times.Once);
            logger.Entries.Should().Contain(e => e.Message.StartsWith("Created new DOWN incident for Api"));
            logger.Entries.Should().NotContain(e => e.Level == LogLevel.Error);
            secrets.Verify(s => s.GetValueAsync(MailReference, It.IsAny<CancellationToken>()), Times.Once);
            smtp.Connections.Should().Be(0);
            smtp.Credentials.Should().BeEmpty();
        }
    }
}
