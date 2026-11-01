using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using DomainService.AlertRecipients.Models;
using DomainService.Validators;
using FluentAssertions;

namespace XUnitTest.Validators
{
    public class SaveAlertRecipientRequestValidatorTests
    {
        private static async Task<string?> FirstError(SaveAlertRecipientRequest request)
        {
            var result = await new SaveAlertRecipientRequestValidator().ValidateAsync(request);
            return result.IsValid ? null : result.Errors[0].ErrorMessage;
        }

        private static List<string> Ids(int count) => Enumerable.Range(1, count).Select(i => $"m{i}").ToList();

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("rina@")]
        [InlineData("a@b_c.com")]
        public async Task InvalidEmail_IsRefused(string? email)
        {
            // C1 / E4.
            (await FirstError(new SaveAlertRecipientRequest { Email = email, AllMonitors = true }))
                .Should().Be("Enter a valid email address.");
        }

        [Fact]
        public async Task SelectedWithNoMonitor_IsRefused()
        {
            // C2 / E5: empty and missing lists alike.
            (await FirstError(new SaveAlertRecipientRequest { Email = "rina@x.com", MonitorIds = new List<string>() }))
                .Should().Be("Choose at least one monitor.");
            (await FirstError(new SaveAlertRecipientRequest { Email = "rina@x.com" }))
                .Should().Be("Choose at least one monitor.");
        }

        [Fact]
        public async Task EmailRuleRunsFirst()
        {
            (await FirstError(new SaveAlertRecipientRequest { Email = "bad@", MonitorIds = Ids(501) }))
                .Should().Be("Enter a valid email address.");
        }

        [Fact]
        public async Task AllMonitors_NeedsNoMonitorIds()
        {
            (await FirstError(new SaveAlertRecipientRequest { Email = " OPS@x.com ", AllMonitors = true })).Should().BeNull();
        }

        [Fact]
        public async Task FiveHundredIds_AreAccepted_FiveHundredOne_AreNot()
        {
            // The 500-ids-per-request limit, for both modes.
            (await FirstError(new SaveAlertRecipientRequest { Email = "rina@x.com", MonitorIds = Ids(500) })).Should().BeNull();
            (await FirstError(new SaveAlertRecipientRequest { Email = "rina@x.com", MonitorIds = Ids(501) }))
                .Should().Be("Too many monitors in one request.");
            (await FirstError(new SaveAlertRecipientRequest { Email = "rina@x.com", AllMonitors = true, MonitorIds = Ids(501) }))
                .Should().Be("Too many monitors in one request.");
        }
    }
}
