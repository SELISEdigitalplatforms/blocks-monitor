using System;
using System.Threading;
using System.Threading.Tasks;
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
        [Fact]
        public async Task Consume_TriggersSchedulerReload()
        {
            var scheduler = new Mock<IMonitorSchedulerService>();
            var signal = new TaskCompletionSource();
            scheduler.Setup(s => s.LoadMonitorsFromDatabaseAsync())
                .Returns(Task.CompletedTask)
                .Callback(() => signal.TrySetResult());
            var sut = new MonitorConfigurationUpdateConsumer(scheduler.Object, new Mock<ILogger<MonitorConfigurationUpdateConsumer>>().Object);

            await sut.Consume(new MonitorConfigurationUpdateQueue { MonitorId = "m1" });

            // Consume schedules the reload on a background task; wait for it to run.
            (await Task.WhenAny(signal.Task, Task.Delay(2000))).Should().Be(signal.Task);
            scheduler.Verify(s => s.LoadMonitorsFromDatabaseAsync(), Times.Once);
        }

        [Fact]
        public async Task Consume_WhenReloadThrows_DoesNotPropagate()
        {
            var scheduler = new Mock<IMonitorSchedulerService>();
            var signal = new TaskCompletionSource();
            scheduler.Setup(s => s.LoadMonitorsFromDatabaseAsync())
                .Callback(() => signal.TrySetResult())
                .ThrowsAsync(new Exception("boom"));
            var sut = new MonitorConfigurationUpdateConsumer(scheduler.Object, new Mock<ILogger<MonitorConfigurationUpdateConsumer>>().Object);

            var act = async () => await sut.Consume(new MonitorConfigurationUpdateQueue { MonitorId = "m1" });

            await act.Should().NotThrowAsync();
            await Task.WhenAny(signal.Task, Task.Delay(2000));
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
