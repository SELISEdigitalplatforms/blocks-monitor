using DomainService.Monitor.Entity;
using DomainService.Shared.Models;

namespace DomainService.Monitor.Models
{
    public class MonitorDetailsResponse: BaseApiResponse
    {
        public List<MonitorDateRangeSummaryResponse> DateRangeSummary { get; set; } = new List<MonitorDateRangeSummaryResponse>();
        public List<MonitorIncident> MonitorIncidents { get; set; } = new List<MonitorIncident>();

    }
}
