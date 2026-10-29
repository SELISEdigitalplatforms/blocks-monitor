namespace DomainService.Shared.Utilities;

/// <summary>Makes a request-derived value safe to log.</summary>
public static class LogValue
{
    /// <summary>
    /// <paramref name="value"/> without carriage returns or line feeds, so a request-derived value (a project key or
    /// an id) can't forge extra log lines. Null becomes empty.
    /// </summary>
    public static string Clean(string? value) =>
        (value ?? string.Empty).Replace("\r", string.Empty, StringComparison.Ordinal).Replace("\n", string.Empty, StringComparison.Ordinal);
}
