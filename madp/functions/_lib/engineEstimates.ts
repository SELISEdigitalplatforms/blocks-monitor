// The calibration of the real build estimates (src/domain/engineEstimate.ts) from the Data Gateway: the newest
// CALIBRATION_WINDOW succeeded builds (build.run and change.build, newest finish first, paged by findNewest so a page
// boundary never falls inside equal finish times: `_id` is the tie-break) and the lanes of their change requests, read
// with the identity the caller passes (the functions' service gateway, or the engine host's). Read-only.
//
// One calibration serves the whole platform and moves only when a build finishes, so it is kept ESTIMATE_CACHE_MS
// (10 min) per process: the op engine.estimates and the engine host's planners share it, one read at a time. It holds
// only figures over every build of the platform (no ids, no project, nothing about a caller), so a warm sandbox may
// keep it for every caller; each caller gets its own copy. A failed read is not kept (the next ask reads again) and is
// passed on: the callers show or write no estimate then.
import { f } from "./filter";
import type { RawGateway, Row } from "./gateway";
import { findNewest } from "./paging";
import {
  CALIBRATION_WINDOW, ESTIMATE_JOB_KINDS, calibrate, changeRequestOfJob, measuredBuildOf, type EstimateCalibration, type MeasuredBuild,
} from "../../src/domain/engineEstimate";

export const ESTIMATE_CACHE_MS = 10 * 60_000;

/** Only the fields the calibration needs (InputJson for the change request and a run after a deploy, OutputRefs for
 *  the tickets, the times, the usage). */
export const ESTIMATE_JOB_FIELDS = ["ItemId", "Kind", "Status", "InputJson", "OutputRefs", "ClaimedAt", "StartedAt", "FinishedAt", "UsageJson"] as const;

/** At most this many ids per `in` read (the filter's own limit is 500; 100 keeps one page per read). */
const IN_CHUNK = 100;

type Reader = Pick<RawGateway, "find" | "findAll">;

/** The newest finished builds as measured builds (see engineEstimate.ts for what counts). */
export async function readMeasuredBuilds(gw: Reader, window = CALIBRATION_WINDOW): Promise<MeasuredBuild[]> {
  const rows = await findNewest(gw, "EngineJob", {
    where: f.and(f.eq("Status", "succeeded"), f.in("Kind", [...ESTIMATE_JOB_KINDS])),
    fields: ESTIMATE_JOB_FIELDS,
    sort: { field: "FinishedAt", dir: "desc" },
  }, window);
  // a row read twice (a page moved under a write between two reads) counts once
  const jobs = [...new Map(rows.map((r) => [typeof r.ItemId === "string" ? r.ItemId : JSON.stringify(r), r])).values()];
  const crIds = [...new Set(jobs.filter((j) => j.Kind === "change.build").map(changeRequestOfJob).filter(Boolean))];
  const lanes = new Map<string, string>();
  const chunks: string[][] = [];
  for (let i = 0; i < crIds.length; i += IN_CHUNK) chunks.push(crIds.slice(i, i + IN_CHUNK));
  // one parallel round (at most CALIBRATION_WINDOW / IN_CHUNK reads)
  const read: Row[][] = await Promise.all(chunks.map((ids) => gw.findAll("ChangeRequest", { where: f.in("ItemId", ids), fields: ["ItemId", "Lane"], max: ids.length })));
  for (const c of read.flat()) if (typeof c.ItemId === "string" && typeof c.Lane === "string") lanes.set(c.ItemId, c.Lane);
  return jobs.flatMap((j) => {
    const b = measuredBuildOf(j, (id) => lanes.get(id) ?? null);
    return b ? [b] : [];
  });
}

export interface EstimateSource {
  /** The calibration, from the cache when younger than the window, else read now (one read at a time). */
  calibration(gw: Reader): Promise<EstimateCalibration>;
  /** Forgets the held calibration (tests; never needed in production). */
  clear(): void;
}

export function createEstimateSource(o: { ttlMs?: number; now?: () => number; read?: (gw: Reader) => Promise<MeasuredBuild[]> } = {}): EstimateSource {
  const ttl = o.ttlMs ?? ESTIMATE_CACHE_MS;
  const now = o.now ?? (() => Date.now());
  const read = o.read ?? ((gw: Reader) => readMeasuredBuilds(gw));
  const copy = (c: EstimateCalibration): EstimateCalibration => JSON.parse(JSON.stringify(c)) as EstimateCalibration;
  let held: { at: number; cal: EstimateCalibration } | null = null;
  let pending: Promise<EstimateCalibration> | null = null;
  return {
    async calibration(gw) {
      if (held && now() - held.at < ttl) return copy(held.cal);
      if (pending) return copy(await pending);
      const p = (async () => {
        try {
          const cal = calibrate(await read(gw));
          held = { at: now(), cal };
          return copy(cal);
        } finally {
          pending = null;
        }
      })();
      pending = p;
      return p;
    },
    clear() {
      held = null;
      pending = null;
    },
  };
}

/** The process's one source (Host A, a warm Logic Function sandbox, the engine host). */
export const engineEstimates: EstimateSource = createEstimateSource();
