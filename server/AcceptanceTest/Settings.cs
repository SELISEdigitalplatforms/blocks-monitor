using System.Text.Json;

namespace AcceptanceTest;

/// <summary>
/// Where the running blocks-selfhost project is and who signs in. Read from acceptance.settings.json next to the test
/// assembly (written by selfhost\new-acceptance-settings.ps1, git-excluded). No file = the scenarios fail with a message.
/// </summary>
public sealed class Settings
{
    public string IamUrl { get; init; } = "";          // reachable from the test: http://host.docker.internal:5202
    public string PublicIamUrl { get; init; } = "";    // the URL IAM puts in its redirects: https://iam.blocks.test
    public string MonitorUrl { get; init; } = "";      // http://host.docker.internal:5206
    public string MailpitUrl { get; init; } = "";      // http://host.docker.internal:18025
    public string TenantId { get; init; } = "";        // root tenant id = the project key
    public string ClientId { get; init; } = "";        // OS_CLIENT_ID
    public string RedirectUri { get; init; } = "";     // https://os.blocks.test/login/callback
    public string Email { get; init; } = "";           // the monitor user of I01-WP10
    public string Password { get; init; } = "";

    public static Settings Load()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "acceptance.settings.json");
        if (!File.Exists(path))
        {
            throw new InvalidOperationException(
                "acceptance.settings.json is missing. Start blocks-selfhost with the mail profile and the test fixtures, then run " +
                "selfhost\\new-acceptance-settings.ps1 (see server/AcceptanceTest/README.md). Nothing is skipped.");
        }
        var s = JsonSerializer.Deserialize<Settings>(File.ReadAllText(path), new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                ?? throw new InvalidOperationException("acceptance.settings.json is empty.");
        foreach (var (name, value) in new[] { ("IamUrl", s.IamUrl), ("MonitorUrl", s.MonitorUrl), ("MailpitUrl", s.MailpitUrl), ("TenantId", s.TenantId), ("Email", s.Email), ("Password", s.Password) })
        {
            if (string.IsNullOrWhiteSpace(value)) throw new InvalidOperationException($"acceptance.settings.json: {name} is empty.");
        }
        return s;
    }
}
