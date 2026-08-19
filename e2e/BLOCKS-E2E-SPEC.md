# Blocks E2E Testing — General Integration Spec

This document describes a **reusable Playwright pattern** for SELISE Blocks micro-apps
(Monitor, and others). Blocks Monitor is the reference implementation in this repo.

Use this spec when adding E2E tests to another Blocks project so teams follow the same
architecture, lifecycle, and conventions.

---

## 1. Goals

| Goal | Why |
|------|-----|
| **One shared project per run** | Avoid console slot exhaustion; tests stay fast and isolated from each other at the *feature* level, not the *project* level. |
| **App host for tests, OS host for project delete** | Feature UIs live on the app host (`dev-monitor`, `dev-{app}`, …). Project deletion lives only on Blocks OS. |
| **Setup → Features → Teardown** | Playwright project dependencies guarantee order and skip downstream work when setup fails. |
| **Fail-safe cleanup** | Delete the shared project only when **every** feature test passed; otherwise leave it for debugging. |
| **Ordered feature runs** | Run features sequentially via a config file; stop on first failure. |

---

## 2. Architecture

### 2.1 Two hosts

Blocks apps share a **console + project** model but run on different origins:

```
┌─────────────────────┐         ┌─────────────────────┐
│   App host          │         │   Blocks OS host    │
│   (under test)      │         │   (lifecycle only)  │
├─────────────────────┤         ├─────────────────────┤
│ dev-monitor…        │         │ dev-os…             │
│ dev-{your-app}…     │         │                     │
│                     │         │                     │
│ • Login / OIDC      │         │ • Console           │
│ • Console           │         │ • Project dashboard │
│ • Project dashboard │         │ • Delete project    │
│ • Feature UI        │         │   (red button)      │
│   (Monitor, etc.)   │         │                     │
└─────────────────────┘         └─────────────────────┘
```

**Rule:** All feature tests run on the **app host**. Project **create/reuse** happens on the app host console. Project **delete** always goes through **OS**: console → project card → dashboard → Delete → confirm.

OS base URL derivation (when not explicit):

```
E2E_OS_BASE_URL defaults from E2E_BASE_URL:
  dev-monitor.blocksdevelopers.com → dev-os.blocksdevelopers.com
  dev-{app}.…                      → dev-os.…   (set E2E_OS_BASE_URL if pattern differs)
```

### 2.2 Three Playwright projects

```
monitor-setup          monitor (features)          monitor-teardown
     │                        │                           │
     │  login + session       │  reuse fixture            │  delete on OS
     │  reuse/create project  │  open feature area        │  if all passed
     │  seed test data        │  run specs                │  clear fixtures
     │  write fixture         │                           │
     └──────────dependencies: monitor-setup ──────────────┘
                              dependencies: monitor
```

| Playwright project | Spec file pattern | Depends on | Purpose |
|--------------------|-------------------|------------|---------|
| `{app}-setup` | `*.setup.spec.ts` | — | Login, shared project, seed data, persist fixture + session |
| `{app}` | `*.spec.ts` (exclude setup/teardown) | setup | Feature tests |
| `{app}-teardown` | `*.teardown.spec.ts` | features | Conditional project delete on OS |

**Config requirements:**

- `workers: 1` — shared project is not safe with parallel workers.
- `fullyParallel: false` — same reason.
- `storageState` from setup session for feature + teardown projects.
- Feature project `dependencies: ["{app}-setup"]`; teardown `dependencies: ["{app}"]`.

### 2.3 Run lifecycle

```
START
  │
  ├─► SETUP
  │     • reset run-outcome tracker
  │     • OIDC login → save storageState (fixtures/{app}-session.json)
  │     • reuseOrCreateSharedProject() on app console
  │     • navigate to feature area (e.g. Monitor link)
  │     • seed minimum test data if list would be empty
  │     • write fixture (fixtures/{app}-project.json)
  │
  ├─► FEATURES (ordered)
  │     • each spec: beforeEach → open feature via fixture URL
  │     • CRUD / assertions on app host only
  │     • on failure → markMonitorTestFailed() (via shared test base)
  │
  └─► TEARDOWN
        • read fixture; if missing → no-op
        • if shouldDeleteSharedProject() → OS console → dashboard → Delete
        • else → log "keeping project for inspection"
        • clear fixture + session files
END
```

---

## 3. Directory layout (template)

Copy this structure into `{your-repo}/e2e/`:

