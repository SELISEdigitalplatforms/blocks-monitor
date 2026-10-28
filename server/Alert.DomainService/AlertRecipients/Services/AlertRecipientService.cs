using System.Net;
using Blocks.Genesis;
using Blocks.Genesis.DataAccess.Rules;
using Blocks.Genesis.Entities.Monitor;
using DomainService.Alert.Services;
using DomainService.AlertRecipients.Models;
using DomainService.Health.Services;
using DomainService.Monitor.Services;
using DomainService.Shared.DataAccess;
using DomainService.Shared.Entity;
using DomainService.Shared.Models;
using DomainService.Shared.Utilities;
using FluentValidation;
using Microsoft.Extensions.Logging;

namespace DomainService.AlertRecipients.Services;

/// <summary>The Alert recipients page: who gets each project's monitor alert emails, managed people-first.</summary>
public interface IAlertRecipientService
{
    /// <summary>The editable monitors and the recipients (<see cref="AlertRecipientsResponse"/>).</summary>
    Task<BaseApiResponse> GetAsync(string? projectKey);

    /// <summary>Project members' emails that are not recipients yet (<see cref="AlertRecipientSuggestionsResponse"/>).</summary>
    Task<BaseApiResponse> GetSuggestionsAsync(string? projectKey);

    /// <summary>Adds or updates one person (<see cref="AlertRecipientChangeResult"/>).</summary>
    Task<BaseApiResponse> SaveAsync(SaveAlertRecipientRequest? request);

    /// <summary>Removes one person from every editable monitor (<see cref="AlertRecipientRemoveResult"/>).</summary>
    Task<BaseApiResponse> DeleteAsync(DeleteAlertRecipientRequest? request);
}

/// <remarks>
/// Every endpoint first checks the request's project against the caller's token tenant, and only that tenant is
/// read or written. Monitor writes go through <see cref="AlertRecipientMonitorWriter"/> (data access row filters and
/// validation rules). Log lines carry counts, project keys and monitor ids, never an email address (C20): exceptions
/// are logged by type only, since a driver or rule message may quote the data.
/// Known limit (decision Q8): a monitor or heartbeat edit that replaces the whole document can revert a recipient
/// change that lands between its read and its write.
/// </remarks>
public sealed class AlertRecipientService : IAlertRecipientService
{
    private readonly IMonitorConfigurationRepoService _repo;
    private readonly IAlertRecipientStore _store;
    private readonly AlertRepoService _alertRepo;
    private readonly IMessageClient _messageClient;
    private readonly HealthCheckService _healthCheckService;
    private readonly IValidator<SaveAlertRecipientRequest> _validator;
    private readonly ILogger<AlertRecipientService> _logger;
    private readonly AlertRecipientMonitorWriter _writer;

    public AlertRecipientService(
        IMonitorConfigurationRepoService repo,
        IAlertRecipientStore store,
        AlertRepoService alertRepo,
        IMessageClient messageClient,
        HealthCheckService healthCheckService,
        IValidator<SaveAlertRecipientRequest> validator,
        ILogger<AlertRecipientService> logger)
    {
        _repo = repo;
        _store = store;
        _alertRepo = alertRepo;
        _messageClient = messageClient;
        _healthCheckService = healthCheckService;
        _validator = validator;
        _logger = logger;
        _writer = new AlertRecipientMonitorWriter(repo);
    }

    public async Task<BaseApiResponse> GetAsync(string? projectKey)
    {
        var tenantId = ResolveTenant(projectKey);
        if (tenantId is null)
            return Refused(AlertRecipientRules.ProjectNotFound);

        try
        {
            var monitors = await GetSortedMonitorsForViewAsync(tenantId);
            var people = await _store.GetAsync(tenantId);
            return Success("Success", BuildResponse(monitors, people));
        }
        catch (Exception ex)
        {
            LogFailure(ex, "Loading the alert recipients", tenantId);
            return Refused(AlertRecipientRules.LoadFailed);
        }
    }

    public async Task<BaseApiResponse> GetSuggestionsAsync(string? projectKey)
    {
        var tenantId = ResolveTenant(projectKey);
        if (tenantId is null)
            return Refused(AlertRecipientRules.ProjectNotFound);

        try
        {
            var members = await _alertRepo.GetProjectMemberEmailsAsync(tenantId);
            var monitors = await GetSortedMonitorsForViewAsync(tenantId);
            var people = await _store.GetAsync(tenantId);
            var recipients = BuildResponse(monitors, people).Recipients.Select(r => r.Email).ToHashSet(StringComparer.Ordinal);

            var suggestions = members
                .Select(AlertRecipientEmail.TryNormalize)
                .OfType<string>()
                .Where(email => !recipients.Contains(email))
                .Distinct(StringComparer.Ordinal)
                .Order(StringComparer.Ordinal)
                .Take(AlertRecipientRules.MaxSuggestions)
                .ToList();
            return Success("Success", new AlertRecipientSuggestionsResponse { MemberEmails = suggestions });
        }
        catch (Exception ex)
        {
            LogFailure(ex, "Loading the alert recipient suggestions", tenantId);
            return Refused(AlertRecipientRules.LoadFailed);
        }
    }

