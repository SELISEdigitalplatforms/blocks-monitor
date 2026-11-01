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
public sealed record PlannedRecipientChange(MonitorConfiguration Monitor, AlertRecipientChange Change, List<string>? NewEmails = null)
{
    public bool Writes => NewEmails is not null;
}

public enum RecipientWriteOutcome
{
    /// <summary>Written (or found already in the wanted state).</summary>
    Applied,
    /// <summary>Nothing to write: <see cref="PlannedRecipientChange.Change"/> says why.</summary>
    NotWritten,
    /// <summary>The Emails changed between the read and the write, again after one re-read; not overwritten.</summary>
    Conflicted,
    /// <summary>The caller may not edit the monitor, or can no longer see it.</summary>
    Denied,
    /// <summary>A data validation rule refused the new Emails (only when the caller asked to skip, not refuse).</summary>
    Invalid,
}

/// <summary>The final state of one planned change; <see cref="Plan"/> is the re-planned one after a retry.</summary>
public sealed record RecipientWriteResult(PlannedRecipientChange Plan, RecipientWriteOutcome Outcome);

/// <summary>
/// Writes planned Emails changes with the optimistic <c>$set</c> rules shared by the Alert recipients save, delete
/// and the Worker reconciliation:
/// one EDIT row filter for the request; every update checked by the data validation rules before anything is
/// written; one unordered bulk write whose filters require the Emails exactly as read; when fewer documents match,
/// one re-read (through the read row filter) and one re-planned retry per monitor; still no match = conflicted.
/// <para>
/// A retry must never undo someone else's later change (review m2). An unordered bulk write doesn't say which
/// updates matched, so a monitor whose re-read equals the list this request read is never retried: either this
/// request's write was applied and then reverted by another writer, or the edit row filter excludes it. And when
/// the caller passes an intent check, the retries run only while it still holds (for example, the person was not
/// removed or saved again meanwhile).
/// </para>
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
    /// anything is written. False: those monitors are skipped as <see cref="RecipientWriteOutcome.Invalid"/>.
    /// </param>
    /// <param name="intentStillCurrent">
    /// Optional; asked once, only when there are retries. False: nothing is retried and those monitors are
    /// <see cref="RecipientWriteOutcome.Conflicted"/>.
    /// </param>
    /// <returns>One result per plan, in input order.</returns>
    public async Task<List<RecipientWriteResult>> WriteAsync(
        string tenantId,
        IReadOnlyList<PlannedRecipientChange> plans,
        Func<MonitorConfiguration, PlannedRecipientChange> replan,
        bool refuseInvalid,
        string? updatedBy,
        Func<Task<bool>>? intentStillCurrent = null)
    {
        var results = new RecipientWriteResult?[plans.Count];
        var pending = SplitPending(plans, results);
        if (pending.Count == 0)
            return Completed(results);

        var now = DateTime.UtcNow;
        var editFilter = await _repo.GetEmailsEditFilterAsync(tenantId);
        if (editFilter is null)
        {
            SetAll(results, plans, pending, RecipientWriteOutcome.Denied);
            return Completed(results);
        }

        var updates = pending.ToDictionary(i => i, i => ToUpdate(plans[i], now, updatedBy));
        var failures = await _repo.CheckEmailsUpdatesAsync(updates.Values.ToList());
        if (failures.Count > 0)
        {
            if (refuseInvalid)
                throw failures[0].Error;
            SkipInvalid(failures.Select(f => f.ItemId), plans, pending, updates, results);
        }

        var matched = updates.Count == 0 ? 0 : await _repo.BulkUpdateEmailsAsync(updates.Values.ToList(), editFilter);
        if (matched >= updates.Count)
        {
            SetAll(results, plans, pending, RecipientWriteOutcome.Applied);
            return Completed(results);
        }

        // Fewer matched than sent: one re-read tells which were written and which changed meanwhile.
        var reread = (await _repo.GetEditableMonitorsAsync(tenantId, pending.Select(i => plans[i].Monitor.ItemId).ToList()))
            .ToDictionary(m => m.ItemId, StringComparer.Ordinal);
        var retries = ResolveAll(plans, pending, reread, replan, results);
        if (retries.Count == 0)
            return Completed(results);
        if (intentStillCurrent is not null && !await intentStillCurrent())
        {
            foreach (var (index, plan) in retries)
                results[index] = new RecipientWriteResult(plan, RecipientWriteOutcome.Conflicted);
            return Completed(results);
        }
        await RetryAsync(retries, editFilter, results, now, updatedBy);
        return Completed(results);
    }

    /// <summary>Marks the plans that write nothing as <see cref="RecipientWriteOutcome.NotWritten"/>; returns the indexes of the others.</summary>
    private static List<int> SplitPending(IReadOnlyList<PlannedRecipientChange> plans, RecipientWriteResult?[] results)
    {
        var pending = new List<int>();
        for (var i = 0; i < plans.Count; i++)
        {
            if (plans[i].Writes) pending.Add(i);
            else results[i] = new RecipientWriteResult(plans[i], RecipientWriteOutcome.NotWritten);
        }
        return pending;
    }

    private static void SetAll(RecipientWriteResult?[] results, IReadOnlyList<PlannedRecipientChange> plans, List<int> pending, RecipientWriteOutcome outcome)
    {
        foreach (var i in pending) results[i] = new RecipientWriteResult(plans[i], outcome);
    }

    /// <summary>Takes the monitors a data validation rule refused out of the write, as <see cref="RecipientWriteOutcome.Invalid"/>.</summary>
    private static void SkipInvalid(IEnumerable<string> refusedIds, IReadOnlyList<PlannedRecipientChange> plans, List<int> pending,
        Dictionary<int, MonitorEmailsUpdate> updates, RecipientWriteResult?[] results)
    {
        var invalid = refusedIds.ToHashSet(StringComparer.Ordinal);
        foreach (var i in pending.Where(i => invalid.Contains(plans[i].Monitor.ItemId)).ToList())
        {
            results[i] = new RecipientWriteResult(plans[i], RecipientWriteOutcome.Invalid);
            pending.Remove(i);
            updates.Remove(i);
        }
    }

    /// <summary>Resolves every pending plan against the re-read monitors; returns the ones to write again.</summary>
    private static List<(int Index, PlannedRecipientChange Plan)> ResolveAll(IReadOnlyList<PlannedRecipientChange> plans, List<int> pending,
        Dictionary<string, MonitorConfiguration> reread, Func<MonitorConfiguration, PlannedRecipientChange> replan, RecipientWriteResult?[] results)
    {
        var retries = new List<(int Index, PlannedRecipientChange Plan)>();
        foreach (var i in pending)
        {
            var retry = Resolve(plans[i], reread.GetValueOrDefault(plans[i].Monitor.ItemId), replan, out var final);
            if (retry is not null) retries.Add((i, retry));
            else results[i] = final;
        }
        return retries;
    }

    /// <summary>
    /// After a short bulk write: a monitor no longer visible is denied, one already holding the new Emails was
    /// applied, one still holding exactly the Emails this request read is conflicted (see the class remarks),
    /// otherwise the change is planned again; a re-plan that writes is returned as the retry.
    /// </summary>
    private static PlannedRecipientChange? Resolve(PlannedRecipientChange plan, MonitorConfiguration? current,
        Func<MonitorConfiguration, PlannedRecipientChange> replan, out RecipientWriteResult? final)
    {
        final = null;
        if (current is null)
        {
            final = new RecipientWriteResult(plan, RecipientWriteOutcome.Denied);
            return null;
        }
        var currentEmails = current.Emails ?? new List<string>();
        if (currentEmails.SequenceEqual(plan.NewEmails!, StringComparer.Ordinal))
        {
            final = new RecipientWriteResult(plan, RecipientWriteOutcome.Applied);
            return null;
        }
        if (currentEmails.SequenceEqual(plan.Monitor.Emails ?? new List<string>(), StringComparer.Ordinal))
        {
            final = new RecipientWriteResult(plan, RecipientWriteOutcome.Conflicted);
            return null;
        }
        var again = replan(current);
        if (again.Writes)
            return again;
        final = new RecipientWriteResult(again, RecipientWriteOutcome.NotWritten);
        return null;
    }

    private static List<RecipientWriteResult> Completed(RecipientWriteResult?[] results) => results.Select(r => r!).ToList();

    /// <summary>One retry per monitor, written one by one so each knows whether it matched.</summary>
    private async Task RetryAsync(List<(int Index, PlannedRecipientChange Plan)> retries, MongoDB.Driver.FilterDefinition<MonitorConfiguration> editFilter,
        RecipientWriteResult?[] results, DateTime now, string? updatedBy)
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
                results[index] = new RecipientWriteResult(plan, written ? RecipientWriteOutcome.Applied : RecipientWriteOutcome.Conflicted);
            });
    }

    private static MonitorEmailsUpdate ToUpdate(PlannedRecipientChange plan, DateTime now, string? updatedBy) =>
        new(plan.Monitor.ItemId, plan.Monitor.Emails, plan.NewEmails!, now, updatedBy);
}
