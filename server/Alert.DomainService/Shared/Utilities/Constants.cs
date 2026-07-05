using Blocks.Genesis;

namespace DomainService.Shared.Utilities
{
    public class ObservabilityConstants
    {
        public static readonly string MonitorConfigurationUpdateQueue = "blocks_alert_monitor_config_update_listener";
        public List<string> HttpStatusCodes_200 = new List<string>() { "200,201,202,203,204,205,206,207,208,226" };
        public List<string> HttpStatusCodes_300 = new List<string>() { "300,301,302,303,304,305,306,307,308" };

        private const string DefaultProvider = "azure";
        private const string RabbitMqProvider = "rabbitmq";

        public static MessageConfiguration GetApiMessageConfiguration(string messageConnectionString)
        {
            var provider = GetProvider(messageConnectionString);

            return provider switch
            {
                RabbitMqProvider => new MessageConfiguration
                {
                    RabbitMqConfiguration = new RabbitMqConfiguration
                    {
                        ConsumerSubscriptions =
                        [
                            ConsumerSubscription.BindToQueue(MonitorConfigurationUpdateQueue)
                        ]
                    }
                },
                _ => new MessageConfiguration
                {
                    AzureServiceBusConfiguration = new AzureServiceBusConfiguration
                    {
                        Queues = [MonitorConfigurationUpdateQueue],
                        Topics = []
                    }
                }
            };
        }

        public static MessageConfiguration GetWorkerMessageConfiguration(string messageConnectionString)
        {
            var provider = GetProvider(messageConnectionString);

            return provider switch
            {
                RabbitMqProvider => new MessageConfiguration
                {
                    RabbitMqConfiguration = new RabbitMqConfiguration
                    {
                        ConsumerSubscriptions =
                        [
                            ConsumerSubscription.BindToQueue(MonitorConfigurationUpdateQueue)
                        ]
                    }
                },
                _ => new MessageConfiguration
                {
                    AzureServiceBusConfiguration = new AzureServiceBusConfiguration
                    {
                        Queues = [MonitorConfigurationUpdateQueue],
                        Topics = []
                    }
                }
            };
        }

        private static string GetProvider(string messageConnectionString)
        {
            if (Uri.TryCreate(messageConnectionString, UriKind.Absolute, out var uri))
            {
                if (uri.Scheme.Equals("amqp", StringComparison.OrdinalIgnoreCase) ||
                    uri.Scheme.Equals("amqps", StringComparison.OrdinalIgnoreCase))
                {
                    return RabbitMqProvider;
                }
            }

            return DefaultProvider;
        }
    }
}
