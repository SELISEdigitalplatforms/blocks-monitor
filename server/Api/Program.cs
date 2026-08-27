using Blocks.Extensions.DependencyInjection;
using Blocks.Genesis;
using Microsoft.AspNetCore.Http.Features;
using SeliseBlocks.ConfigurationDriver;
using DomainService.Shared.Utilities;

var serviceName = "blocks-monitor-api";
var vaultType = ResolveVaultType();
var secret = await ApplicationConfigurations.ConfigureLogAndSecretsAsync(serviceName, vaultType);
var builder = WebApplication.CreateBuilder(args);
ApplicationConfigurations.ConfigureApiEnv(builder, args);

builder.Configuration.AddMongoDbConfiguration(options =>
{
 options.ConnectionString = secret.DatabaseConnectionString;
 options.DatabaseName = secret.RootDatabaseName;
 options.CollectionName = "Secrets";
 options.SecretKey = "blocks-secret-monitor";
});

ApplicationConfigurations.ConfigureServices(builder.Services, MonitorConstants.GetApiMessageConfiguration(secret.MessageConnectionString));

builder.Services.Configure<FormOptions>(options =>
{
 options.MultipartBodyLengthLimit = 15 * 1024 * 1024; // 15 MB
});

var services = builder.Services;

services.AddHealthChecks();

if (builder.Environment.IsDevelopment())
{
 services.AddCors(options =>
 {
  options.AddPolicy("LocalDevelopmentCors", policy =>
     {
      policy
             .SetIsOriginAllowed(origin =>
             {
              if (!Uri.TryCreate(origin, UriKind.Absolute, out var uri))
              {
               return false;
              }

              return IsLocalDevHost(uri.Host);
             })
             .AllowAnyHeader()
             .AllowAnyMethod()
             .AllowCredentials();
     });
 });
}

// Authorization currently resolves against the shared "blocks-os" IAM resource because Monitor's own
// permissions are not yet provisioned in IAM. The dedicated resource must be "blocks-monitor" (the
// customer-facing product name); "blocks-observability" is the retired legacy brand and must NOT be used.
// Switch the resource name below to "blocks-monitor" only once that resource and its scopes have been
// seeded and granted in IAM, otherwise every tenant loses monitor access on deploy.
ApplicationConfigurations.ConfigureApi(services, serviceName, serviceAccessResourceName: "blocks-os");

var wwwrootPath = Path.Combine(builder.Environment.ContentRootPath, "wwwroot");
Directory.CreateDirectory(wwwrootPath);

ApplyFrontendRuntimeSettings(builder.Configuration, wwwrootPath);


Alert.DomainService.ServiceRegistry.AddApplicationServices(services);

// Repository listing is served by our own API through IReleaseDriverService rather than by the
// browser calling blocks-logic, so Monitor no longer depends on an outside service for it.
// `vaultType` is the value already resolved above for ConfigureLogAndSecretsAsync - deliberately
// reused so this does not introduce a second, independently-configured vault choice.
// NOTE: this call reads the release driver's own secrets from that vault during startup, so the
// API will not boot in an environment where those secrets are absent.
await services.RegisterBlocksReleaseServicesAsync(vaultType);

var app = builder.Build();

app.UseDefaultFiles();
app.UseStaticFiles();

if (app.Environment.IsDevelopment())
{
 app.UseCors("LocalDevelopmentCors");
 app.Use(async (context, next) =>
 {
  NormalizeLocalDevTenantValidationHeaders(context.Request);
  await next();
 });
}

var indexHtml = Path.Combine(app.Environment.WebRootPath ?? "", "index.html");
if (File.Exists(indexHtml))
{
 app.MapFallbackToFile("/index.html");
 // x-blocks-key cookie
 // check if domain match
 // get google captch key BLOCKS_GOOGLE_SITE_KEY
 // Base Url
 // Construct URL


}

ApplicationConfigurations.ConfigureMiddleware(app);

