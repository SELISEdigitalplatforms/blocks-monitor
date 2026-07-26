using System.Linq;
using Alert.DomainService;
using DomainService.Monitor.Services;
using DomainService.Shared.Services;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;

namespace XUnitTest.Shared
{
    public class ServiceRegistryTests
    {
        [Fact]
        public void AddApplicationServices_RegistersDomainServices()
        {
            var services = new ServiceCollection();

            services.AddApplicationServices();

            // Interfaces are registered against their concrete implementations.
            services.Should().Contain(d => d.ServiceType == typeof(IMonitorConfigurationService)
                && d.ImplementationType == typeof(MonitorConfigurationService));
            services.Should().Contain(d => d.ServiceType == typeof(IMonitorConfigurationRepoService)
                && d.ImplementationType == typeof(MonitorConfigurationRepoService));
            services.Should().Contain(d => d.ServiceType == typeof(IHttpHelperServices)
                && d.ImplementationType == typeof(HttpHelperServices));
        }

        [Fact]
        public void AddApplicationServices_RegistersHostedServiceAndValidators()
        {
            var services = new ServiceCollection();

            services.AddApplicationServices();

            // A hosted background worker is registered for the health checks.
            services.Should().Contain(d => d.ServiceType == typeof(Microsoft.Extensions.Hosting.IHostedService));
            // Both request validators are registered as transients.
            services.Count(d => d.ServiceType.Name.StartsWith("IValidator")).Should().Be(2);
        }
    }
}
