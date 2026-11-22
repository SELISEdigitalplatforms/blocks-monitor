// The child process of host.ts: runs the handlers of one task module of this folder (browser.mjs, pdf.mjs) for its
// parent over the IPC channel, then cleans up and exits when the parent closes the channel, ends, or sends a signal.
// Plain JavaScript run by node itself: it never joins the parent's module graph.
//
//   node child.mjs <task>     (started by host.ts with an IPC channel)
const TASKS = new Set(["browser", "pdf"]);
const task = process.argv[2] ?? "";
if (typeof process.send !== "function" || !TASKS.has(task)) {
  process.stderr.write(`usage: started by host.ts with an IPC channel and one of: ${[...TASKS].join(", ")}\n`);
  process.exit(2);
}

/** How long the task's cleanup (a browser closing) may take before the child exits anyway. */
const CLEANUP_MS = 10_000;

// the listener is in place before the first message can arrive; the calls wait for the task module
const loaded = import(`./${task}.mjs`);
loaded.catch(() => undefined);

const send = (message) => {
  if (!process.connected) return;
  try {
    process.send(message);
  } catch {
    /* the parent is gone */
  }
};

process.on("message", async (m) => {
  if (!m || typeof m !== "object" || typeof m.id !== "number") return;
  try {
    const mod = await loaded;
    const handler = typeof m.op === "string" && Object.hasOwn(mod.handlers, m.op) ? mod.handlers[m.op] : null;
    if (!handler) throw new Error(`The ${task} helper has no operation ${String(m.op)}`);
    send({ id: m.id, ok: true, value: await handler(m.payload) });
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    send({ id: m.id, ok: false, error: { name: error.name, message: error.message, ...(error.code !== undefined ? { code: error.code } : {}) } });
  }
});

let ending = false;
async function end(code) {
  if (ending) return;
  ending = true;
  try {
    const mod = await loaded;
    if (typeof mod.cleanup === "function") {
      await Promise.race([mod.cleanup(), new Promise((resolve) => setTimeout(resolve, CLEANUP_MS).unref())]);
    }
  } catch {
    /* exiting anyway */
  }
  process.exit(code);
}
process.on("disconnect", () => void end(0));
process.on("SIGTERM", () => void end(0));
process.on("SIGINT", () => void end(0));
