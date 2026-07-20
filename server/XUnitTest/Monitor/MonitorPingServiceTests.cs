using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using DomainService.Shared.Services;
using DomainService.Monitor.Entity;
using DomainService.Monitor.Models;
using DomainService.Monitor.MonitorIncidentService;
using DomainService.Monitor.MonitorSchedulingService;
using DomainService.Monitor.Services;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;

namespace XUnitTest.Monitor
{
    public class MonitorPingServiceTests
    {
        private readonly Mock<IMonitorConfigurationRepoService> _configRepo = new();
        private readonly Mock<IHttpHelperServices> _http = new();
        private readonly Mock<IMonitorQueueManager> _queue = new();
        private readonly Mock<IMonitorIncidentService> _incident = new();
        private readonly Mock<IMonitorPingRepoService> _pingRepo = new();
        private readonly Mock<ILogger<MonitorPingService>> _logger = new();

        private MonitorPingService CreateSut() =>
            new(_configRepo.Object, _http.Object, _queue.Object, _incident.Object, _pingRepo.Object, _logger.Object);

        private void SetupHttp(object? response, HttpResponseMessage httpResponse, Action<HttpMethod>? captureMethod = null)
        {
            _http.Setup(h => h.MakeHttpRequest<object>(
                    It.IsAny<string>(), It.IsAny<string>(), It.IsAny<HttpMethod>(),
                    It.IsAny<object>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<string>()))
                .Callback<string, string, HttpMethod, object, Dictionary<string, string>, string>(
                    (_, _, method, _, _, _) => captureMethod?.Invoke(method))
                .ReturnsAsync((response, httpResponse));
        }

        [Fact]
        public async Task MonitorPingAsync_SuccessResponse_PopulatesLogAndPersists()
        {
            var config = new MonitorConfiguration { ItemId = "m1", Url = "http://svc", HttpMethodType = HttpMethodTypes.GET };
            SetupHttp(null, new HttpResponseMessage(HttpStatusCode.OK) { ReasonPhrase = "OK" });
            var sut = CreateSut();

            var log = await sut.MonitorPingAsync(config);

            log.StatusCode.Should().Be(200);
            log.IsSuccess.Should().BeTrue();
            log.MonitorId.Should().Be("m1");
            log.Url.Should().Be("http://svc");
            _pingRepo.Verify(r => r.SavePingLogAsync(It.Is<MonitorPingLog>(l => l.StatusCode == 200)), Times.Once);
            _incident.Verify(i => i.HandleIncidentAsync(config, It.IsAny<MonitorPingLog>()), Times.Once);
        }

        [Fact]
        public async Task MonitorPingAsync_WhenResponseBodyPresent_ReadsContentIntoResponseMessage()
        {
            var config = new MonitorConfiguration { ItemId = "m1", Url = "http://svc" };
            var httpResponse = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("hello-body")
            };
            SetupHttp(new object(), httpResponse);
            var sut = CreateSut();

            var log = await sut.MonitorPingAsync(config);

            log.ResponseMessage.Should().Be("hello-body");
        }

        [Theory]
        [InlineData(HttpMethodTypes.HEAD, "HEAD")]
        [InlineData(HttpMethodTypes.POST, "POST")]
        [InlineData(HttpMethodTypes.GET, "GET")]
        public async Task MonitorPingAsync_MapsHttpMethodTypeToHttpMethod(HttpMethodTypes type, string expected)
        {
            var config = new MonitorConfiguration { ItemId = "m1", Url = "http://svc", HttpMethodType = type };
            HttpMethod? captured = null;
            SetupHttp(null, new HttpResponseMessage(HttpStatusCode.OK), m => captured = m);
            var sut = CreateSut();

            await sut.MonitorPingAsync(config);

            captured!.Method.Should().Be(expected);
        }

        [Fact]
        public async Task MonitorPingAsync_WhenHttpMethodTypeNull_DefaultsToGet()
        {
            var config = new MonitorConfiguration { ItemId = "m1", Url = "http://svc", HttpMethodType = null };
            HttpMethod? captured = null;
            SetupHttp(null, new HttpResponseMessage(HttpStatusCode.OK), m => captured = m);
            var sut = CreateSut();

            await sut.MonitorPingAsync(config);

            captured!.Method.Should().Be("GET");
        }

        [Fact]
        public async Task MonitorPingAsync_ParsesCustomPayloadAndHeaders()
        {
            var config = new MonitorConfiguration
            {
                ItemId = "m1",
                Url = "http://svc",
                HttpMethodType = HttpMethodTypes.POST,
                CustomPayload = "{\"a\":1}",
                CustomHttpHeaders = "{\"X-Test\":\"v\"}"
            };
            object? capturedPayload = null;
            Dictionary<string, string>? capturedHeaders = null;
            _http.Setup(h => h.MakeHttpRequest<object>(
                    It.IsAny<string>(), It.IsAny<string>(), It.IsAny<HttpMethod>(),
                    It.IsAny<object>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<string>()))
                .Callback<string, string, HttpMethod, object, Dictionary<string, string>, string>(
                    (_, _, _, payload, headers, _) => { capturedPayload = payload; capturedHeaders = headers; })
                .ReturnsAsync((null, new HttpResponseMessage(HttpStatusCode.OK)));
            var sut = CreateSut();

            await sut.MonitorPingAsync(config);

            capturedPayload.Should().NotBeNull();
            capturedHeaders.Should().ContainKey("X-Test").WhoseValue.Should().Be("v");
        }