```
e2e/
├── BLOCKS-E2E-SPEC.md          # this document
├── README.md                     # project-specific quick start
├── .env.e2e.example              # env template (gitignored copy: .env.e2e)
├── features.mjs                  # ordered feature list + enable flags
├── run-e2e.mjs                   # sequential feature runner
├── playwright.config.ts          # 3-project config
├── global-setup.ts               # optional: patch local SPA base URL
├── package.json
│
├── tests/{app}/
│   ├── {app}.setup.spec.ts       # login + project + seed
│   ├── {app}.teardown.spec.ts    # OS delete when all passed
│   └── {feature}-*.spec.ts       # one file per feature area
│
├── support/
│   ├── env.ts                    # E2E_BASE_URL, E2E_OS_BASE_URL, credentials
│   ├── login-helper.ts           # OIDC / dev-iam flow
│   ├── test-base.ts              # extended test + failure tracking + pause
│   ├── run-outcome.ts            # pass/fail → delete or keep project
│   ├── {app}-project.ts          # read/write fixture + session paths
│   ├── create-and-delete-project.ts  # console nav, create, OS delete
│   └── {app}-helpers.ts          # open feature, seed data, row actions
│
└── fixtures/                     # gitignored runtime artifacts
    ├── {app}-session.json        # Playwright storageState from setup
    ├── {app}-project.json        # projectName, itemId, dashboardUrl, featureUrl
    └── run-outcome.json          # written on first feature failure
```

**Reference implementation:** `blocks-monitor/e2e/` — replace `{app}` with `monitor` throughout.

---

## 4. Contracts (implement these for your app)

### 4.1 Environment (`support/env.ts`)

| Variable | Required | Description |
|----------|----------|-------------|
| `E2E_BASE_URL` | yes | App host under test (no trailing slash). |
| `E2E_USERNAME` | yes | Dev-IAM test account email. |
| `E2E_PASSWORD` | yes | Dev-IAM test account password. |
| `E2E_OS_BASE_URL` | conditional | OS host for delete. Derive from `E2E_BASE_URL` or set explicitly. |
| `E2E_NO_WEBSERVER` | no | `1` = do not auto-start local server (remote dev). |
| `E2E_REUSE_PROJECT_NAME` | no | Reuse named project instead of creating `Test Project *`. |
| `E2E_PROJECT_ID` | no | Open project by UUID (`/app/{id}/…`) — skips console card search. |
| `E2E_KEEP_PROJECT` | no | `1` = never delete after run (also kept on any failure). |
| `E2E_FEATURES` | no | Comma-separated feature ids or `all` for `npm run test:features`. |
| `E2E_PAUSE_MS` | no | Hold browser after each test (headed debugging). |
| `E2E_SLOWMO` | no | Slow motion ms per Playwright action. |

Export at minimum:

```typescript
e2eBaseUrl(): string
e2eOsBaseUrl(): string
e2eCredentials(): { email: string; password: string }
e2eProjectId(): string | undefined   // optional
```

### 4.2 Project fixture (`support/{app}-project.ts`)

Persisted JSON shape:

```typescript
type AppProjectFixture = {
  projectName: string
  itemId: string              // UUID from /app/{itemId}/dashboard
  dashboardUrl: string        // app-host dashboard URL
  featureUrl: string          // deep link to feature entry (e.g. …/monitor)
}
```

Functions:

- `read{App}Project(): AppProjectFixture | null`
- `write{App}Project(fixture)`
- `clear{App}Project()`
- `{APP}_SESSION_PATH` + `clear{App}Session()`

### 4.3 Run outcome (`support/run-outcome.ts`)

```typescript
resetRunOutcome()              // call at start of setup
mark{App}TestFailed()          // call from test-base on feature failure
shouldDeleteSharedProject(): boolean
  // false if E2E_KEEP_PROJECT=1
  // false if run-outcome.json exists (failure persisted across processes)
  // false if in-memory failure flag set
  // true otherwise
```

The shared `test-base.ts` auto fixture marks failures for the **feature** Playwright project only.

### 4.4 Console navigation (`support/create-and-delete-project.ts`)

Shared primitives (reuse across Blocks apps):

