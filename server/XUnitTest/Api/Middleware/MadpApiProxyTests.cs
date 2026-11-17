using System.Net;
using System.Text;
using System.Security.Cryptography;
using System.Text.Json;
using Api.Madp;
using Api.Middleware;
using Api.Security;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Configuration;
using Moq;

namespace XUnitTest.Api.Middleware;

public class MadpApiProxyTests
{
    private const string TestKey = "test-only-madp-bridge-key-not-for-deployment";
    private static readonly MadpCaller Caller = new("tenant-verified", "user-verified", "user@example.test", "Test User",
        ["user"], ["madp.write"], DateTimeOffset.UtcNow.AddHours(1));
    private static DefaultHttpContext Context(string path = "/madp-api/api/data", string method = "POST")
    {
        var context = new DefaultHttpContext();
        context.Request.Scheme = "https";
        context.Request.Host = new HostString("blocks.example");
        context.Request.Path = path;
        context.Request.Method = method;
        context.Request.Headers.Origin = "https://blocks.example";
        context.Request.Headers["Sec-Fetch-Site"] = "same-origin";
        context.Response.Body = new MemoryStream();
        return context;
    }

    private static MadpApiProxy Proxy(HttpMessageHandler handler, string? target = "https://factory.example",
        bool authenticated = true, string? key = TestKey)
    {
        var factory = new Mock<IHttpClientFactory>();
        factory.Setup(f => f.CreateClient(MadpApiProxy.ClientName)).Returns(new HttpClient(handler));
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Madp:ApiBaseUrl"] = target,
            ["Madp:BridgeKey"] = key,
        }).Build();
        var callers = new Mock<IMadpCallerAccessor>();
        callers.Setup(c => c.GetCaller(It.IsAny<HttpContext>())).Returns(authenticated ? Caller : null);
        return new MadpApiProxy(_ => Task.CompletedTask, factory.Object, config, callers.Object, new MadpBridgeSigner(config));
    }

    [Fact]
    public async Task Signs_verified_identity_and_exact_body_without_forwarding_any_browser_credentials()
    {
        var context = Context();
        context.Request.QueryString = new QueryString("?page=2");
        var body = "{\"reads\":[]}";
        context.Request.Body = new MemoryStream(Encoding.UTF8.GetBytes(body));
        context.Request.ContentLength = Encoding.UTF8.GetByteCount(body);
        context.Request.ContentType = "application/json";
        context.Request.Headers.Cookie = "blocks-token=do-not-forward; mf_session=v1.session";
        context.Request.Headers.Authorization = "Bearer do-not-forward";
        context.Request.Headers["X-Madp-Context"] = "spoofed";
        context.Request.Headers["X-Madp-Signature"] = "spoofed";
        context.Request.Headers["X-Blocks-Key"] = "spoofed-tenant";
        context.Request.Headers.Connection = "X-Hop";
        context.Request.Headers["X-Hop"] = "private";
        var handler = new Handler(async request =>
        {
            request.RequestUri.Should().Be(new Uri("https://factory.example/api/data?page=2"));
            request.Headers.Host.Should().Be("factory.example");
            request.Headers.GetValues("Origin").Should().Equal("https://factory.example");
            request.Headers.Referrer.Should().Be(new Uri("https://factory.example/"));
            request.Headers.Contains("Cookie").Should().BeFalse();
            request.Headers.Contains("Authorization").Should().BeFalse();
            request.Headers.Contains("X-Blocks-Key").Should().BeFalse();
            request.Headers.Contains("X-Hop").Should().BeFalse();
            (await request.Content!.ReadAsStringAsync()).Should().Be(body);
            var hash = request.Headers.GetValues(MadpBridgeSigner.BodyHashHeader).Single();
            hash.Should().Be(Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(body))));
            var assertion = request.Headers.GetValues(MadpBridgeSigner.ContextHeader).Single();
            var json = JsonDocument.Parse(Convert.FromBase64String(assertion.Replace('-', '+').Replace('_', '/') + new string('=', (4 - assertion.Length % 4) % 4)));
            json.RootElement.GetProperty("tenantId").GetString().Should().Be(Caller.TenantId);
            json.RootElement.GetProperty("userId").GetString().Should().Be(Caller.UserId);
            (json.RootElement.GetProperty("exp").GetInt64() - json.RootElement.GetProperty("iat").GetInt64()).Should().BeInRange(1, 45);
            var canonical = $"POST\n/api/data?page=2\n{hash}\n{assertion}";
            var signature = Convert.ToBase64String(HMACSHA256.HashData(Encoding.UTF8.GetBytes(TestKey), Encoding.UTF8.GetBytes(canonical))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
            request.Headers.GetValues(MadpBridgeSigner.SignatureHeader).Should().Equal(signature);
            var response = new HttpResponseMessage(HttpStatusCode.Created) { Content = new StringContent("{\"ok\":true}") };
            response.Headers.TryAddWithoutValidation("Set-Cookie", "mf_session=v1.rotated; Domain=factory.example; Path=/; HttpOnly; SameSite=Lax; Secure");
            response.Headers.TryAddWithoutValidation("Set-Cookie", "unrelated=discard; Path=/");
            return response;
        });

        await Proxy(handler).InvokeAsync(context);

        context.Response.StatusCode.Should().Be(201);
        context.Response.Headers.SetCookie.Should().BeEmpty();
        context.Response.Headers.CacheControl.ToString().Should().Be("no-store");
    }

    [Theory]
    [InlineData("https://evil.example", "same-origin")]
    [InlineData("https://blocks.example", "cross-site")]
    [InlineData("null", "same-origin")]
    public async Task Refuses_cross_origin_calls_before_rewriting_headers(string origin, string fetchSite)
    {
        var context = Context();
        context.Request.Headers.Origin = origin;
        context.Request.Headers["Sec-Fetch-Site"] = fetchSite;
        var handler = new Handler(_ => throw new InvalidOperationException("must not call upstream"));

        await Proxy(handler).InvokeAsync(context);

        context.Response.StatusCode.Should().Be(403);
    }

    [Fact]
    public async Task Anonymous_callers_are_rejected_before_any_upstream_request()
    {
        var context = Context();
        await Proxy(new Handler(_ => throw new InvalidOperationException()), authenticated: false).InvokeAsync(context);
        context.Response.StatusCode.Should().Be(401);
    }

    [Fact]
    public async Task A_stale_project_view_cannot_use_another_projects_verified_session()
    {
        var context = Context();
        context.Request.Headers["X-Madp-Expected-Tenant"] = "another-tenant";
        await Proxy(new Handler(_ => throw new InvalidOperationException())).InvokeAsync(context);
        context.Response.StatusCode.Should().Be(409);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("too-short")]
    public async Task Missing_bridge_key_fails_closed(string? key)
    {
        var context = Context();
        await Proxy(new Handler(_ => throw new InvalidOperationException()), key: key).InvokeAsync(context);
        context.Response.StatusCode.Should().Be(503);
    }

    [Fact]
    public async Task Rejects_oversized_requests_before_reading_or_forwarding_them()
    {
        var context = Context();
        context.Request.ContentLength = MadpApiProxy.MaxRequestBodyBytes + 1;
        await Proxy(new Handler(_ => throw new InvalidOperationException())).InvokeAsync(context);
        context.Response.StatusCode.Should().Be(413);
    }

    [Fact]
    public async Task Uses_same_origin_referer_for_browser_gets()
    {
        var context = Context(method: "GET");
        context.Request.Headers.Remove("Origin");
        context.Request.Headers.Referer = "https://blocks.example/madp/index.html";
        MadpApiProxy.IsSameOrigin(context.Request).Should().BeTrue();
        context.Request.Headers.Referer = "https://evil.example/madp/index.html";
        MadpApiProxy.IsSameOrigin(context.Request).Should().BeFalse();
        await Task.CompletedTask;
    }

    [Fact]
    public void Trusted_public_origin_handles_tls_termination_without_trusting_forwarded_headers()
    {
        var context = Context();
        context.Request.Scheme = "http";
        context.Request.Host = new HostString("internal-api:5001");
        MadpApiProxy.IsSameOrigin(context.Request).Should().BeFalse();
        MadpApiProxy.IsSameOrigin(context.Request, "https://blocks.example").Should().BeTrue();
        MadpApiProxy.IsSameOrigin(context.Request, "https://wrong.example").Should().BeFalse();
        MadpApiProxy.IsSameOrigin(context.Request, "invalid").Should().BeFalse();
    }

    [Fact]
    public void Preserves_real_browser_origin_before_development_tenant_header_normalization()
    {
        var context = Context();
        context.Request.Scheme = "http";
        context.Request.Host = new HostString("gateway:5001");
        context.Request.Headers.Origin = "https://dev-monitor.blocksdevelopers.com:4001";
        context.Request.Headers.Referer = "https://dev-monitor.blocksdevelopers.com:4001/madp/index.html";
        MadpApiProxy.CaptureBrowserOrigin(context);
        context.Request.Headers.Origin = "https://dev-monitor.blocksdevelopers.com/";
        context.Request.Headers.Referer = "https://dev-monitor.blocksdevelopers.com/";
        // Repeated calls cannot overwrite the preserved server-side value.
        MadpApiProxy.CaptureBrowserOrigin(context);
        MadpApiProxy.IsSameOrigin(context.Request, "https://dev-monitor.blocksdevelopers.com:4001").Should().BeTrue();
        MadpApiProxy.IsSameOrigin(context.Request, "https://dev-monitor.blocksdevelopers.com").Should().BeFalse();
    }

    [Fact]
    public async Task Missing_configuration_is_a_service_error_without_contacting_an_upstream()
    {
        var context = Context();
        await Proxy(new Handler(_ => throw new InvalidOperationException()), null).InvokeAsync(context);
        context.Response.StatusCode.Should().Be(503);
    }

    [Fact]
    public async Task Unreachable_upstream_is_a_gateway_error()
    {
        var context = Context();
        await Proxy(new Handler(_ => throw new HttpRequestException())).InvokeAsync(context);
        context.Response.StatusCode.Should().Be(502);
    }

    [Fact]
    public async Task Upstream_timeout_is_a_gateway_timeout_with_useful_json()
    {
        var context = Context();
        await Proxy(new Handler(_ => throw new TaskCanceledException())).InvokeAsync(context);
        context.Response.StatusCode.Should().Be(504);
        context.Response.Body.Position = 0;
        (await new StreamReader(context.Response.Body).ReadToEndAsync()).Should().Contain("madp_timeout");
    }

    [Fact]
    public async Task Proxied_design_preview_keeps_its_opaque_origin_sandbox_and_allows_same_origin_framing()
    {
        var context = Context("/madp-api/api/design-preview/project/revision", "GET");
        const string previewPolicy = "sandbox allow-scripts allow-forms; default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; frame-ancestors 'self'";
        var proxy = Proxy(new Handler(_ =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent("<html>preview</html>", Encoding.UTF8, "text/html"),
            };
            response.Headers.TryAddWithoutValidation("Content-Security-Policy", previewPolicy);
            response.Headers.TryAddWithoutValidation("X-Frame-Options", "SAMEORIGIN");
            return Task.FromResult(response);
        }));
        var middleware = new SecurityHeadersMiddleware(proxy.InvokeAsync,
            ContentSecurityPolicy.BuildPolicy([], [], []), new StyleNonce(new byte[32]));

        await middleware.InvokeAsync(context);
        // Apply again to exercise the response's OnStarting behavior after proxying.
        SecurityHeadersMiddleware.Apply(context, ContentSecurityPolicy.BuildPolicy([], [], []));

        context.Response.Headers["X-Frame-Options"].ToString().Should().Be("SAMEORIGIN");
        context.Response.Headers.ContentSecurityPolicy.ToString().Should().Be(previewPolicy);
        context.Response.ContentType.Should().StartWith("text/html");
    }

    [Theory]
    [InlineData("/madp-api/index.html")]
    [InlineData("/madp-api/api/../admin")]
    [InlineData("/madp-api/api/%2e%2e/admin")]
    [InlineData("/madp-api//external.example/api/data")]
    public async Task Refuses_frontend_and_traversal_paths(string path)
    {
        var context = Context(path);
        await Proxy(new Handler(_ => throw new InvalidOperationException())).InvokeAsync(context);
        context.Response.StatusCode.Should().Be(404);
    }

    [Fact]
    public async Task Preserves_binary_download_content_and_response_metadata()
    {
        var context = Context("/madp-api/api/files/download", "GET");
        var bytes = new byte[] { 0, 1, 127, 255 };
        await Proxy(new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(bytes)
            {
                Headers = { ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/zip") },
            },
        }))).InvokeAsync(context);
        ((MemoryStream)context.Response.Body).ToArray().Should().Equal(bytes);
        context.Response.ContentType.Should().Be("application/zip");
    }

    [Fact]
    public async Task Does_not_pass_external_redirects_to_the_browser()
    {
        var context = Context();
        await Proxy(new Handler(_ => Task.FromResult(new HttpResponseMessage(HttpStatusCode.Redirect)
        {
            Headers = { Location = new Uri("https://external.example/steal") },
        }))).InvokeAsync(context);
        context.Response.Headers.Location.Should().BeEmpty();
    }

    [Theory]
    [InlineData("https://factory.example", true)]
    [InlineData("http://localhost:5310/", true)]
    [InlineData("https://user:password@factory.example", false)]
    [InlineData("https://factory.example/path", false)]
    [InlineData("https://factory.example?secret=1", false)]
    [InlineData("file:///etc/passwd", false)]
    public void Only_configured_http_origins_are_accepted(string value, bool valid)
    {
        MadpApiProxy.TryApiOrigin(value, out _).Should().Be(valid);
    }

    [Fact]
    public void Embedded_policy_allows_only_same_origin_framing_and_keeps_scripts_strict()
    {
        var shellPolicy = ContentSecurityPolicy.BuildPolicy([], [], []);
        var context = Context("/madp/index.html", "GET");
        SecurityHeadersMiddleware.Apply(context, ContentSecurityPolicy.ForMadpFrame(shellPolicy));
        context.Response.Headers["X-Frame-Options"].ToString().Should().Be("SAMEORIGIN");
        context.Response.Headers.ContentSecurityPolicy.ToString().Should().Contain("frame-ancestors 'self'")
            .And.Contain("script-src 'self';").And.Contain("style-src 'self' 'unsafe-inline'");
        shellPolicy.Should().Contain("frame-ancestors 'none'").And.NotContain("style-src 'self' 'unsafe-inline'");
        var api = Context("/api/Monitor/GetMonitorList");
        SecurityHeadersMiddleware.Apply(api, shellPolicy);
        api.Response.Headers["X-Frame-Options"].ToString().Should().Be("DENY");
    }

    private sealed class Handler(Func<HttpRequestMessage, Task<HttpResponseMessage>> send) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken) => send(request);
    }
}
