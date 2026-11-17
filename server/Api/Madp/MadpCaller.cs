using Blocks.Genesis;

namespace Api.Madp;

/// <summary>Verified identity sent to the internal MADP host, without any user token.</summary>
public sealed record MadpCaller(
    string TenantId, string UserId, string Email, string DisplayName,
    IReadOnlyList<string> Roles, IReadOnlyList<string> Permissions, DateTimeOffset ExpiresAt);

public interface IMadpCallerAccessor
{
    MadpCaller? GetCaller(HttpContext context);
}

/// <summary>Reads only Genesis's authenticated context after the standard authorization pipeline.</summary>
public sealed class GenesisMadpCallerAccessor : IMadpCallerAccessor
{
    public MadpCaller? GetCaller(HttpContext context)
    {
        var caller = BlocksContext.GetContext();
        if (context.User.Identity?.IsAuthenticated != true || caller?.IsAuthenticated != true
            || string.IsNullOrWhiteSpace(caller.TenantId) || string.IsNullOrWhiteSpace(caller.UserId)) return null;
        var expires = new DateTimeOffset(caller.ExpireOn.Kind == DateTimeKind.Unspecified
            ? DateTime.SpecifyKind(caller.ExpireOn, DateTimeKind.Utc) : caller.ExpireOn.ToUniversalTime());
        if (expires <= DateTimeOffset.UtcNow) return null;
        return new MadpCaller(caller.TenantId, caller.UserId, caller.Email ?? string.Empty,
            caller.DisplayName ?? caller.UserName ?? string.Empty,
            (caller.Roles ?? []).Distinct(StringComparer.Ordinal).ToArray(),
            (caller.Permissions ?? []).Distinct(StringComparer.Ordinal).ToArray(), expires);
    }
}
