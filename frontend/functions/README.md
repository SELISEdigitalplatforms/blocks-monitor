# MADP Factory server functions

Every write of MADP Factory runs here. The browser reads through the Data Gateway (row policies) and writes only through these functions (`src/blocks/fn.ts`). Six functions share one router and one library.

## Layout

```
functions/
  functions.config.json     catalogue: name -> slug, description, trigger roles, variables
  tsconfig.json             typechecks functions/** and src/domain/**
  _lib/                     shared server library (router, gateway, access, helpers)
    testing/                test kit (tests only; production code and the build never import it)
  workspace|project|delivery|collab|admin|engine/
    index.ts                three lines, never edited by feature lanes
    ops/<area>/*.ts         feature operations (one lane owns each area)
  .dist/                    build output (ignored)
```

`functions/<fn>/index.ts` is `createFunction({ name, ops, aclSchemas })`. The build discovers every op under `ops/**/*.ts` (not `*.test.ts` or `*.d.ts`), so adding an op needs no registration line. Ops may be exported alone, in an array or as record values, under any table name. The same definition reached twice is registered once; two different definitions with one op name fail the build; an object with an `op` string and a `handler` function that was not made by `defineOp` fails the build.

## Hosts

- **Host A (default)**: a Vite dev-server middleware serving `POST /api/fn/<function>` on the app origin `MF_APP_ORIGIN` (default `http://localhost:5300`). It verifies the caller's IAM token server-side and builds the same `ctx.context` as Blocks Functions.
- **Host B**: the same routers deployed as Blocks Logic Functions (`MF_FUNCTION_HOST=blocks`). Measured 4-6 s warm, so it is for the showcase and the later MADP engine bridge.

## Local setup

