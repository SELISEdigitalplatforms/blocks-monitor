using System.Threading.Tasks;
using Api.Controllers;
using DomainService.Monitor.Entity;
using DomainService.Monitor.Models;
using DomainService.Monitor.MonitorIncidentService;
using DomainService.Monitor.Services;
using DomainService.Shared.Models;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc;
using Moq;

namespace XUnitTest.Api
{
    public class MonitorControllerTests
    {
        private readonly Mock<IMonitorConfigurationService> _configService = new();
        private readonly Mock<IMonitorConfigurationRepoService> _configRepo = new();
        private readonly Mock<IMonitorIncidentService> _incidentService = new();
        private readonly Mock<IMonitorPingService> _pingService = new();

        private MonitorController CreateSut() =>
            new(_configService.Object, _pingService.Object, _configRepo.Object, _incidentService.Object);

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
    }
}
