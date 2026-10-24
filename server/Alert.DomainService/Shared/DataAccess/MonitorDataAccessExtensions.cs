using Blocks.Genesis.DataAccess;
using Microsoft.Extensions.DependencyInjection;

namespace DomainService.Shared.DataAccess;

public static class MonitorDataAccessExtensions
{
    /// <summary>
    /// Registers <see cref="IMonitorDataAccess"/>, and the Genesis resolver when the host has none yet. The Monitor
    /// driver also runs inside other services' hosts (e.g. Logic), which register the resolver themselves, and
    /// AddBlocksDataAccess is not idempotent. A second call does nothing.
    /// </summary>
    public static IServiceCollection AddMonitorDataAccess(this IServiceCollection services)
    {
        if (services.Any(d => d.ServiceType == typeof(IMonitorDataAccess)))
            return services;

        if (!services.Any(d => d.ServiceType == typeof(IDataAccessResolver)))
        {
            services.AddBlocksDataAccess();
            services.AddSingleton<IAccessPrincipalAccessor, BlocksContextPrincipalAccessor>();
        }
        services.AddSingleton<IMonitorDataAccess, MonitorDataAccess>();
        return services;
    }
}
