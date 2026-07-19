# Blocks Monitor — Product Specification

> Status: v1 specification. Authoritative source for product intent. Where this document states a target that the current code does not yet meet, the gap is called out inline as **Gap:**. Canonical terminology and product decisions come from answered tickets and product-owner review; where code and decision disagree, the decision is the target state described here.
>
> Scope reminder: **Blocks Monitor v1 is uptime monitoring only** — availability checks, incidents, and alerting. Logs, distributed tracing, and metrics are **not** part of this product; they live on a separate telemetry/OS service.

---

## 1. Product Summary

**Blocks Monitor** (short name: **Monitor**) is the uptime and availability monitoring, incident, and alerting service of the SELISE Blocks platform. Within a project, a user registers **monitors** — each watching one endpoint or one background job — and Blocks Monitor continuously determines whether each target is healthy. When a target fails, Monitor opens an **incident**, flips the monitor to **down**, and sends **alerts**. When the target recovers, the incident is auto-resolved and a recovery alert is sent. The UI presents current up/down status, uptime percentages over rolling windows, an availability timeline, and a searchable incident history.

Monitor supports two check styles:

- **HTTP Check** (we ping you): Monitor actively sends an HTTP request to a URL on a schedule and inspects the response.
- **Heartbeat** (you ping us): Monitor issues a unique callback URL and expects the target service to call it on a schedule. If the expected ping does not arrive within the interval plus grace period, an incident is opened — a dead-man's-switch for background jobs and services with no public URL.

Monitoring is **not restricted to platform-deployed services**: a user can monitor any third-party endpoint. Monitor is multi-tenant — everything is scoped to a **project** (a tenant key), authenticated through blocks-iam via OIDC, and runs as a .NET API plus a background Worker, with a React + Vite client.

Positioning in the suite: Monitor is one of the five SELISE Blocks services. It references — but does not own — deployments (from the release side), the platform communication service (for alert delivery), and identity (blocks-iam). It also ships an embeddable API driver so other Blocks services can host the same monitoring surface, attributed as **"powered by Blocks Monitor."**

**Marketing-copy gap.** The product registry, README, and some in-app copy advertise "real-time logs, distributed tracing, usage metrics, and AI-assisted diagnostics." None of those exist in this product and none are v1 goals. **Gap:** marketing copy must be corrected to describe uptime monitoring only, and logs/tracing/metrics must be attributed to the separate telemetry/OS service with cross-navigation links (the owning service is not yet named — see Open Questions).

---

## 2. Personas & Jobs-to-be-Done

Blocks Monitor is for **all Blocks user types** — developers, team leads, and businesspeople. It is not narrowed to a single segment. For prioritizing defaults, the **primary persona is the Team Lead**.

| Persona | Who they are | Primary jobs-to-be-done |
| --- | --- | --- |
| **Team Lead** (primary) | Responsible for a project's reliability across a team | "Tell me and my team the moment a service goes down." "Show me uptime and incident history I can report to stakeholders." "Make sure the right people are alerted without me configuring each person." Defaults are optimized for this persona: default landing shows one project's monitors; in-app notifications default broad to the whole team. |
| **App Developer** | Building and operating services on Blocks | "Watch my deployed service or any external URL." "Watch a background job that has no public URL via a heartbeat." "Alert me by email; let me investigate incidents and response history." "Optionally embed monitoring into my own Blocks service via the driver package." |
| **Businessperson / Stakeholder** | Non-engineer using Blocks | "Is the thing we depend on up?" "Give me a readable uptime number and incident record." "Reassure me during a platform incident and let me subscribe to platform-incident updates." |
| **Platform Operator** (secondary/implied) | Runs the Blocks platform itself | Provides the seeded **Blocks services** monitors that tenants see read-only. (Seeding is performed outside this repo.) |
| **Monitored service** (machine, not a person) | A background job or API being watched | Calls the public Heartbeat ping URL on a schedule. |

