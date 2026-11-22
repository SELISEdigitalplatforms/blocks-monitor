# MADP Factory frontend

## Current setup: embedded Blocks IAM + Data Gateway + private Storage

The active runtime uses `FACTORY_PLATFORM=blocks` and `VITE_BLOCKS_AUTH_MODE=embedded`: the original email/password form calls real Blocks IAM through a same-origin Node backend. SQLite is available only through the explicit legacy local adapter.

- Run `npm --prefix frontend run cert` once after configuring the public settings from `.env.example` in `frontend/.env.local`.
- Map `dbsaun.slsblx.com` to `127.0.0.1` locally and trust the generated development certificate on your machine. The setup script prints the certificate trust command.
- Run `npm --prefix frontend run dev`, then open **https://dbsaun.slsblx.com:5310**.
- Sign in with an active Factory IAM user using the in-app form. The old permissive local accounts are not used in Blocks mode.
- Keep `.env.local` and `.cert/` private and gitignored; never put service secrets in `VITE_*` variables.
- Hosted OIDC remains an optional alternative with `/login/callback`; it is not the active embedded-login path. GitHub OAuth uses `/api/github/callback` on the HTTPS app origin.
- Scoped reads and workspace/project commands persist through the Blocks SDK/Data Gateway. Real GitHub connection and immediate private repository creation are implemented. Private file upload, ready-state persistence, reload and byte-matched download have passed live verification.
- The production Node entry point and root Dockerfile serve the same Blocks API middleware as the dev server. See [the deployment runbook](../docs/FACTORY-BLOCKS-DEPLOYMENT.md). Static `dist`/`vite preview` alone does not host the backend. Unknown API routes fail 503 rather than falling back to SQLite.
- Current review, findings, cloud changes and exact evidence: **[docs/END-TO-END-INTEGRATION-REVIEW-2026-10-29.md](docs/END-TO-END-INTEGRATION-REVIEW-2026-10-29.md)**. Historical ledger: `docs/BLOCKS-INTEGRATION.md`.

### Per-developer extraction runner (configure once)

Your coding assistant and the application's extraction CLI are separate choices. In the private, ignored `frontend/.env.local`, choose **one**:

```dotenv
MF_EXTRACTION_RUNNER=codex
# Alternatively: MF_EXTRACTION_RUNNER=claude
```

This setting survives restarts/Git pulls and does not change the core MADP engine's runner. Restart the dev server after changing it. Blank preserves inherited `AI_RUNNER`, or the existing Claude default if neither is set. The app never detects an alternative provider and silently switches to it.

| Adapter | Text | Image formats | Evidence |
| --- | --- | --- | --- |
| Codex | Yes | PNG, JPEG, WebP | Live synthetic image test plus automated tests. |
| Claude | Yes | PNG, JPEG, WebP, GIF | CLI protocol/structured-output fixtures tested; needs live verification on a machine with authenticated Claude. |
| Aider / generic / other named CLI | Legacy text-only path | Not implemented | Must return findings JSON; arbitrary agents are not automatically compatible. Legacy execution behavior is retained. |

Optional local settings:

- `MF_EXTRACTION_CODEX_BINARY`: installed native Codex executable path.
- `MF_EXTRACTION_CLAUDE_BINARY`: installed native Claude executable path.
- `MF_EXTRACTION_BINARY`: executable for a legacy text-only CLI.
- `MF_EXTRACTION_MODEL`: model available to your chosen provider (do not copy a Codex model name into a Claude setup).

On Windows, point to a native executable, not an npm `.ps1`/`.cmd` wrapper. Each teammate must install/authenticate their selected CLI once using their own account; configuration does not install software or perform login.

Run from `frontend/` before first use or after a CLI upgrade:

```sh
npm run check:extraction-runner
```

This opt-in, read-only preflight checks executable availability, expected CLI flags, and adapter capabilities. It makes no model request, does not verify login/model entitlement, does not print credentials or executable paths, and never blocks normal app startup. This is deliberately not added to a global startup hook.

All adapters feed the same findings contract and local knowledge base. Failed processing is not an analyzed file. On Project understanding, use **Retry extraction** beside a failed attachment, or **Retry failed files** for a sequential batch. This reuses the committed upload and refreshes the brief; **Rebuild brief** alone only combines saved findings. Text-based PDF parsing is provided by the declared `pdf-parse` dependency, before runner normalization. Other document parsers/scanned-PDF OCR remain separate prerequisites. Additional runners need a specific image adapter before they can process images; identify the exact CLI rather than assuming every coding agent supports the same protocol.

