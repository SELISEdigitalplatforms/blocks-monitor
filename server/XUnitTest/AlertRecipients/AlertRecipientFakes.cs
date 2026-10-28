using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Blocks.Genesis;
using Blocks.Genesis.DataAccess.Rules;
using Blocks.Genesis.Entities.Monitor;
using DomainService.AlertRecipients.Models;
using DomainService.Monitor.Models;
using DomainService.Monitor.Services;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;

namespace XUnitTest.AlertRecipients
{
    /// <summary>
    /// An in-memory MonitorConfigurations collection behind the Alert recipients repository methods, with the same
    /// semantics as the real filters: editable = tenant and effective source type; a write matches only while the
    /// stored Emails equal the list read. Counts every call, and can deny, refuse, fail or change monitors mid-save.
    /// </summary>
    public sealed class FakeMonitorRepo : IMonitorConfigurationRepoService
    {
        public List<MonitorConfiguration> Monitors { get; } = new();
        public int ViewReads, FullReads, MissingReads, EditFilterCalls, BulkWrites, SingleWrites;
        public List<IReadOnlyCollection<string>?> FullReadIds { get; } = new();
        public List<MonitorEmailsUpdate> Checked { get; } = new();
        public List<MonitorEmailsUpdate> Written { get; } = new();
        public bool DenyEditFilter, FailReads;
        /// <summary>Ids the EDIT row filter excludes (their writes match 0).</summary>
        public HashSet<string> EditExcluded { get; } = new();
        /// <summary>Ids the read row filter hides from the conflict re-read.</summary>
        public HashSet<string> HiddenOnReread { get; } = new();
        /// <summary>Ids a data validation rule refuses.</summary>
        public HashSet<string> Refused { get; } = new();
        /// <summary>Runs once, just before the first bulk write (a concurrent writer).</summary>
        public Action<FakeMonitorRepo>? BeforeBulkWrite;
        /// <summary>Runs before every single (retry) write.</summary>
        public Action<FakeMonitorRepo, MonitorEmailsUpdate>? BeforeSingleWrite;
        /// <summary>Runs once, just after the first bulk write (a writer between the bulk write and the re-read).</summary>
        public Action<FakeMonitorRepo>? AfterBulkWrite;
        /// <summary>Shared with other fakes to record the order of writes ("monitors:bulk", "monitors:single").</summary>
        public List<string>? Journal;
        /// <summary>The caller context seen by each read of monitors missing people (the Worker reconciliation).</summary>
        public List<BlocksContext?> MissingReadContexts { get; } = new();

        public static MonitorConfiguration Monitor(string id, string name, string tenant = "p1",
            MonitorConfigurationTypes type = MonitorConfigurationTypes.OutboundPing,
            MonitorSourceTypes? source = MonitorSourceTypes.DeployedServices, MonitorSourceTypes? legacy = null, params string[] emails) =>
            new()
            {
                ItemId = id, Name = name, TenantId = tenant, MonitorConfigurationType = type,
                MonitorSourceType = source, LegacyMonitorSourceType = legacy, IsActive = true, Emails = emails.ToList(),
            };

        public MonitorConfiguration Get(string id) => Monitors.Single(m => m.ItemId == id);

        private static bool Editable(MonitorConfiguration m, string tenant) =>
            m.TenantId == tenant && m.EffectiveMonitorSourceType is not (MonitorSourceTypes.Infrastructure or MonitorSourceTypes.BlocksServices);

        private static MonitorConfiguration Copy(MonitorConfiguration m)
        {
            var copy = Monitor(m.ItemId, m.Name, m.TenantId!, m.MonitorConfigurationType, m.MonitorSourceType, m.LegacyMonitorSourceType);
            copy.IsActive = m.IsActive;
            copy.Emails = m.Emails?.ToList()!;
            return copy;
        }

        private void ThrowIfFailing()
        {
            if (FailReads) throw new MongoException("db down");
        }

