using Alert.DomainService;
using Microsoft.Extensions.DependencyInjection;
using ObservabilityDriver;

namespace Blocks.Extensions.DependencyInjection
{
    public static class ObservabilityDriverServiceExtension
    {
        /// <summary>
        /// Registers the underlying Alert.DomainService services plus the
        /// <see cref="IObservabilityDriverService"/> facade for package consumers.
        /// </summary>
        public static void RegisterBlocksObservabilityServices(this IServiceCollection services)
        {
            services.AddApplicationServices();
            services.AddScoped<IObservabilityDriverService, ObservabilityDriverService>();
        }
    }
}
