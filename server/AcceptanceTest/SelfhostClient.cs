using System.Net;
using System.Text;
using System.Text.Json;
using System.Web;

namespace AcceptanceTest;

/// <summary>
/// HTTP calls to blocks-selfhost: the API sign-in of local-setup\verify-login.ps1 (initiate, authorize, login, callback),
/// the monitor endpoints, and Mailpit. Never prints a password or a token.
/// </summary>
public sealed class SelfhostClient : IDisposable
{
    private readonly Settings _s;
    private readonly HttpClient _http = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(60) };
    private string? _token;

    public SelfhostClient(Settings settings) => _s = settings;

    public string ProjectKey => _s.TenantId;

    public void Dispose() => _http.Dispose();

    private static string Enc(string v) => Uri.EscapeDataString(v);

    private async Task<(HttpStatusCode Status, string Body, Uri? Location)> Send(HttpMethod method, string url, Dictionary<string, string>? headers = null, string? json = null)
    {
        using var req = new HttpRequestMessage(method, url);
        foreach (var (k, v) in headers ?? [])
        {
            req.Headers.TryAddWithoutValidation(k, v);
        }
        if (json is not null)
        {
            req.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }
        using var res = await _http.SendAsync(req);
        return (res.StatusCode, await res.Content.ReadAsStringAsync(), res.Headers.Location);
    }

    public async Task SignIn()
    {
        if (_token is not null)
        {
            return;
        }
        var key = new Dictionary<string, string> { ["X-Blocks-Key"] = _s.TenantId };
        var init = await Send(HttpMethod.Get, $"{_s.IamUrl}/api/idp/initiate?x-blocks-key={_s.TenantId}&clientId={Enc(_s.ClientId)}&redirectUri={Enc(_s.RedirectUri)}", key);
        Check(init.Status == HttpStatusCode.OK, $"idp/initiate returned {(int)init.Status}");
        var authorize = JsonDocument.Parse(init.Body).RootElement.GetProperty("redirect_uri").GetString()!;
        if (!string.IsNullOrEmpty(_s.PublicIamUrl) && authorize.StartsWith(_s.PublicIamUrl, StringComparison.Ordinal))
        {
            authorize = _s.IamUrl + authorize[_s.PublicIamUrl.Length..];
        }
        var auth = await Send(HttpMethod.Get, authorize, key);
        Check(auth.Location is not null && (int)auth.Status is >= 300 and < 400, $"oidc/authorize returned {(int)auth.Status}");
        var q = HttpUtility.ParseQueryString(new Uri(new Uri(_s.IamUrl), auth.Location!).Query);
        var tenant = q["tenant_id"] ?? _s.TenantId;
        var loginBody = JsonSerializer.Serialize(new Dictionary<string, string?>
        {
            ["username"] = _s.Email,
            ["password"] = _s.Password,
            ["client_id"] = q["client_id"],
            ["redirect_uri"] = q["redirect_uri"],
            ["scope"] = q["scope"],
            ["state"] = q["state"],
            ["nonce"] = q["nonce"],
            ["code_challenge"] = q["code_challenge"],
            ["code_challenge_method"] = q["code_challenge_method"],
            ["tenant_id"] = tenant,
        });
        var login = await Send(HttpMethod.Post, $"{_s.IamUrl}/api/oidc/login", new() { ["X-Blocks-Key"] = _s.TenantId, ["Origin"] = _s.PublicIamUrl }, loginBody);
        Check(login.Status == HttpStatusCode.OK, $"oidc/login returned {(int)login.Status} (wrong password or user not seeded?)");
        var codeUrl = JsonDocument.Parse(login.Body).RootElement.GetProperty("redirect_uri").GetString()!;
        var cq = HttpUtility.ParseQueryString(new Uri(codeUrl).Query);
        var cb = await Send(HttpMethod.Get, $"{_s.IamUrl}/api/idp/callback?code={Enc(cq["code"]!)}&state={Enc(cq["state"]!)}&tenant_id={Enc(cq["tenant_id"] ?? _s.TenantId)}", key);
        Check(cb.Status == HttpStatusCode.OK, $"idp/callback returned {(int)cb.Status}");
        _token = JsonDocument.Parse(cb.Body).RootElement.GetProperty("access_token").GetString();
        Check(!string.IsNullOrEmpty(_token), "idp/callback returned no access token");
    }

    private static void Check(bool ok, string message)
    {
        if (!ok)
        {
            throw new InvalidOperationException("sign-in to blocks-selfhost failed: " + message);
        }
    }

    public async Task<JsonElement> Monitor(HttpMethod method, string action, string query = "", object? body = null)
    {
        await SignIn();
        var headers = new Dictionary<string, string> { ["Authorization"] = "Bearer " + _token, ["X-Blocks-Key"] = _s.TenantId };
        var url = $"{_s.MonitorUrl}/api/Monitor/{action}{(query.Length > 0 ? "?" + query : "")}";
        var res = await Send(method, url, headers, body is null ? null : JsonSerializer.Serialize(body));
        if (res.Body.Length == 0)
        {
            throw new InvalidOperationException($"{action} returned {(int)res.Status} with no body");
        }
        return JsonDocument.Parse(res.Body).RootElement.Clone();
    }

    public async Task<JsonElement> Mailpit(HttpMethod method, string path)
    {
        var res = await Send(method, _s.MailpitUrl + path);
        if ((int)res.Status >= 400)
        {
            throw new InvalidOperationException($"Mailpit {method} {path} returned {(int)res.Status}");
        }
        // Mailpit answers a delete with plain text ("ok"), not JSON.
        return method == HttpMethod.Get && res.Body.Length > 0 ? JsonDocument.Parse(res.Body).RootElement.Clone() : default;
    }
}
