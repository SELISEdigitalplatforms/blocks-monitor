using Blocks.Genesis;
using DomainService.Alert.Entities;
using DomainService.Shared.Models;
using Microsoft.Extensions.Logging;
using MongoDB.Driver;

namespace DomainService.Alert.Services
{
    /// <summary>
    /// Reads for the alert flow (incident emails and notifications), which runs without a signed-in user. Not routed
    /// through IMonitorDataAccess on purpose: these are the root database's platform alert template and mail server,
    /// not tenant data, so a tenant's EmailTemplate / MailServerConfiguration policies must not hide them.
    /// </summary>
    public class AlertRepoService
    {
        private readonly IMongoCollection<ProjectPeople> _projectPeopleCollection;
        private readonly IMongoCollection<EmailTemplate> _emailTemplateCollection;
        private readonly IMongoCollection<MailServerConfiguration> _mailServerConfigCollection;

        public AlertRepoService(
            IDbContextProvider dbContextProvider,
            IBlocksSecret blocksSecret)
        {
            var db = dbContextProvider.GetDatabase(blocksSecret.DatabaseConnectionString, blocksSecret.RootDatabaseName);

            _projectPeopleCollection = db.GetCollection<ProjectPeople>("ProjectPeoples");
            _emailTemplateCollection = db.GetCollection<EmailTemplate>("EmailTemplates");
            _mailServerConfigCollection = db.GetCollection<MailServerConfiguration>("MailServerConfigurations");
        }

        public async Task<List<string>> GetProjectPeopleListAsync(string tenantId)
        {
            var filter = Builders<ProjectPeople>.Filter.Eq(r => r.TenantId, tenantId);
            var result = await _projectPeopleCollection.Find(filter).ToListAsync();
            return result.Select(p => p.UserId).ToList();
        }

        /// <summary>
        /// The raw emails of the project's members (Alert recipients suggestions); only the Email field is read.
        /// Read failures propagate.
        /// </summary>
        public async Task<List<string>> GetProjectMemberEmailsAsync(string tenantId)
        {
            var filter = Builders<ProjectPeople>.Filter.Eq(r => r.TenantId, tenantId);
            var projection = Builders<ProjectPeople>.Projection.Include(p => p.Email);
            var result = await _projectPeopleCollection.Find(filter).Project<ProjectPeople>(projection).ToListAsync();
            return result.Select(p => p.Email).Where(email => !string.IsNullOrWhiteSpace(email)).ToList();
        }

        public async Task<EmailTemplate> GetAlertMailTemplateByNameAsync(string name)
        {
            var filter = Builders<EmailTemplate>.Filter.Eq(t => t.Name, name);
            return await _emailTemplateCollection.Find(filter).FirstOrDefaultAsync();
        }

        public async Task<MailServerConfiguration> GetMailServerConfigurationByIdAsync(string itemId)
        {
            var filter = Builders<MailServerConfiguration>.Filter.Eq(c => c.ItemId, itemId);
            return await _mailServerConfigCollection.Find(filter).FirstOrDefaultAsync();
        }
    }
}
