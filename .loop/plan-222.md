# PLAN — #222

## Build order (A1)
1. Server: package bump + GetRepoDetails/GetReports + tests (H1–H3, C1–C5, C16)
2. Client wiring: menu, routes, endpoints, models, service, hooks + tests
3. List + Overview pages + tests (H4–H9, C6–C11)
4. SAST + SCA tabs + transform + tests (H10–H13, C12–C16)
5. Lint/build/test green; security scans; PR; preview; ZAP; quality gate; finish

## Server design
- Mirror GetReposList: `[Authorize]`, `~/api/Monitor/...`, try/catch with OperationCanceledException rethrow
- GetRepoDetails: validate repoId; call driver (repoId, branch, pageNumber=1, pageSize=1); 404 if Message=="Repository not found"; else 400/500 envelopes
- GetReports: validate buildId + SupportedReportTypes; C16 check config key; call GetReportsAsync; return driver response on success
- Public consts for all messages; ReportSourceConfigKeys + SupportedReportTypes as static members

## Client design
- Reuse useGetReposList for list; client-side search/sort/page (10)
- Details: pageSize=1; latestBuild=build[0]; tab via nuqs; lazy report fetch when tab active
- SAST: §3 key map only; missing → "—"; grades from 1.0–5.0
- SCA: transform once; severity filter toggle; search; page size 5; empty → "No entries"
- No AnalyticsTool / View-in-tool buttons

## Plan review (self)
- Matches all H1–H13 and C1–C16; no OOS items; E2E skipped per §7
- Does not break GetReposList or existing Monitor routes
- Coverage plan: server controller tests + listed client test files in §9