        public Task<List<MonitorConfiguration>> GetEditableMonitorsForViewAsync(string tenantId)
        {
            ViewReads++;
            ThrowIfFailing();
            return Task.FromResult(Monitors.Where(m => Editable(m, tenantId)).Select(Copy).ToList());
        }

        public Task<List<MonitorConfiguration>> GetEditableMonitorsAsync(string tenantId, IReadOnlyCollection<string>? itemIds = null)
        {
            FullReads++;
            FullReadIds.Add(itemIds);
            ThrowIfFailing();
            return Task.FromResult(Monitors
                .Where(m => Editable(m, tenantId) && (itemIds is null || (itemIds.Contains(m.ItemId) && !HiddenOnReread.Contains(m.ItemId))))
                .Select(Copy).ToList());
        }

        public Task<List<MonitorConfiguration>> GetEditableMonitorsMissingPeopleAsync(string tenantId, IReadOnlyCollection<string> emails)
        {
            MissingReads++;
            MissingReadContexts.Add(BlocksContext.GetContext());
            ThrowIfFailing();
            return Task.FromResult(Monitors
                .Where(m => Editable(m, tenantId) && !emails.All(e => (m.Emails ?? new List<string>()).Contains(e)))
                .Select(Copy).ToList());
        }

        public Task<FilterDefinition<MonitorConfiguration>?> GetEmailsEditFilterAsync(string tenantId)
        {
            EditFilterCalls++;
            return Task.FromResult(DenyEditFilter ? null : (FilterDefinition<MonitorConfiguration>?)Builders<MonitorConfiguration>.Filter.Empty);
        }

        public Task<IReadOnlyList<MonitorEmailsCheckFailure>> CheckEmailsUpdatesAsync(IReadOnlyList<MonitorEmailsUpdate> updates)
        {
            Checked.AddRange(updates);
            var failures = updates.Where(u => Refused.Contains(u.ItemId))
                .Select(u => new MonitorEmailsCheckFailure(u.ItemId, Failed(u.ItemId))).ToList();
            return Task.FromResult<IReadOnlyList<MonitorEmailsCheckFailure>>(failures);
        }

        public static DataValidationException Failed(string itemId)
        {
            var result = new DataValidationResult();
            result.AddError("Emails", $"Emails of {itemId} are not allowed.", "Custom");
            return new DataValidationException(result);
        }

        public Task<long> BulkUpdateEmailsAsync(IReadOnlyList<MonitorEmailsUpdate> updates, FilterDefinition<MonitorConfiguration> editFilter)
        {
            BulkWrites++;
            Journal?.Add("monitors:bulk");
            var hook = BeforeBulkWrite;
            BeforeBulkWrite = null;
            hook?.Invoke(this);
            var matched = (long)updates.Count(Apply);
            var after = AfterBulkWrite;
            AfterBulkWrite = null;
            after?.Invoke(this);
            return Task.FromResult(matched);
        }

        public Task<bool> UpdateEmailsAsync(MonitorEmailsUpdate update, FilterDefinition<MonitorConfiguration> editFilter)
        {
            lock (this)
            {
                SingleWrites++;
                Journal?.Add("monitors:single");
                BeforeSingleWrite?.Invoke(this, update);
                return Task.FromResult(Apply(update));
            }
        }

        private bool Apply(MonitorEmailsUpdate update)
        {
            var stored = Monitors.SingleOrDefault(m => m.ItemId == update.ItemId);
            if (stored is null || EditExcluded.Contains(update.ItemId)) return false;
            var previous = update.PreviousEmails ?? new List<string>();
            if (!(stored.Emails ?? new List<string>()).SequenceEqual(previous)) return false;
            stored.Emails = update.NewEmails.ToList();
            stored.LastUpdatedBy = update.UpdatedBy;
            Written.Add(update);
            return true;
        }