**End-users of a tenant's application** are not a persona: they never see Blocks Monitor.

---

## 3. Terminology & Glossary

Canonical customer-facing names are listed first. Retired/aliased terms and internal code names are marked so.

| Canonical term | Meaning | Retired / aliased / internal names |
| --- | --- | --- |
| **Blocks Monitor** / **Monitor** | The product. | **"Observability"** — retired (legacy internal name; still appears as `blocks-observability` code comments, the `IObservabilityDriverService`, and the `SeliseBlocks.ObservabilityDriver` package name). **Gap:** in-app section is still labelled **"Health"** in navigation and should be renamed to **Monitor**. |
| **Monitor** | A single configured check watching one target. Stored as `MonitorConfiguration`. | — |
| **HTTP Check** | Active outbound HTTP check ("we ping you"). | **"Request"** monitor (current UI label), **"OutboundPing"** (enum), **`SaveMonitor`** (API). To be unified as **HTTP Check**. |
| **Heartbeat** | Inbound-ping / dead-man's-switch check ("you ping us"). | **"Callback"** monitor (current UI label), **"InboundPing"** (enum), **"Health"** (API/`SaveHealth`). To be unified as **Heartbeat**. |
| **Incident** | A period during which a monitor is down: opens on failure, resolves on recovery; carries start time, end time, downtime duration, failure reason, and last status code. | — |
| **Alert** | The notification (email and/or in-app) sent when an incident opens or resolves. | Note: client code confusingly reuses "Alert" for the monitor-list module (`AlertsList`, `alert.service`); that is an internal naming artifact, not a user-facing concept. |
| **Ping / Ping log** | One executed check attempt; records status code, response time, success flag. | `MonitorPingLog`. |
| **Uptime %** | (Window length − downtime) / window length, over the selected window (7 / 30 / 365 days). Downtime is computed over **checked** time only; paused time is excluded. | `uptime = uptime / window-length-in-seconds`. |
| **Availability Timeline** | The monitor detail section that renders the up/down status history over a time range. | **Gap:** currently titled **"Status Overview"** in code (and was historically "Response time"); the decided canonical name is **"Availability Timeline"** (acceptable alt: "Status Timeline"). It renders status history, not latency. |
| **Response time** | Per-check latency recorded on each ping log. Recorded now; a dedicated latency chart is roadmap, not v1. | — |
| **Downtime** | Total seconds a monitor was down within a window (`EndTime − StartTime` summed over incidents). | — |
| **Grace period** | Extra time after the interval before a missing heartbeat counts as down (Heartbeat monitors). | `GracePeriodInSeconds`. |
| **Tagged Service / Tag a Service** | Associating a monitor with a **Deployed** repo/service or with a **My service** (any external/third-party service). | The "My service" tag applies to any third-party service. |
| **Blocks services** | Read-only view of monitors for the Blocks platform's own core services, shown to signed-in tenants for incident transparency. | Source type `BlocksServices`. |
| **Keep-alive check** | Built-in background check that periodically pings one configurable URL; a product feature surfaced to users. | Internal: `PeriodicPingBackgroundService`. **Gap:** URL is not yet user-configurable/surfaced. |
| **Monitor source type** | Category of the watched target: Infrastructure, DeployedServices, BlocksServices, ExternalServices, OtherServices. | — |

---

## 4. Feature Catalog

Status legend: **Shipped** = implemented and matches intended v1 behaviour; **v1** = required for v1, partially or not yet matching the decision (gap noted); **Roadmap** = explicitly deferred beyond v1.

