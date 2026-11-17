using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Blocks.Genesis;
using Devops.DomainService.Deployment.Interfaces;
using Devops.DomainService.VersionControlSystems.Interfaces;
using Microsoft.Extensions.Caching.Memory;

namespace Api.Madp.Repositories;

/// <summary>Private worker-to-Blocks repository boundary. Never accepts a browser session.</summary>
public sealed class MadpRepositoryBroker(RequestDelegate next, IConfiguration configuration, IMemoryCache replay)
{
    public const string Path = "/internal/madp/repositories";
    private static readonly Regex Id = new("^[A-Za-z0-9_-]{1,128}$", RegexOptions.CultureInvariant);
    private static readonly Regex Repository = new("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$", RegexOptions.CultureInvariant);
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public async Task InvokeAsync(HttpContext http)
    {
        if (http.Request.Path != Path) { await next(http); return; }
        http.Response.Headers.CacheControl = "no-store";
        if (http.Request.Method != "POST" || !IsPrivateRequest(http)) { await Fail(http, 403, "forbidden"); return; }
        var key = configuration["Madp:RepositoryKey"];
        if (string.IsNullOrWhiteSpace(key) || Encoding.UTF8.GetByteCount(key) < 32) { await Fail(http, 503, "not_configured"); return; }
        if (http.Request.ContentLength is > 16384) { await Fail(http, 413, "invalid_input"); return; }
        using var bytes = new MemoryStream();
        var buffer = new byte[4096];
        int read;
        while ((read = await http.Request.Body.ReadAsync(buffer, http.RequestAborted)) > 0)
        {
            if (bytes.Length + read > 16384) { await Fail(http, 413, "invalid_input"); return; }
            bytes.Write(buffer, 0, read);
        }
        var raw = bytes.ToArray();
        if (!VerifySignature(key, http.Request.Path + http.Request.QueryString, raw, http.Request.Headers["X-Madp-Worker-Signature"].ToString()))
        { await Fail(http, 403, "forbidden"); return; }
        RepositoryRequest? request;
        try { request = JsonSerializer.Deserialize<RepositoryRequest>(raw, Json); }
        catch (JsonException) { await Fail(http, 400, "invalid_input"); return; }
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (request is null || request.V != 1 || request.IssuedAt < now - 60 || request.IssuedAt > now + 60 || !Regex.IsMatch(request.Nonce ?? "", "^[a-f0-9]{32}$")
            || !Id.IsMatch(request.TenantId ?? "") || !ValidUserId(request.UserId) || !Repository.IsMatch(request.Repository ?? "")
            || request.Repository!.Split('/').Any(p => p is "." or "..") || !ValidBranch(request.Branch)
            || request.Operation is not ("verify" or "branches" or "credential"))
        { await Fail(http, 400, "invalid_input"); return; }
        // The signature authenticates the worker; the nonce makes each authorization single-use.
        lock (replay)
        {
            if (replay.TryGetValue("madp-repository:" + request.Nonce, out _)) { request = null; }
            else replay.Set("madp-repository:" + request.Nonce, true, TimeSpan.FromSeconds(125));
        }
        if (request is null) { await Fail(http, 409, "replayed_request"); return; }
        var previous = BlocksContext.GetContext();
        try
        {
            BlocksContext.SetContext(BlocksContext.Create(tenantId: request.TenantId, roles: [], userId: request.UserId,
                isAuthenticated: true, requestUri: Path, organizationId: "default", expireOn: DateTime.UtcNow.AddMinutes(1),
                email: "", permissions: [], userName: "", phoneNumber: "", displayName: "", oauthToken: "",
                originalTenantId: request.TenantId, applicationDomain: http.Request.Host.Host, impersonated: false), changeContext: true);
            // Resolve after setting the scoped context; these services choose the tenant and user from it.
            var repos = http.RequestServices.GetRequiredService<IRepoRepository>();
            var connected = await repos.GetRepos() ?? [];
            var matches = connected.Where(repo => !repo.IsArchived && string.Equals(repo.ProjectId, request.TenantId, StringComparison.OrdinalIgnoreCase)
                && string.Equals(GithubRepository(repo.RepoUrl), request.Repository, StringComparison.OrdinalIgnoreCase)).ToArray();
            if (matches.Length == 0) { await Fail(http, 403, "repository_not_connected"); return; }
            var people = await repos.GetProjectPeopleList(request.TenantId!);
            if (!people.Contains(request.UserId, StringComparer.Ordinal)) { await Fail(http, 403, "project_access_revoked"); return; }
            // Resolve the connection's credential owner from Blocks itself, never a worker-supplied owner id.
            var connection = matches.OrderByDescending(repo => repo.BlocksUserId == request.UserId).ThenBy(repo => repo.ItemId, StringComparer.Ordinal).First();
            if (string.IsNullOrWhiteSpace(connection.BlocksUserId)) { await Fail(http, 403, "repository_credentials_unavailable"); return; }
            BlocksContext.SetContext(BlocksContext.Create(tenantId: request.TenantId, roles: [], userId: connection.BlocksUserId,
                isAuthenticated: true, requestUri: Path, organizationId: "default", expireOn: DateTime.UtcNow.AddMinutes(1),
                email: "", permissions: [], userName: "", phoneNumber: "", displayName: "", oauthToken: "",
                originalTenantId: request.TenantId, applicationDomain: http.Request.Host.Host, impersonated: false), changeContext: true);
            var github = http.RequestServices.GetRequiredService<IVersionControlService>();
            if (request.Operation == "branches")
            {
                var branches = await github.GetBranches(request.Repository);
                await http.Response.WriteAsJsonAsync(new { ok = true, data = new { branches = branches.Select(b => new { b.name }) } }, http.RequestAborted);
                return;
            }
            var branch = await github.GetRepoBranchByName(request.Repository, request.Branch);
            if (!branch.Item1) { await Fail(http, 403, "repository_branch_unavailable"); return; }
            if (request.Operation == "verify")
            {
                await http.Response.WriteAsJsonAsync(new { ok = true, data = new { repository = request.Repository, branch = request.Branch, connectionId = connection.ItemId } }, http.RequestAborted);
                return;
            }
            var credential = await github.GetPushCredential();
            if (credential is null || string.IsNullOrWhiteSpace(credential.Token) || string.IsNullOrWhiteSpace(credential.Username)
                || (credential.ExpiresAt.HasValue && credential.ExpiresAt.Value <= DateTime.UtcNow))
            { await Fail(http, 403, "repository_credentials_unavailable"); return; }
            await http.Response.WriteAsJsonAsync(new { ok = true, data = new { username = credential.Username, token = credential.Token,
                expiresAt = credential.ExpiresAt, repository = request.Repository, connectionId = connection.ItemId } }, http.RequestAborted);
        }
        catch (Exception) when (!http.Response.HasStarted)
        {
            // Driver errors can include provider payloads; neither return nor log them.
            await Fail(http, 503, "repository_unavailable");
        }
        finally
        {
            if (previous is null) BlocksContext.ClearContext(); else BlocksContext.SetContext(previous, changeContext: true);
        }
    }

