using Blocks.Genesis;
using Worker;
using Worker.Configuration;
using DomainService.Shared.Entity;
using MonitoringWorker.Consumers;
using SeliseBlocks.ConfigurationDriver;
using DomainService.Shared.Utilities;

const string serviceName = "blocks-monitor-worker";

var vaultType = ResolveVaultType();
var secret = await ApplicationConfigurations.ConfigureLogAndSecretsAsync(serviceName, vaultType);

await CreateHostBuilder(args).Build().RunAsync();

IHostBuilder CreateHostBuilder(string[] args) =>
        Host.CreateDefaultBuilder(args)
        .ConfigureAppConfiguration((context, builder) =>
        {
            // ApplicationConfigurations.ConfigureWorkerEnv(builder, args);
            builder.AddMongoDbConfiguration(options =>
            {
                options.ConnectionString = secret.DatabaseConnectionString;
                options.DatabaseName     = secret.RootDatabaseName;
                options.CollectionName   = "Secrets";
                options.SecretKey        = "blocks-secret-monitor";
            });
        })
        .ConfigureServices((services) =>
        {
            services.AddHttpClient();

            services.Configure<VerioSystemSettings>(services.BuildServiceProvider().GetRequiredService<IConfiguration>().GetSection("VerioSystemSettings"));



            services.AddHostedService<PeriodicPingBackgroundService>();
            services.AddHostedService<MonitorSchedulerBackgroundWorker>();




            #region Identifier Service Consumers
            Alert.DomainService.ServiceRegistry.AddApplicationServices(services);
            services.AddSingleton<IConsumer<MonitorConfigurationUpdateQueue>, MonitorConfigurationUpdateConsumer>();

            ApplicationConfigurations.ConfigureWorker(services, MonitorConstants.GetWorkerMessageConfiguration(secret.MessageConnectionString));
            //ApplicationConfigurations.ConfigureWorker(services, IdentifierConstants.GetMessageConfiguration(secret.MessageConnectionString));
            #endregion
        });

static VaultType ResolveVaultType()
{
    var configuredVaultType = Environment.GetEnvironmentVariable("BLOCKS_VAULT_TYPE");
    if (!string.IsNullOrWhiteSpace(configuredVaultType) &&
        Enum.TryParse<VaultType>(configuredVaultType, true, out var parsedVaultType))
    {
        return parsedVaultType;
    }

    var environment = Environment.GetEnvironmentVariable("ASPNETCORE_ENVIRONMENT") ??
                      Environment.GetEnvironmentVariable("DOTNET_ENVIRONMENT");

    return string.Equals(environment, "Development", StringComparison.OrdinalIgnoreCase)
        ? VaultType.OnPrem
        : VaultType.Azure;
}
