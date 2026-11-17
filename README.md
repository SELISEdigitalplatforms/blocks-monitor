# Blocks MADP shell

Selecting a project in the Blocks console opens its MADP workflow inside the existing Blocks sidebar and header. Blocks owns sign-in, project selection, environments, and repository connections. The retained .NET backend supplies runtime configuration, validates the Blocks session, and forwards authenticated requests to the internal MADP workflow service.

MADP is built separately in `madp/` to preserve React 18 / Tailwind 3 alongside the shell's React 19 / Tailwind 4. Both frontends are served from the shell's origin. The internal Node service does not provide another login and does not start an engine worker.

## Local startup

Follow the existing Windows environment guide in `doc/BLOCKS_OS_APP_SETUP.md`: the `blocks-server` VPN profile, Azure development vault access, trusted local HTTPS certificate, and hosts entry must already be available. Use Node 24 and .NET 10.

```powershell
npm.cmd --prefix client install
npm.cmd --prefix madp ci
# Use the existing private factory environment, or configure madp/.env.local from madp/.env.example.
node scripts/run-madp-shell.mjs --factory-env '<existing MADP frontend>/.env.local' --check
node scripts/run-madp-shell.mjs --factory-env '<existing MADP frontend>/.env.local'
```

The launcher checks ports 4001, 5001, and 5311, builds MADP, and starts Vite, the development .NET API, and the internal Node service. It shares configured server keys or generates temporary keys in process memory. It does not copy private credentials into this repository or start another owner engine. Stop it with Ctrl+C. Existing processes on those ports must be identified before restarting them.

Open **https://dev-monitor.blocksdevelopers.com:4001**. Sign in through Blocks and select a project. MADP uses that verified identity and selected tenant; there is no additional workspace login or browser-local project association picker. The first visit creates workflow metadata idempotently, or resolves an existing `Project.BlocksProjectRef` association, without provisioning a new Blocks tenant.

The project repository window retains MADP's new-product/existing-product choice before analysis begins. The server requires edit permission and rejects changes after handover or while project jobs are active. Expired API sessions refresh through the parent Blocks SDK and retry once with the original request body; no bearer tokens cross the iframe boundary.

## Service configuration

| Component | Setting | Purpose |
| --- | --- | --- |
| Vite | `BLOCKS_MADP_GATEWAY_URL` | .NET gateway, normally `http://localhost:5001`; never the Node origin |
| .NET | `Madp__ApiBaseUrl` | Internal Node origin, normally `http://127.0.0.1:5311`; remote targets require HTTPS |
| .NET | `Madp__PublicOrigin` | Exact browser origin, including the local port |
| .NET / Node | `Madp__BridgeKey` / `MF_BLOCKS_SHELL_KEY` | Same server-only random key of at least 32 bytes |
| Node | `MF_BLOCKS_SHELL_ENABLED=1` | Require the authenticated Blocks bridge |
| Node | `MF_APP_ORIGIN`, `MF_INTERNAL_HOST` | Internal expected origin and optional private ingress Host |
| Node | `MF_BLOCKS_TENANT`, `MF_SVC_CLIENT_ID`, `MF_SVC_CLIENT_SECRET`, `VITE_BLOCKS_API_URL` | Existing factory Data Gateway and service identity |
| Node | `MF_BLOCKS_SHELL_WRITE_PERMISSIONS` | Comma-separated exact verified Blocks grants mapped to workflow write access |

An authenticated project context grants project view access. Write access requires explicit MADP grants or a deployment-configured exact permission mapping. The local template maps `blocks-monitor::monitor::write` to workflow write access; generic admin/owner role names and impersonation do not grant MADP administrator rights. Blocks remains responsible for tenancy, people, roles, and project deletion.

The factory tenant must already contain MADP's schemas, policies, validations, and unique RequestKey indexes in `madp/blocks/data/`. The application does not push schema changes or grant cloud permissions on startup. Conflicting preexisting project mappings are rejected rather than silently reassigned.

Every internal request binds the authenticated caller, tenant, HTTP method, path/query, and body hash in a short-lived signed assertion. Node rejects forged, expired, replayed, or cross-project requests. Browser cookies and tokens never reach the Node service. Project-scoped data reads and workflow mutations remain confined to the selected project.

