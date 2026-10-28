using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using Blocks.Genesis;
using Blocks.Genesis.Entities.Monitor;
using DomainService.Alert.Entities;
using DomainService.Alert.Services;
using DomainService.AlertRecipients.Models;
using DomainService.AlertRecipients.Services;
using DomainService.Health.Services;
using DomainService.Shared.Entity;
using DomainService.Shared.Models;
using DomainService.Shared.Utilities;
using DomainService.Validators;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;
using XUnitTest.Utilities;

namespace XUnitTest.AlertRecipients
{
    /// <summary>
    /// The Alert recipients service against in-memory monitors and key-value documents. The fixture is the spec's
    /// (§7): tenant p1; editable m1 "api" (HTTP, ops + ali), m2 "web" (HTTP, ops), h1 "worker" (heartbeat, none);
    /// Blocks-services b1 (ops); ops stored with "All monitors". The caller is p1.
    /// </summary>
    public sealed class AlertRecipientServiceTests : IDisposable
    {
        private const string Key = "monitor:alert-recipients:p1";
        private readonly FakeMonitorRepo _repo = new();
        private readonly FakeKeyValueStore _kv = new();
        private readonly Mock<IMessageClient> _messages = new();
        private readonly Mock<HealthCheckService> _health = new(null!, null!, null!, null!, 1);
        private readonly CapturingLogger<AlertRecipientService> _logger = new();
        private readonly CapturingLogger<AlertRecipientStore> _storeLogger = new();
        private readonly List<ProjectPeople> _members = new();