| Function | Host | Behavior |
|----------|------|----------|
| `ensureConsole(page, "monitor" \| "os")` | both | `/app/console` + wait for projects heading |
| `namedProjectCard(page, projectName)` | both | Card with project name + env button |
| `reuseOrCreateSharedProject(page)` | app | Priority: `E2E_PROJECT_ID` → `E2E_REUSE_PROJECT_NAME` → last orphan `Test Project *` → create new |
| `deleteCreatedProject(page, projectName)` | OS | **console → card → dashboard → Delete → confirm** |

**OS delete flow (mandatory — do not shortcut via direct URL):**

```
1. page.goto(E2E_OS_BASE_URL + "/app/console")
2. ensureAuthenticatedOnCurrentOrigin(page)
3. find project card by name → click env button (Development, etc.)
4. waitForOsDashboardReady: heading = projectName + Delete button visible
5. click Delete → confirm dialog → click Delete
6. expect "Successfully deleted" + URL back on /app/console
```

**Monitor dashboard vs OS dashboard:**

| Host | Ready signal |
|------|--------------|
| App (Monitor) | `Project Details` heading or `X-Blocks-Key` text |
| OS | Project name heading + red **Delete** button |

### 4.5 Login (`support/login-helper.ts`)

Standard dev flow:

1. `goto(E2E_BASE_URL/login)`
2. Click **Log in to your account** if present
3. Fill OIDC email/password (`#oidc-email` / Work Email, `#oidc-password` / Password)
4. Submit → wait for console heading: `Your Blocks Projects` or `Welcome to SELISE Blocks`
5. `ensureAuthenticated(page)` — re-auth if session expired mid-run

Save `storageState` after successful setup login.

### 4.6 Feature helpers (`support/{app}-helpers.ts`)

App-specific. Minimum for Monitor-style apps:

```typescript
openFeature(page)        // goto fixture.featureUrl; verify feature heading
ensureSeedData(page)       // create one row if empty (setup + beforeEach safety)
waitForRowsLoaded(page)    // wait for table / skeleton gone
```

Feature specs should **never** create or delete projects — only entities inside the shared project.

---

## 5. Playwright config snippet

```typescript
projects: [
  {
    name: "{app}-setup",
    testMatch: /{app}\.setup\.spec\.ts/,
  },
  {
    name: "{app}",
    testMatch: /.*\.spec\.ts/,
    testIgnore: /{app}\.(setup|teardown)\.spec\.ts/,
    dependencies: ["{app}-setup"],
    use: {
      storageState: "fixtures/{app}-session.json", // if file exists
    },
  },
  {
    name: "{app}-teardown",
    testMatch: /{app}\.teardown\.spec\.ts/,
    dependencies: ["{app}"],
    use: {
      storageState: "fixtures/{app}-session.json",
    },
  },
],
workers: 1,
fullyParallel: false,
timeout: 120_000,
```

Optional `webServer`: auto-run `{repo}/run.sh -b` when `E2E_NO_WEBSERVER !== "1"`.

---

## 6. Feature list & sequential runner

### 6.1 `features.mjs`

```javascript
export const {APP}_FEATURES = [
  { id: "pause-resume", name: "…", enabled: true, spec: "tests/monitor/monitor-pause-resume.spec.ts" },
  { id: "delete",       name: "…", enabled: true, spec: "tests/monitor/monitor-delete.spec.ts" },
]

export function resolveEnabledFeatures() {
  // E2E_FEATURES=all → filter enabled: true
  // E2E_FEATURES=id1,id2 → resolve in that order
}
```

### 6.2 `run-e2e.mjs`

Runs `npx playwright test …specs --max-failures=1` in feature order. Setup and teardown still run via Playwright project dependencies when you pass individual spec paths — **or** run full `npm test` for all specs.

**Recommended commands:**

| Command | Use case |
|---------|----------|
| `npm test` | Full suite: setup + all enabled specs + teardown |
| `npm run test:features` | Subset / order from `features.mjs` |
| `E2E_FEATURES=delete npm run test:features` | Single feature without editing file |

---

## 7. Writing a feature spec

### 7.1 Imports

```typescript
// Always import test/expect from shared base — not @playwright/test directly
import { test, expect } from "../../support/test-base"
import { openMonitorList } from "../../support/monitor-helpers"
```

### 7.2 Structure

```typescript
test.describe("Feature name", () => {
  test.beforeEach(async ({ page }) => {
    await openFeature(page)   // uses fixture; no project create
  })

  test("TC-XXXX: behavior description", async ({ page }) => {
    // arrange / act / assert
  })
})
```

