using Blocks.Genesis.DataAccess.Rules;

namespace DomainService.Monitor.Models;

/// <summary>
/// One optimistic <c>$set</c> of a monitor's <c>Emails</c>: it applies only while the stored list still equals
/// <see cref="PreviousEmails"/> (null or empty also matches a missing or null field).
/// </summary>
public sealed record MonitorEmailsUpdate(
    string ItemId,
    IReadOnlyList<string>? PreviousEmails,
    List<string> NewEmails,
    DateTime UpdatedAt,
    string? UpdatedBy);

/// <summary>A data validation rule refused the update of <see cref="ItemId"/>.</summary>
public sealed record MonitorEmailsCheckFailure(string ItemId, DataValidationException Error);
