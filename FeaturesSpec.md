# Blocks Monitor — Features Specification

> One-line note: derived from the Business/Product/Technical/Architecture specs + the code on `inception` + the authoritative product decisions. Status reflects the ACTUAL code as verified against the implementation (server/ + client/), cross-checked against open GitHub issues #151–#159.

## How to Read

Status legend: **✅ Shipped** (implemented, matches intended behaviour) · **🟡 Partial** (implemented but with a gap vs the decision/intent) · **🔴 Defect** (implemented but broken/incorrect) · **🗺️ Roadmap** (decided, not yet built) · **❓ Undecided** (no decision yet). Every status is grounded in code.

Product name per DECISIONS: **Blocks Monitor** (short **Monitor**). "Observability" is legacy/retired but still present in code (`Observability.Driver`, `IObservabilityDriverService`, `ObservabilityConstants`, the `SeliseBlocks.ObservabilityDriver` package). The in-app nav section is still labelled **"Health"**.

---

## 1. Feature Inventory

### Area A — Checks & Scheduling

### HTTP Check monitoring ("we ping you") — ✅ Shipped
- **What it does:** Active outbound HTTP request (HEAD/GET/POST) to a URL on an interval; records status code + response time; opens/resolves incidents.
- **Current status:** Fully wired. `MonitorSchedulerBackgroundWorker` → `MonitorSchedulerService` loads active `OutboundPing` configs into an in-memory priority queue, a ~10-worker pool pings due monitors via `MonitorPingService.MonitorPingAsync` (`server/Alert.DomainService/Monitor/MonitorSchedulingService/MonitorPingService.cs`), and re-polls the DB every 600s. Method selection, `CustomPayload`, and `CustomHttpHeaders` are applied.
- **Limitations:** `TimeoutInSeconds` (default 60) is stored on the entity but never applied to the HttpClient, so a slow endpoint can hold a scheduler slot indefinitely (cross-cutting, non-func spec §11). `MonitorType` (HTTP/PING/…), `ProtocolType`, `AuthorizationType`, `ExpectedContent`, `SuccessHttpResponseCodes`, `Regions` are captured on the form/entity but never evaluated. `MonitorPingLog.ResponseBody` is never populated by `MonitorPingAsync` (only `ResponseMessage`), so incident `ResponseBody` is always null.
- **Suggested changes:** (P2) Apply `TimeoutInSeconds` to the outbound `HttpClient` per check (`Timeout` or a linked `CancellationTokenSource`). (P3) Populate `ResponseBody` on the ping log so incident bodies carry the failing payload. (P3) Either evaluate or hide the inert fields (see Success-code/expected-content feature).

