# SeliseBlocks.ObservabilityDriver

NuGet package that exposes the **Monitor** and **Health** APIs from `blocks-observability` as a single injectable service: `IObservabilityDriverService`. Consuming services (e.g. `blocks-logic`) can host these endpoints locally without depending on the full observability stack.

The driver mirrors the public surface of [`MonitorController`](../Api/Controllers/MonitorController.cs) and [`HealthController`](../Api/Controllers/HealthController.cs).

---

## Install

```xml
<PackageReference Include="SeliseBlocks.ObservabilityDriver" />
```

With Central Package Management, also add to `Directory.Packages.props`:

```xml
<PackageVersion Include="SeliseBlocks.ObservabilityDriver" Version="9.0.0-preview.1" />
```

## Register

```csharp
using Blocks.Extensions.DependencyInjection;

services.RegisterBlocksObservabilityServices();
```

Then inject `IObservabilityDriverService` into your controllers.

```csharp
public class MonitorController(IObservabilityDriverService observability) : ControllerBase
{
    [HttpGet, Authorize]
    public Task<PaginatedResponse> GetMonitorList(
        [FromQuery] string projectKey,
        [FromQuery] string? monitorSourceType,
        [FromQuery] int pageNumber = 0,
        [FromQuery] int pageSize = 10)
        => observability.GetMonitorListAsync(projectKey, monitorSourceType, pageNumber, pageSize);
}
```

---

## API Reference

All methods are on `IObservabilityDriverService` and are awaitable. Return types come from `DomainService.Shared.Models` / `DomainService.Monitor.Models`. `BaseApiResponse` is the standard observability response wrapper (`{ Data, Message, StatusCode, IsSuccess }`).

### Monitor

| # | Method | HTTP equivalent | Returns |
|---|--------|-----------------|---------|
| 1 | `GetMonitorListAsync` | `GET /Monitor/GetMonitorList` | `PaginatedResponse` |
| 2 | `GetMonitorListByRepoIdAsync` | `GET /Monitor/GetMonitorListByRepoId` | `BaseApiResponse` |
| 3 | `GetMonitorByIdAsync` | `GET /Monitor/GetMonitorById` | `BaseApiResponse` |
| 4 | `SaveMonitorAsync` | `POST /Monitor/SaveMonitor` | `BaseApiResponse` |
| 5 | `UpdateMonitorAsync` | `POST /Monitor/UpdateMonitor` | `BaseApiResponse` |
| 6 | `DeleteMonitorAsync` | `DELETE /Monitor/DeleteMonitor` | `BaseApiResponse` |
| 7 | `GetIncidentListAsync` | `GET /Monitor/GetIncidentList` | `PaginatedResponse` |
| 8 | `GetMonitorDetailsAsync` | `GET /Monitor/GetMonitorDetails` | `MonitorDetailsResponse` |
| 9 | `GetMonitorResponseTimeAsync` | `GET /Monitor/GetMonitorResponseTime` | `BaseApiResponse` |
| 10 | `GetMonitorDownTimeAsync` | `GET /Monitor/GetMonitorDownTime` | `BaseApiResponse` |
| 11 | `IsExternalServiceConfiguredAsync` | `GET /Monitor/IsExternalServiceConfigured` | `BaseApiResponse` |

### Health

| # | Method | HTTP equivalent | Returns |
|---|--------|-----------------|---------|
| 12 | `SaveHealthAsync` | `POST /Health/SaveHealth` | `BaseApiResponse` |
| 13 | `UpdateHealthAsync` | `POST /Health/UpdateHealth` | `BaseApiResponse` |
| 14 | `HandlePingAsync` | `GET /Health/Ping/{itemId}` | `Task` (no payload) |
| 15 | `DeleteHealthAsync` | `DELETE /Health/DeleteHealth` | `BaseApiResponse` |

---

## Endpoint details

### 1. `GetMonitorListAsync`

Paginated list of monitor configurations for a project, optionally filtered by monitor source type.

```csharp
Task<PaginatedResponse> GetMonitorListAsync(
    string projectKey,
    string? monitorSourceType,
    int pageNumber = 0,
    int pageSize = 10);
```

- **Query string:** `?projectKey=A8D3007A36F840DCAFDE6F4AE68EE897&monitorSourceType=DeployedServices&pageNumber=0&pageSize=10`