| Feature | Description | Status | Notes |
| --- | --- | --- | --- |
| HTTP Check monitoring | Active HEAD/GET/POST to a URL on an interval; records status code and response time. | Shipped | Runs in the Worker scheduler. |
| Heartbeat monitoring | Unique callback URL; missing ping within interval + grace opens an incident; incoming ping resolves it. | Shipped | Public ping endpoint by design. |
| Heartbeat setup guidance | Copyable setup snippets (cURL / cron) plus docs shown next to the generated URL. | v1 | **Gap:** copyable snippets/docs are a v1 requirement; confirm presence next to the generated URL. |
| Incident lifecycle | One open incident per monitor at a time; open on failure, resolve on recovery; start/end/duration, failure reason, last status code. | Shipped | — |
| 4xx and 5xx count as down | A check is a failure when status `< 200` or `>= 400`, or on exception/unreachable. | Shipped | Current logic is `< 200 || >= 400`, so 401/403/404 now open incidents. Matches decision. |
| Configurable success codes / expected content | `SuccessHttpResponseCodes` and `ExpectedContent` captured on the form to refine pass/fail. | Roadmap | Stored but **not** used to judge health today. **Open/undecided:** which should influence pass/fail in v1. |
| Email alerts | Templated emails on incident open and resolve, sent to the monitor's recipient list via SMTP. | Shipped | Recipient list is user-chosen. |
| In-app notifications | Pushed to everyone with access to the project (plus creator/last editor) via the platform Notification service. | Shipped | Broad/team by default; no per-user in-app targeting. |
| Email recipient cap | Fixed guardrail on number of email recipients per monitor. | v1 | **Gap:** UI cap is currently **5** (`MAX_EMAILS = 5`); decision raises it to a higher fixed guardrail (~10–20). |
| Monitor list with status & uptime | Per-project table: Name, type, URL, tagged service, uptime, status/incident bar. Tabs: "My monitors" and "Blocks services." | Shipped | — |
| Monitor detail dashboard | Current up/down, uptime % over 7/30/365 days with incident counts and total downtime, availability timeline, latest incidents. | Shipped | Timeline section rename pending (see below). |
| Availability Timeline rename | Detail section renamed to "Availability Timeline"/"Status Timeline". | v1 | **Gap:** currently titled "Status Overview" in code. |
| Per-check response time recorded | Each ping log stores response time in ms. | Shipped | Latency chart itself is roadmap. |
| Latency / response-time chart | A genuine response-time trend chart. | Roadmap | Not v1. |
| Incident history | Paginated, sortable per-monitor list: status, root cause, start/end, duration; status code for HTTP Checks. | Shipped | — |
| Pause / Resume | Toggle a monitor's active state; paused monitors stop being checked but stay in the main list with a visible paused indication. | Shipped/v1 | **Gap:** confirm the visible paused indicator and frozen "time since last incident" while paused. |
| Delete monitor | Removes the monitor and permanently destroys its incident history; no undo. | Shipped | Intended behaviour: deletion is destructive by design. |
| Edit alert recipients | Per-monitor email recipient list editor. | Shipped | Subject to the cap above. |
| Tag a service | Associate a monitor with a deployed repo ("Deployed") or an external "My service"; duplicate-external-service check. | Shipped | Deployment-to-monitor is opt-in, off by default. |
| Config-change propagation | Creating/updating a monitor enqueues a message so the scheduler reloads promptly. | Shipped | — |
| Blocks services (incident transparency) | Read-only view of platform core-service monitors for signed-in tenants; subscribe to platform incident. | Shipped/v1 | **Gap:** confirm subscribe-to-platform-incident; **no public status page** is a goal. Seeded outside this repo. |
| Keep-alive check | Built-in background ping of one configurable URL, surfaced as a product feature. | v1 | **Gap:** make the URL configurable and surface it; today it is an internal fixed-URL background service. |
| Embeddable API driver | `SeliseBlocks.ObservabilityDriver` NuGet package exposes the Monitor + Heartbeat API surface to other Blocks services; embeds are attributed "powered by Blocks Monitor." | Shipped/v1 | Only blocks-release currently embeds, consuming a few APIs for display. **Gap:** attribution surface. |
| Monitor-specific roles | Viewer / Editor / Admin roles scoped to Monitor. | Roadmap→v1 | **Gap:** access is still governed by the `blocks-os` IAM resource; own roles not yet implemented. |
| 10-monitors-per-project cap | Hard validation limit of 10 monitors per project. | Shipped | Abuse safeguard, **not** a pricing tier; does not vary by plan. |
| Multi-region checks / PING/TCP/DNS/KEYWORD / SSL & domain-expiry reminders / per-monitor timeout / auth types | Form/enum placeholders. | Roadmap | Captured but with no runtime behaviour; not v1. |

