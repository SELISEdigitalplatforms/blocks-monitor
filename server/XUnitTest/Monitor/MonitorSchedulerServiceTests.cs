using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using Blocks.Genesis.Entities.Monitor;
using DomainService.Monitor.Services;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;
using Moq;

namespace XUnitTest.Monitor
{
    public class MonitorSchedulerServiceTests
    {
        private readonly Mock<IMonitorQueueManager> _queue = new();
        private readonly Mock<IMonitorPingService> _ping = new();
        private readonly Mock<IMonitorConfigurationRepoService> _repo = new();
        private readonly Mock<ILogger<MonitorSchedulerService>> _logger = new();
        private readonly Mock<DomainService.AlertRecipients.Services.IAlertRecipientReconciler> _reconciler = new();

        private MonitorSchedulerService CreateSut() =>
            new(_queue.Object, _ping.Object, _repo.Object, _reconciler.Object, _logger.Object, workerCount: 1);

        [Fact]
        public async Task LoadMonitorsFromDatabaseAsync_EnqueuesNewMonitors()
        {
            _repo.Setup(r => r.GetAllConfigurationListAsync()).ReturnsAsync(new List<MonitorConfiguration>
            {
                new() { ItemId = "a", Url = "http://a" },
                new() { ItemId = "b", Url = "http://b" }
            });

            await CreateSut().LoadMonitorsFromDatabaseAsync();

            _queue.Verify(q => q.Enqueue(It.IsAny<MonitorQueueTask>()), Times.Exactly(2));
        }

        [Fact]
        public async Task LoadMonitorsFromDatabaseAsync_SkipsConfigsWithEmptyItemId()
        {
            _repo.Setup(r => r.GetAllConfigurationListAsync()).ReturnsAsync(new List<MonitorConfiguration>
            {
                new() { ItemId = "", Url = "http://a" },
                new() { ItemId = "b", Url = "http://b" }
            });

            await CreateSut().LoadMonitorsFromDatabaseAsync();

            _queue.Verify(q => q.Enqueue(It.IsAny<MonitorQueueTask>()), Times.Once);
        }

        [Fact]
        public async Task LoadMonitorsFromDatabaseAsync_OnSecondLoad_RemovesMonitorsNoLongerActive()
        {
            var sut = CreateSut();
            _repo.SetupSequence(r => r.GetAllConfigurationListAsync())
                .ReturnsAsync(new List<MonitorConfiguration>
                {
                    new() { ItemId = "a", Url = "http://a" },
                    new() { ItemId = "b", Url = "http://b" }
                })
                .ReturnsAsync(new List<MonitorConfiguration>
                {
                    new() { ItemId = "a", Url = "http://a" }
                });

            await sut.LoadMonitorsFromDatabaseAsync();
            await sut.LoadMonitorsFromDatabaseAsync();

            // "b" dropped out of the active set on the second poll and must be removed from the queue.
            _queue.Verify(q => q.RemoveByItemId("b"), Times.Once);
            // "a" already existed, so it is not enqueued again.
            _queue.Verify(q => q.Enqueue(It.IsAny<MonitorQueueTask>()), Times.Exactly(2));
        }

        [Fact]
        public async Task LoadMonitorsFromDatabaseAsync_FailedRootPoll_KeepsQueuedMonitorsUntilSuccessfulRefresh()
        {
            var sut = CreateSut();
            _repo.SetupSequence(r => r.GetAllConfigurationListAsync())
                .ReturnsAsync(new List<MonitorConfiguration> { new() { ItemId = "a", Url = "http://a" } })
                .ThrowsAsync(new MongoException("root unavailable"))
                .ReturnsAsync(new List<MonitorConfiguration>());

            await sut.LoadMonitorsFromDatabaseAsync();
            await FluentActions.Invoking(() => sut.LoadMonitorsFromDatabaseAsync())
                .Should().ThrowAsync<MongoException>();
            _queue.Verify(q => q.RemoveByItemId("a"), Times.Never);

            await sut.LoadMonitorsFromDatabaseAsync();
            _queue.Verify(q => q.RemoveByItemId("a"), Times.Once);
        }

