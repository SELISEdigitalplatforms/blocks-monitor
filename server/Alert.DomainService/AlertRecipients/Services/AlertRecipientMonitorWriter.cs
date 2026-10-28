using Blocks.Genesis.Entities.Monitor;
using DomainService.AlertRecipients.Models;
using DomainService.Monitor.Models;
using DomainService.Monitor.Services;

namespace DomainService.AlertRecipients.Services;

/// <summary>What a change does to one monitor's Emails.</summary>
public enum AlertRecipientChange
{
    /// <summary>Nothing to do (the monitor is not a target and does not hold the person).</summary>
    None,
    Add,
    Remove,
    /// <summary>A target that already holds the person.</summary>
    Unchanged,
    /// <summary>A target that already holds 10 emails.</summary>
    SkippedFull,
}

/// <summary>A planned change; <see cref="NewEmails"/> is set only for <see cref="AlertRecipientChange.Add"/> and <see cref="AlertRecipientChange.Remove"/>.</summary>
public sealed record PlannedEmailsChange(MonitorConfiguration Monitor, AlertRecipientChange Change, List<string>? NewEmails = null)
{
    public bool Writes => NewEmails is not null;
}

public enum EmailsWriteOutcome
{
    /// <summary>Written (or found already in the wanted state).</summary>
    Applied,
    /// <summary>Nothing to write: <see cref="PlannedEmailsChange.Change"/> says why.</summary>
    NotWritten,
    /// <summary>The Emails changed between the read and the write, again after one re-read; not overwritten.</summary>
    Conflicted,
    /// <summary>The caller may not edit the monitor, or can no longer see it.</summary>
    Denied,
    /// <summary>A data validation rule refused the new Emails (only when the caller asked to skip, not refuse).</summary>
    Invalid,
}

/// <summary>The final state of one planned change; <see cref="Plan"/> is the re-planned one after a retry.</summary>
public sealed record EmailsWriteResult(PlannedEmailsChange Plan, EmailsWriteOutcome Outcome);

/// <summary>
/// Writes planned Emails changes with the optimistic <c>$set</c> rules shared by the Alert recipients save, delete
/// and the Worker reconciliation:
/// one EDIT row filter for the request; every update checked by the data validation rules before anything is
/// written; one unordered bulk write whose filters require the Emails exactly as read; when fewer documents match,
/// one re-read (through the read row filter) and one re-planned retry per monitor; still no match = conflicted.
/// </summary>
public sealed class AlertRecipientMonitorWriter
{
    private readonly IMonitorConfigurationRepoService _repo;

    public AlertRecipientMonitorWriter(IMonitorConfigurationRepoService repo) => _repo = repo;