        // ---- Not used by the Alert recipients code. ----
        public Task<MonitorConfiguration?> GetConfigurationAsync(string itemId) => throw new NotSupportedException();
        public Task<MonitorConfiguration?> GetConfigurationForViewAsync(string itemId) => throw new NotSupportedException();
        public Task<(List<MonitorConfiguration> Items, int TotalCount)> GetConfigurationListAsync(string tenantId, string? monitorSourceType, int pageNumber, int pageSize, string? sortProperty = null, bool sortIsDescending = false) => throw new NotSupportedException();
        public Task<List<MonitorConfiguration>> GetConfigurationListByTenantIdAsync(string tenantId) => throw new NotSupportedException();
        public Task<List<MonitorConfiguration>> GetConfigurationListByRepoIdAsync(string tenantId, string repoId) => throw new NotSupportedException();
        public Task<List<MonitorConfiguration>> GetAllConfigurationListAsync() => throw new NotSupportedException();
        public Task<bool> SaveConfigurationAsync(MonitorConfiguration monitorConfiguration) => throw new NotSupportedException();
        public Task<bool> UpdateConfigurationAsync(MonitorConfiguration monitorConfiguration) => throw new NotSupportedException();
        public Task<bool> UpdateConfigurationIncidentAsync(MonitorConfigurationIncidentUpdate monitorConfigurationUpdate) => throw new NotSupportedException();
        public Task<bool> DeleteConfigurationAsync(string itemId) => throw new NotSupportedException();
        public Task<MonitorConfiguration> GetByUrlAsync(string url) => throw new NotSupportedException();
        public Task<MonitorConfiguration?> GetExternalServiceConfigurationAsync(string externalServiceId) => throw new NotSupportedException();
    }

    /// <summary>An in-memory Genesis key-value store (multi-value API only), with switchable failures.</summary>
    public sealed class FakeKeyValueStore : IKeyValueStore
    {
        private sealed record Doc(string ItemId, string Key, AlertRecipientEntry Value, DateTime LastUpdated);

        private readonly List<Doc> _docs = new();
        private int _next;
        public bool FailReads, FailAdd, FailUpdate, FailDelete;
        public List<bool> ImpersonatedFlags { get; } = new();
        /// <summary>Shared with other fakes to record the order of writes ("kv:add", "kv:update", "kv:delete").</summary>
        public List<string>? Journal;
        /// <summary>Runs once, just after the next successful add (a concurrent writer).</summary>
        public Action<FakeKeyValueStore>? AfterNextAdd;

        public string Add(string key, AlertRecipientEntry value)
        {
            var id = $"kv{++_next}";
            _docs.Add(new Doc(id, key, Clone(value), DateTime.UtcNow.AddTicks(_next)));
            return id;
        }

        public IReadOnlyList<(string ItemId, string Key, AlertRecipientEntry Value)> Docs =>
            _docs.Select(d => (d.ItemId, d.Key, Clone(d.Value))).ToList();

        private static AlertRecipientEntry Clone(AlertRecipientEntry e) =>
            new() { Email = e.Email, AllMonitors = e.AllMonitors, UpdatedBy = e.UpdatedBy, UpdatedAt = e.UpdatedAt };

        private static KeyValueItem<T> Item<T>(Doc d) =>
            new(d.ItemId, d.Key, (T)(object)Clone(d.Value), Array.Empty<string>(), d.LastUpdated, d.LastUpdated, null, null, "default");

        public Task<string> AddAsync<T>(string key, T value, IEnumerable<string>? tags = null, bool impersonated = true, CancellationToken cancellationToken = default)
        {
            ImpersonatedFlags.Add(impersonated);
            if (FailAdd) throw new MongoException("kv add failed");
            Journal?.Add("kv:add");
            var id = Add(key, (AlertRecipientEntry)(object)value!);
            var hook = AfterNextAdd;
            AfterNextAdd = null;
            hook?.Invoke(this);
            return Task.FromResult(id);
        }