---

## 5. Key User Flows

### A. Create an HTTP Check (App Developer / Team Lead)
1. Open the Monitor section for a project → **Add Monitor**.
2. Choose **type = HTTP Check**; enter **Name** and **URL to monitor**; optionally **Tag a Service** (None / Deployed repo / My service).
3. Optionally expand settings (interval, grace time) and request configuration (HTTP method; request body for POST; send-as-JSON header).
4. Save → `POST /api/Monitor/SaveMonitor`. Backend validates URL validity, URL uniqueness, and the **10-monitor cap**, stores a `MonitorConfiguration` (type `OutboundPing`), and enqueues a config-update message.
5. The Worker scheduler begins pinging on the interval; each ping logs status code and response time.
6. On a failing response (status `< 200` or `>= 400`, or an exception), an incident opens, the monitor flips to **down**, and open-alerts fire (email + in-app). On the next healthy response, the incident resolves and resolved-alerts fire.

### B. Create a Heartbeat (App Developer)
1. **Add Monitor** → **type = Heartbeat**; enter Name, interval, and grace time. → `POST /api/Health/SaveHealth`.
2. Backend generates a unique callback URL and stores a config with type `InboundPing`.
3. The developer copies the provided **cURL / cron snippet** and wires their service to call `GET /api/Health/Ping/{itemId}` on schedule. This endpoint is **public by design** (pings come from both background services and API services).
4. A per-monitor timer expects a ping each interval (+ grace). If it elapses without a ping, a "no ping received" incident opens and alerts fire. An incoming ping resolves the open incident and resets the timer.

### C. Investigate an incident (Team Lead / Admin)
1. From the monitor list, click a monitor → detail page.
2. Read **Current Status**, **uptime %** for 7/30/365 days (with incident count and total downtime), the **Availability Timeline**, and **Latest incidents**.
3. Click **View all incidents** → paginated history: status (Resolved / Unresolved), root cause, start/end time ("Ongoing" if unresolved), duration, and status code for HTTP Checks.

### D. Manage recipients / pause / delete (Team Lead / Admin)
1. On the detail page, open notification settings → add/remove recipient emails (subject to the guardrail cap).
2. The actions menu → **Pause/Resume** (paused monitors stop being checked, remain in the list with a paused indicator) or **Delete** (removes the monitor and its history permanently). These controls are hidden for `BlocksServices` monitors.

### E. View platform health (Businessperson / any signed-in tenant)
1. Switch to the **Blocks services** tab → read-only monitors for Blocks core services.
2. During a platform incident, view status and subscribe to platform-incident updates. No edit/delete; no public status page.

### F. Embed monitoring in another Blocks service (App Developer, backend)
1. Add the `SeliseBlocks.ObservabilityDriver` package, register it, inject `IObservabilityDriverService`, and call the monitor/heartbeat operations from the host service's own controllers.
2. Surfaces that display embedded monitoring are attributed "powered by Blocks Monitor." Currently only blocks-release embeds it, for a few display APIs.

---

## 6. UX Principles & Default Behaviours