    public async Task<BaseApiResponse> SaveAsync(SaveAlertRecipientRequest? request)
    {
        var tenantId = ResolveTenant(request?.ProjectKey);
        if (request is null || tenantId is null)
            return Refused(AlertRecipientRules.ProjectNotFound);

        var validation = await _validator.ValidateAsync(request);
        if (!validation.IsValid)
            return Refused(validation.Errors[0].ErrorMessage);
        var email = AlertRecipientEmail.TryNormalize(request.Email)!;

        try
        {
            var monitors = await _repo.GetEditableMonitorsAsync(tenantId);
            HashSet<string> targets;
            if (request.AllMonitors)
            {
                targets = monitors.Select(m => m.ItemId).ToHashSet(StringComparer.Ordinal);
            }
            else
            {
                var editable = monitors.Select(m => m.ItemId).ToHashSet(StringComparer.Ordinal);
                var unknown = request.MonitorIds!.FirstOrDefault(id => string.IsNullOrEmpty(id) || !editable.Contains(id));
                if (unknown is not null)
                    return Refused(AlertRecipientRules.MonitorNotFoundPrefix + unknown);
                targets = request.MonitorIds!.ToHashSet(StringComparer.Ordinal);
            }

            var people = await _store.GetAsync(tenantId);
            if (request.AllMonitors
                && people.Values.Count(p => p.Entry.AllMonitors && p.Entry.Email != email) >= AlertRecipientRules.MaxAllMonitorsPeople)
                return Refused(AlertRecipientRules.TooManyAllMonitorsPeople);

            PlannedEmailsChange Replan(MonitorConfiguration m) => Plan(m, email, targets.Contains(m.ItemId));
            var userId = BlocksContext.GetContext()?.UserId;
            var written = await _writer.WriteAsync(tenantId, monitors.Select(Replan).ToList(), Replan, refuseInvalid: true, userId);

            var result = new AlertRecipientChangeResult { Email = email, AllMonitors = request.AllMonitors };
            foreach (var item in written)
                Tally(item, result);
            await RefreshAsync(written, tenantId);
            _logger.LogInformation(
                "Alert recipient saved for project {ProjectKey}: {Added} added, {Removed} removed, {Unchanged} unchanged, {SkippedFull} full, {Conflicted} conflicted, {Denied} denied.",
                tenantId, result.Added, result.Removed, result.Unchanged, result.SkippedFull.Count, result.Conflicted.Count, result.Denied.Count);

            try
            {
                var entry = new AlertRecipientEntry { Email = email, AllMonitors = request.AllMonitors, UpdatedBy = userId, UpdatedAt = DateTime.UtcNow };
                await _store.SaveAsync(tenantId, entry, people.GetValueOrDefault(email));
            }
            catch (Exception ex)
            {
                LogFailure(ex, "Saving the alert recipient's \"All monitors\" choice", tenantId);
                return new BaseApiResponse { IsSuccess = false, StatusCode = HttpStatusCode.OK, Message = AlertRecipientRules.ChoiceNotSaved, Data = result };
            }

            return Success(Summary(result.Added, result.Removed, result.SkippedFull.Count, result.Conflicted.Count, result.Denied.Count), result);
        }
        catch (DataValidationException ex)
        {
            _logger.LogWarning("A data validation rule refused the alert recipient save for project {ProjectKey}; nothing was written.", tenantId);
            return ex.ToRefusedResponse();
        }
        catch (Exception ex)
        {
            LogFailure(ex, "Saving an alert recipient", tenantId);
            return Refused(AlertRecipientRules.SaveFailed);
        }
    }

