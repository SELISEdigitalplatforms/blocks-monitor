using DomainService.Monitor.Entity;
using Microsoft.Extensions.Logging;
using System.Collections.Concurrent;

namespace DomainService.Monitor.Services
{
    public class MonitorSchedulerService: IMonitorSchedulerService
    {
        private readonly IMonitorQueueManager _queueManager;
        private readonly IMonitorPingService _pingService;
        private readonly IMonitorConfigurationRepoService _monitorConfigurationRepoService;
        private readonly ILogger<MonitorSchedulerService> _logger;

        private readonly int _workerCount;

        private readonly ConcurrentDictionary<string, MonitorConfiguration> _activeMonitors = new ConcurrentDictionary<string, MonitorConfiguration>();

        private readonly TimeSpan _pollingInterval = TimeSpan.FromSeconds(600);

        public MonitorSchedulerService(
            IMonitorQueueManager queueManager,
            IMonitorPingService pingService,
            IMonitorConfigurationRepoService monitorConfigurationRepoService,
            ILogger<MonitorSchedulerService> logger,
            int workerCount = 10)
        {
            _logger = logger;
            _queueManager = queueManager;
            _pingService = pingService;
            _monitorConfigurationRepoService = monitorConfigurationRepoService;
            _workerCount = workerCount;
        }

        private void WithQueueLock(Action action) { lock (_queueManager) action(); }

        public async Task StartAsync(CancellationToken cancellationToken = default)
        {
            await LoadMonitorsFromDatabaseAsync();

            var workerTasks = new Task[_workerCount + 1];

            for (int i = 0; i < _workerCount; i++)
            {
                workerTasks[i] = Task.Run(() => WorkerLoopAsync(cancellationToken), cancellationToken);
            }

            workerTasks[_workerCount] = Task.Run(() => PollDatabaseAsync(cancellationToken), cancellationToken);

            await Task.WhenAll(workerTasks);
        }

        private async Task WorkerLoopAsync(CancellationToken cancellationToken)
        {
            try
            {
                while (!cancellationToken.IsCancellationRequested)
                {
                    MonitorQueueTask nextTask = null;

                    WithQueueLock(() =>
                    {
                        var peeked = _queueManager.Peek();
                        if (peeked != null && peeked.NextExecutionTime <= DateTime.UtcNow)
                            nextTask = _queueManager.Dequeue();
                    });

                    if (nextTask != null)
                    {
                        try
                        {
                            _ = Task.Run(() => _pingService.MonitorPingAsync(nextTask.Config));
                        }
                        catch (Exception ex)
                        {
                            _logger.LogError("[MonitorScheduler] Error monitoring {Url}: {ErrorMessage}", nextTask.Config.Url, ex.Message);
                        }

                        if (_activeMonitors.TryGetValue(nextTask.Config.ItemId, out var updatedConfig))
                        {
                            var newTask = new MonitorQueueTask(updatedConfig);
                            _queueManager.Enqueue(newTask);
                        }
                    }
                    else
                    {
                        await Task.Delay(100, cancellationToken);
                    }
                }
            }
            catch (TaskCanceledException)
            {
                // Graceful exit on cancellation
            }
        }

        private async Task PollDatabaseAsync(CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    await LoadMonitorsFromDatabaseAsync();
                }
                catch (Exception ex)
                {
                    _logger.LogError("[MonitorScheduler] Polling failed: {ErrorMessage}", ex.Message);
                }

                await Task.Delay(_pollingInterval, cancellationToken);
            }
        }

        public async Task LoadMonitorsFromDatabaseAsync()
        {
            var configs = await _monitorConfigurationRepoService.GetAllConfigurationListAsync();

            var activeIds = configs.Select(c => c.ItemId).ToHashSet();

            foreach (var cachedId in _activeMonitors.Keys.ToList())
            {
                if (!activeIds.Contains(cachedId))
                {
                    _activeMonitors.TryRemove(cachedId, out _);
                    WithQueueLock(() => _queueManager.RemoveByItemId(cachedId));
                    _logger.LogInformation("[MonitorScheduler] Removed inactive monitor: {CachedId}", cachedId);
                }
            }

            foreach (var config in configs)
            {
                if (config == null || string.IsNullOrEmpty(config.ItemId))
                    continue;

                var isNew = !_activeMonitors.ContainsKey(config.ItemId);
                _activeMonitors[config.ItemId] = config;

                if (isNew)
                {
                    WithQueueLock(() => _queueManager.Enqueue(new MonitorQueueTask(config)));
                    _logger.LogInformation("[MonitorScheduler] Added new monitor: {Url}", config.Url);
                }
                else
                {
                    _logger.LogInformation("[MonitorScheduler] Updated monitor: {Url} with new interval {Interval}s", config.Url, config.IntervalInSeconds);
                }
            }
        }

    }
}