        [Fact]
        public async Task StartAsync_RunsWorkerLoopAndProcessesDueTasks()
        {
            // A task that is already due should be dequeued and pinged by a worker.
            var dueConfig = new MonitorConfiguration { ItemId = "a", Url = "http://a" };
            var dueTask = new MonitorQueueTask(dueConfig) { NextExecutionTime = DateTime.UtcNow.AddSeconds(-1) };
            _repo.Setup(r => r.GetAllConfigurationListAsync()).ReturnsAsync(new List<MonitorConfiguration> { dueConfig });
            // Behave like a real queue: the task is due once, then the queue is empty. A Peek that
            // always returns a due task keeps the worker in a hot loop that never yields, which can
            // starve the thread pool on a busy CI runner before the fire-and-forget ping runs.
            var dequeued = 0;
            _queue.Setup(q => q.Peek()).Returns(() => Volatile.Read(ref dequeued) == 0 ? dueTask : null);
            _queue.Setup(q => q.Dequeue()).Returns(() =>
            {
                Interlocked.Exchange(ref dequeued, 1);
                return dueTask;
            });
            var pinged = new TaskCompletionSource();
            _ping.Setup(p => p.MonitorPingAsync(It.IsAny<MonitorConfiguration>()))
                .Callback(() => pinged.TrySetResult())
                .ReturnsAsync(new MonitorPingLog());

            using var cts = new CancellationTokenSource();
            var run = CreateSut().StartAsync(cts.Token);
            await Task.WhenAny(pinged.Task, Task.Delay(TimeSpan.FromSeconds(10)));
            cts.Cancel();

            pinged.Task.IsCompletedSuccessfully.Should().BeTrue();
            _ping.Verify(p => p.MonitorPingAsync(It.IsAny<MonitorConfiguration>()), Times.AtLeastOnce);
        }

        [Fact]
        public async Task StartAsync_PropagatesCancellationFromPollingLoop()
        {
            _repo.Setup(r => r.GetAllConfigurationListAsync()).ReturnsAsync(new List<MonitorConfiguration>());
            _queue.Setup(q => q.Peek()).Returns((MonitorQueueTask)null);
            using var cts = new CancellationTokenSource();
            cts.CancelAfter(150);

            var act = async () => await CreateSut().StartAsync(cts.Token);

            // The polling loop's delay is not guarded, so cancellation surfaces to the caller.
            await act.Should().ThrowAsync<OperationCanceledException>();
        }

        // ---------- Alert recipient reconciliation on the 600-second poll (H19, C24) ----------

        [Fact]
        public async Task PollOnceAsync_ReconcilesBeforeTheReload()
        {
            var calls = new List<string>();
            _reconciler.Setup(r => r.ReconcileAsync()).Callback(() => calls.Add("reconcile")).Returns(Task.CompletedTask);
            _repo.Setup(r => r.GetAllConfigurationListAsync()).Callback(() => calls.Add("reload")).ReturnsAsync(new List<MonitorConfiguration>());

            await CreateSut().PollOnceAsync();

            calls.Should().Equal("reconcile", "reload");
        }

        [Fact]
        public async Task PollOnceAsync_WhenReconcileThrows_StillReloads()
        {
            _reconciler.Setup(r => r.ReconcileAsync()).ThrowsAsync(new InvalidOperationException("kv down"));
            _repo.Setup(r => r.GetAllConfigurationListAsync()).ReturnsAsync(new List<MonitorConfiguration>());

            await CreateSut().PollOnceAsync();

            _repo.Verify(r => r.GetAllConfigurationListAsync(), Times.Once);
        }

        [Fact]
        public async Task PollOnceAsync_WhenTheReloadThrows_DoesNotPropagate()
        {
            _repo.Setup(r => r.GetAllConfigurationListAsync()).ThrowsAsync(new MongoException("db down"));

            var act = () => CreateSut().PollOnceAsync();

            await act.Should().NotThrowAsync();
            _reconciler.Verify(r => r.ReconcileAsync(), Times.Once);
        }
    }
}
