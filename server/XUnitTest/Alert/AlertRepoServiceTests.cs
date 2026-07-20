using System.Collections.Generic;
using System.Threading.Tasks;
using DomainService.Alert.Entities;
using DomainService.Alert.Services;
using DomainService.Shared.Models;
using FluentAssertions;
using XUnitTest.Utilities;

namespace XUnitTest.Alert
{
    public class AlertRepoServiceTests
    {
        private static AlertRepoService Build(
            IEnumerable<ProjectPeople> people = null,
            IEnumerable<AlertMailTemplate> templates = null,
            IEnumerable<MailServerConfiguration> configs = null)
        {
            var db = new MongoMocks.DbBuilder()
                .With(people ?? new List<ProjectPeople>())
                .With(templates ?? new List<AlertMailTemplate>())
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
            var repo = Build(templates: new List<AlertMailTemplate> { new() { Name = "AlertIncident", TemplateSubject = "S" } });
            var result = await repo.GetAlertMailTemplateByNameAsync("AlertIncident");
            result.Should().NotBeNull();
            result!.TemplateSubject.Should().Be("S");
        }

        [Fact]
        public async Task GetMailServerConfigurationById_ReturnsConfig()
        {
            var repo = Build(configs: new List<MailServerConfiguration> { new() { ItemId = "cfg1", Host = "smtp.test" } });
            var result = await repo.GetMailServerConfigurationByIdAsync("cfg1");
            result.Should().NotBeNull();
            result!.Host.Should().Be("smtp.test");
        }
    }
}
