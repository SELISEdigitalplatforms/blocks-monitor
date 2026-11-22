// What every part of the local host shares in one process (the Vite config side and the SSR side alike): the paths,
// the app origin for links, the logger, the database and the row store. Set once by the host (or the reset script).
import type { DatabaseSync } from "node:sqlite";
import { localPaths, openDb, type LocalPaths } from "./db.ts";
import { sharedRowStore, type RowStore } from "./rowStore.ts";

export interface LocalRuntime {
  paths: LocalPaths;
  /** http://localhost:5310: the origin of every link the app hands out (activation, reset, downloads). */
  appOrigin: string;
  db: DatabaseSync;
  store: RowStore;
  log(level: "info" | "warn" | "error", line: string): void;
}

/** The app's port and its one origin (the Blocks-backed app at the repository root keeps 5300). */
// FACTORY_LOCAL_PORT: a second local dev server beside the usual one (its own data: FACTORY_LOCAL_DATA_DIR, db.ts).
export const LOCAL_PORT = Number(process.env.FACTORY_LOCAL_PORT) || 5310;
export const LOCAL_ORIGIN = `http://localhost:${LOCAL_PORT}`;

/** The tenant id of the local platform; the function env and every caller context carry it. */
export const LOCAL_TENANT = "madp-factory";

const KEY = Symbol.for("madp.factory.local.runtime");

export function initRuntime(o: { root: string; appOrigin: string; log?: LocalRuntime["log"] }): LocalRuntime {
  const paths = localPaths(o.root);
  const db = openDb(paths.dbFile);
  const rt: LocalRuntime = {
    paths,
    appOrigin: o.appOrigin.replace(/\/+$/, ""),
    db,
    store: sharedRowStore(db, o.root),
    log: o.log ?? ((level, line) => (level === "info" ? console.log(line) : console.warn(line))),
  };
  (globalThis as unknown as Record<symbol, LocalRuntime>)[KEY] = rt;
  return rt;
}

export function runtime(): LocalRuntime {
  const rt = (globalThis as unknown as Record<symbol, LocalRuntime | undefined>)[KEY];
  if (!rt) throw new Error("the local runtime is not initialised");
  return rt;
}
