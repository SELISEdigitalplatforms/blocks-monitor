// A seeded local store in a temporary folder with the local MADP engine on a virtual clock: sleeps advance the clock
// and return at once, so a two-minute build runs in milliseconds and every timestamp is reproducible.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DatabaseSync } from "node:sqlite";
import { capKey } from "../../functions/_lib/ids";
import type { RawGateway, Row } from "../../functions/_lib/gateway";
import { guardPaging } from "../../functions/_lib/paging";
import type { EngineJobKind } from "../../src/domain/engineJob";
import { openDb } from "../../server/local/db.ts";
import { createLocalGateway } from "../../server/local/gateway.ts";
import { createRowStore, loadUniqueIndexes, type RowStore } from "../../server/local/rowStore.ts";
import { createFileRecord, ensureDirectory, writeBytes } from "../../server/local/storage.ts";
import { DEFAULT_CONFIG, type EngineConfig } from "../../server/local/engine/config.ts";
import { createEngine, type Engine, type EngineOptions, type WriterLoader } from "../../server/local/engine/driver.ts";
import { writerOf } from "../../server/local/engine/kinds/index.ts";
import { seedAll } from "../../seed/index.ts";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SEED_NOW = new Date("2026-10-25T14:00:00.000Z");

export interface World {
  dir: string;
  db: DatabaseSync;
  store: RowStore;
  gw: RawGateway;
  engine: Engine;
  config: EngineConfig;
  /** The virtual clock. */
  now(): Date;
  log: string[];
  project(name: string): Row;
  rows(schema: string, projectId?: string): Row[];
  get(schema: string, id: string): Row;
  /** Queues a job the way the ops do (jobs.create), stamped from the project. */
  queue(o: { project: string; kind: EngineJobKind; input: Record<string, unknown>; target?: { type: string; id: string }; by?: string; key?: string }): Promise<string>;
  /** Lets the engine work until no job is active (or the round limit is hit). */
  settle(rounds?: number): Promise<void>;
  fileBytes(fileId: string): Buffer | null;
  /** Stops the engine, waits (briefly) for the jobs it aborted to end, then removes the store. */
  close(): Promise<void>;
}

export async function makeWorld(o?: { config?: Partial<EngineConfig>; writers?: WriterLoader; engine?: Pick<EngineOptions, "waitScale" | "backgroundProgress" | "pickupDelay" | "projectFolder"> }): Promise<World> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "madp-engine-test-"));
  const db = openDb(path.join(dir, "factory.db"));
  const store = createRowStore(db, loadUniqueIndexes(ROOT));
  const gw = guardPaging(createLocalGateway(store));
  const filesDir = path.join(dir, "files");
  const put = (name: string, mime: string, bytes: Uint8Array, folder: string[]): string => {
    let parent = "";
    for (const n of folder) parent = ensureDirectory(db, parent, n);
    const rec = createFileRecord(db, { directoryId: parent, name, mime, sizeBytes: bytes.length });
    writeBytes(db, filesDir, rec.fileId, bytes);
    return rec.fileId;
  };
  let users = 0;
  await seedAll({
    gw,
    now: SEED_NOW,
    async createUser() {
      users += 1;
      return { userId: `00000000-0000-4000-8000-${String(users).padStart(12, "0")}` };
    },
    async putFile(f) {
      return { fileId: put(f.name, f.contentType, f.bytes, ["mf", "seed"]) };
    },
  });

  let clock = SEED_NOW.getTime() + 60_000;
  const log: string[] = [];
  const config: EngineConfig = { ...DEFAULT_CONFIG, ...o?.config };
  const engine = createEngine({
    store,
    gateway: gw,
    config: () => config,
    log: (l) => log.push(l),
    writers: o?.writers ?? writerOf,
    now: () => new Date(clock),
    sleep: (ms, signal) =>
      new Promise((resolve, reject) => {
        if (signal.aborted) return reject(new Error("aborted"));
        clock += Math.round(ms);
        setImmediate(resolve);
      }),
    putFile: async (f) => put(f.name, f.mime, f.bytes, ["mf", f.workspaceId, f.projectId]),
    readFile: async (fileId) => {
      try {
        return new Uint8Array(fs.readFileSync(path.join(filesDir, fileId)));
      } catch {
        return null;
      }
    },
    sweepMs: 0,
    ...o?.engine,
  });

  const rows = (schema: string, projectId?: string) => store.rows(schema).filter((r) => !projectId || r.ProjectId === projectId) as Row[];
  const project = (name: string): Row => {
    const p = store.rows("Project").find((r) => r.Name === name);
    if (!p) throw new Error(`no project ${name}`);
    return p;
  };
  let queued = 0;
  return {
    dir,
    db,
    store,
    gw,
    engine,
    config,
    now: () => new Date(clock),
    log,
    project,
    rows,
    get(schema, id) {
      const r = store.get(schema, id);
      if (!r) throw new Error(`no ${schema} ${id}`);
      return r;
    },
    async queue(q) {
      const p = project(q.project);
      queued += 1;
      const by = q.by ?? (p.AssigneeUserId as string) ?? (p.CreatedByUserId as string);
      const res = await gw.insert("EngineJob", {
        ProjectId: p.ItemId,
        Kind: q.kind,
        Status: "queued",
        Progress: 0,
        Attempts: 0,
        Message: "",
        ActiveKey: `${q.kind}:${q.target?.id ?? "project"}`,
        InputJson: JSON.stringify(q.input),
        RequestedByUserId: by,
        ...(q.target ? { TargetType: q.target.type, TargetId: q.target.id } : {}),
        WorkspaceId: p.WorkspaceId,
        ReaderIds: p.ReaderIds,
        CreatedByUserId: by,
        UpdatedByUserId: by,
        RequestKey: capKey(`test:job:${q.key ?? queued}:${q.kind}`),
      });
      if (!res.itemId) throw new Error(`job ${q.kind} not queued (an active one holds the key)`);
      return res.itemId;
    },
    async settle(roundLimit = 60) {
      const snapshot = () => JSON.stringify(store.rows("EngineJob").map((j) => [j.ItemId, j.Status, j.Progress, j.Attempts]));
      let before = "";
      for (let i = 0; i < roundLimit; i++) {
        engine.tick();
        await engine.idle();
        const active = store.rows("EngineJob").some((j) => ["queued", "claimed", "running"].includes(String(j.Status)));
        const now = snapshot();
        if (!active || now === before) return;
        before = now;
      }
    },
    fileBytes(fileId) {
      try {
        return fs.readFileSync(path.join(filesDir, fileId));
      } catch {
        return null;
      }
    },
    async close() {
      engine.stop();
      // an aborted job still reads and writes the store in its finally: close the database only after that
      await Promise.race([engine.idle(), new Promise((r) => setTimeout(r, 5000))]);
      try {
        db.close();
      } catch {
        /* already closed */
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
