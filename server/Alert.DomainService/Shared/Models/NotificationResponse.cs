using System.Text.Json.Serialization;

namespace DomainService.Shared.Models
{
    public class NotificationResponse
    {
        [JsonPropertyName("errors")]
        public string? Errors { get; set; }
        [JsonPropertyName("isSuccess")]
        public bool IsSuccess { get; set; }
    }
}
