// Work that needs a package with process-wide state runs in a child Node process started from this folder, so from the
// release the calling code belongs to, and never inside the engine worker's own process.
//
// The engine worker keeps one process across installs and loads each release's code as a new code generation
// (server/blocks/engineWorker/start.mjs). The packages that code imports come from that release's node_modules and are
// loaded next to the copies of the earlier releases, which stay loaded until the process ends. A package that keeps
// state for the whole process breaks there:
//   - @playwright/test refuses a second copy ("Requiring @playwright/test second time"), so no writer that imported it
//     could be loaded after an install;
//   - pdfjs-dist (pdf-parse) takes the worker handler and the @napi-rs/canvas classes that the first copy put on
//     globalThis, so after an install with another pdfjs version no PDF could be read.
// A child process has its own globals, module cache and native addons, and it ends with its work.
//
//   browser.mjs   Chromium through Playwright: the check of a Factory design, the screen pictures
//   pdf.mjs       the text of a PDF through pdf-parse
//
// child.mjs runs one of them. A task module exports `handlers` ({ name: async (payload) => result }) and may export
// `cleanup` (run before the child exits). Payloads and results cross as structured clones (Uint8Array included); a
// handler's error comes back with its name, message and code. Each call has a time limit, past which the child is
// closed. The child exits when close() is called and, on its own, when this process ends (its IPC channel closes).
import { fork } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type IsolatedTask = "browser" | "pdf";

/** How long a child may take to finish its cleanup (a browser closing) after close(), before it is killed. */
const CLOSE_GRACE_MS = 5_000;

export interface IsolatedChild {
  /** Runs one handler of the task in the child. Rejects with the handler's error, or when the child ended or did not
   *  answer within `timeoutMs` (the child is closed then). */
  call<T>(op: string, payload?: unknown, o?: { timeoutMs?: number }): Promise<T>;
  /** Ends the child: its cleanup runs, then it exits (killed when it has not after a few seconds). */
  close(): Promise<void>;
  /** False once the child has ended. */
  readonly alive: boolean;
}

/** The child's entry, next to this file in the same release (resolved when a child starts). */
export function isolatedEntry(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "child.mjs");
}

const errorOf = (e: { name?: unknown; message?: unknown; code?: unknown } | null | undefined): Error => {
  const error = new Error(typeof e?.message === "string" ? e.message : "The helper process failed") as Error & { code?: unknown };
  if (typeof e?.name === "string" && e.name) error.name = e.name;
  if (e?.code !== undefined) error.code = e.code;
  return error;
};

const lastLine = (text: string): string => text.trim().split("\n").filter((l) => l.trim()).pop()?.slice(0, 300) ?? "";

/** Starts a child process for one task. Close it when the work is done (runIsolated does that for one call). */
export function startIsolated(task: IsolatedTask): IsolatedChild {
  const child = fork(isolatedEntry(), [task], {
    serialization: "advanced",
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    // none of this process's flags (an inspector port, a loader): the child is plain Node
    execArgv: [],
  });
  let output = "";
  const keep = (d: Buffer) => {
    output = (output + d.toString()).slice(-4000);
  };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);

  let ended = false;
  let next = 1;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void; timer: ReturnType<typeof setTimeout> | null }>();
  const settleAll = (why: string) => {
    for (const p of pending.values()) {
      if (p.timer) clearTimeout(p.timer);
      p.reject(new Error(why));
    }
    pending.clear();
  };
  let markEnded: () => void = () => undefined;
  const exited = new Promise<void>((resolve) => {
    markEnded = resolve;
  });
  const end = (why: string) => {
    if (ended) return;
    ended = true;
    settleAll(why);
    markEnded();
  };
  child.once("exit", (code, signal) => {
    const last = lastLine(output);
    end(`The ${task} helper ended (${signal ? `signal ${signal}` : `code ${code}`})${last ? `: ${last}` : ""}`);
  });
  child.once("error", (e) => end(`The ${task} helper could not run: ${e.message}`));
  child.on("message", (m: { id?: number; ok?: boolean; value?: unknown; error?: { name?: unknown; message?: unknown; code?: unknown } }) => {
    const p = typeof m?.id === "number" ? pending.get(m.id) : undefined;
    if (!p) return;
    pending.delete(m.id!);
    if (p.timer) clearTimeout(p.timer);
    if (m.ok) p.resolve(m.value);
    else p.reject(errorOf(m.error));
  });

  async function close(): Promise<void> {
    if (!ended) {
      // the child's cleanup runs on the disconnect, then it exits
      if (child.connected) child.disconnect();
      const killer = setTimeout(() => {
        if (!ended) child.kill("SIGKILL");
      }, CLOSE_GRACE_MS);
      await exited;
      clearTimeout(killer);
    }
  }

  return {
    get alive() {
      return !ended;
    },
    call<T>(op: string, payload?: unknown, o: { timeoutMs?: number } = {}): Promise<T> {
      if (ended || !child.connected) return Promise.reject(new Error(`The ${task} helper is not running`));
      const id = next++;
      return new Promise<T>((resolve, reject) => {
        const timer = o.timeoutMs && o.timeoutMs > 0
          ? setTimeout(() => {
            pending.delete(id);
            reject(new Error(`The ${task} helper did not answer within ${Math.round(o.timeoutMs! / 1000)} s (${op})`));
            void close();
          }, o.timeoutMs)
          : null;
        pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
        child.send({ id, op, payload }, (e) => {
          if (!e || !pending.has(id)) return;
          pending.delete(id);
          if (timer) clearTimeout(timer);
          reject(new Error(`The ${task} helper could not be reached: ${e.message}`));
        });
      });
    },
    close,
  };
}

/** One call in a child of its own, closed afterwards. */
export async function runIsolated<T>(task: IsolatedTask, op: string, payload?: unknown, o: { timeoutMs?: number } = {}): Promise<T> {
  const child = startIsolated(task);
  try {
    return await child.call<T>(op, payload, o);
  } finally {
    await child.close();
  }
}
