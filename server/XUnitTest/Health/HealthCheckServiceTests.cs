using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Blocks.Genesis;
using DomainService.Shared.Services;
using DomainService.Alert.Entities;
using DomainService.Alert.Services;
using DomainService.Health.HealthWorkerService;
using DomainService.Health.Models;
using DomainService.Health.Services;
using DomainService.Monitor.Entity;
using DomainService.Shared.Models;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;
using Moq;
using XUnitTest.Utilities;

namespace XUnitTest.Health
{
    public class HealthCheckServiceTests
    {
        private readonly HealthQueueManager _queue = new();

        private HealthCheckService Build(Mock<IMongoCollection<MonitorConfiguration>> configColl, IEnumerable<MonitorIncident> incidents = null)
        {
            var db = new MongoMocks.DbBuilder()
                .With(configColl)
                .With(incidents ?? new List<MonitorIncident>())
                .With(new List<ProjectPeople>())
                .With(new List<AlertMailTemplate>())
                .With(new List<MailServerConfiguration>());
            var secret = MongoMocks.BlocksSecret().Object;

            var healthRepo = new HealthConfigurationRepoService(new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, secret);
            var alertRepo = new AlertRepoService(db.Provider, secret);
            var email = new EmailAlertService(new Mock<ILogger<EmailAlertService>>().Object, alertRepo);
            var http = new Mock<IHttpHelperServices>();
            http.Setup(h => h.MakeHttpRequest<NotificationResponse>(It.IsAny<string>(), It.IsAny<string>(), It.IsAny<HttpMethod>(),
                    It.IsAny<object>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<string>()))
                .ReturnsAsync((new NotificationResponse { IsSuccess = true }, new HttpResponseMessage(HttpStatusCode.OK)));
            var notification = new NotificationAlertService(new Mock<ILogger<NotificationAlertService>>().Object, http.Object,
                new Mock<ICryptoService>().Object, new Mock<ITenants>().Object, alertRepo, new Mock<IConfiguration>().Object);
            var incidentService = new HealthIncidentService(new Mock<ILogger<HealthIncidentService>>().Object, db.Provider, healthRepo, email, notification, secret);

            return new HealthCheckService(_queue, new Mock<ILogger<HealthCheckService>>().Object, healthRepo, incidentService, workerCount: 1);
        }

        [Fact]
        public async Task LoadMonitorsFromDatabaseAsync_EnqueuesActiveInboundMonitors()
        {
            var coll = MongoMocks.Collection(new List<MonitorConfiguration>
            {
                new() { ItemId = "a", IsActive = true, MonitorConfigurationType = MonitorConfigurationTypes.InboundPing },
                new() { ItemId = "b", IsActive = true, MonitorConfigurationType = MonitorConfigurationTypes.InboundPing }
            });

            await Build(coll).LoadMonitorsFromDatabaseAsync();

            _queue.GetAll().Should().HaveCount(2);
        }

        [Fact]
        public async Task LoadMonitorsFromDatabaseAsync_RemovesMonitorsThatBecameInactive()
        {
            var coll = MongoMocks.Collection(new List<MonitorConfiguration>());
            coll.SetupSequence(c => c.FindAsync(It.IsAny<FilterDefinition<MonitorConfiguration>>(),
                    It.IsAny<FindOptions<MonitorConfiguration, MonitorConfiguration>>(), It.IsAny<CancellationToken>()))
                .ReturnsAsync(MongoMocks.Cursor(new List<MonitorConfiguration> { new() { ItemId = "a" }, new() { ItemId = "b" } }).Object)
                .ReturnsAsync(MongoMocks.Cursor(new List<MonitorConfiguration> { new() { ItemId = "a" } }).Object);
            var sut = Build(coll);

            await sut.LoadMonitorsFromDatabaseAsync();
            await sut.LoadMonitorsFromDatabaseAsync();

            _queue.GetAll().Should().ContainSingle(t => t.Config.ItemId == "a");
        }

        [Fact]
        public void RequeueByUrl_WhenItemIdEmpty_DoesNothing()
        {
            var sut = Build(MongoMocks.Collection(new List<MonitorConfiguration>()));

            sut.RequeueByUrl("");

            _queue.HasTasks().Should().BeFalse();
        }

        [Fact]
        public async Task RequeueByUrl_ForKnownMonitor_KeepsItQueued()
        {
            var coll = MongoMocks.Collection(new List<MonitorConfiguration>
            {
                new() { ItemId = "a", IsActive = true, MonitorConfigurationType = MonitorConfigurationTypes.InboundPing }
            });
            var sut = Build(coll);
            await sut.LoadMonitorsFromDatabaseAsync();

            sut.RequeueByUrl("a");

            _queue.GetAll().Should().ContainSingle(t => t.Config.ItemId == "a");
        }

        [Fact]
        public async Task HandlePingEvent_DoesNotThrow()
        {
            var sut = Build(MongoMocks.Collection(new List<MonitorConfiguration>()));

            var act = async () => await sut.HandlePingEventAsync("a");

            await act.Should().NotThrowAsync();
        }

