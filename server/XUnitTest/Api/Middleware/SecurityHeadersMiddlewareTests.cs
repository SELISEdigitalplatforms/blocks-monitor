using Api.Middleware;
using FluentAssertions;
using Microsoft.AspNetCore.Http;

namespace XUnitTest.Api.Middleware;

public class SecurityHeadersMiddlewareTests
{
    [Fact]
    public void Apply_sets_browser_security_headers()
    {
        var context = new DefaultHttpContext();
        context.Request.Path = "/";

        SecurityHeadersMiddleware.Apply(context);

        var headers = context.Response.Headers;
        headers["X-Content-Type-Options"].ToString().Should().Be("nosniff");
        headers["X-Frame-Options"].ToString().Should().Be("DENY");
        headers["Strict-Transport-Security"].ToString().Should().Contain("max-age=31536000");
        var csp = headers["Content-Security-Policy"].ToString();
        csp.Should().Contain("default-src 'self'");
        csp.Should().Contain("script-src 'self'");
        csp.Should().NotContain("unsafe-inline");
        headers["Cache-Control"].ToString().Should().Contain("no-store");
    }

    [Fact]
    public void Apply_sets_immutable_cache_for_assets()
    {
        var context = new DefaultHttpContext();
        context.Request.Path = "/assets/index.js";

        SecurityHeadersMiddleware.Apply(context);

        context.Response.Headers["Cache-Control"].ToString()
            .Should().Contain("immutable");
    }
}
