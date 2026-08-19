using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Api.Controllers;
using DomainService.Monitor.Entity;
using DomainService.Monitor.Models;
using DomainService.Monitor.MonitorIncidentService;
using DomainService.Monitor.Services;
using DomainService.Shared.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.ApplicationModels;
using Microsoft.Extensions.Logging;
using Moq;

namespace XUnitTest.Api
{
    public class MonitorControllerTests
    {
        private readonly Mock<IMonitorConfigurationService> _configService = new();
        private readonly Mock<IMonitorConfigurationRepoService> _configRepo = new();
        private readonly Mock<IMonitorIncidentService> _incidentService = new();
        private readonly Mock<IMonitorPingService> _pingService = new();
        private readonly Mock<ReleaseDriver.IReleaseDriverService> _releaseDriver = new();
        private readonly Mock<ILogger<MonitorController>> _logger = new();

        private MonitorController CreateSut() =>
            new(_configService.Object, _pingService.Object, _configRepo.Object, _incidentService.Object,
                _releaseDriver.Object, _logger.Object);

        private static T Body<T>(IActionResult result) =>
            (T)result.Should().BeOfType<OkObjectResult>().Subject.Value;

        [Fact]
        public async Task GetMonitorList_ReturnsServiceResult()
        {
            var expected = new PaginatedResponse { IsSuccess = true, TotalCount = 3 };
            _configService.Setup(s => s.GetConfigurationListAsync("p", null, 0, 10, null, false)).ReturnsAsync(expected);

            var result = await CreateSut().GetMonitorList("p", null);

            Body<PaginatedResponse>(result).Should().BeSameAs(expected);
        }

        [Fact]
        public async Task GetMonitorListByRepoId_ReturnsServiceResult()
        {
            var expected = new BaseApiResponse { IsSuccess = true };
            _configService.Setup(s => s.GetConfigurationListWithDowntimeByRepoIdAsync("p", "r")).ReturnsAsync(expected);

            var result = await CreateSut().GetMonitorListByRepoId("p", "r");

            Body<BaseApiResponse>(result).Should().BeSameAs(expected);
        }

        [Fact]
        public async Task GetMonitorById_ReturnsServiceResult()
        {
            var expected = new BaseApiResponse { IsSuccess = true };
            _configService.Setup(s => s.GetConfigurationByIdAsync("m1")).ReturnsAsync(expected);

            var result = await CreateSut().GetMonitorById("m1");

            Body<BaseApiResponse>(result).Should().BeSameAs(expected);
        }

        [Fact]
        public async Task SaveMonitor_DelegatesToService()
        {
            var request = new SaveMonitorConfigurationRequest();
            var expected = new BaseApiResponse { IsSuccess = true };
            _configService.Setup(s => s.SaveConfigurationAsync(request)).ReturnsAsync(expected);

            var result = await CreateSut().SaveMonitor(request);

            Body<BaseApiResponse>(result).Should().BeSameAs(expected);
        }

        [Fact]
        public async Task UpdateMonitor_DelegatesToService()
        {
            var request = new UpdateMonitorConfigurationRequest();
            var expected = new BaseApiResponse { IsSuccess = true };
            _configService.Setup(s => s.UpdateConfigurationAsync(request)).ReturnsAsync(expected);

            var result = await CreateSut().UpdateMonitor(request);

            Body<BaseApiResponse>(result).Should().BeSameAs(expected);
        }

        [Fact]
        public async Task DeleteMonitor_DelegatesToService()
        {
            var expected = new BaseApiResponse { IsSuccess = true };
            _configService.Setup(s => s.DeleteConfigurationAsync("m1")).ReturnsAsync(expected);

            var result = await CreateSut().DeleteMonitor("m1");

            Body<BaseApiResponse>(result).Should().BeSameAs(expected);
        }

