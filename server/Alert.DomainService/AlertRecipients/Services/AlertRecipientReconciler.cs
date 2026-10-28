using System.Diagnostics;
using Blocks.Genesis;
using Blocks.Genesis.Entities.Monitor;
using DomainService.AlertRecipients.Models;
using DomainService.Monitor.Services;
using DomainService.Shared.Utilities;
using Microsoft.Extensions.Logging;

namespace DomainService.AlertRecipients.Services;

/// <summary>
/// The Worker step that gives every editable monitor its project's "All monitors" people, whatever created the
/// monitor (blocks-release inserts monitors straight into the collection). Runs before each monitor cache reload:
/// on the refresh message and on the 600-second poll.
/// </summary>
public interface IAlertRecipientReconciler
{
    /// <summary>Adds missing "All monitors" people. Never throws: failures are logged so the reload still runs.</summary>
    Task ReconcileAsync();
}

/// <remarks>
/// Adds only: never removes or reorders an email, never goes past 10, never touches Blocks services or
/// Infrastructure monitors, and writes nothing to a monitor that already has everyone. Writes use the same
/// optimistic rules as a save; a monitor that changed meanwhile, or that a validation rule refuses, is skipped
/// and retried on the next run.
/// <para>
/// It always runs without user context, which is the data access skip path. The 600-second poll has no context
/// anyway. A refresh message arrives with its sender's <see cref="BlocksContext"/>, so that context is cleared for
/// the run and restored afterwards: one project's row policies and rules must never decide another project's
/// monitors.
/// </para>
/// Logs carry project keys, monitor ids, counts and failure types, never an email address (C20).
/// </remarks>
public sealed class AlertRecipientReconciler : IAlertRecipientReconciler
{
    private readonly IAlertRecipientStore _store;
    private readonly IMonitorConfigurationRepoService _repo;
    private readonly ILogger<AlertRecipientReconciler> _logger;
    private readonly AlertRecipientMonitorWriter _writer;

    public AlertRecipientReconciler(IAlertRecipientStore store, IMonitorConfigurationRepoService repo, ILogger<AlertRecipientReconciler> logger)
    {
        _store = store;
        _repo = repo;
        _logger = logger;
        _writer = new AlertRecipientMonitorWriter(repo);
    }

    public async Task ReconcileAsync()
    {
        var callerContext = BlocksContext.GetContext();
        BlocksContext.SetContext(null);
        try
        {
            await ReconcileAllAsync();
        }
        finally
        {
            BlocksContext.SetContext(callerContext);
        }
    }

    private async Task ReconcileAllAsync()
    {
        var stopwatch = Stopwatch.StartNew();
        IReadOnlyList<AllMonitorsPeople> tenants = Array.Empty<AllMonitorsPeople>();
        string? readErrorType = null;
        try
        {
            tenants = await _store.GetAllMonitorsPeopleByTenantAsync();
        }
        catch (Exception ex)
        {
            // Only the type name leaves the catch (C20): the exception itself is never logged.
            readErrorType = ex.GetType().Name;
        }

        if (readErrorType is not null)
        {
            _logger.LogError("Alert recipient reconciliation could not read the \"All monitors\" people: {ErrorType}.", readErrorType);
            return;
        }

        int projects = 0, updated = 0;
        foreach (var tenant in tenants)
        {
            projects++;
            var tenantId = tenant.TenantId;
            string? tenantErrorType = null;
            try
            {
                updated += await ReconcileTenantAsync(tenantId, tenant.People);
            }
            catch (Exception ex)
            {
                tenantErrorType = ex.GetType().Name;
            }

            if (tenantErrorType is not null)
                _logger.LogError("Alert recipient reconciliation failed for project {ProjectKey}: {ErrorType}.", LogValue.Clean(tenantId), tenantErrorType);
        }

        _logger.LogInformation("Alert recipient reconciliation: {Projects} projects, {Updated} monitors updated in {ElapsedMs} ms.",
            projects, updated, stopwatch.ElapsedMilliseconds);
    }

    private async Task<int> ReconcileTenantAsync(string tenantId, IReadOnlyList<string> people)
    {
        var monitors = await _repo.GetEditableMonitorsMissingPeopleAsync(tenantId, people.ToList());
        if (monitors.Count == 0)
            return 0;

        PlannedRecipientChange Replan(MonitorConfiguration monitor) => Plan(monitor, people);
        var plans = monitors.Select(Replan).ToList();
        foreach (var plan in plans.Where(p => p.Change == AlertRecipientChange.SkippedFull))
            LogSkippedFull(plan.Monitor.ItemId, tenantId);

        var results = await _writer.WriteAsync(tenantId, plans, Replan, refuseInvalid: false, updatedBy: null);
        foreach (var result in results.Where(r => r.Outcome is RecipientWriteOutcome.Invalid or RecipientWriteOutcome.Conflicted or RecipientWriteOutcome.Denied))
            LogNotReconciled(result.Plan.Monitor.ItemId, tenantId, result.Outcome);
        return results.Count(r => r.Outcome == RecipientWriteOutcome.Applied);
    }

    // Only ids and the outcome reach these lines: the monitor id and the project key, never a list of people (C20).
    private void LogSkippedFull(string monitorId, string tenantId) =>
        // The limit is spelled in the text: the AlertRecipientRules constant is named like personal data, which CodeQL
        // (cs/exposure-of-private-information) then reports as reaching the log.
        _logger.LogWarning("Monitor {MonitorId} of project {ProjectKey} already has 10 alert recipients; its missing \"All monitors\" people were not added.",
            LogValue.Clean(monitorId), LogValue.Clean(tenantId));

    private void LogNotReconciled(string monitorId, string tenantId, RecipientWriteOutcome outcome) =>
        _logger.LogWarning("Monitor {MonitorId} of project {ProjectKey} was not reconciled ({Outcome}); the next run retries it.",
            LogValue.Clean(monitorId), LogValue.Clean(tenantId), outcome.ToString());

    /// <summary>
    /// Appends the missing people in sorted order, never past 10 emails in total. A monitor already at 10 is
    /// <see cref="AlertRecipientChange.SkippedFull"/>; one that has everyone (compared normalized) is left alone.
    /// </summary>
    public static PlannedRecipientChange Plan(MonitorConfiguration monitor, IReadOnlyList<string> allMonitorsPeople)
    {
        var emails = monitor.Emails ?? new List<string>();
        var present = emails.Select(AlertRecipientEmail.Normalize).ToHashSet(StringComparer.Ordinal);
        var missing = allMonitorsPeople.Where(e => !present.Contains(e)).Order(StringComparer.Ordinal).ToList();
        if (missing.Count == 0)
            return new PlannedRecipientChange(monitor, AlertRecipientChange.None);
        var room = AlertRecipientRules.MaxEmailsPerMonitor - emails.Count;
        if (room <= 0)
            return new PlannedRecipientChange(monitor, AlertRecipientChange.SkippedFull);
        return new PlannedRecipientChange(monitor, AlertRecipientChange.Add, emails.Concat(missing.Take(room)).ToList());
    }
}
