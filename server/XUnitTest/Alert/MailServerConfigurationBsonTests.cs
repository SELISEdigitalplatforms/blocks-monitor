using DomainService.Alert.Entities;
using FluentAssertions;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;

namespace XUnitTest.Alert
{
    public class MailServerConfigurationBsonTests
    {
        // H4: documents written by blocks-os before and after SPEC31 both deserialize.
        private static BsonDocument Document() => new()
        {
            { "_id", "cfg1" },
            { "Name", "Root mail" },
            { "Host", "smtp.test" },
            { "Port", 587 },
            { "SenderUserName", "mailer" },
            { "AccountPassword", "ses-pass" },
            { "SmtpClient", 0 },
        };

        [Fact]
        public void Deserialize_WithoutReference_LeavesReferenceNull()
        {
            var config = BsonSerializer.Deserialize<MailServerConfiguration>(Document());

            config.AccountPassword.Should().Be("ses-pass");
            config.AccountPasswordReference.Should().BeNull();
        }

        [Fact]
        public void Deserialize_WithReference_ReadsExactElementName()
        {
            var document = Document();
            document["AccountPassword"] = "";
            document.Add("AccountPasswordReference", "s-1");

            var config = BsonSerializer.Deserialize<MailServerConfiguration>(document);

            config.AccountPassword.Should().BeEmpty();
            config.AccountPasswordReference.Should().Be("s-1");
        }

        [Fact]
        public void ClassMap_UsesExactElementName()
        {
            BsonClassMap.LookupClassMap(typeof(MailServerConfiguration))
                .GetMemberMap(nameof(MailServerConfiguration.AccountPasswordReference))
                .ElementName.Should().Be("AccountPasswordReference");
        }
    }
}
