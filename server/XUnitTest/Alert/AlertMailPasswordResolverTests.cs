using System;
using System.Linq;
using System.Reflection;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using Blocks.Genesis;
using Blocks.Secrets;
using DomainService.Alert.Entities;
using DomainService.Alert.Services;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Moq;
using XUnitTest.Utilities;

namespace XUnitTest.Alert
{
    public class AlertMailPasswordResolverTests
    {
        private const string Reference = "secret-ref-7f3a";
        private const string SecretPassword = "new-pass-9c1e";

        private static MailServerConfiguration Referenced(string reference = Reference, string accountPassword = "") =>
            new() { ItemId = "cfg1", AccountPassword = accountPassword, AccountPasswordReference = reference };

        private static BlocksContext CallerContext(string tenantId = "caller-tenant") =>
            BlocksContext.Create(tenantId, [], "caller-user", true, "/api/health/ping", "org", DateTime.UtcNow.AddMinutes(5),
                "caller@test.com", [], "caller", "", "Caller", "token", tenantId);

        [Fact]
        public async Task ResolveAsync_LegacyConfig_ReturnsPlaintextWithoutCreatingAScope()
        {
            // H7, C8: no reference, no DI scope and no secret read.
            var scopes = new Mock<IServiceScopeFactory>(MockBehavior.Strict);
            var sut = new AlertMailPasswordResolver(scopes.Object, AlertMailTestDoubles.Configuration());

            var result = await sut.ResolveAsync(new MailServerConfiguration { AccountPassword = "ses-pass" });

            result.Succeeded.Should().BeTrue();
            result.Password.Should().Be("ses-pass");
            scopes.Verify(s => s.CreateScope(), Times.Never);
        }

        [Fact]
        public async Task ResolveAsync_ReadsInsideAuthenticatedRootTenantContext_AndRestoresCallerContext()
        {
            // H8: the read runs as the root tenant even though an authenticated caller context is
            // forced in place (as an ambient HttpContext identity would be), which is then restored.
            BlocksContext? seen = null;
            var secrets = new Mock<ISecretService>(MockBehavior.Strict);
            secrets.Setup(s => s.GetValueAsync(Reference, It.IsAny<CancellationToken>()))
                   .Callback(() => seen = BlocksContext.GetContext())
                   .ReturnsAsync(SecretPassword);
            var caller = CallerContext();
            BlocksContext.SetContext(caller, true);

            try
            {
                var result = await AlertMailTestDoubles.PasswordResolver(secrets).ResolveAsync(Referenced());

                result.Succeeded.Should().BeTrue();
                result.Password.Should().Be(SecretPassword);
                seen.Should().NotBeNull();
                seen!.TenantId.Should().Be(AlertMailTestDoubles.RootTenantId);
                seen.OriginalTenantId.Should().Be(AlertMailTestDoubles.RootTenantId);
                seen.IsAuthenticated.Should().BeTrue();
                seen.UserId.Should().Be(AlertMailPasswordResolver.ServiceUserId);
                BlocksContext.GetContext().Should().BeSameAs(caller);
            }
            finally
            {
                BlocksContext.SetContext(null, false);
            }
        }

        [Fact]
        public async Task ResolveAsync_UnderAmbientHttpIdentityOfAnotherTenant_ReadsAsRootTenant_AndRestoresCaller()
        {
            // H8: HealthController.Ping -> Task.Run carries the request's HttpContext, whose
            // authenticated non-root identity BlocksContext.GetContext() prefers over a context set
            // with changeContext: false. Only changeContext: true makes the read run as root.
            BlocksContext? seen = null;
            var secrets = new Mock<ISecretService>(MockBehavior.Strict);
            secrets.Setup(s => s.GetValueAsync(Reference, It.IsAny<CancellationToken>()))
                   .Callback(() => seen = BlocksContext.GetContext())
                   .ReturnsAsync(SecretPassword);
            var sut = AlertMailTestDoubles.PasswordResolver(secrets);

            var previousAccessor = BlocksHttpContextAccessor.Instance;
            var accessor = new HttpContextAccessor();
            BlocksHttpContextAccessor.Instance = accessor;
            try
            {
                accessor.HttpContext = new DefaultHttpContext
                {
                    User = new ClaimsPrincipal(new ClaimsIdentity(
                        new[] { new Claim("tenant_id", "caller-tenant"), new Claim("user_id", "caller-user"), new Claim("sub", "caller-user") },
                        "Bearer")),
                };
                BlocksContext.GetContext()!.TenantId.Should().Be("caller-tenant", "precondition: the ambient HTTP identity is the caller context");

                var result = await Task.Run(() => sut.ResolveAsync(Referenced()));

                result.Password.Should().Be(SecretPassword);
                seen.Should().NotBeNull();
                seen!.TenantId.Should().Be(AlertMailTestDoubles.RootTenantId);
                seen.UserId.Should().Be(AlertMailPasswordResolver.ServiceUserId);
                BlocksContext.GetContext()!.TenantId.Should().Be("caller-tenant");
            }
            finally
            {
                accessor.HttpContext = null;
                BlocksHttpContextAccessor.Instance = previousAccessor;
                BlocksContext.SetContext(null, false);
            }
        }

