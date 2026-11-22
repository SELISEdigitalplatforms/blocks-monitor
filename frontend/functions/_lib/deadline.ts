// A deadline for every gateway call: one hung Blocks call must not hold a request for the router's whole budget.
// Each call gets its own AbortController and timer. Reads get a 20 s hard deadline and are hedged once; writes get
// 30 s and are never hedged or retried, because Blocks often completes a slow write and aborting it early turns a
// successful save into an error.
import { AsyncLocalStorage } from "node:async_hooks";
import { OpError } from "./errors";
import type { RawGateway } from "./gateway";
import type { UnfinishedCall } from "./stats";

export const READ_DEADLINE_MS = 20_000;
export const WRITE_DEADLINE_MS = 30_000;
export const HEDGE_AFTER_MS = 3_000;

export interface TimedGateway extends RawGateway {
  /** Calls started and not yet settled or timed out (a hedged read counts once). */
  pending(): number;
}

const signals = new AsyncLocalStorage<AbortSignal>();

/** The signal of the gateway call running right now; the SDK fetch merges it so the request is really aborted. */
export function currentCallSignal(): AbortSignal | undefined {
  return signals.getStore();
}

/** Runs fn with the given call signal (or with none, shielding it from the caller's own signal). */
export function withCallSignal<T>(signal: AbortSignal | undefined, fn: () => T): T {
  return signal ? signals.run(signal, fn) : signals.exit(fn);
}

const METHODS = ["get", "find", "findAll", "insert", "insertMany", "update", "updateMany", "remove"] as const;
const READS = new Set<string>(["get", "find", "findAll"]);

export function deadlineGateway(
  inner: RawGateway,
  o: {
    /** Legacy override for both kinds; readMs / writeMs win over it. */
    callMs?: number;
    readMs?: number;
    writeMs?: number;
    hedgeMs?: number;
    now?: () => number;
    onUnfinished?: (u: UnfinishedCall) => void;
  } = {},
): TimedGateway {
  const readMs = o.readMs ?? o.callMs ?? READ_DEADLINE_MS;
  const writeMs = o.writeMs ?? o.callMs ?? WRITE_DEADLINE_MS;
  const hedgeMs = o.hedgeMs ?? HEDGE_AFTER_MS;
  const now = o.now ?? Date.now;
  let pending = 0;
  const out = {} as Record<string, unknown>;

  for (const method of METHODS) {
    const isRead = READS.has(method);
    const callMs = isRead ? readMs : writeMs;
    out[method] = (...args: unknown[]): Promise<unknown> => {
      const start = now();
      const controllers: AbortController[] = [];
      const attempt = (): Promise<unknown> => {
        const ctl = new AbortController();
        controllers.push(ctl);
        return signals.run(ctl.signal, () => (inner[method] as (...a: unknown[]) => Promise<unknown>)(...args));
      };
      // A synchronous argument error from inner propagates unchanged.
      const first = attempt();
      pending += 1;
      return new Promise<unknown>((resolve, reject) => {
        let done = false;
        let hedgeTimer: ReturnType<typeof setTimeout> | undefined;
        let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
        let running = 1;
        let firstError: { e: unknown } | undefined;
        const finish = (settle: () => void): void => {
          if (done) return;
          done = true;
          pending -= 1;
          clearTimeout(hedgeTimer);
          clearTimeout(deadlineTimer);
          settle();
        };
        const abortAll = (except?: AbortController): void => {
          for (const c of controllers) if (c !== except) c.abort();
        };
        const watch = (p: Promise<unknown>, ctl: AbortController): void => {
          p.then(
            (value) => {
              running -= 1;
              finish(() => {
                abortAll(ctl);
                resolve(value);
              });
            },
            (error: unknown) => {
              running -= 1;
              firstError ??= { e: error };
              if (running === 0) finish(() => reject(firstError!.e));
            },
          );
        };
        watch(first, controllers[0]);
        deadlineTimer = setTimeout(() => {
          if (done) return;
          finish(() => {
            abortAll();
            try {
              o.onUnfinished?.({ schema: typeof args[0] === "string" ? args[0] : "", method, ms: now() - start });
            } catch {
              /* a report must not change the outcome */
            }
            reject(new OpError("timeout"));
          });
        }, callMs);
        if (isRead && hedgeMs < callMs) {
          hedgeTimer = setTimeout(() => {
            hedgeTimer = undefined;
            if (done) return;
            try {
              const second = attempt();
              running += 1;
              watch(second, controllers[controllers.length - 1]);
            } catch (error) {
              firstError ??= { e: error };
            }
          }, hedgeMs);
        }
      });
    };
  }
  (out as { pending: () => number }).pending = () => pending;
  return out as unknown as TimedGateway;
}
