using System.Diagnostics;
using Blocks.Genesis.Entities.Monitor;
using DomainService.AlertRecipients.Models;
using DomainService.Monitor.Services;
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
/// and retried on the next run. Runs without user context (the data access skip path). Logs never carry emails.
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
        var stopwatch = Stopwatch.StartNew();
        Dictionary<string, List<string>> tenants;
        try
        {
            tenants = await _store.GetAllMonitorsEmailsByTenantAsync();
        }
        catch (Exception ex)
        {
            _logger.LogError("Alert recipient reconciliation could not read the \"All monitors\" people: {ErrorType}.", ex.GetType().Name);
            return;
        }

        var updated = 0;
        foreach (var (tenantId, emails) in tenants)
        {
            try
            {
                updated += await ReconcileTenantAsync(tenantId, emails);
            }
            catch (Exception ex)
            {
                _logger.LogError("Alert recipient reconciliation failed for project {ProjectKey}: {ErrorType}.", tenantId, ex.GetType().Name);
            }
        }

        _logger.LogInformation("Alert recipient reconciliation: {Projects} projects, {Updated} monitors updated in {ElapsedMs} ms.",
            tenants.Count, updated, stopwatch.ElapsedMilliseconds);
    }

    private async Task<int> ReconcileTenantAsync(string tenantId, List<string> allMonitorsEmails)
    {
        var monitors = await _repo.GetEditableMonitorsMissingEmailsAsync(tenantId, allMonitorsEmails);
        if (monitors.Count == 0)
            return 0;

        PlannedEmailsChange Replan(MonitorConfiguration monitor) => Plan(monitor, allMonitorsEmails);
        var plans = monitors.Select(Replan).ToList();
        foreach (var plan in plans.Where(p => p.Change == AlertRecipientChange.SkippedFull))
            _logger.LogWarning("Monitor {MonitorId} of project {ProjectKey} already has {Max} alert recipients; its missing \"All monitors\" people were not added.",
                plan.Monitor.ItemId, tenantId, AlertRecipientRules.MaxEmailsPerMonitor);

        var results = await _writer.WriteAsync(tenantId, plans, Replan, refuseInvalid: false, updatedBy: null);
        foreach (var result in results.Where(r => r.Outcome is EmailsWriteOutcome.Invalid or EmailsWriteOutcome.Conflicted or EmailsWriteOutcome.Denied))
            _logger.LogWarning("Monitor {MonitorId} of project {ProjectKey} was not reconciled ({Outcome}); the next run retries it.",
                result.Plan.Monitor.ItemId, tenantId, result.Outcome);
        return results.Count(r => r.Outcome == EmailsWriteOutcome.Applied);
    }

    /// <summary>
    /// Appends the missing people in sorted order, never past 10 emails in total. A monitor already at 10 is
    /// <see cref="AlertRecipientChange.SkippedFull"/>; one that has everyone (compared normalized) is left alone.
    /// </summary>
    public static PlannedEmailsChange Plan(MonitorConfiguration monitor, IReadOnlyList<string> allMonitorsEmails)
    {
        var emails = monitor.Emails ?? new List<string>();
        var present = emails.Select(AlertRecipientEmail.Normalize).ToHashSet(StringComparer.Ordinal);
        var missing = allMonitorsEmails.Where(e => !present.Contains(e)).Order(StringComparer.Ordinal).ToList();
        if (missing.Count == 0)
            return new PlannedEmailsChange(monitor, AlertRecipientChange.None);
        var room = AlertRecipientRules.MaxEmailsPerMonitor - emails.Count;
        if (room <= 0)
            return new PlannedEmailsChange(monitor, AlertRecipientChange.SkippedFull);
        return new PlannedEmailsChange(monitor, AlertRecipientChange.Add, emails.Concat(missing.Take(room)).ToList());
    }
}
