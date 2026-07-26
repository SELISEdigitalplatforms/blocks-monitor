using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using DomainService.Monitor.Entity;
using DomainService.Monitor.Models;
using DomainService.Monitor.Services;
using DomainService.Validators;
using FluentAssertions;
using Moq;

namespace XUnitTest.Validators
{
    public class SaveMonitorConfigurationRequestValidatorTests
    {
        private readonly Mock<IMonitorConfigurationRepoService> _repo = new();

        public SaveMonitorConfigurationRequestValidatorTests()
        {
            _repo.Setup(r => r.GetConfigurationListByTenantIdAsync(It.IsAny<string>()))
                .ReturnsAsync(new List<MonitorConfiguration>());
            _repo.Setup(r => r.GetByUrlAsync(It.IsAny<string>())).ReturnsAsync((MonitorConfiguration)null);
        }

        private SaveMonitorConfigurationRequestValidator Sut() => new(_repo.Object);

        private static SaveMonitorConfigurationRequest Valid() => new()
        {
            ProjectKey = "proj",
            Name = "Api",
            Url = "https://api.test/health"
        };

        [Fact]
        public async Task Validate_ValidRequest_Passes()
        {
            var result = await Sut().ValidateAsync(Valid());
            result.IsValid.Should().BeTrue();
        }

        [Fact]
        public async Task Validate_MissingProjectKey_Fails()
        {
            var req = Valid();
            req.ProjectKey = "";
            var result = await Sut().ValidateAsync(req);
            result.Errors.Select(e => e.ErrorMessage).Should().Contain("ProjectKey is required.");
        }

        [Fact]
        public async Task Validate_TooManyMonitors_Fails()
        {
            _repo.Setup(r => r.GetConfigurationListByTenantIdAsync("proj"))
                .ReturnsAsync(Enumerable.Range(0, 11).Select(i => new MonitorConfiguration { ItemId = i.ToString() }).ToList());

            var result = await Sut().ValidateAsync(Valid());

            result.Errors.Select(e => e.ErrorMessage).Should().Contain(m => m.Contains("more than 10 monitors"));
        }

        [Fact]
        public async Task Validate_MissingName_Fails()
        {
            var req = Valid();
            req.Name = "";
            var result = await Sut().ValidateAsync(req);
            result.Errors.Select(e => e.ErrorMessage).Should().Contain("Monitor name is required.");
        }

        [Fact]
        public async Task Validate_MissingUrl_Fails()
        {
            var req = Valid();
            req.Url = "";
            var result = await Sut().ValidateAsync(req);
            result.Errors.Select(e => e.ErrorMessage).Should().Contain("URL is required.");
        }

        [Theory]
        [InlineData("not-a-url")]
        [InlineData("ftp://example.com")]
        public async Task Validate_InvalidUrlScheme_Fails(string url)
        {
            var req = Valid();
            req.Url = url;
            var result = await Sut().ValidateAsync(req);
            result.Errors.Select(e => e.ErrorMessage).Should().Contain(m => m.Contains("URL is not valid"));
        }

        [Fact]
        public async Task Validate_DuplicateUrl_Fails()
        {
            _repo.Setup(r => r.GetByUrlAsync("https://api.test/health"))
                .ReturnsAsync(new MonitorConfiguration { ItemId = "existing" });

            var result = await Sut().ValidateAsync(Valid());

            result.Errors.Select(e => e.ErrorMessage).Should().Contain(m => m.Contains("URL already exists"));
        }
    }

    public class UpdateMonitorConfigurationRequestValidatorTests
    {
        private readonly Mock<IMonitorConfigurationRepoService> _repo = new();

        public UpdateMonitorConfigurationRequestValidatorTests()
        {
            _repo.Setup(r => r.GetByUrlAsync(It.IsAny<string>())).ReturnsAsync((MonitorConfiguration)null);
        }

        private UpdateMonitorConfigurationRequestValidator Sut() => new(_repo.Object);

        [Fact]
        public async Task Validate_ValidRequest_Passes()
        {
            var result = await Sut().ValidateAsync(new UpdateMonitorConfigurationRequest { ItemId = "m1", Url = "https://a.test" });
            result.IsValid.Should().BeTrue();
        }

        [Fact]
        public async Task Validate_MissingItemId_Fails()
        {
            var result = await Sut().ValidateAsync(new UpdateMonitorConfigurationRequest { ItemId = "", Url = "https://a.test" });
            result.Errors.Select(e => e.ErrorMessage).Should().Contain("ItemId is required for update.");
        }

        [Fact]
        public async Task Validate_EmptyUrl_SkipsUrlRules()
        {
            // The Url rule chain is gated by When(url not empty), so a missing URL is allowed on update.
            var result = await Sut().ValidateAsync(new UpdateMonitorConfigurationRequest { ItemId = "m1", Url = null });
            result.IsValid.Should().BeTrue();
        }

        [Fact]
        public async Task Validate_InvalidUrl_Fails()
        {
            var result = await Sut().ValidateAsync(new UpdateMonitorConfigurationRequest { ItemId = "m1", Url = "not-a-url" });
            result.Errors.Select(e => e.ErrorMessage).Should().Contain(m => m.Contains("URL is not valid"));
        }

        [Fact]
        public async Task Validate_AbsoluteUrlWithWrongScheme_Fails()
        {
            // A well-formed absolute URI with a non-HTTP scheme is rejected by the scheme check.
            var result = await Sut().ValidateAsync(new UpdateMonitorConfigurationRequest { ItemId = "m1", Url = "ftp://example.com" });
            result.Errors.Select(e => e.ErrorMessage).Should().Contain(m => m.Contains("URL is not valid"));
        }

        [Fact]
        public async Task Validate_DuplicateUrlOwnedByAnotherMonitor_Fails()
        {
            _repo.Setup(r => r.GetByUrlAsync("https://a.test"))
                .ReturnsAsync(new MonitorConfiguration { ItemId = "other" });

            var result = await Sut().ValidateAsync(new UpdateMonitorConfigurationRequest { ItemId = "m1", Url = "https://a.test" });

            result.Errors.Select(e => e.ErrorMessage).Should().Contain(m => m.Contains("URL already exists"));
        }

        [Fact]
        public async Task Validate_DuplicateUrlOwnedBySameMonitor_Passes()
        {
            _repo.Setup(r => r.GetByUrlAsync("https://a.test"))
                .ReturnsAsync(new MonitorConfiguration { ItemId = "m1" });

            var result = await Sut().ValidateAsync(new UpdateMonitorConfigurationRequest { ItemId = "m1", Url = "https://a.test" });

            result.IsValid.Should().BeTrue();
        }
    }
}
