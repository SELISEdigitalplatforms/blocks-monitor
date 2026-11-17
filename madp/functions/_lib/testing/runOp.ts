// Test kit only: runs one request through the REAL router with fake adapters.
import type { IamAdminApi } from "../iamAdmin";
import type { UtilitiesCaller } from "../blocksUtilities";
import type { UtilitiesAccess } from "../../../src/domain/blocksUtilities";
import type { RbacCaches } from "../rbacSource";
import { createFactMemo, type FactMemo } from "../factMemo";
import { createInflight, type InflightRegistry } from "../inflight";
import { createFunction } from "../router";
import { uuid5 } from "../ids";
import { fakeCtx, type FakeCtx } from "./fakeCtx";
import { memoryGateway, type MemoryGateway } from "./memoryGateway";
import { aclSchemasFromS1 } from "./schemaRules";

export type RunOpResult = { status: number; body: any; gateway: MemoryGateway; ctx: FakeCtx };

let counter = 0;

export async function runOp(
  fn: string,
  ops: unknown,
  o: {
    ctx?: FakeCtx;
    gateway?: MemoryGateway;
    request: { op: string; args?: unknown; requestId?: string } | string | Record<string, unknown>;
    files?: unknown;
    now?: () => number | Date;
    facts?: FactMemo;
    inflight?: InflightRegistry;
    gatewayDeadline?: { callMs?: number; hedgeMs?: number } | null;
    /** The IAM admin module the router hands the ops (a fake); default: none (IAM unavailable). */
    iamAdmin?: IamAdminApi | null;
    /** Roles source caches shared between calls (cache tests); default: fresh per call. */
    rbacCaches?: RbacCaches;
    /** Blocks Utilities as the router hands it to the ops (a client over a fake HTTP layer); default: none. The caller
     *  the host would pass is handed to the factory. */
    utilities?: ((caller: UtilitiesCaller | null) => UtilitiesAccess | null) | null;
  },
): Promise<RunOpResult> {
  const ctx = o.ctx ?? fakeCtx();
  const gateway = o.gateway ?? memoryGateway();
  const req = o.request;
  const envelope =
    typeof req === "object" && typeof (req as any).op === "string" && !("method" in req)
      ? {
          op: (req as any).op,
          requestId: (req as any).requestId ?? uuid5(`runop:${++counter}:${(req as any).op}`),
          args: (req as any).args ?? {},
        }
      : req;
  const handler = createFunction(
    { name: fn, ops, aclSchemas: aclSchemasFromS1() } as never,
    {
      sdk: ctx.sdk,
      rawGateway: () => gateway,
      files: o.files,
      now: o.now ? () => { const t = o.now!(); return t instanceof Date ? t.getTime() : t; } : undefined,
      gatewayDeadline: o.gatewayDeadline,
      facts: o.facts ?? createFactMemo(),
      inflight: o.inflight ?? createInflight(),
      iamAdmin: () => o.iamAdmin ?? null,
      utilities: (a: { caller: UtilitiesCaller | null }) => (o.utilities ? o.utilities(a.caller) : null),
      ...(o.rbacCaches ? { rbacCaches: o.rbacCaches } : {}),
    } as never,
  ) as unknown as { dispatch(request: unknown, platformCtx: unknown): Promise<{ statusCode: number; body: unknown }> };
  const res = await handler.dispatch(envelope, ctx.platformCtx);
  return { status: res.statusCode, body: res.body, gateway, ctx };
}
