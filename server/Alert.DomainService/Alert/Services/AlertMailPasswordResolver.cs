using Blocks.Genesis;
using Blocks.Secrets;
using DomainService.Alert.Entities;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace DomainService.Alert.Services
{
    /// <summary>
    /// Outcome of one alert-mail password resolution. The password lives only in this object for
    /// the duration of one send; ToString is not overridden, so it never prints the value.
    /// </summary>
    public sealed class AlertMailPasswordResult
    {
        public const string CredentialFailure = "credential";
        public const string VaultUnavailable = "vault_unavailable";
        public const string RootTenantNotConfigured = "root_tenant_not_configured";
        public const string Unexpected = "unexpected";

        private AlertMailPasswordResult(bool succeeded, string? password, string? failureClass, string? exceptionType)
        {
            Succeeded = succeeded;
            Password = password;
            FailureClass = failureClass;
            ExceptionType = exceptionType;
        }

        public bool Succeeded { get; }
        public string? Password { get; }
        public string? FailureClass { get; }

        /// <summary>The type name of the exception that failed the read; never its message.</summary>
        public string? ExceptionType { get; }

        public static AlertMailPasswordResult Success(string? password) => new(true, password, null, null);

        public static AlertMailPasswordResult Failure(string failureClass, string? exceptionType) =>
            new(false, null, failureClass, exceptionType);
    }

    /// <summary>
    /// Resolves the SMTP password of a root mail configuration. A non-empty
    /// AccountPasswordReference is authoritative and is read from Blocks Secrets in the root
    /// tenant; otherwise the legacy plaintext AccountPassword is used with no secret read.
    /// </summary>
    /// <remarks>
    /// Registered as a singleton, so it holds no per-call state: ISecretService is scoped and is
    /// resolved from a fresh DI scope on every call, and nothing is cached.
    /// </remarks>
    public class AlertMailPasswordResolver
    {
        // Named actor recorded on the Blocks Secrets audit row for each read.
        public const string ServiceUserId = "blocks-monitor-alert-mail";

        private readonly IServiceScopeFactory _scopeFactory;
        private readonly IConfiguration _configuration;

        public AlertMailPasswordResolver(IServiceScopeFactory scopeFactory, IConfiguration configuration)
        {
            _scopeFactory = scopeFactory;
            _configuration = configuration;
        }

        public async Task<AlertMailPasswordResult> ResolveAsync(MailServerConfiguration config, CancellationToken cancellationToken = default)
        {
            var reference = config.AccountPasswordReference;
            if (string.IsNullOrEmpty(reference))
            {
                return AlertMailPasswordResult.Success(config.AccountPassword);
            }

            // The reference wins: AccountPassword is never used from here on, even on failure.
            var rootTenantId = _configuration["RootTenantId"];
            if (string.IsNullOrWhiteSpace(rootTenantId))
            {
                return AlertMailPasswordResult.Failure(AlertMailPasswordResult.RootTenantNotConfigured, null);
            }

            try
            {
                var password = await ReadInRootTenantAsync(rootTenantId, reference, cancellationToken).ConfigureAwait(false);
                return AlertMailPasswordResult.Success(password);
            }
            // Only the exception type is surfaced: Secret* messages and properties carry the reference id.
            catch (SecretVaultException ex)
            {
                return AlertMailPasswordResult.Failure(AlertMailPasswordResult.VaultUnavailable, ex.GetType().Name);
            }
            catch (Exception ex) when (ex is SecretNotFoundException or SecretStateException or SecretAccessDeniedException)
            {
                return AlertMailPasswordResult.Failure(AlertMailPasswordResult.CredentialFailure, ex.GetType().Name);
            }
            catch (Exception ex)
            {
                // e.g. InvalidOperationException from a misconfigured store or SecretValidationException.
                return AlertMailPasswordResult.Failure(AlertMailPasswordResult.Unexpected, ex.GetType().Name);
            }
        }

        private async Task<string> ReadInRootTenantAsync(string rootTenantId, string reference, CancellationToken cancellationToken)
        {
            var restore = BlocksContext.GetContext();

            try
            {
                // changeContext: true so GetContext() returns this context even where an ambient
                // HttpContext (e.g. the API ping path) carries another authenticated identity.
                BlocksContext.SetContext(CreateRootTenantContext(rootTenantId), true);

                using var scope = _scopeFactory.CreateScope();
                var secrets = scope.ServiceProvider.GetRequiredService<ISecretService>();

                return await secrets.GetValueAsync(reference, cancellationToken).ConfigureAwait(false);
            }
            finally
            {
                BlocksContext.SetContext(restore, restore is not null);
            }
        }

        // Blocks.Secrets refuses unauthenticated contexts or a blank tenant id.
        private static BlocksContext CreateRootTenantContext(string rootTenantId) =>
            BlocksContext.Create(
                tenantId: rootTenantId,
                roles: [],
                userId: ServiceUserId,
                isAuthenticated: true,
                requestUri: string.Empty,
                organizationId: string.Empty,
                expireOn: DateTime.MinValue,
                email: string.Empty,
                permissions: [],
                userName: ServiceUserId,
                phoneNumber: string.Empty,
                displayName: ServiceUserId,
                oauthToken: string.Empty,
                originalTenantId: rootTenantId,
                applicationDomain: string.Empty);
    }
}