        // C6 harness. In an ordinary flow the runtime rolls back AsyncLocal changes made inside an
        // awaited method, so a missing `finally` would go unnoticed. Here, on a pool thread with no
        // SynchronizationContext, the flow is suppressed and the pending read is completed on that
        // same thread: the resolver's code after its await then runs inline in this thread's
        // ExecutionContext with no rollback, so the context left here is exactly what the
        // resolver's explicit restore wrote. `completingContext` is put on the thread first, so the
        // result differs from the caller's context whenever no restore happens.
        private static async Task<(BlocksContext? Left, AlertMailPasswordResult Result)> ContextLeftAfterReadAsync(
            BlocksContext? caller, BlocksContext completingContext, Action<TaskCompletionSource<string>> completeRead)
        {
            var read = new TaskCompletionSource<string>(); // inline continuations on purpose
            var secrets = new Mock<ISecretService>(MockBehavior.Strict);
            secrets.Setup(s => s.GetValueAsync(Reference, It.IsAny<CancellationToken>())).Returns(read.Task);
            var sut = AlertMailTestDoubles.PasswordResolver(secrets);

            var (left, resolve) = await Task.Run(() =>
            {
                BlocksContext.SetContext(caller, caller is not null);
                var flow = ExecutionContext.SuppressFlow();
                try
                {
                    var pending = sut.ResolveAsync(Referenced());
                    pending.IsCompleted.Should().BeFalse("the secret read must still be pending");

                    BlocksContext.SetContext(completingContext, true);
                    completeRead(read);
                    pending.IsCompleted.Should().BeTrue("the resolver must have finished inline on this thread");

                    return (BlocksContext.GetContext(), pending);
                }
                finally
                {
                    flow.Undo();
                }
            });

            return (left, await resolve);
        }

        private static Action<TaskCompletionSource<string>> CompleteRead(string outcome) => outcome switch
        {
            "success" => read => read.SetResult(SecretPassword),
            nameof(SecretNotFoundException) => read => read.SetException(new SecretNotFoundException(Reference)),
            _ => read => read.SetException(new InvalidOperationException("store misconfigured")),
        };

        [Theory]
        [InlineData("success")]
        [InlineData(nameof(SecretNotFoundException))]
        [InlineData(nameof(InvalidOperationException))]
        public async Task ResolveAsync_AfterTheRead_ExplicitlyRestoresCallerContext(string outcome)
        {
            // C6: whether the read succeeds or throws, the resolver writes the caller's context back.
            var caller = CallerContext();
            try
            {
                var (left, result) = await ContextLeftAfterReadAsync(caller, CallerContext("completing-tenant"), CompleteRead(outcome));

                left.Should().BeSameAs(caller);
                result.Succeeded.Should().Be(outcome == "success");
            }
            finally
            {
                BlocksContext.SetContext(null, false);
            }
        }

        [Theory]
        [InlineData("success")]
        [InlineData(nameof(SecretNotFoundException))]
        public async Task ResolveAsync_WithNoCallerContext_ExplicitlyLeavesNoContextBehind(string outcome)
        {
            // C6: a background caller (worker, timer) had no context and gets none back.
            try
            {
                var (left, result) = await ContextLeftAfterReadAsync(null, CallerContext("completing-tenant"), CompleteRead(outcome));

                left.Should().BeNull();
                result.Succeeded.Should().Be(outcome == "success");
            }
            finally
            {
                BlocksContext.SetContext(null, false);
            }
        }

