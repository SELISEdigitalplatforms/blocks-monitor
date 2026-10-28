using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using Blocks.Secrets;
using DomainService.Alert.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Moq;

namespace XUnitTest.Utilities
{
    /// <summary>Shared doubles for alert-mail password resolution (blocks-monitor#253).</summary>
    public static class AlertMailTestDoubles
    {
        public const string RootTenantId = "root-tenant";

        public static IConfiguration Configuration(string? rootTenantId = RootTenantId) =>
            new ConfigurationBuilder()
                .AddInMemoryCollection(new Dictionary<string, string?> { ["RootTenantId"] = rootTenantId })
                .Build();

        /// <summary>
        /// A real resolver whose DI scopes serve <paramref name="secrets"/> as the scoped
        /// ISecretService. The mock doubles as the counting fake: verify GetValueAsync on it.
        /// Without one, a strict mock fails any read, which suits callers that only use legacy
        /// (plaintext) configurations.
        /// </summary>
        public static AlertMailPasswordResolver PasswordResolver(Mock<ISecretService>? secrets = null, string? rootTenantId = RootTenantId)
        {
            var secretService = (secrets ?? new Mock<ISecretService>(MockBehavior.Strict)).Object;
            var services = new ServiceCollection();
            services.AddScoped(_ => secretService);
            var provider = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });

            return new AlertMailPasswordResolver(provider.GetRequiredService<IServiceScopeFactory>(), Configuration(rootTenantId));
        }
    }

    /// <summary>Records every log call with its rendered message, structured state and exception.</summary>
    public sealed class CapturingLogger<T> : ILogger<T>
    {
        private readonly ConcurrentQueue<LogEntry> _entries = new();

        public IReadOnlyList<LogEntry> Entries => _entries.ToList();

        public IDisposable? BeginScope<TState>(TState state) where TState : notnull => null;

        public bool IsEnabled(LogLevel logLevel) => true;

        public void Log<TState>(LogLevel logLevel, EventId eventId, TState state, Exception? exception, Func<TState, Exception?, string> formatter)
        {
            var values = state is IEnumerable<KeyValuePair<string, object?>> pairs
                ? pairs.ToDictionary(p => p.Key, p => p.Value?.ToString())
                : new Dictionary<string, string?>();
            _entries.Enqueue(new LogEntry(logLevel, formatter(state, exception), values, exception));
        }
    }

    public sealed record LogEntry(LogLevel Level, string Message, IReadOnlyDictionary<string, string?> State, Exception? Exception)
    {
        /// <summary>Everything this entry would emit: message, every state value and the exception text.</summary>
        public string AllText =>
            string.Join("\n", new[] { Message, Exception?.ToString() ?? string.Empty }
                .Concat(State.Select(kv => $"{kv.Key}={kv.Value}")));
    }
}
