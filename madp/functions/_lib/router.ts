import {
  FN_SLUG,
  IAM_ROLE,
  MAX_INPUT_BYTES,
  OP_PATTERN,
  REQUEST_ID_PATTERN,
  type FnFunctionName,
} from "../../src/domain/fnContract";
import {
  PLATFORM_PERMISSIONS,
  WORKSPACE_PERMISSIONS,
  isPlatformPermission,
  isWorkspacePermission,
} from "../../src/domain/rbac";
import {
  authorise,
  checkAccount,
  createAccess,
  effectiveCaller,
  iamBundle,
  loadWorkspaceBundle,
  type WorkspaceBundle,
} from "./access";
import { createIamAdmin, createIamAdminCache, processIamAdminCache } from "./iamAdmin";
import { createUtilitiesAccess } from "./blocksUtilities";
import { createRbacCaches, createRbacHandle, processRbacCaches, type IamWorkspaceAccess } from "./rbacSource";
import { createAcl } from "./acl";
import { createAuditQueue } from "./audit";
import { readCaller } from "./caller";
import { readEnv } from "./env";
import { createCallerIam } from "./callerIam";
import { OpError, fail, isOpError, toErrorBody } from "./errors";
import { LIB_FIELDS, PROJECT_ROW_FIELDS } from "./fields";
import { f } from "./filter";
import { enforceQuota, guardInputShape, hostDescriptor, logValue, refuseImpersonated, startQuotaRead } from "./hardening";
import { createRawGateway, type RawGateway, type Row } from "./gateway";
import { bindIds } from "./ids";
import { processFacts } from "./factMemo";
import { createInflight, processInflight, type InflightOutcome } from "./inflight";
import { createJobs } from "./jobs";
import { deadlineGateway } from "./deadline";
import { REQUEST_MEMO_MAX_AGE_MS, memoGateway } from "./memo";
import { guardPaging } from "./paging";
import { DETERMINISTIC_REFUSALS, createOperationLog } from "./operation";
import { createOutbox } from "./outbox";
import { createRefs } from "./refs";
import { isOpDef, S1_OP_PATTERN } from "./registry";
import { defaultSdk, type SdkFactory } from "./sdk";
import { createServiceGateway, createScopedGateway, readOnlyGateway } from "./scopedGateway";
import { serviceClient, serviceTokens, type TokenHooks } from "./serviceToken";
import { countGateway, formatGwUnfinished, logInternal, recordUnfinished } from "./stats";
import { createFiles } from "./storage";
import type {
  FnHttpAnswer,
  FunctionHandler,
  FunctionMeta,
  HostAdapters,
  OpCtx,
  OpDef,
  OpDeps,
  OpLog,
  PlatformCtx,
} from "./types";
import { parseArgs, v } from "./validate";

const SOFT_DEADLINE_MS = 25_000;
/** Late bookkeeping (Host A, opt-in): failed parts are written again this often, waiting this much longer each time. */
const LATE_BOOKKEEPING_RETRIES = 2;
const LATE_BOOKKEEPING_RETRY_MS = 1_000;
const HEADERS = { "content-type": "application/json", "cache-control": "no-store" } as const;
/** Keys a handler's log data may never carry. */
const CREDENTIAL_KEY = /key|secret|token|password|credential|authorization|cookie|email/i;
const PING_ARGS = v.object({ deep: v.optional(v.bool()) });

type Rec = Record<string, unknown>;

interface Request {
  op: string;
  requestId: string;
  args: Rec;
}

const isRec = (x: unknown): x is Rec => typeof x === "object" && x !== null && !Array.isArray(x);
const permList = (p: unknown): string[] => (p === undefined || p === null ? [] : typeof p === "string" ? [p] : Array.isArray(p) ? (p as string[]) : ["?"]);

/** Creation-time checks; a violation is a programming error that names the op. */
function validateDefs(name: string, defs: readonly unknown[]): OpDef[] {
  const seen = new Set<string>();
  const out: OpDef[] = [];
  for (const d of defs) {
    if (!isOpDef(d)) throw new Error(`${name}: an entry in ops was not made with defineOp().`);
    const id = d.op;
    const bad = (why: string): never => {
      throw new Error(`${name}: op "${id}" ${why}.`);
    };
    if (!OP_PATTERN.test(id) || !S1_OP_PATTERN.test(id)) bad("has an invalid name");
    if (id.startsWith("sys.")) bad("uses the reserved sys. prefix");
    if (seen.has(id)) bad("is defined twice");
    seen.add(id);
    const perms = permList(d.permission);
    if (d.scope === "workspace" || d.scope === "project") {
      if (perms.length === 0) bad("needs a permission");
      for (const p of perms) {
        if (p !== "membership" && !isWorkspacePermission(p)) bad("has a permission that is not a workspace permission");
      }
      if (perms.includes("membership") && perms.length > 1) bad('mixes "membership" with other permissions');
    } else if (d.scope === "platform") {
      if (perms.length === 0) bad("needs a platform permission");
      for (const p of perms) if (!isPlatformPermission(p)) bad("has a permission that is not a platform permission");
    } else if (perms.length > 0) {
      bad("must not declare a permission in this scope");
    }
    if (d.platformOverride !== undefined) {
      if (d.scope !== "workspace" && d.scope !== "project") bad("uses platformOverride outside workspace/project scope");
      if (!isPlatformPermission(d.platformOverride)) bad("has an invalid platformOverride");
    }
    if (d.projectFrom !== undefined && d.scope !== "project") bad("uses projectFrom outside project scope");
    out.push(d);
  }
  return out;
}

