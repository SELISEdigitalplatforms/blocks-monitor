import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createAssertionVerifier, ShellRefused, type ShellIdentity } from "./assertion.ts";
import { createShellOnboarding, shellBootstrap, type ShellScope } from "./onboarding.ts";
import { enforceShellFunction, scopeReads, shellRequestId } from "./scope.ts";
import { serviceClient, serviceTokens } from "../../functions/_lib/serviceToken.ts";
import { defaultSdk } from "../../functions/_lib/sdk.ts";
import { createRawGateway } from "../../functions/_lib/gateway.ts";
import { createFiles } from "../../functions/_lib/storage.ts";
import { buildBatchQuery, splitBatchAnswer } from "../../functions/_lib/batch.ts";
import type { FunctionHandler, RepositoryVerifier } from "../../functions/_lib/types.ts";
import { liveS1Catalog, validateDataRequest } from "../fnHost/dataRead.ts";
import { readBody, SECURITY_HEADERS } from "../fnHost/middleware.ts";
import { createApiMiddleware } from "../api/middleware.ts";
import type { CallerOp, CallerReads, DataRead } from "../api/brief/access.ts";
import { parsePublishedReading } from "../api/extraction/process.ts";
import type { BlocksFunctionName } from "../blocks/host.ts";
import type { MiddlewareStack, RuntimeOptions } from "../blocks/runtime.ts";
import { createRepositoryBroker } from "./repositories.ts";
import { createProjectActionLane, setProjectKind } from "./projectKind.ts";

