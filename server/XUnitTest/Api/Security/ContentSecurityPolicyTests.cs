using Api.Security;
using FluentAssertions;
using Microsoft.Extensions.Configuration;

namespace XUnitTest.Api.Security;

/// <summary>
/// The SPA's CSP, ported from blocks-iam. Two things went wrong with the first version of this
/// policy and both are pinned here: the host list was hardcoded to <c>dev-*</c> (stg and prod
/// could not reach their own IAM), and <c>style-src 'self'</c> blocked the inline styles the
/// login page and UI libraries inject at runtime.
/// </summary>
public class ContentSecurityPolicyTests
{
    private static IConfiguration Config(Dictionary<string, string?> values) =>
        new ConfigurationBuilder().AddInMemoryCollection(values).Build();

    // ---------- Origins follow configuration, not the code ----------

    [Fact]
    public void Build_UsesTheConfiguredEnvironmentsHosts()
    {
        var policy = ContentSecurityPolicy.Build(Config(new()
        {
            ["FrontendRuntime:BLOCKS_IAM_BASE_URL"] = "https://iam.example.com",
            ["FrontendRuntime:BLOCKS_OS_BASE_URL"] = "https://os.example.com",
            ["FrontendRuntime:BLOCKS_DATA_BASE_URL"] = "https://data.example.com",
        }));

        policy.Should().Contain("https://iam.example.com");
        policy.Should().Contain("https://os.example.com");
        policy.Should().Contain("https://data.example.com");
    }

    [Fact]
    public void Build_NamesNoEnvironmentItWasNotConfiguredWith()
    {
        // The regression this class exists for. A hardcoded dev host list meant the policy
        // was right on dev and would have stopped the SPA reaching its own API on stg/prod.
        var policy = ContentSecurityPolicy.Build(Config(new()
        {
            ["FrontendRuntime:BLOCKS_IAM_BASE_URL"] = "https://stg-iam.blocksdevelopers.com",
            ["FrontendRuntime:BLOCKS_OS_BASE_URL"] = "https://stg-os.blocksdevelopers.com",
        }));

        policy.Should().NotContain("dev-iam.blocksdevelopers.com");
        policy.Should().NotContain("dev-os.blocksdevelopers.com");
    }

    [Fact]
    public void Build_FormActionIsTheIdentityHostAndThePortal()
    {
        var policy = ContentSecurityPolicy.Build(Config(new()
        {
            ["FrontendRuntime:BLOCKS_IAM_BASE_URL"] = "https://iam.example.com",
            ["FrontendRuntime:BLOCKS_OS_BASE_URL"] = "https://os.example.com",
            ["FrontendRuntime:BLOCKS_DATA_BASE_URL"] = "https://data.example.com",
        }));

        var formAction = Directive(policy, "form-action");
        formAction.Should().Contain("https://iam.example.com");
        formAction.Should().Contain("https://os.example.com");
        formAction.Should().NotContain("https://data.example.com");
    }

    // ---------- WebSockets need their own scheme ----------

    [Fact]
    public void Build_EmitsTheWebSocketFormOfTheLogicHost()
    {
        // A CSP source is scheme-sensitive: https://host does not permit wss://host, which is
        // why the hardcoded policy listed wss://dev-logic separately.
        var policy = ContentSecurityPolicy.Build(Config(new()
        {
            ["FrontendRuntime:BLOCKS_LOGIC_BASE_URL"] = "https://logic.example.com",
        }));

        var connect = Directive(policy, "connect-src");
        connect.Should().Contain("https://logic.example.com");
        connect.Should().Contain("wss://logic.example.com");
    }

    // ---------- Third-party origins the runtime config cannot describe ----------

    [Fact]
    public void Build_AppendsConfiguredExtraOrigins()
    {
        var policy = ContentSecurityPolicy.Build(Config(new()
        {
            ["Csp:ExtraConnectSrc"] = "https://api.rollbar.com https://code.selise.biz",
            ["Csp:ExtraImgSrc"] = "https://cdn.example.com",
        }));

        Directive(policy, "connect-src").Should().Contain("https://api.rollbar.com");
        Directive(policy, "connect-src").Should().Contain("https://code.selise.biz");
        Directive(policy, "img-src").Should().Contain("https://cdn.example.com");
    }

    // ---------- Directives that must not drift ----------

    [Fact]
    public void Build_KeepsInlineStylesAllowedAndInlineScriptsBlocked()
    {
        var policy = ContentSecurityPolicy.Build(Config([]));

        Directive(policy, "style-src").Should().Contain("'unsafe-inline'");
        Directive(policy, "script-src").Should().NotContain("'unsafe-inline'");
        Directive(policy, "script-src").Should().NotContain("'unsafe-eval'");
    }

    [Fact]
    public void Build_KeepsTheFramingAndObjectRestrictions()
    {
        var policy = ContentSecurityPolicy.Build(Config([]));

        policy.Should().Contain("frame-ancestors 'none'");
        policy.Should().Contain("object-src 'none'");
        policy.Should().Contain("base-uri 'self'");
    }

    // ---------- A malformed value cannot inject a directive ----------

    [Theory]
    [InlineData("not-a-url")]
    [InlineData("javascript:alert(1)")]
    [InlineData("https://evil.example.com; script-src *")]
    public void ToOrigin_RejectsAnythingThatIsNotAnHttpOrWebSocketOrigin(string value)
    {
        // "https://evil...; script-src *" parses as a URI whose path carries the injection,
        // so the assertion is that only the authority survives -- never the directive.
        var origin = ContentSecurityPolicy.ToOrigin(value);
        (origin == null || !origin.Contains("script-src", StringComparison.Ordinal)).Should().BeTrue();
    }

    [Fact]
    public void ToOrigin_DropsPathQueryAndTrailingSlash()
    {
        ContentSecurityPolicy.ToOrigin("https://iam.example.com/api/?x=1")
            .Should().Be("https://iam.example.com");
    }

    [Fact]
    public void Build_ExtraOriginsCannotInjectADirective()
    {
        var policy = ContentSecurityPolicy.Build(Config(new()
        {
            ["Csp:ExtraConnectSrc"] = "https://ok.example.com; script-src * 'unsafe-eval'",
            ["Csp:ExtraImgSrc"] = "javascript:alert(1), data:text/html,x",
        }));

        Directive(policy, "connect-src").Should().Contain("https://ok.example.com");
        Directive(policy, "script-src").Should().Be(" 'self'");
        policy.Should().NotContain("unsafe-eval");
        policy.Should().NotContain("javascript:");
        policy.Should().NotContain("text/html");
    }

    [Fact]
    public void Build_WithNoConfigurationAllowsOnlySelf()
    {
        var policy = ContentSecurityPolicy.Build(Config([]));

        Directive(policy, "connect-src").Should().Be(" 'self'");
        Directive(policy, "form-action").Should().Be(" 'self'");
    }

    /// <summary>The sources of one directive, without its name or the trailing separator.</summary>
    private static string Directive(string policy, string name)
    {
        var parts = policy.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var directive = parts.Single(p => p.StartsWith(name + " ", StringComparison.Ordinal)
                                          || p.Equals(name, StringComparison.Ordinal));
        return directive[name.Length..];
    }
}
