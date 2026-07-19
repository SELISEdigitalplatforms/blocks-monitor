using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using DomainService.Monitor.Entity;
using DomainService.Monitor.Services;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;

namespace XUnitTest.Monitor
{
    public class MonitorSchedulerServiceTests
    {
        private readonly Mock<IMonitorQueueManager> _queue = new();
        private readonly Mock<IMonitorPingService> _ping = new();
        private readonly Mock<IMonitorConfigurationRepoService> _repo = new();
        private readonly Mock<ILogger<MonitorSchedulerService>> _logger = new();

        private MonitorSchedulerService CreateSut() =>
            new(_queue.Object, _ping.Object, _repo.Object, _logger.Object, workerCount: 1);

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
        public async Task StartAsync_RunsWorkerLoopAndProcessesDueTasks()
        {
            // A task that is already due should be dequeued and pinged by a worker.
            var dueConfig = new MonitorConfiguration { ItemId = "a", Url = "http://a" };
            var dueTask = new MonitorQueueTask(dueConfig) { NextExecutionTime = DateTime.UtcNow.AddSeconds(-1) };
            _repo.Setup(r => r.GetAllConfigurationListAsync()).ReturnsAsync(new List<MonitorConfiguration> { dueConfig });
            _queue.Setup(q => q.Peek()).Returns(dueTask);
            _queue.Setup(q => q.Dequeue()).Returns(dueTask);
            var pinged = new TaskCompletionSource();
            _ping.Setup(p => p.MonitorPingAsync(It.IsAny<MonitorConfiguration>()))
                .Callback(() => pinged.TrySetResult())
                .ReturnsAsync(new MonitorPingLog());

            using var cts = new CancellationTokenSource();
            var run = CreateSut().StartAsync(cts.Token);
            await Task.WhenAny(pinged.Task, Task.Delay(3000));
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
    }
}