## Repository and engine integration

The internal broker at `/internal/madp/repositories` uses Blocks' registered repository services. It checks that the repository is connected and active, that the requesting user is still in the project, and that the selected branch exists. It resolves the connection owner from Blocks, then uses the supported `GetPushCredential` operation. Browser requests, unsigned calls, expired requests, and reused nonces are rejected.

Set .NET `Madp__RepositoryKey` and Node/worker `MF_BLOCKS_REPOSITORY_KEY` to the same **separate** server-only key of at least 32 bytes. Set `MF_BLOCKS_REPOSITORY_URL` to the full broker URL, for example `https://<blocks-shell>/internal/madp/repositories`. HTTP is allowed only for loopback development calls. The launcher configures a local callback automatically.

The MADP API uses the broker to verify repository selections. The updated worker obtains credentials at execution time for clone/push/CLI operations and passes them in child-process environment variables, never command arguments, repository URLs, project records, or browser responses. Output is redacted before it is logged. The persisted project association contains the Blocks tenant reference, not a credential.

The existing shared engine must receive the updated adapter code and matching persistent broker configuration before it can execute these jobs. A temporary launcher key is suitable for local service checks; use deployment-managed keys when connecting the shared engine. This repository does not automatically replace or restart that engine, provision GitHub access, or launch a competing worker.

## Builds and deployment

`npm.cmd --prefix client run build` builds and packages both frontends into `server/Api/wwwroot`. After editing MADP alone, run `npm.cmd --prefix client run build:madp` and reload its view. `npm.cmd --prefix madp run build:server` checks and bundles the internal workflow API.

The existing `Dockerfile` builds the public .NET shell; `Dockerfile.madp` builds the internal Node service. Supply service credentials and bridge keys through deployment secrets. Keep the Node listener private, use HTTPS between hosts, and configure its expected internal Host. Deploy updated worker adapters to the existing approved engine host; do not run a competing worker against the same job queue.

## Retained Monitor services

Blocks Monitor is a monorepo with an ASP.NET Core API, a background Worker, and a React + Vite SPA. In production, the API serves the built SPA from wwwroot and provides the HTTP endpoints; in development, the SPA runs on the Vite dev server and proxies to the API.

## Project structure

```
.
├─ client/
│  ├─ app/
│  │  ├─ components/
│  │  ├─ pages/
│  │  ├─ routes/
│  │  ├─ main.tsx
│  │  └─ router.tsx
│  ├─ public/
│  ├─ .env.example
│  ├─ index.html
│  ├─ package.json
│  └─ vite.config.ts
├─ server/
│  ├─ Api/
│  │  ├─ Api.csproj
│  │  ├─ Controllers/
│  │  ├─ Program.cs
│  │  ├─ Properties/launchSettings.json
│  │  └─ wwwroot/
│  ├─ Worker/
│  │  ├─ Worker.csproj
│  │  └─ Properties/launchSettings.json
│  ├─ Alert.DomainService/
│  ├─ Authentication.DomainService/
│  ├─ Cloud.DomainService/
│  ├─ CloudConfiguration.DomainService/
│  ├─ Iam.DomainService/
│  ├─ Mfa.DomainService/
│  ├─ XUnitTest/
│  ├─ Blocks.slnx
│  ├─ Directory.Build.props
│  └─ Directory.Packages.props
├─ e2e/
├─ scripts/
├─ Dockerfile
├─ Dockerfile.worker
├─ run.sh
├─ run.ps1
└─ LICENSE
```

## Prerequisites

- .NET SDK 10.0 (TargetFramework is net10.0 in [server/Directory.Build.props](server/Directory.Build.props))
- Node.js (Docker build uses node:22-alpine in [Dockerfile](Dockerfile); use 22.x for parity)
- npm (ships with Node)

## How to run

### Options (shared where applicable)

