using Blocks.Genesis;
using DomainService.AlertRecipients.Models;
using DomainService.Shared.Utilities;
using Microsoft.Extensions.Logging;

namespace DomainService.AlertRecipients.Services;

/// <summary>One person as stored, merged from every key-value document carrying their email.</summary>
/// <param name="Entry">The winning value (latest <c>UpdatedAt</c>), with the email normalized.</param>
/// <param name="ItemIds">The key-value documents for the email, the winner first.</param>
public sealed record StoredAlertRecipient(AlertRecipientEntry Entry, IReadOnlyList<string> ItemIds);

/// <summary>One project's "All monitors" people (sorted, at most 10), as the Worker reconciliation reads them.</summary>
/// <param name="TenantId">The project, taken from the key-value key.</param>
/// <param name="People">The people's normalized addresses. Never logged (C20).</param>
public sealed record AllMonitorsPeople(string TenantId, IReadOnlyList<string> People);

/// <summary>
/// The people list in the Genesis key-value store (root DB, multi-value API): one document per person under
/// <c>monitor:alert-recipients:{tenant}</c>. Reads merge duplicates (latest <c>UpdatedAt</c> wins); writes for a
/// person remove that person's extra documents. All reads and writes throw on failure, except
/// <see cref="GetEmailsForNewMonitorAsync"/>, which never fails a monitor create.
/// </summary>
public interface IAlertRecipientStore
{
    /// <summary>The project's people by normalized email.</summary>
    Task<Dictionary<string, StoredAlertRecipient>> GetAsync(string tenantId);

    /// <summary>Upserts <paramref name="entry"/> and deletes the person's duplicate documents.</summary>
    /// <returns>The person as now stored: <paramref name="entry"/> and its one document.</returns>
    Task<StoredAlertRecipient> SaveAsync(string tenantId, AlertRecipientEntry entry, StoredAlertRecipient? existing);

    /// <summary>Deletes every document of the person.</summary>
    Task RemoveAsync(StoredAlertRecipient existing);

    /// <summary>Each project with "All monitors" people: those people, sorted, at most 10.</summary>
    Task<IReadOnlyList<AllMonitorsPeople>> GetAllMonitorsPeopleByTenantAsync();

    /// <summary>
    /// The emails a new editable monitor of <paramref name="projectKey"/> starts with: its "All monitors" people,
    /// sorted, at most 10. Empty, with a warning, when the caller belongs to another project (decision Q2) or the
    /// read fails (C10). Never throws.
    /// </summary>
    Task<List<string>> GetEmailsForNewMonitorAsync(string? projectKey);
}

public sealed class AlertRecipientStore : IAlertRecipientStore
{
    private readonly IKeyValueStore _keyValueStore;
    private readonly ILogger<AlertRecipientStore> _logger;

    public AlertRecipientStore(IKeyValueStore keyValueStore, ILogger<AlertRecipientStore> logger)
    {
        _keyValueStore = keyValueStore;
        _logger = logger;
    }

    public async Task<Dictionary<string, StoredAlertRecipient>> GetAsync(string tenantId)
    {
        var items = await _keyValueStore.GetAllAsync<AlertRecipientEntry>(AlertRecipientRules.Key(tenantId), impersonated: false);
        return Merge(items);
    }

    public async Task<StoredAlertRecipient> SaveAsync(string tenantId, AlertRecipientEntry entry, StoredAlertRecipient? existing)
    {
        var itemId = existing?.ItemIds[0];
        if (itemId is null || !await _keyValueStore.UpdateByIdAsync(itemId, entry, impersonated: false))
            itemId = await _keyValueStore.AddAsync(AlertRecipientRules.Key(tenantId), entry, impersonated: false);

        if (existing is not null)
        {
            foreach (var duplicate in existing.ItemIds.Skip(1))
                await _keyValueStore.DeleteByIdAsync(duplicate, impersonated: false);
        }
        return new StoredAlertRecipient(entry, new[] { itemId });
    }

    public async Task RemoveAsync(StoredAlertRecipient existing)
    {
        foreach (var itemId in existing.ItemIds)
            await _keyValueStore.DeleteByIdAsync(itemId, impersonated: false);
    }

    public async Task<IReadOnlyList<AllMonitorsPeople>> GetAllMonitorsPeopleByTenantAsync()
    {
        var items = await _keyValueStore.GetAllByPrefixAsync<AlertRecipientEntry>(AlertRecipientRules.KeyPrefix, impersonated: false);
        return items
            .GroupBy(item => item.Key[AlertRecipientRules.KeyPrefix.Length..], StringComparer.Ordinal)
            .Where(group => group.Key.Length > 0)
            .Select(group => new AllMonitorsPeople(group.Key, AllMonitorsEmails(Merge(group))))
            .Where(tenant => tenant.People.Count > 0)
            .OrderBy(tenant => tenant.TenantId, StringComparer.Ordinal)
            .ToList();
    }

    public async Task<List<string>> GetEmailsForNewMonitorAsync(string? projectKey)
    {
        if (string.IsNullOrWhiteSpace(projectKey))
            return new List<string>();

        var callerTenantId = BlocksContext.GetContext()?.TenantId;
        if (!string.IsNullOrEmpty(callerTenantId) && !string.Equals(callerTenantId, projectKey, StringComparison.Ordinal))
        {
            _logger.LogWarning("Monitor created for project {ProjectKey} by a caller of another project; its \"All monitors\" alert recipients were not added.",
                LogValue.Clean(projectKey));
            return new List<string>();
        }

        string errorType;
        try
        {
            return AllMonitorsEmails(await GetAsync(projectKey));
        }
        catch (Exception ex)
        {
            // Per C20 only the type name leaves the catch, because a driver message may quote the stored data.
            errorType = ex.GetType().Name;
        }

        _logger.LogWarning("Reading the \"All monitors\" alert recipients of project {ProjectKey} failed ({ErrorType}); the monitor is created without recipients.",
            LogValue.Clean(projectKey), errorType);
        return new List<string>();
    }

    /// <summary>The "All monitors" people, sorted, at most 10.</summary>
    public static List<string> AllMonitorsEmails(Dictionary<string, StoredAlertRecipient> people) =>
        people.Values
            .Where(person => person.Entry.AllMonitors)
            .Select(person => person.Entry.Email)
            .Order(StringComparer.Ordinal)
            .Take(AlertRecipientRules.MaxEmailsPerMonitor)
            .ToList();

    /// <summary>Groups documents by normalized email; the latest <c>UpdatedAt</c> wins (then the latest write).</summary>
    public static Dictionary<string, StoredAlertRecipient> Merge(IEnumerable<KeyValueItem<AlertRecipientEntry>> items) =>
        items
            .Where(item => item.Value is not null && !string.IsNullOrWhiteSpace(item.Value.Email))
            .GroupBy(item => AlertRecipientEmail.Normalize(item.Value.Email), StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group =>
            {
                var ordered = group
                    .OrderByDescending(item => item.Value.UpdatedAt)
                    .ThenByDescending(item => item.LastUpdatedDate)
                    .ThenBy(item => item.ItemId, StringComparer.Ordinal)
                    .ToList();
                var winner = ordered[0].Value;
                var entry = new AlertRecipientEntry
                {
                    Email = group.Key,
                    AllMonitors = winner.AllMonitors,
                    UpdatedBy = winner.UpdatedBy,
                    UpdatedAt = winner.UpdatedAt,
                };
                return new StoredAlertRecipient(entry, ordered.Select(item => item.ItemId).ToList());
            }, StringComparer.Ordinal);
}
