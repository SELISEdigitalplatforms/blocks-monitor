// The engine host's heartbeat: what the host has and uses, for Platform → Engine & capacity.
//
//   every 30 s    the EngineHost row of this worker (one per HostId = the worker's id): CPU, load, memory, disk of the
//                 project root, running jobs, lanes and Claude Code agents, queue length, release, uptime, LastSeenAt
//   every 60 s    one EngineHostSample (CPU, memory, running jobs, agents) for the 24 h charts
//   every 10 min  samples older than 7 days are deleted, at most 50 per round (oldest first)
//
// Cheap and apart from the job work: its own timers, never awaited by the poll, every failure only logged (once per
// kind until it works again). A tenant without the schemas yet (migration platform-engine.json not applied) is left
// alone: the heartbeat checks the catalog on every beat and starts writing once they are there.
import os from "node:os";
import { f } from "../../../functions/_lib/filter";
import type { RawGateway, Row } from "../../../functions/_lib/gateway";
import { HEARTBEAT_MS, SAMPLE_MS, SAMPLE_RETENTION_MS } from "../../../src/domain/platformEngine";
import type { HostStats } from "./hostStats.ts";

export const RETENTION_EVERY_MS = 10 * 60_000;
export const RETENTION_BATCH = 50;

export interface HeartbeatOptions {
  raw: RawGateway;
  hostId: string;
  /** A display name for the host (no account or user names: the host name only). */
  name?: string;
  stats: { read(): HostStats };
  runningJobs(): number;
  queueLength(): number;
  release(): string;
  /** True when the tenant has the schema (the worker's catalog). */
  has(schema: string): boolean;
  log(line: string): void;
  now?: () => Date;
}

export interface Heartbeat {
  /** One beat now: the host row, plus a sample when one is due. Never throws. */
  beat(): Promise<void>;
  /** Deletes up to RETENTION_BATCH samples older than the retention. Never throws. */
  prune(): Promise<number>;
  start(): void;
  stop(): void;
}

const errTag = (e: unknown): string => (e instanceof Error ? e.message.slice(0, 160) : "error");

export function hostRow(o: { hostId: string; name: string; at: string; stats: HostStats; runningJobs: number; queueLength: number; release: string }): Row {
  const s = o.stats;
  const int = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(2_000_000_000, Math.round(v))) : 0);
  const dec = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.round(v * 100) / 100) : 0);
  return {
    HostId: o.hostId,
    Name: o.name,
    LastSeenAt: o.at,
    CpuPercent: dec(s.cpuPercent),
    Load1: dec(s.load[0]),
    Load5: dec(s.load[1]),
    Load15: dec(s.load[2]),
    CpuCount: int(s.cpuCount),
    MemUsedMb: int(s.memUsedMb),
    MemTotalMb: int(s.memTotalMb),
    DiskUsedGb: dec(s.diskUsedGb),
    DiskTotalGb: dec(s.diskTotalGb),
    RunningJobs: int(o.runningJobs),
    RunningLanes: int(s.runningLanes),
    ActiveAgents: int(s.activeAgents),
    QueueLength: int(o.queueLength),
    Release: o.release.slice(0, 120),
    Uptime: int(s.uptime),
  };
}

