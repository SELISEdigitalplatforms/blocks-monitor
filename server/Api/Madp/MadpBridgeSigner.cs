using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Api.Madp;

/// <summary>Authenticates a single internal MADP request, binding its verified caller and body.</summary>
public sealed class MadpBridgeSigner(IConfiguration configuration)
{
    public const string ContextHeader = "X-Madp-Context";
    public const string BodyHashHeader = "X-Madp-Body-SHA256";
    public const string SignatureHeader = "X-Madp-Signature";
    public const int MaxLifetimeSeconds = 45;

    public bool IsConfigured => Key() is { Length: >= 32 };

    public void Sign(HttpRequestMessage request, MadpCaller caller, string bodyHash, DateTimeOffset now)
    {
        var key = Key();
        if (key is not { Length: >= 32 }) throw new InvalidOperationException("The MADP bridge key is not configured.");
        var expires = Math.Min(now.ToUnixTimeSeconds() + MaxLifetimeSeconds, caller.ExpiresAt.ToUnixTimeSeconds());
        var context = Base64Url(JsonSerializer.SerializeToUtf8Bytes(new
        {
            v = 1,
            iat = now.ToUnixTimeSeconds(),
            exp = expires,
            nonce = Guid.NewGuid().ToString("N"),
            userId = caller.UserId,
            email = caller.Email,
            displayName = caller.DisplayName,
            tenantId = caller.TenantId,
            roles = caller.Roles,
            permissions = caller.Permissions,
        }));
        var canonical = $"{request.Method.Method.ToUpperInvariant()}\n{request.RequestUri!.PathAndQuery}\n{bodyHash}\n{context}";
        var signature = Base64Url(HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(canonical)));
        request.Headers.TryAddWithoutValidation(ContextHeader, context);
        request.Headers.TryAddWithoutValidation(BodyHashHeader, bodyHash);
        request.Headers.TryAddWithoutValidation(SignatureHeader, signature);
    }

    private byte[]? Key() => configuration["Madp:BridgeKey"] is { } value
        ? Encoding.UTF8.GetBytes(value) : null;

    private static string Base64Url(byte[] bytes) => Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
}
