// What the engine host has and uses, read from Linux's /proc and statfs: CPU (from /proc/stat deltas), load averages,
// memory (/proc/meminfo), the disk of the engine's project root, uptime, and the engine's own processes: the lanes it
// started (the official MADP lanes: python -m MADP.orchestrator.cli.project) and the Claude Code agents under them.
//
// Every reader is cheap (a few small files) and never throws: a value it cannot read is 0. The parsers are pure (tests
// feed them fixtures). Nothing here reads a process's environment or anything beyond its command line.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface CpuTimes {
  idle: number;
  total: number;
}

/** The aggregate "cpu" line of /proc/stat: idle (idle + iowait) and total jiffies. */
export function parseProcStat(text: string): CpuTimes | null {
  const line = text.split("\n").find((l) => /^cpu\s/.test(l));
  if (!line) return null;
  const n = line.trim().split(/\s+/).slice(1).map(Number);
  if (n.length < 4 || n.some((x) => !Number.isFinite(x))) return null;
  // user nice system idle iowait irq softirq steal (guest and guest_nice are already counted in user and nice)
  const fields = n.slice(0, 8);
  const total = fields.reduce((a, b) => a + b, 0);
  const idle = (n[3] ?? 0) + (n[4] ?? 0);
  return { idle, total };
}

/** CPU busy share between two /proc/stat readings, in percent (one decimal); 0 without a usable pair. */
export function cpuPercent(prev: CpuTimes | null, cur: CpuTimes | null): number {
  if (!prev || !cur) return 0;
  const total = cur.total - prev.total;
  const idle = cur.idle - prev.idle;
  if (total <= 0 || idle < 0) return 0;
  return Math.max(0, Math.min(100, Math.round(((total - idle) / total) * 1000) / 10));
}

/** Memory from /proc/meminfo in MB: used = MemTotal - MemAvailable (what the kernel could give without swapping). */
export function parseMeminfo(text: string): { totalMb: number; usedMb: number } {
  const kb = (name: string): number | null => {
    const m = new RegExp(`^${name}:\\s+(\\d+)\\s*kB`, "m").exec(text);
    return m ? Number(m[1]) : null;
  };
  const total = kb("MemTotal") ?? 0;
  const available = kb("MemAvailable") ?? (kb("MemFree") ?? 0) + (kb("Buffers") ?? 0) + (kb("Cached") ?? 0);
  const totalMb = Math.round(total / 1024);
  return { totalMb, usedMb: Math.max(0, Math.min(totalMb, Math.round((total - available) / 1024))) };
}

/** /proc/loadavg: the 1, 5 and 15 minute load averages. */
export function parseLoadavg(text: string): [number, number, number] {
  const n = text.trim().split(/\s+/).slice(0, 3).map(Number);
  const v = (x: number | undefined) => (Number.isFinite(x) ? Math.round((x as number) * 100) / 100 : 0);
  return [v(n[0]), v(n[1]), v(n[2])];
}