    public async Task<BaseApiResponse> DeleteAsync(DeleteAlertRecipientRequest? request)
    {
        var tenantId = ResolveTenant(request?.ProjectKey);
        if (request is null || tenantId is null)
            return Refused(AlertRecipientRules.ProjectNotFound);

        var email = AlertRecipientEmail.TryNormalize(request.Email);
        if (email is null)
            return Refused(AlertRecipientRules.InvalidEmail);

        try
        {
            var monitors = await _repo.GetEditableMonitorsAsync(tenantId);
            var people = await _store.GetAsync(tenantId);

            PlannedEmailsChange Replan(MonitorConfiguration m) => Plan(m, email, isTarget: false);
            var written = await _writer.WriteAsync(tenantId, monitors.Select(Replan).ToList(), Replan, refuseInvalid: true, BlocksContext.GetContext()?.UserId);

            var change = new AlertRecipientChangeResult { Email = email };
            foreach (var item in written)
                Tally(item, change);
            var result = new AlertRecipientRemoveResult { Email = email, Removed = change.Removed, Conflicted = change.Conflicted, Denied = change.Denied };
            await RefreshAsync(written, tenantId);
            _logger.LogInformation(
                "Alert recipient removed for project {ProjectKey}: {Removed} removed, {Conflicted} conflicted, {Denied} denied.",
                tenantId, result.Removed, result.Conflicted.Count, result.Denied.Count);

            if (people.TryGetValue(email, out var stored))
            {
                try
                {
                    await _store.RemoveAsync(stored);
                }
                catch (Exception ex)
                {
                    LogFailure(ex, "Removing the stored alert recipient", tenantId);
                    return new BaseApiResponse { IsSuccess = false, StatusCode = HttpStatusCode.OK, Message = AlertRecipientRules.RemovalNotSaved, Data = result };
                }
            }

            return Success(Summary(0, result.Removed, 0, result.Conflicted.Count, result.Denied.Count), result);
        }
        catch (DataValidationException ex)
        {
            _logger.LogWarning("A data validation rule refused the alert recipient removal for project {ProjectKey}; nothing was written.", tenantId);
            return ex.ToRefusedResponse();
        }
        catch (Exception ex)
        {
            LogFailure(ex, "Removing an alert recipient", tenantId);
            return Refused(AlertRecipientRules.RemoveFailed);
        }
    }

    /// <summary>
    /// What saving <paramref name="email"/> does to <paramref name="monitor"/> (decision Q7: emails compare
    /// normalized; other emails are never changed, reordered or trimmed, and legacy lists over 10 stay as they are).
    /// </summary>
    public static PlannedEmailsChange Plan(MonitorConfiguration monitor, string email, bool isTarget)
    {
        var emails = monitor.Emails ?? new List<string>();
        var holds = emails.Any(e => AlertRecipientEmail.Normalize(e) == email);
        if (isTarget)
        {
            if (holds) return new PlannedEmailsChange(monitor, AlertRecipientChange.Unchanged);
            if (emails.Count >= AlertRecipientRules.MaxEmailsPerMonitor) return new PlannedEmailsChange(monitor, AlertRecipientChange.SkippedFull);
            return new PlannedEmailsChange(monitor, AlertRecipientChange.Add, new List<string>(emails) { email });
        }
        return holds
            ? new PlannedEmailsChange(monitor, AlertRecipientChange.Remove, emails.Where(e => AlertRecipientEmail.Normalize(e) != email).ToList())
            : new PlannedEmailsChange(monitor, AlertRecipientChange.None);
    }

    /// <summary>The success message, e.g. "Added to 4 monitors. 1 skipped: already has 10 recipients."</summary>
    public static string Summary(int added, int removed, int skippedFull, int conflicted, int denied)
    {
        var parts = new List<string>();
        if (added > 0) parts.Add($"Added to {Monitors(added)}.");
        if (removed > 0) parts.Add($"Removed from {Monitors(removed)}.");
        if (added == 0 && removed == 0) parts.Add("No monitor needed a change.");
        if (skippedFull > 0) parts.Add($"{skippedFull} skipped: already {(skippedFull == 1 ? "has" : "have")} {AlertRecipientRules.MaxEmailsPerMonitor} recipients.");
        if (conflicted > 0) parts.Add($"{conflicted} not updated: changed by someone else at the same time. Try again.");
        if (denied > 0) parts.Add($"{denied} not updated: you can't edit {(denied == 1 ? "it" : "them")}.");
        return string.Join(" ", parts);

        static string Monitors(int n) => n == 1 ? "1 monitor" : $"{n} monitors";
    }

    /// <summary>The GET shape from the editable monitors (already sorted) and the stored people.</summary>
    public static AlertRecipientsResponse BuildResponse(List<MonitorConfiguration> monitors, Dictionary<string, StoredAlertRecipient> people)
    {
        var response = new AlertRecipientsResponse();
        var membership = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var monitor in monitors)
        {
            var emails = (monitor.Emails ?? new List<string>())
                .Select(AlertRecipientEmail.Normalize)
                .Where(e => e.Length > 0)
                .Distinct(StringComparer.Ordinal)
                .ToList();
            response.Monitors.Add(new AlertRecipientMonitor
            {
                ItemId = monitor.ItemId,
                Name = monitor.Name ?? string.Empty,
                Kind = monitor.MonitorConfigurationType == MonitorConfigurationTypes.InboundPing ? AlertRecipientMonitorKinds.Heartbeat : AlertRecipientMonitorKinds.HttpCheck,
                IsActive = monitor.IsActive,
                EmailCount = monitor.Emails?.Count ?? 0,
            });
            if (emails.Count == 0)
                response.MonitorsWithoutRecipients.Add(monitor.ItemId);
            foreach (var email in emails)
            {
                if (!membership.TryGetValue(email, out var ids))
                    membership[email] = ids = new List<string>();
                ids.Add(monitor.ItemId);
            }
        }

