// The daily Blocks skills self-queue: the engine guarantees one `engine.skills-sync` job a day without trusting the
// Blocks Logic cron workflow, whose writer inserts are gated by the data rules (only the `mf-service` role may insert
// into blx_EngineJobs, which a delegated workflow token need not carry). The worker — running as `mf-service` — re-queues
// the job itself when the last one of its kind is older than the interval (4 hours after a failure, so a transient
// network error is not a lost day). The unique (ProjectId, ActiveKey) index refuses a second active row, so this and
// the `sync-skills-daily` workflow never double-queue.
//
// Host readiness: the writer runs the official engine's home (officialHome()); a host without it can neither run the
// sync nor queue a job some other (incapable) host might claim, so `engineHomeReady` also decides claim eligibility.
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { f } from "../../../functions/_lib/filter";
import type { RawGateway, Row } from "../../../functions/_lib/gateway";
import { HOST_MAINTENANCE_ACTIVE, HOST_MAINTENANCE_KIND } from "../../../src/domain/engineJob";
import { officialHome } from "../../local/engine/official/home.ts";

const ACTIVE = new Set(["queued", "claimed", "running"]);

/** How often the queue is checked (a poll is every second; this needs no such pace). */
export const DAILY_SYNC_CHECK_MS = 10 * 60_000;

/** The default interval between daily syncs, overridable with MF_ENGINE_SYNC_INTERVAL_HOURS (at least 1 hour). */
export const dailySyncIntervalHours = (env: Record<string, string | undefined>): number => {
  const value = Number(env.MF_ENGINE_SYNC_INTERVAL_HOURS);
  return Number.isFinite(value) && value >= 1 ? value : 24;
};

/** Whether this host can carry the daily sync: it has the official engine home. */
export function engineHomeReady(): boolean {
  try {
    return fs.existsSync(officialHome());
  } catch {
    return false;
  }
}

export interface DailySyncOptions {
  now(): Date;
  intervalHours: number;
  log(line: string): void;
}

/** Queues one `engine.skills-sync` job when its kind has none active and the last one is older than the interval. */
export async function ensureDailySkillsSync(raw: RawGateway, o: DailySyncOptions): Promise<void> {
  const kind = f.eq("Kind", HOST_MAINTENANCE_KIND);
  const active = await raw.find("EngineJob", {
    where: f.and(kind, f.in("Status", [...ACTIVE])), fields: ["ItemId"], page: 1, pageSize: 1,
  });
  if (active.items.length > 0) return;
  const last = await raw.find("EngineJob", {
    where: kind, fields: ["Status", "CreatedDate"], sort: { field: "CreatedDate", dir: "desc" }, page: 1, pageSize: 1,
  });
  const previous = last.items[0];
  const at = Date.parse(String(previous?.CreatedDate ?? ""));
  // After a failure the retry waits at most 4 hours instead of a whole day.
  const hours = previous?.Status === "failed" ? Math.min(Math.max(o.intervalHours, 1), 4) : o.intervalHours;
  if (previous && Number.isFinite(at) && o.now().getTime() - at < hours * 3_600_000) return;
  const row: Row = {
    ProjectId: "system", WorkspaceId: "system", Kind: HOST_MAINTENANCE_KIND, Status: "queued",
    ActiveKey: HOST_MAINTENANCE_ACTIVE, Attempts: 0, Progress: 0, Message: "Scheduled daily Blocks skills sync.",
    InputJson: JSON.stringify({ force: true }), RequestKey: `engine.skills-sync:${randomUUID()}`,
  };
  try {
    const inserted = await raw.insert("EngineJob", row);
    if (!inserted.created) {
      o.log(`[engine] the daily ${HOST_MAINTENANCE_KIND} job is already in the queue (${String(inserted.itemId).slice(0, 8)})`);
      return;
    }
    o.log(`[engine] queued the daily ${HOST_MAINTENANCE_KIND} job (${String(inserted.itemId).slice(0, 8)})`);
  } catch (e) {
    // Two workers checked in the same instant and the index kept only one of their rows: that is success for the host.
    const message = e instanceof Error ? e.message : String(e);
    if (!/ActiveKey|duplicate|unique|conflict/i.test(message)) throw e;
    o.log(`[engine] the daily ${HOST_MAINTENANCE_KIND} job is already in the queue`);
  }
}