function send(res: ServerResponse, status: number, body: unknown) {
  if (res.writableEnded) return;
  res.statusCode = status;
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
  res.end(JSON.stringify(body));
}
function parsedBody(raw: Buffer): Record<string, unknown> {
  let body: unknown;
  try { body = JSON.parse(raw.toString("utf8")); } catch { throw new ShellRefused(400, "invalid_input"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ShellRefused(400, "invalid_input");
  return body as Record<string, unknown>;
}
function replayRequest(req: IncomingMessage, raw: Buffer): IncomingMessage {
  const replay = new PassThrough() as unknown as IncomingMessage;
  for (const key of ["headers", "method", "url", "socket", "httpVersion", "httpVersionMajor", "httpVersionMinor"] as const) {
    Object.defineProperty(replay, key, { value: req[key], writable: true, configurable: true });
  }
  (replay as unknown as PassThrough).end(raw);
  return replay;
}

/** Internal service surface. Every API request must carry a new body-bound assertion from Genesis. */
export function mountShellRuntime(stack: MiddlewareStack, o: RuntimeOptions,
  loadRouter: (name: BlocksFunctionName) => Promise<FunctionHandler>,
  repositoryVerifier?: (scope: ShellScope, req: IncomingMessage) => RepositoryVerifier,
): { stop(): void } {
  const key = o.env.MF_BLOCKS_SHELL_KEY ?? "";
  const verify = createAssertionVerifier(key);
  const env = { apiUrl: o.apiOrigin, tenant: o.env.MF_BLOCKS_TENANT ?? "", clientId: o.env.MF_SVC_CLIENT_ID ?? "", clientSecret: o.env.MF_SVC_CLIENT_SECRET ?? "" };
  if (!env.tenant || !env.clientId || !env.clientSecret) throw new Error("Blocks shell requires the MADP service identity");
  const tokens = serviceTokens(env, defaultSdk);
  const clientOf = serviceClient(env, defaultSdk, tokens);
  const rawGateway = createRawGateway({ env, sdk: defaultSdk, tokens });
  const importMetadata = createShellOnboarding(rawGateway, Date.now, (o.env.MF_BLOCKS_SHELL_WRITE_PERMISSIONS ?? "").split(",").map((p) => p.trim()).filter(Boolean));
  const metadata = new Map<string, { until: number; scope: ShellScope }>();
  const users = new Map<string, { until: number; count: number; active: number }>();
  let activeRequests = 0;
  function enter(identity: ShellIdentity) {
    const stamp = Date.now();
    for (const [entry, value] of users) if (value.until <= stamp && value.active === 0) users.delete(entry);
    const actorKey = JSON.stringify([identity.tenantId, identity.userId]);
    let user = users.get(actorKey);
    if (!user) {
      if (users.size >= 10_000) throw new ShellRefused(503, "unavailable");
      user = { until: stamp + 60_000, count: 0, active: 0 }; users.set(actorKey, user);
    }
    if (user.until <= stamp) { user.until = stamp + 60_000; user.count = 0; }
    if (user.count >= 240 || user.active >= 8) throw new ShellRefused(429, "rate_limited");
    if (activeRequests >= 128) throw new ShellRefused(503, "unavailable");
    user.count += 1; user.active += 1; activeRequests += 1;
    return () => { user!.active -= 1; activeRequests -= 1; };
  }
  async function scopeFor(identity: ShellIdentity, refresh: boolean) {
    const cacheKey = JSON.stringify([identity.tenantId, identity.userId, identity.permissions]);
    const hit = metadata.get(cacheKey);
    // Each request still verifies a fresh assertion. This cache only avoids re-importing immutable metadata on every
    // batch read; changed permissions use another key and the current assertion always supplies the actor.
    if (!refresh && hit && hit.until > Date.now()) return { ...hit.scope, identity };
    const scope = await importMetadata(identity);
    for (const [entry, value] of metadata) if (value.until <= Date.now()) metadata.delete(entry);
    if (metadata.size >= 1000) metadata.delete(metadata.keys().next().value!);
    metadata.set(cacheKey, { until: Date.now() + 15_000, scope });
    return scope;
  }
  const repositories = createRepositoryBroker(o.env);
  const projectAction = createProjectActionLane();
  const catalog = liveS1Catalog(o.root);
  const contexts = new WeakMap<IncomingMessage, ShellScope>();
  const files = createFiles({ client: clientOf, workspaceIdOf: async () => { throw new ShellRefused(403); } });
  const fnEnv = {
    BLOCKS_API_URL: env.apiUrl, BLOCKS_TENANT: env.tenant, SVC_CLIENT_ID: env.clientId, SVC_CLIENT_SECRET: env.clientSecret,
    ...(o.env.MF_FACTORY_DESIGN_WORKER_ID ? { FACTORY_DESIGN_WORKER_ID: o.env.MF_FACTORY_DESIGN_WORKER_ID } : {}),
    ...(o.env.MF_FIGMA_DESIGN_WORKER_ID ? { FIGMA_DESIGN_WORKER_ID: o.env.MF_FIGMA_DESIGN_WORKER_ID } : {}),
    ...(o.env.MF_EXTRACTION_WORKER_ID ? { EXTRACTION_WORKER_ID: o.env.MF_EXTRACTION_WORKER_ID } : {}),
  };
  async function reads(scope: ShellScope, input: DataRead[]) {
    const known = catalog();
    if (!validateDataRequest({ reads: input }, known).ok) throw new ShellRefused(400, "invalid_input");
    const validated = validateDataRequest({ reads: scopeReads(input, known, scope) }, known);
    if (!validated.ok) throw new ShellRefused(400, "invalid_input");
    const sdk = await clientOf();
    const results = [];
    for (let start = 0; start < validated.reads.length; start += 20) {
      const chunk = validated.reads.slice(start, start + 20);
      const answer = await sdk.data.graphql(buildBatchQuery(chunk.map((r) => r.member)));
      results.push(...splitBatchAnswer(answer, chunk.length).map((part, i) => {
        if (!part.ok) return { ok: false as const, error: { code: "unavailable" } };
        const read = chunk[i];
        const totalCount = part.totalCount ?? part.items.length;
        return { ok: true as const, items: part.items, totalCount, pageNo: read.pageNo, pageSize: read.pageSize,
          hasNextPage: part.totalCount === null ? part.items.length >= read.pageSize : read.pageNo * read.pageSize < totalCount };
      }));
    }
    return results;
  }
  async function dispatch(req: IncomingMessage, scope: ShellScope, name: BlocksFunctionName, body: Record<string, unknown>) {
    if (!["project", "delivery", "collab"].includes(name)) throw new ShellRefused(403, "operation_not_allowed");
    if (typeof body.op !== "string" || !body.args || typeof body.args !== "object" || Array.isArray(body.args) || typeof body.requestId !== "string") throw new ShellRefused(400, "invalid_input");
    const router = await loadRouter(name);
    const meta = router.meta.ops.find((op) => op.op === body.op);
    if (!meta) throw new ShellRefused(404, "not_found");
    enforceShellFunction(meta, body.args as Record<string, unknown>, scope);
    // Request IDs are namespaced by actual caller and tenant, so replay lookup can never return another project's operation.
    const requestId = shellRequestId(scope.projectId, scope.identity.userId, body.requestId);
    const run = () => router.dispatch({ method: "POST", path: `/${name}`, query: {}, headers: {}, body: { ...body, requestId } }, {
      context: { tenantId: env.tenant, userId: scope.identity.userId, email: scope.identity.email, displayName: scope.identity.displayName,
        roles: [], permissions: scope.permissions, organizationId: scope.workspaceId, isAuthenticated: true, impersonated: false, identitySource: "iam", applicationDomain: new URL(o.appOrigin).hostname },
      shellScope: { workspaceId: scope.workspaceId, projectId: scope.projectId, permissions: scope.permissions },
      verifyRepository: repositoryVerifier ? repositoryVerifier(scope, req) : async (_userId, repo) => repositories.verifyRepository(scope.identity, repo),
      env: fnEnv, run: { id: `blocks-shell-${randomUUID()}`, attempt: 1 },
      host: { kind: "local", tokenVerification: "iam+signature", csp: "enforce", maxBodyBytes: 15_000_000, perUserPerMinute: 240, perUserInFlight: 8, globalInFlight: 128 },
    });
    return meta.kind === "command" ? projectAction(scope.projectId, run) : run();
  }
  const callerReads: CallerReads = async (req, _res, input) => {
    const scope = contexts.get(req);
    if (!scope) return { ok: false, status: 401 };
    try { return { ok: true, userId: scope.identity.userId, results: await reads(scope, input) }; }
    catch (error) { return { ok: false, status: error instanceof ShellRefused ? error.status : 503 }; }
  };
  const callerOp: CallerOp = async (req, _res, op, args) => {
    const scope = contexts.get(req);
    if (!scope) return { ok: false, status: 401, code: "unauthenticated" };
    try {
      const answer = await dispatch(req, scope, "project", { op, args, requestId: randomUUID() });
      if (answer.body.ok) return { ok: true, data: answer.body.data };
      return { ok: false, status: answer.statusCode, code: answer.body.error.code };
    } catch (error) { return { ok: false, status: error instanceof ShellRefused ? error.status : 503, code: error instanceof ShellRefused ? error.code : "unavailable" }; }
  };
  const api = createApiMiddleware({ legacyGithub: false, legacyEngine: false, callerReads, callOp: callerOp,
    readings: async (objectId) => {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(objectId)) return null;
      const { url } = await files.downloadUrl(objectId);
      if (!url.startsWith("https://")) return null;
      const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
      return response.ok ? parsePublishedReading(await response.json()) : null;
    },
  });
  stack.use((req, res, next) => {
    if (!(req.url ?? "").startsWith("/api/")) return next();
    void (async () => {
      const bytes = await readBody(req, 15_000_000, 10_000);
      if (typeof bytes === "string") throw new ShellRefused(bytes === "timeout" ? 408 : 413, "invalid_input");
      const identity = verify(req.method ?? "GET", req.url ?? "/", req.headers, bytes);
      const leave = enter(identity);
      try {
      const pathname = (req.url ?? "").split("?")[0];
      const scope = await scopeFor(identity, pathname === "/api/shell/bootstrap");
      if (pathname === "/api/shell/bootstrap" && req.method === "GET") return send(res, 200, { ok: true, data: shellBootstrap(scope) });
      if (pathname === "/api/shell/project-kind" && req.method === "POST") {
        const body = parsedBody(bytes);
        const project = await projectAction(scope.projectId, () => setProjectKind(rawGateway, scope, body));
        return send(res, 200, { ok: true, data: { project } });
      }
      if (pathname === "/api/data" && req.method === "POST") {
        const body = parsedBody(bytes);
        if (!Array.isArray(body.reads)) throw new ShellRefused(400, "invalid_input");
        return send(res, 200, { results: await reads(scope, body.reads as DataRead[]) });
      }
      const fn = /^\/api\/fn\/(project|delivery|collab)$/.exec(pathname);
      if (fn && req.method === "POST") {
        const answer = await dispatch(req, scope, fn[1] as BlocksFunctionName, parsedBody(bytes));
        return send(res, answer.statusCode, answer.body);
      }
      // No SDK HTTP passthrough, auth mutation, platform administration or legacy route exists in shell mode.
      if (/^\/api\/(blocks|auth|github|public)\//.test(pathname)) throw new ShellRefused(403, "operation_not_allowed");
      const replay = replayRequest(req, bytes);
      contexts.set(replay, scope);
      await new Promise<void>((resolve) => {
        res.once("finish", resolve); res.once("close", resolve);
        api(replay, res, () => send(res, 404, { ok: false, error: { code: "not_found" } }));
      });
      } finally { leave(); }
    })().catch((error) => send(res, error instanceof ShellRefused ? error.status : 503, { ok: false, error: { code: error instanceof ShellRefused ? error.code : "unavailable" } }));
  });
  return { stop() { /* This service starts no background engine or purge work. */ } };
}