| Flag                | run.sh (macOS/Linux)            | run.ps1 (Windows)               | Notes                                                                                       |
| ------------------- | ------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------- |
| -a, --all           | build SPA then run API + Worker | build SPA then run API + Worker | run.ps1 starts API/Worker in new PowerShell windows and waits for Enter to stop them        |
| -b, --backend       | run API                         | run API                         | run.ps1 restores .NET dependencies first                                                    |
| -w, --worker        | run Worker                      | run Worker                      | run.ps1 restores .NET dependencies first                                                    |
| -f, --frontend      | run Vite dev server             | run Vite dev server             | run.sh uses npm clean-install only if node_modules missing; run.ps1 always runs npm install |
| -k, --kill-port     | kill process on API port 5001   | kill process on API port 5001   | run.sh uses lsof or netstat; run.ps1 uses netstat/taskkill                                  |
| -n, --npm <args>    | run npm in client/              | run npm in client/              | examples: -n install, -n run build                                                          |
| -d, --dotnet <args> | run dotnet command              | run dotnet command              | examples: -d restore, -d build                                                              |
| -h, --help          | show help                       | show help                       |                                                                                             |

### Unix (run.sh)

```bash
./run.sh -a          # build SPA + run API + Worker
./run.sh -b          # run API only (port 5001)
./run.sh -w          # run Worker only
./run.sh -f          # run Vite dev server (port 4001)
./run.sh -n install  # npm install in client/
./run.sh -k          # kill process on port 5001
```

If you see permission denied, make the script executable:

```bash
chmod +x run.sh
```

### Windows (run.ps1)

```powershell
.\run.ps1 -a
.\run.ps1 -b
.\run.ps1 -w
.\run.ps1 -f
.\run.ps1 -n install
.\run.ps1 -d restore
```

If PowerShell blocks scripts, run once:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## Without the scripts

### Backend

```bash
dotnet restore server/Api/Api.csproj
dotnet restore server/Worker/Worker.csproj
dotnet run --project server/Api/Api.csproj
dotnet run --project server/Worker/Worker.csproj
```

### Frontend

```bash
npm --prefix client install
npm --prefix client run dev   # port 4001 (script overrides Vite config)
```

Use npm run local if you want Vite's default port from [client/vite.config.ts](client/vite.config.ts) (4001).

## Local HTTPS

Frontend dev server and backend API serve HTTPS on `dev-monitor.blocksdevelopers.com` when the machine env vars `MONITOR_SSL_CERT` and `MONITOR_SSL_KEY` (mkcert PEM cert + key paths) are both set and both files exist; otherwise they fall back to HTTP (no crash). No cert path is committed, and the deployed Docker artifact is unaffected. One-time setup: generate a certificate for the named host with mkcert, add a hosts entry pointing it at `127.0.0.1`, and set the two environment variables to the cert and key paths.

## Client environment

Copy [client/.env.example](client/.env.example) to `client/.env` for local development (`.env` itself is gitignored). Vite only exposes variables with the BLOCKS\_ prefix (see [client/vite.config.ts](client/vite.config.ts)). In production, the API replaces tokens in built assets and injects them into window.**BLOCKS_ENV** (see [server/Api/Program.cs](server/Api/Program.cs) and [client/index.html](client/index.html)).

Variables used by the client (via [client/app/lib/runtime-env.ts](client/app/lib/runtime-env.ts)):

- BLOCKS_IAM_BASE_URL: IAM base URL for auth flows
- BLOCKS_MONITOR_BASE_URL: external Monitor API target for the local Vite proxy; the browser uses its page origin for Monitor API calls
- BLOCKS_LOGIC_BASE_URL: logic base URL for service registry calls
- BLOCKS_X_BLOCKS_KEY: project key sent as X-Blocks-Key
- BLOCKS_GOOGLE_SITE_KEY: captcha site key used on login
- BLOCKS_CONSTRUCT_URL: construct site URL linked from the UI
- BLOCKS_GITHUB_SSO_CLIENT_ID: GitHub SSO client id
- BLOCKS_BASE_DOMAIN: base domain for Blocks apps
- BLOCKS_*_CALLBACK_URL: per-app login callback URLs

## Production / publish

### Build SPA and publish API

```bash
npm --prefix client run build
dotnet publish server/Api/Api.csproj -c Release -o ./publish/api
```

The Vite build writes directly to [server/Api/wwwroot](server/Api/wwwroot) (see [client/vite.config.ts](client/vite.config.ts)). The API serves these static files at runtime.

### Publish Worker

```bash
dotnet publish server/Worker/Worker.csproj -c Release -o ./publish/worker
```

### Docker images