        [Fact]
        public async Task ResolveAsync_CreatesAndDisposesAFreshScopePerCall()
        {
            // H11: ISecretService is scoped; the singleton must not capture one.
            var secrets = new Mock<ISecretService>();
            secrets.Setup(s => s.GetValueAsync(Reference, It.IsAny<CancellationToken>())).ReturnsAsync(SecretPassword);
            var provider = new Mock<IServiceProvider>();
            provider.Setup(p => p.GetService(typeof(ISecretService))).Returns(secrets.Object);
            var scope = new Mock<IServiceScope>();
            scope.SetupGet(s => s.ServiceProvider).Returns(provider.Object);
            var scopes = new Mock<IServiceScopeFactory>();
            scopes.Setup(s => s.CreateScope()).Returns(scope.Object);
            var sut = new AlertMailPasswordResolver(scopes.Object, AlertMailTestDoubles.Configuration());

            await sut.ResolveAsync(Referenced());
            await sut.ResolveAsync(Referenced());

            scopes.Verify(s => s.CreateScope(), Times.Exactly(2));
            scope.Verify(s => s.Dispose(), Times.Exactly(2));
            provider.Verify(p => p.GetService(typeof(ISecretService)), Times.Exactly(2));
        }

        [Fact]
        public async Task ResolveAsync_ResolvesANewScopedSecretServicePerCall_UnderScopeValidation()
        {
            // H11 against a real container with scope validation: one scoped instance per call.
            var created = 0;
            var services = new ServiceCollection();
            services.AddScoped(_ =>
            {
                Interlocked.Increment(ref created);
                var secrets = new Mock<ISecretService>();
                secrets.Setup(s => s.GetValueAsync(Reference, It.IsAny<CancellationToken>())).ReturnsAsync(SecretPassword);
                return secrets.Object;
            });
            services.AddSingleton(AlertMailTestDoubles.Configuration());
            services.AddSingleton<AlertMailPasswordResolver>();
            using var root = services.BuildServiceProvider(new ServiceProviderOptions { ValidateScopes = true, ValidateOnBuild = true });
            var sut = root.GetRequiredService<AlertMailPasswordResolver>();

            (await sut.ResolveAsync(Referenced())).Password.Should().Be(SecretPassword);
            (await sut.ResolveAsync(Referenced())).Password.Should().Be(SecretPassword);

            created.Should().Be(2);
        }

        [Theory]
        [InlineData(null)]
        [InlineData("")]
        [InlineData("   ")]
        public async Task ResolveAsync_RootTenantNotConfigured_FailsWithoutSecretCall(string? rootTenantId)
        {
            // C5
            var scopes = new Mock<IServiceScopeFactory>(MockBehavior.Strict);
            var sut = new AlertMailPasswordResolver(scopes.Object, AlertMailTestDoubles.Configuration(rootTenantId));

            var result = await sut.ResolveAsync(Referenced(accountPassword: "old"));

            result.Succeeded.Should().BeFalse();
            result.Password.Should().BeNull();
            result.FailureClass.Should().Be("root_tenant_not_configured");
            result.ExceptionType.Should().BeNull();
            scopes.Verify(s => s.CreateScope(), Times.Never);
        }

        [Fact]
        public async Task ResolveAsync_RootTenantNotConfigured_LegacyConfigStillResolves()
        {
            // C5
            var sut = new AlertMailPasswordResolver(new Mock<IServiceScopeFactory>(MockBehavior.Strict).Object, AlertMailTestDoubles.Configuration(null));

            var result = await sut.ResolveAsync(new MailServerConfiguration { AccountPassword = "ses-pass" });

            result.Succeeded.Should().BeTrue();
            result.Password.Should().Be("ses-pass");
        }

