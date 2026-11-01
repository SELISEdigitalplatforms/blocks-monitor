using System.Text.RegularExpressions;

namespace DomainService.AlertRecipients.Models;

/// <summary>Limits, the key-value key and the user-facing messages of the Alert recipients feature.</summary>
public static class AlertRecipientRules
{
    public const int MaxEmailsPerMonitor = 10;
    /// <summary>Each "All monitors" person must fit on every monitor, so there can be no more of them than a monitor holds.</summary>
    public const int MaxAllMonitorsPeople = 10;
    public const int MaxMonitorIdsPerRequest = 500;
    public const int MaxSuggestions = 50;
    /// <summary>How many data-access rule checks run at once for one save (see the performance contract).</summary>
    public const int CheckParallelism = 16;

    public const string KeyPrefix = "monitor:alert-recipients:";

    /// <summary>The key-value key for <paramref name="tenantId"/>; only ever built from a validated tenant.</summary>
    public static string Key(string tenantId) => KeyPrefix + tenantId;

    public const string ProjectNotFound = "Project not found.";
    public const string InvalidEmail = "Enter a valid email address.";
    public const string ChooseMonitor = "Choose at least one monitor.";
    public const string MonitorNotFoundPrefix = "Monitor not found: ";
    public const string TooManyAllMonitorsPeople = "At most 10 people can get alerts for all monitors.";
    public const string TooManyMonitors = "Too many monitors in one request.";
    public const string ChoiceNotSaved = "Recipients were updated on the monitors, but saving the \"All monitors\" choice failed. Try again.";
    public const string RemovalNotSaved = "Recipients were removed from the monitors, but removing the saved person failed. Try again.";
    public const string LoadFailed = "Could not load alert recipients. Try again.";
    public const string SaveFailed = "Could not save the recipient. Try again.";
    public const string RemoveFailed = "Could not remove the recipient. Try again.";
}

/// <summary>
/// The one email rule, shared with the client (decision Q12): trim, then at most 254 characters and zod 4's
/// <c>z.email()</c> pattern on the trimmed value, then lower-case. The client applies the same steps, and both
/// run the shared list of test addresses (XUnitTest/AlertRecipients/alert-recipient-emails.json).
/// </summary>
public static partial class AlertRecipientEmail
{
    public const int MaxLength = 254;

    // JavaScript's String.prototype.trim() set (WhiteSpace + LineTerminator), so both sides trim the same characters:
    // .NET's char.IsWhiteSpace differs (it has U+0085 and lacks U+FEFF).
    private static readonly char[] JsWhitespace =
    {
        '\u0009', '\u000A', '\u000B', '\u000C', '\u000D', '\u0020', '\u00A0', '\u1680',
        '\u2000', '\u2001', '\u2002', '\u2003', '\u2004', '\u2005', '\u2006', '\u2007',
        '\u2008', '\u2009', '\u200A', '\u2028', '\u2029', '\u202F', '\u205F', '\u3000',
        '\uFEFF',
    };

    /// <summary>
    /// zod 4.6 <c>regexes.email</c>, verbatim except <c>$</c> -> <c>\z</c> (.NET's <c>$</c> also matches before a final newline).
    /// </summary>
    [GeneratedRegex(@"^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}\z",
        RegexOptions.CultureInvariant, matchTimeoutMilliseconds: 250)]
    private static partial Regex ZodEmail();

    /// <summary>Trimmed and lower-case; empty for null. Used to compare emails, never to rewrite stored ones.</summary>
    public static string Normalize(string? value) => (value ?? string.Empty).Trim(JsWhitespace).ToLowerInvariant();

    /// <summary>
    /// The normalized address when <paramref name="value"/> is valid, otherwise null. Validated before lower-casing,
    /// so a character whose lower case differs between .NET and JavaScript cannot slip through on one side only.
    /// </summary>
    public static string? TryNormalize(string? value)
    {
        var trimmed = (value ?? string.Empty).Trim(JsWhitespace);
        if (trimmed.Length == 0 || trimmed.Length > MaxLength)
            return null;
        // The 254-character cap and the timeout bound the match; a timeout surfaces as a failed request.
        return ZodEmail().IsMatch(trimmed) ? trimmed.ToLowerInvariant() : null;
    }

    public static bool IsValid(string? value) => TryNormalize(value) is not null;
}