        public AlertRecipientServiceTests()
        {
            Caller.Set("p1");
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("m1", "api", emails: new[] { "ops@x.com", "ali@x.com" }));
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("m2", "web", emails: new[] { "ops@x.com" }));
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("h1", "worker", type: MonitorConfigurationTypes.InboundPing));
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("b1", "identity", source: MonitorSourceTypes.BlocksServices, emails: new[] { "ops@x.com" }));
            _kv.Add(Key, Entry("ops@x.com", true));
            _health.Setup(h => h.LoadMonitorsFromDatabaseAsync()).Returns(Task.CompletedTask);
        }

        public void Dispose() => Caller.Clear();

        private static AlertRecipientEntry Entry(string email, bool all, DateTime? at = null) =>
            new() { Email = email, AllMonitors = all, UpdatedBy = "u", UpdatedAt = at ?? DateTime.UtcNow.AddDays(-1) };

        private AlertRecipientService Sut() =>
            new(_repo, new AlertRecipientStore(_kv, _storeLogger), Sut_AlertRepo(), _messages.Object,
                _health.Object, new SaveAlertRecipientRequestValidator(), _logger);

        private AlertRepoService Sut_AlertRepo()
        {
            var people = MongoMocks.Collection(_members);
            MongoMocks.SetupProjectedFind<ProjectPeople, ProjectPeople>(people, _members);
            var db = new MongoMocks.DbBuilder().With(people).With(new List<EmailTemplate>()).With(new List<MailServerConfiguration>());
            return new AlertRepoService(db.Provider, MongoMocks.BlocksSecret().Object);
        }

        private static SaveAlertRecipientRequest All(string email, string project = "p1") =>
            new() { ProjectKey = project, Email = email, AllMonitors = true };

        private static SaveAlertRecipientRequest Selected(string email, params string[] ids) =>
            new() { ProjectKey = "p1", Email = email, MonitorIds = ids.ToList() };

        private static DeleteAlertRecipientRequest Remove(string email, string project = "p1") => new() { ProjectKey = project, Email = email };

        private async Task<AlertRecipientsResponse> GetData()
        {
            var response = await Sut().GetAsync("p1");
            response.IsSuccess.Should().BeTrue();
            return response.Data.Should().BeOfType<AlertRecipientsResponse>().Subject;
        }

        private static AlertRecipientChangeResult Change(BaseApiResponse response) =>
            response.Data.Should().BeOfType<AlertRecipientChangeResult>().Subject;

        private void QueueMessages(int times) =>
            _messages.Verify(m => m.SendToConsumerAsync(It.IsAny<ConsumerMessage<MonitorConfigurationUpdateQueue>>()), Times.Exactly(times));

        private void HealthReloads(int times) => _health.Verify(h => h.LoadMonitorsFromDatabaseAsync(), Times.Exactly(times));

        private List<(string ItemId, string Key, AlertRecipientEntry Value)> KvFor(string email) =>
            _kv.Docs.Where(d => d.Value.Email == email).ToList();

        private void NoEmailInAnyLog()
        {
            _logger.Lines.Concat(_storeLogger.Lines).Should().NotContain(line => line.Contains('@'), "C20: no email address is ever logged");
        }

        // ---------------------------------------------------------------- GET

        [Fact]
        public async Task Get_E1_ListsEditableMonitorsAndRecipients()
        {
            var data = await GetData();

            data.MaxEmailsPerMonitor.Should().Be(10);
            data.Monitors.Select(m => (m.ItemId, m.Name, m.Kind, m.EmailCount, m.IsActive)).Should().Equal(
                ("m1", "api", "HttpCheck", 2, true), ("m2", "web", "HttpCheck", 1, true), ("h1", "worker", "Heartbeat", 0, true));
            data.Recipients.Should().HaveCount(2);
            data.Recipients[0].Should().BeEquivalentTo(new AlertRecipient { Email = "ali@x.com", AllMonitors = false, AllMonitorsChoice = false, MonitorIds = { "m1" } });
            // Stored as "All monitors" but not on h1: shown as two monitors, the stored choice still reported (Q4).
            data.Recipients[1].Should().BeEquivalentTo(new AlertRecipient { Email = "ops@x.com", AllMonitors = false, AllMonitorsChoice = true, MonitorIds = { "m1", "m2" } });
            data.MonitorsWithoutRecipients.Should().Equal("h1");
        }

        [Fact]
        public async Task Get_AllMonitorsIsTrue_WhenTheStoredChoiceCoversEveryMonitor_AndAStoredPersonOnNoMonitorIsListed()
        {
            _repo.Get("h1").Emails.Add("ops@x.com");
            _kv.Add(Key, Entry("zed@x.com", false));

            var data = await GetData();

            data.Recipients.Single(r => r.Email == "ops@x.com").AllMonitors.Should().BeTrue();
            var zed = data.Recipients.Single(r => r.Email == "zed@x.com");
            zed.MonitorIds.Should().BeEmpty();
            zed.AllMonitors.Should().BeFalse();
            data.MonitorsWithoutRecipients.Should().BeEmpty();
        }

        [Fact]
        public async Task Get_WithNoEditableMonitors_StoredAllPeopleCountAsAllMonitors()
        {
            _repo.Monitors.RemoveAll(m => m.ItemId != "b1");

            var data = await GetData();

            data.Monitors.Should().BeEmpty();
            data.Recipients.Should().ContainSingle().Which.AllMonitors.Should().BeTrue();
        }

        [Fact]
        public async Task Get_SortsCaseInsensitively_AndShowsVariantsNormalized()
        {
            // Q7: GET shows the normalized email; the stored spelling is untouched.
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("m0", "Alpha", emails: new[] { " OPS@X.com ", "Bob@x.com" }));
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("m9", "zeta", type: MonitorConfigurationTypes.InboundPing, emails: new[] { "" }));

            var data = await GetData();

            data.Monitors.Select(m => m.Name).Should().Equal("Alpha", "api", "web", "worker", "zeta");
            data.Recipients.Select(r => r.Email).Should().Equal("ali@x.com", "bob@x.com", "ops@x.com");
            data.Recipients.Single(r => r.Email == "ops@x.com").MonitorIds.Should().Equal("m0", "m1", "m2");
            data.MonitorsWithoutRecipients.Should().Equal("h1", "m9");
            _repo.Get("m0").Emails.Should().Equal(" OPS@X.com ", "Bob@x.com");
        }

        [Fact]
        public async Task Get_ShowsOneRowForDuplicateDocuments_LatestUpdateWins()
        {
            // C19.
            _kv.Add(Key, Entry("rina@x.com", true, DateTime.UtcNow.AddHours(-2)));
            _kv.Add(Key, Entry("Rina@x.com", false, DateTime.UtcNow.AddHours(-1)));

            var data = await GetData();

            data.Recipients.Where(r => r.Email == "rina@x.com").Should().ContainSingle().Which.AllMonitorsChoice.Should().BeFalse();
        }

        [Theory]
        [InlineData("p2")]
        [InlineData("")]
        [InlineData(null)]
        [InlineData("P1")]
        public async Task Get_ForAnotherProject_IsProjectNotFound_WithNoReads(string? projectKey)
        {
            // E9 / C4: no reads of the other project and no data.
            var response = await Sut().GetAsync(projectKey);

            response.IsSuccess.Should().BeFalse();
            response.Message.Should().Be("Project not found.");
            response.Data.Should().BeNull();
            _repo.ViewReads.Should().Be(0);
            _kv.ImpersonatedFlags.Should().BeEmpty();
        }

        [Fact]
        public async Task Get_WithoutACallerTenant_IsProjectNotFound()
        {
            Caller.Clear();

            (await Sut().GetAsync("p1")).Message.Should().Be("Project not found.");
            (await Sut().GetSuggestionsAsync("p1")).Message.Should().Be("Project not found.");
            (await Sut().SaveAsync(All("a@x.com"))).Message.Should().Be("Project not found.");
            (await Sut().DeleteAsync(Remove("a@x.com"))).Message.Should().Be("Project not found.");
        }

        [Fact]
        public async Task Get_ReadsTheKeyValueStoreInTheRootDatabase()
        {
            await GetData();

            _kv.ImpersonatedFlags.Should().NotBeEmpty().And.OnlyContain(flag => flag == false);
        }

        [Theory]
        [InlineData(true)]
        [InlineData(false)]
        public async Task Get_WhenAReadFails_ReturnsAnErrorAndNoList(bool monitorsFail)
        {
            // The new repository reads fail loudly: an outage is never "Add a monitor first." (C17).
            _repo.FailReads = monitorsFail;
            _kv.FailReads = !monitorsFail;

            var response = await Sut().GetAsync("p1");

            response.IsSuccess.Should().BeFalse();
            response.Message.Should().Be("Could not load alert recipients. Try again.");
            response.Data.Should().BeNull();
            _logger.Has(LogLevel.Error, monitorsFail ? "MongoException" : "MongoException").Should().BeTrue();
            NoEmailInAnyLog();
        }

        // ---------------------------------------------------------------- Suggestions

        [Fact]
        public async Task Suggestions_AreMembersNotYetRecipients_NormalizedDistinctSorted()
        {
            // H14.
            foreach (var email in new[] { "zz@x.com", " NEW@x.com", "new@x.com", "Ops@X.com", "ali@x.com", "bad@", "" })
                _members.Add(new ProjectPeople { TenantId = "p1", Email = email });

            var response = await Sut().GetSuggestionsAsync("p1");

            response.IsSuccess.Should().BeTrue();
            response.Data.Should().BeOfType<AlertRecipientSuggestionsResponse>()
                .Which.MemberEmails.Should().Equal("new@x.com", "zz@x.com");
        }

        [Fact]
        public async Task Suggestions_AreAtMost50()
        {
            for (var i = 0; i < 60; i++)
                _members.Add(new ProjectPeople { TenantId = "p1", Email = $"member{i:D2}@x.com" });

            var emails = ((AlertRecipientSuggestionsResponse)(await Sut().GetSuggestionsAsync("p1")).Data).MemberEmails;

            emails.Should().HaveCount(50).And.BeInAscendingOrder(StringComparer.Ordinal);
            emails[0].Should().Be("member00@x.com");
        }

        [Fact]
        public async Task Suggestions_ForAnotherProject_AreProjectNotFound()
        {
            var response = await Sut().GetSuggestionsAsync("p2");

            response.Message.Should().Be("Project not found.");
            response.Data.Should().BeNull();
        }

        [Fact]
        public async Task Suggestions_WhenAReadFails_ReturnAnError()
        {
            _kv.FailReads = true;

            var response = await Sut().GetSuggestionsAsync("p1");

            response.IsSuccess.Should().BeFalse();
            response.Message.Should().Be("Could not load alert recipients. Try again.");
        }

        // ---------------------------------------------------------------- Save

        [Fact]
        public async Task Save_E2_AllMonitors_AddsTheNormalizedEmailOnlyWhereMissing()
        {
            // E2, H4, H16, H11: only a heartbeat changed -> no queue message, one health reload.
            var response = await Sut().SaveAsync(All(" OPS@x.com "));

            response.IsSuccess.Should().BeTrue();
            var result = Change(response);
            (result.Email, result.AllMonitors, result.Added, result.Removed, result.Unchanged).Should().Be(("ops@x.com", true, 1, 0, 2));
            result.SkippedFull.Should().BeEmpty();
            _repo.Get("h1").Emails.Should().Equal("ops@x.com");
            _repo.Get("m1").Emails.Should().Equal("ops@x.com", "ali@x.com");
            _repo.Get("m2").Emails.Should().Equal("ops@x.com");
            _repo.Get("b1").Emails.Should().Equal("ops@x.com");
            QueueMessages(0);
            HealthReloads(1);
            response.Message.Should().Be("Added to 1 monitor.");
            (await GetData()).Recipients.Single(r => r.Email == "ops@x.com").AllMonitors.Should().BeTrue();
            KvFor("ops@x.com").Should().ContainSingle().Which.Value.AllMonitors.Should().BeTrue();
        }

        [Fact]
        public async Task Save_E3_SelectedMonitors_AddsOnlyToThem_AndSendsOneRefreshMessage()
        {
            // E3, H5, H11.
            var response = await Sut().SaveAsync(Selected("rina@x.com", "m2"));

            var result = Change(response);
            result.Added.Should().Be(1);
            _repo.Get("m2").Emails.Should().Equal("ops@x.com", "rina@x.com");
            _repo.Get("m1").Emails.Should().NotContain("rina@x.com");
            _repo.Get("h1").Emails.Should().BeEmpty();
            var stored = KvFor("rina@x.com").Should().ContainSingle().Subject;
            stored.Key.Should().Be(Key);
            stored.Value.AllMonitors.Should().BeFalse();
            stored.Value.UpdatedBy.Should().Be("user-1");
            _repo.Get("m2").LastUpdatedBy.Should().Be("user-1");
            _messages.Verify(m => m.SendToConsumerAsync(It.Is<ConsumerMessage<MonitorConfigurationUpdateQueue>>(
                msg => msg.ConsumerName == MonitorConstants.MonitorConfigurationUpdateQueue && msg.Payload.MonitorId == "m2")), Times.Once);
            HealthReloads(0);
        }

        [Fact]
        public async Task Save_ChangingHttpChecksAndAHeartbeat_RefreshesEachCacheExactlyOnce()
        {
            // H11 with 2 HTTP checks and 1 heartbeat changed.
            await Sut().SaveAsync(All("new@x.com"));

            QueueMessages(1);
            HealthReloads(1);
        }

        [Theory]
        [InlineData("rina@")]
        [InlineData("   ")]
        [InlineData(null)]
        public async Task Save_E4_InvalidEmail_IsRefusedWithNoReadsOrWrites(string? email)
        {
            // E4, C1.
            var response = await Sut().SaveAsync(new SaveAlertRecipientRequest { ProjectKey = "p1", Email = email, AllMonitors = true });

            response.IsSuccess.Should().BeFalse();
            response.Message.Should().Be("Enter a valid email address.");
            _repo.FullReads.Should().Be(0);
            _repo.Written.Should().BeEmpty();
        }

        [Fact]
        public async Task Save_E5_SelectedWithNoMonitor_IsRefused()
        {
            var response = await Sut().SaveAsync(Selected("rina@x.com"));

            response.Message.Should().Be("Choose at least one monitor.");
            _repo.Written.Should().BeEmpty();
        }

        [Fact]
        public async Task Save_501MonitorIds_IsRefused()
        {
            var response = await Sut().SaveAsync(Selected("rina@x.com", Enumerable.Range(0, 501).Select(i => $"m{i}").ToArray()));

            response.Message.Should().Be("Too many monitors in one request.");
            _repo.FullReads.Should().Be(0);
        }

        [Theory]
        [InlineData("b1")] // Blocks services (E6)
        [InlineData("i1")] // Infrastructure
        [InlineData("l1")] // legacy MonitorSourcetypes = BlocksServices, MonitorSourceType null
        [InlineData("x1")] // another project's monitor
        [InlineData("nope")] // unknown
        [InlineData("")]
        public async Task Save_E6_AMonitorThatIsNotAnEditableMonitorOfTheProject_IsNotFound(string id)
        {
            // E6, C3, C12: first offending id; nothing written, key-value untouched.
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("i1", "infra", tenant: "platform", source: MonitorSourceTypes.Infrastructure));
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("l1", "legacy", source: null, legacy: MonitorSourceTypes.BlocksServices));
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("x1", "other", tenant: "p2"));
            var kvBefore = _kv.Docs.Count;

            var response = await Sut().SaveAsync(Selected("rina@x.com", "m1", id, "m2"));

            response.IsSuccess.Should().BeFalse();
            response.Message.Should().Be("Monitor not found: " + id);
            _repo.Written.Should().BeEmpty();
            _kv.Docs.Should().HaveCount(kvBefore);
        }

        [Fact]
        public async Task Save_LegacyEditableSourceType_IsEditable()
        {
            // A monitor with only the legacy field set to an editable type is editable.
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("l2", "legacy-ext", source: null, legacy: MonitorSourceTypes.ExternalServices));

            var response = await Sut().SaveAsync(Selected("rina@x.com", "l2"));

            Change(response).Added.Should().Be(1);
        }

        [Fact]
        public async Task Save_AllMonitors_NeverTouchesBlocksServicesOrInfrastructure()
        {
            // C12.
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("i1", "infra", source: MonitorSourceTypes.Infrastructure));

            await Sut().SaveAsync(All("rina@x.com"));
            await Sut().DeleteAsync(Remove("ops@x.com"));

            _repo.Get("b1").Emails.Should().Equal("ops@x.com");
            _repo.Get("i1").Emails.Should().BeEmpty();
            _repo.Written.Select(w => w.ItemId).Should().NotContain(new[] { "b1", "i1" });
        }

        [Fact]
        public async Task Save_E11_AFullMonitorIsSkippedAndReported()
        {
            // E11, C6: the 10-emails-per-monitor limit.
            _repo.Get("m2").Emails = Enumerable.Range(0, 10).Select(i => $"p{i}@x.com").ToList();

            var response = await Sut().SaveAsync(All("zed@x.com"));

            response.IsSuccess.Should().BeTrue();
            response.Message.Should().Be("Added to 2 monitors. 1 skipped: already has 10 recipients.");
            var result = Change(response);
            result.Added.Should().Be(2);
            result.SkippedFull.Should().Equal(new AlertRecipientMonitorRef("m2", "web"));
            _repo.Get("m2").Emails.Should().HaveCount(10).And.NotContain("zed@x.com");
            _repo.Get("m1").Emails.Should().Contain("zed@x.com");
            _repo.Get("h1").Emails.Should().Equal("zed@x.com");
        }

        [Fact]
        public async Task Save_NineEmailsStillHaveRoom()
        {
            _repo.Get("m2").Emails = Enumerable.Range(0, 9).Select(i => $"p{i}@x.com").ToList();

            var result = Change(await Sut().SaveAsync(Selected("zed@x.com", "m2")));

            result.Added.Should().Be(1);
            _repo.Get("m2").Emails.Should().HaveCount(10).And.EndWith("zed@x.com");
        }

        [Fact]
        public async Task Save_C13_LegacyListOver10_IsNeitherTrimmedNorAddedTo_ButAllowsRemoval()
        {
            var legacy = Enumerable.Range(0, 11).Select(i => $"l{i}@x.com").ToList();
            _repo.Get("m1").Emails = new List<string>(legacy);
            _repo.Get("m2").Emails = new List<string>(legacy) { "rina@x.com" };

            var added = Change(await Sut().SaveAsync(Selected("zed@x.com", "m1")));
            added.SkippedFull.Should().ContainSingle().Which.ItemId.Should().Be("m1");
            _repo.Get("m1").Emails.Should().Equal(legacy);

            var removed = (AlertRecipientRemoveResult)(await Sut().DeleteAsync(Remove("rina@x.com"))).Data;
            removed.Removed.Should().Be(1);
            _repo.Get("m2").Emails.Should().Equal(legacy);
        }

        [Fact]
        public async Task Save_E12_An11thAllMonitorsPerson_IsRefused()
        {
            // E12, C7: the 10 "All monitors" people limit (ops is one of them).
            for (var i = 1; i < 10; i++) _kv.Add(Key, Entry($"all{i}@x.com", true));
            var before = _kv.Docs.Count;

            var response = await Sut().SaveAsync(All("eleventh@x.com"));

            response.IsSuccess.Should().BeFalse();
            response.Message.Should().Be("At most 10 people can get alerts for all monitors.");
            _repo.Written.Should().BeEmpty();
            _kv.Docs.Should().HaveCount(before);
        }

        [Fact]
        public async Task Save_TheTenthAllMonitorsPerson_AndResavingOneOfTen_AreAllowed()
        {
            for (var i = 1; i < 9; i++) _kv.Add(Key, Entry($"all{i}@x.com", true));

            (await Sut().SaveAsync(All("tenth@x.com"))).IsSuccess.Should().BeTrue();
            (await Sut().SaveAsync(All("OPS@x.com"))).IsSuccess.Should().BeTrue();
            // A Selected save is never limited by the "All monitors" count.
            (await Sut().SaveAsync(Selected("other@x.com", "m1"))).IsSuccess.Should().BeTrue();
        }

        [Fact]
        public async Task Save_H6_FromAllToASubset_RemovesTheRest_AndStoresTheChoice()
        {
            _repo.Get("h1").Emails.Add("ops@x.com");

            var response = await Sut().SaveAsync(Selected("ops@x.com", "m1"));

            var result = Change(response);
            (result.Added, result.Removed, result.Unchanged).Should().Be((0, 2, 1));
            response.Message.Should().Be("Removed from 2 monitors.");
            _repo.Get("m1").Emails.Should().Equal("ops@x.com", "ali@x.com");
            _repo.Get("m2").Emails.Should().BeEmpty();
            _repo.Get("h1").Emails.Should().BeEmpty();
            _repo.Get("b1").Emails.Should().Equal("ops@x.com");
            KvFor("ops@x.com").Should().ContainSingle().Which.Value.AllMonitors.Should().BeFalse();
        }

        [Fact]
        public async Task Save_C14_SavingTheSameRequestTwice_ChangesNothingTheSecondTime()
        {
            await Sut().SaveAsync(Selected("rina@x.com", "m2"));
            var writes = _repo.Written.Count;

            var second = await Sut().SaveAsync(Selected("rina@x.com", "m2"));

            var result = Change(second);
            (result.Added, result.Removed, result.Unchanged).Should().Be((0, 0, 1));
            second.Message.Should().Be("No monitor needed a change.");
            _repo.Written.Should().HaveCount(writes);
            KvFor("rina@x.com").Should().ContainSingle();
            QueueMessages(1);
        }

        [Fact]
        public async Task Save_Q7_AVariantCountsAsPresent_AndOtherEmailsAreNeverRewritten()
        {
            _repo.Get("m2").Emails = new List<string> { "z@x.com", " Rina@X.com", "a@x.com" };

            var result = Change(await Sut().SaveAsync(Selected("rina@x.com", "m1", "m2")));

            (result.Added, result.Unchanged).Should().Be((1, 1));
            _repo.Get("m2").Emails.Should().Equal("z@x.com", " Rina@X.com", "a@x.com");
            _repo.Get("m1").Emails.Should().Equal("ops@x.com", "ali@x.com", "rina@x.com");
        }

        [Fact]
        public async Task Save_WritesOnlyEmailsWithTheListItRead()
        {
            // The optimistic filter's input: each update carries the Emails exactly as read, and the new list.
            await Sut().SaveAsync(Selected("rina@x.com", "m1"));

            var update = _repo.Written.Should().ContainSingle().Subject;
            update.ItemId.Should().Be("m1");
            update.PreviousEmails.Should().Equal("ops@x.com", "ali@x.com");
            update.NewEmails.Should().Equal("ops@x.com", "ali@x.com", "rina@x.com");
        }

        [Fact]
        public async Task Save_C8_AConcurrentChangeIsReReadAndRetriedOnce_WithoutOverwritingIt()
        {
            _repo.BeforeBulkWrite = repo => repo.Get("m2").Emails.Add("late@x.com");

            var result = Change(await Sut().SaveAsync(All("rina@x.com")));

            result.Added.Should().Be(3);
            result.Conflicted.Should().BeEmpty();
            _repo.Get("m2").Emails.Should().Equal("ops@x.com", "late@x.com", "rina@x.com");
            _repo.BulkWrites.Should().Be(1);
            _repo.FullReads.Should().Be(2, "one read, then one re-read of the monitors that matched fewer than sent");
            _repo.FullReadIds[1].Should().BeEquivalentTo("m1", "m2", "h1");
            _repo.SingleWrites.Should().Be(1);
        }

        [Fact]
        public async Task Save_C8_AMonitorThatStillDiffersAfterTheRetry_IsConflictedAndKeepsTheOtherWritersList()
        {
            _repo.BeforeBulkWrite = repo => repo.Get("m2").Emails.Add("late@x.com");
            _repo.BeforeSingleWrite = (repo, _) => repo.Get("m2").Emails.Add("later@x.com");

            var response = await Sut().SaveAsync(All("rina@x.com"));

            var result = Change(response);
            result.Conflicted.Should().Equal(new AlertRecipientMonitorRef("m2", "web"));
            result.Added.Should().Be(2);
            response.Message.Should().Be("Added to 2 monitors. 1 not updated: changed by someone else at the same time. Try again.");
            _repo.Get("m2").Emails.Should().Equal("ops@x.com", "late@x.com", "later@x.com");
        }

        [Fact]
        public async Task Save_AfterTheReRead_AMonitorAlreadyChangedTheSameWay_CountsAsDone()
        {
            // Another save added the same person meanwhile: the re-read shows the wanted list (applied) or the
            // re-plan finds the person present (unchanged); either way no retry write.
            _repo.BeforeBulkWrite = repo =>
            {
                repo.Get("m1").Emails.Add("rina@x.com");
                repo.Get("h1").Emails.AddRange(new[] { "x@x.com", "rina@x.com" });
            };

            var result = Change(await Sut().SaveAsync(All("rina@x.com")));

            // m1 now holds exactly the wanted list (applied, counted as added); h1 holds the person (unchanged).
            (result.Added, result.Unchanged).Should().Be((2, 1));
            _repo.SingleWrites.Should().Be(0);
        }

        [Fact]
        public async Task Save_AfterTheReRead_AMonitorThatBecameFull_IsSkipped()
        {
            _repo.BeforeBulkWrite = repo => repo.Get("m2").Emails = Enumerable.Range(0, 10).Select(i => $"p{i}@x.com").ToList();

            var result = Change(await Sut().SaveAsync(All("rina@x.com")));

            result.SkippedFull.Should().ContainSingle().Which.ItemId.Should().Be("m2");
            _repo.SingleWrites.Should().Be(0);
        }

        [Fact]
        public async Task Save_Q1_AMonitorTheEditRowFilterExcludes_IsConflictedIfVisible_DeniedIfNot()
        {
            _repo.EditExcluded.UnionWith(new[] { "m1", "m2" });
            _repo.HiddenOnReread.Add("m2");

            var response = await Sut().SaveAsync(All("rina@x.com"));

            var result = Change(response);
            result.Conflicted.Select(m => m.ItemId).Should().Equal("m1");
            result.Denied.Select(m => m.ItemId).Should().Equal("m2");
            result.Added.Should().Be(1);
            response.Message.Should().EndWith("1 not updated: you can't edit it.");
            _repo.Get("m1").Emails.Should().NotContain("rina@x.com");
        }

        [Fact]
        public async Task Save_WhenTheCallerMayEditNone_EveryChangeIsDenied()
        {
            _repo.DenyEditFilter = true;

            var response = await Sut().SaveAsync(All("rina@x.com"));

            var result = Change(response);
            result.Denied.Should().HaveCount(3);
            result.Added.Should().Be(0);
            response.Message.Should().Be("No monitor needed a change. 3 not updated: you can't edit them.");
            _repo.BulkWrites.Should().Be(0);
            QueueMessages(0);
            HealthReloads(0);
        }

        [Fact]
        public async Task Save_Q5_AValidationRuleRefusingOneMonitor_RefusesTheWholeRequestBeforeAnyWrite()
        {
            _repo.Refused.Add("h1");

            var response = await Sut().SaveAsync(All("rina@x.com"));

            response.IsSuccess.Should().BeFalse();
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            response.Errors.Should().ContainKey("Emails");
            _repo.BulkWrites.Should().Be(0);
            _repo.Written.Should().BeEmpty();
            KvFor("rina@x.com").Should().BeEmpty();
            QueueMessages(0);
            _logger.Has(LogLevel.Warning, "data validation rule").Should().BeTrue();
        }

        [Fact]
        public async Task Save_ARuleRefusingTheRetriedList_LeavesThatMonitorConflicted()
        {
            _repo.BeforeBulkWrite = repo =>
            {
                repo.Get("m2").Emails.Add("late@x.com");
                repo.Refused.Add("m2");
            };

            var result = Change(await Sut().SaveAsync(All("rina@x.com")));

            result.Conflicted.Should().ContainSingle().Which.ItemId.Should().Be("m2");
            _repo.SingleWrites.Should().Be(0);
        }

        [Fact]
        public async Task Save_C9_WhenTheKeyValueWriteFails_MonitorChangesStay_AndARetryHasNoDuplicates()
        {
            // The key-value write that follows the monitor writes: a save that keeps the "All monitors" flag as stored
            // (a flag change is written before the monitors, see B1 and m5 below).
            _kv.Add(Key, Entry("rina@x.com", false));
            _repo.Get("m1").Emails.Add("rina@x.com");
            _kv.FailUpdate = true;

            var failed = await Sut().SaveAsync(Selected("rina@x.com", "m1", "m2", "h1"));

            failed.IsSuccess.Should().BeFalse();
            failed.Message.Should().Be("Recipients were updated on the monitors, but saving the \"All monitors\" choice failed. Try again.");
            Change(failed).Added.Should().Be(2);
            _repo.Get("m2").Emails.Should().Contain("rina@x.com");
            QueueMessages(1);
            HealthReloads(1);

            _kv.FailUpdate = false;
            var retry = await Sut().SaveAsync(Selected("rina@x.com", "m1", "m2", "h1"));

            retry.IsSuccess.Should().BeTrue();
            Change(retry).Unchanged.Should().Be(3);
            foreach (var monitor in new[] { "m1", "m2", "h1" })
                _repo.Get(monitor).Emails.Count(e => e == "rina@x.com").Should().Be(1);
            KvFor("rina@x.com").Should().ContainSingle().Which.Value.AllMonitors.Should().BeFalse();
            NoEmailInAnyLog();
        }

        [Fact]
        public async Task Save_WhenStoringANewAllMonitorsChoiceFails_NothingIsWritten()
        {
            // The flag change is stored first (B1, m5); when that fails no monitor has been touched yet.
            _kv.FailAdd = true;

            var failed = await Sut().SaveAsync(All("rina@x.com"));

            failed.IsSuccess.Should().BeFalse();
            failed.Message.Should().Be("Could not save the recipient. Try again.");
            _repo.BulkWrites.Should().Be(0);
            KvFor("rina@x.com").Should().BeEmpty();
            QueueMessages(0);
            NoEmailInAnyLog();
        }

        [Fact]
        public async Task Save_C19_LeavesOneDocumentForThePerson()
        {
            _kv.Add(Key, Entry("rina@x.com", true, DateTime.UtcNow.AddHours(-2)));
            _kv.Add(Key, Entry("RINA@x.com", true, DateTime.UtcNow.AddHours(-1)));

            await Sut().SaveAsync(Selected("rina@x.com", "m1"));

            KvFor("rina@x.com").Should().ContainSingle().Which.Value.AllMonitors.Should().BeFalse();
            _kv.Docs.Should().NotContain(d => d.Value.Email == "RINA@x.com");
        }

        [Fact]
        public async Task Save_C15_WhenTheRefreshFails_TheResultIsStillReturned()
        {
            _messages.Setup(m => m.SendToConsumerAsync(It.IsAny<ConsumerMessage<MonitorConfigurationUpdateQueue>>()))
                .ThrowsAsync(new InvalidOperationException("bus down"));
            _health.Setup(h => h.LoadMonitorsFromDatabaseAsync()).ThrowsAsync(new InvalidOperationException("db down"));

            var response = await Sut().SaveAsync(All("rina@x.com"));

            response.IsSuccess.Should().BeTrue();
            Change(response).Added.Should().Be(3);
            _logger.Has(LogLevel.Error, "Queueing the monitor refresh").Should().BeTrue();
            _logger.Has(LogLevel.Error, "Reloading the heartbeat cache").Should().BeTrue();
            NoEmailInAnyLog();
        }

        [Fact]
        public async Task Save_WhenTheMonitorReadFails_ReturnsAnErrorAndWritesNothing()
        {
            _repo.FailReads = true;

            var response = await Sut().SaveAsync(All("rina@x.com"));

            response.IsSuccess.Should().BeFalse();
            response.Message.Should().Be("Could not save the recipient. Try again.");
            _kv.Docs.Should().HaveCount(1);
        }

        [Theory]
        [InlineData("p2")]
        [InlineData("")]
        public async Task Save_AndDelete_ForAnotherProject_AreProjectNotFound_WithNoReadsOrWrites(string project)
        {
            // C4.
            (await Sut().SaveAsync(All("rina@x.com", project))).Message.Should().Be("Project not found.");
            (await Sut().DeleteAsync(Remove("ops@x.com", project))).Message.Should().Be("Project not found.");
            (await Sut().SaveAsync(null)).Message.Should().Be("Project not found.");
            (await Sut().DeleteAsync(null)).Message.Should().Be("Project not found.");

            _repo.FullReads.Should().Be(0);
            _repo.Written.Should().BeEmpty();
            _kv.ImpersonatedFlags.Should().BeEmpty();
        }

        [Fact]
        public async Task Save_H14_AnAddressOfNoProjectMember_IsSavedTheSameWay()
        {
            var result = Change(await Sut().SaveAsync(Selected("alerts@partner.example", "m1")));

            result.Added.Should().Be(1);
        }

        [Fact]
        public async Task Section5_SaveAndDeleteOn500Monitors_StayWithinTheDatabaseWorkBounds()
        {
            // §5 performance path: one monitor read, one EDIT filter, every update checked (bounded parallelism is
            // in the repository), one unordered bulk write, no re-read or retry, one message and one reload.
            _repo.Monitors.Clear();
            for (var i = 0; i < 500; i++)
                _repo.Monitors.Add(FakeMonitorRepo.Monitor($"m{i:D3}", $"monitor {i}",
                    type: i < 450 ? MonitorConfigurationTypes.OutboundPing : MonitorConfigurationTypes.InboundPing,
                    emails: Enumerable.Range(0, i < 50 ? 10 : i % 10).Select(k => $"p{k}@x.com").ToArray()));

            var save = Change(await Sut().SaveAsync(All("new@x.com")));

            save.Added.Should().Be(450);
            save.SkippedFull.Should().HaveCount(50);
            (_repo.FullReads, _repo.EditFilterCalls, _repo.BulkWrites, _repo.SingleWrites).Should().Be((1, 1, 1, 0));
            _repo.Checked.Should().HaveCount(450);
            QueueMessages(1);
            HealthReloads(1);

            var removed = (AlertRecipientRemoveResult)(await Sut().DeleteAsync(Remove("new@x.com"))).Data;

            removed.Removed.Should().Be(450);
            (_repo.FullReads, _repo.EditFilterCalls, _repo.BulkWrites, _repo.SingleWrites).Should().Be((2, 2, 2, 0));
            QueueMessages(2);
            HealthReloads(2);
        }

        // ---------------------------------------------------------------- Delete

        [Fact]
        public async Task Delete_E7_RemovesTheEmailFromEveryEditableMonitor_AndItsDocuments()
        {
            // E7, H7.
            _kv.Add(Key, Entry("OPS@x.com", true));

            var response = await Sut().DeleteAsync(Remove(" Ops@X.com "));

            response.IsSuccess.Should().BeTrue();
            response.Message.Should().Be("Removed from 2 monitors.");
            var result = response.Data.Should().BeOfType<AlertRecipientRemoveResult>().Subject;
            (result.Email, result.Removed).Should().Be(("ops@x.com", 2));
            result.Conflicted.Should().BeEmpty();
            result.Denied.Should().BeEmpty();
            _repo.Get("m1").Emails.Should().Equal("ali@x.com");
            _repo.Get("m2").Emails.Should().BeEmpty();
            _repo.Get("b1").Emails.Should().Equal("ops@x.com");
            KvFor("ops@x.com").Should().BeEmpty();
            _kv.Docs.Should().BeEmpty();
            QueueMessages(1);
            HealthReloads(0);
        }

        [Fact]
        public async Task Delete_Q7_RemovesEveryVariantOfTheEmail()
        {
            _repo.Get("m1").Emails = new List<string> { "z@x.com", "OPS@x.com", "a@x.com", " ops@x.com" };
            _repo.Get("h1").Emails = new List<string> { "Ops@X.com" };

            var result = (AlertRecipientRemoveResult)(await Sut().DeleteAsync(Remove("ops@x.com"))).Data;

            result.Removed.Should().Be(3);
            _repo.Get("m1").Emails.Should().Equal("z@x.com", "a@x.com");
            _repo.Get("h1").Emails.Should().BeEmpty();
            HealthReloads(1);
        }

        [Fact]
        public async Task Delete_C14_AnUnknownEmail_SucceedsWithNothingRemoved()
        {
            var response = await Sut().DeleteAsync(Remove("nobody@x.com"));

            response.IsSuccess.Should().BeTrue();
            ((AlertRecipientRemoveResult)response.Data).Removed.Should().Be(0);
            _repo.BulkWrites.Should().Be(0);
            _repo.EditFilterCalls.Should().Be(0);
            QueueMessages(0);
        }

        [Fact]
        public async Task Delete_AnInvalidEmail_IsRefused()
        {
            var response = await Sut().DeleteAsync(Remove("ops@"));

            response.Message.Should().Be("Enter a valid email address.");
            _repo.FullReads.Should().Be(0);
        }

        [Fact]
        public async Task Delete_WhenTheKeyValueDeleteFails_ReportsIt_AndKeepsTheMonitorChanges()
        {
            _kv.FailDelete = true;

            var response = await Sut().DeleteAsync(Remove("ops@x.com"));

            response.IsSuccess.Should().BeFalse();
            response.Message.Should().Be("Recipients were removed from the monitors, but removing the saved person failed. Try again.");
            ((AlertRecipientRemoveResult)response.Data).Removed.Should().Be(2);
            _repo.Get("m2").Emails.Should().BeEmpty();
            NoEmailInAnyLog();
        }

        [Fact]
        public async Task Delete_ConflictsAndDenials_AreReported()
        {
            _repo.EditExcluded.UnionWith(new[] { "m1", "m2" });
            _repo.HiddenOnReread.Add("m2");

            var response = await Sut().DeleteAsync(Remove("ops@x.com"));

            var result = (AlertRecipientRemoveResult)response.Data;
            result.Conflicted.Should().Equal(new AlertRecipientMonitorRef("m1", "api"));
            result.Denied.Should().Equal(new AlertRecipientMonitorRef("m2", "web"));
            response.Message.Should().Be("No monitor needed a change. 1 not updated: changed by someone else at the same time. Try again. 1 not updated: you can't edit it.");
        }

        [Fact]
        public async Task Delete_Q5_ARuleRefusal_RefusesTheRequest()
        {
            _repo.Refused.Add("m1");

            var response = await Sut().DeleteAsync(Remove("ops@x.com"));

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            _repo.Written.Should().BeEmpty();
            // The choice cleared before the monitor writes (B1) is put back: nothing changed.
            KvFor("ops@x.com").Should().ContainSingle().Which.Value.AllMonitors.Should().BeTrue();
        }

        [Fact]
        public async Task Delete_WhenTheMonitorReadFails_ReturnsAnError()
        {
            _repo.FailReads = true;

            var response = await Sut().DeleteAsync(Remove("ops@x.com"));

            response.IsSuccess.Should().BeFalse();
            response.Message.Should().Be("Could not remove the recipient. Try again.");
            KvFor("ops@x.com").Should().ContainSingle();
        }

        // ---------------------------------------------------------------- B1: order of writes and refresh

        private List<string> RecordOrder()
        {
            var journal = new List<string>();
            _kv.Journal = journal;
            _repo.Journal = journal;
            _messages.Setup(m => m.SendToConsumerAsync(It.IsAny<ConsumerMessage<MonitorConfigurationUpdateQueue>>()))
                .Callback(() => journal.Add("refresh:message")).Returns(Task.CompletedTask);
            _health.Setup(h => h.LoadMonitorsFromDatabaseAsync()).Callback(() => journal.Add("refresh:heartbeats")).Returns(Task.CompletedTask);
            return journal;
        }

        /// <summary>The Worker: every refresh message runs the real reconciliation against the same data.</summary>
        private void ReconcileOnEveryRefreshMessage()
        {
            var reconciler = new AlertRecipientReconciler(new AlertRecipientStore(_kv, _storeLogger), _repo, new CapturingLogger<AlertRecipientReconciler>());
            _messages.Setup(m => m.SendToConsumerAsync(It.IsAny<ConsumerMessage<MonitorConfigurationUpdateQueue>>()))
                .Returns(() => reconciler.ReconcileAsync());
        }

        [Fact]
        public async Task B1_Save_WritesTheKeyValueEntry_BeforeTheRefreshMessageAndTheHeartbeatReload()
        {
            var journal = RecordOrder();

            await Sut().SaveAsync(Selected("rina@x.com", "m1", "h1"));

            journal.Should().Equal("monitors:bulk", "kv:add", "refresh:message", "refresh:heartbeats");
        }

        [Fact]
        public async Task B1_Save_FromAllToSelected_ClearsTheStoredChoiceBeforeAnyMonitorWrite()
        {
            var journal = RecordOrder();
            _repo.Get("h1").Emails.Add("ops@x.com");

            await Sut().SaveAsync(Selected("ops@x.com", "m1"));

            journal.Should().Equal("kv:update", "monitors:bulk", "refresh:message", "refresh:heartbeats");
            KvFor("ops@x.com").Should().ContainSingle().Which.Value.AllMonitors.Should().BeFalse();
        }

        [Fact]
        public async Task B1_Save_FromAllToSelected_WithTheWorkerReconcilingMidSave_DoesNotPutThePersonBack()
        {
            // H6: the Worker reconciles while the monitors are written and again on the refresh message.
            ReconcileOnEveryRefreshMessage();
            var reconciler = new AlertRecipientReconciler(new AlertRecipientStore(_kv, _storeLogger), _repo, new CapturingLogger<AlertRecipientReconciler>());
            _repo.AfterBulkWrite = _ => reconciler.ReconcileAsync().GetAwaiter().GetResult();

            var response = await Sut().SaveAsync(Selected("ops@x.com", "m1"));

            response.IsSuccess.Should().BeTrue();
            _repo.Get("m1").Emails.Should().Equal("ops@x.com", "ali@x.com");
            _repo.Get("m2").Emails.Should().BeEmpty();
            _repo.Get("h1").Emails.Should().BeEmpty();
        }

        [Fact]
        public async Task B1_Delete_ClearsTheChoice_WritesTheMonitors_DeletesTheEntry_ThenRefreshes()
        {
            var journal = RecordOrder();
            _repo.Get("h1").Emails.Add("ops@x.com");

            await Sut().DeleteAsync(Remove("ops@x.com"));

            journal.Should().Equal("kv:update", "monitors:bulk", "kv:delete", "refresh:message", "refresh:heartbeats");
        }

        [Fact]
        public async Task B1_Delete_WithTheWorkerReconcilingMidDelete_DoesNotPutThePersonBack()
        {
            // H7: "people who leave stop getting alerts immediately".
            ReconcileOnEveryRefreshMessage();
            var reconciler = new AlertRecipientReconciler(new AlertRecipientStore(_kv, _storeLogger), _repo, new CapturingLogger<AlertRecipientReconciler>());
            _repo.AfterBulkWrite = _ => reconciler.ReconcileAsync().GetAwaiter().GetResult();

            var response = await Sut().DeleteAsync(Remove("ops@x.com"));

            response.IsSuccess.Should().BeTrue();
            foreach (var monitor in new[] { "m1", "m2", "h1" })
                _repo.Get(monitor).Emails.Should().NotContain("ops@x.com");
            KvFor("ops@x.com").Should().BeEmpty();
        }

        [Fact]
        public async Task B1_Delete_ASelectedPerson_DeletesTheEntryAfterTheMonitors_WithNoEarlyWrite()
        {
            var journal = RecordOrder();
            _kv.Add(Key, Entry("ali@x.com", false));

            await Sut().DeleteAsync(Remove("ali@x.com"));

            journal.Should().Equal("monitors:bulk", "kv:delete", "refresh:message");
        }

        [Fact]
        public async Task B1_Save_ARuleRefusal_AfterTheChoiceWasCleared_PutsTheChoiceBack()
        {
            _repo.Refused.Add("m2");

            var response = await Sut().SaveAsync(Selected("ops@x.com", "m1"));

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            _repo.Written.Should().BeEmpty();
            var stored = KvFor("ops@x.com").Should().ContainSingle().Subject.Value;
            stored.AllMonitors.Should().BeTrue();
            stored.UpdatedAt.Should().BeBefore(DateTime.UtcNow.AddHours(-1), "the original entry is restored as it was");
        }

        // ---------------------------------------------------------------- m5: the "All monitors" limit under a race

        [Fact]
        public async Task M5_ATenthPersonRacingAnotherPastTheLimit_IsRefusedAndUndone()
        {
            for (var i = 1; i < 9; i++) _kv.Add(Key, Entry($"all{i}@x.com", true));
            // Both saves passed the first count (9 stored); the other one lands right after this save's write.
            _kv.AfterNextAdd = kv => kv.Add(Key, Entry("other@x.com", true, DateTime.UtcNow));

            var response = await Sut().SaveAsync(All("tenth@x.com"));

            response.IsSuccess.Should().BeFalse();
            response.Message.Should().Be("At most 10 people can get alerts for all monitors.");
            _repo.BulkWrites.Should().Be(0);
            KvFor("tenth@x.com").Should().BeEmpty();
            _kv.Docs.Count(d => d.Value.AllMonitors).Should().Be(10);
            QueueMessages(0);
            _logger.Has(LogLevel.Warning, "at the same time").Should().BeTrue();
            NoEmailInAnyLog();
        }

        [Fact]
        public async Task M5_AStoredSelectedPersonRefusedByTheRace_KeepsTheirStoredChoice()
        {
            for (var i = 1; i < 9; i++) _kv.Add(Key, Entry($"all{i}@x.com", true));
            var before = Entry("rina@x.com", false);
            _kv.Add(Key, before);
            // rina's entry is updated in place (no add), so the concurrent writer runs after this save's first store write.
            var store = new RacingStore(new AlertRecipientStore(_kv, _storeLogger), () => _kv.Add(Key, Entry("other@x.com", true, DateTime.UtcNow)));
            var sut = new AlertRecipientService(_repo, store, Sut_AlertRepo(), _messages.Object, _health.Object, new SaveAlertRecipientRequestValidator(), _logger);

            var response = await sut.SaveAsync(All("rina@x.com"));

            response.Message.Should().Be("At most 10 people can get alerts for all monitors.");
            var stored = KvFor("rina@x.com").Should().ContainSingle().Subject.Value;
            stored.AllMonitors.Should().BeFalse();
            stored.UpdatedAt.Should().Be(before.UpdatedAt);
            _repo.BulkWrites.Should().Be(0);
        }

        [Fact]
        public async Task M5_WhenTheLimitReCountFails_TheEarlyChoiceIsUndone_AndAnUndoFailureIsLoggedByTypeOnly()
        {
            _kv.AfterNextAdd = kv => kv.FailReads = true;

            var response = await Sut().SaveAsync(All("rina@x.com"));

            response.Message.Should().Be("Could not save the recipient. Try again.");
            _repo.BulkWrites.Should().Be(0);
            KvFor("rina@x.com").Should().BeEmpty();

            _kv.FailReads = false;
            _kv.AfterNextAdd = kv => { kv.FailReads = true; kv.FailDelete = true; };
            await Sut().SaveAsync(All("zed@x.com"));

            _logger.Has(LogLevel.Error, "Restoring the alert recipient's \"All monitors\" choice failed for project p1: MongoException").Should().BeTrue();
            NoEmailInAnyLog();
        }

        /// <summary>Runs a concurrent writer just after the first SaveAsync of the wrapped store.</summary>
        private sealed class RacingStore : IAlertRecipientStore
        {
            private readonly IAlertRecipientStore _inner;
            private Action? _afterFirstSave;
            public RacingStore(IAlertRecipientStore inner, Action afterFirstSave) { _inner = inner; _afterFirstSave = afterFirstSave; }
            public Task<Dictionary<string, StoredAlertRecipient>> GetAsync(string tenantId) => _inner.GetAsync(tenantId);
            public async Task<StoredAlertRecipient> SaveAsync(string tenantId, AlertRecipientEntry entry, StoredAlertRecipient? existing)
            {
                var stored = await _inner.SaveAsync(tenantId, entry, existing);
                var hook = _afterFirstSave;
                _afterFirstSave = null;
                hook?.Invoke();
                return stored;
            }
            public Task RemoveAsync(StoredAlertRecipient existing) => _inner.RemoveAsync(existing);
            public Task<IReadOnlyList<AllMonitorsPeople>> GetAllMonitorsPeopleByTenantAsync() => _inner.GetAllMonitorsPeopleByTenantAsync();
            public Task<List<string>> GetEmailsForNewMonitorAsync(string? projectKey) => _inner.GetEmailsForNewMonitorAsync(projectKey);
        }

        // ---------------------------------------------------------------- m2: retries never undo a later change

        [Fact]
        public async Task M2_AMonitorThisSaveWroteAndAnotherWriterThenReverted_IsNotWrittenAgain()
        {
            // m2 conflicts before the bulk write; just after it, another writer removes rina from m1 again.
            _repo.BeforeBulkWrite = repo => repo.Get("m2").Emails.Add("late@x.com");
            _repo.AfterBulkWrite = repo => repo.Get("m1").Emails.Remove("rina@x.com");

            var result = Change(await Sut().SaveAsync(Selected("rina@x.com", "m1", "m2")));

            _repo.Get("m1").Emails.Should().Equal("ops@x.com", "ali@x.com");
            result.Conflicted.Select(m => m.ItemId).Should().Equal("m1");
            // m2 lost to a change that isn't this person's removal: retried once, as before.
            _repo.Get("m2").Emails.Should().Equal("ops@x.com", "late@x.com", "rina@x.com");
            _repo.SingleWrites.Should().Be(1);
        }

        [Fact]
        public async Task M2_AfterAConcurrentDeleteOfThePerson_NoMonitorIsRetried()
        {
            // rina becomes "All monitors"; between the bulk write and the re-read another manager removes rina
            // (monitors and stored entry). Nothing may bring rina back.
            _repo.BeforeBulkWrite = repo => repo.Get("m2").Emails.Add("late@x.com");
            _repo.AfterBulkWrite = repo =>
            {
                foreach (var monitor in repo.Monitors) monitor.Emails?.Remove("rina@x.com");
                foreach (var doc in _kv.Docs.Where(d => d.Value.Email == "rina@x.com")) _kv.DeleteByIdAsync(doc.ItemId).GetAwaiter().GetResult();
            };

            var result = Change(await Sut().SaveAsync(All("rina@x.com")));

            foreach (var monitor in new[] { "m1", "m2", "h1" })
                _repo.Get(monitor).Emails.Should().NotContain("rina@x.com");
            result.Conflicted.Select(m => m.ItemId).Should().BeEquivalentTo(new[] { "m1", "m2", "h1" });
            _repo.SingleWrites.Should().Be(0);
            KvFor("rina@x.com").Should().BeEmpty();
        }

        [Fact]
        public async Task M2_ADeleteRacingASaveOfThePerson_DoesNotRemoveThemAgain()
        {
            _repo.BeforeBulkWrite = repo => repo.Get("m2").Emails.Add("late@x.com");
            _repo.AfterBulkWrite = repo =>
            {
                repo.Get("m1").Emails.Insert(0, "ops@x.com");
                _kv.Add(Key, Entry("ops@x.com", true, DateTime.UtcNow.AddMinutes(1)));
            };

            var result = (AlertRecipientRemoveResult)(await Sut().DeleteAsync(Remove("ops@x.com"))).Data;

            _repo.Get("m1").Emails.Should().Contain("ops@x.com");
            _repo.Get("m2").Emails.Should().Equal("ops@x.com", "late@x.com");
            result.Conflicted.Select(m => m.ItemId).Should().BeEquivalentTo(new[] { "m1", "m2" });
            _repo.SingleWrites.Should().Be(0);
        }

        [Fact]
        public async Task M2_WhenTheIntentReReadFails_NothingIsRetried_AndOnlyTheTypeIsLogged()
        {
            _repo.BeforeBulkWrite = repo => repo.Get("m2").Emails.Add("late@x.com");
            _repo.AfterBulkWrite = _ => _kv.FailReads = true;

            var result = Change(await Sut().SaveAsync(Selected("rina@x.com", "m1", "m2")));

            result.Conflicted.Select(m => m.ItemId).Should().Equal("m2");
            _repo.SingleWrites.Should().Be(0);
            _logger.Has(LogLevel.Warning, "nothing is retried").Should().BeTrue();
            NoEmailInAnyLog();
        }

        [Fact]
        public async Task LogForging_ARequestDerivedProjectKeyIsLoggedWithoutLineBreaks()
        {
            Caller.Set("p1\r\nforged");
            _repo.FailReads = true;

            await Sut().SaveAsync(new SaveAlertRecipientRequest { ProjectKey = "p1\r\nforged", Email = "rina@x.com", AllMonitors = true });

            _logger.Lines.Should().Contain(line => line.Contains("p1forged", StringComparison.Ordinal));
            _logger.Lines.Should().NotContain(line => line.Contains('\n') || line.Contains('\r'));
        }

        // ---------------------------------------------------------------- C20 and helpers

        [Fact]
        public async Task C20_NoOperationWritesAnEmailAddressToTheLogs()
        {
            await Sut().GetAsync("p1");
            await Sut().GetSuggestionsAsync("p1");
            await Sut().SaveAsync(All("rina@x.com"));
            await Sut().SaveAsync(Selected("rina@x.com", "m2"));
            _repo.Refused.Add("m1");
            await Sut().SaveAsync(Selected("zed@x.com", "m1"));
            await Sut().DeleteAsync(Remove("ops@x.com"));
            _kv.FailReads = true;
            await Sut().GetAsync("p1");

            _logger.Entries.Should().NotBeEmpty();
            NoEmailInAnyLog();
        }

        [Theory]
        [InlineData(0, 0, 0, 0, 0, "No monitor needed a change.")]
        [InlineData(1, 0, 0, 0, 0, "Added to 1 monitor.")]
        [InlineData(4, 1, 1, 0, 0, "Added to 4 monitors. Removed from 1 monitor. 1 skipped: already has 10 recipients.")]
        [InlineData(0, 0, 2, 0, 2, "No monitor needed a change. 2 skipped: already have 10 recipients. 2 not updated: you can't edit them.")]
        public void Summary_DescribesTheSave(int added, int removed, int skipped, int conflicted, int denied, string expected)
        {
            AlertRecipientService.Summary(added, removed, skipped, conflicted, denied).Should().Be(expected);
        }

        [Fact]
        public void Plan_TreatsAMissingEmailsListAsEmpty()
        {
            var monitor = FakeMonitorRepo.Monitor("n1", "null emails");
            monitor.Emails = null!;

            var plan = AlertRecipientService.Plan(monitor, "a@x.com", isTarget: true);

            plan.Change.Should().Be(AlertRecipientChange.Add);
            plan.NewEmails.Should().Equal("a@x.com");
            AlertRecipientService.Plan(monitor, "a@x.com", isTarget: false).Change.Should().Be(AlertRecipientChange.None);
        }
    }
}
