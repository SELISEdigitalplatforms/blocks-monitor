using System.Collections.Generic;
using System.Threading.Tasks;
using DomainService.Alert.Entities;
using DomainService.Alert.Services;
using DomainService.Shared.Models;
using FluentAssertions;
using MongoDB.Bson;
using MongoDB.Bson.Serialization;
using MongoDB.Driver;
using Moq;
using XUnitTest.Utilities;

namespace XUnitTest.Alert
{
    public class AlertRepoServiceTests
    {
        private static AlertRepoService Build(
            IEnumerable<ProjectPeople> people = null,
            IEnumerable<EmailTemplate> templates = null,
            IEnumerable<MailServerConfiguration> configs = null)
        {
            var db = new MongoMocks.DbBuilder()
                .With(people ?? new List<ProjectPeople>())
                .With(templates ?? new List<EmailTemplate>())
                .With(configs ?? new List<MailServerConfiguration>());
            return new AlertRepoService(db.Provider, MongoMocks.BlocksSecret().Object);
        }

        [Fact]
        public async Task GetProjectPeopleList_ReturnsUserIds()
        {
            var repo = Build(people: new List<ProjectPeople>
            {
                new() { UserId = "u1", TenantId = "t" },
                new() { UserId = "u2", TenantId = "t" }
            });

            var result = await repo.GetProjectPeopleListAsync("t");

            result.Should().BeEquivalentTo(new[] { "u1", "u2" });
        }

        [Fact]
        public async Task GetAlertMailTemplateByName_WhenNotFound_ReturnsNull()
        {
            var repo = Build();
            var result = await repo.GetAlertMailTemplateByNameAsync("Missing");
            result.Should().BeNull();
        }

        [Fact]
        public async Task GetAlertMailTemplateByName_ReturnsTemplate()
        {
            var repo = Build(templates: new List<EmailTemplate> { new() { Name = "AlertIncident", TemplateSubject = "S" } });
            var result = await repo.GetAlertMailTemplateByNameAsync("AlertIncident");
            result.Should().NotBeNull();
            result!.TemplateSubject.Should().Be("S");
        }

        [Fact]
        public void Constructor_ReadsRootEmailTemplatesCollection_NotAlertMailTemplates()
        {
            var db = new Mock<IMongoDatabase>();
            var names = new List<string>();
            db.Setup(d => d.GetCollection<EmailTemplate>(It.IsAny<string>(), It.IsAny<MongoCollectionSettings>()))
                .Callback<string, MongoCollectionSettings>((n, _) => names.Add(n))
                .Returns(MongoMocks.Collection(new List<EmailTemplate>()).Object);
            db.Setup(d => d.GetCollection<ProjectPeople>(It.IsAny<string>(), It.IsAny<MongoCollectionSettings>()))
                .Returns(MongoMocks.Collection(new List<ProjectPeople>()).Object);
            db.Setup(d => d.GetCollection<MailServerConfiguration>(It.IsAny<string>(), It.IsAny<MongoCollectionSettings>()))
                .Returns(MongoMocks.Collection(new List<MailServerConfiguration>()).Object);
            var provider = new Mock<Blocks.Genesis.IDbContextProvider>();
            provider.Setup(p => p.GetDatabase(It.IsAny<string>(), "TestDb")).Returns(db.Object);

            _ = new AlertRepoService(provider.Object, MongoMocks.BlocksSecret().Object);

            names.Should().Equal("EmailTemplates");
        }

        [Fact]
        public void EmailTemplate_WithExtraBsonFields_DeserializesWithoutError()
        {
            // C1: copied templates carry a MigratedFrom marker the entity does not declare.
            var doc = new BsonDocument
            {
                { "_id", "t1" },
                { "Name", "AlertIncident" },
                { "TemplateSubject", "S" },
                { "MigratedFrom", "AlertMailTemplates" },
                { "Language", "en" }
            };

            var template = BsonSerializer.Deserialize<EmailTemplate>(doc);

            template.Name.Should().Be("AlertIncident");
            template.TemplateSubject.Should().Be("S");
        }

        [Fact]
        public async Task GetAlertMailTemplateByName_WhenSeveralMatch_ReturnsFirst()
        {
            var repo = Build(templates: new List<EmailTemplate>
            {
                new() { Name = "AlertIncident", TemplateSubject = "first" },
                new() { Name = "AlertIncident", TemplateSubject = "second" }
            });
            var result = await repo.GetAlertMailTemplateByNameAsync("AlertIncident");
            result!.TemplateSubject.Should().Be("first");
        }

        [Fact]
        public async Task GetMailServerConfigurationById_ReturnsConfig()
        {
            var repo = Build(configs: new List<MailServerConfiguration> { new() { ItemId = "cfg1", Host = "smtp.test" } });
            var result = await repo.GetMailServerConfigurationByIdAsync("cfg1");
            result.Should().NotBeNull();
            result!.Host.Should().Be("smtp.test");
        }

        [Fact]
        public async Task GetProjectMemberEmails_ReturnsTheMembersEmails_ReadingOnlyTheEmailField()
        {
            var people = MongoMocks.Collection(new List<ProjectPeople>());
            FindOptions<ProjectPeople, ProjectPeople>? options = null;
            people.Setup(c => c.FindAsync(It.IsAny<FilterDefinition<ProjectPeople>>(), It.IsAny<FindOptions<ProjectPeople, ProjectPeople>>(), It.IsAny<System.Threading.CancellationToken>()))
                .Callback<FilterDefinition<ProjectPeople>, FindOptions<ProjectPeople, ProjectPeople>, System.Threading.CancellationToken>((_, o, _) => options = o)
                .ReturnsAsync(() => MongoMocks.Cursor(new List<ProjectPeople>
                {
                    new() { Email = "a@x.com" }, new() { Email = " " }, new() { Email = null! }, new() { Email = "B@x.com" },
                }).Object);
            var db = new MongoMocks.DbBuilder().With(people).With(new List<EmailTemplate>()).With(new List<MailServerConfiguration>());

            var result = await new AlertRepoService(db.Provider, MongoMocks.BlocksSecret().Object).GetProjectMemberEmailsAsync("t");

            result.Should().Equal("a@x.com", "B@x.com");
            options!.Projection.Render(new RenderArgs<ProjectPeople>(BsonSerializer.LookupSerializer<ProjectPeople>(), BsonSerializer.SerializerRegistry))
                .Document.Names.Should().Equal("Email");
        }
    }
}
