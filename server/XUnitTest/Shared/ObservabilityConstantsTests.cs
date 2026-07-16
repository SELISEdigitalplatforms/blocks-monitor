using DomainService.Shared.Utilities;
using FluentAssertions;

namespace XUnitTest.Shared
{
    public class ObservabilityConstantsTests
    {
        [Theory]
        [InlineData("Endpoint=sb://blocks.servicebus.windows.net/;SharedAccessKeyName=x")]
        [InlineData("some-random-connection-string")]
        public void GetApiMessageConfiguration_NonAmqp_UsesAzureServiceBus(string connectionString)
        {
            var config = ObservabilityConstants.GetApiMessageConfiguration(connectionString);

            config.AzureServiceBusConfiguration.Should().NotBeNull();
            config.RabbitMqConfiguration.Should().BeNull();
            config.AzureServiceBusConfiguration.Queues.Should().Contain(ObservabilityConstants.MonitorConfigurationUpdateQueue);
        }

        [Theory]
        [InlineData("amqp://guest:guest@localhost:5672/")]
        [InlineData("amqps://user:pass@host:5671/")]
        public void GetApiMessageConfiguration_Amqp_UsesRabbitMq(string connectionString)
        {
            var config = ObservabilityConstants.GetApiMessageConfiguration(connectionString);

            config.RabbitMqConfiguration.Should().NotBeNull();
            config.AzureServiceBusConfiguration.Should().BeNull();
            config.RabbitMqConfiguration.ConsumerSubscriptions.Should().NotBeEmpty();
        }

        [Fact]
        public void GetWorkerMessageConfiguration_Amqp_UsesRabbitMq()
        {
            var config = ObservabilityConstants.GetWorkerMessageConfiguration("amqp://localhost");

            config.RabbitMqConfiguration.Should().NotBeNull();
            config.RabbitMqConfiguration.ConsumerSubscriptions.Should()
                .Contain(s => s.QueueName == ObservabilityConstants.MonitorConfigurationUpdateQueue);
        }

        [Fact]
        public void GetWorkerMessageConfiguration_NonAmqp_UsesAzureServiceBus()
        {
            var config = ObservabilityConstants.GetWorkerMessageConfiguration("azure-conn");

            config.AzureServiceBusConfiguration.Should().NotBeNull();
            config.AzureServiceBusConfiguration.Queues.Should().Contain(ObservabilityConstants.MonitorConfigurationUpdateQueue);
        }
    }
}
