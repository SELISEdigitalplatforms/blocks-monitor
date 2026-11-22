// The account menu's "Export workspace" (audit 08.11.2026): the export runs outside the menu, so closing the menu
// neither stops it nor loses its progress, and a second press while it runs starts nothing.
//   npx vitest run --config test/workspace/vitest.config.ts
import { beforeEach, describe, expect, it } from "vitest";
import { exportStatusText, startWorkspaceExport, useWorkspaceExport } from "../../src/ui/Shell";

type Run = NonNullable<Parameters<typeof startWorkspaceExport>[1]>;
type Answer = Awaited<ReturnType<Run>>;

/** A stand-in for the download: it reports progress, then answers when `finish` is called. */
function pending() {
  let finish: (a: Answer) => void = () => {};
  let calls = 0;
  let signal: AbortSignal | undefined;
  const run: Run = (opts) => {
    calls += 1;
    signal = opts.signal;
    opts.onProgress?.({ done: 2, total: 9 });
    return new Promise<Answer>((resolve) => { finish = resolve; });
  };
  return { run, finish: (a: Answer) => finish(a), calls: () => calls, signal: () => signal };
}

const ws = { id: "w1", name: "Acme" };

describe("startWorkspaceExport", () => {
  beforeEach(() => useWorkspaceExport.setState({ status: { kind: "idle" } }));

  it("keeps the progress in its own store until the file is saved", async () => {
    const p = pending();
    const done = startWorkspaceExport(ws, p.run);
    expect(useWorkspaceExport.getState().status).toEqual({ kind: "running", done: 2, total: 9 });
    expect(exportStatusText(useWorkspaceExport.getState().status)).toBe("Exporting… 2 of 9 record types");
    // nothing ties it to the menu: no abort signal is handed over
    expect(p.signal()).toBeUndefined();
    p.finish({ ok: true, fileName: "acme.json" });
    await done;
    expect(useWorkspaceExport.getState().status).toEqual({ kind: "done" });
  });

  it("starts nothing while an export runs", async () => {
    const p = pending();
    const first = startWorkspaceExport(ws, p.run);
    await startWorkspaceExport(ws, p.run);
    expect(p.calls()).toBe(1);
    p.finish({ ok: true, fileName: "acme.json" });
    await first;
  });

  it("says why it failed, and a rejected call is a failure too", async () => {
    const p = pending();
    const done = startWorkspaceExport(ws, p.run);
    p.finish({ ok: false, message: "You can't export this workspace." });
    await done;
    expect(useWorkspaceExport.getState().status).toEqual({ kind: "failed", message: "You can't export this workspace." });

    await startWorkspaceExport(ws, () => Promise.reject(new Error("network")));
    expect(useWorkspaceExport.getState().status.kind).toBe("failed");
  });
});
