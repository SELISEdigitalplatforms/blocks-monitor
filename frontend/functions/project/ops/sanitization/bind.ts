/**
 * The single adapter between the sanitization op table and the mf-project
 * router. It imports nothing from functions/_lib: the coordinator writes
 * `toContext` from L2's handler context (caller guard, Account, Operation,
 * membership, scoped gateway, jobs helper) and passes it in.
 */
import { OpFailure } from "./common";
import type { OpContext, OpResult, OpTable } from "./ports";

export function bindSanitizationOps<RouterCtx>(
  table: OpTable,
  toContext: (routerCtx: RouterCtx, args: Record<string, unknown>) => Promise<OpContext>,
): Readonly<Record<string, (args: Record<string, unknown>, routerCtx: RouterCtx) => Promise<OpResult>>> {
  const out: Record<string, (args: Record<string, unknown>, routerCtx: RouterCtx) => Promise<OpResult>> = {};
  for (const name of Object.keys(table)) {
    const handler = table[name];
    out[name] = async (args, routerCtx) => {
      const ctx = await toContext(routerCtx, args);
      try {
        return await handler(args, ctx);
      } catch (e) {
        if (e instanceof OpFailure) return e.result;
        throw e;
      }
    };
  }
  return Object.freeze(out);
}
