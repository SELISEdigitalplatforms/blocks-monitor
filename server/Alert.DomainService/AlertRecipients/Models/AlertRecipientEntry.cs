using MongoDB.Bson.Serialization.Attributes;

namespace DomainService.AlertRecipients.Models;

/// <summary>
/// The value of one Genesis key-value document under <c>monitor:alert-recipients:{tenant}</c>: one person and
/// their "All monitors" choice. Which monitors the person is on is never stored here; it is always read from
/// each monitor's own <c>Emails</c>.
/// </summary>
[BsonIgnoreExtraElements]
public sealed class AlertRecipientEntry
{
    /// <summary>Normalized (trimmed, lower-case) email address.</summary>
    public string Email { get; set; } = string.Empty;

    /// <summary>True when the person gets alerts for every editable monitor, including monitors created later.</summary>
    public bool AllMonitors { get; set; }

    public string? UpdatedBy { get; set; }

    [BsonDateTimeOptions(Kind = DateTimeKind.Utc)]
    public DateTime UpdatedAt { get; set; }
}