    /// <param name="tenantId">The validated tenant.</param>
    /// <param name="plans">One plan per monitor.</param>
    /// <param name="replan">Plans the same change again against a re-read monitor.</param>
    /// <param name="refuseInvalid">
    /// True: a refused update throws its <see cref="Blocks.Genesis.DataAccess.Rules.DataValidationException"/> before
    /// anything is written. False: those monitors are skipped as <see cref="EmailsWriteOutcome.Invalid"/>.
    /// </param>
    /// <returns>One result per plan, in input order.</returns>
    public async Task<List<EmailsWriteResult>> WriteAsync(
        string tenantId,
        IReadOnlyList<PlannedEmailsChange> plans,
        Func<MonitorConfiguration, PlannedEmailsChange> replan,
        bool refuseInvalid,
        string? updatedBy)
    {
        var results = new EmailsWriteResult?[plans.Count];
        var pending = new List<int>();
        for (var i = 0; i < plans.Count; i++)
        {
            if (plans[i].Writes) pending.Add(i);
            else results[i] = new EmailsWriteResult(plans[i], EmailsWriteOutcome.NotWritten);
        }
        if (pending.Count == 0)
            return results.Select(r => r!).ToList();

        var now = DateTime.UtcNow;
        var editFilter = await _repo.GetEmailsEditFilterAsync(tenantId, pending.Select(i => plans[i].Monitor.ItemId).ToList());
        if (editFilter is null)
        {
            foreach (var i in pending) results[i] = new EmailsWriteResult(plans[i], EmailsWriteOutcome.Denied);
            return results.Select(r => r!).ToList();
        }

        var updates = pending.ToDictionary(i => i, i => ToUpdate(plans[i], now, updatedBy));
        var failures = await _repo.CheckEmailsUpdatesAsync(updates.Values.ToList());
        if (failures.Count > 0)
        {
            if (refuseInvalid)
                throw failures[0].Error;
            var invalid = failures.Select(f => f.ItemId).ToHashSet(StringComparer.Ordinal);
            foreach (var i in pending.Where(i => invalid.Contains(plans[i].Monitor.ItemId)).ToList())
            {
                results[i] = new EmailsWriteResult(plans[i], EmailsWriteOutcome.Invalid);
                pending.Remove(i);
                updates.Remove(i);
            }
        }

        var matched = updates.Count == 0 ? 0 : await _repo.BulkUpdateEmailsAsync(updates.Values.ToList(), editFilter);
        if (matched >= updates.Count)
        {
            foreach (var i in pending) results[i] = new EmailsWriteResult(plans[i], EmailsWriteOutcome.Applied);
            return results.Select(r => r!).ToList();
        }

        // Fewer matched than sent: one re-read tells which were written and which changed meanwhile.
        var reread = (await _repo.GetEditableMonitorsAsync(tenantId, pending.Select(i => plans[i].Monitor.ItemId).ToList()))
            .ToDictionary(m => m.ItemId, StringComparer.Ordinal);
        var retries = new List<(int Index, PlannedEmailsChange Plan)>();
        foreach (var i in pending)
        {
            if (!reread.TryGetValue(plans[i].Monitor.ItemId, out var current))
                results[i] = new EmailsWriteResult(plans[i], EmailsWriteOutcome.Denied);
            else if ((current.Emails ?? new List<string>()).SequenceEqual(plans[i].NewEmails!, StringComparer.Ordinal))
                results[i] = new EmailsWriteResult(plans[i], EmailsWriteOutcome.Applied);
            else
            {
                var again = replan(current);
                if (again.Writes) retries.Add((i, again));
                else results[i] = new EmailsWriteResult(again, EmailsWriteOutcome.NotWritten);
            }
        }

        if (retries.Count > 0)
            await RetryAsync(retries, editFilter, results, now, updatedBy);
        return results.Select(r => r!).ToList();
    }

    /// <summary>One retry per monitor, written one by one so each knows whether it matched.</summary>
    private async Task RetryAsync(List<(int Index, PlannedEmailsChange Plan)> retries, MongoDB.Driver.FilterDefinition<MonitorConfiguration> editFilter,
        EmailsWriteResult?[] results, DateTime now, string? updatedBy)
    {
        var updates = retries.Select(r => ToUpdate(r.Plan, now, updatedBy)).ToList();
        // A rule refusing the re-planned list can't refuse the request any more (writes already happened): conflicted.
        var refused = (await _repo.CheckEmailsUpdatesAsync(updates)).Select(f => f.ItemId).ToHashSet(StringComparer.Ordinal);
        await Parallel.ForEachAsync(Enumerable.Range(0, retries.Count),
            new ParallelOptions { MaxDegreeOfParallelism = AlertRecipientRules.CheckParallelism },
            async (k, _) =>
            {
                var (index, plan) = retries[k];
                var written = !refused.Contains(plan.Monitor.ItemId) && await _repo.UpdateEmailsAsync(updates[k], editFilter);
                results[index] = new EmailsWriteResult(plan, written ? EmailsWriteOutcome.Applied : EmailsWriteOutcome.Conflicted);
            });
    }

    private static MonitorEmailsUpdate ToUpdate(PlannedEmailsChange plan, DateTime now, string? updatedBy) =>
        new(plan.Monitor.ItemId, plan.Monitor.Emails, plan.NewEmails!, now, updatedBy);
}
