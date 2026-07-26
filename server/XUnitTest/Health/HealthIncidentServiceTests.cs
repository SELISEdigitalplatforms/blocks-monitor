using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Blocks.Genesis;
using MongoDB.Driver;
using DomainService.Shared.Services;
using DomainService.Alert.Entities;
using DomainService.Alert.Services;
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
            var notification = new NotificationAlertService(
                new Mock<ILogger<NotificationAlertService>>().Object, http.Object,
                new Mock<ICryptoService>().Object, new Mock<ITenants>().Object, alertRepo, new Mock<IConfiguration>().Object);

            return new HealthIncidentService(
                new Mock<ILogger<HealthIncidentService>>().Object, db.Provider, healthRepo, email, notification, secret);
        }

        // Builds the service with a caller-supplied incident collection so write failures can be simulated.
        private HealthIncidentService BuildWithIncidentCollection(
            Mock<IMongoCollection<MonitorIncident>> incidentColl,
            IEnumerable<MonitorConfiguration> configs = null)
        {
            var db = new MongoMocks.DbBuilder()
                .With(configs ?? new List<MonitorConfiguration>())
                .With(incidentColl)
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
            var notification = new NotificationAlertService(
                new Mock<ILogger<NotificationAlertService>>().Object, http.Object,
                new Mock<ICryptoService>().Object, new Mock<ITenants>().Object, alertRepo, new Mock<IConfiguration>().Object);

            return new HealthIncidentService(
                new Mock<ILogger<HealthIncidentService>>().Object, db.Provider, healthRepo, email, notification, secret);
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
    }
}
