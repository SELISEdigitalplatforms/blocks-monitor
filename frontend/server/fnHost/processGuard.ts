// Keeps the dev server alive when a promise rejects with nobody listening: log it and carry on, never exit.
const KEY = Symbol.for("mf.fnHost.processGuard");

interface GuardState {
  log: (line: string) => void;
  onRejection: (reason: unknown) => void;
  onException: (err: unknown) => void;
}

const describe = (kind: string, reason: unknown): string => {
  const name = reason instanceof Error ? reason.name : typeof reason;
  const raw = reason instanceof Error ? reason.message : String(reason);
  const message = raw.replace(/\?[^\s"')]*/g, "").slice(0, 300);
  const stack = reason instanceof Error && reason.stack ? reason.stack.split("\n").slice(1, 6).join("\n").replace(/\?[^\s"')]*/g, "") : "";
  return `[fn] host kept serving after ${kind}: ${name}: ${message}${stack ? `\n${stack}` : ""}`;
};

export function installProcessGuard(log: (line: string) => void): () => void {
  const g = globalThis as unknown as Record<symbol, GuardState | undefined>;
  let state = g[KEY];
  if (state) state.log = log;
  else {
    const made: GuardState = {
      log,
      onRejection: (reason) => {
        try {
          made.log(describe("an unhandled rejection", reason));
        } catch {
          /* logging never stops the host */
        }
      },
      onException: (err) => {
        try {
          made.log(describe("an uncaught exception", err));
        } catch {
          /* logging never stops the host */
        }
      },
    };
    process.on("unhandledRejection", made.onRejection);
    process.on("uncaughtException", made.onException);
    g[KEY] = state = made;
  }
  return () => {
    const cur = g[KEY];
    if (!cur) return;
    process.removeListener("unhandledRejection", cur.onRejection);
    process.removeListener("uncaughtException", cur.onException);
    g[KEY] = undefined;
  };
}
