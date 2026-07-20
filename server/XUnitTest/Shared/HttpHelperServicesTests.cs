using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Threading;
using System.Threading.Tasks;
using Blocks.Genesis;
using DomainService.Shared.Services;
using FluentAssertions;
using Microsoft.Extensions.Logging;
using Moq;
using Moq.Protected;

namespace XUnitTest.Shared
{
    public class HttpHelperServicesTests
    {
        public class TestDto
        {
            public string Name { get; set; }
        }

        private readonly Mock<IHttpService> _httpService = new();
        private readonly Mock<ILogger<HttpHelperServices>> _logger = new();

        private HttpHelperServices CreateSut(HttpMessageHandler handler)
        {
            var factory = new Mock<IHttpClientFactory>();
            factory.Setup(f => f.CreateClient(It.IsAny<string>())).Returns(new HttpClient(handler));
            return new HttpHelperServices(_httpService.Object, factory.Object, _logger.Object);
        }

        private static Mock<HttpMessageHandler> Handler(HttpStatusCode status, string body)
        {
            var handler = new Mock<HttpMessageHandler>();
            handler.Protected()
                .Setup<Task<HttpResponseMessage>>("SendAsync", ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
                .ReturnsAsync(new HttpResponseMessage(status) { Content = new StringContent(body) });
            return handler;
        }

        private static Mock<HttpMessageHandler> ThrowingHandler(System.Exception ex)
        {
            var handler = new Mock<HttpMessageHandler>();
            handler.Protected()
                .Setup<Task<HttpResponseMessage>>("SendAsync", ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
                .ThrowsAsync(ex);
            return handler;
        }

        [Fact]
        public async Task MakeHttpRequest_SuccessJson_DeserializesBody()
        {
            var sut = CreateSut(Handler(HttpStatusCode.OK, "{\"Name\":\"api\"}").Object);

            var (data, response) = await sut.MakeHttpRequest<TestDto>("c", "http://x", HttpMethod.Get);

            response.StatusCode.Should().Be(HttpStatusCode.OK);
            data.Should().NotBeNull();
            data!.Name.Should().Be("api");
        }

        [Fact]
        public async Task MakeHttpRequest_HeadRequest_ReturnsNullDataWithoutReadingBody()
        {
            var sut = CreateSut(Handler(HttpStatusCode.OK, "ignored").Object);

            var (data, response) = await sut.MakeHttpRequest<TestDto>("c", "http://x", HttpMethod.Head);

            data.Should().BeNull();
            response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task MakeHttpRequest_NonSuccessWithJson_StillDeserializes()
        {
            var sut = CreateSut(Handler(HttpStatusCode.BadRequest, "{\"Name\":\"err\"}").Object);

            var (data, response) = await sut.MakeHttpRequest<TestDto>("c", "http://x", HttpMethod.Get);

            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            data!.Name.Should().Be("err");
        }

        [Fact]
        public async Task MakeHttpRequest_ServiceUnavailable_LogsWarning()
        {
            var sut = CreateSut(Handler(HttpStatusCode.ServiceUnavailable, "{}").Object);

            var (_, response) = await sut.MakeHttpRequest<TestDto>("c", "http://x", HttpMethod.Get);

            response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
            _logger.Verify(l => l.Log(LogLevel.Warning, It.IsAny<EventId>(),
                It.Is<It.IsAnyType>((v, t) => v.ToString().Contains("Service Unavailable")),
                It.IsAny<System.Exception>(), It.IsAny<System.Func<It.IsAnyType, System.Exception, string>>()), Times.Once);
        }

        [Fact]
        public async Task MakeHttpRequest_WhenConnectionFails_ReturnsUnreachableResponse()
        {
            var sut = CreateSut(ThrowingHandler(new HttpRequestException("no route")).Object);

            var (data, response) = await sut.MakeHttpRequest<TestDto>("c", "http://x", HttpMethod.Get);

            data.Should().BeNull();
            ((int)response.StatusCode).Should().Be(0);
            response.ReasonPhrase.Should().Be("Unreachable");
        }

        [Fact]
        public async Task MakeHttpRequest_WhenTimeout_ReturnsRequestTimeout()
        {
            var sut = CreateSut(ThrowingHandler(new TaskCanceledException("timeout")).Object);

            var (data, response) = await sut.MakeHttpRequest<TestDto>("c", "http://x", HttpMethod.Get);

            data.Should().BeNull();
            response.StatusCode.Should().Be(HttpStatusCode.RequestTimeout);
            response.ReasonPhrase.Should().Be("Timeout");
        }

        [Fact]
        public async Task MakeHttpRequest_PostSerializesPayload()
        {
            HttpRequestMessage captured = null;
            var handler = new Mock<HttpMessageHandler>();
            handler.Protected()
                .Setup<Task<HttpResponseMessage>>("SendAsync", ItExpr.IsAny<HttpRequestMessage>(), ItExpr.IsAny<CancellationToken>())
                .Callback<HttpRequestMessage, CancellationToken>((req, _) => captured = req)
                .ReturnsAsync(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{}") });
            var sut = CreateSut(handler.Object);

            await sut.MakeHttpRequest<TestDto>("c", "http://x", HttpMethod.Post, new { Name = "p" });

            captured!.Content.Should().NotBeNull();
        }

        [Fact]
        public async Task MakeHttpGetRequest_ReturnsData()
        {
            _httpService.Setup(s => s.Get<TestDto>(It.IsAny<string>(), It.IsAny<Dictionary<string, string>>(),
                    It.IsAny<CancellationToken>(), It.IsAny<int?>()))
                .ReturnsAsync((new TestDto { Name = "g" }, "raw"));
            var sut = CreateSut(Handler(HttpStatusCode.OK, "{}").Object);

            var (data, raw) = await sut.MakeHttpGetRequest<TestDto>("http://x");

            data!.Name.Should().Be("g");
            raw.Should().Be("raw");
        }

        [Fact]
        public async Task MakeHttpGetRequest_WhenServiceThrows_ReturnsFailure()
        {
            _httpService.Setup(s => s.Get<TestDto>(It.IsAny<string>(), It.IsAny<Dictionary<string, string>>(),
                    It.IsAny<CancellationToken>(), It.IsAny<int?>()))
                .ThrowsAsync(new System.Exception("boom"));
            var sut = CreateSut(Handler(HttpStatusCode.OK, "{}").Object);

            var (data, raw) = await sut.MakeHttpGetRequest<TestDto>("http://x");

            data.Should().BeNull();
            raw.Should().Be("Operation Failed.");
        }

        [Fact]
        public async Task MakeHttpPostRequest_ReturnsData()
        {
            _httpService.Setup(s => s.Post<TestDto>(It.IsAny<object>(), It.IsAny<string>(), It.IsAny<string>(),
                    It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>(), It.IsAny<int?>()))
                .ReturnsAsync((new TestDto { Name = "p" }, "raw"));
            var sut = CreateSut(Handler(HttpStatusCode.OK, "{}").Object);

            var (data, raw) = await sut.MakeHttpPostRequest<TestDto>(new { }, "http://x");

            data!.Name.Should().Be("p");
            raw.Should().Be("raw");
        }

        [Fact]
        public async Task MakeHttpPostRequest_WhenServiceThrows_ReturnsFailure()
        {
            _httpService.Setup(s => s.Post<TestDto>(It.IsAny<object>(), It.IsAny<string>(), It.IsAny<string>(),
                    It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>(), It.IsAny<int?>()))
                .ThrowsAsync(new System.Exception("boom"));
            var sut = CreateSut(Handler(HttpStatusCode.OK, "{}").Object);

            var (data, raw) = await sut.MakeHttpPostRequest<TestDto>(new { }, "http://x");

            data.Should().BeNull();
            raw.Should().Be("Operation Failed.");
        }

        [Fact]
        public async Task MakeHttpDeleteRequest_DeserializesResponse()
        {
            var sut = CreateSut(Handler(HttpStatusCode.OK, "{\"Name\":\"deleted\"}").Object);

            var (data, response) = await sut.MakeHttpDeleteRequest<TestDto>("c", "http://x", HttpMethod.Delete, new { id = 1 });

            data!.Name.Should().Be("deleted");
            response.StatusCode.Should().Be(HttpStatusCode.OK);
        }

        [Fact]
        public async Task MakeHttpDeleteRequest_NonSuccess_LogsAndDeserializes()
        {
            var sut = CreateSut(Handler(HttpStatusCode.NotFound, "{\"Name\":\"x\"}").Object);

            var (_, response) = await sut.MakeHttpDeleteRequest<TestDto>("c", "http://x", HttpMethod.Delete);

            response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        }

        [Fact]
        public async Task MakeHttpDeleteRequest_WhenHandlerThrows_ReturnsNull()
        {
            var sut = CreateSut(ThrowingHandler(new HttpRequestException("boom")).Object);

            var (data, _) = await sut.MakeHttpDeleteRequest<TestDto>("c", "http://x", HttpMethod.Delete);

            data.Should().BeNull();
        }

        [Fact]
        public async Task MakeHttpRequestTE_Success_ReturnsTypedData()
        {
            var sut = CreateSut(Handler(HttpStatusCode.OK, "{\"Name\":\"ok\"}").Object);

            var (data, error, response) = await sut.MakeHttpRequest<TestDto, TestDto>("c", "http://x", HttpMethod.Post, new { });

            data!.Name.Should().Be("ok");
            error.Should().BeNull();
            response.IsSuccessStatusCode.Should().BeTrue();
        }

        [Fact]
        public async Task MakeHttpRequestTE_Failure_ReturnsErrorData()
        {
            var sut = CreateSut(Handler(HttpStatusCode.BadRequest, "{\"Name\":\"bad\"}").Object);

            var (data, error, response) = await sut.MakeHttpRequest<TestDto, TestDto>("c", "http://x", HttpMethod.Get);

            data.Should().BeNull();
            error!.Name.Should().Be("bad");
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        }

        [Fact]
        public async Task MakeHttpRequestTE_WhenHandlerThrows_ReturnsNulls()
        {
            var sut = CreateSut(ThrowingHandler(new HttpRequestException("boom")).Object);

            var (data, error, _) = await sut.MakeHttpRequest<TestDto, TestDto>("c", "http://x", HttpMethod.Get);

            data.Should().BeNull();
            error.Should().BeNull();
        }
    }
}