        [Fact]
        public async Task GetIncidentList_DelegatesToIncidentService()
        {
            var expected = new PaginatedResponse { IsSuccess = true };
            _incidentService.Setup(s => s.GetIncidentsByMonitorIdAsync("m1", 0, 10, null, true)).ReturnsAsync(expected);

            var result = await CreateSut().GetIncidentList("m1");

            Body<PaginatedResponse>(result).Should().BeSameAs(expected);
        }

        [Fact]
        public async Task GetMonitorDetails_DelegatesToIncidentService()
        {
            var expected = new MonitorDetailsResponse { IsSuccess = true };
            _incidentService.Setup(s => s.GetIncidentsDurationByDateRangeAsync("m1")).ReturnsAsync(expected);

            var result = await CreateSut().GetMonitorDetails("m1");

            Body<MonitorDetailsResponse>(result).Should().BeSameAs(expected);
        }

        [Fact]
        public async Task GetMonitorResponseTime_DelegatesToPingService()
        {
            var expected = new BaseApiResponse { IsSuccess = true };
            _pingService.Setup(s => s.GetPingLogsByDateRangeAsync("m1", "s", "e")).ReturnsAsync(expected);

            var result = await CreateSut().GetMonitorResponseTime("m1", "s", "e");

            Body<BaseApiResponse>(result).Should().BeSameAs(expected);
        }

        [Fact]
        public async Task GetMonitorDownTime_DelegatesToIncidentService()
        {
            var expected = new BaseApiResponse { IsSuccess = true };
            _incidentService.Setup(s => s.GetDownTimeLogsByDateRangeAsync("m1", null, null)).ReturnsAsync(expected);

            var result = await CreateSut().GetMonitorDownTime("m1", null, null);

            Body<BaseApiResponse>(result).Should().BeSameAs(expected);
        }

        [Fact]
        public async Task IsExternalServiceConfigured_WrapsRepoResultInSuccessResponse()
        {
            var config = new MonitorConfiguration { ItemId = "m1" };
            _configRepo.Setup(r => r.GetExternalServiceConfigurationAsync("ext1")).ReturnsAsync(config);

            var result = await CreateSut().IsExternalServiceConfigured("ext1");

            var body = Body<BaseApiResponse>(result);
            body.IsSuccess.Should().BeTrue();
            body.Data.Should().BeSameAs(config);
        }

        // ---------------------------------------------------------------------------------
        // #201 — GET /Monitor/repos-list, backed by IReleaseDriverService.
        // ---------------------------------------------------------------------------------

        private static readonly System.Reflection.MethodInfo ReposListAction =
            typeof(MonitorController).GetMethod(nameof(MonitorController.GetReposList))!;

        [Fact]
        public async Task GetReposList_DelegatesToDriverAndReturnsItsResponse()
        {
            // H1. Returned as-is rather than re-mapped, so the driver's own envelope fields survive.
            var expected = new ReleaseDriver.BaseApiResponse { IsSuccess = true };
            _releaseDriver.Setup(d => d.GetReposListAsync()).ReturnsAsync(expected);

            var result = await CreateSut().GetReposList();

            result.Should().BeOfType<OkObjectResult>()
                  .Which.Value.Should().BeSameAs(expected);
            _releaseDriver.Verify(d => d.GetReposListAsync(), Times.Once);
        }

        [Fact]
        public async Task GetReposList_EmptyListIsStillSuccess()
        {
            // Ticket example 2: no repos is a valid 200, not a failure.
            var expected = new ReleaseDriver.BaseApiResponse { IsSuccess = true, Data = new List<object>() };
            _releaseDriver.Setup(d => d.GetReposListAsync()).ReturnsAsync(expected);

            var result = await CreateSut().GetReposList();

            result.Should().BeOfType<OkObjectResult>();
        }