        [Fact]
        public async Task MonitorPingAsync_WhenHttpThrows_RecordsErrorWithStatusMinusOne()
        {
            var config = new MonitorConfiguration { ItemId = "m1", Url = "http://svc" };
            _http.Setup(h => h.MakeHttpRequest<object>(
                    It.IsAny<string>(), It.IsAny<string>(), It.IsAny<HttpMethod>(),
                    It.IsAny<object>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<string>()))
                .ThrowsAsync(new InvalidOperationException("boom"));
            var sut = CreateSut();

            var log = await sut.MonitorPingAsync(config);

            log.StatusCode.Should().Be(-1);
            log.IsSuccess.Should().BeFalse();
            log.ResponseMessage.Should().Contain("boom");
            // Even on failure the ping is persisted and the incident pipeline is invoked.
            _pingRepo.Verify(r => r.SavePingLogAsync(It.IsAny<MonitorPingLog>()), Times.Once);
            _incident.Verify(i => i.HandleIncidentAsync(config, It.IsAny<MonitorPingLog>()), Times.Once);
        }

        [Fact]
        public async Task InitializeQueueAsync_EnqueuesEachActiveConfiguration()
        {
            _configRepo.Setup(r => r.GetAllConfigurationListAsync()).ReturnsAsync(new List<MonitorConfiguration>
            {
                new() { ItemId = "a", Url = "http://a" },
                new() { ItemId = "b", Url = "http://b" }
            });
            var sut = CreateSut();

            await sut.InitializeQueueAsync();

            _queue.Verify(q => q.Enqueue(It.IsAny<MonitorQueueTask>()), Times.Exactly(2));
        }

        [Fact]
        public async Task GetPingLogsByDateRangeAsync_WhenMonitorIdEmpty_ReturnsFailure()
        {
            var sut = CreateSut();
            var result = await sut.GetPingLogsByDateRangeAsync("  ", null, null);

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("MonitorId");
        }

        [Fact]
        public async Task GetPingLogsByDateRangeAsync_WhenEndBeforeStart_ReturnsFailure()
        {
            var sut = CreateSut();
            var result = await sut.GetPingLogsByDateRangeAsync("m1", "2024-01-10T00:00:00Z", "2024-01-01T00:00:00Z");

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("earlier");
        }

        [Fact]
        public async Task GetPingLogsByDateRangeAsync_WhenConfigNotFound_ReturnsFailure()
        {
            _configRepo.Setup(r => r.GetConfigurationAsync("m1")).ReturnsAsync((MonitorConfiguration?)null);
            var sut = CreateSut();

            var result = await sut.GetPingLogsByDateRangeAsync("m1", null, null);

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("not found");
        }

        [Fact]
        public async Task GetPingLogsByDateRangeAsync_WhenNoLogs_ReturnsSuccessWithEmptyList()
        {
            _configRepo.Setup(r => r.GetConfigurationAsync("m1")).ReturnsAsync(new MonitorConfiguration { ItemId = "m1" });
            _pingRepo.Setup(r => r.GetPingLogsByDateRangeAsync("m1", It.IsAny<string>(), It.IsAny<string>()))
                .ReturnsAsync(new List<MonitorPingLogSummary>());
            var sut = CreateSut();

            var result = await sut.GetPingLogsByDateRangeAsync("m1", null, null);

            result.IsSuccess.Should().BeTrue();
            result.Data.Should().BeAssignableTo<List<MonitorPingLogSummary>>().Which.Should().BeEmpty();
        }

        [Fact]
        public async Task GetPingLogsByDateRangeAsync_WhenLogsExist_ReturnsThem()
        {
            var logs = new List<MonitorPingLogSummary> { new() { MonitorId = "m1", StatusCode = 200 } };
            _configRepo.Setup(r => r.GetConfigurationAsync("m1")).ReturnsAsync(new MonitorConfiguration { ItemId = "m1" });
            _pingRepo.Setup(r => r.GetPingLogsByDateRangeAsync("m1", It.IsAny<string>(), It.IsAny<string>()))
                .ReturnsAsync(logs);
            var sut = CreateSut();

            var result = await sut.GetPingLogsByDateRangeAsync("m1", "2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z");

            result.IsSuccess.Should().BeTrue();
            result.Data.Should().BeSameAs(logs);
        }

        [Fact]
        public async Task GetPingLogsByDateRangeAsync_WhenRepoThrows_ReturnsFailure()
        {
            _configRepo.Setup(r => r.GetConfigurationAsync("m1")).ThrowsAsync(new Exception("db down"));
            var sut = CreateSut();

            var result = await sut.GetPingLogsByDateRangeAsync("m1", null, null);

            result.IsSuccess.Should().BeFalse();
            result.Message.Should().Contain("db down");
        }
    }
}