        foreach (var email in membership.Keys.Union(people.Keys).Order(StringComparer.Ordinal))
        {
            var monitorIds = membership.GetValueOrDefault(email) ?? new List<string>();
            var choice = people.TryGetValue(email, out var stored) && stored.Entry.AllMonitors;
            response.Recipients.Add(new AlertRecipient
            {
                Email = email,
                AllMonitorsChoice = choice,
                AllMonitors = choice && monitorIds.Count == monitors.Count,
                MonitorIds = monitorIds,
            });
        }
        return response;
    }

    private async Task<List<MonitorConfiguration>> GetSortedMonitorsForViewAsync(string tenantId) =>
        (await _repo.GetEditableMonitorsForViewAsync(tenantId))
            .OrderBy(m => m.Name ?? string.Empty, StringComparer.OrdinalIgnoreCase)
            .ThenBy(m => m.ItemId, StringComparer.Ordinal)
            .ToList();

    private static void Tally(EmailsWriteResult item, AlertRecipientChangeResult result)
    {
        var change = item.Plan.Change;
        var reference = new AlertRecipientMonitorRef(item.Plan.Monitor.ItemId, item.Plan.Monitor.Name ?? string.Empty);
        switch (item.Outcome)
        {
            case EmailsWriteOutcome.Applied when change == AlertRecipientChange.Add: result.Added++; break;
            case EmailsWriteOutcome.Applied: result.Removed++; break;
            case EmailsWriteOutcome.NotWritten when change == AlertRecipientChange.Unchanged: result.Unchanged++; break;
            case EmailsWriteOutcome.NotWritten when change == AlertRecipientChange.SkippedFull: result.SkippedFull.Add(reference); break;
            case EmailsWriteOutcome.Conflicted: result.Conflicted.Add(reference); break;
            case EmailsWriteOutcome.Denied: result.Denied.Add(reference); break;
        }
    }

    /// <summary>
    /// One Worker refresh message when an HTTP check changed, one health cache reload when a heartbeat changed.
    /// Failures are logged only: the 600-second polls pick the change up (C15).
    /// </summary>
    private async Task RefreshAsync(List<EmailsWriteResult> written, string tenantId)
    {
        var changed = written.Where(r => r.Outcome == EmailsWriteOutcome.Applied).Select(r => r.Plan.Monitor).ToList();
        var httpCheck = changed.FirstOrDefault(m => m.MonitorConfigurationType == MonitorConfigurationTypes.OutboundPing);
        if (httpCheck is not null)
        {
            try
            {
                await _messageClient.SendToConsumerAsync(new ConsumerMessage<MonitorConfigurationUpdateQueue>
                {
                    ConsumerName = MonitorConstants.MonitorConfigurationUpdateQueue,
                    Payload = new MonitorConfigurationUpdateQueue { MonitorId = httpCheck.ItemId },
                });
            }
            catch (Exception ex)
            {
                LogFailure(ex, "Queueing the monitor refresh after an alert recipient change", tenantId);
            }
        }

        if (changed.Any(m => m.MonitorConfigurationType == MonitorConfigurationTypes.InboundPing))
        {
            try
            {
                await _healthCheckService.LoadMonitorsFromDatabaseAsync();
            }
            catch (Exception ex)
            {
                LogFailure(ex, "Reloading the heartbeat cache after an alert recipient change", tenantId);
            }
        }
    }

    /// <summary>The caller's tenant when <paramref name="projectKey"/> names it (ordinal), otherwise null.</summary>
    private static string? ResolveTenant(string? projectKey)
    {
        var tenantId = BlocksContext.GetContext()?.TenantId;
        return !string.IsNullOrEmpty(tenantId) && !string.IsNullOrEmpty(projectKey) && string.Equals(tenantId, projectKey, StringComparison.Ordinal)
            ? tenantId
            : null;
    }

    private void LogFailure(Exception ex, string action, string tenantId) =>
        _logger.LogError("{Action} failed for project {ProjectKey}: {ErrorType}.", action, tenantId, ex.GetType().Name);

    private static BaseApiResponse Refused(string message) =>
        new() { IsSuccess = false, StatusCode = HttpStatusCode.OK, Message = message };

    private static BaseApiResponse Success(string message, object data) =>
        new() { IsSuccess = true, StatusCode = HttpStatusCode.OK, Message = message, Data = data };
}
