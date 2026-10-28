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

    /// <remarks>
    /// Order (B1): a change of the stored "All monitors" flag is written first, so the Worker reconciliation can never
    /// re-add a person this save narrows (All to Selected) while the monitors are written, and a person who becomes
    /// "All monitors" holds their place under the limit of 10 (m5: re-counted after the write, and undone with the
    /// refusal when the limit was passed meanwhile). Then the monitors; then the key-value entry when the flag did
    /// not change; then the refresh, so the Worker reads the final choice. A refusal before any monitor write undoes
    /// the early flag write.
    /// </remarks>
    public async Task<BaseApiResponse> SaveAsync(SaveAlertRecipientRequest? request)
    {
        var (save, invalid) = await PrepareSaveAsync(request);
        if (save is null)
            return invalid!;

        BaseApiResponse refused;
        try
        {
            return await SaveCoreAsync(save);
        }
        catch (DataValidationException ex)
        {
            refused = ex.ToRefusedResponse();
        }
        catch (Exception ex)
        {
            LogFailure(ex, "Saving an alert recipient", save.TenantId);
            if (save.Early is not null && !save.WriteStarted)
                await UndoEarlyChoiceAsync(save.TenantId, save.Early);
            return Refused(AlertRecipientRules.SaveFailed);
        }

        // Logged outside the catch: only the refusal is reported, never the exception or the email (C20).
        _logger.LogWarning("A data validation rule refused the alert recipient save for project {ProjectKey}; nothing was written.", LogValue.Clean(save.TenantId));
        if (save.Early is not null)
            await UndoEarlyChoiceAsync(save.TenantId, save.Early);
        return refused;
    }

    /// <summary>One save in progress: the checked request, and how far its writes got (read by the refusal paths).</summary>
    private sealed class SaveAttempt(SaveAlertRecipientRequest request, string tenantId, string email, string? userId)
    {
        public SaveAlertRecipientRequest Request { get; } = request;
        public string TenantId { get; } = tenantId;
        public string Email { get; } = email;
        public string? UserId { get; } = userId;
        public bool AllMonitors => Request.AllMonitors;

        /// <summary>The early "All monitors" flag write, when this save made one.</summary>
        public EarlyChoice? Early { get; set; }

        /// <summary>Set just before the first monitor write; a failure after it keeps the early flag write.</summary>
        public bool WriteStarted { get; set; }
    }

    /// <summary>The project check and the request validation; either the save to run or the refusal.</summary>
    private async Task<(SaveAttempt? Save, BaseApiResponse? Refusal)> PrepareSaveAsync(SaveAlertRecipientRequest? request)
    {
        var tenantId = ResolveTenant(request?.ProjectKey);
        if (request is null || tenantId is null)
            return (null, Refused(AlertRecipientRules.ProjectNotFound));

        var validation = await _validator.ValidateAsync(request);
        if (!validation.IsValid)
            return (null, Refused(validation.Errors[0].ErrorMessage));
        var email = AlertRecipientEmail.TryNormalize(request.Email)!;
        return (new SaveAttempt(request, tenantId, email, BlocksContext.GetContext()?.UserId), null);
    }

    /// <summary>The save steps in the B1 order (see <see cref="SaveAsync"/>); exceptions are handled by the caller.</summary>
    private async Task<BaseApiResponse> SaveCoreAsync(SaveAttempt save)
    {
        var monitors = await _repo.GetEditableMonitorsAsync(save.TenantId);
        var targets = ResolveTargets(save.Request, monitors, out var unknown);
        if (targets is null)
            return Refused(AlertRecipientRules.MonitorNotFoundPrefix + unknown);

        var people = await _store.GetAsync(save.TenantId);
        var previous = people.GetValueOrDefault(save.Email);
        var reservationRefused = await ReserveEarlyChoiceAsync(save, people, previous);
        if (reservationRefused is not null)
            return reservationRefused;
        var expected = save.Early?.Written ?? previous;

        var written = await WriteMonitorsAsync(save, monitors, targets, expected);

        var result = new AlertRecipientChangeResult { Email = save.Email, AllMonitors = save.AllMonitors };
        foreach (var item in written)
            Tally(item, result);
        var response = Success(Summary(result.Added, result.Removed, result.SkippedFull.Count, result.Conflicted.Count, result.Denied.Count), result);

        if (save.Early is null)
            response = await SaveChoiceAfterMonitorsAsync(save, previous, result, response);

        // After the key-value write (B1): the Worker reconciles against the final choice.
        await RefreshAsync(written, save.TenantId);
        _logger.LogInformation(
            "Alert recipient saved for project {ProjectKey}: {Added} added, {Removed} removed, {Unchanged} unchanged, {SkippedFull} full, {Conflicted} conflicted, {Denied} denied.",
            LogValue.Clean(save.TenantId), result.Added, result.Removed, result.Unchanged, result.SkippedFull.Count, result.Conflicted.Count, result.Denied.Count);
        return response;
    }

    /// <summary>
    /// The monitors the person should be on: every editable one for "All monitors", otherwise the requested ids.
    /// Null (with <paramref name="unknown"/>) when a requested id is empty or not an editable monitor.
    /// </summary>
    private static HashSet<string>? ResolveTargets(SaveAlertRecipientRequest request, List<MonitorConfiguration> monitors, out string? unknown)
    {
        var editable = monitors.Select(m => m.ItemId).ToHashSet(StringComparer.Ordinal);
        unknown = null;
        if (request.AllMonitors)
            return editable;

        unknown = request.MonitorIds!.FirstOrDefault(id => string.IsNullOrEmpty(id) || !editable.Contains(id));
        return unknown is null ? request.MonitorIds!.ToHashSet(StringComparer.Ordinal) : null;
    }

    /// <summary>
    /// B1/m5: checks the limit of 10 "All monitors" people, then writes a changed flag early (recorded in
    /// <see cref="SaveAttempt.Early"/>) and re-counts after it, undoing the write when the limit was passed meanwhile.
    /// Returns the refusal, or null to go on.
    /// </summary>
    private async Task<BaseApiResponse?> ReserveEarlyChoiceAsync(SaveAttempt save, Dictionary<string, StoredAlertRecipient> people, StoredAlertRecipient? previous)
    {
        if (save.AllMonitors
            && people.Values.Count(p => p.Entry.AllMonitors && p.Entry.Email != save.Email) >= AlertRecipientRules.MaxAllMonitorsPeople)
            return Refused(AlertRecipientRules.TooManyAllMonitorsPeople);

        if (save.AllMonitors == (previous?.Entry.AllMonitors ?? false))
            return null;

        var written = await _store.SaveAsync(save.TenantId, NewEntry(save.Email, save.AllMonitors, save.UserId), previous);
        save.Early = new EarlyChoice(previous, written);
        if (!save.AllMonitors || await WithinAllMonitorsLimitAsync(save.TenantId))
            return null;

        await UndoEarlyChoiceAsync(save.TenantId, save.Early);
        _logger.LogWarning("Another \"All monitors\" alert recipient was saved at the same time for project {ProjectKey}; this save was refused.",
            LogValue.Clean(save.TenantId));
        return Refused(AlertRecipientRules.TooManyAllMonitorsPeople);
    }

    /// <summary>The monitor writes; a retry re-checks (m2) that the stored choice is still <paramref name="expected"/>.</summary>
    private Task<List<RecipientWriteResult>> WriteMonitorsAsync(
        SaveAttempt save, List<MonitorConfiguration> monitors, HashSet<string> targets, StoredAlertRecipient? expected)
    {
        PlannedRecipientChange Replan(MonitorConfiguration m) => Plan(m, save.Email, targets.Contains(m.ItemId));
        save.WriteStarted = true;
        return _writer.WriteAsync(save.TenantId, monitors.Select(Replan).ToList(), Replan, refuseInvalid: true, save.UserId,
            () => ChoiceUnchangedAsync(save.TenantId, save.Email, expected));
    }

    /// <summary>
    /// The key-value write when the flag did not change (no early write): a failure is logged by type and turns the
    /// response into the "choice not saved" warning, keeping the monitor result.
    /// </summary>
    private async Task<BaseApiResponse> SaveChoiceAfterMonitorsAsync(
        SaveAttempt save, StoredAlertRecipient? previous, AlertRecipientChangeResult result, BaseApiResponse response)
    {
        try
        {
            await _store.SaveAsync(save.TenantId, NewEntry(save.Email, save.AllMonitors, save.UserId), previous);
            return response;
        }
        catch (Exception ex)
        {
            LogFailure(ex, "Saving the alert recipient's \"All monitors\" choice", save.TenantId);
            return new BaseApiResponse { IsSuccess = false, StatusCode = HttpStatusCode.OK, Message = AlertRecipientRules.ChoiceNotSaved, Data = result };
        }
    }

    /// <remarks>
    /// Order (B1): an "All monitors" person is first stored as not "All monitors", so the Worker reconciliation
    /// can't put them back while they are removed; then the monitors; then every key-value document; then the
    /// refresh. A refusal before any monitor write puts the stored choice back.
    /// </remarks>
    public async Task<BaseApiResponse> DeleteAsync(DeleteAlertRecipientRequest? request)
    {
        var tenantId = ResolveTenant(request?.ProjectKey);
        if (request is null || tenantId is null)
            return Refused(AlertRecipientRules.ProjectNotFound);

        var email = AlertRecipientEmail.TryNormalize(request.Email);
        if (email is null)
            return Refused(AlertRecipientRules.InvalidEmail);
        var userId = BlocksContext.GetContext()?.UserId;

        BaseApiResponse refused;
        EarlyChoice? early = null;
        try
        {
            var monitors = await _repo.GetEditableMonitorsAsync(tenantId);
            var people = await _store.GetAsync(tenantId);

            var previous = people.GetValueOrDefault(email);
            var expected = previous;
            if (previous?.Entry.AllMonitors == true)
            {
                expected = await _store.SaveAsync(tenantId, NewEntry(email, false, userId), previous);
                early = new EarlyChoice(previous, expected);
            }

            // Nothing can fail between the early write and the monitor writes, so a later failure leaves the
            // choice cleared, which is what the removal wants anyway.
            PlannedRecipientChange Replan(MonitorConfiguration m) => Plan(m, email, isTarget: false);
            var written = await _writer.WriteAsync(tenantId, monitors.Select(Replan).ToList(), Replan, refuseInvalid: true, userId,
                () => ChoiceUnchangedAsync(tenantId, email, expected));

            var change = new AlertRecipientChangeResult { Email = email };
            foreach (var item in written)
                Tally(item, change);
            var result = new AlertRecipientRemoveResult { Email = email, Removed = change.Removed, Conflicted = change.Conflicted, Denied = change.Denied };
            var response = Success(Summary(0, result.Removed, 0, result.Conflicted.Count, result.Denied.Count), result);

            if (expected is not null)
            {
                try
                {
                    await _store.RemoveAsync(expected);
                }
                catch (Exception ex)
                {
                    LogFailure(ex, "Removing the stored alert recipient", tenantId);
                    response = new BaseApiResponse { IsSuccess = false, StatusCode = HttpStatusCode.OK, Message = AlertRecipientRules.RemovalNotSaved, Data = result };
                }
            }

            // After the key-value delete (B1): the Worker reconciles against the final choice.
            await RefreshAsync(written, tenantId);
            _logger.LogInformation(
                "Alert recipient removed for project {ProjectKey}: {Removed} removed, {Conflicted} conflicted, {Denied} denied.",
                LogValue.Clean(tenantId), result.Removed, result.Conflicted.Count, result.Denied.Count);
            return response;
        }
        catch (DataValidationException ex)
        {
            refused = ex.ToRefusedResponse();
        }
        catch (Exception ex)
        {
            LogFailure(ex, "Removing an alert recipient", tenantId);
            return Refused(AlertRecipientRules.RemoveFailed);
        }

        // Logged outside the catch: only the refusal is reported, never the exception or the email (C20).
        _logger.LogWarning("A data validation rule refused the alert recipient removal for project {ProjectKey}; nothing was written.", LogValue.Clean(tenantId));
        if (early is not null)
            await UndoEarlyChoiceAsync(tenantId, early);
        return refused;
    }

    /// <summary>The stored choice before an early flag write (null: the person wasn't stored), and the write itself.</summary>
    private sealed record EarlyChoice(StoredAlertRecipient? Previous, StoredAlertRecipient Written);

    private static AlertRecipientEntry NewEntry(string email, bool allMonitors, string? userId) =>
        new() { Email = email, AllMonitors = allMonitors, UpdatedBy = userId, UpdatedAt = DateTime.UtcNow };

    /// <summary>m5: whether the project still has at most 10 "All monitors" people, read after this save's write.</summary>
    private async Task<bool> WithinAllMonitorsLimitAsync(string tenantId) =>
        (await _store.GetAsync(tenantId)).Values.Count(p => p.Entry.AllMonitors) <= AlertRecipientRules.MaxAllMonitorsPeople;

    /// <summary>Puts the stored choice back as it was before the early write. Failures are logged by type only.</summary>
    private async Task UndoEarlyChoiceAsync(string tenantId, EarlyChoice early)
    {
        string? errorType = null;
        try
        {
            if (early.Previous is null)
                await _store.RemoveAsync(early.Written);
            else
                await _store.SaveAsync(tenantId, early.Previous.Entry, early.Written);
        }
        catch (Exception ex)
        {
            errorType = ex.GetType().Name;
        }

        if (errorType is not null)
            _logger.LogError("Restoring the alert recipient's \"All monitors\" choice failed for project {ProjectKey}: {ErrorType}.",
                LogValue.Clean(tenantId), errorType);
    }

    /// <summary>
    /// m2: true while the person is stored as this request last saw or wrote them, so a monitor retry can't
    /// re-apply a change after someone else removed or saved the person meanwhile. A failed read answers false.
    /// </summary>
    private async Task<bool> ChoiceUnchangedAsync(string tenantId, string email, StoredAlertRecipient? expected)
    {
        StoredAlertRecipient? current;
        string? errorType = null;
        try
        {
            current = (await _store.GetAsync(tenantId)).GetValueOrDefault(email);
        }
        catch (Exception ex)
        {
            current = null;
            errorType = ex.GetType().Name;
        }

        if (errorType is not null)
        {
            _logger.LogWarning("Re-reading the alert recipient before a retry failed for project {ProjectKey} ({ErrorType}); nothing is retried.",
                LogValue.Clean(tenantId), errorType);
            return false;
        }
        if (current is null || expected is null)
            return current is null && expected is null;
        // The key-value store keeps milliseconds, so the entry written by this request compares within 1 ms.
        return current.Entry.AllMonitors == expected.Entry.AllMonitors
            && Math.Abs((current.Entry.UpdatedAt - expected.Entry.UpdatedAt).Ticks) < TimeSpan.TicksPerMillisecond;
    }

    /// <summary>
    /// What saving <paramref name="email"/> does to <paramref name="monitor"/> (decision Q7: emails compare
    /// normalized; other emails are never changed, reordered or trimmed, and legacy lists over 10 stay as they are).
    /// </summary>
    public static PlannedRecipientChange Plan(MonitorConfiguration monitor, string email, bool isTarget)
    {
        var emails = monitor.Emails ?? new List<string>();
        var holds = emails.Any(e => AlertRecipientEmail.Normalize(e) == email);
        if (isTarget)
        {
            if (holds) return new PlannedRecipientChange(monitor, AlertRecipientChange.Unchanged);
            if (emails.Count >= AlertRecipientRules.MaxEmailsPerMonitor) return new PlannedRecipientChange(monitor, AlertRecipientChange.SkippedFull);
            return new PlannedRecipientChange(monitor, AlertRecipientChange.Add, new List<string>(emails) { email });
        }
        return holds
            ? new PlannedRecipientChange(monitor, AlertRecipientChange.Remove, emails.Where(e => AlertRecipientEmail.Normalize(e) != email).ToList())
            : new PlannedRecipientChange(monitor, AlertRecipientChange.None);
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

    private static void Tally(RecipientWriteResult item, AlertRecipientChangeResult result)
    {
        var change = item.Plan.Change;
        var reference = new AlertRecipientMonitorRef(item.Plan.Monitor.ItemId, item.Plan.Monitor.Name ?? string.Empty);
        switch (item.Outcome)
        {
            case RecipientWriteOutcome.Applied when change == AlertRecipientChange.Add: result.Added++; break;
            case RecipientWriteOutcome.Applied: result.Removed++; break;
            case RecipientWriteOutcome.NotWritten when change == AlertRecipientChange.Unchanged: result.Unchanged++; break;
            case RecipientWriteOutcome.NotWritten when change == AlertRecipientChange.SkippedFull: result.SkippedFull.Add(reference); break;
            case RecipientWriteOutcome.Conflicted: result.Conflicted.Add(reference); break;
            case RecipientWriteOutcome.Denied: result.Denied.Add(reference); break;
        }
    }

    /// <summary>
    /// One Worker refresh message when an HTTP check changed, one health cache reload when a heartbeat changed.
    /// Failures are logged only: the 600-second polls pick the change up (C15).
    /// </summary>
    private async Task RefreshAsync(List<RecipientWriteResult> written, string tenantId)
    {
        var changed = written.Where(r => r.Outcome == RecipientWriteOutcome.Applied).Select(r => r.Plan.Monitor).ToList();
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
        _logger.LogError("{Action} failed for project {ProjectKey}: {ErrorType}.", action, LogValue.Clean(tenantId), ex.GetType().Name);

    private static BaseApiResponse Refused(string message) =>
        new() { IsSuccess = false, StatusCode = HttpStatusCode.OK, Message = message };

    private static BaseApiResponse Success(string message, object data) =>
        new() { IsSuccess = true, StatusCode = HttpStatusCode.OK, Message = message, Data = data };
}