await app.RunAsync();

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

static bool IsLocalDevHost(string host)
{
 return host.Equals("dev-monitor.blocksdevelopers.com", StringComparison.OrdinalIgnoreCase)
     || host.Equals("localhost", StringComparison.OrdinalIgnoreCase)
     || host.Equals("127.0.0.1", StringComparison.OrdinalIgnoreCase);
}

static void NormalizeLocalDevTenantValidationHeaders(HttpRequest request)
{
 NormalizeHeaderUrl(request.Headers, "Origin");
 NormalizeHeaderUrl(request.Headers, "Referer");

 static void NormalizeHeaderUrl(IHeaderDictionary headers, string headerName)
 {
  var value = headers[headerName].ToString();
  if (string.IsNullOrWhiteSpace(value) ||
      !Uri.TryCreate(value, UriKind.Absolute, out var uri) ||
      !IsLocalDevHost(uri.Host) ||
      uri.Port is not (4000 or 4001))
  {
   return;
  }

  headers[headerName] = $"{uri.Scheme}://{uri.Host}/";
 }
}

static void ApplyFrontendRuntimeSettings(IConfiguration configuration, string webRootPath)
{
 // ACTIVE path: read frontend runtime values from the "FrontendRuntime" section in
 // appsettings.{Environment}.json. Standard .NET config layering still applies, so
 // env vars named "FrontendRuntime__BLOCKS_*" override individual keys at deploy time.
 var section = configuration.GetSection("FrontendRuntime");
 var replacements = new Dictionary<string, string?>
 {
  ["__BLOCKS_X_BLOCKS_KEY__"] = section["BLOCKS_X_BLOCKS_KEY"],
  ["__BLOCKS_GOOGLE_SITE_KEY__"] = section["BLOCKS_GOOGLE_SITE_KEY"],
  ["__BLOCKS_CONSTRUCT_URL__"] = section["BLOCKS_CONSTRUCT_URL"],
  ["__BLOCKS_GITHUB_SSO_CLIENT_ID__"] = section["BLOCKS_GITHUB_SSO_CLIENT_ID"],
  ["__BLOCKS_IAM_BASE_URL__"] = section["BLOCKS_IAM_BASE_URL"],
  ["__BLOCKS_OIDC_CLIENT_ID__"] = section["BLOCKS_OIDC_CLIENT_ID"],
  ["__BLOCKS_BASE_DOMAIN__"] = section["BLOCKS_BASE_DOMAIN"],
  ["__BLOCKS_IAM_CALLBACK_URL__"] = section["BLOCKS_IAM_CALLBACK_URL"],
  ["__BLOCKS_LOCALIZATION_BASE_URL__"] = section["BLOCKS_LOCALIZATION_BASE_URL"],
  ["__BLOCKS_LOCALIZATION_CALLBACK_URL__"] = section["BLOCKS_LOCALIZATION_CALLBACK_URL"],
  ["__BLOCKS_AGENTS_BASE_URL__"] = section["BLOCKS_AGENTS_BASE_URL"],
  ["__BLOCKS_AGENTS_CALLBACK_URL__"] = section["BLOCKS_AGENTS_CALLBACK_URL"],
  ["__BLOCKS_DATA_BASE_URL__"] = section["BLOCKS_DATA_BASE_URL"],
  ["__BLOCKS_DATA_CALLBACK_URL__"] = section["BLOCKS_DATA_CALLBACK_URL"],
  ["__BLOCKS_OS_BASE_URL__"] = section["BLOCKS_OS_BASE_URL"],
  ["__BLOCKS_OS_CALLBACK_URL__"] = section["BLOCKS_OS_CALLBACK_URL"],
  ["__BLOCKS_UTILITIES_BASE_URL__"] = section["BLOCKS_UTILITIES_BASE_URL"],
  ["__BLOCKS_UTILITIES_CALLBACK_URL__"] = section["BLOCKS_UTILITIES_CALLBACK_URL"],
  ["__BLOCKS_LOGIC_BASE_URL__"] = section["BLOCKS_LOGIC_BASE_URL"],
  ["__BLOCKS_LOGIC_CALLBACK_URL__"] = section["BLOCKS_LOGIC_CALLBACK_URL"],
  ["__BLOCKS_MONITOR_BASE_URL__"] = section["BLOCKS_MONITOR_BASE_URL"],
  ["__BLOCKS_MONITOR_CALLBACK_URL__"] = section["BLOCKS_MONITOR_CALLBACK_URL"],
  ["__BLOCKS_RELEASE_BASE_URL__"] = section["BLOCKS_RELEASE_BASE_URL"],
  ["__BLOCKS_RELEASE_CALLBACK_URL__"] = section["BLOCKS_RELEASE_CALLBACK_URL"],
  ["__BLOCKS_STUDIO_BASE_URL__"] = section["BLOCKS_STUDIO_BASE_URL"],
  ["__BLOCKS_STUDIO_CALLBACK_URL__"] = section["BLOCKS_STUDIO_CALLBACK_URL"],
  ["__BLOCKS_DATA_CLIENT_ID__"] = section["BLOCKS_DATA_CLIENT_ID"],
  ["__BLOCKS_IAM_CLIENT_ID__"] = section["BLOCKS_IAM_CLIENT_ID"],
  ["__BLOCKS_LOCALIZATION_CLIENT_ID__"] = section["BLOCKS_LOCALIZATION_CLIENT_ID"],
  ["__BLOCKS_AGENTS_CLIENT_ID__"] = section["BLOCKS_AGENTS_CLIENT_ID"],
  ["__BLOCKS_OS_CLIENT_ID__"] = section["BLOCKS_OS_CLIENT_ID"],
  ["__BLOCKS_UTILITIES_CLIENT_ID__"] = section["BLOCKS_UTILITIES_CLIENT_ID"],
  ["__BLOCKS_LOGIC_CLIENT_ID__"] = section["BLOCKS_LOGIC_CLIENT_ID"],
  ["__BLOCKS_RELEASE_CLIENT_ID__"] = section["BLOCKS_RELEASE_CLIENT_ID"],
  ["__BLOCKS_MONITOR_CLIENT_ID__"] = section["BLOCKS_MONITOR_CLIENT_ID"],
  ["__BLOCKS_STUDIO_CLIENT_ID__"] = section["BLOCKS_STUDIO_CLIENT_ID"],
  ["__BLOCKS_ALLOWED_SERVICES__"] = section["BLOCKS_ALLOWED_SERVICES"],
  ["__BLOCKS_ROLLBAR_CLIENT_TOKEN__"] = section["BLOCKS_ROLLBAR_CLIENT_TOKEN"],
  ["__BLOCKS_ROLLBAR_ENV__"] = section["BLOCKS_ROLLBAR_ENV"],
 };





 var files = Directory.EnumerateFiles(webRootPath, "*", SearchOption.AllDirectories)
     .Where(path =>
     {
      var ext = Path.GetExtension(path);
      return ext.Equals(".html", StringComparison.OrdinalIgnoreCase)
             || ext.Equals(".js", StringComparison.OrdinalIgnoreCase)
             || ext.Equals(".css", StringComparison.OrdinalIgnoreCase)
             || ext.Equals(".json", StringComparison.OrdinalIgnoreCase);
     });

 foreach (var filePath in files)
 {
  var content = File.ReadAllText(filePath);
  var updated = content;

  foreach (var (token, value) in replacements)
  {
   if (!string.IsNullOrWhiteSpace(value))
   {
    updated = updated.Replace(token, value, StringComparison.Ordinal);
   }
  }

  if (!ReferenceEquals(content, updated) && !content.Equals(updated, StringComparison.Ordinal))
  {
   File.WriteAllText(filePath, updated);
  }
 }
}