        [Fact]
        public async Task GetReposList_WhenDriverReportsFailure_Returns400WithEnvelope()
        {
            // C2. The status code on the BODY is asserted as well as the HTTP status: BaseApiResponse
            // defaults StatusCode, so a body-only check would pass while the payload was wrong.
            _releaseDriver.Setup(d => d.GetReposListAsync())
                          .ReturnsAsync(new ReleaseDriver.BaseApiResponse { IsSuccess = false });

            var result = await CreateSut().GetReposList();

            var bad = result.Should().BeOfType<BadRequestObjectResult>().Subject;
            bad.StatusCode.Should().Be(400);
            var body = bad.Value.Should().BeOfType<BaseApiResponse>().Subject;
            body.IsSuccess.Should().BeFalse();
            body.StatusCode.Should().Be(System.Net.HttpStatusCode.BadRequest);
            body.Message.Should().Be(MonitorController.FailedToGetRepos);
        }

        [Fact]
        public async Task GetReposList_WhenDriverReturnsNull_Returns400()
        {
            // A null response is a failure, not a 200 carrying null.
            _releaseDriver.Setup(d => d.GetReposListAsync()).ReturnsAsync((ReleaseDriver.BaseApiResponse)null!);

            var result = await CreateSut().GetReposList();

            result.Should().BeOfType<BadRequestObjectResult>();
        }

        [Fact]
        public async Task GetReposList_WhenDriverThrows_Returns500AndLogsError()
        {
            // C5. Asserting only "an envelope came back and something was logged" would accept
            // Ok({ isSuccess: false }), which contradicts the ticket's error contract - so the HTTP
            // status, the body's own StatusCode and the log LEVEL are all pinned.
            _releaseDriver.Setup(d => d.GetReposListAsync()).ThrowsAsync(new InvalidOperationException("driver down"));

            var result = await CreateSut().GetReposList();

            var obj = result.Should().BeOfType<ObjectResult>().Subject;
            obj.StatusCode.Should().Be(500);
            var body = obj.Value.Should().BeOfType<BaseApiResponse>().Subject;
            body.IsSuccess.Should().BeFalse();
            body.StatusCode.Should().Be(System.Net.HttpStatusCode.InternalServerError);
            body.Message.Should().Be(MonitorController.FailedToGetRepos);

            _logger.Verify(
                l => l.Log(LogLevel.Error, It.IsAny<EventId>(), It.IsAny<It.IsAnyType>(),
                           It.IsAny<Exception>(), (Func<It.IsAnyType, Exception?, string>)It.IsAny<object>()),
                Times.AtLeastOnce);
        }

        [Fact]
        public async Task GetReposList_CancellationPropagates()
        {
            // C5b. A cancellation must not be laundered into a 500 the caller never caused.
            // Narrower than it looks: GetReposListAsync takes no CancellationToken, so this proves
            // an upstream cancellation is preserved - NOT that HttpContext.RequestAborted flows through.
            _releaseDriver.Setup(d => d.GetReposListAsync()).ThrowsAsync(new OperationCanceledException());

            var act = () => CreateSut().GetReposList();

            await act.Should().ThrowAsync<OperationCanceledException>();
        }

        [Fact]
        public void GetReposList_RouteEscapesTheControllerTemplate_AndResolvesToMonitorReposList()
        {
            // The route is the one thing a unit test can get wrong and still ship broken: a relative
            // "repos-list" template COMBINES with the class-level "[controller]/[action]", giving
            // Monitor/GetReposList/repos-list and a 404 against the documented URL.
            //
            // Combination is checked with the framework's own AttributeRouteModel.CombineTemplates
            // rather than by reading the attribute string and trusting my own understanding of the
            // rule - that is precisely the part worth not asserting from memory.
            var template = ReposListAction.GetCustomAttributes(typeof(HttpGetAttribute), false)
                                          .Cast<HttpGetAttribute>().Single().Template;

            var controllerTemplate = typeof(MonitorController)
                .GetCustomAttributes(typeof(RouteAttribute), true)
                .Cast<RouteAttribute>().Single().Template;

            AttributeRouteModel.CombineTemplates(controllerTemplate, template)
                               .Should().Be("Monitor/repos-list");
        }

