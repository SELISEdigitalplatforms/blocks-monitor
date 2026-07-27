using DomainService.Health.HealthWorkerService;
using DomainService.Health.Models;
using DomainService.Monitor.Entity;
using Microsoft.Extensions.Logging;
using MongoDB.Bson.IO;
using System.Collections.Concurrent;
using System.Text.Json;
using System.Xml;

namespace DomainService.Health.Services
{
    public class HealthCheckService
    {
        private readonly HealthQueueManager _queueManager;
        private readonly HealthConfigurationRepoService _healthConfigurationRepoService;
        private readonly HealthIncidentService _healthIncidentService;
        private readonly ILogger<HealthCheckService> _logger;

        private readonly int _workerCount;

        private readonly ConcurrentDictionary<string, MonitorConfiguration> _activeMonitors = new ConcurrentDictionary<string, MonitorConfiguration>();

        private readonly TimeSpan _pollingInterval = TimeSpan.FromSeconds(600);

        public HealthCheckService(
            HealthQueueManager queueManager,
            ILogger<HealthCheckService> logger,
            HealthConfigurationRepoService healthConfigurationRepoService,
            HealthIncidentService healthIncidentService,
            int workerCount = 10)
        {
            _logger = logger;
            _queueManager = queueManager;
            _workerCount = workerCount;
            _healthConfigurationRepoService = healthConfigurationRepoService;
            _healthIncidentService = healthIncidentService;
        }

        public virtual async Task StartAsync(CancellationToken cancellationToken = default)
        {
            await LoadMonitorsFromDatabaseAsync();

            var workerTasks = new Task[_workerCount + 1];

            for (int i = 0; i < _workerCount; i++)
            {
                workerTasks[i] = Task.Run(() => WorkerLoopAsync(cancellationToken), cancellationToken);
            }

            workerTasks[_workerCount] = Task.Run(() => PollDatabaseAsync(cancellationToken), cancellationToken);

            try
            {
                await Task.WhenAll(workerTasks);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
            }
        }

        private async Task WorkerLoopAsync(CancellationToken cancellationToken)
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                HealthQueueTask nextTask = null;

                lock (_queueManager)
                {
                    var peeked = _queueManager.Peek();

                    if (peeked != null && peeked.NextExecutionTime <= DateTime.UtcNow)
                    {
                        nextTask = _queueManager.Dequeue();
                    }
                }

                if (nextTask != null)
                {
                    try
                    {
                        _ = _healthIncidentService.CreateIncidentAsync(nextTask.Config);
                    }
                    catch (Exception ex)
                    {
                        _logger.LogError("[MonitorScheduler] Error monitoring {Url}: {ErrorMessage}", nextTask.Config.Url, ex.Message);
                    }
                }
                else
                {
                    try
                    {
                        await Task.Delay(100, cancellationToken);
                    }
                    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                    {
                        break;
                    }
                }
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

                try
                {
                    await Task.Delay(_pollingInterval, cancellationToken);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    break;
                }
            }
        }

        public async Task LoadMonitorsFromDatabaseAsync()
        {
            var configs = await _healthConfigurationRepoService.GetAllActiveConfigurationsAsync();

            var activeIds = configs.Select(c => c.ItemId).ToHashSet();

            foreach (var cachedId in _activeMonitors.Keys.ToList())
            {
                if (!activeIds.Contains(cachedId))
                {
                    _activeMonitors.TryRemove(cachedId, out _);

                    lock (_queueManager)
                    {
                        _queueManager.RemoveByItemId(cachedId);
                    }

                    _logger.LogInformation("[MonitorScheduler] Removed inactive monitor: {CachedId}", cachedId);
                }
            }

            foreach (var config in configs)
            {
                if (config == null || string.IsNullOrEmpty(config.ItemId))
                    continue;

                if (!_activeMonitors.TryGetValue(config.ItemId, out var existing))
                {
                    _activeMonitors[config.ItemId] = config;

                    lock (_queueManager)
                    {
                        var task = new HealthQueueTask(config);
                        _queueManager.Enqueue(task);
                    }

                    _logger.LogInformation("[MonitorScheduler] Added new monitor: {Url}", config.Url);
                }
                else
                {
                    _activeMonitors[config.ItemId] = config;
                    _logger.LogInformation("[MonitorScheduler] Updated monitor: {Url} with new interval {Interval}s", config.Url, config.IntervalInSeconds + config.GracePeriodInSeconds);
                }
            }
        }

        public async Task HandlePingEventAsync(string itemId)
        {
            RequeueByUrl(itemId);

            _ = Task.Run(async () =>
            {
                try
                {
                    await _healthIncidentService.HandleIncidentAsync(itemId);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "[HealthCheck] Failed to handle ping event for {ItemId}", itemId);
                }
            });
        }

        public void RequeueByUrl(string itemId)
        {
            if (string.IsNullOrEmpty(itemId))
            {
                _logger.LogWarning("[MonitorScheduler] RequeueByUrl called with empty URL.");
                return;
            }

            lock (_queueManager)
            {
                var allTasks = _queueManager.GetAll().ToList();
                var taskToRequeue = allTasks.FirstOrDefault(t => t.Config.ItemId == itemId);

                if (taskToRequeue is not null)
                {
                    _queueManager.RemoveByItemId(itemId);
                }
                if (_activeMonitors.TryGetValue(itemId, out var updatedConfig))
                {
                    var newTask = new HealthQueueTask(updatedConfig);
                    _queueManager.Enqueue(newTask);
                }
            }
        }
    }
}
