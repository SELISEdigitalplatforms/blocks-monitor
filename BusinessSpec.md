# Blocks Monitor — Business Specification

> Status: authoritative business specification for the `blocks-monitor` repository. Terminology and product decisions follow the answered-ticket + product-owner decisions of record (see `Guides/DECISIONS-blocks-monitor`); where the current code differs from a decision, the decision is the target state and the gap is called out explicitly. Grounded in the actual `server/` and `client/` code as of this writing.

---

## 1. Overview

Blocks Monitor is the uptime and availability monitoring service of the SELISE Blocks platform. Within a project, a user registers monitors — the URL of a deployed service, an external endpoint, or a background job — and Blocks Monitor continuously verifies whether each one is healthy. It offers two complementary check styles: an **HTTP Check** (Blocks Monitor actively pings a target on a schedule and inspects the response) and a **Heartbeat** (Blocks Monitor issues a unique URL and expects the target to ping it on a schedule — a dead-man's-switch for jobs and services that have no reachable endpoint). When a check fails or an expected heartbeat stops arriving, Blocks Monitor opens an incident, flips the monitor to down, and delivers alerts by email and in-app notification; when the target recovers, the incident auto-resolves and a recovery alert goes out. The UI presents current up/down status, uptime percentages, an availability timeline, and a searchable incident history. In short, it answers: are my services up, for how long were they down, why, and who was told. v1 is uptime-only: logs, tracing, and metrics are explicitly out of scope and owned by a separate telemetry service.

## 2. Problem & Market Context

Teams building and running services on SELISE Blocks need to know — quickly and without standing up a third-party tool — when something they own stops responding. Deployed APIs fail, background workers silently die, and external dependencies go dark; without monitoring, the first signal is often a user complaint. The generic uptime-monitoring market (Pingdom, UptimeRobot, Better Uptime, Datadog Synthetics, healthchecks.io) proves the demand, but those tools sit outside the platform: they require separate accounts, separate billing, and manual wiring to know which service maps to which deployment. Blocks Monitor's opportunity is proximity — availability monitoring that lives inside the same project console as the services being watched, already authenticated, already aware of the project's deployed repositories, and reachable both for outbound HTTP checks and inbound heartbeats. Monitoring is not restricted to platform-deployed services; a user can monitor any third-party service, so the tool competes as a general-purpose uptime monitor for anyone already in the Blocks ecosystem.

## 3. Value Proposition & Positioning

**Positioning:** Blocks Monitor is the built-in uptime and incident-alerting layer for SELISE Blocks — availability monitoring where your services already live, with zero extra accounts and native awareness of your deployments.

Its value rests on:

- **In-platform convenience** — monitors are created and viewed inside the project console, authenticated through the platform, with no separate tool to provision.
- **Two check styles that cover both reachable and unreachable targets** — HTTP Checks for anything with a URL, Heartbeats for background jobs and workers that must instead check in.
- **Actionable alerting** — incidents open and resolve automatically, with email to a chosen recipient list and in-app notifications to the whole project team.
- **Deployment awareness** — a monitor can be linked to a deployed repository so status is tied to a known service, not just a bare URL.
- **No boundary on what you watch** — any third-party service is fair game, not only Blocks-deployed ones.

**What it is explicitly NOT (v1):**

- **Not an observability / APM suite.** It does not provide real-time logs, distributed tracing, usage metrics, or AI-assisted diagnostics. Those are owned by a separate telemetry/OS service. Any marketing copy or README text implying otherwise is inaccurate for v1 and is a known gap to correct.
- **Not a public status page.** The "Blocks services" view is incident transparency for signed-in tenants (with the ability to subscribe to platform incidents), not a public, unauthenticated status page.
- **Not a latency/performance analytics tool (yet).** v1 records per-check response times but does not ship a latency chart; the detail-page timeline shows availability (up/down), not response-time trends.
- **Not a synthetic-transaction or multi-step testing tool.** Single-target checks only.

## 4. Target Customers & Personas

Blocks Monitor is intended for all Blocks user types — developers, team leads, and businesspeople using the platform — and is not narrowed to a single segment. The decided optimization target, however, is the **Team lead** persona: the person responsible for a project's reliability. This drives v1 defaults — the default landing shows one project's monitors, and in-app notifications default to the whole team rather than a single individual.

- **Team lead (PRIMARY).** Owns a project's uptime. Creates and organizes monitors, sets email recipients for on-call, watches the project-level list and per-monitor detail, and reviews incident history for post-mortems. Defaults (broad team notifications, single-project landing) are tuned for this persona.
- **App developer.** Creates HTTP Check and Heartbeat monitors for their own deployed or external services, wires background jobs to the heartbeat URL, and investigates incidents. Also the persona who may embed Monitor's APIs into another Blocks service (see §6).
- **Businessperson / project stakeholder.** Consumes status and uptime for reassurance and reporting; not a heavy configurer.
- **Platform operator (secondary/implied).** Provides the seeded "Blocks services" monitors that tenants view read-only, and manages platform-level incident transparency. Seeding of those platform monitors happens outside this repo.
- **End-users of apps built on Blocks — not applicable.** They never see Blocks Monitor; they benefit only indirectly. The one "user-less" touchpoint is a monitored service programmatically calling its heartbeat URL — a machine, not a person.

## 5. Business Use Cases

- **Detect deployed-service outages fast.** Link monitors to deployed repositories and get email + in-app alerts the moment an endpoint starts failing, plus automatic recovery notices.
- **Watch background jobs and workers with no public URL.** Use a Heartbeat monitor so that if a scheduled job stops checking in, an incident is raised even though nothing is reachable to poll. Both Background Services and API services are expected to ping the heartbeat URL.
- **Monitor arbitrary third-party services.** Track any external endpoint the team depends on, not just Blocks-deployed services.
- **Report availability to stakeholders.** Per-monitor uptime percentages and downtime totals over rolling windows provide the raw material for informal uptime/SLA reporting.
- **Run post-incident reviews.** The incident history records when an outage started, how long it lasted, the failure reason, and the last status code.
- **Give tenants platform-incident transparency.** The read-only "Blocks services" view lets a customer distinguish their own problem from a platform problem and subscribe to platform incidents.
- **Embed monitoring inside another Blocks service.** Other services can host the same Monitor + Health API surface via the shipped driver package, presenting monitoring in their own product while attributing it to Blocks Monitor.

## 6. Where it fits in the SELISE Blocks platform

Everything in Blocks Monitor is scoped to a **project** (code uses `projectKey`, mapping to a tenant). It is one of five platform services and depends on the others:

- **blocks-os (central console / control-plane).** Blocks Monitor renders inside the same project console shell (layout, guards, login, project switcher come from the shared Blocks kit). Its in-app navigation section is currently labelled **Health**. Access is currently authorized under the **`blocks-os`** IAM resource; an explicit code comment (`server/Api/Program.cs`) states this will move to a dedicated `blocks-observability` resource once IAM provides it. **Boundary:** logs, tracing, and metrics — sometimes associated with this service's legacy "Observability" name — live on a separate telemetry/OS service, not inside Blocks Monitor.
- **blocks-iam (identity & access).** All monitor and health management endpoints require authentication via IAM (OIDC), with SSO/captcha config injected at runtime. The sole intentionally-open endpoint is the heartbeat receiver (`GET /api/Health/Ping/{itemId}`), left public by design because pings are expected from both Background Services and API services (see §9 on protecting the URL). Monitor's own roles (below) compose on top of IAM identity.
- **blocks-data (data gateway & storage).** Not a direct dependency of Monitor's core flows; Monitor persists its own configuration, ping logs, and incidents. (Relationship is peer-service, not consumer.)
- **blocks-localization.** No direct functional dependency; Monitor shares the platform shell but does not consume localization as a runtime service in its core flows.
- **Deployment / release side of the platform.** A monitor can be linked (`RepoId`/`RepoName`) to a project's deployed repository; the create form loads deployed repos and marks them. The decided direction is that **deployment-to-monitor creation is opt-in and off by default** — a deployment does not silently create a monitor.
- **Platform communication services.** Alerts are delivered two ways: in-app notifications are pushed through an external Notification service, and emails are sent via a configured SMTP mail server using stored templates (`AlertIncident`, `AlertResolved`).
- **Embedding / other Blocks services.** Blocks Monitor ships a driver package (`SeliseBlocks.ObservabilityDriver`, `server/Observability.Driver/`) exposing the Monitor + Health API surface as an injectable service, so other services can host these endpoints locally. Today, **only blocks-release embeds Blocks Monitor**, consuming a few APIs for display purposes. Embedded monitoring is **attributed** ("powered by Blocks Monitor").
- **Cross-service uniqueness.** No other Blocks product monitors uptime, so there is no functional overlap to disambiguate for the user on availability checking specifically.

## 7. Success Metrics / KPIs

**Open / undecided:** a formal success definition for v1 has not been fixed. Candidate KPIs consistent with the decided scope and the Team-lead focus:

- **Detection speed** — time from a target actually failing to an incident opening and an alert being delivered.
- **Alert reliability** — proportion of real outages that produce a delivered alert (email + in-app), and false-positive rate.
- **Adoption** — number of projects with at least one active monitor; monitors per active project (against the 10-per-project safeguard).
- **Engagement** — incident-history and detail-page views per active project (evidence the tool is used for post-incident review, not just alerting).
- **Heartbeat uptake** — share of monitors that are Heartbeats (a differentiator vs. plain URL pingers).
- **Suite pull-through** — whether Monitor drives usage of the wider Blocks platform (e.g. via the embedded/attributed experience in blocks-release).

## 8. Pricing, Packaging & Limits

- **10 monitors per project.** Enforced in validation (`SaveMonitorConfigurationRequestValidator`: "You cannot have more than 10 monitors for this project."). This is an **abuse/technical safeguard, not a pricing tier.**
- **Email alert recipients.** Recipients are user-chosen per monitor. The current UI cap is 5; the decided direction is to **raise this to a higher fixed guardrail (~10–20)**. **Gap:** current code/UI still reflects the lower cap; the raised guardrail is the target.
- **In-app notification audience.** Not a configurable limit — in-app notifications go to everyone with access to the project (no per-user in-app targeting).
- **Pricing & plans.** **Open / undecided.** No plan tiers, per-seat pricing, or paid limits are defined in the codebase, and the monitor cap is explicitly not a plan lever. Whether monitoring is bundled into the platform subscription or priced separately is not decided.

## 9. Scope & Non-Goals

### v1 scope (decided)

- **Uptime monitoring only** — HTTP Checks and Heartbeats, incidents, and alerting.
- **Two check types**, canonically named **HTTP Check** ("we ping you") and **Heartbeat** ("you ping us"). **Gap:** the code/UI currently uses "Request"/"Callback" (and backend enums `OutboundPing`/`InboundPing`); the target terminology is HTTP Check / Heartbeat, standardized everywhere.
- **Incident lifecycle** — one open incident per monitor at a time, opening on failure and resolving on recovery, with start/end time, duration, failure reason, and last status code.
- **Failure definition includes 4xx.** The current code opens an incident when a response status is `< 200` or `>= 400` (`MonitorIncidentService`), i.e. 4xx responses (401/403/404) now count as an outage. (This corrects earlier behavior that treated only `>= 500` as down.) Advanced pass/fail inputs captured on the form but **not yet applied** — success-code lists, expected-content/keyword matching, per-monitor request timeout, and regions — are roadmap, not v1 behavior.
- **Two-channel alerting** — email to a chosen recipient list; in-app notifications to the whole project team. This split is intentional.
- **Availability Timeline on the detail page.** The up/down timeline is the decided v1 view; per-check response times are recorded now. **Gap:** the section is currently labelled "Status Overview" in code and the component is still named `ResponseTime`; the decided label is **Availability Timeline** (or Status Timeline), and "Response time" as a label is retired.
- **Pause/resume and delete.** Paused monitors remain in the main list with a visible paused indication. Uptime should be measured over checked time only (**excluding paused time**), and "time since last incident" should freeze while paused. **Gap:** current uptime is computed as uptime / window-length-in-seconds and does not exclude paused time; the paused-exclusion behavior is the target.
- **Heartbeat onboarding.** v1 ships copyable setup snippets (cURL / cron) and docs next to the generated heartbeat URL. **Gap:** these snippets/docs are a target for v1; verify they are present in the form UI. The heartbeat URL stays open by design (pings from both Background and API services).
- **"Blocks services" view** — incident transparency for signed-in tenants plus subscribe-to-platform-incident.
- **Monitor-specific roles (decided target):** **Viewer** (read), **Editor** (create/edit/pause), **Admin** (delete + manage recipients). blocks-os super-permissions still apply above these. **Gap:** access is currently governed solely by blocks-os permissions under the `blocks-os` IAM resource; the distinct Monitor role set (and a `blocks-observability` resource) is the target and not yet implemented. The exact role composition with blocks-os is still being refined.
- **Embeddable API driver** — the driver package mirrors the Monitor + Health controllers for other services; embedded usage is attributed.

### Non-goals for v1 (roadmap or explicitly excluded)

- **Logs, distributed tracing, usage metrics, AI-assisted diagnostics** — owned by a separate telemetry/OS service; marketing/README copy claiming these must be corrected, and cross-navigation links to the telemetry service added.
- **A latency/response-time chart** — response times are recorded but the trend chart is roadmap.
- **Non-HTTP check types** (`PING`, `TCP`, `DNS`, `KEYWORD`) and **SSL/domain-expiry reminders** — captured in the model/form but not implemented; roadmap.
- **Multi-region checks, per-monitor request timeout enforcement, authorization-type handling, success-code/expected-content matching** — captured but not applied at runtime; roadmap.
- **Public status page** — explicitly not a goal for v1.
- **Automatic deployment-to-monitor creation on by default** — opt-in only.
- **Undo for monitor deletion** — deleting a monitor permanently destroys its incident history with no undo (decided, accepted).

## 10. Open Business Questions

- **Pricing & packaging** — is monitoring bundled into the platform subscription or priced/limited separately? No plan model exists today. (**Open / undecided.**)
- **Success metrics** — no formal v1 success definition or KPI targets have been set. (**Open / undecided**; see §7.)
- **Email recipient cap** — the exact raised guardrail (within ~10–20) is not finalized, and the code still reflects the old cap. (**Open / undecided.**)
- **Uptime accounting for paused time** — the decision (exclude paused time; freeze "time since last incident") is not yet reflected in code; the precise calculation window is still to be implemented and confirmed. (**Gap + partly open.**)
- **Monitor role composition** — the Viewer/Editor/Admin set is decided, but how these compose with blocks-os super-permissions and their v1 priority ordering is still undecided.
- **Telemetry service naming & cross-nav** — the separate service that owns logs/tracing/metrics is not yet named in-product, and the cross-navigation links from Monitor to it are not built. (**Open / undecided.**)
- **Heartbeat URL protection** — the URL is intentionally open; whether any lightweight protection (e.g. rotating token) is warranted long-term is not settled.
- **Embedding presentation & support** — beyond blocks-release's current display-only use, the fuller model for how embedded monitoring is presented and supported across host services is not fully defined.
