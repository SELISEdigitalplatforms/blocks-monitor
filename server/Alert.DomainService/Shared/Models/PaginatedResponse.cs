namespace DomainService.Shared.Models
{
    public class PaginatedResponse : BaseApiResponse
    {
        public int PageNumber { get; set; }
        public int PageSize { get; set; }
        public int TotalCount { get; set; }
    }
}