1. `npm install`, then `npm run setup` (creates `.env.local` from `.env.example` and generates `MF_SESSION_SECRET`).
2. The super admin creates your own service credential: `blocks auth client-credentials save --name mf-<you> --roles mf-service`.
3. Fill it into `.env.local` (below), with `MF_BLOCKS_TENANT` and `MF_BLOCKS_API_URL`; then `npm run doctor`.
4. The `.env.local` variables (gitignored): `MF_SVC_CLIENT_ID`, `MF_SVC_CLIENT_SECRET`, `MF_BLOCKS_TENANT`, optional `MF_BLOCKS_API_URL` (default: the web's `VITE_BLOCKS_API_URL`, else `https://blocksapi.slsblx.com`; Host A prints the chosen gateway at startup), optional `MF_GW_TRACE=1` (one more `[gw] <fn>.<op> <call> <ms>ms d<depth>, ...` line per request, calls in start order), `MF_IAM_PUBLIC_KEY_FILE`, `MF_SESSION_COOKIE`, `MF_FUNCTION_HOST=blocks` (only to use Host B), `MF_CSP_REPORT_ONLY=1`.
   - `MF_IAM_PUBLIC_KEY_FILE` adds a signature check IN ADDITION to the IAM call (`iam.me()` always runs). With a key set, impersonated tokens are refused.
   - `MF_CSP_REPORT_ONLY=1` sends the Content Security Policy as report-only. It is for the coordinator's live smoke only; the default is enforce.
5. `npm run dev`.

The local certificate is optional: `npm run cert` plus `MF_DEV_HTTPS=1` serves the app over https.

A missing variable makes the API answer 503 `SERVER_NOT_CONFIGURED`, and the web says so.

Host A prints one line per request: `[fn] <fn>.<op> <status> <ms>ms gw=<n>/<ms>ms svcToken=<state>`, followed only by the fields that are known: `rounds=<n>` (gateway rounds), `slowest=<call>:<ms>ms`, `net=<opened>new/<reused>reused/<connectMs>ms` (sockets of the request) and `cache=<hit|shared|miss>` (`workspace.me.bootstrap` is cached per user for at most 30 s and dropped by any other workspace or admin op).

## The op contract

```ts
export const MEMBER_OPS = [defineOp({
  op: "member.invite",            // OP_PATTERN, unique within the function (letters, dots, no digits)
  kind: "command",                // "command" | "view" (view: no writes except deps.audit, no Operation record)
  scope: "workspace",             // "self" | "workspace" | "project" | "platform" | "engine"
  permission: "members.manage",   // WorkspacePermission | "membership" | PlatformPermission; an array means any of
  platformOverride: "platform.workspaces.manage", // optional: a platform person may act outside membership (audited)
  allowInactiveAccount: false,    // optional (me.bootstrap)
  args: v.object({ workspaceId: v.id(), email: v.email(), roleKey: v.string({ max: 32 }) }),
  async handler(ctx, args, deps) { return { membershipId }; },
})];
```

- `ctx` (data): `fn, op, requestId, attempt, now, caller, account, workspace, project, membership, permissions, platformPermissions, viaPlatform, remainingMs()`.
- `deps` (services): `gw` (scoped gateway), `svc` (unscoped, self/platform/engine scope only), `ids, acl, refs, access, audit, notify, jobs, files`, `fail(code, messageKey?, params?)` (only codes of `OP_FAILURE_CODES`), `log`.
- Handlers never receive the raw platform ctx or `ctx.env`.

### Scope and permission rules

- `self`: any active, signed-in caller. `workspace`: the workspace is `args.workspaceId`. `project`: the workspace comes from `Project.WorkspaceId`, never from the args. `platform`: needs the platform permission. `engine`: the caller holds IAM role `mf-engine`.
- Not a member (and no super admin / override) -> `not_member`; a member without the permission -> `forbidden`. The super admin counts as owner everywhere; acting outside membership sets `ctx.viaPlatform` and the router writes an AuditEvent.
- The args are validated before any I/O (`invalid_input` with `{ field, rule }`, never the value).

### Idempotency (no client ItemId)

The hosted gateway rejects a client-supplied `ItemId`. Idempotency is the `RequestKey` field, a real unique index on every schema written by functions. The router sets it as `<function>.<op>:<requestId>[:<n>]`; on a duplicate-key answer (`{ created: false }`) the existing row is read by `RequestKey` and the stored result returned. A done Operation of the same caller and op replays its stored result; another caller's requestId is a `conflict`. Handlers must be idempotent: the platform may retry the same input once.

## Adding an op and its test

Create `functions/<fn>/ops/<area>/<file>.ts` and `test/functions/<fn>/<file>.test.ts`. Worked example (README only, never registered):

```ts
// functions/workspace/ops/example/rename.ts
import { defineOp, v } from "../../../_lib";

export const EXAMPLE_OPS = [defineOp({
  op: "example.rename",
  kind: "command",
  scope: "workspace",
  permission: "workspace.manage",
  args: v.object({ workspaceId: v.id(), name: v.string({ min: 1, max: 60, trim: true }) }),
  async handler(ctx, args, deps) {
    await deps.gw.update("Workspace", args.workspaceId, { Name: args.name });
    return { name: args.name };
  },
})];
```

```ts
// test/functions/workspace/example.test.ts
import { describe, expect, it } from "vitest";
import { EXAMPLE_OPS } from "../../../functions/workspace/ops/example/rename";
import { fakeCtx, memoryGateway, runOp, seedWorkspace } from "../../../functions/_lib/testing";

describe("example.rename", () => {
  it("renames for an admin and refuses a viewer", async () => {
    const gateway = memoryGateway();
    const { workspaceId } = seedWorkspace(gateway, { members: [
      { userId: "a", email: "a@x.io", roleKey: "admin" },
      { userId: "v", email: "v@x.io", roleKey: "viewer" },
    ] });
    const ok = await runOp("workspace", EXAMPLE_OPS, {
      ctx: fakeCtx({ userId: "a", email: "a@x.io" }), gateway,
      request: { op: "example.rename", args: { workspaceId, name: "New" } },
    });
    expect(ok.status).toBe(200);
    expect(gateway.rows("Workspace")[0]).toMatchObject({ Name: "New" });
    const no = await runOp("workspace", EXAMPLE_OPS, {
      ctx: fakeCtx({ userId: "v", email: "v@x.io" }), gateway,
      request: { op: "example.rename", args: { workspaceId, name: "X" } },
    });
    expect(no.status).toBe(403);
  });
});
```

Also assert `await listRegisteredOps("workspace")` contains your op names: it uses the same discovery as the build.

### Ports-style lanes (L4, L7, L8)

Bind your ports in `ops/**/bind.ts`: map the ports onto `ctx` and `deps`, and wrap each handler with `defineOp`. An "Operation begin/finish" port binds to a no-op, because the router owns idempotency. Port-level tables must not carry both an `op` string and a `handler` function (the look-alike rule above); only `defineOp` results do.

## Test kit (`functions/_lib/testing`)

- `memoryGateway({ rows?, uniqueIndexes?, validate = true })`: implements the raw gateway. An insert with an `ItemId` fails, a missing `RequestKey` is a `TypeError`, a duplicate `RequestKey` or S1 unique index returns `{ created: false }`, null patches and empty `updateMany` filters throw, every written row is checked against S1's `validations.json`. Extras: `rows(schema)`, `calls`, `failNext(method | "*", error, { schema?, times? })`, `seed(schema, row)`. `page` is 1-based.
- `assertRowValid(schema, row, { partial?, read? })`, `aclSchemasFromS1()`, `uniqueIndexesFromS1()`.
- `fakeCtx({ userId, email, roles, tenantId, env, attempt, impersonated })` -> `{ platformCtx, sdk, logs, tokenRequests() }`; `env: null` removes the env. The fake SDK only answers `auth.oidc.clientCredentials`; everything else throws `network disabled in tests`.
- `runOp(fn, ops, { ctx, gateway, request, files?, now? })` -> `{ status, body, gateway, ctx }`, through the real router.
- `seedWorkspace`, `seedProject`, `seedRow`: real-shape, validated rows with `ReaderIds` stamped.
- `listRegisteredOps(fn)`.
- The service token cache is module-level (keyed by API url + client id). Call `resetServiceTokens()` from `functions/_lib/serviceToken.ts` in `beforeEach` when a test counts token requests.

## Build and deploy

- `npm run functions:build` (`node scripts/functions-build.mjs [--fn a,b] [--out functions/.dist]`): typechecks, generates the `mf:` virtual modules, bundles each function (SDK included, only `node:` builtins external), validates `handler.meta` and writes `manifest.json`. Imports outside `functions/**`, `src/domain/**`, `@seliseblocks/client` and `node:*` fail the build.
- `npm run functions:deploy`: an offline dry run by default (secrets only as `{{secret.<id>}}`). `--check` and `--yes` are run only by the coordinator, after the owner's consent.
- `node scripts/data-apply.mjs`: publishes `blocks/data` (coordinator only; dry run by default).

## Roles on Blocks IAM (`rbac.source`)

PlatformSetting `rbac.source` decides where roles and permissions come from: `"factory"` (default, also when the row is
absent) reads PlatformRole / PlatformRoleAssignment / WorkspaceRole / Membership; `"iam"` reads Blocks IAM. Switch it
with `iam.source.set {source}` (platform admins; refused when the caller would not stay a platform admin in IAM). Apply
`blocks/data/migrations/iam-rbac-ui.json` first and sync IAM (`iam.sync.run`) before switching. ValueJson is the JSON
string `"factory"` / `"iam"`; the cache epoch is kept in the row's `Values`.

- `_lib/iamAdmin.ts` (also `server/iam/iamAdmin.ts` for server code): permissions, roles, organizations, one person's
  access, on the service identity. Errors are `IamAdminError` with `iam.unavailable | iam.forbidden | iam.notFound`
  (code = message). Slugs: `mf-platform-<key>` (built-in platform admin `mf-platform-admin`, super admin
  `mf-platform-super-admin`), `mf-org-owner|member|viewer`, `mf-org-<first 8 letters/digits of the workspace id>-<key>`
  for an organization's own role, `mf-tpl-<key>` for a template. Permission name = the
  Factory key, resource `madp-factory`.
- `_lib/rbacSource.ts`: the switch and the view the router and `openOp` resolve through. In `"iam"` mode the super admin
  is `mf-platform-super-admin` in IAM **or** today's `mf-super-admin` on the verified token (the no-lockout safety: no
  IAM read is needed for them, so an IAM outage never locks them out and they can always switch back). A workspace is
  decided by IAM only once `Workspace.IamOrganizationId` links it; a linked workspace needs both the IAM role and an
  active Membership row. Access is cached 60 s per person; every role or access change made through the Factory drops
  it here and moves the setting's epoch (other processes drop theirs within 5 s).
