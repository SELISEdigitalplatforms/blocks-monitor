using System.Diagnostics;
using DomainService.Monitor.Entity;
using Devops.DomainService.Shared.Interfaces;
using Microsoft.Extensions.Logging;
using DomainService.Monitor.MonitorIncidentSevice;
using System.Text.Json;
using DomainService.Monitor.MonitorSchedulingService;
using DomainService.Monitor.Models;
using DomainService.Shared.Models;
using System.Globalization;

namespace DomainService.Monitor.Services
{
    public class MonitorPingService : IMonitorPingService
    {
        private readonly IMonitorConfigurationRepoService _monitorConfigurationRepoService;
        private readonly IMonitorIncidentService _monitorIncidentService;
        private readonly IHttpHelperServices _httpHelperServices;
        private readonly IMonitorQueueManager _monitorQueueManager;
        private readonly ILogger<MonitorPingService> _logger;
        private readonly IMonitorPingRepoService _monitorPingRepoService;
        public MonitorPingService(
            IMonitorConfigurationRepoService monitorConfigurationRepoService,
            IHttpHelperServices httpHelperServices,
            IMonitorQueueManager monitorQueueManager,
            IMonitorIncidentService monitorIncidentService,
            IMonitorPingRepoService monitorPingRepoService,
            ILogger<MonitorPingService> logger)
        {
            _monitorConfigurationRepoService = monitorConfigurationRepoService;
            _httpHelperServices = httpHelperServices;
            _logger = logger;
            _monitorQueueManager = monitorQueueManager;
            _monitorIncidentService = monitorIncidentService;
            _monitorPingRepoService = monitorPingRepoService;
        }

        private static BaseApiResponse FailResponse(string message) =>
            new BaseApiResponse { IsSuccess = false, Message = message };

        private static BaseApiResponse OkResponse(string message, object data = null) =>
            new BaseApiResponse { IsSuccess = true, Message = message, Data = data };

        public async Task InitializeQueueAsync()
        {
            var activeConfigs = await _monitorConfigurationRepoService.GetAllConfigurationListAsync();

            foreach (var config in activeConfigs)
            {
                _monitorQueueManager.Enqueue(new MonitorQueueTask(config));
            }

            _logger.LogInformation("Initialized {Count} monitors into the queue.", activeConfigs.Count);
        }

        public async Task<MonitorPingLog> MonitorPingAsync(MonitorConfiguration config)
        {
            var stopwatch = Stopwatch.StartNew();
            var log = new MonitorPingLog
            {
                MonitorId = config.ItemId,
                Url = config.Url,
                Timestamp = DateTime.UtcNow,
            };

            try
            {
                HttpMethod method = config.HttpMethodType switch
                {
                    HttpMethodTypes.HEAD => HttpMethod.Head,
                    HttpMethodTypes.POST => HttpMethod.Post,
                    HttpMethodTypes.GET => HttpMethod.Get,
                    _ => HttpMethod.Get,
                };
                var payload = !string.IsNullOrWhiteSpace(config.CustomPayload) ? JsonDocument.Parse(config.CustomPayload) : null;
                Dictionary<string, string>? headers = !string.IsNullOrWhiteSpace(config.CustomHttpHeaders) ? JsonSerializer.Deserialize<Dictionary<string, string>>(config.CustomHttpHeaders) : null;

                var (response, httpResponse) =
                    await _httpHelperServices.MakeHttpRequest<object>(
                        clientName: "MonitorClient",
                        url: config.Url,
                        method: method,
                        payload: payload,
                        headers: headers,
                        token: null
                    );

                stopwatch.Stop();

                log.ResponseTimeMs = stopwatch.Elapsed.TotalMilliseconds;
                log.StatusCode = (int)httpResponse.StatusCode;
                log.ResponseMessage = httpResponse.ReasonPhrase;
                log.IsSuccess = httpResponse.IsSuccessStatusCode;

                if (response != null)
                {
                    log.ResponseMessage = await httpResponse.Content.ReadAsStringAsync();
                }
                _logger.LogInformation("[{Url}] => {StatusCode} in {ResponseTimeMs}ms", config.Url, log.StatusCode, log.ResponseTimeMs);
            }
            catch (Exception ex)
            {
                stopwatch.Stop();
                log.ResponseTimeMs = stopwatch.Elapsed.TotalMilliseconds;
                log.IsSuccess = false;
                log.ResponseMessage = $"Error: {ex.Message}";
                log.StatusCode = -1;

                _logger.LogError(ex, "Monitor failed for {Url}", config.Url);
            }

            await _monitorIncidentService.HandleIncidentAsync(config, log);

            return log;
        }


        public async Task<BaseApiResponse> GetPingLogsByDateRangeAsync(string monitorId, string? startDateStr, string? endDateStr)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(monitorId))
                {
                    _logger.LogWarning("MonitorId is null or empty while fetching ping logs.");
                    return FailResponse("MonitorId cannot be null or empty.");
                }

                DateTime endDateUtc = DateTime.UtcNow;
                DateTime startDateUtc = endDateUtc.AddHours(-1);

                if (!string.IsNullOrWhiteSpace(startDateStr) && DateTime.TryParse(startDateStr, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedStart))
                    startDateUtc = parsedStart.ToUniversalTime();

                if (!string.IsNullOrWhiteSpace(endDateStr) && DateTime.TryParse(endDateStr, CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedEnd))
                    endDateUtc = parsedEnd.ToUniversalTime();

                if (endDateUtc < startDateUtc)
                {
                    _logger.LogWarning("End date is earlier than start date. MonitorId: {MonitorId}", monitorId);
                    return FailResponse("End date cannot be earlier than start date.");
                }

                var monitorConfig = await _monitorConfigurationRepoService.GetConfigurationAsync(monitorId);
                if (monitorConfig == null)
                {
                    _logger.LogWarning("Monitor configuration not found for MonitorId {MonitorId}", monitorId);
                    return FailResponse($"Monitor configuration not found for MonitorId: {monitorId}");
                }

                var logs = await _monitorPingRepoService.GetPingLogsByDateRangeAsync(
                    monitorId,
                    startDateUtc.ToString("O"),
                    endDateUtc.ToString("O")
                );

                if (logs == null || logs.Count == 0)
                {
                    _logger.LogInformation("No ping logs found for MonitorId {MonitorId} in range {Start} - {End}", monitorId, startDateUtc, endDateUtc);
                    return OkResponse("No ping logs found for the given date range.", new List<MonitorPingLogSummary>());
                }

                _logger.LogInformation("Fetched {Count} ping logs for MonitorId {MonitorId} between {Start} and {End}", logs.Count, monitorId, startDateUtc, endDateUtc);

                return OkResponse("Ping logs retrieved successfully.", logs);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error fetching ping logs for MonitorId {MonitorId} between {StartDate} and {EndDate}", monitorId, startDateStr, endDateStr);
                return FailResponse($"An error occurred while fetching ping logs: {ex.Message}");
            }
        }
    }
}
