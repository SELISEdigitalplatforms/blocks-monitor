// platform.engine.status (platform.engine.view): every engine host's last heartbeat and the last 24 hours of its
// samples (one per minute). A view: reads through the service gateway, writes nothing. `samples: false` answers the
// hosts only (one small read instead of up to a day of samples per host): the live host cards and the overview tiles
// ask that way, and the sample history is read on its own slower pace (docs/FRESHNESS.md). A tenant without the schemas
// yet (blocks/data/migrations/platform-engine.json) answers empty lists.
//
// The samples of one host are read for the 24-hour window only: HostId and a string range on At (an ISO String field,
// which the Data Gateway compares; it does not compare its own CreatedDate with a string), newest first by At, at most
// MAX_SAMPLES_PER_HOST, page 1 and then the other pages in one parallel round (findNewest: never limit_reached). The
// worker keeps 7 days of samples (up to ~10,000 rows per host); reading them all by HostId alone failed the whole answer
// with limit_reached once a host had more than a day of them (11.11.2026 05:08 UTC: the 1,451st sample).
// A host whose samples cannot be read does not fail the answer: the hosts are answered with what was read and
// `samplesFailed: true`, so the page keeps the host cards and says the history is missing.
import { OpError, defineOp, f, v, type Row } from "../../../_lib";
import { findNewest } from "../../../_lib/paging";
import type { ScopedGateway } from "../../../_lib/types";
import {
  ENGINE_VIEW_PERMISSION, MAX_SAMPLES_PER_HOST, STATUS_WINDOW_MS, type EngineHostView, type EngineSampleView, type EngineStatus,
} from "../../../../src/domain/platformEngine";

export const ENGINE_HOST_FIELDS = [
  "ItemId", "HostId", "Name", "LastSeenAt", "CpuPercent", "Load1", "Load5", "Load15", "CpuCount", "MemUsedMb", "MemTotalMb",
  "DiskUsedGb", "DiskTotalGb", "RunningJobs", "RunningLanes", "ActiveAgents", "QueueLength", "Release", "Uptime",
] as const;
export const ENGINE_SAMPLE_FIELDS = ["ItemId", "HostId", "At", "CpuPercent", "MemUsedMb", "RunningJobs", "ActiveAgents"] as const;
const MAX_HOSTS = 20;

const str = (x: unknown): string => (typeof x === "string" ? x : "");
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);

export function hostView(r: Row): EngineHostView {
  return {
    hostId: str(r.HostId),
    name: str(r.Name),
    lastSeenAt: str(r.LastSeenAt),
    cpuPercent: num(r.CpuPercent),
    load1: num(r.Load1),
    load5: num(r.Load5),
    load15: num(r.Load15),
    cpuCount: num(r.CpuCount),
    memUsedMb: num(r.MemUsedMb),
    memTotalMb: num(r.MemTotalMb),
    diskUsedGb: num(r.DiskUsedGb),
    diskTotalGb: num(r.DiskTotalGb),
    runningJobs: num(r.RunningJobs),
    runningLanes: num(r.RunningLanes),
    activeAgents: num(r.ActiveAgents),
    queueLength: num(r.QueueLength),
    release: str(r.Release),
    uptime: num(r.Uptime),
  };
}

export function sampleView(r: Row): EngineSampleView {
  return {
    hostId: str(r.HostId),
    at: str(r.At),
    cpuPercent: num(r.CpuPercent),
    memUsedMb: num(r.MemUsedMb),
    runningJobs: num(r.RunningJobs),
    activeAgents: num(r.ActiveAgents),
  };
}

/** A read of a schema the tenant does not have yet answers nothing instead of failing the whole view. */
const missingSchema = (e: unknown): boolean => /schema|unknown type|cannot query|not found|Unknown/i.test(e instanceof Error ? e.message : String(e));

async function readHosts(svc: ScopedGateway): Promise<Row[]> {
  try {
    return await svc.findAll("EngineHost", { where: allHosts(), fields: [...ENGINE_HOST_FIELDS], max: MAX_HOSTS });
  } catch (e) {
    if (missingSchema(e)) return [];
    throw e;
  }
}

/** Every EngineHost row: the gateway's filter needs a condition, and every row has a RequestKey (engine-host:<id>). */
function allHosts() {
  return f.range("RequestKey", { gte: "engine-host:", lte: "engine-host:~" });
}

/** The window's samples of one host, oldest first; `failed` when they could not be read (a missing schema is no failure). */
export async function readSamples(svc: Pick<ScopedGateway, "find">, hostId: string, since: number): Promise<{ samples: EngineSampleView[]; failed: boolean }> {
  try {
    const rows = await findNewest(svc, "EngineHostSample", {
      where: f.and(f.eq("HostId", hostId), f.range("At", { gte: new Date(since).toISOString() })),
      fields: [...ENGINE_SAMPLE_FIELDS],
      sort: { field: "At", dir: "desc" },
    }, MAX_SAMPLES_PER_HOST);
    // a sample written between page 1 and the parallel round moves every later page by one row: drop the repeat
    const unique = [...new Map(rows.map((r) => [String(r.ItemId), r])).values()];
    const samples = unique
      .map(sampleView)
      .filter((s) => s.hostId === hostId && Date.parse(s.at) >= since)
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    return { samples, failed: false };
  } catch (e) {
    if (missingSchema(e)) return { samples: [], failed: false };
    return { samples: [], failed: true };
  }
}

export const platformEngineStatus = defineOp({
  op: "platform.engine.status",
  kind: "view",
  scope: "platform",
  permission: ENGINE_VIEW_PERMISSION,
  args: v.object({ samples: v.optional(v.bool()) }),
  async handler(ctx, args, deps): Promise<EngineStatus> {
    const svc = deps.svc;
    if (!svc) throw new OpError("internal");
    const hosts = (await readHosts(svc)).map(hostView).filter((h) => h.hostId !== "");
    hosts.sort((a, b) => (a.lastSeenAt < b.lastSeenAt ? 1 : a.lastSeenAt > b.lastSeenAt ? -1 : 0));
    if (args.samples === false) return { hosts, samples: [], now: ctx.now.toISOString() };
    const since = ctx.now.getTime() - STATUS_WINDOW_MS;
    const read = await Promise.all(hosts.map((h) => readSamples(svc, h.hostId, since)));
    const samples = read.flatMap((r) => r.samples);
    const failed = read.some((r) => r.failed);
    return { hosts, samples, now: ctx.now.toISOString(), ...(failed ? { samplesFailed: true } : {}) };
  },
});
