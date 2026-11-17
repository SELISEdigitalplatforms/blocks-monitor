using System.Security.Claims;
using Api.Madp;
using Blocks.Genesis;
using FluentAssertions;
using Microsoft.AspNetCore.Http;

namespace XUnitTest.Api.Middleware;

public class MadpCallerTests
{
    private static BlocksContext Caller(bool authenticated = true, DateTime? expires = null) => BlocksContext.Create(
        tenantId: "verified-tenant", roles: ["viewer"], userId: "verified-user", isAuthenticated: authenticated,
        requestUri: "https://blocks.example", organizationId: "default", expireOn: expires ?? DateTime.UtcNow.AddMinutes(5),
        email: "user@example.test", permissions: ["blocks-madp::project::read"], userName: "user@example.test",
        phoneNumber: string.Empty, displayName: "Verified User", oauthToken: "never-forward-me",
        originalTenantId: "root", applicationDomain: "blocks.example", impersonated: true);

    [Fact]
    public void Reads_verified_genesis_values_without_promoting_impersonation_to_owner()
    {
        var context = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([], "verified")) };
        BlocksContext.ExecuteInContext(Caller(), () =>
        {
            var identity = new GenesisMadpCallerAccessor().GetCaller(context);
            identity.Should().NotBeNull();
            identity!.TenantId.Should().Be("verified-tenant");
            identity.UserId.Should().Be("verified-user");
            identity.Roles.Should().Equal("viewer");
            identity.Permissions.Should().Equal("blocks-madp::project::read");
        });
    }

    [Fact]
    public void A_context_without_authenticated_http_principal_is_not_trusted()
    {
        BlocksContext.ExecuteInContext(Caller(), () =>
            new GenesisMadpCallerAccessor().GetCaller(new DefaultHttpContext()).Should().BeNull());
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(true, true)]
    public void Rejects_unauthenticated_or_expired_genesis_context(bool authenticated, bool expired)
    {
        var context = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([], "verified")) };
        BlocksContext.ExecuteInContext(Caller(authenticated, expired ? DateTime.UtcNow.AddMinutes(-1) : null), () =>
            new GenesisMadpCallerAccessor().GetCaller(context).Should().BeNull());
    }
}
