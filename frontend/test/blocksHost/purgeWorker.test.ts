// The Blocks host runs the durable project purge (functions/_lib/purge.ts): project.delete only marks a project
// 'deleting', so without this worker nothing of a deleted project was ever removed on the Blocks dev and production
// servers. Only a listening server runs it, never a script's or a test run's middleware-mode server.
import { describe, expect, it } from "vitest";
import { createBlocksPurgeWorker } from "../../server/blocks/host";
import { runsBackgroundWork } from "../../server/blocks/plugin";
import type { PurgeModuleLike } from "../../server/fnHost/purgeWorker";

const settle = () => new Promise((r) => setTimeout(r, 0));

function fakePurge() {
  const calls: { env: Record<string, string | undefined>; apiUrl?: string; opts: unknown }[] = [];
  let wake: ((projectId: string) => void) | null = null;
  const mod: PurgeModuleLike = {
    async runProjectPurgeTick(platform, opts) {
      calls.push({ env: platform.env, apiUrl: platform.apiUrl, opts });
      return { picked: 0, finished: [], pending: [], failed: [], nextDueMs: null };
    },
    onProjectPurgeWake(fn) {
      wake = fn;
      return () => { wake = null; };
    },
  };
  return { mod, calls, wake: (id: string) => wake?.(id), hooked: () => wake !== null };
}

describe("the Blocks host's purge worker", () => {
  it("ticks with the host's service identity at start and again when a project is deleted", async () => {
    const fake = fakePurge();
    const worker = createBlocksPurgeWorker(
      { apiUrl: "https://blocks.example", tenant: "T1", clientId: "svc", clientSecret: "secret" },
      async () => fake.mod, () => false, () => undefined,
    );
    worker.start();
    await settle();
    await settle();
    expect(worker.isRunning()).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]!.env).toMatchObject({ BLOCKS_API_URL: "https://blocks.example", BLOCKS_TENANT: "T1", SVC_CLIENT_ID: "svc", SVC_CLIENT_SECRET: "secret" });
    expect(fake.hooked()).toBe(true);
    fake.wake("p1");
    await settle();
    await settle();
    expect(fake.calls).toHaveLength(2);
    worker.stop();
    expect(fake.hooked()).toBe(false);
  });

  it("stays off without the service settings", async () => {
    let loaded = false;
    const worker = createBlocksPurgeWorker({ apiUrl: "https://blocks.example", tenant: "T1" }, async () => { loaded = true; return fakePurge().mod; }, () => false, () => undefined);
    worker.start();
    await settle();
    expect(loaded).toBe(false);
    expect(worker.isRunning()).toBe(false);
  });

  it("runs only on a listening dev server, never in a middleware-mode server or a test run", () => {
    expect(runsBackgroundWork({ httpServer: {} }, {})).toBe(true);
    expect(runsBackgroundWork({ httpServer: null }, {})).toBe(false);
    expect(runsBackgroundWork({ httpServer: {} }, { VITEST: "true" })).toBe(false);
  });
});
