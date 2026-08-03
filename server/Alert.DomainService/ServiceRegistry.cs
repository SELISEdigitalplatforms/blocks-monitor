using DomainService.Shared.Services;
using DomainService.Alert.Services;
using DomainService.Health.HealthWorkerService;
using DomainService.Health.Services;
using DomainService.Monitor.Models;
using DomainService.Monitor.MonitorIncidentService;
using DomainService.Monitor.MonitorSchedulingService;
using DomainService.Monitor.Services;
using DomainService.Validators;
using FluentValidation;
using Microsoft.Extensions.DependencyInjection;

namespace Alert.DomainService
{
    public static class ServiceRegistry
    {
        public static void AddApplicationServices(this IServiceCollection services)
        {

            services.AddSingleton<IMonitorConfigurationService, MonitorConfigurationService>();
            services.AddSingleton<IMonitorConfigurationRepoService, MonitorConfigurationRepoService>();
            services.AddSingleton<IMonitorPingService, MonitorPingService>();
            services.AddSingleton<IMonitorSchedulerService, MonitorSchedulerService>();
            services.AddSingleton<IMonitorQueueManager, MonitorQueueManager>();
            services.AddSingleton<IMonitorIncidentService, MonitorIncidentService>();
            services.AddSingleton<IMonitorIncidentRepoService, MonitorIncidentRepoService>();
            services.AddSingleton<IHttpHelperServices, HttpHelperServices>();
            services.AddSingleton<NotificationAlertService>();
            services.AddSingleton<AlertRepoService>();
            services.AddSingleton<EmailAlertService>();
            services.AddSingleton<HealthConfigurationService>();
            services.AddSingleton<HealthConfigurationRepoService>();
            services.AddSingleton<HealthIncidentService>();
            services.AddSingleton<HealthQueueManager>();
            services.AddSingleton<HealthCheckService>();
            services.AddHostedService<HealthCheckBackgroundWorker>();
            services.AddSingleton<IMonitorPingRepoService, MonitorPingRepoService>();
            services.AddTransient<IValidator<SaveMonitorConfigurationRequest>, SaveMonitorConfigurationRequestValidator>();
            services.AddTransient<IValidator<UpdateMonitorConfigurationRequest>, UpdateMonitorConfigurationRequestValidator>();

        }
    }
}
