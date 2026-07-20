# Blocks Monitor

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
│  ├─ .env
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
│  ├─ Blocks.slnx
│  ├─ Directory.Build.props
│  └─ Directory.Packages.props
├─ Dockerfile
├─ Dockerfile.worker
├─ LOCAL_GUIDE.md
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

Frontend dev server and backend API serve HTTPS on `dev-monitor.blocksdevelopers.com` when the machine env vars `MONITOR_SSL_CERT` and `MONITOR_SSL_KEY` (mkcert PEM cert + key paths) are both set and both files exist; otherwise they fall back to HTTP (no crash). No cert path is committed, and the deployed Docker artifact is unaffected. One-time setup (mkcert, hosts entry, env vars, behavior matrix): see [LOCAL_GUIDE.md](LOCAL_GUIDE.md#local-https-frontend--backend).

## Client environment

The repo includes [client/.env](client/.env) for local development. Vite only exposes variables with the BLOCKS\_ prefix (see [client/vite.config.ts](client/vite.config.ts)). In production, the API replaces tokens in built assets and injects them into window.**BLOCKS_ENV** (see [server/Api/Program.cs](server/Api/Program.cs) and [client/index.html](client/index.html)).

Variables used by the client (via [client/app/lib/runtime-env.ts](client/app/lib/runtime-env.ts)):

- BLOCKS_IAM_BASE_URL: IAM base URL for auth flows
- BLOCKS_MONITOR_BASE_URL: monitor base URL used for API calls
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

## API / routing

- Controllers live in [server/Api/Controllers](server/Api/Controllers).
- A global route prefix of api is applied by the shared Blocks.Genesis host configuration (ApplicationConfigurations.ConfigureApi in [server/Api/Program.cs](server/Api/Program.cs)), so controller routes like [Route("[controller]/[action]")] become /api/{Controller}/{Action}.
- The API serves the SPA from wwwroot using UseDefaultFiles, UseStaticFiles, and MapFallbackToFile("/index.html") (see [server/Api/Program.cs](server/Api/Program.cs)).
- Launch profiles are defined in [server/Api/Properties/launchSettings.json](server/Api/Properties/launchSettings.json) and [server/Worker/Properties/launchSettings.json](server/Worker/Properties/launchSettings.json). The URLs there may differ from the run scripts.

## License

See [LICENSE](LICENSE).
