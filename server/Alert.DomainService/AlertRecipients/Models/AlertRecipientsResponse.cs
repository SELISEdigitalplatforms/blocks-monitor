namespace DomainService.AlertRecipients.Models;

/// <summary><c>GET /Monitor/GetAlertRecipients</c>: the project's editable monitors and the people who get their alerts.</summary>
public sealed class AlertRecipientsResponse
{
    public int MaxEmailsPerMonitor { get; set; } = AlertRecipientRules.MaxEmailsPerMonitor;
    /// <summary>Editable monitors, sorted by name (case-insensitive).</summary>
    public List<AlertRecipientMonitor> Monitors { get; set; } = new();
    /// <summary>Everyone on an editable monitor or stored as a recipient, sorted by email.</summary>
    public List<AlertRecipient> Recipients { get; set; } = new();
    /// <summary>Ids of editable monitors that email no one.</summary>
    public List<string> MonitorsWithoutRecipients { get; set; } = new();
}

public sealed class AlertRecipientMonitor
{
    public string ItemId { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    /// <summary><see cref="AlertRecipientMonitorKinds.HttpCheck"/> or <see cref="AlertRecipientMonitorKinds.Heartbeat"/>.</summary>
    public string Kind { get; set; } = string.Empty;
    public bool IsActive { get; set; }
    /// <summary>How many emails the monitor holds now (as stored, legacy lists over 10 included).</summary>
    public int EmailCount { get; set; }
}

public static class AlertRecipientMonitorKinds
{
    public const string HttpCheck = "HttpCheck";
    public const string Heartbeat = "Heartbeat";
}

public sealed class AlertRecipient
{
    /// <summary>Normalized email.</summary>
    public string Email { get; set; } = string.Empty;
    /// <summary>Stored "All monitors" choice and the person is on every editable monitor (true when there are none).</summary>
    public bool AllMonitors { get; set; }
    /// <summary>The stored "All monitors" choice alone, even when a full monitor skipped the person.</summary>
    public bool AllMonitorsChoice { get; set; }
    /// <summary>Editable monitors whose Emails hold the person, in <see cref="AlertRecipientsResponse.Monitors"/> order.</summary>
    public List<string> MonitorIds { get; set; } = new();
}

/// <summary><c>GET /Monitor/GetAlertRecipientSuggestions</c>.</summary>
public sealed class AlertRecipientSuggestionsResponse
{
    /// <summary>Project members' emails that are not recipients yet: normalized, distinct, sorted, at most 50.</summary>
    public List<string> MemberEmails { get; set; } = new();
}