export function createHeartbeat(o: HeartbeatOptions): Heartbeat {
  const now = o.now ?? (() => new Date());
  const name = (o.name ?? os.hostname()).replace(/[^A-Za-z0-9._-]/g, "").slice(0, 60) || "engine host";
  let itemId: string | null = null;
  let lastSampleAt = 0;
  let lastPruneAt = 0;
  let beating = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let first: ReturnType<typeof setTimeout> | null = null;
  const failing = new Set<string>();
  const failed = (what: string, e: unknown) => {
    if (!failing.has(what)) o.log(`[engine] heartbeat: ${what} failed (${errTag(e)}); trying again on the next beat`);
    failing.add(what);
  };
  const worked = (what: string) => failing.delete(what);
  let waitingLogged = false;

  async function hostItemId(): Promise<string | null> {
    if (itemId) return itemId;
    const found = await o.raw.find("EngineHost", { where: f.eq("HostId", o.hostId), fields: ["ItemId"], pageSize: 1, page: 1 });
    itemId = typeof found.items[0]?.ItemId === "string" ? (found.items[0].ItemId as string) : null;
    return itemId;
  }

  async function writeHost(row: Row): Promise<void> {
    const id = await hostItemId();
    if (id) {
      try {
        await o.raw.update("EngineHost", id, row);
        return;
      } catch (e) {
        // the row was removed meanwhile: found or made again on the next beat
        itemId = null;
        throw e;
      }
    }
    const res = await o.raw.insert("EngineHost", { ...row, RequestKey: `engine-host:${o.hostId}` });
    itemId = res.itemId;
    if (!itemId) await hostItemId();
  }

  async function prune(): Promise<number> {
    if (!o.has("EngineHostSample")) return 0;
    try {
      const cutoff = now().getTime() - SAMPLE_RETENTION_MS;
      const page = await o.raw.find("EngineHostSample", {
        where: f.eq("HostId", o.hostId),
        fields: ["ItemId", "At"],
        sort: { field: "CreatedDate", dir: "asc" },
        page: 1,
        pageSize: RETENTION_BATCH,
      });
      let removed = 0;
      for (const r of page.items) {
        const at = Date.parse(String(r.At ?? ""));
        if (!Number.isFinite(at) || at >= cutoff) break;
        await o.raw.remove("EngineHostSample", String(r.ItemId));
        removed += 1;
      }
      worked("sample clean-up");
      return removed;
    } catch (e) {
      failed("sample clean-up", e);
      return 0;
    }
  }

  async function beat(): Promise<void> {
    if (beating) return;
    beating = true;
    try {
      if (!o.has("EngineHost")) {
        if (!waitingLogged) o.log("[engine] heartbeat: the tenant has no EngineHost schema yet (blocks/data/migrations/platform-engine.json); waiting");
        waitingLogged = true;
        return;
      }
      const at = now();
      const stats = o.stats.read();
      const runningJobs = o.runningJobs();
      try {
        await writeHost(hostRow({ hostId: o.hostId, name, at: at.toISOString(), stats, runningJobs, queueLength: o.queueLength(), release: o.release() }));
        worked("host row");
      } catch (e) {
        failed("host row", e);
      }
      if (o.has("EngineHostSample") && at.getTime() - lastSampleAt >= SAMPLE_MS - 1000) {
        lastSampleAt = at.getTime();
        try {
          await o.raw.insert("EngineHostSample", {
            HostId: o.hostId,
            At: at.toISOString(),
            CpuPercent: Math.round(stats.cpuPercent * 10) / 10,
            MemUsedMb: Math.max(0, Math.round(stats.memUsedMb)),
            RunningJobs: Math.max(0, Math.round(runningJobs)),
            ActiveAgents: Math.max(0, Math.round(stats.activeAgents)),
            RequestKey: `engine-sample:${o.hostId}:${at.toISOString().slice(0, 16)}`,
          });
          worked("sample");
        } catch (e) {
          failed("sample", e);
        }
      }
      if (at.getTime() - lastPruneAt >= RETENTION_EVERY_MS) {
        lastPruneAt = at.getTime();
        await prune();
      }
    } catch (e) {
      failed("beat", e);
    } finally {
      beating = false;
    }
  }

  return {
    beat,
    prune,
    start() {
      if (timer) return;
      // the first beat a little after the start (the worker's first poll goes first)
      first = setTimeout(() => void beat(), 5_000);
      first.unref?.();
      timer = setInterval(() => void beat(), HEARTBEAT_MS);
      timer.unref?.();
    },
    stop() {
      if (first) clearTimeout(first);
      if (timer) clearInterval(timer);
      first = null;
      timer = null;
    },
  };
}
