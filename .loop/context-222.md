# CONTEXT — #222 Repos page (list, latest build, SAST, SCA)

## Goal
Add Monitor sidebar "Repos" → list of deployed repos → details with Overview / SAST / SCA tabs.
API wraps `SeliseBlocks.ReleaseDriver.OS` 4.0.3 (`GetRepoDetailsAsync`, `GetReportsAsync`).
Port UI from blocks-release with metric/pagination fixes (do not copy bugs).

## Current state (SYNCED)
- Branch `inception` @ `132873e` (ancestor of origin/dev verified)
- ReleaseDriver pin today: **4.0.1** (spec said 4.0.2; bump target is **4.0.3**, on nuget.org)
- Genesis central pin: **4.2.2**; Api already lifts to 4.2.3 via ReleaseDriver; Worker stays 4.2.2
- Comment in Directory.Packages.props wrongly claims the Api/Worker Genesis split is gone — correct it
- Existing `GET /api/Monitor/repos-list` + `useGetReposList` stay unchanged; reuse for list page

## Server touch points
- `server/Directory.Packages.props` — bump ReleaseDriver 4.0.1→4.0.3; fix Genesis comment
- `server/Api/Controllers/MonitorController.cs` — inject `IConfiguration`; add `GetRepoDetails`, `GetReports` mirroring `GetReposList` shape + C16 config gate
- `server/XUnitTest/Api/MonitorControllerTests.cs` — CreateSut + new tests (routes, auth, C1–C5, C16, H1–H3)

## Client touch points
- Menu: insert `repos` (FolderGit2) after `monitor`
- Routes: `repos`, `repos/:repoId` under MonitorLayout
- Endpoints: `GET_REPO_DETAILS`, `GET_REPORTS` on ALERT_ENDPOINTS
- New: models/repos.model.ts, services/repos.service.ts, hooks/use-repos.ts
- Pages: pages/repos/index.tsx, pages/repos/details.tsx
- Components: module/repos/* (list, cards, sast-tab, sca-tab, sca-summary, sca-dependencies-table, sca-transform, report-states)
- Utils port: getDeploymentLogEventBadgeStyle/ClassName, formatElapsedTime, isLiveBuildStatus

## Reference (blocks-release)
- Driver: `Release.Driver` @ 4.0.3 (commit 89aa84e) — Message "Repository not found" on missing repo
- UI: `cross-modules/deployment/` sast-tab, sca-tab, repo-details, repo-cards, deployment-logs.utils
- Metric fixes (do NOT copy release bugs): use §3 keys only (security_rating, bugs, code_smells, sqale_rating, new_technical_debt, …); SCA filter once; page size 5

## Out of scope / E2E
- Ticket §7: **E2E explicitly skipped** — no new Playwright; verification = unit/integration + build/lint
- No View-in-Sonar/DT buttons; no SignalR; no build history; no DAST/sca-container

## Risks
- C16: missing SastToolsApiBaseUri / ScaToolsApiBaseUri → 500 ReportSourceNotConfigured (ops seeds keys)
- Driver NRE on unknown buildId → Map to 500 FailedToGetReport (C4)
- CreateSut must pass IConfiguration mock after ctor change