### 7.3 Rules

- **Do not** create or delete Blocks projects in feature specs.
- **Do not** log in again unless testing auth itself — use saved session.
- **Do** use role-based selectors (`getByRole`, `getByLabel`, `getByTestId`).
- **Do** skip gracefully when seed data preconditions missing (`test.skip(…)`).
- **Do** keep tests independent — order must not matter within the feature file.
- Mutations on shared data: prefer idempotent setup in `beforeEach` or unique names with `Date.now()`.

---

## 8. Setup spec checklist

```typescript
test("{app} setup", async ({ page }) => {
  resetRunOutcome()

  await loginThroughOidc(page)
  await page.context().storageState({ path: SESSION_PATH })

  const { projectName, dashboardUrl, itemId } = await reuseOrCreateSharedProject(page)

  // Navigate to your feature (sidebar link, URL, etc.)
  await openFeatureFromDashboard(page)

  // Seed if empty
  await ensureSeedData(page)

  writeAppProject({ projectName, itemId, dashboardUrl, featureUrl: page.url() })
})
```

Timeout: **300s** for setup (project creation can be slow).

---

## 9. Teardown spec checklist

```typescript
test("{app} teardown", async ({ page }) => {
  const fixture = readAppProject()
  if (!fixture) return

  if (!shouldDeleteSharedProject()) {
    console.log(`Keeping project "${fixture.projectName}" …`)
    return
  }

  await ensureAuthenticated(page)
  await deleteCreatedProject(page, fixture.projectName)

  clearAppProject()
  clearAppSession()
})
```

Timeout: **120s**. Teardown failures should log warnings, not fail the CI job, if delete is best-effort.

---

## 10. Integration checklist (new Blocks app)

Use this when onboarding E2E to another repo:

### Phase A — Scaffold

- [ ] Create `e2e/` with layout from §3
- [ ] Add `package.json` with `@playwright/test`, `dotenv`, lint/format
- [ ] Copy and adapt `env.ts`, `login-helper.ts`, `test-base.ts`, `run-outcome.ts`
- [ ] Copy `create-and-delete-project.ts` (adjust dashboard ready checks if app dashboard differs)
- [ ] Configure `playwright.config.ts` with 3 projects + `workers: 1`
- [ ] Add `.env.e2e.example`; gitignore `.env.e2e` and `fixtures/`

### Phase B — Lifecycle

- [ ] Implement `{app}.setup.spec.ts` — login, project, seed, fixture
- [ ] Implement `{app}.teardown.spec.ts` — OS delete path
- [ ] Implement `{app}-helpers.ts` — `openFeature`, `ensureSeedData`
- [ ] Verify OS delete: console → dashboard → Delete (manual screenshot match)

### Phase C — Features

- [ ] Add first feature spec with `beforeEach → openFeature`
- [ ] Register in `features.mjs`
- [ ] Confirm failure keeps project (`E2E_KEEP_PROJECT` behavior)
- [ ] Confirm full pass deletes project on OS

### Phase D — CI / ops

- [ ] Set `E2E_NO_WEBSERVER=1` for remote dev CI
- [ ] Store credentials in CI secrets (`E2E_USERNAME`, `E2E_PASSWORD`)
- [ ] Set `E2E_REUSE_PROJECT_NAME` or accept create/delete per run
- [ ] Publish HTML report artifact on failure
- [ ] Document project-specific README (link to this spec)

---

## 11. Console & project conventions

### Project card

Projects appear on `/app/console` as cards with:

- Project name (exact text match)
- Environment button: `Development`, `Testing`, `Staging`, `IAT`, `UAT`, `Production`, etc.

Locator pattern:

```typescript
page.locator("div")
  .filter({ has: page.getByText(projectName, { exact: true }) })
  .filter({ has: page.getByRole("button", { name: /Development|Testing|…/ }) })
```

### URL shapes

| Path | Meaning |
|------|---------|
| `/app/console` | Project list |
| `/app/{uuid}/dashboard` | Project dashboard |
| `/app/{uuid}/monitor` | Monitor feature (example) |
| `/app/project/{uuid}/environments` | Mid-create flow |

Extract `itemId` from dashboard URL: `pathname.split("/")[2]`.

### Orphan cleanup

Auto-created projects use name `Test Project {timestamp}`. Setup reuses the **last** orphan if no `E2E_REUSE_PROJECT_NAME` / `E2E_PROJECT_ID` — reduces slot churn on repeated local runs.

