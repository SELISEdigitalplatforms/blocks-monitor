using Blocks.Genesis;
using MongoDB.Bson.Serialization.Attributes;

namespace DomainService.Alert.Entities
{
    [BsonIgnoreExtraElements]
    public class AlertMailTemplate : BaseEntity
    {
        public string? MailConfigurationId { get; set; }
        public string? TemplateBody { get; set; }
        public string? JsonContent { get; set; }
        public string? ImageId { get; set; }
        public string? ImageUrl { get; set; }
        public string? Name { get; set; }
        public string? TemplateSubject { get; set; }
        public string? GeneratedBy { get; set; }
    }
}