- Ops: `deps.rbac` (lib) / `deps.rbac` (ports). A role or access change runs its IAM step through `iamFirst(deps, work)`
  (`workspace/ops/_shared/core.ts`; a no-op with `"factory"`, a plain refusal when IAM fails, before any Factory write),
  then writes the rows, then `rbacChanged(deps, userIds?)`. Helpers: `workspace/ops/_shared/iamSync.ts`.
- Tests: `runOp(..., { iamAdmin, rbacCaches })`; a fake IAM API is in `test/platform/fakeIamSdk.ts`.

## Security model

- The caller comes only from `ctx.context` (the token the platform or Host A validated). Ids in the args never identify the actor.
- Every call checks membership and permission on the server; the browser is never trusted.
- Cross-references are checked (`deps.refs`): an id of another workspace is `not_found`.
- The server stamps `WorkspaceId`, `ReaderIds`, `CreatedByUserId`, `UpdatedByUserId`; nothing is copied from the input.
- `requestId` makes every command idempotent (see above).
- Data is written with the service identity `mf-service` (client credentials, token cached 60 s short of `exp`, never logged or returned).
- Warm sandboxes are shared by all callers: module state holds only the service token, nothing about a caller.
- Ops never see `ctx.env`; `ctx.log` receives only `{ fn, op, requestId, code, ms }`.

