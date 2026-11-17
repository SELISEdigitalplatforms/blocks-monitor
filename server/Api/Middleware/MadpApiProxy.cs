using System.Net;
using System.Security.Cryptography;
using Api.Madp;
using Microsoft.Extensions.Primitives;

namespace Api.Middleware;

/// <summary>Authenticated same-origin boundary for the internal MADP host.</summary>
public sealed class MadpApiProxy
{
    public const string Prefix = "/madp-api";
    public const string ClientName = "madp-api";
    private readonly RequestDelegate _next;
    private readonly IHttpClientFactory _clients;
    private readonly IConfiguration _configuration;
    private readonly IMadpCallerAccessor _callers;
    private readonly MadpBridgeSigner _signer;
    public const long MaxRequestBodyBytes = 15 * 1024 * 1024;
    private static readonly object BrowserOriginKey = new();
    private sealed record BrowserOrigin(string Origin, string Referer);

    private static readonly HashSet<string> HopHeaders = new(StringComparer.OrdinalIgnoreCase)
    {
        "Connection", "Keep-Alive", "Proxy-Authenticate", "Proxy-Authorization", "TE", "Trailer",
        "Transfer-Encoding", "Upgrade", "Host", "Cookie", "Authorization", "Set-Cookie",
        "Origin", "Referer", "Content-Length", "Content-Security-Policy", "X-Frame-Options",
        "Forwarded", "X-Forwarded-For", "X-Forwarded-Host", "X-Forwarded-Proto",
    };

    public MadpApiProxy(RequestDelegate next, IHttpClientFactory clients, IConfiguration configuration,
        IMadpCallerAccessor callers, MadpBridgeSigner signer)
    {
        _next = next;
        _clients = clients;
        _configuration = configuration;
        _callers = callers;
        _signer = signer;
    }

    public static HttpMessageHandler CreateHandler() => new SocketsHttpHandler
    {
        AllowAutoRedirect = false,
        UseCookies = false,
        AutomaticDecompression = DecompressionMethods.None,
    };

    public async Task InvokeAsync(HttpContext context)
    {
        if (!context.Request.Path.StartsWithSegments(Prefix, out var remaining))
        {
            await _next(context);
            return;
        }

        // The upstream trusts Origin after this proxy rewrites it. Check the browser's original
        // origin first so a cross-site form cannot acquire that trust by going through the proxy.
        if (!IsSameOrigin(context.Request, _configuration["Madp:PublicOrigin"]))
        {
            await ErrorAsync(context, 403, "forbidden", "Open MADP from the Blocks project view.");
            return;
        }

        var caller = _callers.GetCaller(context);
        if (caller is null)
        {
            await ErrorAsync(context, 401, "unauthorized", "Sign in to Blocks to open MADP.");
            return;
        }
        var expectedTenant = context.Request.Headers["X-Madp-Expected-Tenant"].ToString();
        if (expectedTenant.Length > 0 && !expectedTenant.Equals(caller.TenantId, StringComparison.Ordinal))
        {
            await ErrorAsync(context, 409, "tenant_changed", "The selected Blocks project changed. Reopen MADP from that project.");
            return;
        }
        if (!_signer.IsConfigured)
        {
            await ErrorAsync(context, 503, "madp_not_configured", "The MADP bridge is not configured.");
            return;
        }

        var baseUrl = _configuration["Madp:ApiBaseUrl"];
        if (!TryApiOrigin(baseUrl, out var apiOrigin) || (apiOrigin!.Scheme == "http" && !apiOrigin.IsLoopback))
        {
            await ErrorAsync(context, 503, "madp_not_configured", "The MADP API connection is not configured.");
            return;
        }

        // Only API paths are proxied. A leading // or escaped slash must never become an
        // authority override, and the upstream frontend is never a proxy destination.
        var path = remaining.Value ?? string.Empty;
        var decodedPath = Uri.UnescapeDataString(path);
        if (!path.StartsWith("/api/", StringComparison.Ordinal) || decodedPath.Contains('\\')
            || decodedPath.Split('/').Any(segment => segment is "." or ".."))
        {
            await ErrorAsync(context, 404, "not_found", "MADP API endpoint not found.");
            return;
        }

        var target = new Uri(apiOrigin!.GetLeftPart(UriPartial.Authority) + path + context.Request.QueryString);
        string bodyHash;
        if (context.Request.ContentLength > MaxRequestBodyBytes)
        {
            await ErrorAsync(context, 413, "too_large", "The MADP request exceeds 15 MB.");
            return;
        }
        try
        {
            context.Request.EnableBuffering(bufferThreshold: 64 * 1024, bufferLimit: MaxRequestBodyBytes);
            if (context.Request.Body.CanSeek && context.Request.Body.Length > MaxRequestBodyBytes)
                throw new IOException("MADP request body exceeds its limit.");
            context.Request.Body.Position = 0;
            bodyHash = Convert.ToHexStringLower(await SHA256.HashDataAsync(context.Request.Body, context.RequestAborted));
            context.Request.Body.Position = 0;
        }
        catch (IOException)
        {
            await ErrorAsync(context, 413, "too_large", "The MADP request exceeds 15 MB.");
            return;
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            return;
        }
        using var request = new HttpRequestMessage(new HttpMethod(context.Request.Method), target);
        if (context.Request.ContentLength is > 0 || context.Request.Headers.ContainsKey("Transfer-Encoding"))
            request.Content = new StreamContent(context.Request.Body);

        var connectionHeaders = ConnectionHeaders(context.Request.Headers.Connection);
        foreach (var header in context.Request.Headers)
        {
            if (HopHeaders.Contains(header.Key) || connectionHeaders.Contains(header.Key)
                || header.Key.StartsWith("X-Madp-", StringComparison.OrdinalIgnoreCase)
                || header.Key.Equals("X-Blocks-Key", StringComparison.OrdinalIgnoreCase)) continue;
            if (!request.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray()))
                request.Content?.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
        }

