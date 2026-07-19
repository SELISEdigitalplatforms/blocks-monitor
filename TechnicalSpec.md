# Blocks Monitor — Technical Specification

> Scope: `blocks-monitor`, the uptime / availability monitoring, incident, and alerting service of the SELISE Blocks platform. This document describes the system as it exists in code, and — where authoritative product decisions differ from the current implementation — states the **decided target** and flags the gap. Decisions are cited by their ticket numbers (e.g. #144).
>
> **Canonical product name:** **Blocks Monitor** (short: **Monitor**). The name "Observability" is legacy/retired but still appears in code (`Alert.DomainService`, `IObservabilityDriverService`, `ObservabilityConstants`, the `SeliseBlocks.ObservabilityDriver` package, and the `blocks-observability` IAM-resource comment). The in-app navigation section is currently labelled **"Health"** and is targeted to be renamed **Monitor** (#144). **v1 scope = uptime monitoring only** (HTTP Checks + Heartbeats, incidents, alerting). Logs/tracing/metrics are owned by a separate telemetry/OS service, not Monitor (#144, #C1).

---

## 1. Technology Stack

**Backend (`server/`)**
- **.NET 10** (`mcr.microsoft.com/dotnet/sdk:10.0` build, `aspnet:10.0-alpine` runtime). ASP.NET Core Web API + a background worker host.
- **Blocks.Genesis** — the shared SELISE Blocks platform framework (`ApplicationConfigurations`, `BlocksContext`, `IMessageClient`, `IDbContextProvider`, `ICryptoService`, `ITenants`, `IBlocksSecret`, secrets/vault, tenancy, messaging bootstrap).
- **MongoDB** (official `MongoDB.Driver`) — primary data store; configuration and secrets are also loaded from Mongo (`AddMongoDbConfiguration`, `Secrets` collection, secret key `blocks-secret-monitor`).
- **FluentValidation** — request validation.
- **MailKit / MimeKit** and **System.Net.Mail** — SMTP email delivery (two selectable client paths).
- **Swagger/OpenAPI** — API docs (title "Blocks Monitor").

**Frontend (`client/`)**
- **React 18 + TypeScript + Vite 6** SPA, served in production from the API's `wwwroot`.
- **`@seliseblocks/blocks-kit`** — shared console shell: layouts (`ConsoleLayout`, `DashboardRoute`), auth guards (`ProtectedGuard`, `PublicGuard`, `AuthResolver`), login/callback/console/profile pages, project switcher, menu types.
- **TanStack Query** (server state) and **TanStack Table** (data grids), **Recharts** (charts), **Radix UI** + **tailwindcss** + **class-variance-authority** (UI), **react-hook-form** + **zod** (forms), **zustand** (local state), **nuqs** (URL query state), **@microsoft/signalr** (notifications transport), **date-fns**, **lucide-react**.

**Infrastructure**
- Two deployable units, each with its own Dockerfile: **`blocks-monitor-api`** (`Dockerfile`) and **`blocks-monitor-worker`** (`Dockerfile.worker`).
- **Kubernetes/AKS** deploy via GitHub Actions (`.github/workflows/ci-dev.yml`, `ci-stg.yml`, `ci_prod.yml`) with GitOps image tagging; optional SonarQube/SCA stages.
- Secrets via vault: **Azure Key Vault** in deployed environments, **on-prem** in Development (`ResolveVaultType`).

**Key libraries recap:** Blocks.Genesis, MongoDB.Driver, FluentValidation, MailKit/MimeKit (server); blocks-kit, TanStack Query/Table, Recharts, Radix, zod/react-hook-form, SignalR (client).

---

## 2. Solution / Module Structure

The `server/` solution centres on one domain library consumed by two hosts, plus an embeddable driver and a test project. (Several sibling `*.DomainService` / `*.Driver` folders exist as scaffolding from the shared Blocks template but are not wired into Monitor's two hosts — the only registered domain library is `Alert.DomainService`.)

| Project | Responsibility |
| --- | --- |
| **`Api`** | ASP.NET Core host. `MonitorController` + `HealthController`, `Program.cs` (config/secrets/CORS/auth/static SPA), `GlobalApiRoutePrefixConvention` (prepends `api/`), serves the React build from `wwwroot`, injects frontend runtime settings by token replacement. |
| **`Worker`** | Background host. Runs the scheduling/checking loops: `MonitorSchedulerBackgroundWorker` (outbound HTTP checks), `PeriodicPingBackgroundService` (built-in keep-alive pinger), and `MonitorConfigurationUpdateConsumer` (config-change queue consumer). |
| **`Alert.DomainService`** | The core domain library (namespace `DomainService.*`). Sub-modules: **`Monitor/`** (entities, config CRUD, scheduling/ping, incidents), **`Health/`** (heartbeat config, in-memory scheduler, heartbeat incidents), **`Alert/`** (email + in-app notification delivery, mail templates/config), **`Shared/`** (HTTP helper, base response/pagination models, constants), **`Validators/`**. `ServiceRegistry.AddApplicationServices` registers everything (all singletons + the `HealthCheckBackgroundWorker` hosted service). |
| **`Observability.Driver`** | The `SeliseBlocks.ObservabilityDriver` NuGet package. Exposes the full Monitor + Health API surface as one injectable `IObservabilityDriverService` so other Blocks services can host these endpoints locally. |
| **`XUnitTest`** | xUnit test project mirroring the domain module layout (Monitor / Health / Alert / Api / Worker / Shared / Validators). |

**Client (`client/app/`)** — `routes/` (single route tree), `pages/` (`health/`, `monitor/details`, `incidents/`), `layouts/health-layout/`, `components/module/` (`monitor/` form+details+modal, `alert/` the monitor-list module, `incident/`), `services/` (`alerts.service`, `github-info.service`, `providers.service`), `constants/` (`endpoint`, `alert`, `health`, `navigation-menus`).

---

## 3. API Surface

Two controllers, both `[Route("[controller]/[action]")]` with a global `api/` prefix, so effective routes are `/api/Monitor/{Action}` and `/api/Health/{Action}`. All actions are `[Authorize]` **except** the public heartbeat receiver. Responses use the domain envelope types (see §4).

### MonitorController — `/api/Monitor/*` (HTTP Checks, incidents, ping logs)

| Action | Verb | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| `GetMonitorList` | GET | Authorize | query: `projectKey`, `monitorSourcetype?`, `pageNumber=0`, `pageSize=10`, `sortProperty?`, `sortIsDescending=false` | `PaginatedResponse` |
| `GetMonitorListByRepoId` | GET | Authorize | query: `projectKey`, `repoId` | `BaseApiResponse` (list + 24h downtime) |
| `GetMonitorById` | GET | Authorize | query: `monitorId` | `BaseApiResponse` |
| `SaveMonitor` | POST | Authorize | body: `SaveMonitorConfigurationRequest` | `BaseApiResponse` |
| `UpdateMonitor` | POST | Authorize | body: `UpdateMonitorConfigurationRequest` | `BaseApiResponse` |
| `DeleteMonitor` | DELETE | Authorize | query: `itemId` | `BaseApiResponse` |
| `GetIncidentList` | GET | Authorize | query: `monitorId`, `pageNumber`, `pageSize`, `sortProperty?`, `sortIsDescending=true` | `PaginatedResponse` |
| `GetMonitorDetails` | GET | Authorize | query: `monitorId` | `MonitorDetailsResponse` (7/30/365d downtime + counts + recent incidents) |
| `GetMonitorResponseTime` | GET | Authorize | query: `monitorId`, `startDate?`, `endDate?` | `BaseApiResponse` (ping-log latency) |
| `GetMonitorDownTime` | GET | Authorize | query: `monitorId`, `startDate?`, `endDate?` | `BaseApiResponse` (incident/downtime intervals) |
| `IsExternalServiceConfigured` | GET | Authorize | query: `externalServiceId` | `BaseApiResponse` (config or null) |

### HealthController — `/api/Health/*` (Heartbeats + the public ping receiver)

| Action | Verb | Auth | Request | Response |
| --- | --- | --- | --- | --- |
| `SaveHealth` | POST | Authorize | body: `SaveHealthConfigurationRequest` | `BaseApiResponse` |
| `UpdateHealth` | POST | Authorize | body: `UpdateHealthConfigurationRequest` | `BaseApiResponse` |
| `Ping` | GET | **Public** (`/api/Health/Ping/{itemId}`) | route: `itemId` | `{ message }` |
| `DeleteHealth` | DELETE | Authorize | query: `itemId` | `BaseApiResponse` (delegates to monitor delete) |

**Decided conventions (targets where current code differs):**
- **Heartbeat `Ping` is intentionally public** — pings come from both Background Services and API services, so the generated URL is open by design (#141, #B4). Target v1 also ships copyable setup snippets (cURL / cron) and inline docs next to the generated URL (#141); those helper snippets are not yet present in the client.
- **Authorization resource** is currently hard-coded to `"blocks-os"` (`Program.cs`), with an in-code note to move to a `blocks-observability` resource once IAM defines it. Decided target: Monitor gets its **own roles** — Viewer (read), Editor (create/edit/pause), Admin (delete + manage recipients) — while blocks-os super-permissions still apply (#150). Not yet implemented.
- **Terminology target:** surface the two check types as **"HTTP Check"** (we ping you = `OutboundPing` / `SaveMonitor`) and **"Heartbeat"** (you ping us = `InboundPing` / `SaveHealth`) (#144). Current client labels are "Request" / "Callback".
- **Return-type consistency:** the surface mixes `BaseApiResponse`, `PaginatedResponse`, and `MonitorDetailsResponse`; the envelope carries both `IsSuccess`/`Message` and (sometimes) an HTTP `StatusCode`, and some not-found/validation errors are returned with `IsSuccess=false` under HTTP 200. **Open / undecided:** a single canonical envelope + correct HTTP status mapping is not yet decided.

---

## 4. Data Model

Storage is MongoDB; the two check types share one configuration collection distinguished by `MonitorConfigurationType`.

**`MonitorConfiguration`** (collection `MonitorConfigurations`) — one configured check, for both HTTP Checks and Heartbeats.
- Identity/tenant: `ItemId` (GUID), `TenantId` (= `projectKey`), `CreatedBy` / `LastUpdatedBy`.
- Target: `Name`, `Url` (for Heartbeats the URL is a generated `{AlertServiceUrl}/{guid}` receiver), `RepoId`/`RepoName` (tagged deployed service), `ExternalServiceId`/`ExternalServiceName` (tagged "my service").
- Type/category: `MonitorConfigurationType` (`OutboundPing` | `InboundPing`), `MonitorSourceType` (`Infrastructure`, `DeployedServices`, `BlocksServices`, `ExternalServices`, `OtherServices`; with a legacy `MonitorSourcetypes` fallback field and an `EffectiveMonitorSourceType` resolver defaulting to `DeployedServices`).
- Scheduling: `IntervalInSeconds` (default 30), `GracePeriodInSeconds` (default 30; used by Heartbeats), `TimeoutInSeconds` (default 60, **stored but not applied** to the HTTP client).
- State: `IsActive` (paused when false), `CurrentStatus` (up/down), `LastCheckedAt`, `LastIncidentAt`.
- Check options **captured but not yet used by the pass/fail logic:** `MonitorType` (HTTP/PING/TCP/DNS/KEYWORD — only HTTP runs), `ProtocolType`, `AuthorizationType`, `ExpectedContent`, `SuccessHttpResponseCodes`, `Regions`. Used: `HttpMethodType` (HEAD/GET/POST), `CustomHttpHeaders`, `CustomPayload`.
- Alerting: `Emails` (email recipient list). `IncidentSummaries` is a computed 24h rollup attached on list reads.

**`MonitorIncident`** (collection `MonitorIncidents`) — a down period for a monitor.
- `MonitorId`, `MonitorName`, `MonitorUrl`, `ProjectKey`, `MonitorConfigurationType`, `MonitorSourceType`.
- `StartTime`, `EndTime?`, `IsResolved`, `LastStatusCode`, `FailureReason`, `ResponseBody`; computed `DowntimeDurationSeconds` (`EndTime − StartTime` once resolved). At most one unresolved incident per monitor at a time.

**`MonitorPingLog`** — one executed HTTP-check attempt: `MonitorId`, `Url`, `StatusCode`, `ResponseMessage`, `ResponseBody`, `IsSuccess`, `ResponseTimeMs`, `HttpMethodType`, `Timestamp`. Records per-check latency (raw material for a future latency chart; #140).

**Alert config:** `AlertMailTemplate` (subject/body with `{{Variable}}` placeholders, `MailConfigurationId`) and `MailServerConfiguration` (SMTP host/port/SSL/credentials, MailKit-vs-System.Net selector). Templates `AlertIncident` and `AlertResolved` are looked up by name.

**Relationships & per-tenant isolation**
- `MonitorConfiguration (1) → (many) MonitorIncident` and `→ (many) MonitorPingLog`, joined by `MonitorId`.
- A monitor may reference a deployed repo (`RepoId`) or an external service (`ExternalServiceId`); Monitor **references** these, it does not own them.
- **Tenancy:** every configuration and incident carries the tenant key (`TenantId`/`ProjectKey` = the Blocks `projectKey`); reads/writes are scoped by it. Requests reach the right tenant via the `X-Blocks-Key` tenant key and Blocks.Genesis tenancy; in-app notification signing uses the root tenant id + salt.

**Decided data-behaviour targets:**
- **Uptime %** = uptime ÷ window-length-in-seconds over the 7/30/365-day windows (#126); paused time is **excluded** (measured over checked time only), and "time since last incident" is **frozen while paused** (#143). Current aggregation computes downtime over fixed calendar windows and does not yet exclude paused time.
- **Deleting a monitor permanently destroys its incident history, with no undo** — accepted (#125).

---

## 5. Authentication & Authorization

- **Identity:** all management endpoints require `[Authorize]`; authentication is via **blocks-iam** (OIDC). The client obtains tokens through blocks-kit login/callback (IAM base URL, OIDC client id, SSO/captcha keys injected at runtime into the SPA by `ApplyFrontendRuntimeSettings`). The only unauthenticated endpoint is the heartbeat `Ping` receiver.
- **Tenancy:** multi-tenant via the **`X-Blocks-Key`** tenant key; server-side tenancy is established by Blocks.Genesis and every record is scoped by `TenantId`/`projectKey`. `BlocksContext.GetContext()?.UserId` supplies the acting user (falls back to `"system"` in background paths).
- **Authorization scope:** `ApplicationConfigurations.ConfigureApi(..., serviceAccessResourceName: "blocks-os")` — access is currently governed under the **blocks-os** IAM resource.
- **Decided target (#150):** Monitor gains its **own roles** — **Viewer** (read), **Editor** (create/edit/pause), **Admin** (delete + manage recipients) — composed on top of blocks-os super-permissions. The scope grammar / resource name (`blocks-observability` vs `blocks-monitor`) and how the three roles compose with blocks-os are **not yet finalised**; the current build enforces only coarse `[Authorize]` + blocks-os.
- **Edit protection:** `Infrastructure` and `BlocksServices` monitors are read-only to tenants — update/delete are rejected for those source types.

---

## 6. Integrations & Dependencies

**Other Blocks services**
- **blocks-iam** — authentication/authorization (OIDC, the `blocks-os` access resource today, own roles as target).
- **blocks-os (console)** — Monitor runs inside the shared console shell (`@seliseblocks/blocks-kit`); project/environment context and the project switcher come from there.
- **blocks-release (deployments/GitHub)** — monitors can be tagged to a deployed repo (`RepoId`/`RepoName`); the create form loads the project's deployed repos. Decided: deployment→monitor is **opt-in, off by default** (#148); users may monitor **any** third-party service, not only platform-deployed ones (#148). Currently blocks-release is the **only** consumer embedding Monitor (a few APIs, display-only) and embedded monitoring must be attributed **"powered by Blocks Monitor"** (#149).
- **Notification service (Blocks Utilities)** — in-app notifications are POSTed to `NotificationServiceUrl` with a signed `Secret` header (root tenant id hashed with tenant salt) and `configurationName = "GeneralNotification"` over SignalR.
- **Mail server** — templated incident/resolved emails via SMTP.
- **Separate telemetry / OS service** — logs, tracing, and metrics live outside Monitor (#144, #C1); Monitor should cross-link to it, not implement it.

**Embeddable driver:** `SeliseBlocks.ObservabilityDriver` (`RegisterBlocksObservabilityServices()` → inject `IObservabilityDriverService`) mirrors all 15 Monitor+Health operations so services such as blocks-logic can host them locally. The driver does not enforce auth; the hosting controller must apply `[Authorize]` (and keep `Ping` public), matching the source controllers.

**External/NuGet & npm that matter:** MongoDB.Driver, FluentValidation, MailKit/MimeKit, Blocks.Genesis, SeliseBlocks.ConfigurationDriver (server); `@seliseblocks/blocks-kit`, `@tanstack/react-query`, `@tanstack/react-table`, `recharts`, `@microsoft/signalr`, `react-hook-form`+`zod` (client).

---

## 7. Messaging / Eventing

- **Broker:** provider auto-detected from the connection string — **RabbitMQ** for `amqp(s)://`, otherwise **Azure Service Bus** (default). Configured via `ObservabilityConstants.GetApiMessageConfiguration` / `GetWorkerMessageConfiguration`.
- **Queue:** a single config-propagation queue, **`blocks_alert_monitor_config_update_listener`** (`ObservabilityConstants.MonitorConfigurationUpdateQueue`), carrying a `MonitorConfigurationUpdateQueue { MonitorId }` payload.
- **Producer:** `MonitorConfigurationService` enqueues on every `SaveMonitor` / `UpdateMonitor` so the scheduler reloads promptly (best-effort; enqueue failures are logged, not fatal).
- **Consumer:** `MonitorConfigurationUpdateConsumer` (Worker) handles those messages.
- **Scheduling loops (not queue-based):**
  - **HTTP Checks** — `MonitorSchedulerBackgroundWorker` → `MonitorSchedulerService`: loads active monitors into an in-memory priority queue, runs a pool of ~10 worker loops that ping due monitors (`MonitorPingService.MonitorPingAsync`) and re-enqueue by interval, plus a DB re-poll every 600s.
  - **Heartbeats** — `HealthCheckBackgroundWorker` → `HealthCheckService`: an in-memory queue keyed by `Interval + GracePeriod`; a due task (no ping received in time) raises a "No ping received" incident; an inbound `Ping` requeues the timer and resolves any open incident.
  - **Keep-alive** — `PeriodicPingBackgroundService`: GETs one configured URL on a timer (see §8). Decided: this is a **product feature** (built-in keep-alive check) with a **configurable** URL, surfaced to users (#147).

---

## 8. Configuration & Environments

- **Secrets/config source:** MongoDB `Secrets` collection (key `blocks-secret-monitor`), unlocked via vault — **Azure** in deployed envs, **OnPrem** in Development. Layered `appsettings.{Environment}.json` (`Development`, `dev`, `stg`, `prod`) mostly carry logging + secret-manager pointers.
- **Notable runtime settings:** `AlertServiceUrl` (base for generated Heartbeat receiver URLs), `NotificationServiceUrl`, `RootTenantId`, mail-server config (in Mongo), and `PeriodicPingConfiguration` (`Enabled`, `PingUrl`, `PingIntervalInSeconds`).
- **Frontend runtime injection:** `ApplyFrontendRuntimeSettings` replaces `__BLOCKS_*__` tokens in the built SPA assets from the `FrontendRuntime` config section (per-service base/callback URLs and client ids, IAM base URL, captcha site key, base domain), overridable by `FrontendRuntime__BLOCKS_*` env vars at deploy time.
- **Local dev:** API on port 4000, client dev server on 4001 (`vite --port 4001`); dev CORS allows `localhost`, `127.0.0.1`, and `dev-monitor.blocksdevelopers.com`; a dev middleware normalizes Origin/Referer for tenant validation.
- **Environments:** dev / stg / prod via matching CI workflows and AKS clusters; images tagged by commit (dev) with GitOps promotion.

---

## 9. Testing & Quality

- **Backend:** **xUnit** with **Moq** and **FluentAssertions** (coverage via **coverlet**, JUnit logger). The `XUnitTest` project mirrors the domain modules (Monitor, Health, Alert, Api controllers, Worker, Shared, Validators). A recent Cobertura run reports roughly **~81% line coverage on the core domain package** (`Alert.DomainService`), with thinner coverage on host/wiring assemblies.
- **Frontend:** **Vitest** + Testing Library (`test`, `test:coverage`); tests under `client/app/__tests__/` mirror `pages/`, `services/`, `components/`, `hooks/`, `lib/`, `utils/`.
- **CI:** GitHub Actions per environment. Test/SonarQube/SCA stages are **toggled off by default in dev** (`RUN_TESTS: "false"`, `RUN_SONARQUBE: "false"`) for build speed; the SonarQube path is wired for dotnet-coverage when enabled.
- **Coverage gate — Open / undecided:** no monitor-specific coverage-gate threshold is recorded in the authoritative decisions. The broader platform effort targets ~85% across services, but whether CI should **fail** below a fixed line-rate (and at what number) is not yet decided for this repo.

---

## 10. Known Technical Debt & Decisions

| Item (current state) | Decided resolution / target | Ref |
| --- | --- | --- |
| Nav section labelled **"Health"**; three overlapping names (Blocks Monitor / Health / Observability). | Product name is **Blocks Monitor / Monitor**; rename the nav section to **Monitor**; retire "Observability". | #144 |
| Two names per check type (Request/OutboundPing, Callback/InboundPing/Health). | Standardize on **HTTP Check** ("we ping you") and **Heartbeat** ("you ping us") in the UI. | #144 |
| Detail-page section titled **"Response time"** actually renders an up/down timeline. | Rename to **Availability Timeline** (or Status Timeline); keep recording per-check response times now; a real latency chart is **roadmap, not v1**. | #140 |
| Marketing/README copy advertises logs, tracing, metrics, AI diagnostics — none implemented; `AlertTree` carries unused telemetry fields. | **v1 = uptime only**; logs/tracing/metrics belong to a separate telemetry/OS service; fix marketing copy and add cross-nav links. | #144, #C1 |
| Access governed only by the **blocks-os** IAM resource; coarse `[Authorize]`. | Add Monitor's **own roles** — Viewer / Editor / Admin — over blocks-os super-perms (resource name + composition still to finalise). | #150 |
| Heartbeat `Ping` endpoint is unauthenticated. | **Intentional** — pings come from Background + API services; keep open, add cURL/cron setup snippets + docs beside the generated URL. | #141 |
| **10-monitors-per-project** cap (validator allows `count <= 10`, an off-by-one that permits an 11th). | Cap is an **abuse safeguard, not a pricing tier**; keep it (tighten the off-by-one). | #128 |
| Email recipients capped at **5** in the UI; in-app notifications go to all project members + creator/last-editor (not user-targetable). | Two-channel split is intentional; raise the email cap to a higher fixed guardrail (**~10–20**); in-app stays broad/team by default. 5-recipient review still open. | #142 |
| Failure decision: an incident opens when `StatusCode < 200 || StatusCode >= 400` (so **4xx now counts as down**) or on exception; `SuccessHttpResponseCodes` / `ExpectedContent` / `TimeoutInSeconds` / `Regions` are stored but **not evaluated**. | 4xx-as-down aligns with the intended behaviour (earlier builds ignored 4xx). Which stored options should influence pass/fail (success-code list, expected content, timeout, regions) is **Open / undecided**. | #B1, #B2 |
| Paused monitors: checks stop entirely. | Paused monitors **stay in the main list with a visible paused indicator**; **uptime excludes paused time**; "time since last incident" freezes while paused. | #143 |
| Deleting a monitor **permanently destroys** its incident history, no undo. | Accepted as designed. | #125 |
| Deployment→monitor coupling. | **Opt-in, off by default**; users can monitor any third-party service (no platform boundary). | #148 |
| Embedding by other services (only blocks-release today, display-only). | Embedded monitoring must be **attributed "powered by Blocks Monitor"**. | #149 |
| **"Blocks services"** read-only tab (source type `BlocksServices`, seeded outside this repo). | Purpose = **incident transparency** for signed-in tenants + subscribe-to-platform-incident; **no public status page**. | #146 |
| `PeriodicPingBackgroundService` pings one fixed configured URL. | Treat as a **product feature** (built-in keep-alive check) with a **configurable** URL, surfaced to users. | #147 |
| Ongoing incident: subsequent failing checks update an in-memory object but only open/resolve are persisted. | Minor persistence gap, not a product decision; no target recorded. | — |
| Mixed response envelopes and not-found/validation errors returned under HTTP 200. | Canonical envelope + correct HTTP status mapping **Open / undecided**. | — |

---

## 11. Non-Functional Requirements

**Security**
- All management APIs authenticated via blocks-iam OIDC; the single public surface is the heartbeat `Ping` receiver (open by design, #141). Because the URL is unguessable per-monitor and carries no side effects beyond marking a check alive, it is treated as low-risk; any hardening beyond obscurity is Open.
- Multi-tenant secrets in vault (Azure / on-prem); notification calls are signed with a per-root-tenant hashed secret.
- Tenant-editable operations are blocked for `Infrastructure` / `BlocksServices` monitors.
- **Open / undecided:** per-monitor request timeout is not enforced (`TimeoutInSeconds` unused), so a slow endpoint can occupy a scheduler slot longer than configured; outbound checks send stored custom headers/payloads without an auth-type abstraction (`AuthorizationType` unused).

**Multi-tenancy**
- Strict per-`projectKey` scoping on all configurations, incidents, and ping logs; tenant established via `X-Blocks-Key` + Blocks.Genesis. In-app notifications are project-team-broad by default (no cross-tenant leakage), email recipients are explicit per monitor.

**Performance & scale**
- Checking is horizontally offloaded to the Worker via in-memory priority queues with a ~10-worker pool per scheduler and a 600s DB re-poll; config changes propagate near-real-time through the message queue rather than waiting for the poll.
- The **10-monitors-per-project** cap bounds per-tenant load (abuse safeguard, #128).
- Ping logs accumulate per check and per interval; **Open / undecided:** retention/TTL for ping logs and resolved incidents is not defined in code.
- Default check interval 30s; heartbeat due-time = interval + grace period.

---

## Open Questions (not yet resolved by authoritative decisions)

- **B2:** which stored check options (`SuccessHttpResponseCodes`, `ExpectedContent`, `TimeoutInSeconds`, `Regions`) should influence pass/fail, and how each behaves.
- **B3:** which non-HTTP check types (PING/TCP/DNS/KEYWORD) and SSL/domain-expiry reminders are real v1 requirements vs roadmap (only HTTP runs today).
- **D1:** ownership boundary for alert delivery/templates between Monitor and the central communication service.
- **D5 / naming:** final IAM resource name (`blocks-observability` vs `blocks-monitor`) and the exact scope grammar for the new roles.
- **Coverage gate:** whether CI should hard-fail below a fixed coverage threshold for this repo, and at what number.
- **Retention:** TTL/archival policy for ping logs and resolved incidents.