PDF text extraction preserves actual page numbers and currently allows up to 200 pages / 90,000 text characters. Password-protected, damaged, oversized, or textless pages produce specific errors, rather than being silently summarized. Blank/scanned pages require an unlocked text-based export or a future OCR processor; embedded diagrams are not visually analyzed by the text parser. On existing working checkouts, install the newly declared PDF dependency before retrying; restarting the dev server does not install dependencies automatically.

During analysis, files show **Queued → Analyzing… → Analyzed · N findings** (including successful zero-finding results). Batch retries update each row as it completes; overall completion waits for the brief refresh and reports mixed results as **Completed with failures**. The review page also polls for upload-started work and refreshes the brief automatically when processing settles. A status-refresh/network problem is not labeled as an extraction failure.

Focused checks: `npx vitest run --config test/extraction/vitest.config.ts`. Evidence and boundaries: [application reference](../docs/APPLICATION-BUSINESS-AND-ARCHITECTURE.md), sections 15–17.

### General checks (from `frontend/`)

```sh
npm run check:blocks-auth       # live read-only IAM/service probe
npm run check:wizard-schema     # live read-only eight-contract schema audit
npm run check:auth-ui           # isolated public sign-in checks; dev server must be running
npm run typecheck
npm run build
npm run test
# Resource-aware diagnostic invocation if the default 5-second local-engine tests time out:
npm run test -- --maxWorkers=2 --testTimeout=20000
```

The test-timeout override is not a claim that the default suite passed. Do not run resets, new-project submissions, provisioning or schema migrations just to verify connectivity. Private uploads require the administrator-provisioned, isolated `mf` root with a service-role ACL; see the current review before targeting another tenant. Use a normal browser window for manual file selection, not a browser whose native pickers are intercepted by testing tools.

## Historical local-store implementation

**Everything below describes only the explicit `FACTORY_PLATFORM=local` adapter.** Reset/seed commands replace local data and are never cloud setup steps. This material is retained because local adapters and fixtures remain used by tests; it is not the current deployment guide.

This folder is the flow-design front end of MADP Factory. It is the whole app: every screen, every op and every rule. It
runs on one machine with a local SQLite store and realistic seeded data, so a step, a field or a flow can be changed
during a call and tried straight away. The Blocks-backed app at the repository root is the reference implementation and
is not touched by anything here.

Only the parts that talked to SELISE Blocks are replaced. `src/` (UI) and `functions/` (the server ops) are the same code
as at the root. The local host in `server/local/` serves the same same-origin routes the web already calls:
`/api/auth`, `/api/data`, `/api/fn/<function>`, `/api/files` and `/api/public/share`.

## Run

Use Node 24 (`node:sqlite` is built in). Packages come from the repository root `node_modules`: run `npm ci` once in
the repository root (it installs exactly the committed `package-lock.json` and never rewrites it). There is no second
install — don't run `npm install` inside `frontend/`.

```
npm --prefix frontend run dev        # http://localhost:5310  (the root app keeps 5300)
npm --prefix frontend run reset      # wipe the store, seed it again (frontend/seed), print the accounts
npm --prefix frontend run mailbox    # the newest e-mails the app sent (activation / reset links)
npm --prefix frontend run typecheck  # = npx tsc --noEmit -p frontend
```

These commands also work as `cd frontend && npm run dev` and so on. Nothing needs a `.env` file, a Blocks credential or
a network connection.

`reset` is safe while `dev` runs. The running server picks up the new data at once, and everyone simply signs in again.
If the database file itself is deleted or replaced, the dev server restarts on the new file by itself.

## Signing in

The accounts are listed in `seed/README.md`; all of them use the password `Factory2026`. Sign-in never blocks:

- A known e-mail signs in with any password.
- An unknown e-mail gets an account on the spot, named after the address (`lea.brunner@…` becomes Lea Brunner). It joins
  every active workspace as Workspace admin, so the person lands in the full data. If that e-mail was already invited
  somewhere, the invitation decides instead: it is accepted at the first sign-in, exactly as in the real flow.
- Only a deactivated account is refused (Admin → People, or an Account row with Status `deactivated`).

There is no mail service. Every e-mail the platform would send is kept in the mail drop and its link is printed in the
`dev` terminal; `npm run mailbox` lists them. This covers account activation, password reset, and the "added to
workspace" / "access requested" notifications. The links are real app links (`/activate?code=…`, `/resetpassword?code=…`),
so opening one, or pasting it on the sign-in page, continues the real flow. Change password, forgot password, activation,
"Create account" with a temporary password, and invitations all work as built.

## Where the data lives