        // The internal host receives a per-request verified assertion, never browser session cookies.
        _signer.Sign(request, caller, bodyHash, DateTimeOffset.UtcNow);
        var origin = apiOrigin.GetLeftPart(UriPartial.Authority);
        request.Headers.TryAddWithoutValidation("Origin", origin);
        request.Headers.Referrer = new Uri(origin + "/");
        request.Headers.Host = apiOrigin.Authority;
        request.Headers.Remove("Sec-Fetch-Site");
        request.Headers.TryAddWithoutValidation("Sec-Fetch-Site", "same-origin");

        try
        {
            using var response = await _clients.CreateClient(ClientName).SendAsync(
                request, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);
            context.Response.StatusCode = (int)response.StatusCode;
            var responseConnectionHeaders = response.Headers.TryGetValues("Connection", out var values)
                ? ConnectionHeaders(new StringValues(values.ToArray())) : [];
            foreach (var header in response.Headers.Concat(response.Content.Headers))
            {
                if (HopHeaders.Contains(header.Key) || responseConnectionHeaders.Contains(header.Key)) continue;
                context.Response.Headers[header.Key] = header.Value.ToArray();
            }
            // Generated previews deliberately have an opaque sandbox origin. Retain their
            // upstream policy; replacing it with the app policy would remove that boundary.
            if (response.Headers.TryGetValues("Content-Security-Policy", out var policies))
                context.Response.Headers.ContentSecurityPolicy = policies.ToArray();
            // Do not expose an upstream redirect as a navigation away from the embedded API.
            if (response.Headers.Location is { } location)
            {
                var absolute = location.IsAbsoluteUri ? location : new Uri(apiOrigin, location);
                if (absolute.GetLeftPart(UriPartial.Authority) == origin && absolute.AbsolutePath.StartsWith("/api/", StringComparison.Ordinal))
                    context.Response.Headers.Location = Prefix + absolute.PathAndQuery;
                else
                    context.Response.Headers.Remove("Location");
            }
            context.Response.Headers.CacheControl = "no-store";
            if (!HttpMethods.IsHead(context.Request.Method))
                await response.Content.CopyToAsync(context.Response.Body, context.RequestAborted);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // The client navigated away or changed project; do not continue its upstream work.
        }
        catch (OperationCanceledException) when (!context.Response.HasStarted)
        {
            await ErrorAsync(context, 504, "madp_timeout", "The MADP API took too long to respond.");
        }
        catch (HttpRequestException) when (!context.Response.HasStarted)
        {
            await ErrorAsync(context, 502, "madp_unavailable", "The MADP API could not be reached.");
        }
    }

    public static bool TryApiOrigin(string? value, out Uri? origin)
    {
        origin = null;
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(uri.UserInfo)
            || uri.AbsolutePath != "/" || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment)) return false;
        origin = uri;
        return true;
    }

    public static bool IsSameOrigin(HttpRequest request, string? publicOrigin = null)
    {
        var fetchSite = request.Headers["Sec-Fetch-Site"].ToString();
        if (fetchSite.Length > 0 && fetchSite != "same-origin") return false;
        var original = request.HttpContext.Items.TryGetValue(BrowserOriginKey, out var value) ? value as BrowserOrigin : null;
        var incoming = original?.Origin ?? request.Headers.Origin.ToString();
        if (incoming.Length == 0) incoming = original?.Referer ?? request.Headers.Referer.ToString();
        if (!Uri.TryCreate(incoming, UriKind.Absolute, out var uri)) return false;
        Uri? expected;
        if (string.IsNullOrWhiteSpace(publicOrigin))
            Uri.TryCreate($"{request.Scheme}://{request.Host}", UriKind.Absolute, out expected);
        else if (!TryApiOrigin(publicOrigin, out expected)) return false;
        return expected is not null && uri.Scheme.Equals(expected.Scheme, StringComparison.OrdinalIgnoreCase)
            && uri.Authority.Equals(expected.Authority, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Preserves browser provenance before the development tenant-domain normalization.</summary>
    public static void CaptureBrowserOrigin(HttpContext context)
    {
        if (context.Request.Path.StartsWithSegments(Prefix) && !context.Items.ContainsKey(BrowserOriginKey))
            context.Items[BrowserOriginKey] = new BrowserOrigin(context.Request.Headers.Origin.ToString(), context.Request.Headers.Referer.ToString());
    }

    private static HashSet<string> ConnectionHeaders(StringValues value) => value.ToString()
        .Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries)
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    private static Task ErrorAsync(HttpContext context, int status, string code, string message)
    {
        context.Response.StatusCode = status;
        context.Response.Headers.CacheControl = "no-store";
        return context.Response.WriteAsJsonAsync(new { ok = false, error = new { code, message } }, context.RequestAborted);
    }
}
