using DomainService.Monitor.Entity;
using DomainService.Shared.Models;

namespace DomainService.Monitor.Models
{
    public class MonitorDetailsResponse: BaseApiResponse
    {
        public List<MonitorDateRangeSummaryDto> DateRangeSummary { get; set; } = new List<MonitorDateRangeSummaryDto>();
        public List<MonitorIncident> MonitorIncidents { get; set; } = new List<MonitorIncident>();

    }
}