function parseInput(input: unknown): Request {
  let body: unknown = input;
  if (typeof input === "string") {
    body = input;
  } else if (isRec(input) && typeof input.method === "string" && ("body" in input || "rawBody" in input)) {
    body = input.body !== undefined && input.body !== null ? input.body : input.rawBody;
  }
  let parsed: unknown;
  if (typeof body === "string") {
    if (Buffer.byteLength(body, "utf8") > MAX_INPUT_BYTES) throw new OpError("too_large");
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new OpError("invalid_input");
    }
  } else {
    let size = 0;
    try {
      size = Buffer.byteLength(JSON.stringify(body) ?? "", "utf8");
    } catch {
      throw new OpError("invalid_input");
    }
    if (size > MAX_INPUT_BYTES) throw new OpError("too_large");
    parsed = body;
  }
  if (!isRec(parsed)) throw new OpError("invalid_input");
  guardInputShape(parsed);
  const { op, requestId } = parsed;
  const args = parsed.args === undefined ? {} : parsed.args;
  if (typeof op !== "string" || !OP_PATTERN.test(op)) throw new OpError("invalid_input");
  if (typeof requestId !== "string" || !REQUEST_ID_PATTERN.test(requestId)) throw new OpError("invalid_input");
  if (!isRec(args)) throw new OpError("invalid_input");
  return { op, requestId, args };
}

function rowsOf(res: unknown): Row[] {
  if (Array.isArray(res)) return res as Row[];
  const items = (res as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as Row[]) : [];
}

const str = (x: unknown): string => (typeof x === "string" ? x : "");

/**
 * A Blocks (IAM) sign-in has no Account mirror row: the host verified this request's token live with IAM, and IAM
 * refuses an inactive user (server/blocks/iam.ts me()), so the caller's account IS the verified IAM identity. The
 * workspace and project functions treat the caller the same way; this gives every op the same account row shape
 * as a local sign-in (Status, Email, DisplayName), so a handler's own account check sees an active account.
 */
function iamAccount(caller: { userId: string; email: string; displayName?: string }): Row {
  return { UserId: caller.userId, Email: caller.email, DisplayName: caller.displayName ?? "", Status: "active" };
}

function guarded<F extends (...a: never[]) => unknown>(_f: F): F {
  return ((): never => {
    throw new OpError("internal");
  }) as unknown as F;
}

