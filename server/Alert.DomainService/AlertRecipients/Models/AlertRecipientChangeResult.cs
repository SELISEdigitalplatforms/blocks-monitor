namespace DomainService.AlertRecipients.Models;

/// <summary>A monitor named in a change result.</summary>
public sealed record AlertRecipientMonitorRef(string ItemId, string Name);

/// <summary><c>POST /Monitor/SaveAlertRecipient</c> result.</summary>
public sealed class AlertRecipientChangeResult
{
    public string Email { get; set; } = string.Empty;
    public bool AllMonitors { get; set; }
    public int Added { get; set; }
    public int Removed { get; set; }
    /// <summary>Chosen monitors that already had the person.</summary>
    public int Unchanged { get; set; }
    /// <summary>Chosen monitors that already hold 10 emails; the person was not added.</summary>
    public List<AlertRecipientMonitorRef> SkippedFull { get; set; } = new();
    /// <summary>Monitors whose emails changed while saving, even after one retry; not overwritten.</summary>
    public List<AlertRecipientMonitorRef> Conflicted { get; set; } = new();
    /// <summary>Monitors the caller may not edit.</summary>
    public List<AlertRecipientMonitorRef> Denied { get; set; } = new();
}

/// <summary><c>POST /Monitor/DeleteAlertRecipient</c> result.</summary>
public sealed class AlertRecipientRemoveResult
{
    public string Email { get; set; } = string.Empty;
    public int Removed { get; set; }
    public List<AlertRecipientMonitorRef> Conflicted { get; set; } = new();
    public List<AlertRecipientMonitorRef> Denied { get; set; } = new();
}
