using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using DomainService.AlertRecipients.Models;
using DomainService.AlertRecipients.Services;
using FluentAssertions;
using Microsoft.Extensions.Logging;

namespace XUnitTest.AlertRecipients
{
    /// <summary>The people list in the Genesis key-value store, and the create hook's read (H9, C10, Q2).</summary>
    public sealed class AlertRecipientStoreTests : IDisposable
    {
        private const string Key = "monitor:alert-recipients:p1";
        private readonly FakeKeyValueStore _kv = new();
        private readonly CapturingLogger<AlertRecipientStore> _logger = new();

        public AlertRecipientStoreTests() => Caller.Clear();

        public void Dispose() => Caller.Clear();

        private AlertRecipientStore Sut() => new(_kv, _logger);

        private static AlertRecipientEntry Entry(string email, bool all, int hoursAgo = 24) =>
            new() { Email = email, AllMonitors = all, UpdatedAt = DateTime.UtcNow.AddHours(-hoursAgo) };

        [Fact]
        public async Task Get_MergesDuplicates_LatestUpdateWins_WinnerFirst()
        {
            var older = _kv.Add(Key, Entry("Rina@x.com", true, 3));
            var newer = _kv.Add(Key, Entry("rina@x.com", false, 1));
            _kv.Add(Key, new AlertRecipientEntry { Email = " " });
            _kv.Add("monitor:alert-recipients:p2", Entry("other@x.com", true));

            var people = await Sut().GetAsync("p1");

            people.Keys.Should().Equal("rina@x.com");
            people["rina@x.com"].Entry.AllMonitors.Should().BeFalse();
            people["rina@x.com"].ItemIds.Should().Equal(newer, older);
        }

        [Fact]
        public async Task Save_UpdatesTheWinner_AndDeletesTheDuplicates()
        {
            _kv.Add(Key, Entry("rina@x.com", true, 3));
            _kv.Add(Key, Entry("rina@x.com", true, 1));
            var store = Sut();
            var existing = (await store.GetAsync("p1"))["rina@x.com"];

            await store.SaveAsync("p1", Entry("rina@x.com", false, 0), existing);

            _kv.Docs.Should().ContainSingle().Which.Value.AllMonitors.Should().BeFalse();
        }

        [Fact]
        public async Task Save_AddsANewDocument_WhenThePersonIsNew_OrTheirDocumentVanished()
        {
            var store = Sut();
            await store.SaveAsync("p1", Entry("new@x.com", true), null);
            var vanished = new StoredAlertRecipient(Entry("gone@x.com", true), new[] { "missing-id" });
            await store.SaveAsync("p1", Entry("gone@x.com", false), vanished);

            _kv.Docs.Select(d => (d.Key, d.Value.Email)).Should().Equal((Key, "new@x.com"), (Key, "gone@x.com"));
        }

        [Fact]
        public async Task Remove_DeletesEveryDocumentOfThePerson()
        {
            _kv.Add(Key, Entry("rina@x.com", true, 3));
            _kv.Add(Key, Entry("RINA@x.com", true, 1));
            _kv.Add(Key, Entry("ali@x.com", true, 1));
            var store = Sut();

            await store.RemoveAsync((await store.GetAsync("p1"))["rina@x.com"]);

            _kv.Docs.Select(d => d.Value.Email).Should().Equal("ali@x.com");
        }

        [Fact]
        public async Task AllMonitorsByTenant_GroupsByProject_KeepsOnlyAllMonitorsPeople_SortedAndCappedAt10()
        {
            for (var i = 0; i < 12; i++) _kv.Add(Key, Entry($"p{i:D2}@x.com", true));
            _kv.Add(Key, Entry("p00@x.com", false, 0)); // a later "Selected" document wins over p00's "All"
            _kv.Add("monitor:alert-recipients:p2", Entry("sel@x.com", false));
            _kv.Add("monitor:alert-recipients:", Entry("orphan@x.com", true));

            var tenants = await Sut().GetAllMonitorsPeopleByTenantAsync();

            tenants.Select(t => t.TenantId).Should().Equal("p1");
            tenants[0].People.Should().HaveCount(10).And.BeInAscendingOrder(StringComparer.Ordinal).And.NotContain("p00@x.com");
            tenants[0].People[0].Should().Be("p01@x.com");
        }