        public Task<IReadOnlyList<KeyValueItem<T>>> GetAllAsync<T>(string key, IEnumerable<string>? tags = null, bool impersonated = true, CancellationToken cancellationToken = default)
        {
            ImpersonatedFlags.Add(impersonated);
            if (FailReads) throw new MongoException("kv read failed");
            return Task.FromResult<IReadOnlyList<KeyValueItem<T>>>(_docs.Where(d => d.Key == key).Select(Item<T>).ToList());
        }

        public Task<IReadOnlyList<KeyValueItem<T>>> GetAllByPrefixAsync<T>(string prefix, IEnumerable<string>? tags = null, bool impersonated = true, CancellationToken cancellationToken = default)
        {
            ImpersonatedFlags.Add(impersonated);
            if (FailReads) throw new MongoException("kv read failed");
            return Task.FromResult<IReadOnlyList<KeyValueItem<T>>>(_docs.Where(d => d.Key.StartsWith(prefix, StringComparison.Ordinal)).Select(Item<T>).ToList());
        }

        public Task<bool> UpdateByIdAsync<T>(string itemId, T value, bool impersonated = true, CancellationToken cancellationToken = default)
        {
            ImpersonatedFlags.Add(impersonated);
            if (FailUpdate) throw new MongoException("kv update failed");
            Journal?.Add("kv:update");
            var index = _docs.FindIndex(d => d.ItemId == itemId);
            if (index < 0) return Task.FromResult(false);
            _docs[index] = _docs[index] with { Value = Clone((AlertRecipientEntry)(object)value!), LastUpdated = DateTime.UtcNow };
            return Task.FromResult(true);
        }

        public Task<bool> DeleteByIdAsync(string itemId, bool impersonated = true, CancellationToken cancellationToken = default)
        {
            ImpersonatedFlags.Add(impersonated);
            if (FailDelete) throw new MongoException("kv delete failed");
            Journal?.Add("kv:delete");
            return Task.FromResult(_docs.RemoveAll(d => d.ItemId == itemId) > 0);
        }

        public Task<KeyValueItem<T>?> GetByIdAsync<T>(string itemId, bool impersonated = true, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<T?> GetAsync<T>(string key, bool impersonated = true, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<T>> GetByPrefixAsync<T>(string prefix, bool impersonated = true, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task SetAsync<T>(string key, T value, bool impersonated = true, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<bool> DeleteAsync(string key, bool impersonated = true, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<bool> ExistsAsync(string key, bool impersonated = true, CancellationToken cancellationToken = default) => throw new NotSupportedException();
        public Task<long> DeleteAllAsync(string key, bool impersonated = true, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }

    /// <summary>Keeps every log line (formatted message and exception text), so tests can assert no email reaches a log (C20).</summary>
    public sealed class CapturingLogger<T> : ILogger<T>
    {
        public ConcurrentQueue<(LogLevel Level, string Text)> Entries { get; } = new();

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;
        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            var text = formatter(state, exception);
            if (state is IEnumerable<KeyValuePair<string, object?>> values)
                text += " " + string.Join(" ", values.Select(v => $"{v.Key}={v.Value}"));
            if (exception is not null)
                text += " " + exception;
            Entries.Enqueue((logLevel, text));
        }

        public IEnumerable<string> Lines => Entries.Select(e => e.Text);

        public bool Has(LogLevel level, string fragment) => Entries.Any(e => e.Level == level && e.Text.Contains(fragment, StringComparison.Ordinal));
    }

    public static class Caller
    {
        public static void Set(string tenantId, string userId = "user-1") =>
            BlocksContext.SetContext(BlocksContext.Create(
                tenantId, null, userId, true, null, null, DateTime.UtcNow.AddHours(1), null, null, null, null, null, null, tenantId));

        public static void Clear() => BlocksContext.SetContext(null);
    }
}