---

## 12. Failure & cleanup policy

| Condition | Project deleted? | Session cleared? |
|-----------|------------------|------------------|
| All feature tests pass | Yes (OS delete) | Yes |
| Any feature test fails | No | No (until manual teardown run) |
| Setup fails | No (teardown skipped) | No |
| `E2E_KEEP_PROJECT=1` | No | Yes after teardown no-op |
| Teardown delete fails | No (manual cleanup) | Fixture cleared if you choose |

`run-outcome.json` persists failure across the feature runner subprocess so teardown sees it even when `markMonitorTestFailed()` ran in a child process.

---

## 13. Remote dev vs local

### Remote dev (shared infrastructure)

```ini
E2E_BASE_URL=https://dev-{app}.blocksdevelopers.com
E2E_NO_WEBSERVER=1
```

Warnings about missing local `index.html` in global-setup are expected.

### Local build

```ini
E2E_BASE_URL=https://dev-{app}.blocksdevelopers.com:5001
# E2E_NO_WEBSERVER unset → Playwright runs run.sh -b
```

Requires:

1. Hosts entry: `127.0.0.1 dev-{app}.blocksdevelopers.com`
2. TLS certs if using `https://`
3. Free port (5001 is common across Blocks repos)

---

## 14. Naming & conventions

| Item | Convention |
|------|------------|
| Setup spec | `{app}.setup.spec.ts` |
| Teardown spec | `{app}.teardown.spec.ts` |
| Feature specs | `{app}-{feature}.spec.ts` |
| Feature ids | kebab-case, stable (`pause-resume`, not file names) |
| Seed entities | `e2e-shared-{timestamp}` or test-case prefixed |
| Playwright projects | `{app}-setup`, `{app}`, `{app}-teardown` |
| Test import | `support/test-base` not `@playwright/test` |

---

## 15. Extending to another Blocks app (example)

**Scenario:** Add E2E for `dev-analytics.blocksdevelopers.com`.

1. Set `E2E_BASE_URL=https://dev-analytics.blocksdevelopers.com`
2. Set `E2E_OS_BASE_URL=https://dev-os.blocksdevelopers.com` (or derive)
3. Replace Monitor navigation with Analytics sidebar link / URL
4. Change `featureUrl` in fixture to `/app/{id}/analytics`
5. Implement `ensureSeedData` for analytics dashboards/reports
6. Keep **identical** OS delete flow — unchanged across apps
7. Register features in `features.mjs`

Only `support/{app}-helpers.ts`, setup navigation, and spec assertions are app-specific. Console, login, project lifecycle, and teardown stay shared.

---

## 16. Reference map (Blocks Monitor)

| Spec section | Reference file |
|--------------|----------------|
| Playwright config | `e2e/playwright.config.ts` |
| Setup | `e2e/tests/monitor/monitor.setup.spec.ts` |
| Teardown | `e2e/tests/monitor/monitor.teardown.spec.ts` |
| Feature example | `e2e/tests/monitor/monitor-pause-resume.spec.ts` |
| Project lifecycle | `e2e/support/create-and-delete-project.ts` |
| Fixture | `e2e/support/monitor-project.ts` |
| Feature helpers | `e2e/support/monitor-helpers.ts` |
| Failure tracking | `e2e/support/run-outcome.ts`, `e2e/support/test-base.ts` |
| Feature list | `e2e/features.mjs`, `e2e/run-e2e.mjs` |
| Quick start | `e2e/README.md` |

---

## 17. Anti-patterns

| Avoid | Do instead |
|-------|------------|
| Delete project from app host (Monitor) | OS console → dashboard → Delete |
| Direct `/app/{id}/dashboard` for delete | Console → card → dashboard (stable auth + UI state) |
| New project per feature file | One shared project; seed entities inside it |
| `workers > 1` with shared project | `workers: 1` |
| Import `@playwright/test` in feature specs | Import from `support/test-base` |
| Hard-code dev URLs in specs | Read from `env.ts` / fixture |
| Delete project on test failure | Keep for inspection; manual or re-run teardown |

---

## 18. Version history

| Version | Date | Notes |
|---------|------|-------|
| 1.0 | 2026-08-20 | Initial spec from Blocks Monitor reference implementation |

---

**Questions or drift?** Compare your repo against `blocks-monitor/e2e/` and update this spec when the shared pattern changes.
