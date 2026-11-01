using Blocks.Genesis;
using MongoDB.Bson.Serialization.Attributes;

namespace DomainService.Alert.Entities
{
    [BsonIgnoreExtraElements]
    public class MailServerConfiguration : BaseEntity
    {
        public string Name { get; set; }
        public string Host { get; set; }
        public int Port { get; set; }
        public bool EnableSSL { get; set; }
        public string SenderName { get; set; }
        public string SenderAddress { get; set; }
        public string SenderUserName { get; set; }
        public string AccountPassword { get; set; }
        /// <summary>
        /// The Blocks Secrets id of the account password. When set, AccountPassword is empty and the
        /// password is in the root tenant's secret store; when null, AccountPassword holds it.
        /// Written by blocks-os; blocks-monitor only reads it.
        /// </summary>
        [BsonElement("AccountPasswordReference")]
        public string? AccountPasswordReference { get; set; }
        public bool UseDefaultCredentials { get; set; }
        public SmtpClient SmtpClient { get; set; } = SmtpClient.Default;
        public bool IsDefault { get; set; }
    }

    public enum SmtpClient
    {
        Default = 0,
        MsGraph,
        MsMailKit
    }
}