        [Theory]
        [InlineData(nameof(SecretNotFoundException), "credential")]
        [InlineData(nameof(SecretStateException), "credential")]
        [InlineData(nameof(SecretAccessDeniedException), "credential")]
        [InlineData(nameof(SecretVaultException), "vault_unavailable")]
        [InlineData(nameof(SecretValidationException), "unexpected")]
        [InlineData(nameof(InvalidOperationException), "unexpected")]
        [InlineData(nameof(TimeoutException), "unexpected")]
        public async Task ResolveAsync_MapsFailuresToFailureClass_WithoutFallback(string failure, string failureClass)
        {
            // C1, C2, C3, Q3: no plaintext fallback, only the exception type is surfaced.
            Exception exception = failure switch
            {
                nameof(SecretNotFoundException) => new SecretNotFoundException(Reference),
                nameof(SecretStateException) => new SecretStateException("locked", "read"),
                nameof(SecretAccessDeniedException) => new SecretAccessDeniedException("denied"),
                nameof(SecretVaultException) => new SecretVaultException("down", "get", Reference),
                nameof(SecretValidationException) => new SecretValidationException("bad"),
                nameof(InvalidOperationException) => new InvalidOperationException("misconfigured"),
                _ => new TimeoutException("slow"),
            };
            var secrets = new Mock<ISecretService>(MockBehavior.Strict);
            secrets.Setup(s => s.GetValueAsync(Reference, It.IsAny<CancellationToken>())).ThrowsAsync(exception);

            var result = await AlertMailTestDoubles.PasswordResolver(secrets).ResolveAsync(Referenced(accountPassword: "old"));

            result.Succeeded.Should().BeFalse();
            result.Password.Should().BeNull();
            result.FailureClass.Should().Be(failureClass);
            result.ExceptionType.Should().Be(failure);
        }

        [Fact]
        public async Task ResolveAsync_SecretServiceNotRegistered_FailsAsUnexpected()
        {
            // Q3: a host without AddBlocksSecrets() fails the email instead of throwing.
            using var root = new ServiceCollection().BuildServiceProvider();
            var sut = new AlertMailPasswordResolver(root.GetRequiredService<IServiceScopeFactory>(), AlertMailTestDoubles.Configuration());

            var result = await sut.ResolveAsync(Referenced());

            result.Succeeded.Should().BeFalse();
            result.FailureClass.Should().Be("unexpected");
            result.ExceptionType.Should().Be(nameof(InvalidOperationException));
        }

        [Fact]
        public async Task ResolveAsync_ConcurrentCalls_ResolveIndependently()
        {
            // C9: two alerts in flight at once each get their own value and root-tenant context.
            var gateA = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            var gateB = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            var bothStarted = new CountdownEvent(2);
            var tenants = new System.Collections.Concurrent.ConcurrentBag<string>();
            var secrets = new Mock<ISecretService>(MockBehavior.Strict);
            secrets.Setup(s => s.GetValueAsync("ref-a", It.IsAny<CancellationToken>()))
                   .Returns(() => { tenants.Add(BlocksContext.GetContext()!.TenantId); bothStarted.Signal(); return gateA.Task; });
            secrets.Setup(s => s.GetValueAsync("ref-b", It.IsAny<CancellationToken>()))
                   .Returns(() => { tenants.Add(BlocksContext.GetContext()!.TenantId); bothStarted.Signal(); return gateB.Task; });
            var sut = AlertMailTestDoubles.PasswordResolver(secrets);

            var a = Task.Run(() => sut.ResolveAsync(Referenced("ref-a")));
            var b = Task.Run(() => sut.ResolveAsync(Referenced("ref-b")));
            bothStarted.Wait(TimeSpan.FromSeconds(10)).Should().BeTrue("both reads must be in flight together");
            gateB.SetResult("pass-b");
            gateA.SetResult("pass-a");

            (await a).Password.Should().Be("pass-a");
            (await b).Password.Should().Be("pass-b");
            tenants.Should().HaveCount(2).And.OnlyContain(t => t == AlertMailTestDoubles.RootTenantId);
        }

        [Theory]
        [InlineData(typeof(AlertMailPasswordResolver))]
        [InlineData(typeof(EmailAlertService))]
        public void Singletons_HoldNoMutableState(Type singleton)
        {
            // C9: no credential (or any other) field a concurrent call could overwrite.
            singleton.GetFields(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic)
                     .Should().OnlyContain(f => f.IsInitOnly);
        }

        [Fact]
        public async Task Result_DoesNotRenderThePassword()
        {
            // C4: a result that ends up in a log or exception text must not carry the value.
            var secrets = new Mock<ISecretService>();
            secrets.Setup(s => s.GetValueAsync(Reference, It.IsAny<CancellationToken>())).ReturnsAsync(SecretPassword);

            var result = await AlertMailTestDoubles.PasswordResolver(secrets).ResolveAsync(Referenced());

            result.ToString().Should().NotContain(SecretPassword);
        }
    }
}