export function createFunction(
  cfg: { name: FnFunctionName; ops: readonly unknown[]; aclSchemas: readonly string[] },
  adapters: HostAdapters = {},
): FunctionHandler {
  const { name } = cfg;
  const defs = validateDefs(name, cfg.ops);
  const table = new Map<string, OpDef>(defs.map((d) => [d.op, d]));
  const aclSchemas = new Set(cfg.aclSchemas);
  const clock = adapters.now ?? Date.now;
  const sdk = adapters.sdk ?? defaultSdk;
  const opCount = defs.length + 1;
  // The deployed function shares one registry per process; a host that injects its own gateway (tests) gets its own, so runs never leak into each other.
  const ownInflight = adapters.rawGateway ? createInflight() : processInflight;
  // The same for the roles source caches (functions/_lib/rbacSource.ts) and the IAM permission catalogue cache.
  const rbacCaches = adapters.rbacCaches ?? (adapters.rawGateway ? createRbacCaches() : processRbacCaches);
  const iamCache = adapters.rawGateway ? createIamAdminCache() : processIamAdminCache;

  const meta: FunctionMeta = {
    name,
    slug: FN_SLUG[name],
    ops: [
      { op: "sys.ping", kind: "view", scope: "self", permission: null, platformOverride: null, allowInactiveAccount: false },
      ...defs.map((d) => ({
        op: d.op,
        kind: d.kind,
        scope: d.scope,
        permission: (d.permission ?? null) as string | readonly string[] | null,
        platformOverride: d.platformOverride ?? null,
        allowInactiveAccount: d.allowInactiveAccount === true,
      })),
    ],
    catalogue: { workspace: WORKSPACE_PERMISSIONS, platform: PLATFORM_PERMISSIONS },
  };

  const answer = (status: number, body: Rec): FnHttpAnswer => ({
    statusCode: status,
    headers: { ...HEADERS },
    body: body as unknown as FnHttpAnswer["body"],
  });

  const makeRaw = (
    env: ReturnType<typeof readEnv>,
    tokens: ReturnType<typeof serviceTokens>,
    sdkOf: SdkFactory,
    opName: string,
    pctx?: PlatformCtx,
    memo = false,
  ): { raw: RawGateway; pending: () => number } => {
    const impl = adapters.rawGateway ? adapters.rawGateway({ env, tokens, sdk: sdkOf }) : createRawGateway({
          env,
          sdk: sdkOf,
          tokens,
          fetch: pctx?.fetch,
          onRequest: (info) => {
            try {
              const st = pctx?.stats;
              if (!st) return;
              st.requests += 1;
              if (info.kind === "batch") st.batchedRoots += info.roots;
            } catch {
              // counting never changes the answer
            }
          },
        });
    const base = guardPaging(impl);
    // Every gateway call has its own deadline and reads are hedged once; one line per call that hit its deadline.
    const timed =
      adapters.gatewayDeadline === null
        ? null
        : deadlineGateway(base, {
            ...adapters.gatewayDeadline,
            now: clock,
            onUnfinished: (u) => {
              try {
                if (pctx?.stats) recordUnfinished(pctx.stats, u);
                else pctx?.log?.warn?.(formatGwUnfinished({ fn: name, op: opName, ...u }));
              } catch {
                // logging never changes the answer
              }
            },
          });
    const counted = logInternal(pctx?.stats ? countGateway(timed ?? base, pctx.stats, clock) : (timed ?? base), (line) => {
      try {
        pctx?.log?.warn?.(`${line} ${name}.${opName}`);
      } catch {
        // logging never changes the answer
      }
    });
    // One request, one memo: the account, membership, workspace, roles and project are read once however often they are asked for.
    return { raw: memo ? memoGateway(counted, { now: clock, maxAgeMs: REQUEST_MEMO_MAX_AGE_MS }) : counted, pending: () => timed?.pending() ?? 0 };
  };

  /** Host A's shared token cache and this request's counters, when the host passed them. */
  const tokenHooks = (pctx: PlatformCtx): TokenHooks => {
    const stats = pctx.stats;
    return {
      ...(pctx.tokenStore ? { store: pctx.tokenStore } : {}),
      ...(stats
        ? {
            onLoad: (info: { fetchedMs: number | null }) => {
              if (info.fetchedMs !== null) stats.svcToken = `fetched ${info.fetchedMs}ms`;
              else if (stats.svcToken === "-") stats.svcToken = "cached";
            },
          }
        : {}),
    };
  };

  async function ping(pctx: PlatformCtx, rawArgs: unknown, caller: { userId: string; isSuperAdmin: boolean; identitySource?: "iam" }, env: ReturnType<typeof readEnv>, sdkOf: SdkFactory) {
    const args = parseArgs(PING_ARGS, rawArgs);
    const data: Rec = {
      fn: name,
      opCount,
      serverNow: new Date(clock()).toISOString(),
      caller: { userId: caller.userId, isSuperAdmin: caller.isSuperAdmin },
    };
    if (args.deep === true) {
      let serviceOk = false;
      let hasServiceRole = false;
      try {
        const tokens = serviceTokens(env, sdkOf, clock, tokenHooks(pctx));
        const claims = await tokens.claims();
        const roles = [claims.role, claims.roles].flat().filter((r): r is string => typeof r === "string");
        hasServiceRole = roles.includes(IAM_ROLE.service);
        const { raw } = makeRaw(env, tokens, sdkOf, "sys.ping", pctx);
        if (caller.identitySource !== "iam") await raw.find("Account", { where: f.eq("UserId", caller.userId), fields: ["ItemId"], page: 1, pageSize: 1 });
        serviceOk = true;
      } catch {
        serviceOk = false;
      }
      data.serviceOk = serviceOk;
      data.hasServiceRole = hasServiceRole;
    }
    void pctx;
    return data;
  }

  async function dispatch(input: unknown, platformCtx: PlatformCtx): Promise<FnHttpAnswer> {
    const pctx: PlatformCtx = platformCtx ?? { context: null, env: null };
    const started = clock();
    const deadline = started + SOFT_DEADLINE_MS;
    const sdkOf: SdkFactory = pctx.fetch ? (o) => sdk({ ...o, fetch: o.fetch ?? pctx.fetch }) : sdk;
    let op = "";
    let requestId = "";
    const refusal: { record: ((code: string) => Promise<void>) | null } = { record: null };
    let outcome = "ok";
    let handlerStarted = false;
    let diagnostic: Rec | null = null;

    // Waits for another run's outcome under this request's own deadline.
    const untilDeadline = <T>(p: Promise<T>): Promise<T> => {
      let t: ReturnType<typeof setTimeout> | undefined;
      const limit = new Promise<never>((_, reject) => {
        t = setTimeout(() => reject(new OpError("timeout")), Math.max(0, deadline - clock()));
      });
      limit.catch(() => undefined);
      return Promise.race([p, limit]).finally(() => {
        if (t) clearTimeout(t);
      });
    };

    const execute = async (): Promise<unknown> => {
      const req = parseInput(input);
      op = req.op;
      requestId = req.requestId;
      const isPing = req.op === "sys.ping";
      const def = table.get(req.op);
      if (!def && !isPing) throw new OpError("unknown_op");

      const env = readEnv(pctx.env);
      const tokenCaller = readCaller(pctx.context, env.tenant, { preserveUserId: Boolean(pctx.shellScope) });
      // The caller as the roles source sees them; set from the view once round trip 1 is in (rbac.source "iam").
      let caller = tokenCaller;
      if (isPing) return ping(pctx, req.args, caller, env, sdkOf);
      const d = def as OpDef;

      const args = parseArgs(d.args, req.args) as unknown;
      if (d.scope === "engine" && !caller.isEngine) throw new OpError("forbidden");

      const isCommand = d.kind === "command";
      const inflight = adapters.inflight ?? ownInflight;
      const facts = adapters.facts ?? processFacts;
      let slot: { settle(o: InflightOutcome, keep?: boolean): void; track(o: { deadlineAt: number; pending: () => number }): void } = {
        settle: () => undefined,
        track: () => undefined,
      };
      if (isCommand) {
        // A retry of a request that is still running (or finished after its answer timed out) gets that run's outcome.
        const key = `${name}|${caller.userId}|${requestId}`;
        for (let tries = 0; tries < 3; tries += 1) {
          const j = inflight.join(key, d.op);
          if (j.first) {
            slot = j;
            break;
          }
          if (!j.sameOp) throw new OpError("conflict");
          // A run past its deadline with nothing in flight will never answer: drop it and run fresh under the same requestId.
          if (j.stale) {
            inflight.abandon(key);
            continue;
          }
          const out = await untilDeadline(j.outcome);
          if (out.ok) return out.data;
          if (DETERMINISTIC_REFUSALS.includes(out.error.code)) throw out.error;
        }
      }
      const settleFailure = (e: unknown): void => slot.settle({ ok: false, error: isOpError(e) ? e : new OpError("internal") });

      try {
      const tokens = serviceTokens(env, sdkOf, clock, tokenHooks(pctx));
      const { raw, pending } = makeRaw(env, tokens, sdkOf, d.op, pctx, true);
      slot.track({ deadlineAt: deadline, pending });
      const ids = bindIds({ fn: name, op: d.op, requestId });
      const oplog = createOperationLog({ raw, fn: name, op: d.op, requestId, ids, caller });
      // The IAM admin module on the service identity, and the roles source of this request (factory rows or IAM).
      // The host's instance (Host A) when it passes one, else the same module on this function's service credentials.
      const iamAdmin =
        pctx.iamAdmin ??
        (adapters.iamAdmin
          ? adapters.iamAdmin({ env, tokens, sdk: sdkOf })
          : createIamAdmin({ client: serviceClient(env, sdkOf, tokens), now: clock, cache: iamCache }));
      const rbac = pctx.shellScope ? {
        view: async () => ({ source: "factory" as const, isSuperAdmin: false, platform: null, workspace: async () => null }),
        changed: async () => undefined, rememberOrg: () => undefined, iam: null,
      } : createRbacHandle({ raw, caches: rbacCaches, iam: iamAdmin, caller: tokenCaller, now: clock });
      // Blocks Utilities: built lazily, so a request that never asks costs nothing.
      const utilitiesCaller = pctx.utilitiesCaller && typeof pctx.utilitiesCaller.token === "string" && pctx.utilitiesCaller.token ? pctx.utilitiesCaller : null;
      const utilities = adapters.utilities
        ? adapters.utilities({ env, tokens, sdk: sdkOf, caller: utilitiesCaller })
        : createUtilitiesAccess({ env, sdk: sdkOf, tokens, caller: utilitiesCaller });
      const access = createAccess({ raw, caller, rbac });
      const argRec = isRec(args) ? args : {};
      const idArg = (key: string): string => {
        const val = argRec[key];
        if (typeof val !== "string" || val === "") throw new OpError("invalid_input", undefined, { field: key, rule: "id" });
        return val;
      };

      let anchor: Row | null = null;
      let projectId: string | null = null;
      const isProject = d.scope === "project";
      const pf = isProject ? d.projectFrom : undefined;
      const anchorId = pf ? idArg(pf.arg) : null;
      const directPid = isProject && !pf ? idArg("projectId") : null;
      // What the process remembers lets round trip 1 start the right reads; the rows read decide.
      const guessPid = directPid ?? (pf && anchorId ? facts.projectOf(pf.schema, anchorId) : null);
      const wsArg = d.scope === "workspace" ? idArg("workspaceId") : null;
      const guessWs = wsArg ?? (guessPid ? facts.workspaceOf(guessPid) : null);

      const fillProject = (row: Row | null | undefined): Row | null => {
        if (!row) return null;
        const out: Row = { ...row };
        for (const k of PROJECT_ROW_FIELDS) if (!(k in out) || out[k] === undefined) out[k] = null;
        return out;
      };
      const loadProjectRow = (pid: string): Promise<Row | null> => raw.get("Project", pid, [...PROJECT_ROW_FIELDS]).then(fillProject);

      // Round trip 1. An early op (self scope) starts its handler now: the handler's reads share this round trip and
      // its writes wait on `gate`, which opens once the account and replay checks below have passed.
      const early = d.early === true && d.scope === "self";
      type Settled<T> = { ok: true; v: T } | { ok: false; e: unknown };
      const settled = <T>(p: Promise<T>): Promise<Settled<T>> => p.then((v) => ({ ok: true as const, v }), (e: unknown) => ({ ok: false as const, e }));
      const unwrap = <T>(s: Settled<T>): T => {
        if (!s.ok) throw s.e;
        return s.v;
      };
      // Prefetch: the handler's own reads start in this round trip, on a read-only view of the memoised gateway built
      // with the same options as the post-auth gateways, so the handler's identical read is answered from the memo. A wrong
      // guess builds other filters and nothing is reused; the result is never used and a failure is ignored.
      if (d.prefetch) {
        const prefetch = d.prefetch;
        const known = d.scope === "workspace" ? !!guessWs : isProject ? !!guessWs && !!guessPid : true;
        if (known) {
          void Promise.resolve()
            .then(() => {
              const ro = readOnlyGateway(raw);
              const pbase = { fn: name, op: d.op, requestId, kind: d.kind };
              const ws = d.scope === "workspace" || isProject ? guessWs : null;
              const own = d.scope === "self" || d.scope === "platform" || d.scope === "engine";
              return prefetch({
                args: d.projectFrom && guessPid ? { ...argRec, projectId: guessPid } : args,
                projectId: isProject ? guessPid : null,
                workspaceId: ws,
                callerUserId: caller.userId,
                gw: own
                  ? null
                  : createScopedGateway(ro, {
                      ...pbase,
                      workspaceId: ws,
                      callerUserId: caller.userId,
                      aclSchemas,
                      readerIds: () => Promise.reject(new OpError("internal")),
                    }),
                svc: own ? createServiceGateway(ro, pbase) : null,
                raw: ro,
              });
            })
            .catch(() => undefined);
        }
      }
      const anchorFields = pf ? [...((LIB_FIELDS as Record<string, readonly string[]>)[pf.schema] ?? ["ItemId", "ProjectId"])] : [];
      const round1 = Promise.all([
        d.scope === "engine"
          ? Promise.resolve(null)
          : caller.identitySource === "iam"
            ? Promise.resolve(iamAccount(caller))
            : raw
                .find("Account", { where: f.eq("UserId", caller.userId), fields: [...LIB_FIELDS.Account], page: 1, pageSize: 1 })
                .then((r) => rowsOf(r)[0] ?? null),
        isCommand ? oplog.lookup() : Promise.resolve(null),
        guessWs ? settled(loadWorkspaceBundle(raw, guessWs, caller.userId, { command: isCommand })) : Promise.resolve(null),
        guessPid ? settled(loadProjectRow(guessPid)) : Promise.resolve(null),
        pf && anchorId ? raw.get(pf.schema, anchorId, anchorFields).then((r) => r ?? null) : Promise.resolve(null),
        d.scope === "platform" ? access.platformPermissions().then(() => undefined, () => undefined) : Promise.resolve(undefined),
        d.scope === "engine" ? Promise.resolve(undefined) : rbac.view().then(() => undefined, () => undefined),
      ]);
      round1.catch(() => undefined);
      // The caller's newest rows for a quota (round trip 1). Without atomic counters (MF-B03) a burst can overshoot by
      // the number of parallel requests.
      const quotaRead = startQuotaRead(raw, caller, d).catch(() => undefined);
      let account: Row | null = null;
      let replay: { replay: unknown } | null = null;
      let bundleRes: Settled<WorkspaceBundle> | null = null;
      let projectRes: Settled<Row | null> | null = null;
      let anchorRow: Row | null = null;
      let projectRow: Row | null = null;
      let bundle: WorkspaceBundle | null = null;
      let iamWorkspace: IamWorkspaceAccess | null = null;
      let workspaceId: string | null = wsArg;
      // Which project the anchor really belongs to, which workspace the Project row really names: loaded again when the
      // memo guessed wrong (the cold path costs one or two more rounds).
      const resolveScope = async (): Promise<void> => {
        if (d.scope === "workspace") {
          bundle = bundleRes ? unwrap(bundleRes) : null;
          return;
        }
        if (!isProject) return;
        let row: Row | null = projectRes ? unwrap(projectRes) : null;
        if (pf && anchorId) {
          const pid = anchorRow ? str(anchorRow.ProjectId) : "";
          if (!anchorRow || !pid) throw new OpError("not_found");
          facts.rememberAnchor(pf.schema, anchorId, pid);
          anchor = anchorRow;
          projectId = pid;
          if (pid !== guessPid) row = await loadProjectRow(pid);
        } else {
          projectId = directPid;
          if (!projectId) throw new OpError("not_found");
        }
        if (!row) {
          if (projectId) facts.forget(projectId);
          throw new OpError("not_found");
        }
        projectRow = row;
        const rowWs = str(row.WorkspaceId);
        if (!rowWs) throw new OpError("not_found");
        facts.rememberProject(projectId as string, rowWs);
        workspaceId = rowWs;
        bundle = guessWs === rowWs && bundleRes ? unwrap(bundleRes) : await loadWorkspaceBundle(raw, rowWs, caller.userId, { command: isCommand });
      };
      if (!early) {
        let r1;
        try {
          r1 = await round1;
        } catch (e) {
          settleFailure(e);
          throw e;
        }
        [account, replay, bundleRes, projectRes, anchorRow] = r1;
        try {
          if (caller.identitySource !== "iam") checkAccount(account, d.allowInactiveAccount === true);
          if (replay) {
            slot.settle({ ok: true, data: replay.replay }, d.record ? d.record(replay.replay as never) : true);
            return replay.replay;
          }
          await enforceQuota(await quotaRead, clock());
          await resolveScope();
          // rbac.source "iam": who the caller is (super admin) and what they hold in this workspace come from IAM.
          if (pctx.shellScope) {
            const shellBundle = bundle as WorkspaceBundle | null;
            if (d.scope !== "project" || workspaceId !== pctx.shellScope.workspaceId || projectId !== pctx.shellScope.projectId || !shellBundle?.membership || shellBundle.membership.Status !== "active") throw new OpError("forbidden");
            // The signed request supplies current project permissions. Persisted roles or factory IAM must not
            // promote a project-scoped Blocks principal to platform administrator.
            caller = { ...tokenCaller, roles: [], isSuperAdmin: false, isEngine: false };
            iamWorkspace = { roleKey: String(shellBundle.membership.RoleKey ?? ""), permissions: [...pctx.shellScope.permissions], organizationId: "" };
          } else if (d.scope !== "engine") {
            // A self-scope op needs no roles: an IAM outage leaves its caller as the token says.
            const view = d.scope === "self" ? await rbac.view().catch(() => null) : await rbac.view();
            caller = effectiveCaller(tokenCaller, view);
            const ws = bundle as WorkspaceBundle | null;
            if (view?.source === "iam" && ws?.workspace && workspaceId) iamWorkspace = await view.workspace(workspaceId);
          }
        } catch (e) {
          settleFailure(e);
          throw e;
        }
      }
      let gateOpen = !early;
      let openGate: () => void = () => undefined;
      let closeGate: (e: unknown) => void = () => undefined;
      const gate = new Promise<void>((resolve, reject) => {
        openGate = () => {
          gateOpen = true;
          resolve();
        };
        closeGate = reject;
      });
      gate.catch(() => undefined);
      if (!early) openGate();
      const gated = <T extends object>(target: T, methods: readonly string[]): T => {
        if (!early) return target;
        const out = { ...target } as unknown as Record<string, unknown>;
        for (const m of methods) {
          const original = (target as unknown as Record<string, unknown>)[m] as (...a: unknown[]) => Promise<unknown>;
          out[m] = (...a: unknown[]): Promise<unknown> =>
            gateOpen ? original.apply(target, a) : gate.then(() => original.apply(target, a));
        }
        return out as unknown as T;
      };
      const afterWork: Array<() => Promise<unknown>> = [];

      const attempt = pctx.run?.attempt ?? 1;
      const scope = { workspaceId, projectId, attempt };
      const armRefusal = (): void => {
        if (isCommand) refusal.record = (code) => oplog.recordFailed(code, scope);
      };
      if (!early) armRefusal();

      // Authorise.
      let auth: Awaited<ReturnType<typeof authorise>>;
      try {
        auth = await authorise({
          meta: {
            op: d.op,
            kind: d.kind,
            scope: d.scope,
            ...(d.permission !== undefined ? { permission: d.permission as string | readonly string[] } : {}),
            ...(d.platformOverride ? { platformOverride: d.platformOverride } : {}),
          },
          caller,
          bundle: bundle ?? { workspace: null, membership: null, roles: [], activeMemberUserIds: null },
          access,
          iamWorkspace,
        });
        refuseImpersonated(caller, d);
      } catch (e) {
        settleFailure(e);
        throw e;
      }
      const bundleNow = bundle ? iamBundle(bundle as WorkspaceBundle, iamWorkspace) : null;

      const audit = createAuditQueue({
        ids,
        op: d.op,
        caller,
        workspaceId,
        projectId,
        now: () => new Date(clock()),
      });
      if (auth.viaPlatform && workspaceId) audit.pushViaPlatform(workspaceId);
      const outbox = createOutbox({
        ids,
        op: d.op,
        requestId,
        caller,
        workspaceId,
        projectId,
        account: () => account,
        project: () => projectRow,
        warn: (data) => pctx.log?.warn?.(JSON.stringify({ fn: name, op: d.op, requestId, event: "notification.invalid", ...data })),
      });

      const acl = createAcl({
        raw,
        workspaceId,
        callerUserId: caller.userId,
        preloaded:
          bundleNow && workspaceId && bundleNow.workspace && bundleNow.activeMemberUserIds
            ? { workspaceId, status: bundleNow.workspace.Status, activeMemberUserIds: bundleNow.activeMemberUserIds }
            : null,
        aclSchemas: cfg.aclSchemas,
        ...(adapters.sleep ? { sleep: adapters.sleep } : {}),
      });
      const base = { fn: name, op: d.op, requestId, kind: d.kind };
      const gw = createScopedGateway(raw, {
        ...base,
        workspaceId,
        callerUserId: caller.userId,
        aclSchemas,
        readerIds: () => acl.readerIds(),
      });
      const svc = d.scope === "self" || d.scope === "platform" || d.scope === "engine" ? createServiceGateway(raw, base) : null;
      const refs = createRefs({
        raw,
        workspaceId,
        preloaded: { projectId, project: projectRow, activeMemberUserIds: bundleNow?.activeMemberUserIds ?? null },
      });
      const files = adapters.files
        ? adapters.files({ env, tokens, sdk: sdkOf, raw })
        : createFiles({
            client: serviceClient(env, sdkOf, tokens),
            workspaceIdOf: async (pid) => {
              if (projectRow && projectId === pid) return workspaceId as string;
              if (workspaceId) return str((await refs.project(pid, ["WorkspaceId"])).WorkspaceId);
              const row = await raw.get("Project", pid, [...LIB_FIELDS.Project]);
              if (!row) throw new OpError("not_found");
              return str(row.WorkspaceId);
            },
          });
      const jobs = createJobs({
        gw,
        raw,
        ids,
        caller,
        workspaceId,
        now: () => new Date(clock()),
        verifiedProjectId: d.scope === "project" && projectRow && projectId ? projectId : null,
        factoryDesignWorkerId: env.factoryDesignWorkerId,
        figmaDesignWorkerId: env.figmaDesignWorkerId,
        extractionWorkerId: env.extractionWorkerId,
      });
      const logLine = (level: "info" | "warn") => (event: string, data?: Record<string, string | number | boolean>): void => {
        const safe: Rec = {};
        for (const [k, val] of Object.entries(data ?? {})) if (!CREDENTIAL_KEY.test(k)) safe[k] = logValue(val);
        pctx.log?.[level]?.(JSON.stringify({ fn: name, op: d.op, requestId, event: String(event).slice(0, 64), ...safe }));
      };
      const log: OpLog = { info: logLine("info"), warn: logLine("warn") };

      const ctx: OpCtx = {
        fn: name,
        op: d.op,
        requestId,
        attempt,
        now: new Date(clock()),
        caller,
        account,
        workspace: bundleNow?.workspace ?? null,
        project: projectRow ?? null,
        membership: bundleNow?.membership ?? null,
        permissions: auth.permissions,
        platformPermissions: auth.platformPermissions,
        viaPlatform: auth.viaPlatform,
        anchor,
        remainingMs: () => Math.max(0, deadline - clock()),
        host: hostDescriptor(pctx),
      };
      const writeMethods = ["insert", "insertMany", "update", "updateMany", "remove"] as const;
      const deps: OpDeps = {
        verifyRepository: pctx.verifyRepository,
        gw: gated(gw, writeMethods),
        svc: svc ? gated(svc, writeMethods) : null,
        ids,
        acl: gated(acl, ["restamp"]),
        refs,
        access,
        audit: (e) => audit.push(e),
        guard: isCommand ? (e, key) => audit.guard(e, key, raw) : guarded((_e: never, _k: never) => Promise.resolve({ created: false, row: {} })),
        notify: isCommand ? (n) => outbox.push(n) : guarded((_n: never) => undefined),
        jobs: isCommand
          ? jobs
          : { ...jobs, create: guarded(jobs.create), cancel: guarded(jobs.cancel), retry: guarded(jobs.retry), cancelRows: guarded(jobs.cancelRows), relink: guarded(jobs.relink) },
        files: gated(files, ["presignUpload", "remove"]),
        fail,
        log,
        after: isCommand ? (work) => void afterWork.push(work) : guarded((_w: never) => undefined),
        callerIam:
          typeof pctx.callerToken === "string" && pctx.callerToken
            ? gated(createCallerIam({ sdk: sdkOf, apiUrl: env.apiUrl, tenant: env.tenant, token: pctx.callerToken }), name === "admin" ? ["createUser", "activate", "deactivate", "updateAccess", "resendActivation"] : ["exists", "listUsers", "createUser", "activate", "deactivate", "updateAccess", "resendActivation"])
            : null,
        identitySource: caller.identitySource,
        iamAdmin,
        rbac,
        utilities,
        flush: gated(
          {
            flush: async (): Promise<void> => {
              await Promise.all([audit.flush(raw), isCommand ? outbox.flush(raw) : Promise.resolve()]);
            },
          },
          ["flush"],
        ).flush,
      };

      const handlerArgs = d.projectFrom && projectId ? { ...argRec, projectId } : args;
      let timer: ReturnType<typeof setTimeout> | undefined;
      // The deadline promise is observed in the statement that makes it, so it can never reject unhandled.
      const overrun = ((): Promise<never> => {
        const p = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new OpError("timeout")), Math.max(0, deadline - clock()));
        });
        p.catch(() => undefined);
        return p;
      })();
      const within = <T>(p: Promise<T>): Promise<T> => Promise.race([p, overrun]);
      const running = Promise.resolve().then(() => {
        handlerStarted = true;
        if (pctx.stats) pctx.stats.handlerStart = pctx.stats.depth;
        return d.handler(ctx, handlerArgs, deps);
      });
      running.catch(() => undefined);
      // Host A only (one long-lived process that keeps running after it answers): an op that opts in is answered once its
      // own `after` writes have landed. The AuditEvent, notifications and Operation record of that same round finish right
      // after the answer, failed parts retried (each is re-entrant: a written row is never written twice). A retry of the
      // request meanwhile joins this run (inflight registry); one after a restart runs the handler again, which is exact
      // only for ops whose writes are all RequestKey-keyed (the reason it is opt-in). Host B (Blocks Logic Functions) may
      // freeze once it has answered, so there the bookkeeping stays before the answer.
      const lateBookkeeping = isCommand && d.bookkeepingAfterAnswer === true && ctx.host.kind === "local";
      // Its writes go outside the request's own accounting (its [fn] line, rounds and open calls): a call of it that never
      // finishes is logged on its own by the deadline gateway, a part that still fails after the retries by the warning below.
      let lateRaw: RawGateway | null = null;
      const lateGateway = (): RawGateway => (lateRaw ??= makeRaw(env, tokens, sdkOf, d.op, { ...pctx, stats: undefined }).raw);
      const finishBookkeeping = async (
        first: Promise<PromiseSettledResult<unknown>[]>,
        parts: ReadonlyArray<() => Promise<unknown>>,
      ): Promise<void> => {
        try {
          const pause = adapters.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
          let failed = (await first).flatMap((x, i) => (x.status === "rejected" ? [i] : []));
          for (let attempt = 1; failed.length > 0 && attempt <= LATE_BOOKKEEPING_RETRIES; attempt += 1) {
            await pause(LATE_BOOKKEEPING_RETRY_MS * attempt);
            const again = await Promise.allSettled(failed.map((i) => parts[i]()));
            failed = failed.filter((_, k) => again[k].status === "rejected");
          }
          if (failed.length === 0) return;
          // As when a flush fails before an answer: the Operation is not left "done", so a retry runs (and writes) again.
          if (failed.some((i) => i < 2)) await oplog.markFailedAfterFlush(lateGateway()).catch(() => undefined);
          const names = failed.map((i) => ["audit", "notify", "operation"][i]).join(",");
          pctx.log?.warn?.(JSON.stringify({ fn: name, op: d.op, requestId, event: "bookkeeping.failed", parts: names }));
        } catch {
          // late bookkeeping never throws into the process
        }
      };
      // The run's own completion: once the handler is done its bookkeeping and the Operation record are written even if
      // the answer already timed out, so the retry with the same requestId replays the outcome instead of running again.
      const onDone = async (value: unknown): Promise<unknown> => {
        await gate;
        if (pctx.stats) pctx.stats.handlerEnd = pctx.stats.depth;
        const data = value === undefined ? null : value;
        // One parallel round trip: audit, notifications, the handler's `after` writes, Operation record.
        const recording = isCommand && (d.record ? d.record(data as never) : true);
        const via = lateBookkeeping ? lateGateway() : raw;
        const bookkeeping = [
          () => audit.flush(via),
          () => outbox.flush(via),
          recording ? () => oplog.recordDone(data, scope, via) : () => Promise.resolve(),
        ];
        const books = Promise.allSettled(bookkeeping.map((work) => work()));
        const writes = Promise.allSettled(afterWork.map((work) => (async () => work())()));
        if (lateBookkeeping && !(await writes).some((x) => x.status === "rejected")) {
          // Every write a reader sees has landed: answer now; the bookkeeping of this round finishes on its own.
          void finishBookkeeping(books, bookkeeping);
          return data;
        }
        const [[a, o, r], rest] = await Promise.all([books, writes]);
        if (a.status === "rejected" || o.status === "rejected" || rest.some((x) => x.status === "rejected")) {
          await oplog.markFailedAfterFlush().catch(() => undefined);
          throw new OpError("unavailable");
        }
        if (r.status === "rejected") outcome = "operation-record-failed";
        return data;
      };
      const onFail = async (e: unknown): Promise<never> => {
        if (refusal.record && isOpError(e) && DETERMINISTIC_REFUSALS.includes(e.code)) await refusal.record(e.code).catch(() => undefined);
        throw e;
      };
      const completion = running.then(onDone, onFail);
      completion.catch(() => undefined);
      completion.then(
        (data) => slot.settle({ ok: true, data }, d.record ? d.record(data as never) : true),
        (e: unknown) => settleFailure(e),
      );
      let data: unknown;
      try {
        if (early) {
          try {
            [account, replay, bundleRes, projectRes, anchorRow] = await within(round1);
            if (caller.identitySource !== "iam") checkAccount(account, d.allowInactiveAccount === true);
          } catch (e) {
            settleFailure(e);
            closeGate(e);
            throw e;
          }
          if (replay) {
            slot.settle({ ok: true, data: replay.replay }, d.record ? d.record(replay.replay as never) : true);
            closeGate(new OpError("internal"));
            return replay.replay;
          }
          try {
            await within(enforceQuota(await within(quotaRead), clock()));
          } catch (e) {
            settleFailure(e);
            closeGate(e);
            throw e;
          }
          armRefusal();
          ctx.account = account;
          openGate();
        }
        data = await within(completion);
      } finally {
        if (timer) clearTimeout(timer);
      }
      // The run finished (and is recorded) after this request's own deadline: the answer is the timeout, the retry replays the record.
      if (clock() >= deadline) throw new OpError("timeout");
      return data;
      } catch (e) {
        if (!handlerStarted) settleFailure(e);
        throw e;
      }
    };

    let status: number;
    let body: Rec;
    try {
      const data = await execute();
      status = 200;
      body = { ok: true, data, serverNow: new Date(clock()).toISOString() };
    } catch (e) {
      const eb = toErrorBody(isOpError(e) ? e : null);
      status = eb.status;
      outcome = eb.error.code;
      const diag = (e as { diagnostic?: unknown } | null)?.diagnostic;
      if (diag && typeof diag === "object" && !Array.isArray(diag)) {
        const g = diag as Record<string, unknown>;
        const cut = (x: unknown): string => String(logValue(typeof x === "string" ? x : String(x ?? ""))).slice(0, 200);
        diagnostic = { source: cut(g.source), step: cut(g.step), status: Number(g.status) || 0, message: cut(g.message) };
      }
      body = { ok: false, error: eb.error, serverNow: new Date(clock()).toISOString() };
      if (refusal.record && !handlerStarted && DETERMINISTIC_REFUSALS.includes(eb.error.code)) {
        await refusal.record(eb.error.code).catch(() => undefined);
      }
    }
    const line = JSON.stringify({ fn: name, op, requestId, code: status === 200 ? "ok" : outcome, ms: Math.max(0, clock() - started), ...(diagnostic ? { diag: diagnostic } : {}) });
    try {
      if (status === 200) pctx.log?.info?.(line);
      else pctx.log?.warn?.(line);
    } catch {
      // logging never changes the answer
    }
    return answer(status, body);
  }

  const handler = ((input: unknown, ctx: PlatformCtx) => dispatch(input, ctx)) as FunctionHandler;
  handler.meta = meta;
  handler.dispatch = dispatch;
  return handler;
}
