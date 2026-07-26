using Blocks.Genesis;
using DomainService.Alert.Entities;
using DomainService.Shared.Models;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;

namespace DomainService.Alert.Services
{
    public class AlertRepoService
    {
        private readonly IMongoCollection<ProjectPeople> _projectPeopleCollection;
        private readonly IMongoCollection<AlertMailTemplate> _alertMailTemplateCollection;
        private readonly IMongoCollection<MailServerConfiguration> _mailServerConfigCollection;

        public AlertRepoService(
            IDbContextProvider dbContextProvider,
            IBlocksSecret blocksSecret)
        {
            var db = dbContextProvider.GetDatabase(blocksSecret.DatabaseConnectionString, blocksSecret.RootDatabaseName);

            _projectPeopleCollection = db.GetCollection<ProjectPeople>("ProjectPeoples");
            _alertMailTemplateCollection = db.GetCollection<AlertMailTemplate>("AlertMailTemplates");
            _mailServerConfigCollection = db.GetCollection<MailServerConfiguration>("MailServerConfigurations");
        }

        public async Task<List<string>> GetProjectPeopleListAsync(string tenantId)
        {
            var filter = Builders<ProjectPeople>.Filter.Eq(r => r.TenantId, tenantId);
            var result = await _projectPeopleCollection.Find(filter).ToListAsync();
            return result.Select(p => p.UserId).ToList();
        }

        public async Task<AlertMailTemplate> GetAlertMailTemplateByNameAsync(string name)
        {
            var filter = Builders<AlertMailTemplate>.Filter.Eq(t => t.Name, name);
            return await _alertMailTemplateCollection.Find(filter).FirstOrDefaultAsync();
        }

        public async Task<MailServerConfiguration> GetMailServerConfigurationByIdAsync(string itemId)
        {
            var filter = Builders<MailServerConfiguration>.Filter.Eq(c => c.ItemId, itemId);
            return await _mailServerConfigCollection.Find(filter).FirstOrDefaultAsync();
        }
    }
}