| What | Where |
| --- | --- |
| All rows (every schema), accounts, sessions, codes, file records, mail drop | `frontend/data/factory.db` |
| Uploaded and seeded file bytes | `frontend/data/files/<fileId>` |
| Vite pre-bundle cache | `frontend/.vite-cache/` |

Both folders are gitignored. To inspect the store, use `sqlite3 frontend/data/factory.db` or `node:sqlite`. Each row is
one JSON document in the `rows` table (`schema`, `item_id`, `doc`).

## Adding a field quickly

Example: a `Priority` field on Project.

1. Write it. In the op (for example `functions/project/ops/projects/edit.ts`), accept the argument and put
   `Priority` into the row or patch it writes. The local store keeps any field; no schema change is needed.
2. Read it. Add `"Priority"` to the field list the screen reads (the `fields` of its read in `src/blocks/...`).
   `/api/data` accepts any field name, and a row without the field answers `null`, as the hosted gateway does.
3. Show it in the component.

There is no restart. An edited op is live on the next request (the functions load through Vite's SSR loader), and the UI
updates through hot reload. To keep the Blocks reference in step, add the field to `blocks/data/schemas/<Schema>.json`
later.

A new schema works the same way. Unique indexes come from `blocks/data/indexes.json`, plus `RequestKey` on every schema.
Who may read a schema in the browser comes from `blocks/data/policies.json` (`acl` = the row's ReaderIds, `own:<Field>`,
`super-admin`). The policies are re-read every few seconds; a schema with no entry is read by ACL.

## What is local and what is real

| Part | Here |
| --- | --- |
| Screens, routes, theme | Real: `src/` is the app. |
| Ops, permissions, roles, audit, notifications, idempotency | Real: `functions/` runs through the real router (`functions/_lib/router.ts`) with a local host descriptor. |
| Data Gateway | Local: SQLite with the hosted semantics. That means the live filter rules, no client ItemId, a required RequestKey, unique indexes (a RequestKey hit answers the existing id), null patches refused, `conflict` on a unique hit in an update, pages of 1–100, `findAll` limits, MongoDB sort order, and system fields (CreatedDate, LastUpdatedDate, …). A CreatedDate / LastUpdatedDate given by the seed is kept. It is more permissive than Blocks in one way: unknown fields and enum values are stored, not refused. |
| Browser reads (`/api/data`) | Local, with the row policies of `policies.json` applied for the signed-in person. |
| Sign-in, sessions, IAM (people, roles, activation, reset, change password) | Local account store: scrypt password hashes, HttpOnly sealed session cookie, rotating refresh tokens. Sign-in never blocks (see above). |
| Storage | Local: signed, short-lived upload / download URLs on this origin; the bytes are kept in `data/files/`. |
| Mail, notifier doorbell | Mail drop plus terminal log. There is no live push: the bell polls, as it does when the doorbell is down. |
| Public share links, background project purge | Local, same code. |
| GitHub | The existing in-app placeholder (connect, pick a repository and branch). |
| MADP engine | Local: `server/local/engine/` claims every queued EngineJob and does its work the way the engine does (claimed → running with progress → done), writing the same rows: questions and technical proposals, requirement drafts and review suggestions, screen designs, milestones, second opinions, board tickets, milestone builds with previews and the dev release, change builds, agent and assistant replies, bug analyses and wiki pages. Content comes from the project's own records; no AI is called. See "The engine" below. |

## Layout of the local host

```
server/local/plugin.ts         Vite plugin: virtual modules, routes, CSP; port 5310
server/local/host.ts           the routes (/api/auth, /api/data, /api/fn, /api/files, /api/public/share) and the purge
server/local/backend.ts        the routers with local adapters (loaded through Vite SSR: edits are live)
server/local/gateway.ts        RawGateway on the store (hosted semantics)
server/local/rowStore.ts       rows in SQLite + memory, unique indexes, change events
server/local/dataRoute.ts      /api/data with row policies
server/local/iam/              accounts, tokens, codes, sign-in rules, walk-in access, the IAM client for admin ops
server/local/storage*.ts       local Storage and the signed URLs (filesRoute.ts)
server/local/seedTarget.ts     the SeedTarget the seed writes through (contract: seed/target.ts)
server/local/engine/index.ts   the engine hook
server/local/engine/           the local MADP engine: driver.ts (claims, resumes), run.ts (a job at work), kinds/ (the work)
server/fnHost/                 shared HTTP pieces from the root app (fn middleware, auth routes, session cookie, …)
```

## The engine

Jobs are picked up a second or two after they are queued and run in about the time a call can wait: an answer in a few
seconds, questions or a requirements draft in 20 to 45 seconds, a milestone build in two to three minutes (its preview a
few seconds later). Builds move the tickets through the agents' columns one by one, so the Board, the Studio and the
Timeline fill in as they go, and now and then a ticket is sent back by the reviewer or the tests, as in real builds.

| Setting | How |
| --- | --- |
| Pace | `FACTORY_ENGINE_PACE=0.5 npm --prefix frontend run dev` (twice as fast; `2` = half as fast; 0.05 to 20), or at any time `frontend/data/engine.json` with `{"pace": 0.5}` (read again every few seconds) |
| Off | `FACTORY_ENGINE=off`, or `{"enabled": false}` in `data/engine.json`: jobs stay queued and the screens show "Waiting for the MADP engine" |
| No send-backs | `{"sendBacks": false}` in `data/engine.json` |

A restart, a code edit or a `reset` never loses work: queued jobs are claimed and jobs that were running go on from where
their rows stand (the seeded running builds included). Each kind's work is in `server/local/engine/kinds/` and is loaded
per job, so an edited writer is used by the next job. Tests: `npx vitest run --config frontend/test/engine/vitest.config.ts`.


### Engine capacity and the AI account pool (engine host)

The Blocks engine worker (`npm run engine:blocks`, started by the host's `run.sh`) reports its host to
Platform → Engine & capacity: every 30 s the `EngineHost` row of its worker id (CPU from `/proc/stat`, load, memory from
`/proc/meminfo`, the disk of the project root, running jobs, lanes and the Claude Code agents under them, the queue, the
release, uptime) and once a minute an `EngineHostSample` (kept 7 days; the worker deletes older ones in small batches).
Code: `server/blocks/engineWorker/{hostStats,heartbeat}.ts`. Failures are only logged; job work never waits for it.

The lanes can run on several Claude subscriptions in turn (`server/local/engine/ai/accountPool.ts`,
rows synced by `server/blocks/engineWorker/aiAccountSync.ts`). Accounts are configured **on the engine host only**; Blocks
and the app hold labels and numbers, never a credential.

```
/srv/madp-factory/secrets/ai-accounts/       MF_AI_ACCOUNTS_DIR (mode 700, owned by the engine's user)
  sub-a/                                     one Claude Code config folder per subscription (mode 700)
  sub-b/                                     label = folder name: a-z, 0-9 and "-", up to 40 characters
<engine data>/ai-accounts/<label>/           each account's own limit record (MADP_FALLBACK_HOME of its lanes; made by the worker)
~/.madp/anthropic-fallback.key               the existing API fallback key (MADP_FALLBACK_KEY_FILE; mode 600): the "api-key" account
```

Adding a subscription (as the engine's user, on the host): `mkdir -m 700 /srv/madp-factory/secrets/ai-accounts/sub-c`, then
`CLAUDE_CONFIG_DIR=/srv/madp-factory/secrets/ai-accounts/sub-c claude` and sign in with `/login`. The worker finds the folder
within a minute (no restart) and lists it under Platform → AI accounts, where people set it in rotation, on standby or off,
its order and a note. A folder other users can open is left out (logged).

| Setting | Meaning |
| --- | --- |
| `MF_AI_ACCOUNTS_DIR` | Turns the pool on. Unset, or no usable folder in it: every lane runs exactly as before on the host's single login (with its own fallback to the key). |
| `MF_AI_USAGE_PROBE` | Optional executable run per subscription every `MF_AI_USAGE_PROBE_MS` (default 300000) with `CLAUDE_CONFIG_DIR` set to the account's folder and only `PATH`/`HOME` besides; it prints `{"five_hour":{"utilization":42,"resets_at":"<ISO>"},"seven_day":{"utilization":10,"resets_at":"<ISO>"}}` (percent). Claude Code has no headless usage command today, so this is the operator's. |
| PlatformSetting `engine.rotateAtPercent` | Set in Platform → AI accounts (default 99, 50 to 100). |

Selection, per lane: among accounts in rotation, the one with the most headroom below the threshold (equal headroom:
lower order number, fewer running lanes, least recently used); none → standby accounts; none → the API key; none → the
lane runs as before and the job meets the usual "AI capacity used up" handling. An account at or above the threshold, one
whose lane stopped at its limit (or a 429: 5 minutes), or one whose lanes recorded a limit in its own limit record rests
("cooling") until its reset (an hour when unknown). Usage comes from the `rate_limit_event` lines the lanes' agents write
into their agent logs, from capacity stops, from the per-account limit records and from the probe. The lane's log names the
account label it ran on.