## Security hardening

Full analysis: `docs/THREAT-MODEL.md`. Open asks for Blocks: `docs/BLOCKS-REGISTER.md`.

### Host A limits

- 120 requests per minute per user.
- 8 requests in flight per user (429 `rate_limited`) and 32 in flight in total (503 `unavailable`, `retry-after: 2`).
- At most 30 failed token verifications per minute on the host (429, the verifier is not called).
- A body of at most 1 MB (413 above it) that arrives within 10 s (408 `timeout` after).
- Origin, Host and `Sec-Fetch-Site` must match the app origin; there is no CORS.

### Router rules (both hosts)

- Input shape guard: depth 32, 20 000 keys, no `__proto__`, `prototype` or `constructor` key.
- Impersonated callers are refused platform and engine commands and the permissions members.manage, roles.manage, workspace.manage, release.approve, release.manage-approvals and release.promote.
- Per-user quotas for rate-sensitive ops, read from `Operation` (or `AuditEvent`) rows. Answer `limit_reached`, messageKey `fn.quota`. They need an `Operation` index on (ActorUserId, Op).
- Log values pass `redact()`.
- `security.posture` (mf-admin view, permission `platform.audit.view`) reports which of these the RUNNING host has switched on.

### Coordinator run sheet

1. Publish the `Operation` (ActorUserId, Op) index: `node scripts/data-indexes.mjs` prints the commands (dry run first, then with consent).
2. `node scripts/probe-isolation.mjs` (dry run), then `node scripts/probe-isolation.mjs --yes` against Host A.
3. Host B: `npm run functions:deploy` as a dry run, then `--yes` with consent; then `node scripts/probe-isolation.mjs --yes --host blocks`.
4. CSP smoke: open every page and read the DevTools console. Use `MF_CSP_REPORT_ONLY=1` only if something breaks. Confirm the exact Storage host from a live presign URL.
5. Check the IAM cookie attributes (Secure, HttpOnly, SameSite, Domain) and whether `slsblx.com` is on the Public Suffix List. Record both in the threat model.
6. Change versions for any audit advisory (`npm audit`, `npm audit --omit=dev`). No new dependency without the owner.