/** /proc/uptime: whole seconds the host has been up. */
export function parseUptime(text: string): number {
  const n = Number(text.trim().split(/\s+/)[0]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** The parent pid from /proc/<pid>/stat (the command name in parentheses may hold spaces and parentheses). */
export function parsePpid(stat: string): number | null {
  const close = stat.lastIndexOf(")");
  if (close < 0) return null;
  const rest = stat.slice(close + 2).split(" ");
  const ppid = Number(rest[1]);
  return Number.isInteger(ppid) ? ppid : null;
}

export interface ProcInfo {
  pid: number;
  ppid: number;
  /** argv (from /proc/<pid>/cmdline, NUL-separated). */
  argv: string[];
}

/** A lane process: the official MADP engine's project CLI (madp.ts runLane). */
export function isLane(argv: readonly string[]): boolean {
  const i = argv.indexOf("-m");
  return i >= 0 && argv[i + 1] === "MADP.orchestrator.cli.project";
}

/** A Claude Code agent: the claude executable itself, or node running the Claude Code package. */
export function isClaudeAgent(argv: readonly string[]): boolean {
  const base = (s: string | undefined) => (s ? path.basename(s) : "");
  const exe = base(argv[0]);
  if (exe === "claude") return true;
  if (/^node(js)?$/.test(exe)) {
    const script = argv[1] ?? "";
    return base(script) === "claude" || /@anthropic-ai[\\/]claude-code[\\/]/.test(script);
  }
  return false;
}

/** The lanes under `rootPid` (any depth) and the Claude Code agents under those lanes. */
export function countEngineProcesses(procs: readonly ProcInfo[], rootPid: number): { lanes: number; agents: number } {
  const children = new Map<number, ProcInfo[]>();
  for (const p of procs) {
    const list = children.get(p.ppid);
    if (list) list.push(p);
    else children.set(p.ppid, [p]);
  }
  let lanes = 0;
  let agents = 0;
  const seen = new Set<number>();
  // depth-first from the worker; `underLane` once a lane is an ancestor
  const stack: { pid: number; underLane: boolean }[] = [{ pid: rootPid, underLane: false }];
  while (stack.length > 0) {
    const { pid, underLane } = stack.pop()!;
    for (const c of children.get(pid) ?? []) {
      if (seen.has(c.pid)) continue;
      seen.add(c.pid);
      const lane = isLane(c.argv);
      if (lane) lanes += 1;
      // an agent's own helper processes (node children of claude) are not agents of their own
      const agent = (underLane || lane) && isClaudeAgent(c.argv);
      if (agent) agents += 1;
      if (!agent) stack.push({ pid: c.pid, underLane: underLane || lane });
    }
  }
  return { lanes, agents };
}

const readText = (file: string): string => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
};

/** Every process of this user that /proc shows (pid, ppid, argv). Empty off Linux. */
export function listProcesses(procDir = "/proc"): ProcInfo[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(procDir);
  } catch {
    return [];
  }
  const out: ProcInfo[] = [];
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    const ppid = parsePpid(readText(path.join(procDir, name, "stat")));
    if (ppid === null) continue;
    const argv = readText(path.join(procDir, name, "cmdline")).split("\0").filter(Boolean);
    out.push({ pid: Number(name), ppid, argv });
  }
  return out;
}

export interface DiskUse {
  usedGb: number;
  totalGb: number;
}

/** The file system holding `dir`: used and total in GB (one decimal). */
export function diskOf(dir: string): DiskUse {
  try {
    const s = fs.statfsSync(dir);
    const gb = (blocks: number) => Math.round(((blocks * s.bsize) / 1024 ** 3) * 10) / 10;
    return { totalGb: gb(s.blocks), usedGb: gb(s.blocks - s.bfree) };
  } catch {
    return { usedGb: 0, totalGb: 0 };
  }
}

export interface HostStats {
  cpuPercent: number;
  load: [number, number, number];
  cpuCount: number;
  memUsedMb: number;
  memTotalMb: number;
  diskUsedGb: number;
  diskTotalGb: number;
  runningLanes: number;
  activeAgents: number;
  uptime: number;
}

/** A reader that keeps the previous /proc/stat reading, so each read() gives the CPU share since the last one. */
export function createHostStatsReader(o: { diskDir: string; rootPid?: number; procDir?: string }): { read(): HostStats } {
  const procDir = o.procDir ?? "/proc";
  let prev = parseProcStat(readText(path.join(procDir, "stat")));
  return {
    read() {
      const cur = parseProcStat(readText(path.join(procDir, "stat")));
      const cpu = cpuPercent(prev, cur);
      prev = cur ?? prev;
      const mem = parseMeminfo(readText(path.join(procDir, "meminfo")));
      const disk = diskOf(o.diskDir);
      const { lanes, agents } = countEngineProcesses(listProcesses(procDir), o.rootPid ?? process.pid);
      const loadText = readText(path.join(procDir, "loadavg"));
      const uptimeText = readText(path.join(procDir, "uptime"));
      return {
        cpuPercent: cpu,
        load: loadText ? parseLoadavg(loadText) : (os.loadavg().map((x) => Math.round(x * 100) / 100) as [number, number, number]),
        cpuCount: os.cpus().length || 1,
        memUsedMb: mem.usedMb,
        memTotalMb: mem.totalMb || Math.round(os.totalmem() / 1024 ** 2),
        diskUsedGb: disk.usedGb,
        diskTotalGb: disk.totalGb,
        runningLanes: lanes,
        activeAgents: agents,
        uptime: uptimeText ? parseUptime(uptimeText) : Math.floor(os.uptime()),
      };
    },
  };
}
