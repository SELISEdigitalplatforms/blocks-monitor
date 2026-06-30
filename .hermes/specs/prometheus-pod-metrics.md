# Prometheus Pod Metrics Monitoring

> **Repo:** blocks-monitor (C# .NET 10 + React/Vite/TypeScript)
> **Board:** [#455](https://github.com/orgs/SELISEdigitalplatforms/projects/455)

## Goal

Add Prometheus metrics scraping to blocks-monitor, enabling CPU and RAM monitoring for Kubernetes pods deployed by blocks-release. Users configure a Prometheus endpoint + metric queries, and blocks-monitor periodically scrapes and stores pod-level metrics for charting and alerting.

## Current State

blocks-monitor currently supports HTTP-based uptime monitoring only:
- **MonitorTypes enum:** `HTTP, PING, TCP, DNS, KEYWORD` — no metrics/prometheus type
- **Scheduler loop:** `MonitorSchedulerService` → `MonitorQueueManager` (10 workers) → `MonitorPingService.MonitorPingAsync()` → makes HTTP request → saves `MonitorPingLog` (response time + status code) → triggers incident if failure
- **Data storage:** MongoDB via `MonitorPingRepoService` (`MonitorPingLog` collection) and `MonitorIncidentRepoService`
- **Frontend:** Health list with status bars, monitor details with uptime % + response time chart (last 7d/30d/90d), incident list
- **Source types:** Infrastructure, DeployedServices, BlocksServices, ExternalServices, OtherServices
- **Health domain:** Separate `HealthCheckService` / `HealthCheckBackgroundWorker` exists for inbound health checks

## Design Decisions

### 1. New MonitorType: `PROMETHEUS`
Extend `MonitorTypes` enum with a `PROMETHEUS` value. This is the cleanest path — existing scheduler infrastructure (polling loop, queue, worker pool) is reused without modification. The scheduler dispatches to `MonitorPingService`, which branches on monitor type and calls `PrometheusMetricsService` for `PROMETHEUS`-type monitors.

### 2. Prometheus Config on MonitorConfiguration
Add Prometheus-specific fields to the `MonitorConfiguration` entity rather than a separate table:
- `PrometheusBaseUrl` — e.g. `https://prometheus.blocksdevelopers.com`
- `PrometheusQueries` — list of `{ name, query, unit }` (e.g. `{ "CPU Usage", "rate(container_cpu_usage_seconds_total{namespace=\"blocks\"}[5m])", "cores" }`)
- `PrometheusNamespace` — Kubernetes namespace filter
- `PrometheusLabelSelector` — additional label filters (`app=blocks-os,component=api`)

### 3. Metric Storage: New Collection
Create `MonitorMetricLog` entity (separate from `MonitorPingLog`) with:
- `monitorId`, `timestamp`, `metricName`, `value`, `unit`, `labels` (pod name, container, namespace)

This keeps HTTP ping logs and Prometheus metric logs decoupled. The `MonitorPingLog` structure (response time + status code) doesn't map cleanly to metric scraping.

### 4. Frontend: Reuse Monitor Details Page
Extend `monitor-details.tsx` to detect `monitorType === PROMETHEUS` and render metric charts instead of HTTP response time charts. The existing `ResponseTimeChart` component pattern (Recharts) is adapted into a generic `MetricsTimeChart` that supports multiple metric series.

### 5. Incident Generation
Prometheus-based monitors should generate incidents based on threshold breaches rather than HTTP failures:
- CPU threshold: > 80% for 5 consecutive samples
- RAM threshold: > 85% for 5 consecutive samples
- User-configurable thresholds per monitor (default to sensible values)

## Architecture

```
Frontend (React)
  └─ monitor-details.tsx
       ├─ [monitorType=HTTP]  → ResponseTimeChart
       └─ [monitorType=PROMETHEUS] → MetricsTimeChart (CPU + RAM lines)
            └─ API: /Monitor/GetMonitorMetrics?monitorId=&start=&end=

Backend (C#)
  └─ MonitorController
       └─ GetMonitorMetrics() [NEW]
  └─ MonitorSchedulerService (unchanged)
       └─ MonitorPingService.MonitorPingAsync()
            └─ [monitorType=PROMETHEUS] → PrometheusMetricsService.ScrapeAsync()
                 ├─ GET /api/v1/query_range?query=rate(container_cpu_usage_seconds_total{...}[5m])&start=&end=&step=
                 ├─ Parse Prometheus JSON response
                 ├─ Save MonitorMetricLog[] to MongoDB
                 └─ Check thresholds → create MonitorIncident if breached

MongoDB
  ├─ MonitorConfiguration (existing, +Prometheus fields)
  ├─ MonitorPingLog (existing, HTTP only)
  ├─ MonitorMetricLog [NEW]
  └─ MonitorIncident (existing, reused)
```

## Implementation Tasks

### Task 1: Extend MonitorTypes enum + MonitorConfiguration entity
**Files:**
- Modify: `server/Alert.DomainService/Monitor/Entity/MonitorConfiguration.cs`
- Modify: `server/Alert.DomainService/Monitor/Models/SaveMonitorConfigurationRequest.cs`

Add `PROMETHEUS` to `MonitorTypes` enum. Add Prometheus-specific fields to `MonitorConfiguration`:
```csharp
public enum MonitorTypes
{
    HTTP,
    PING,
    TCP,
    DNS,
    KEYWORD,
    PROMETHEUS  // NEW
}

// On MonitorConfiguration:
public string? PrometheusBaseUrl { get; set; }
public string? PrometheusQueriesJson { get; set; }        // JSON array of {name, query, unit}
public string? PrometheusNamespace { get; set; }
public string? PrometheusLabelSelector { get; set; }
public double? CpuThresholdPercent { get; set; }
public double? RamThresholdPercent { get; set; }
```

Add corresponding fields to `SaveMonitorConfigurationRequest` and `UpdateMonitorConfigurationRequest`.

### Task 2: Create MonitorMetricLog entity
**Files:**
- Create: `server/Alert.DomainService/Monitor/Entity/MonitorMetricLog.cs`
- Create: `server/Alert.DomainService/Monitor/MonitorSchedulingService/IMonitorMetricRepoService.cs`
- Create: `server/Alert.DomainService/Monitor/MonitorSchedulingService/MonitorMetricRepoService.cs`

```csharp
public class MonitorMetricLog
{
    public string ItemId { get; set; }
    public string MonitorId { get; set; }
    public DateTime Timestamp { get; set; }
    public string MetricName { get; set; }       // e.g. "cpu_usage", "ram_usage"
    public double Value { get; set; }
    public string Unit { get; set; }             // "cores", "bytes", "percent"
    public Dictionary<string, string> Labels { get; set; }  // pod, container, namespace
}
```
Repository with `SaveMetricsAsync(List<MonitorMetricLog>)` and `GetMetricsByDateRangeAsync(monitorId, start, end)`.

### Task 3: Create PrometheusMetricsService
**Files:**
- Create: `server/Alert.DomainService/Monitor/MonitorSchedulingService/IPrometheusMetricsService.cs`
- Create: `server/Alert.DomainService/Monitor/MonitorSchedulingService/PrometheusMetricsService.cs`

```csharp
public class PrometheusMetricsService : IPrometheusMetricsService
{
    // ScrapeAsync(MonitorConfiguration config)
    //   1. Build Prometheus query_range URL with start/end/step from config
    //   2. Call HttpClient → GET {prometheusBaseUrl}/api/v1/query_range
    //   3. Parse JSON: data.result[] → { metric: {pod, container, namespace}, values: [[ts, val], ...] }
    //   4. Convert to List<MonitorMetricLog>
    //   5. Save via MonitorMetricRepoService
    //   6. Check thresholds → return threshold breaches
}
```

Prometheus API format: `GET /api/v1/query_range?query=<encoded>&start=<unix>&end=<unix>&step=60s`
Response: `{"status":"success","data":{"resultType":"matrix","result":[{"metric":{"pod":"blocks-os-abc","namespace":"blocks"},"values":[[1700000000,"0.45"],[1700000060,"0.51"]]}]}}`

### Task 4: Integrate into MonitorPingService
**Files:**
- Modify: `server/Alert.DomainService/Monitor/MonitorSchedulingService/MonitorPingService.cs`

Add branch at top of `MonitorPingAsync()`:
```csharp
public async Task<MonitorPingLog> MonitorPingAsync(MonitorConfiguration config)
{
    if (config.MonitorType == MonitorTypes.PROMETHEUS)
    {
        await _prometheusMetricsService.ScrapeAsync(config);
        return new MonitorPingLog { MonitorId = config.ItemId, IsSuccess = true, Timestamp = DateTime.UtcNow };
    }
    // ... existing HTTP ping logic unchanged
}
```

### Task 5: Add threshold-based incident creation
**Files:**
- Modify: `server/Alert.DomainService/Monitor/MonitorSchedulingService/PrometheusMetricsService.cs`

After saving metrics, check whether any pod exceeded threshold for N consecutive samples:
- If yes → create incident via `IMonitorIncidentService` (reuse existing)
- If no and previously in incident → resolve incident

### Task 6: Add GetMonitorMetrics API endpoint
**Files:**
- Modify: `server/Api/Controllers/MonitorController.cs`
- Create: `server/Alert.DomainService/Monitor/Models/MonitorMetricsResponse.cs`

```csharp
[Authorize]
[HttpGet]
public async Task<IActionResult> GetMonitorMetrics([FromQuery] string monitorId, string? startDate, string? endDate)
{
    var result = await _prometheusMetricsService.GetMetricsByDateRangeAsync(monitorId, startDate, endDate);
    return Ok(result);
}
```

Response shape:
```json
{
  "isSuccess": true,
  "data": {
    "metrics": [
      { "name": "cpu_usage", "unit": "cores", "series": [
          { "pod": "blocks-os-abc", "values": [{"timestamp": "...", "value": 0.45}, ...] }
      ]},
      { "name": "ram_usage", "unit": "bytes", "series": [...] }
    ]
  }
}
```

### Task 7: Frontend — Extend model types + API service
**Files:**
- Modify: `client/app/cross-modules/observability/models/alerts.model.ts`
- Modify: `client/app/cross-modules/observability/constants/endpoint.constant.ts`
- Modify: `client/app/cross-modules/observability/services/alerts.service.ts`

Add `GET_MONITOR_METRICS` endpoint, `IMetricsSeries`, `IGetMetricsResponse` types, and `getMonitorMetrics()` service function.

### Task 8: Frontend — Metrics chart component
**Files:**
- Create: `client/app/cross-modules/observability/components/monitor/details/metrics-chart.tsx`
- Modify: `client/app/cross-modules/observability/pages/monitor/monitor-details.tsx`

Recharts-based twin-axis chart:
- Left Y-axis: CPU (cores / percent)
- Right Y-axis: RAM (GB)
- X-axis: time (datetimes from metric timestamps)
- Color palette: CPU = blue (`#0066B2`), RAM = orange (`#F97316`)
- Time range selector: 1h / 6h / 24h / 7d (reuse existing pattern from response time chart)

Conditionally render `MetricsTimeChart` when `monitorType === 'PROMETHEUS'`.

### Task 9: Frontend — Monitor form extension
**Files:**
- Modify: `client/app/cross-modules/observability/components/monitor/form/monitor-form-fields.tsx`
- Modify: `client/app/cross-modules/observability/components/monitor/form/schema.ts`
- Modify: `client/app/cross-modules/observability/components/monitor/form/util.ts`

When monitor type is set to PROMETHEUS, show:
- Prometheus Base URL input
- Prometheus Namespace input
- Label selector input
- Pre-configured query fields (CPU + RAM with sensible defaults)
- Threshold sliders (CPU 50-100%, RAM 50-100%)

Hide HTTP-specific fields (HTTP method, custom headers, payload, success codes).

### Task 10: Register new services in DI
**Files:**
- Modify: `server/Alert.DomainService/ServiceRegistry.cs`

Register `IPrometheusMetricsService → PrometheusMetricsService` and `IMonitorMetricRepoService → MonitorMetricRepoService`.

### Task 11: Tests
**Files:**
- Create: `server/XUnitTest/Services/PrometheusMetricsServiceTests.cs`
- Create: `server/XUnitTest/Services/MonitorMetricRepoServiceTests.cs`

Cover: Prometheus response parsing, threshold breach detection, edge cases (empty response, malformed JSON, Prometheus 503, no pods matching labels).

## Edge Cases

| Case | Behavior |
|------|----------|
| Prometheus unreachable (timeout/503) | Log error, create incident after 3 consecutive failures |
| Prometheus returns empty results (no matching pods) | Log warning, no metrics saved, no incident |
| Partial data (some pods return, others don't) | Save available metrics, mark missing pods as `null` |
| Threshold breached but resolves next scrape | Don't create incident unless 5 consecutive samples breach |
| User changes Prometheus URL on existing monitor | Next scrape uses new URL, old metric data remains (immutable) |
| Very large time range query (30d) | Aggressively step up interval (5m → 30m for 7d+ ranges) |

## Verification

1. Create a PROMETHEUS monitor via API/form → verify it appears in monitor list with correct type
2. Wait for scheduler to scrape → verify `MonitorMetricLog` documents appear in MongoDB
3. Call `GetMonitorMetrics` API → verify structured response with CPU/RAM series
4. Load monitor details page → verify twin-axis chart renders with data points
5. Set a low CPU threshold (10%) → verify incident is created after 5 scrapes above threshold
6. Delete monitor → verify metric logs are cleaned up

## Open Questions

- Prometheus auth: Does the Prometheus instance require authentication? (Assume no for initial implementation — add bearer token support later if needed)
- Metric retention: How long to keep metric data in MongoDB? (Default: 90 days, configurable)
- Should this integrate with the existing Health domain or remain in Monitor? → Remain in Monitor; Health is for inbound heartbeat checks, not outbound metrics scraping