        [Fact]
        public async Task NewMonitor_GetsTheProjectsAllMonitorsPeople_ForTheCallersOwnProject()
        {
            // H9 / E8.
            Caller.Set("p1");
            _kv.Add(Key, Entry("ops@x.com", true));
            _kv.Add(Key, Entry("ali@x.com", false));

            (await Sut().GetEmailsForNewMonitorAsync("p1")).Should().Equal("ops@x.com");
        }

        [Fact]
        public async Task NewMonitor_WithNoCaller_DriverOrSystemCall_GetsThePeople()
        {
            _kv.Add(Key, Entry("ops@x.com", true));

            (await Sut().GetEmailsForNewMonitorAsync("p1")).Should().Equal("ops@x.com");
        }

        [Fact]
        public async Task Q2_NewMonitorForAnotherProject_GetsNoEmails_AndAWarningWithoutAddresses()
        {
            Caller.Set("p2");
            _kv.Add(Key, Entry("ops@x.com", true));

            var emails = await Sut().GetEmailsForNewMonitorAsync("p1");

            emails.Should().BeEmpty();
            _kv.ImpersonatedFlags.Should().BeEmpty("project p1's people are never read for a p2 caller");
            _logger.Has(LogLevel.Warning, "caller of another project").Should().BeTrue();
            _logger.Lines.Should().NotContain(line => line.Contains('@'));
        }

        [Fact]
        public async Task C10_NewMonitor_WhenTheReadFails_GetsNoEmails_AndAWarning()
        {
            _kv.FailReads = true;

            var emails = await Sut().GetEmailsForNewMonitorAsync("p1");

            emails.Should().BeEmpty();
            _logger.Has(LogLevel.Warning, "the monitor is created without recipients").Should().BeTrue();
            // m4: the failure type only, never the exception (its message may quote the stored data).
            _logger.Has(LogLevel.Warning, "failed (MongoException)").Should().BeTrue();
            _logger.Lines.Should().NotContain(line => line.Contains("kv read failed", StringComparison.Ordinal));
        }

        [Fact]
        public async Task LogForging_TheRequestsProjectKeyIsLoggedWithoutLineBreaks()
        {
            Caller.Set("p2");

            await Sut().GetEmailsForNewMonitorAsync("p1\r\nforged entry");
            Caller.Clear();
            _kv.FailReads = true;
            await Sut().GetEmailsForNewMonitorAsync("p1\nforged entry");

            _logger.Entries.Should().HaveCount(2);
            _logger.Lines.Should().OnlyContain(line => line.Contains("p1forged entry", StringComparison.Ordinal));
            _logger.Lines.Should().NotContain(line => line.Contains('\n') || line.Contains('\r'));
        }

        [Fact]
        public async Task Save_ReturnsThePersonAsStored_WithItsOneDocument()
        {
            var first = await Sut().SaveAsync("p1", Entry("new@x.com", true), null);
            _kv.Add(Key, Entry("new@x.com", true, 48));
            var merged = (await Sut().GetAsync("p1"))["new@x.com"];

            var second = await Sut().SaveAsync("p1", Entry("new@x.com", false, 0), merged);

            first.ItemIds.Should().ContainSingle().Which.Should().Be(_kv.Docs[0].ItemId);
            second.ItemIds.Should().Equal(first.ItemIds);
            second.Entry.AllMonitors.Should().BeFalse();
            KvDocsFor("new@x.com").Should().ContainSingle();
        }

        private List<string> KvDocsFor(string email) => _kv.Docs.Where(d => d.Value.Email == email).Select(d => d.ItemId).ToList();

        [Theory]
        [InlineData(null)]
        [InlineData(" ")]
        public async Task NewMonitor_WithoutAProject_GetsNoEmails(string? projectKey)
        {
            (await Sut().GetEmailsForNewMonitorAsync(projectKey)).Should().BeEmpty();
            _kv.ImpersonatedFlags.Should().BeEmpty();
        }
    }
}
