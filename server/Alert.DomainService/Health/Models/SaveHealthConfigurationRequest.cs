namespace DomainService.Health.Models
{
    public class SaveHealthConfigurationRequest
    {
        public string ProjectKey { get; set; }
        public string Name { get; set; }
        public string? RepoId { get; set; }
        public string? RepoName { get; set; }
        public string? ExternalServiceId { get; set; }
        public bool IsActive { get; set; }
        public int IntervalInSeconds { get; set; }
        public int GracePeriodInSeconds { get; set; }
        public string? MonitorSourceType { get; set; }
        public List<string> Emails { get; set; } = new List<string>();
    }

    public class UpdateHealthConfigurationRequest : SaveHealthConfigurationRequest
    {
        public string ItemId { get; set; }
    }
}
