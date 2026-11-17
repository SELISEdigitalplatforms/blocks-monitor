// The engine hook. In production the MADP engine (engine/) claims the EngineJob rows the ops queue and moves them along
// (claimed -> running with Progress -> succeeded / failed, plus the output rows of its kind). Here the queued jobs land in
// the local store like every other row, and this hook is where an engine driver plugs in:
//
//   import { registerEngineDriver } from "./index.ts";
//   registerEngineDriver({ name: "madp-engine", start(ctx) { ...; return () => stop(); } });
//
// ctx.queued() lists the jobs waiting now, ctx.onQueued(fn) tells about every newly queued job (and a job put back to
// queued by a retry), and ctx.gateway is the service gateway (RawGateway with the hosted semantics) the driver writes
// EngineJob progress and output rows with. Rows a driver writes should follow docs/ENGINE-CONTRACT.md and
// src/domain/engineJob.ts (applyJobEvent) so the screens read them as they read the real engine's.
// Without a registered driver jobs stay queued, which is exactly what the screens show while the engine is busy.
// The local MADP engine (local.ts, driver.ts, run.ts, kinds/) registers itself as "madp-engine".
import type { RawGateway, Row } from "../../../functions/_lib/gateway";
import type { RowStore } from "../rowStore.ts";

export interface EngineHookContext {
  gateway: RawGateway;
  store: RowStore;
  queued(): Row[];
  onQueued(fn: (job: Row) => void): () => void;
  log(line: string): void;
}

export interface EngineDriver {
  name: string;
  /** Starts the driver; returns its stop function. */
  start(ctx: EngineHookContext): () => void;
}

const DRIVERS = Symbol.for("madp.factory.local.engineDrivers");

/** Registers (or replaces, by name) the driver that advances queued jobs. */
export function registerEngineDriver(driver: EngineDriver): void {
  const g = globalThis as unknown as Record<symbol, Map<string, EngineDriver> | undefined>;
  (g[DRIVERS] ??= new Map()).set(driver.name, driver);
}

export function engineDrivers(): EngineDriver[] {
  const g = globalThis as unknown as Record<symbol, Map<string, EngineDriver> | undefined>;
  return [...(g[DRIVERS]?.values() ?? [])];
}

/** Wires the hook to the store: queued EngineJob rows reach the listeners; every registered driver is started. */
export function startEngineHook(o: { gateway: RawGateway; store: RowStore; log(line: string): void }): () => void {
  const listeners = new Set<(job: Row) => void>();
  const ctx: EngineHookContext = {
    gateway: o.gateway,
    store: o.store,
    queued: () => o.store.rows("EngineJob").filter((j) => j.Status === "queued"),
    onQueued(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    log: o.log,
  };
  o.store.onChange("engine-hook", (c) => {
    if (c.schema !== "EngineJob" || c.row.Status !== "queued" || (c.kind !== "insert" && c.kind !== "update")) return;
    for (const fn of [...listeners]) {
      try {
        fn(c.row);
      } catch {
        /* a driver never breaks a write */
      }
    }
  });
  const stops = engineDrivers().map((d) => {
    o.log(`[engine] driver ${d.name} started`);
    return d.start(ctx);
  });
  return () => {
    o.store.onChange("engine-hook", null);
    for (const stop of stops) stop();
    listeners.clear();
  };
}