        [Fact]
        public async Task StartAsync_RunsWorkersAndStopsGracefullyOnCancellation()
        {
            var sut = Build(MongoMocks.Collection(new List<MonitorConfiguration>()));
            using var cts = new CancellationTokenSource();
            cts.CancelAfter(150);

            var run = sut.StartAsync(cts.Token);
            var completed = await Task.WhenAny(run, Task.Delay(5000));

            completed.Should().BeSameAs(run);
            run.IsCompletedSuccessfully.Should().BeTrue();
        }

        [Fact]
        public async Task StartAsync_WithDueTask_DequeuesAndProcessesIt()
        {
            // A task whose scheduled time is already in the past must be dequeued by a worker and handed
            // to the incident service, leaving the queue empty afterwards.
            var config = new MonitorConfiguration
            {
                ItemId = "due", Url = "http://due",
                MonitorConfigurationType = MonitorConfigurationTypes.InboundPing
            };
            _queue.Enqueue(new HealthQueueTask(config) { NextExecutionTime = System.DateTime.UtcNow.AddSeconds(-5) });
            var sut = Build(MongoMocks.Collection(new List<MonitorConfiguration>()));
            using var cts = new CancellationTokenSource();
            cts.CancelAfter(500);

            var run = sut.StartAsync(cts.Token);
            var completed = await Task.WhenAny(run, Task.Delay(5000));

            completed.Should().BeSameAs(run);
            _queue.HasTasks().Should().BeFalse();
        }

        [Fact]
        public async Task HandlePingEventAsync_WhenIncidentHandlingThrows_SwallowsInBackground()
        {
            // The incident lookup throws; the error must be caught inside the fire-and-forget task and
            // never surface to the caller.
            var db = new MongoMocks.DbBuilder()
                .With(MongoMocks.Collection(new List<MonitorConfiguration>()))
                .With(MongoMocks.CollectionThrowing<MonitorIncident>())
                .With(new List<ProjectPeople>())
                .With(new List<AlertMailTemplate>())
                .With(new List<MailServerConfiguration>());
            var secret = MongoMocks.BlocksSecret().Object;
            var healthRepo = new HealthConfigurationRepoService(new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, secret);
            var alertRepo = new AlertRepoService(db.Provider, secret);
            var email = new EmailAlertService(new Mock<ILogger<EmailAlertService>>().Object, alertRepo);
            var notification = new NotificationAlertService(new Mock<ILogger<NotificationAlertService>>().Object, new Mock<IHttpHelperServices>().Object,
                new Mock<ICryptoService>().Object, new Mock<ITenants>().Object, alertRepo, new Mock<IConfiguration>().Object);
            var incidentService = new HealthIncidentService(new Mock<ILogger<HealthIncidentService>>().Object, db.Provider, healthRepo, email, notification, secret);
            var sut = new HealthCheckService(new HealthQueueManager(), new Mock<ILogger<HealthCheckService>>().Object, healthRepo, incidentService, workerCount: 1);

            var act = async () =>
            {
                await sut.HandlePingEventAsync("m1");
                await Task.Delay(200);
            };

            await act.Should().NotThrowAsync();
        }
    }

    public class HealthCheckBackgroundWorkerTests
    {
        [Fact]
        public async Task ExecuteAsync_InvokesHealthCheckServiceStart()
        {
            var queue = new HealthQueueManager();
            var db = new MongoMocks.DbBuilder()
                .With(new List<MonitorConfiguration>()).With(new List<MonitorIncident>())
                .With(new List<ProjectPeople>()).With(new List<AlertMailTemplate>()).With(new List<MailServerConfiguration>());
            var secret = MongoMocks.BlocksSecret().Object;
            var healthRepo = new HealthConfigurationRepoService(new Mock<ILogger<HealthConfigurationRepoService>>().Object, db.Provider, secret);
            var alertRepo = new AlertRepoService(db.Provider, secret);
            var email = new EmailAlertService(new Mock<ILogger<EmailAlertService>>().Object, alertRepo);
            var notification = new NotificationAlertService(new Mock<ILogger<NotificationAlertService>>().Object,
                new Mock<IHttpHelperServices>().Object, new Mock<ICryptoService>().Object, new Mock<ITenants>().Object, alertRepo, new Mock<IConfiguration>().Object);
            var incidentService = new HealthIncidentService(new Mock<ILogger<HealthIncidentService>>().Object, db.Provider, healthRepo, email, notification, secret);

            // StartAsync is virtual, so mock it to observe the worker delegating to it.
            var healthCheck = new Mock<HealthCheckService>(queue, new Mock<ILogger<HealthCheckService>>().Object, healthRepo, incidentService, 1) { CallBase = false };
            var started = new TaskCompletionSource();
            healthCheck.Setup(s => s.StartAsync(It.IsAny<CancellationToken>()))
                .Callback(() => started.TrySetResult())
                .Returns(Task.CompletedTask);

            var worker = new HealthCheckBackgroundWorker(healthCheck.Object, new Mock<ILogger<HealthCheckBackgroundWorker>>().Object);

            await worker.StartAsync(CancellationToken.None);
            await Task.WhenAny(started.Task, Task.Delay(2000));
            await worker.StopAsync(CancellationToken.None);

            healthCheck.Verify(s => s.StartAsync(It.IsAny<CancellationToken>()), Times.Once);
        }
    }
}