    public static bool IsPrivateRequest(HttpContext http) =>
        (http.Request.IsHttps || (http.Connection.RemoteIpAddress is { } peer && IPAddress.IsLoopback(peer)))
        && !http.Request.Headers.ContainsKey("Origin") && !http.Request.Headers.ContainsKey("Referer")
        && !http.Request.Headers.ContainsKey("Cookie") && !http.Request.Headers.Keys.Any(k => k.StartsWith("Sec-Fetch-", StringComparison.OrdinalIgnoreCase));

    public static bool VerifySignature(string key, string path, byte[] body, string signature)
    {
        if (!Regex.IsMatch(signature, "^[A-Za-z0-9_-]{43}$", RegexOptions.CultureInvariant)) return false;
        try
        {
            var expected = HMACSHA256.HashData(Encoding.UTF8.GetBytes(key), Encoding.UTF8.GetBytes("POST\n" + path + "\n" + Convert.ToHexStringLower(SHA256.HashData(body))));
            var actual = Convert.FromBase64String(signature.Replace('-', '+').Replace('_', '/') + new string('=', (4 - signature.Length % 4) % 4));
            return CryptographicOperations.FixedTimeEquals(expected, actual);
        }
        catch (FormatException) { return false; }
    }

    public static string? GithubRepository(string? value)
    {
        if (value is null) return null;
        var ssh = Regex.Match(value, "^git@github\\.com:([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\\.git)?/?$", RegexOptions.IgnoreCase);
        if (ssh.Success) return ssh.Groups[1].Value;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var url) || url.Scheme != "https" || url.Host != "github.com" || url.UserInfo.Length > 0 || url.Query.Length > 0) return null;
        var name = url.AbsolutePath.Trim('/');
        if (name.EndsWith(".git", StringComparison.OrdinalIgnoreCase)) name = name[..^4];
        return Repository.IsMatch(name) && !name.Split('/').Any(p => p is "." or "..") ? name : null;
    }

    private static bool ValidBranch(string? value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 255 && !value.Contains("..")
        && !value.Contains("@{") && !value.EndsWith('.') && !value.EndsWith('/') && !value.StartsWith('-') && !value.StartsWith('/')
        && !value.Any(c => char.IsControl(c) || char.IsWhiteSpace(c) || "~^:?*[\\".Contains(c));
    private static bool ValidUserId(string? value) => !string.IsNullOrWhiteSpace(value) && value.Length <= 256 && value.Trim() == value && !value.Any(char.IsControl);
    private static Task Fail(HttpContext http, int status, string code)
    { http.Response.StatusCode = status; return http.Response.WriteAsJsonAsync(new { ok = false, error = new { code } }, http.RequestAborted); }
    private sealed record RepositoryRequest(int V, long IssuedAt, string Nonce, string TenantId, string UserId, string Repository, string Branch, string Operation);
}
