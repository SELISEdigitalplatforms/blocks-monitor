using System.Text.Json;
using Blocks.Genesis;
using DomainService.Shared.Services;
using DomainService.Monitor.Entity;
using DomainService.Shared.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace DomainService.Alert.Services
{
    public class NotificationAlertService
    {
        private readonly IHttpHelperServices _httpHelperServices;
        private readonly ILogger<NotificationAlertService> _logger;
        private readonly ICryptoService _cryptoService;
        private readonly ITenants _tenants;
        private readonly AlertRepoService _alertRepoService;
        private readonly IConfiguration _configuration;

        public NotificationAlertService(ILogger<NotificationAlertService> logger, IHttpHelperServices httpHelperServices, ICryptoService cryptoService, ITenants tenants, AlertRepoService alertRepoService, IConfiguration configuration)
        {
            _logger = logger;
            _httpHelperServices = httpHelperServices;
            _cryptoService = cryptoService;
            _tenants = tenants;
            _alertRepoService = alertRepoService;
            _configuration = configuration;
        }

        public async Task<bool> HandleNotificationAlertAsync(MonitorConfiguration monitorConfiguration,MonitorIncident incident)
        {
            _logger.LogInformation(
                "Preparing notification delivery for monitor {MonitorName} ({MonitorUrl})",
                monitorConfiguration.Name,
                monitorConfiguration.Url);

            var title = string.Empty;
            var message = string.Empty;
            if (incident.IsResolved)
            {
                title = $"Resolved: Incident for Monitor";
                message = $"The incident for monitor {incident.MonitorUrl} has been resolved.\n" +
                          $"Status Code: {incident.LastStatusCode}\n" +
                          $"Downtime Duration: {incident.DowntimeDurationSeconds ?? 0} seconds\n";
            }
            else
            {
                title = $"Alert: Incident for Monitor";
                message = $"An incident has been detected for monitor {incident.MonitorUrl}.\n" +
                          $"Status Code: {incident.LastStatusCode}\n" +
                          $"Reason: {incident.FailureReason}\n";
            }
            var userIds = await GetProjectPeopleIdsAsync(incident.ProjectKey);

            if (!string.IsNullOrWhiteSpace(monitorConfiguration.CreatedBy))
                userIds.Add(monitorConfiguration.CreatedBy);

            if (!string.IsNullOrWhiteSpace(monitorConfiguration.LastUpdatedBy))
                userIds.Add(monitorConfiguration.LastUpdatedBy);

            var payload = CreateNotificationPayload(title, message, userIds);
            return await SendNotificationAsync(payload, userIds);
        }

        public static object CreateNotificationPayload(string title, string message, List<string> userIds)
        {
            return new
            {
                ConnectionId = "",
                Roles = new List<string> { },
                UserIds = userIds,
                DenormalizedPayload = JsonSerializer.Serialize(new
                {
                    title = title,
                    description = message
                }),
                SaveDenormalizedPayloadAsAnObject = false,
                ConfigurationName = "GeneralNotification",
                ContentAvailable = true,
                ResponseKey = "status",
                ResponseValue = "sent"
            };
        }


        public async Task<List<string>> GetProjectPeopleIdsAsync(string projectKey)
        {
            return await _alertRepoService.GetProjectPeopleListAsync(projectKey);
        }

        public async Task<bool> SendNotificationAsync(object payload, List<string> userIds)
        {
            _logger.LogInformation("Sending notification to users : {UserIds}", string.Join(", ", userIds));

            var blocksKey = _configuration["RootTenantId"] ?? string.Empty;
            var salt = _tenants.GetTenantByID(blocksKey)?.TenantSalt;
            var actualSecret = _cryptoService.Hash(blocksKey, salt);

            var url = _configuration["NotificationServiceUrl"] ?? string.Empty;
            var headers = new Dictionary<string, string>
            {
                { "x-blocks-key", blocksKey },
                { "Secret", actualSecret}
            };

            var (response, httpResponse) = await _httpHelperServices.MakeHttpRequest<NotificationResponse>("NotificationClient", url, HttpMethod.Post, payload, headers);

            if (response is not null && response.IsSuccess)
            {
                _logger.LogInformation("Successfully sent notification to users : {UserIds}", string.Join(", ", userIds));
                return true;
            }
            else
            {
                _logger.LogError("Failed to sent notification to users : {UserIds}. Error : {Error}", string.Join(", ", userIds), httpResponse.ReasonPhrase);
                return false;
            }
        }
    }
}
