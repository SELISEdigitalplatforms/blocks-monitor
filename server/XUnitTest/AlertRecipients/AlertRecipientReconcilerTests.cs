using System;
using System.Linq;
using System.Threading.Tasks;
using Blocks.Genesis;
using Blocks.Genesis.Entities.Monitor;
using DomainService.AlertRecipients.Models;
using DomainService.AlertRecipients.Services;
using FluentAssertions;
using Microsoft.Extensions.Logging;

namespace XUnitTest.AlertRecipients
{
    /// <summary>
    /// The Worker step (H18, H19, C23-C25): monitors created outside Monitor's API (blocks-release inserts) get their
    /// project's "All monitors" people. Runs without user context, like the Worker.
    /// </summary>
    public sealed class AlertRecipientReconcilerTests
    {
        private readonly FakeMonitorRepo _repo = new();
        private readonly FakeKeyValueStore _kv = new();
        private readonly CapturingLogger<AlertRecipientReconciler> _logger = new();

        public AlertRecipientReconcilerTests()
        {
            Caller.Clear();
            // §7 fixture after E2: ops is "All monitors" and on m1, m2, h1.
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("m1", "api", emails: new[] { "ops@x.com", "ali@x.com" }));
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("m2", "web", emails: new[] { "ops@x.com" }));
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("h1", "worker", type: MonitorConfigurationTypes.InboundPing, emails: new[] { "ops@x.com" }));
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("b1", "identity", source: MonitorSourceTypes.BlocksServices));
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("i1", "infra", source: MonitorSourceTypes.Infrastructure));
            _kv.Add("monitor:alert-recipients:p1", Entry("ops@x.com", true));
            _kv.Add("monitor:alert-recipients:p1", Entry("ali@x.com", false));
        }

        private static AlertRecipientEntry Entry(string email, bool all, DateTime? at = null) =>
            new() { Email = email, AllMonitors = all, UpdatedAt = at ?? DateTime.UtcNow.AddDays(-1) };

        private AlertRecipientReconciler Sut() =>
            new(new AlertRecipientStore(_kv, new CapturingLogger<AlertRecipientStore>()), _repo, _logger);

        private void NoEmailInTheLogs() => _logger.Lines.Should().NotContain(line => line.Contains('@'));

        [Fact]
        public async Task E13_AMonitorInsertedWithNoEmails_GetsTheAllMonitorsPeople_AndNothingElseChanges()
        {
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("m4", "deployed-svc"));

            await Sut().ReconcileAsync();

            _repo.Get("m4").Emails.Should().Equal("ops@x.com");
            _repo.Written.Select(w => w.ItemId).Should().Equal("m4");
            _repo.Get("m1").Emails.Should().Equal("ops@x.com", "ali@x.com");
            _repo.Get("b1").Emails.Should().BeEmpty();
            _repo.Get("i1").Emails.Should().BeEmpty();
            _repo.Written.Single().UpdatedBy.Should().BeNull("the Worker writes without a user");
            _kv.ImpersonatedFlags.Should().OnlyContain(flag => flag == false);
        }

        [Fact]
        public async Task C25_NoWrite_WhenEveryMonitorAlreadyHasEveryone_EvenAsAVariant()
        {
            _repo.Get("m2").Emails = new() { " OPS@x.com" };

            await Sut().ReconcileAsync();

            _repo.MissingReads.Should().Be(1);
            _repo.EditFilterCalls.Should().Be(0);
            _repo.Written.Should().BeEmpty();
            _repo.Get("m2").Emails.Should().Equal(" OPS@x.com");
        }

        [Fact]
        public async Task C25_WhenNoMonitorMissesAnyone_NothingIsPlannedOrWritten()
        {
            await Sut().ReconcileAsync();

            _repo.MissingReads.Should().Be(1);
            _repo.EditFilterCalls.Should().Be(0);
            _repo.Written.Should().BeEmpty();
            _logger.Has(LogLevel.Information, "1 projects, 0 monitors updated").Should().BeTrue();
        }

        [Fact]
        public async Task C25_AddsOnly_InSortedOrder_WithoutReorderingOrRemoving()
        {
            _kv.Add("monitor:alert-recipients:p1", Entry("zed@x.com", true));
            _kv.Add("monitor:alert-recipients:p1", Entry("bea@x.com", true));
            _repo.Get("m1").Emails = new() { "z@x.com", "ops@x.com", "a@x.com" };

            await Sut().ReconcileAsync();

            _repo.Get("m1").Emails.Should().Equal("z@x.com", "ops@x.com", "a@x.com", "bea@x.com", "zed@x.com");
        }

        [Fact]
        public async Task NeverGoesPast10()
        {
            _kv.Add("monitor:alert-recipients:p1", Entry("zed@x.com", true));
            _kv.Add("monitor:alert-recipients:p1", Entry("bea@x.com", true));
            _repo.Get("m2").Emails = Enumerable.Range(0, 9).Select(i => $"p{i}@x.com").ToList();

            await Sut().ReconcileAsync();

            _repo.Get("m2").Emails.Should().HaveCount(10).And.EndWith("bea@x.com");
        }

        [Fact]
        public async Task C23_AFullMonitor_IsLeftUnchanged_WithAWarningNamingItsIdAndNoEmail()
        {
            _repo.Get("m2").Emails = Enumerable.Range(0, 10).Select(i => $"p{i}@x.com").ToList();

            await Sut().ReconcileAsync();

            _repo.Written.Should().BeEmpty();
            _logger.Has(LogLevel.Warning, "Monitor m2 of project p1 already has 10 alert recipients").Should().BeTrue();
            NoEmailInTheLogs();
        }

        [Fact]
        public async Task H19_ReconcilesEveryProjectWithAllMonitorsPeople_AndSkipsProjectsWithoutThem()
        {
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("q1", "q-api", tenant: "p2"));
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("r1", "r-api", tenant: "p3"));
            _kv.Add("monitor:alert-recipients:p2", Entry("lead@q.com", true));
            _kv.Add("monitor:alert-recipients:p3", Entry("someone@r.com", false));
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("m4", "deployed-svc"));

            await Sut().ReconcileAsync();

            _repo.Get("q1").Emails.Should().Equal("lead@q.com");
            _repo.Get("m4").Emails.Should().Equal("ops@x.com");
            _repo.Get("r1").Emails.Should().BeEmpty();
            _repo.MissingReads.Should().Be(2);
            _logger.Has(LogLevel.Information, "2 monitors updated").Should().BeTrue();
        }

        [Fact]
        public async Task WithNoAllMonitorsPeopleAnywhere_ReadsNoMonitor()
        {
            _kv.Add("monitor:alert-recipients:p1", Entry("ops@x.com", false, DateTime.UtcNow));

            await Sut().ReconcileAsync();

            _repo.MissingReads.Should().Be(0);
        }

        [Fact]
        public async Task C24_AKeyValueReadFailure_IsLogged_AndNeverThrows()
        {
            _kv.FailReads = true;

            var act = () => Sut().ReconcileAsync();

            await act.Should().NotThrowAsync();
            _logger.Has(LogLevel.Error, "could not read").Should().BeTrue();
            _repo.MissingReads.Should().Be(0);
        }

        [Fact]
        public async Task C24_AMonitorReadFailure_IsLoggedPerProject_AndLosesNoEmail()
        {
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("m4", "deployed-svc"));
            _repo.FailReads = true;

            var act = () => Sut().ReconcileAsync();

            await act.Should().NotThrowAsync();
            _logger.Has(LogLevel.Error, "failed for project p1").Should().BeTrue();
            _repo.Get("m1").Emails.Should().Equal("ops@x.com", "ali@x.com");
            NoEmailInTheLogs();
        }

        [Fact]
        public async Task M1_RunsWithoutTheMessageSendersUserContext_AndRestoresIt()
        {
            // A refresh message arrives with its sender's context (another project's user). The reconciliation must
            // take the data access skip path, like the 600-second poll, and leave the context as it found it.
            Caller.Set("p9", "user-of-p9");
            var senders = BlocksContext.GetContext();
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("m4", "deployed-svc"));

            try
            {
                await Sut().ReconcileAsync();

                _repo.MissingReadContexts.Should().ContainSingle().Which.Should().BeNull();
                _repo.Get("m4").Emails.Should().Equal("ops@x.com");
                BlocksContext.GetContext().Should().BeSameAs(senders);
            }
            finally
            {
                Caller.Clear();
            }
        }

        [Fact]
        public async Task M1_RestoresTheContext_EvenWhenTheRunFails()
        {
            Caller.Set("p9");
            var senders = BlocksContext.GetContext();
            _repo.FailReads = true;
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("m4", "deployed-svc"));

            try
            {
                await Sut().ReconcileAsync();

                _repo.MissingReadContexts.Should().ContainSingle().Which.Should().BeNull();
                BlocksContext.GetContext().Should().BeSameAs(senders);
            }
            finally
            {
                Caller.Clear();
            }
        }

        [Fact]
        public async Task LogForging_AProjectKeyFromTheKeyValueKeyIsLoggedWithoutLineBreaks()
        {
            _kv.Add("monitor:alert-recipients:p7\r\nforged", Entry("lead@q.com", true));
            _repo.FailReads = true;

            await Sut().ReconcileAsync();

            _logger.Has(LogLevel.Error, "failed for project p7forged").Should().BeTrue();
            _logger.Lines.Should().NotContain(line => line.Contains('\n') || line.Contains('\r'));
        }

        [Fact]
        public async Task Q5_AMonitorAValidationRuleRefuses_IsSkippedAndLogged_TheOthersAreWritten()
        {
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("m4", "deployed-svc"));
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("m5", "deployed-svc-2"));
            _repo.Refused.Add("m4");

            await Sut().ReconcileAsync();

            _repo.Get("m4").Emails.Should().BeEmpty();
            _repo.Get("m5").Emails.Should().Equal("ops@x.com");
            _logger.Has(LogLevel.Warning, "Monitor m4 of project p1 was not reconciled (Invalid)").Should().BeTrue();
            NoEmailInTheLogs();
        }

        [Fact]
        public async Task OnlyRefusedMonitors_WritesNothing()
        {
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("m4", "deployed-svc"));
            _repo.Refused.Add("m4");

            await Sut().ReconcileAsync();

            _repo.BulkWrites.Should().Be(0);
        }

        [Fact]
        public async Task AConflictedWrite_IsSkippedForTheNextRun()
        {
            _repo.Monitors.Add(FakeMonitorRepo.Monitor("m4", "deployed-svc"));
            _repo.BeforeBulkWrite = repo => repo.Get("m4").Emails.Add("dev@x.com");
            _repo.BeforeSingleWrite = (repo, _) => repo.Get("m4").Emails.Add("dev2@x.com");

            await Sut().ReconcileAsync();

            _repo.Get("m4").Emails.Should().Equal("dev@x.com", "dev2@x.com");
            _logger.Has(LogLevel.Warning, "Monitor m4 of project p1 was not reconciled (Conflicted)").Should().BeTrue();
            NoEmailInTheLogs();
        }

        [Fact]
        public void Plan_WithAMissingEmailsList_AddsEveryone()
        {
            var monitor = FakeMonitorRepo.Monitor("n1", "null");
            monitor.Emails = null!;

            var plan = AlertRecipientReconciler.Plan(monitor, new[] { "b@x.com", "a@x.com" });

            plan.NewEmails.Should().Equal("a@x.com", "b@x.com");
        }
    }
}