- **Team-first defaults.** Optimized for the Team Lead: the default landing shows one project's monitors; in-app notifications default broad to the whole team so nobody has to enumerate recipients.
- **Two clear check styles, named by direction.** **HTTP Check** = "we ping you"; **Heartbeat** = "you ping us." One name pair everywhere; retire Request/Callback/OutboundPing/InboundPing/Health-as-a-check-type from user-facing surfaces.
- **Any target is fair game.** No boundary on what can be monitored — platform-deployed services and arbitrary third-party endpoints alike. Deployment-to-monitor linkage is opt-in and off by default.
- **Guided heartbeat setup.** Because heartbeats require the user to wire up an external caller, ship copyable cURL/cron snippets and docs next to the generated URL. The URL stays open by design; guidance offsets the setup friction rather than locking the URL.
- **Fail conservatively toward "down."** Non-2xx responses in the failure range (including 4xx) and unreachable/timeout conditions count as outages, so silent auth/not-found failures are not hidden as "up."
- **Two-channel alerting with different audiences.** In-app notifications reach everyone with project access (broad, team-wide); emails go to a hand-picked recipient list. This split is intentional.
- **Honest uptime.** Uptime % is measured over checked time and excludes paused time; "time since last incident" freezes while paused so a pause does not inflate reliability numbers.
- **Paused is visible, not hidden.** Paused monitors remain in the main list with a clear paused indication rather than disappearing.
- **Destructive actions are explicit.** Deleting a monitor permanently destroys its incident history with no undo; this is by design and should be clearly communicated at the point of deletion.
- **Transparency, not a status page.** The Blocks services view exists to reassure tenants and let them distinguish their problem from a platform problem during incidents; it is not a public status page.
- **Attribution when embedded.** When another service hosts monitoring via the driver, the experience is attributed to Blocks Monitor.

---

## 7. Functional Requirements & Acceptance Criteria

### FR-1 HTTP Check scheduling and failure detection
- **Given** an active HTTP Check with interval N seconds, **when** N seconds elapse, **then** Monitor sends the configured HTTP request and records a ping log with status code and response time.
- **Given** a ping response with status `< 200` or `>= 400`, or an exception/timeout, **when** the check runs and no incident is currently open, **then** Monitor opens an incident, sets the monitor to **down**, and fires open-alerts (email + in-app).
- **Given** an open incident, **when** a subsequent check returns a healthy (2xx/3xx) response, **then** Monitor resolves the incident, sets the monitor **up**, and fires resolved-alerts.

### FR-2 Heartbeat monitoring
- **Given** a Heartbeat monitor with interval N and grace G, **when** no ping is received within N + G seconds of the last ping, **then** Monitor opens a "no ping received" incident and fires open-alerts.
- **Given** an open Heartbeat incident, **when** a ping arrives at `GET /api/Health/Ping/{itemId}`, **then** Monitor resolves the incident and resets the timer.
- **Given** the Heartbeat ping endpoint, **when** any caller with the URL hits it, **then** the ping is accepted without authentication (public by design).
- **Given** a newly created Heartbeat, **when** the user views its detail, **then** copyable cURL and cron snippets plus setup docs are shown next to the generated URL. *(Acceptance for the v1 gap.)*

### FR-3 Incidents
- **Given** a monitor, **when** it is down, **then** at most one incident is open at a time, carrying start time, (optional) end time, downtime duration, failure reason/root cause, and last status code (for HTTP Checks).
- **Given** an unresolved incident, **when** listed, **then** its end time reads "Ongoing" and it is marked Unresolved.

### FR-4 Alerting
- **Given** an incident opens or resolves, **when** alerts fire, **then** an email is sent to each address on the monitor's recipient list and an in-app notification is delivered to everyone with access to the project.
- **Given** a monitor's recipient list, **when** a user edits it, **then** the number of email recipients is capped at the fixed guardrail (target ~10–20; **Gap:** currently 5).
- **Given** in-app notifications, **when** they are sent, **then** there is no per-user in-app targeting — the whole project audience receives them.