### Heartbeat monitoring ("you ping us") — ✅ Shipped
- **What it does:** Issues a unique callback URL (`{AlertServiceUrl}/{guid}`); if no ping arrives within interval + grace, opens a "no ping received" incident; an inbound ping resolves it.
- **Current status:** Working. `HealthConfigurationService.SaveConfigurationAsync` generates the URL and stores an `InboundPing` config; `HealthCheckService` runs an in-memory queue keyed by `Interval + GracePeriod` with a ~10-worker pool + 600s DB poll; `HealthController.Ping` (public route `GET /api/Health/Ping/{itemId}`) requeues the timer and resolves any open incident.
- **Limitations:** The heartbeat scheduler reload is triggered synchronously in the API request path (`_healthCheckService.LoadMonitorsFromDatabaseAsync()` inside Save/Update) rather than via the config-update queue used by HTTP Checks — an inconsistency and a latency cost on save. `DeleteHealth` deletes via the monitor service, not the health service, so the in-memory heartbeat queue is not proactively cleared (see Delete feature, #153). Save does not enforce the 10-monitor cap that HTTP Checks enforce (validator is only on `SaveMonitorConfigurationRequest`).
- **Suggested changes:** (P2) Route heartbeat create/update through the same `MonitorConfigurationUpdateQueue` consumer path for consistency. (P2) Apply the per-project monitor cap to heartbeats too (currently uncapped).

### Heartbeat setup guidance (cURL / cron snippets + docs) — 🗺️ Roadmap
- **What it does (intended):** Show copyable cURL/cron snippets and inline docs next to the generated callback URL so users can wire an external caller.
- **Current status:** Not built. `monitor-form-fields.tsx` renders only Name + interval + grace for the "callback" type; there is no generated-URL display, no snippet, no docs. Decided v1 requirement (#141, DECISIONS B4).
- **Limitations:** Users must find the generated URL elsewhere (e.g. the detail page `MonitorCard`) and hand-write the caller with no guidance — high setup friction for the dead-man's-switch use case.
- **Suggested changes:** (P1) Add a post-create panel showing the callback URL with copy-to-clipboard cURL and cron examples plus a short "how heartbeats work" note (#141).

### Keep-alive check (built-in periodic ping) — 🟡 Partial
- **What it does:** A background service GETs one configured URL on a timer to keep an endpoint warm.
- **Current status:** Implemented as an internal, fixed-config background service: `PeriodicPingBackgroundService` reads `PeriodicPingConfiguration` (`Enabled`, `PingUrl`, `PingIntervalInSeconds`) from config and pings on a `PeriodicTimer`. It is NOT surfaced to users and the URL is not user-configurable at runtime (config is read once in the constructor; changing it needs a redeploy).
- **Limitations:** Decision (#147, DECISIONS) is that this is a *product feature* with a *user-configurable* URL surfaced in the UI — none of that exists. No API, no UI, no per-tenant scoping; it is a single global URL.
- **Suggested changes:** (P3) Expose the keep-alive URL + interval + enabled flag through an API and a settings surface, and reload on change (the service already has a `ResetTimer` hook to build on).

### Additional check types / multi-region / SSL & domain-expiry — 🗺️ Roadmap
- **What it does (intended):** PING/TCP/DNS/KEYWORD checks, multi-region execution, SSL-cert and domain-expiry reminders.
- **Current status:** Enum values (`MonitorTypes`, `Regions`) exist on the entity but only HTTP runs; no TCP/DNS/PING/keyword/region/SSL code path exists.
- **Limitations:** Purely inert placeholders; selecting a non-HTTP `MonitorType` would be accepted and stored but silently checked as HTTP.
- **Suggested changes:** (P3) Remove the inert enum options from the form until implemented, to avoid implying support (ties to naming/UX honesty).

### Area B — Incidents & Uptime

### Incident lifecycle — ✅ Shipped
- **What it does:** At most one open incident per monitor; opens on failure with start time, last status code, failure reason; resolves on recovery with end time + computed downtime.
- **Current status:** `MonitorIncidentService.HandleIncidentAsync` (`.../MonitorIncidentService/MonitorIncidentService.cs`) implements exactly this; `DowntimeDurationSeconds` is a computed property (`EndTime − StartTime`) on `MonitorIncident`.
- **Limitations:** For an *ongoing* incident, subsequent failing checks mutate the in-memory `activeIncident` object (lines 77–78) but never persist the updated `LastStatusCode`/`FailureReason` — so the DB keeps the first failure's values until resolution (TechnicalSpec §10 "minor persistence gap").
- **Suggested changes:** (P2) Persist ongoing-incident updates (`UpdateIncidentAsync`) when the failure reason/status code changes so the stored record reflects the latest failure.

### 4xx & 5xx count as down — ✅ Shipped
- **What it does:** A check fails when status `< 200 || >= 400`, or on exception (status set to -1).
- **Current status:** `bool isFailure = response.StatusCode < 200 || response.StatusCode >= 400;` — so 401/403/404 open incidents, matching the decision (#B1/#B2). Exceptions/timeouts set `StatusCode = -1`, which is `< 200`, so also counted as down.
- **Limitations:** No way to opt a specific monitor out (e.g. an endpoint that legitimately returns 401 to a HEAD probe) because `SuccessHttpResponseCodes`/`ExpectedContent` are not consulted.
- **Suggested changes:** (P3) Once decided (open question B2), honour `SuccessHttpResponseCodes` to override the default pass/fail band.

### Configurable success codes / expected content — 🗺️ Roadmap (❓ pass/fail semantics undecided)
- **What it does (intended):** Let a monitor define which codes / body content count as healthy.
- **Current status:** `SuccessHttpResponseCodes` + `ExpectedContent` are captured and stored (`MonitorConfigurationService.UpdateMonitorConfiguration`) but never read by the failure logic.
- **Limitations:** Stored-but-inert; gives a false impression of configurability.
- **Suggested changes:** (P3) Resolve open question B2, then implement evaluation or remove the fields.

### Incident history — ✅ Shipped
- **What it does:** Paginated, sortable per-monitor incident list (status, root cause, start/end, duration, status code for HTTP Checks).
- **Current status:** `MonitorController.GetIncidentList` → `GetIncidentsByMonitorIdAsync` returns a `PaginatedResponse`; client `incident-list.tsx` + `pages/incidents/index.tsx` render it with "Ongoing"/Unresolved handling.
- **Limitations:** No retention/TTL policy — incidents accumulate indefinitely (cross-cutting). Not-found monitor returns an empty page with HTTP 200 (envelope inconsistency).
- **Suggested changes:** (P3) Define a retention/archival policy for resolved incidents.

### Per-check response time recorded — ✅ Shipped
- **What it does:** Each HTTP ping log stores `ResponseTimeMs`.
- **Current status:** `MonitorPingAsync` times each request with a `Stopwatch` and saves it to `MonitorPingLog`.
- **Limitations:** Recorded but there is no latency *chart* (the detail "Status Overview" chart renders up/down, not latency). Ping logs have no TTL.
- **Suggested changes:** (P3) Build the latency chart (roadmap #140) from existing data; add ping-log retention.

### Uptime % over 7/30/365 days — 🟡 Partial
- **What it does:** Detail cards show uptime %, incident count, and total downtime for 7/30/365-day windows.
- **Current status:** `MonitorController.GetMonitorDetails` → `GetIncidentsDurationByDateRangeAsync` aggregates downtime per fixed calendar window; client `details.tsx` computes `uptime% = (windowMs − downtimeMs) / windowMs`. This matches decision B8/#126's formula shape.
- **Limitations:** Paused time is NOT excluded — decision #143 requires uptime over *checked* time only. A monitor paused for days still burns its uptime %. Windows are fixed calendar spans, so a monitor created 2 days ago is scored against a full 365-day denominator and shows ~100% regardless of actual coverage.
- **Suggested changes:** (P2) Subtract paused intervals (and pre-creation time) from the window denominator so uptime reflects checked time only (#143). Requires tracking pause/resume timestamps, which are not currently stored.

### Availability Timeline (detail chart) — 🟡 Partial
- **What it does:** Renders up/down status history over a selectable sub-day range (1h–24h).
- **Current status:** Implemented in `response-time.tsx` as a step area chart of status over time. Content is correct (up/down timeline), but the section is titled **"Status Overview"** and the file/component is named `ResponseTime` — the decided canonical name is **"Availability Timeline"** (#140, DECISIONS A5).
- **Limitations:** Wrong title (misleads users into expecting latency). Its inline uptime metric is computed over the *selected 1–24h range*, separate from the 7/30/365 cards, so two different uptime numbers appear on one page. The `request ? "Request timeout" : "Grace Period"` label surfaces the unused timeout value.
- **Suggested changes:** (P1, low effort) Rename the section title to "Availability Timeline" and rename the component/file away from `ResponseTime` (#140). (P3) Reconcile the two uptime computations.

### Area C — Alerting

### Email alerts — 🟡 Partial (🔴 subject bug on one path)
- **What it does:** Templated emails on incident open (`AlertIncident`) and resolve (`AlertResolved`) to the monitor's recipient list, via MailKit or System.Net.Mail (selected by `mailConfig.SmtpClient`).
- **Current status:** `EmailAlertService.HandleEmailAlertAsync` looks up the template + SMTP config and sends per recipient. Placeholder substitution (`{{Variable}}`) works.
- **Limitations:** **Defect:** the System.Net path (`SendUsingSystemSmtp`) sets `Subject = template.TemplateSubject` WITHOUT running `ApplyVariables`, so any `{{...}}` token in the subject ships literally when `SmtpClient != 0`; the MailKit path substitutes the subject correctly. No retry/backoff; a failed send is logged and dropped. No dedup/rate-limit, so a flapping monitor emails on every open/resolve.
- **Suggested changes:** (P1, low effort) Apply variables to the subject in `SendUsingSystemSmtp` (mirror the MailKit path). (P3) Add basic send retry and flap suppression.

### In-app notifications — ✅ Shipped
- **What it does:** On open/resolve, pushes a notification to everyone with project access plus the monitor's creator + last editor, via the platform Notification service over SignalR.
- **Current status:** `NotificationAlertService.HandleNotificationAlertAsync` builds the audience from `GetProjectPeopleIds(projectKey)` + creator + last editor and POSTs a signed payload (`Secret` = root tenant id hashed with tenant salt) to `NotificationServiceUrl`. Matches the "broad/team by default" decision (#142/B5).
- **Limitations:** No per-user in-app targeting by design (intentional per #142). Delivery is best-effort; a failed POST is logged, not retried. Depends on `RootTenantId` config being present.
- **Suggested changes:** (P3) None functionally required; consider a retry on transient notification-service failures.

### Email recipient cap — 🟡 Partial
- **What it does:** Caps the number of email recipients per monitor in the UI.
- **Current status:** `notification-modal.tsx` hard-codes `MAX_EMAILS = 5` (add button hidden past 5). Decision #142 raises this to a higher fixed guardrail (~10–20).
- **Limitations:** Cap is client-side only — the server does not enforce any recipient count, so an API caller can set more. Value (5) is stale vs the decision.
- **Suggested changes:** (P2) Raise `MAX_EMAILS` to the agreed guardrail (~10–20) and enforce it server-side in the update validators (#142).

### Edit alert recipients — ✅ Shipped
- **What it does:** Per-monitor recipient list editor with email validation + duplicate detection.
- **Current status:** `notification-modal.tsx` validates via zod, blocks duplicates, and persists via `UpdateMonitor`/`UpdateHealth`.
- **Limitations:** Subject to the 5-cap above. Requires at least one valid email to save.
- **Suggested changes:** (P3) Fold into the cap change above.

### Area D — Monitor Management & Lifecycle

### Monitor list with status & uptime — ✅ Shipped
- **What it does:** Per-project table (Name, Monitor Type, URL, Tagged Service, Uptime, Status bar) with tabs "My monitors" and "Blocks services."
- **Current status:** `alerts-list.tsx` + `pages/health/index.tsx`; tabs defined in `health.constant.ts` (`all` → "My monitors" `monitorSourceType: null`; `services` → "Blocks services" → `BlocksServices`). 24h incident summaries drive the status `ProgressBar`.
- **Limitations:** The "Monitor Type" column still shows **"Request"/"Callback"** (should be "HTTP Check"/"Heartbeat", #144/#158). No visible **paused** indicator on a row (see Pause/Resume). The "Uptime" column actually shows *time since last incident*, not an uptime %.
- **Suggested changes:** (P2) Relabel Request→HTTP Check, Callback→Heartbeat across the list. (P2) Add a paused badge. (P3) Rename the column header to reflect "time since last incident".

### Monitor detail dashboard — ✅ Shipped
- **What it does:** Current up/down + "currently up/down for X", 7/30/365 uptime cards, availability timeline, latest incidents, notification/configure/actions controls (hidden for `BlocksServices`).
- **Current status:** `pages/monitor/details.tsx` composes `MonitorCard`, `MonitorSummary`, `ResponseTime`, `IncidentList`; controls gated on `monitorSourceType !== 2`.
- **Limitations:** Inherits the timeline-title and paused-uptime gaps above. "Currently up/down for X" is `now − lastIncidentAt` and does NOT freeze while paused (#143).
- **Suggested changes:** (P2) Freeze "time since last incident" while paused (#143).

### Pause / Resume — 🟡 Partial
- **What it does:** Toggle a monitor's `IsActive`; paused monitors stop being checked but remain listed.
- **Current status:** `alert-action.tsx` flips `IsActive` via update; schedulers drop inactive monitors on reload (HTTP scheduler loads active; `HealthCheckService.LoadMonitorsFromDatabaseAsync` removes ones no longer active). Monitor stays in the list.
- **Limitations:** No **visible paused indicator** in the list or detail (decision #143/B6 requires one) — `isActive` is only used to choose the Pause/Resume menu label. "Time since last incident" keeps counting while paused (should freeze, #143). Uptime does not exclude paused time (#143).
- **Suggested changes:** (P2) Add a clear paused badge in `alerts-list.tsx` and the detail header; freeze the incident-age clock and exclude paused spans from uptime (#143).

### Delete monitor — ✅ Shipped (🔴 wrong service for heartbeats, #153)
- **What it does:** Permanently removes the monitor and its incident history; no undo (by design, #125).
- **Current status:** `MonitorController.DeleteMonitor` → `DeleteConfigurationAsync`; UI confirms with a "cannot be undone" dialog. Destructive-by-design matches DECISIONS B7.
- **Limitations:** **Defect (#153):** `HealthController.DeleteHealth` calls `_monitorConfigurationService.DeleteConfigurationAsync` (the monitor service) instead of a health-service delete, so the heartbeat's in-memory queue entry is not proactively removed — it lingers until the 600s DB poll drops it. Delete does not remove associated `MonitorPingLog`/`MonitorIncident` documents explicitly (only the config) unless `DeleteConfigurationAsync` cascades — history "destruction" scope should be verified.
- **Suggested changes:** (P2) Give heartbeats a proper delete path that also clears the health scheduler queue (#153). (P2) Verify and, if needed, cascade-delete ping logs + incidents on monitor delete to honour the "destroys its history" promise.

### Tag a service — ✅ Shipped
- **What it does:** Associate a monitor with a Deployed repo, a "My service" (any third-party), or None; duplicate-external-service check.
- **Current status:** Form radio `none/deployed/my-services` (`monitor-form-fields.tsx`); server maps to `MonitorSourceType`; `IsExternalServiceConfigured` supports the duplicate check. Any third-party target is allowed (#148/D2); deployment linkage is opt-in/off by default.
- **Limitations:** Source type cannot be changed after creation (form disables it in edit mode). `EffectiveMonitorSourceType` defaults to `DeployedServices` when unset, which can mis-categorise legacy rows.
- **Suggested changes:** (P3) Allow re-tagging on edit, or document why it is immutable.

### 10-monitors-per-project cap — 🟡 Partial (off-by-one, #128)
- **What it does:** Abuse safeguard limiting monitors per project (not a pricing tier).
- **Current status:** `SaveMonitorConfigurationRequestValidator.HaveLessThanMaxMonitors` returns `monitors.Count <= 10` — this permits creation when there are already 10, i.e. an 11th slips through.
- **Limitations:** Off-by-one lets 11 exist. Cap applies only to HTTP Checks (heartbeats bypass the validator entirely). Hard-coded literal `10` in the rule and message.
- **Suggested changes:** (P2) Change to `< 10` (or intended value) and apply the same rule to heartbeat creation (#128).

### URL validity & uniqueness — 🟡 Partial
- **What it does:** Rejects invalid URLs and duplicates on create.
- **Current status:** `IsValidUrl` requires absolute http/https; `BeUniqueUrl` checks existing by URL.
- **Limitations:** `BeUniqueUrl` calls `GetByUrlAsync(url)` with no project/tenant scope, so uniqueness is likely enforced *globally across tenants* rather than per-project — one tenant monitoring `https://example.com` could block another. Uniqueness is not re-checked on update. "unreachable" wording in the message overpromises (only syntax is validated, not reachability).
- **Suggested changes:** (P2) Scope URL-uniqueness to the project key (verify `GetByUrlAsync` filters by tenant); fix the misleading "unreachable" copy.

### Config-change propagation — ✅ Shipped
- **What it does:** On HTTP Check save/update, enqueues a `MonitorConfigurationUpdateQueue` message so the Worker scheduler reloads promptly.
- **Current status:** `MonitorConfigurationService` sends to `ObservabilityConstants.MonitorConfigurationUpdateQueue`; `MonitorConfigurationUpdateConsumer` handles it. Enqueue failures are logged, not fatal.
- **Limitations:** Heartbeats do not use this queue (they reload inline in the request path). Single queue, best-effort — a dropped message means the change waits for the 600s poll.
- **Suggested changes:** (P3) Unify heartbeat config propagation onto the same queue.

### Area E — Platform, Access & Embedding

### Blocks services (incident transparency) — 🟡 Partial
- **What it does:** Read-only "Blocks services" tab showing platform core-service monitors to signed-in tenants; edit/pause/delete hidden; intended to also let users subscribe to platform incidents.
- **Current status:** Tab + read-only gating implemented (`monitorSourceType === 2` hides controls in list + detail; update/delete rejected server-side for `BlocksServices`/`Infrastructure`). Seeding is external to this repo.
- **Limitations:** **Subscribe-to-platform-incident is not implemented** (no UI/API found) — a decided part of #146/C4. No public status page (correctly, by design).
- **Suggested changes:** (P3) Add the "subscribe to platform incident" affordance (#146).

### Embeddable API driver — 🟡 Partial
- **What it does:** `SeliseBlocks.ObservabilityDriver` exposes the full Monitor+Health surface via `IObservabilityDriverService` so other Blocks services can host these endpoints; embeds attributed "powered by Blocks Monitor."
- **Current status:** Driver + `RegisterBlocksObservabilityServices()` exist (`server/Observability.Driver/*`). Only blocks-release embeds it, display-only (#149/D3).
- **Limitations:** The **"powered by Blocks Monitor" attribution is not enforced or provided** by the driver — it is a convention. Package/interface names still carry the retired "Observability" brand (#157). Driver does not enforce auth (hosting controller must), which is easy to get wrong.
- **Suggested changes:** (P3) Ship an attribution component/string with the driver and rename the package to the Monitor brand (#149, #157).

### Monitor-specific roles (Viewer/Editor/Admin) — 🗺️ Roadmap (🔴 security gap today, #151)
- **What it does (intended):** Viewer (read), Editor (create/edit/pause), Admin (delete + manage recipients), over blocks-os super-perms (#150/D4).
- **Current status:** Not implemented. `Program.cs` hard-codes `serviceAccessResourceName: "blocks-os"` with an in-code TODO pointing at the retired `blocks-observability` name (#152). Controllers use only coarse `[Authorize]`; there are **no permission scopes and no per-tenant authorization check** on mutating actions.
- **Limitations:** **Security (#151):** any authenticated user can call `DeleteMonitor`/`UpdateMonitor` for any monitor id — deletes/edits are not verified against the caller's project/tenant. This is the single most serious gap in the product.
- **Suggested changes:** (P1) Enforce tenant ownership on every mutating action (reject when the monitor's `TenantId` ≠ caller's project) BEFORE roles land (#151). (P1) Define and wire the IAM resource + Viewer/Editor/Admin roles (#150, #152).

### Area F — Product Identity & Naming

### Rename nav "Health" → "Monitor" — 🗺️ Roadmap
- **What it does (intended):** Nav section labelled "Monitor" (#144).
- **Current status:** `navigation-menus.constant.ts` and `pages/health/index.tsx` `<h1>` still say **"Health"**.
- **Limitations:** Three overlapping names in the product (Blocks Monitor / Health / Observability) confuse users and code.
- **Suggested changes:** (P2) Rename the nav item + page heading to "Monitor" (#144).

### Standardise check-type names (HTTP Check / Heartbeat) — 🟡 Partial
- **What it does (intended):** One name pair everywhere: "HTTP Check" (we ping you) and "Heartbeat" (you ping us) (#144).
- **Current status:** UI still uses **"Request"/"Callback"** (`monitor-form-fields.tsx` `MONITOR_TYPE_OPTIONS`, `alerts-list.tsx` type column). Enum stays `OutboundPing`/`InboundPing`; API stays `SaveMonitor`/`SaveHealth`. Each type effectively has three names (#158).
- **Limitations:** User-facing inconsistency; also a wire typo `monitorSourcetype` on the query contract with interface/impl disagreement (#155).
- **Suggested changes:** (P2) Relabel to HTTP Check / Heartbeat in all client copy (#144, #158); fix the `monitorSourcetype` casing on the contract (#155).

### Retire "Observability" branding — 🗺️ Roadmap
- **What it does (intended):** Remove the legacy "Observability" name, including the published NuGet package (#157), and leftover `Devops.*` namespaces / dead route-prefix code (#156).
- **Current status:** `IObservabilityDriverService`, `ObservabilityConstants`, `SeliseBlocks.ObservabilityDriver`, and `Devops.DomainService.*` imports (e.g. in `MonitorPingService.cs`, `NotificationAlertService.cs`) persist.
- **Limitations:** Naming drift is not enforceable — no analyzer/editorconfig rules (#159). Project name ≠ namespace in places (#156).
- **Suggested changes:** (P3) Rename package + interfaces to the Monitor brand and add naming lint rules (#157, #156, #159).

### Marketing copy correction (uptime-only) — 🗺️ Roadmap
- **What it does (intended):** Correct README/registry/in-app copy that advertises "logs, tracing, metrics, AI diagnostics" — none of which exist here — and cross-link to the separate telemetry/OS service (#144/C1).
- **Current status:** Not corrected; `v1 = uptime only` but copy still overstates. Owning telemetry service is unnamed (open question).
- **Limitations:** Misleads users about scope.
- **Suggested changes:** (P3) Rewrite copy to uptime-only and add cross-nav once the telemetry service is named (#144).

---

## 2. Cross-Cutting Limitations

- **Authorization / multi-tenancy is the top risk (#151, #152).** All management endpoints are only `[Authorize]` under the shared `blocks-os` IAM resource; there are **no permission scopes and no verification that the acting tenant owns the monitor** being mutated. `DeleteMonitor`/`UpdateMonitor`/`DeleteHealth` take a bare id and do not filter by `TenantId`, so a signed-in user of one project can delete/edit another project's monitors. Own roles (Viewer/Editor/Admin) are decided (#150) but unbuilt.
- **Identity/naming drift (#154–#159).** `projectKey` and `tenantId` are the same value under two names across the call chain (#154); the `monitorSourcetype` query param is a typo baked into the wire contract with interface/impl disagreement (#155); `Devops.*` namespaces, project≠namespace, and dead route-prefix code remain (#156); "Observability" persists incl. the published package (#157); three names per check type (#158); no analyzer/editorconfig to enforce any of it (#159).
- **Response-envelope inconsistency.** The surface mixes `BaseApiResponse`, `PaginatedResponse`, `MonitorDetailsResponse`; not-found and validation errors are returned as `IsSuccess=false` under HTTP 200 (e.g. `UpdateConfigurationAsync`, `DeleteConfigurationAsync` set `StatusCode = HttpStatusCode.OK` on failures). No canonical envelope / correct HTTP status mapping is decided.
- **Inert configuration fields.** `TimeoutInSeconds`, `AuthorizationType`, `MonitorType` (non-HTTP), `ProtocolType`, `ExpectedContent`, `SuccessHttpResponseCodes`, `Regions` are all captured/stored but never evaluated — a large gap between the form and runtime behaviour.
- **Paused-time accounting unbuilt (#143).** Pause/resume timestamps are not stored, so uptime% and "time since last incident" cannot yet exclude/freeze paused spans as decided.
- **No retention/TTL** for ping logs or resolved incidents; both grow unbounded.
- **Best-effort delivery.** Email and in-app alerts have no retry/backoff/flap-suppression; failures are logged and dropped.
- **CI quality gates off by default.** Tests/SonarQube/SCA are toggled off in dev (`RUN_TESTS: "false"`); backend coverage ~81% on the domain package, but no repo-specific coverage gate is decided — CI does not fail on regressions.
- **Heartbeat vs HTTP inconsistencies.** Heartbeats bypass the monitor cap, use a synchronous in-request scheduler reload instead of the config-update queue, and are deleted through the wrong service (#153).

---

## 3. Suggested Changes — Prioritised

| Priority | Area/Feature | Suggested change | Why it matters | Rough effort | Ref |
| --- | --- | --- | --- | --- | --- |
| P1 | Authorization / multi-tenancy | Verify monitor `TenantId` == caller's project on every read/mutate (esp. Delete/Update/DeleteHealth) | Any authenticated user can currently delete/edit any tenant's monitors | M | #151, #154 |
| P1 | Access control roles | Define the IAM resource + wire Viewer/Editor/Admin scopes over blocks-os | Decided model (#150); removes reliance on coarse `[Authorize]`; in-code TODO targets a retired name | L | #150, #152 |
| P1 | Email alerts | Apply `{{Variable}}` substitution to the subject in `SendUsingSystemSmtp` | System.Net path ships raw `{{...}}` subjects to users; MailKit path already correct | S | — |
| P1 | Availability Timeline | Rename "Status Overview"→"Availability Timeline" and the `ResponseTime` component | Decided (#140); current title implies latency, misleads users | S | #140 |
| P1 | Heartbeat setup guidance | Add callback-URL panel with copyable cURL/cron snippets + docs on create | Decided v1 (#141); without it heartbeats have very high setup friction | M | #141 |
| P2 | 10-monitor cap | Fix off-by-one (`<= 10` → `< 10`) and apply cap to heartbeats | Off-by-one lets an 11th monitor through; heartbeats uncapped | S | #128 |
| P2 | Delete (heartbeat) | Give heartbeats a real delete that clears the health scheduler queue; cascade-delete history | Wrong service today (#153); lingering in-memory timer; unverified history destruction | M | #153, #125 |
| P2 | Pause/Resume | Store pause/resume times; show paused badge; freeze incident-age; exclude paused time from uptime | Decided honest-uptime + visible-paused behaviour (#143) is unbuilt | M | #143 |
| P2 | URL uniqueness | Scope uniqueness to project key; re-check on update; fix "unreachable" copy | Global uniqueness can let one tenant block another's URL | S | — |
| P2 | Email recipient cap | Raise UI cap to agreed guardrail (~10–20) and enforce server-side | Cap of 5 is stale (#142) and unenforced on the API | S | #142 |
| P2 | Check-type + nav naming | Relabel Request→HTTP Check, Callback→Heartbeat; nav "Health"→"Monitor"; fix `monitorSourcetype` typo | User-facing consistency; contract typo (#155) | M | #144, #155, #158 |
| P2 | HTTP timeout | Apply `TimeoutInSeconds` to the outbound HttpClient | Slow endpoints hold scheduler slots; stored value is a no-op | S | #B2 |
| P2 | Ongoing incident persistence | Persist status-code/reason updates while an incident is open | Stored record keeps only the first failure's values | S | — |
| P3 | Keep-alive check | Expose configurable URL + surface as a feature | Decided product feature (#147); currently internal-only | M | #147 |
| P3 | Blocks services | Add subscribe-to-platform-incident | Part of the transparency decision (#146) | M | #146 |
| P3 | Embedding | Ship "powered by Blocks Monitor" attribution; rename Observability package | Decided attribution (#149) + brand retirement (#157) | M | #149, #157 |
| P3 | Latency chart / retention | Build latency chart from ping logs; add TTL for logs + resolved incidents | Roadmap value + unbounded data growth | M | #140 |
| P3 | Naming enforcement / dead code | Add analyzer/editorconfig rules; remove `Devops.*`, dead route-prefix code | Prevents naming drift recurring (#159, #156) | M | #156, #159 |
| P3 | Inert fields / check types | Hide unimplemented options (non-HTTP types, auth, regions, expected content) until built | Avoids implying unsupported capability | S | #B2 |
