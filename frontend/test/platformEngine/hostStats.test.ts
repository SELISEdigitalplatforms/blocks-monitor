// The engine host readers: /proc parsers on fixtures, the process tree (lanes and the Claude Code agents under them)
// and the reader over a fake /proc folder.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  countEngineProcesses, cpuPercent, createHostStatsReader, isClaudeAgent, isLane, parseLoadavg, parseMeminfo, parsePpid, parseProcStat, parseUptime,
  type ProcInfo,
} from "../../server/blocks/engineWorker/hostStats";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "proc");
const read = (f: string) => fs.readFileSync(path.join(FIX, f), "utf8");

describe("/proc parsers", () => {
  it("reads the aggregate cpu line and the busy share between two readings", () => {
    const a = parseProcStat(read("stat.1"))!;
    const b = parseProcStat(read("stat.2"))!;
    expect(a).toEqual({ idle: 81000, total: 94700 });
    // +1500 total, +700 idle (600 idle + 100 iowait) -> 800 busy of 1500
    expect(cpuPercent(a, b)).toBe(53.3);
    expect(cpuPercent(null, b)).toBe(0);
    expect(cpuPercent(b, a)).toBe(0);
    expect(parseProcStat("intr 1\n")).toBeNull();
  });

  it("reads memory as total minus available, in MB", () => {
    expect(parseMeminfo(read("meminfo"))).toEqual({ totalMb: 16000, usedMb: 10000 });
    // an old kernel without MemAvailable: free + buffers + cached
    expect(parseMeminfo("MemTotal: 1024000 kB\nMemFree: 512000 kB\nBuffers: 0 kB\nCached: 0 kB\n")).toEqual({ totalMb: 1000, usedMb: 500 });
  });

  it("reads load averages and uptime", () => {
    expect(parseLoadavg(read("loadavg"))).toEqual([2.15, 1.8, 1.42]);
    expect(parseUptime(read("uptime"))).toBe(93784);
    expect(parseLoadavg("")).toEqual([0, 0, 0]);
    expect(parseUptime("x")).toBe(0);
  });

  it("reads the parent pid even when the command name holds spaces and parentheses", () => {
    expect(parsePpid("4242 (python3) S 4000 4242 4000 0 -1")).toBe(4000);
    expect(parsePpid("77 (my (odd) name) R 12 77 12 0")).toBe(12);
    expect(parsePpid("garbage")).toBeNull();
  });
});

describe("engine processes", () => {
  const lane = ["/srv/madp/venv/bin/python", "-B", "-m", "MADP.orchestrator.cli.project", "feature", "--json"];
  it("knows a lane and a Claude Code agent by their command line", () => {
    expect(isLane(lane)).toBe(true);
    expect(isLane(["python", "-m", "something.else"])).toBe(false);
    expect(isClaudeAgent(["/home/madp/.local/bin/claude", "--print"])).toBe(true);
    expect(isClaudeAgent(["node", "/usr/lib/node_modules/@anthropic-ai/claude-code/cli.js", "-p"])).toBe(true);
    expect(isClaudeAgent(["/usr/bin/node", "/srv/app/start.mjs"])).toBe(false);
    expect(isClaudeAgent(["/usr/bin/claude-helper"])).toBe(false);
  });

  it("counts the lanes under the worker and the agents under those lanes only", () => {
    const procs: ProcInfo[] = [
      { pid: 100, ppid: 1, argv: ["node", "start.mjs"] }, // the worker
      { pid: 200, ppid: 100, argv: lane },
      { pid: 201, ppid: 200, argv: ["claude", "-p"] },
      { pid: 202, ppid: 201, argv: ["node", "/x/@anthropic-ai/claude-code/cli.js"] }, // the agent's own child: not another agent
      { pid: 203, ppid: 200, argv: ["bash", "-c", "npm run build"] },
      { pid: 204, ppid: 203, argv: ["claude", "-p"] }, // under the lane, deeper
      { pid: 300, ppid: 100, argv: lane },
      { pid: 301, ppid: 300, argv: ["/usr/local/bin/claude"] },
      { pid: 400, ppid: 100, argv: ["claude", "-p"] }, // a direct engine call, not under a lane
      { pid: 500, ppid: 1, argv: ["claude"] }, // someone's terminal session
    ];
    expect(countEngineProcesses(procs, 100)).toEqual({ lanes: 2, agents: 3 });
    expect(countEngineProcesses(procs, 999)).toEqual({ lanes: 0, agents: 0 });
  });

  it("reads a whole snapshot from a /proc folder", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proc-"));
    try {
      for (const f of ["meminfo", "loadavg", "uptime"]) fs.copyFileSync(path.join(FIX, f), path.join(dir, f));
      fs.copyFileSync(path.join(FIX, "stat.1"), path.join(dir, "stat"));
      const proc = (pid: number, ppid: number, argv: string[]) => {
        fs.mkdirSync(path.join(dir, String(pid)));
        fs.writeFileSync(path.join(dir, String(pid), "stat"), `${pid} (x) S ${ppid} 0 0`);
        fs.writeFileSync(path.join(dir, String(pid), "cmdline"), argv.join("\0") + "\0");
      };
      proc(10, 1, ["node", "start.mjs"]);
      proc(11, 10, lane);
      proc(12, 11, ["claude", "-p"]);
      const reader = createHostStatsReader({ diskDir: dir, rootPid: 10, procDir: dir });
      fs.copyFileSync(path.join(FIX, "stat.2"), path.join(dir, "stat"));
      const s = reader.read();
      expect(s).toMatchObject({ cpuPercent: 53.3, load: [2.15, 1.8, 1.42], memUsedMb: 10000, memTotalMb: 16000, runningLanes: 1, activeAgents: 1, uptime: 93784 });
      expect(s.cpuCount).toBeGreaterThan(0);
      expect(s.diskTotalGb).toBeGreaterThan(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