### FR-5 Uptime and timeline
- **Given** a selected window (7/30/365 days), **when** the detail page renders, **then** uptime % = (window length − downtime over checked time) / window length, excluding paused time, alongside incident count and total downtime.
- **Given** a paused monitor, **when** uptime and "time since last incident" are computed, **then** paused time is excluded and the "time since last incident" value is frozen.
- **Given** the detail page, **when** the availability section renders, **then** it is titled **"Availability Timeline"** (**Gap:** currently "Status Overview") and shows up/down status over the selected range.

### FR-6 Monitor lifecycle and limits
- **Given** a project with 10 monitors, **when** a user attempts to create an 11th, **then** creation is rejected with a limit message (abuse safeguard; not plan-based).
- **Given** a monitor create/update, **when** submitted, **then** the URL must be valid and unique within the project.
- **Given** a paused monitor, **when** the list renders, **then** it remains listed with a visible paused indication.
- **Given** a monitor is deleted, **when** the user confirms, **then** the monitor and its entire incident history are permanently removed with no undo.
- **Given** a `BlocksServices` or `Infrastructure` monitor, **when** a tenant views it, **then** edit, pause, and delete controls are unavailable (read-only).

### FR-7 Access control (target)
- **Given** Monitor's own role model, **when** a user acts, **then**: a **Viewer** may read monitors/incidents; an **Editor** may additionally create, edit, and pause monitors; an **Admin** may additionally delete monitors and manage recipients. blocks-os super-permissions still apply. *(**Gap:** access is currently governed by the `blocks-os` IAM resource; the dedicated resource and roles are not yet implemented. Role composition with blocks-os is still being finalized.)*

### FR-8 Keep-alive check (target)
- **Given** the built-in keep-alive check, **when** configured, **then** Monitor periodically pings one **user-configurable** URL and surfaces it as a product feature. *(**Gap:** URL is currently fixed and internal.)*

---

## 8. Out of Scope / Roadmap

**Out of scope for Blocks Monitor entirely (owned elsewhere):**
- **Logs, distributed tracing, and metrics** — owned by a separate telemetry/OS service, not Monitor. Monitor should link out to it. *(**Open/undecided:** the owning service's name.)*
- **AI-assisted diagnostics** — marketing copy only; not a Monitor feature.
- **Ownership of deployments and the service registry** — Monitor references deployed repos and "my services" but does not own them.
- **Public status page** — explicitly not a goal; the Blocks services view is signed-in transparency only.

**Roadmap (deferred beyond v1):**
- Genuine response-time / latency chart (per-check response times are recorded now).
- Additional check types: PING, TCP, DNS, KEYWORD (only HTTP runs in v1).
- Multi-region checks (`Regions` is captured but inert).
- SSL-certificate and domain-expiry reminders.
- Success-code list and expected-content/keyword matching influencing pass/fail (**open** which apply in v1).
- Per-monitor request timeout and authorization types (BASIC/BEARER/API_KEY) taking effect.
- Per-user control over in-app notification targeting.

---

## 9. Open Product Questions

- **Telemetry service name.** What is the canonical name of the separate service that owns logs/tracing/metrics, and what cross-navigation should Monitor link to?
- **Monitor role composition.** Exact Viewer/Editor/Admin permission matrix and how it composes with blocks-os super-permissions; v1 priority of the standalone `blocks-observability` IAM resource.
- **Email recipient cap value.** The precise fixed guardrail (the ~10–20 range is decided in principle; the 5-in-code value is stale).
- **Paused-time uptime accounting.** Confirm the exact treatment of paused windows in uptime % and the frozen "time since last incident" (decided in principle; verify implementation).
- **Pass/fail refinements.** Which of `SuccessHttpResponseCodes` and `ExpectedContent` should influence pass/fail in v1, if any (currently captured but inert).
- **v1 success metric.** The definition of success for the first release (e.g., faster outage detection, fewer missed incidents, replacing a third-party uptime tool, or driving wider Blocks-suite adoption) to prioritize the remaining gaps.
- **Embedding presentation.** Beyond attribution, how embedded monitoring in host services (currently only blocks-release) should be presented and supported.