        [Fact]
        public void GetReposList_RequiresAuthorization()
        {
            // C1, and the honest limit of it: this proves the action carries an authorize
            // requirement, NOT that authentication middleware is present or correctly ordered. A
            // real 401 would need an HTTP boundary, and standing one up here is not possible -
            // Program.cs reads the vault before the builder even exists, and this project has
            // neither Mvc.Testing nor TestHost.
            ReposListAction.GetCustomAttributes(typeof(AuthorizeAttribute), true)
                           .Should().NotBeEmpty();

            // [Authorize] alone is not enough to assert: an [AllowAnonymous] alongside it wins, and
            // the original test would have passed happily while the endpoint was open.
            ReposListAction.GetCustomAttributes(true).OfType<IAllowAnonymous>()
                           .Should().BeEmpty("AllowAnonymous would override the authorize requirement");
            typeof(MonitorController).GetCustomAttributes(true).OfType<IAllowAnonymous>()
                           .Should().BeEmpty("a controller-level AllowAnonymous would open every action");
        }

        [Fact]
        public void ProgramRegistersTheReleaseDriverBeforeBuildingTheApp()
        {
            // H2, asserted structurally on purpose. RegisterBlocksReleaseServicesAsync reads its own
            // vault secrets, so it cannot be invoked hermetically; and invoking it from a test would
            // only show that the extension registers something - never that Program.cs calls it.
            // Real post-registration resolution belongs in an environment smoke test.
            var programPath = LocateProgramCs();
            // Comments AND string literals are stripped first, so the search can only match
            // executable code: a raw text search would be satisfied by the call appearing only in
            // the comment that explains it, or assigned to a string.
            var program = StripCommentsAndLiterals(File.ReadAllText(programPath));

            var registerIndex = program.IndexOf("await services.RegisterBlocksReleaseServicesAsync(vaultType)",
                                                StringComparison.Ordinal);
            var buildIndex = program.IndexOf("builder.Build()", StringComparison.Ordinal);

            registerIndex.Should().BeGreaterThan(-1, "the driver must be registered, awaited, with the vault type already resolved for ConfigureLogAndSecretsAsync");
            buildIndex.Should().BeGreaterThan(-1);
            registerIndex.Should().BeLessThan(buildIndex, "registration after Build() would never reach the container");
        }

        /// <summary>
        /// Blanks out comments and string literals so the search below can only match executable
        /// code. Without this the assertion is vacuous - satisfied by the call appearing solely in
        /// a comment, or assigned to a string that is never executed.
        /// </summary>
        private static string StripCommentsAndLiterals(string source)
        {
            // Single left-to-right scan, no regex - every escaping layer between here and the file
            // is another place to get it quietly wrong. Blanks out // line comments, /* */ block
            // comments and "..." literals, so the search can only match executable code. Review
            // cycle 2 was right that comments alone were not enough: `var marker = "await
            // services.RegisterBlocksReleaseServicesAsync(vaultType)";` would have compiled,
            // registered nothing, and passed.
            var output = new System.Text.StringBuilder(source.Length);

            for (var i = 0; i < source.Length; i++)
            {
                if (source[i] == '/' && i + 1 < source.Length && source[i + 1] == '/')
                {
                    while (i < source.Length && source[i] != '\n') i++;
                    if (i < source.Length) output.Append('\n');
                    continue;
                }

                if (source[i] == '/' && i + 1 < source.Length && source[i + 1] == '*')
                {
                    i += 2;
                    while (i + 1 < source.Length && !(source[i] == '*' && source[i + 1] == '/')) i++;
                    i++;
                    output.Append(' ');
                    continue;
                }

                if (source[i] == '"')
                {
                    i++;
                    while (i < source.Length && source[i] != '"')
                    {
                        if (source[i] == '\\') i++;   // skip the escaped character
                        i++;
                    }
                    output.Append("\"\"");
                    continue;
                }

                output.Append(source[i]);
            }

            return output.ToString();
        }

        private static string LocateProgramCs()
        {
            for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            {
                var candidate = Path.Combine(dir.FullName, "Api", "Program.cs");
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }

            throw new FileNotFoundException("could not locate Api/Program.cs above " + AppContext.BaseDirectory);
        }
    }
}
