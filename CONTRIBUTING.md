# Contributing to Blocks Monitor

This document records the conventions a linter cannot fully check. The mechanically
enforceable rules live in [`.editorconfig`](.editorconfig) (C# naming, indentation),
[`server/Directory.Build.props`](server/Directory.Build.props) (`EnforceCodeStyleInBuild`),
and [`client/.eslintrc.cjs`](client/.eslintrc.cjs) (TypeScript/React lint + naming).

Rules start at the conventions already true in the codebase so the build stays green;
tighten them over time rather than landing a large violating change at once.

## Product vocabulary

- The product is **Blocks Monitor** (short: **Monitor**). **"Observability" is retired** — do
  not introduce it in new code, comments, or copy. The one remaining externally-breaking use is
  the published NuGet `PackageId` (`SeliseBlocks.ObservabilityDriver`), which needs a separate
  deprecation window before it can be renamed.
- Each check type has exactly one user-facing name:
  - **HTTP Check** — "we ping you" (domain enum `OutboundPing`, `MonitorConfigurationType = request`).
  - **Heartbeat** — "you ping us" (domain enum `InboundPing`, `MonitorConfigurationType = callback`).
  - "Health" refers only to the in-app status section, never to a check type.

## HTTP API

- Controllers use attribute routing `[Route("[controller]/[action]")]`; the global `/api`
  prefix comes from the shared Blocks.Genesis host configuration
  (`ApplicationConfigurations.ConfigureApi`), not from a per-repo convention class.
- Use the verb attribute that matches the effect: `[HttpGet]` (read), `[HttpPost]` (create),
  `[HttpPut]` (update), `[HttpDelete]` (delete). Do not tunnel mutations through GET.
- Query-parameter and route names are camelCase (e.g. `projectKey`, `monitorSourceType`,
  `itemId`). When a wire name has to change, add the corrected name and keep the old one
  accepted for backward compatibility (see `GetMonitorList`, which accepts both
  `monitorSourceType` and the legacy `monitorSourcetype`).

## Response envelope

- Actions return `Ok(result)` where `result` is a `BaseApiResponse` (or a subclass such as
  `PaginatedResponse` / `MonitorDetailsResponse`). Do not hand-build anonymous shapes.
- `BaseApiResponse` carries `IsSuccess`, `StatusCode`, and `Message`. Failures that are handled
  in the domain layer are returned as `IsSuccess = false` with an appropriate `StatusCode`.

## DTO / model suffixes

- Inbound request bodies: `*Request` (e.g. `SaveMonitorConfigurationRequest`).
- Outbound payloads: `*Response` (e.g. `MonitorDateRangeSummaryResponse`).
- Do not introduce new `*Dto` types; the legacy `MonitorDateRangeSummaryDto` is kept only as an
  `[Obsolete]` alias.

## Permission scopes and roles

- Authorization currently resolves against the shared **`blocks-os`** IAM resource. The dedicated
  resource must be **`blocks-monitor`** (the product name) — **not** `blocks-observability`. Only
  switch the resource name in `server/Api/Program.cs` once that resource and its scopes have been
  seeded and granted in IAM, otherwise every tenant loses access on deploy.
- Scope grammar is three colon-separated segments: `resource::subject::action`
  (for example `blocks-monitor::monitor::gets`).
- Monitor v1 roles: **Viewer** (read), **Editor** (create / edit / pause),
  **Admin** (delete + manage recipients). blocks-os super-permissions still apply on top.
- Never silently change an existing scope string in a way that would revoke access; add the new
  scope alongside the old one and coordinate the IAM seed/grant.

## C# conventions

- Interfaces are `I`-prefixed PascalCase; types and members are PascalCase; parameters and locals
  are camelCase. `IDE1006` reports violations at build (warning severity).
- `Task`-returning methods carry the `Async` suffix.
- Register services against interfaces where practical (interface-first DI).

## TypeScript / React conventions

- Filenames are kebab-case. React hooks are `use-*.ts`; services are `*.service.ts`;
  constants are `*.constant.ts`; utilities are `*.util.ts`.
- Components and types are PascalCase; variables and functions are camelCase; enum members follow
  the surrounding file. Object/property names that mirror server wire fields are exempt from the
  naming rule.
