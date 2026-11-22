// Registers the local MADP engine with the engine hook (index.ts). Imported once by server/local/backend.ts.
import fs from "node:fs";
import { engineConfigSource } from "./config.ts";
import { createEngine } from "./driver.ts";
import { registerEngineDriver } from "./index.ts";
import { writerOf } from "./kinds/index.ts";
import { runtime } from "../runtime.ts";
import { bytesPath, createFileRecord, ensureDirectory, writeBytes } from "../storage.ts";
import { startSetupWatch } from "./setupWatch.ts";

registerEngineDriver({
  name: "madp-engine",
  start(ctx) {
    const rt = runtime();
    const config = engineConfigSource({ dataDir: rt.paths.dataDir });
    // Another process writing the store (npm run reset) changes PRAGMA data_version: wait until it has been quiet for a
    // few seconds, so a job is never picked up before the rows it works on are all there.
    const version = rt.db.prepare("PRAGMA data_version");
    const versionNow = () => Number((version.get() as { data_version: number }).data_version);
    let seen = versionNow();
    let changedAt = 0;
    const ready = () => {
      const v = versionNow();
      if (v !== seen) {
        seen = v;
        changedAt = Date.now();
      }
      return Date.now() - changedAt > 4_000;
    };
    const engine = createEngine({
      store: ctx.store,
      gateway: ctx.gateway,
      config,
      log: ctx.log,
      writers: writerOf,
      ready,
      async putFile(f) {
        const dir = ensureDirectory(rt.db, ensureDirectory(rt.db, ensureDirectory(rt.db, "", "mf"), f.workspaceId), f.projectId);
        const rec = createFileRecord(rt.db, { directoryId: dir, name: f.name, mime: f.mime, sizeBytes: f.bytes.length });
        writeBytes(rt.db, rt.paths.filesDir, rec.fileId, f.bytes);
        return rec.fileId;
      },
      async readFile(fileId) {
        try {
          return new Uint8Array(await fs.promises.readFile(bytesPath(rt.paths.filesDir, fileId)));
        } catch {
          return null;
        }
      },
    });
    // the business agent of the Project setup step: queued when people share material (setupWatch.ts)
    const watch = startSetupWatch({ store: ctx.store, gateway: ctx.gateway, config, log: ctx.log, ready });
    const off = ctx.onQueued((job) => engine.queued(job));
    // Picks up what is waiting or was interrupted (a restart, a code reload) right away.
    setTimeout(() => engine.tick(), 500);
    const c = config();
    ctx.log(`[engine] MADP engine ready (pace ${c.pace}${c.enabled ? "" : ", paused: FACTORY_ENGINE=off or data/engine.json"})`);
    return () => {
      off();
      watch.stop();
      engine.stop();
    };
  },
});