```bash
docker build -t blocks-monitor-api .
docker build -f Dockerfile.worker -t blocks-monitor-worker .
```

## Tests

Run from the repository root. There is no `.sln`; target the test project directly.

```bash
# backend unit tests (xUnit)
dotnet test server/XUnitTest/XUnitTest.csproj

# frontend unit tests (Vitest)
npm --prefix client run test

# end-to-end tests (Playwright); needs a reachable app and e2e/.env.e2e,
# see e2e/README.md for setup and target modes
npm --prefix e2e run test
```

Coverage:

```bash
dotnet test server/XUnitTest/XUnitTest.csproj --collect:"XPlat Code Coverage"
npm --prefix client run test -- --coverage
```

## Scanning and deployment

- `scripts/scan.sh` is the security scan entry point (SAST, SCA and secret scanning). It is intentionally not tracked in git; internal environments provide it.
- `scripts/deploy.sh` is the maintainer deploy script for a systemd host: it checks out the latest `inception`, builds the client, publishes the Api and Worker projects, and installs and restarts their systemd services.
- `scripts/monitor/` holds one-off data-migration scripts for monitor configurations, in bash and mongosh variants.

## API / routing

- Controllers live in [server/Api/Controllers](server/Api/Controllers).
- A global route prefix of api is applied by the shared Blocks.Genesis host configuration (ApplicationConfigurations.ConfigureApi in [server/Api/Program.cs](server/Api/Program.cs)), so controller routes like [Route("[controller]/[action]")] become /api/{Controller}/{Action}.
- The API serves the SPA from wwwroot using UseDefaultFiles, UseStaticFiles, and MapFallbackToFile("/index.html") (see [server/Api/Program.cs](server/Api/Program.cs)).
- Launch profiles are defined in [server/Api/Properties/launchSettings.json](server/Api/Properties/launchSettings.json) and [server/Worker/Properties/launchSettings.json](server/Worker/Properties/launchSettings.json). The URLs there may differ from the run scripts.

## Contributing and security

- Contribution conventions and workflow: [CONTRIBUTING.md](CONTRIBUTING.md)
- Reporting a vulnerability: [SECURITY.md](SECURITY.md)
- Community standards: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)

## Database placement diagnostics (Genesis 4.2.2)

API and Worker use the published Genesis 4.2.2 package. Monitoring configurations, incidents, ping logs, health records and alert data stay in the configured main/root database. Tenant placement does not relocate monitoring collections.

The API exposes `GET /health/databases` as a separate infrastructure diagnostic. It runs read-only MongoDB pings for `main`, `dev` and `other` in parallel, with a three-second timeout per configured group. Responses contain only group status, never connection strings, hostnames or driver errors:

```json
{"isHealthy":false,"placements":{"main":"healthy","dev":"unhealthy","other":"healthy"}}
```

A configured group failure returns HTTP 503; healthy configured groups return 200. Missing optional dev/other connections are `not_configured`; missing main is unhealthy. Main uses `DatabaseConnectionString`; the optional probes use `DevDatabaseConnectionString` and `OtherDatabaseConnectionString`. Azure vault names match these properties. On-premises keys are `BlocksSecret__DevDatabaseConnectionString` and `BlocksSecret__OtherDatabaseConnectionString`.

Configure these secrets only on hosts that directly probe the clusters, and restart after changing startup secrets. Configure infrastructure monitoring to call this endpoint and alert using its group labels. This endpoint is deliberately separate from Genesis's shared `/ping` and readiness checks: a dev outage must not evict a backend still serving main. A blank optional group does not independently probe tenants that fell back to main.

Tests cover main/dev/other outcomes, timeout/cancellation, absent optional secrets, safe failure responses, and main/root monitoring writes. Run `dotnet test server/XUnitTest/XUnitTest.csproj -c Release`. Actual deployed network access, credentials and alert ingestion still require deployment validation. Main/root failure still affects centralized monitoring and tenant discovery.

Scheduler configuration reads from main/root distinguish an empty result from a failed read. If a poll fails, the worker logs the failure and keeps its last known outbound and heartbeat schedules; a later successful empty result removes them. An initial read failure still prevents the worker from starting, so deployment health and root connectivity must be checked.

## License

See [LICENSE](LICENSE).
