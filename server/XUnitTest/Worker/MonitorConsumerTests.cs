using System;
using System.Threading;
using System.Threading.Tasks;
using System.Collections.Generic;
using DomainService.AlertRecipients.Services;
using DomainService.Monitor.Services;
using DomainService.Shared.Entity;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using MonitoringWorker.Consumers;
using Moq;

namespace XUnitTest.Worker
{
    public class MonitorConfigurationUpdateConsumerTests
    {
        private readonly Mock<IMonitorSchedulerService> _scheduler = new();
        private readonly Mock<IAlertRecipientReconciler> _reconciler = new();
        private readonly List<string> _calls = new();
        private readonly TaskCompletionSource _reloaded = new();

        public MonitorConfigurationUpdateConsumerTests()
        {
            _reconciler.Setup(r => r.ReconcileAsync()).Callback(() => _calls.Add("reconcile")).Returns(Task.CompletedTask);
            _scheduler.Setup(s => s.LoadMonitorsFromDatabaseAsync())
                .Callback(() => { _calls.Add("reload"); _reloaded.TrySetResult(); })
                .Returns(Task.CompletedTask);
        }

        private MonitorConfigurationUpdateConsumer CreateSut() =>
            new(_scheduler.Object, _reconciler.Object, new Mock<ILogger<MonitorConfigurationUpdateConsumer>>().Object);

        private async Task WaitForReloadAsync() =>
            (await Task.WhenAny(_reloaded.Task, Task.Delay(2000))).Should().Be(_reloaded.Task);

        [Fact]
        public async Task Consume_TriggersSchedulerReload()
        {
            await CreateSut().Consume(new MonitorConfigurationUpdateQueue { MonitorId = "m1" });

            // Consume schedules the reload on a background task; wait for it to run.
            await WaitForReloadAsync();
            _scheduler.Verify(s => s.LoadMonitorsFromDatabaseAsync(), Times.Once);
        }

        [Fact]
        public async Task Consume_ReconcilesAlertRecipientsBeforeTheReload()
        {
            // H18 / E13: a monitor blocks-release inserted gets its "All monitors" people before the reload schedules it.
            await CreateSut().Consume(new MonitorConfigurationUpdateQueue { MonitorId = "m4" });

            await WaitForReloadAsync();
            _calls.Should().Equal("reconcile", "reload");
        }

        [Fact]
        public async Task Consume_WhenReconcileThrows_StillReloads()
        {
            // C24: a reconciliation failure is logged and the existing reload still runs.
            _reconciler.Setup(r => r.ReconcileAsync()).ThrowsAsync(new InvalidOperationException("kv down"));

            await CreateSut().Consume(new MonitorConfigurationUpdateQueue { MonitorId = "m1" });

            await WaitForReloadAsync();
            _scheduler.Verify(s => s.LoadMonitorsFromDatabaseAsync(), Times.Once);
        }

        [Fact]
        public async Task Consume_WhenReloadThrows_DoesNotPropagate()
        {
            _scheduler.Setup(s => s.LoadMonitorsFromDatabaseAsync())
                .Callback(() => _reloaded.TrySetResult())
                .ThrowsAsync(new Exception("boom"));

            var act = async () => await CreateSut().Consume(new MonitorConfigurationUpdateQueue { MonitorId = "m1" });

            await act.Should().NotThrowAsync();
            await Task.WhenAny(_reloaded.Task, Task.Delay(2000));
        }
    }

    public class MonitorSchedulerBackgroundWorkerTests
    {
        [Fact]
        public async Task ExecuteAsync_StartsScheduler()
        {
            var scheduler = new Mock<IMonitorSchedulerService>();
            var started = new TaskCompletionSource();
            scheduler.Setup(s => s.StartAsync(It.IsAny<CancellationToken>()))
                .Callback(() => started.TrySetResult())
                .Returns(Task.CompletedTask);
            var worker = new MonitorSchedulerBackgroundWorker(scheduler.Object, new Mock<ILogger<MonitorSchedulerBackgroundWorker>>().Object);

            await worker.StartAsync(CancellationToken.None);
            await Task.WhenAny(started.Task, Task.Delay(2000));
            await worker.StopAsync(CancellationToken.None);

            scheduler.Verify(s => s.StartAsync(It.IsAny<CancellationToken>()), Times.Once);
        }

        [Fact]
        public async Task ExecuteAsync_WhenSchedulerCancelled_SwallowsOperationCanceled()
        {
            var scheduler = new Mock<IMonitorSchedulerService>();
            using var cts = new CancellationTokenSource();
            cts.Cancel();
            scheduler.Setup(s => s.StartAsync(It.IsAny<CancellationToken>()))
                .ThrowsAsync(new OperationCanceledException(cts.Token));
            var worker = new MonitorSchedulerBackgroundWorker(scheduler.Object, new Mock<ILogger<MonitorSchedulerBackgroundWorker>>().Object);

            var act = async () =>
            {
                await worker.StartAsync(cts.Token);
                await worker.StopAsync(CancellationToken.None);
            };

            await act.Should().NotThrowAsync();
        }
    }
}
