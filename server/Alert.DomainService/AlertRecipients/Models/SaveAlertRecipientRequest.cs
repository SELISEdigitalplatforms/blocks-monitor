namespace DomainService.AlertRecipients.Models;

/// <summary>
/// <c>POST /Monitor/SaveAlertRecipient</c>: adds or updates one person (an upsert). Properties are nullable on
/// purpose, so a missing value reaches the service's own messages instead of the framework's 400.
/// </summary>
public sealed class SaveAlertRecipientRequest
{
    public string? ProjectKey { get; set; }
    public string? Email { get; set; }
    /// <summary>True: every editable monitor, and monitors created later. False: only <see cref="MonitorIds"/>.</summary>
    public bool AllMonitors { get; set; }
    /// <summary>The chosen monitors when <see cref="AllMonitors"/> is false; ignored otherwise. At most 500.</summary>
    public List<string>? MonitorIds { get; set; }
}

/// <summary>
/// <c>POST /Monitor/DeleteAlertRecipient</c>: removes one person from every editable monitor. The email travels
/// in the body, never in the URL, so no request log carries it.
/// </summary>
public sealed class DeleteAlertRecipientRequest
{
    public string? ProjectKey { get; set; }
    public string? Email { get; set; }
}
