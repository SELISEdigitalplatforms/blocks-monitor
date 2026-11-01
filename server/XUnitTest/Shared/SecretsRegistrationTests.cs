using System;
using System.IO;
using System.Text.RegularExpressions;
using Alert.DomainService;
using Blocks.Genesis;
using Blocks.Secrets;
using DomainService.Alert.Services;
using DomainService.Shared.Services;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using XUnitTest.Utilities;

namespace XUnitTest.Shared
{
    /// <summary>
    /// H2, H3: Alert.DomainService compiles against Blocks.Secrets (this file would not build
    /// otherwise), and the composition both hosts use - AddApplicationServices() plus
    /// AddBlocksSecrets() - resolves ISecretService and the alert-mail singletons with scope
    /// validation on. A real host start is not possible here: both Program.cs files read the vault
    /// before the container exists. That they make the call is asserted structurally below.
    /// </summary>
    public class SecretsRegistrationTests
    {
        private static ServiceProvider BuildHostLikeProvider()
        {
            var services = new ServiceCollection();
            services.AddLogging();
            services.AddHttpClient();
            services.AddSingleton(AlertMailTestDoubles.Configuration());
            services.AddSingleton(new MongoMocks.DbBuilder().Provider);
            services.AddSingleton(MongoMocks.BlocksSecret().Object);
            services.AddSingleton(new Mock<ITenants>().Object);
            services.AddSingleton(new Mock<ICryptoService>().Object);
            // Registered by Genesis ConfigureServices (Api) / ConfigureWorker (Worker) in the hosts.
            services.AddSingleton(new Mock<IMessageClient>().Object);
            services.AddSingleton(new Mock<IHttpService>().Object);
            services.AddSingleton(new Mock<IKeyValueStore>().Object);

            services.AddApplicationServices();
            // The Database store needs no vault; the env-selected overload is what Program.cs calls.
            services.AddBlocksSecrets(SecretValueStoreType.Database);

            return services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });
        }

        [Fact]
        public void ApplicationServicesWithBlocksSecrets_ResolveSecretServiceAndAlertMailSingletons()
        {
            using var provider = BuildHostLikeProvider();
            using var scope = provider.CreateScope();

            scope.ServiceProvider.GetRequiredService<ISecretService>().Should().NotBeNull();
            provider.GetRequiredService<AlertMailPasswordResolver>().Should().NotBeNull();
            provider.GetRequiredService<EmailAlertService>().Should().NotBeNull();
        }

        [Fact]
        public void AddApplicationServices_RegistersResolverAsSingleton()
        {
            var services = new ServiceCollection();

            services.AddApplicationServices();

            services.Should().ContainSingle(d => d.ServiceType == typeof(AlertMailPasswordResolver)
                && d.Lifetime == ServiceLifetime.Singleton);
        }

        [Theory]
        [InlineData("Api")]
        [InlineData("Worker")]
        public void HostProgram_RegistersBlocksSecretsAfterApplicationServices(string host)
        {
            // Comments are stripped so the explanatory comment alone cannot satisfy the check.
            var program = Regex.Replace(File.ReadAllText(LocateProgramCs(host)), @"//[^\n]*", string.Empty);

            var applicationIndex = program.IndexOf("ServiceRegistry.AddApplicationServices(services);", StringComparison.Ordinal);
            var secretsIndex = program.IndexOf("services.AddBlocksSecrets();", StringComparison.Ordinal);

            applicationIndex.Should().BeGreaterThan(-1);
            secretsIndex.Should().BeGreaterThan(applicationIndex, $"{host}/Program.cs must call AddBlocksSecrets()");
        }

        private static string LocateProgramCs(string host)
        {
            for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
            {
                var candidate = Path.Combine(dir.FullName, host, "Program.cs");
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }

            throw new FileNotFoundException($"could not locate {host}/Program.cs above " + AppContext.BaseDirectory);
        }
    }
}
