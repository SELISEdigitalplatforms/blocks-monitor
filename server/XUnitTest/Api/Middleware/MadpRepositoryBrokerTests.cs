using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Api.Madp.Repositories;
using Devops.DomainService.Deployment.Entities;
using Devops.DomainService.Deployment.Interfaces;
using Devops.DomainService.VersionControlSystems.Interfaces;
using Devops.DomainService.VersionControlSystems.Models.Response;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Moq;

namespace XUnitTest.Api.Middleware;

public class MadpRepositoryBrokerTests
{
    private const string Key = "test-only-worker-key-00000000000000000000";
    private static DefaultHttpContext Request(string operation = "credential", string nonce = "0123456789abcdef0123456789abcdef")
    {
        var context = new DefaultHttpContext();
        context.Request.Scheme = "https";
        context.Request.Host = new HostString("blocks.test");
        context.Request.Path = MadpRepositoryBroker.Path;
        context.Request.Method = "POST";
        var body = JsonSerializer.SerializeToUtf8Bytes(new { v = 1, issuedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds(), nonce,
            tenantId = "tenant", userId = "provider|person", repository = "company/portal", branch = "dev", operation });
        context.Request.Body = new MemoryStream(body);
        context.Request.ContentLength = body.Length;
        context.Response.Body = new MemoryStream();
        var signature = HMACSHA256.HashData(Encoding.UTF8.GetBytes(Key), Encoding.UTF8.GetBytes("POST\n" + MadpRepositoryBroker.Path + "\n" + Convert.ToHexStringLower(SHA256.HashData(body))));
        context.Request.Headers["X-Madp-Worker-Signature"] = Convert.ToBase64String(signature).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        return context;
    }
    private static MadpRepositoryBroker Broker(IMemoryCache? replay = null) => new(_ => Task.CompletedTask,
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Madp:RepositoryKey"] = Key }).Build(), replay ?? new MemoryCache(new MemoryCacheOptions()));

    [Theory]
    [InlineData("Origin")]
    [InlineData("Referer")]
    [InlineData("Cookie")]
    [InlineData("Sec-Fetch-Site")]
    public async Task Browser_requests_never_receive_a_credential_even_with_a_valid_signature(string header)
    {
        var request = Request(); request.Request.Headers[header] = "present";
        await Broker().InvokeAsync(request);
        request.Response.StatusCode.Should().Be(403);
    }

    [Fact]
    public async Task Rejects_tampered_request_before_any_service_is_resolved()
    {
        var request = Request(); request.Request.Headers["X-Madp-Worker-Signature"] = "invalid";
        await Broker().InvokeAsync(request);
        request.Response.StatusCode.Should().Be(403);
    }

    [Fact]
    public async Task A_worker_authorization_cannot_be_replayed()
    {
        using var replay = new MemoryCache(new MemoryCacheOptions());
        var broker = Broker(replay);
        var first = Request("verify");
        // No services are configured; the first valid authorization is consumed even when its operation fails.
        await broker.InvokeAsync(first);
        first.Response.StatusCode.Should().Be(503);
        var second = Request("verify");
        await broker.InvokeAsync(second);
        second.Response.StatusCode.Should().Be(409);
    }

    [Fact]
    public void Signatures_bind_the_endpoint_and_exact_request_bytes()
    {
        var body = Encoding.UTF8.GetBytes("request");
        var signature = Convert.ToBase64String(HMACSHA256.HashData(Encoding.UTF8.GetBytes(Key), Encoding.UTF8.GetBytes("POST\n/internal/madp/repositories\n" + Convert.ToHexStringLower(SHA256.HashData(body))))).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        MadpRepositoryBroker.VerifySignature(Key, MadpRepositoryBroker.Path, body, signature).Should().BeTrue();
        MadpRepositoryBroker.VerifySignature(Key, "/another", body, signature).Should().BeFalse();
        MadpRepositoryBroker.VerifySignature(Key, MadpRepositoryBroker.Path, Encoding.UTF8.GetBytes("changed"), signature).Should().BeFalse();
    }

    [Fact]
    public async Task Credentials_come_from_the_connected_Blocks_owner_after_requester_membership_check()
    {
        var repos = new Mock<IRepoRepository>();
        repos.Setup(r => r.GetRepos()).ReturnsAsync([new Repo { ItemId = "connection", ProjectId = "tenant", BlocksUserId = "connection-owner", RepoUrl = "https://github.com/company/portal.git", RepoName = "portal" }]);
        repos.Setup(r => r.GetProjectPeopleList("tenant")).ReturnsAsync(["provider|person"]);
        var github = new Mock<IVersionControlService>();
        github.Setup(g => g.GetRepoBranchByName("company/portal", "dev")).ReturnsAsync((true, "commit"));
        github.Setup(g => g.GetPushCredential()).ReturnsAsync(new GitPushCredentialResponse { Username = "x-access-token", Token = "test-private-token" });
        var request = Request();
        request.RequestServices = new ServiceCollection().AddSingleton(repos.Object).AddSingleton(github.Object).BuildServiceProvider();
        await Broker().InvokeAsync(request);
        request.Response.StatusCode.Should().Be(200);
        github.Verify(g => g.GetPushCredential(), Times.Once);
        request.Response.Body.Position = 0;
        using var body = await JsonDocument.ParseAsync(request.Response.Body);
        body.RootElement.GetProperty("data").GetProperty("connectionId").GetString().Should().Be("connection");
    }

    [Fact]
    public async Task A_revoked_project_member_never_reaches_the_credential_service()
    {
        var repos = new Mock<IRepoRepository>();
        repos.Setup(r => r.GetRepos()).ReturnsAsync([new Repo { ProjectId = "tenant", BlocksUserId = "owner", RepoUrl = "https://github.com/company/portal" }]);
        repos.Setup(r => r.GetProjectPeopleList("tenant")).ReturnsAsync([]);
        var github = new Mock<IVersionControlService>();
        var request = Request(); request.RequestServices = new ServiceCollection().AddSingleton(repos.Object).AddSingleton(github.Object).BuildServiceProvider();
        await Broker().InvokeAsync(request);
        request.Response.StatusCode.Should().Be(403);
        github.Verify(g => g.GetPushCredential(), Times.Never);
    }

    [Theory]
    [InlineData("https://github.com/company/portal.git", "company/portal")]
    [InlineData("git@github.com:company/portal.git", "company/portal")]
    [InlineData("https://github.com.attacker.test/company/portal", null)]
    [InlineData("https://user@github.com/company/portal", null)]
    public void Only_official_connected_provider_addresses_are_accepted(string address, string? expected) =>
        MadpRepositoryBroker.GithubRepository(address).Should().Be(expected);
}