### 2. `GetMonitorListByRepoIdAsync`

Monitor configurations (with downtime) scoped to a single repository.

```csharp
Task<BaseApiResponse> GetMonitorListByRepoIdAsync(string projectKey, string repoId);
```

- **Query string:** `?projectKey=A8D3007A36F840DCAFDE6F4AE68EE897&repoId=repo-123`

### 3. `GetMonitorByIdAsync`

Fetch a single monitor configuration.

```csharp
Task<BaseApiResponse> GetMonitorByIdAsync(string monitorId);
```

- **Query string:** `?monitorId=66f1c2b9e8d4a712d4c5e1f0`

### 4. `SaveMonitorAsync`

Create a new monitor configuration.

```csharp
Task<BaseApiResponse> SaveMonitorAsync(SaveMonitorConfigurationRequest request);
```

**Sample body** (`SaveMonitorConfigurationRequest`):

```json
{
  "projectKey": "A8D3007A36F840DCAFDE6F4AE68EE897",
  "repoId": "repo-123",
  "repoName": "blocks-logic",
  "externalServiceId": null,
  "externalServiceName": null,
  "name": "Logic API health",
  "url": "https://dev-logic.blocksdevelopers.com/health",
  "monitorType": "Http",
  "protocolType": "Https",
  "httpMethodType": "GET",
  "authorizationType": "None",
  "intervalInSeconds": 60,
  "timeoutInSeconds": 10,
  "isActive": true,
  "monitorSourceType": "DeployedServices",
  "expectedContent": "OK",
  "customHttpHeaders": null,
  "customPayload": null,
  "successHttpResponseCodes": ["200", "204"],
  "regions": ["eu-west-1"],
  "emails": ["oncall@example.com"]
}
```

### 5. `UpdateMonitorAsync`

Update an existing monitor configuration. Same fields as `SaveMonitorConfigurationRequest` **plus** `itemId`.

```csharp
Task<BaseApiResponse> UpdateMonitorAsync(UpdateMonitorConfigurationRequest request);
```

**Sample body** (`UpdateMonitorConfigurationRequest`):

```json
{
  "itemId": "66f1c2b9e8d4a712d4c5e1f0",
  "projectKey": "A8D3007A36F840DCAFDE6F4AE68EE897",
  "repoId": "repo-123",
  "repoName": "blocks-logic",
  "name": "Logic API health",
  "url": "https://dev-logic.blocksdevelopers.com/health",
  "monitorType": "Http",
  "protocolType": "Https",
  "httpMethodType": "GET",
  "authorizationType": "None",
  "intervalInSeconds": 120,
  "timeoutInSeconds": 15,
  "isActive": true,
  "monitorSourceType": "DeployedServices",
  "expectedContent": "OK",
  "successHttpResponseCodes": ["200"],
  "regions": ["eu-west-1", "us-east-1"],
  "emails": ["oncall@example.com"]
}
```

### 6. `DeleteMonitorAsync`

Delete a monitor configuration by id.

```csharp
Task<BaseApiResponse> DeleteMonitorAsync(string itemId);
```

- **Query string:** `?itemId=66f1c2b9e8d4a712d4c5e1f0`

### 7. `GetIncidentListAsync`

Paginated incident history for a monitor.

```csharp
Task<PaginatedResponse> GetIncidentListAsync(string monitorId, int pageNumber = 0, int pageSize = 10);
```

- **Query string:** `?monitorId=66f1c2b9e8d4a712d4c5e1f0&pageNumber=0&pageSize=10`

### 8. `GetMonitorDetailsAsync`

Aggregated incident duration / details for a monitor.

```csharp
Task<MonitorDetailsResponse> GetMonitorDetailsAsync(string monitorId);
```

- **Query string:** `?monitorId=66f1c2b9e8d4a712d4c5e1f0`

### 9. `GetMonitorResponseTimeAsync`

Response-time ping log for a monitor over an optional date range. Dates accept ISO 8601 strings.

```csharp
Task<BaseApiResponse> GetMonitorResponseTimeAsync(string monitorId, string? startDate, string? endDate);
```

- **Query string:** `?monitorId=66f1c2b9e8d4a712d4c5e1f0&startDate=2026-05-01T00:00:00Z&endDate=2026-05-11T23:59:59Z`

### 10. `GetMonitorDownTimeAsync`

Downtime log for a monitor over an optional date range.

```csharp
Task<BaseApiResponse> GetMonitorDownTimeAsync(string monitorId, string? startDate, string? endDate);
```

- **Query string:** `?monitorId=66f1c2b9e8d4a712d4c5e1f0&startDate=2026-05-01T00:00:00Z&endDate=2026-05-11T23:59:59Z`

### 11. `IsExternalServiceConfiguredAsync`

Returns the monitor configuration tied to a given external service id, wrapped in `BaseApiResponse`. `Data` is `null` when no monitor exists.

```csharp
Task<BaseApiResponse> IsExternalServiceConfiguredAsync(string externalServiceId);
```

- **Query string:** `?externalServiceId=ext-service-9d1`
- **Sample response:**

```json
{
  "data": {
    "itemId": "66f1c2b9e8d4a712d4c5e1f0",
    "projectKey": "A8D3007A36F840DCAFDE6F4AE68EE897",
    "externalServiceId": "ext-service-9d1",
    "isActive": true
  },
  "message": null,
  "statusCode": 0,
  "isSuccess": true
}
```

### 12. `SaveHealthAsync`

Create a new health check configuration.

```csharp
Task<BaseApiResponse> SaveHealthAsync(SaveHealthConfigurationRequest request);
```

**Sample body** (`SaveHealthConfigurationRequest`):

```json
{
  "projectKey": "A8D3007A36F840DCAFDE6F4AE68EE897",
  "name": "Logic API heartbeat",
  "repoId": "repo-123",
  "repoName": "blocks-logic",
  "externalServiceId": null,
  "isActive": true,
  "intervalInSeconds": 60,
  "gracePeriodInSeconds": 30,
  "monitorSourceType": "DeployedServices",
  "emails": ["oncall@example.com"]
}
```

### 13. `UpdateHealthAsync`

Update an existing health configuration. Same fields as `SaveHealthConfigurationRequest` **plus** `itemId`.

```csharp
Task<BaseApiResponse> UpdateHealthAsync(UpdateHealthConfigurationRequest request);
```

**Sample body** (`UpdateHealthConfigurationRequest`):

```json
{
  "itemId": "66f1c2b9e8d4a712d4c5e1f0",
  "projectKey": "A8D3007A36F840DCAFDE6F4AE68EE897",
  "name": "Logic API heartbeat",
  "repoId": "repo-123",
  "repoName": "blocks-logic",
  "externalServiceId": null,
  "isActive": true,
  "intervalInSeconds": 120,
  "gracePeriodInSeconds": 60,
  "monitorSourceType": "DeployedServices",
  "emails": ["oncall@example.com"]
}
```

### 14. `HandlePingAsync`

Record a heartbeat ping for a configured health check. Returns `Task` (no body).

```csharp
Task HandlePingAsync(string itemId);
```

- **Path/route param:** `itemId`
- **Sample call:** `GET /Health/Ping/66f1c2b9e8d4a712d4c5e1f0`

### 15. `DeleteHealthAsync`

Delete a health configuration by id. Internally routed through the monitor configuration service (same as the original controller).

```csharp
Task<BaseApiResponse> DeleteHealthAsync(string itemId);
```

- **Query string:** `?itemId=66f1c2b9e8d4a712d4c5e1f0`

---

## Response shapes

### `BaseApiResponse` (from `DomainService.Shared.Models`)

```json
{
  "data": { },
  "message": "string",
  "statusCode": 200,
  "isSuccess": true
}
```

### `PaginatedResponse` (from `DomainService.Shared.Models`)

Standard pagination envelope used by `GetMonitorList` and `GetIncidentList`.

```json
{
  "items": [ ],
  "totalCount": 0,
  "pageNumber": 0,
  "pageSize": 10
}
```

### `MonitorDetailsResponse` (from `DomainService.Monitor.Models`)

Incident-duration aggregation for a single monitor, returned by `GetMonitorDetailsAsync`.

---

## Authorization

The original controllers decorate every action with `[Authorize]` (except `Ping`, which is public so external probes can hit it). The driver itself does not enforce auth — that's the consumer's controller's responsibility. Apply `[Authorize]` on the controller methods that wrap each driver call, exactly as the source controllers do.
