// The Engine & capacity section as the page renders it, over the states of its status read: reading, nothing readable
// (error with Try again), the hosts reporting, the latest reading failed while an older one is shown (judged at its
// own time, so a failed read never claims the engine is offline), the history missing, and no access. No state is an
// endless spinner and nothing shows a number the engine did not report.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EngineStatusHeld } from "../../src/components/platform/engineData";
import type { EngineHostView, EngineSampleView } from "../../src/domain/platformEngine";

const state = vi.hoisted(() => ({
  query: {} as Record<string, unknown>,
  enabled: undefined as boolean | undefined,
  access: { ready: true, isSuperAdmin: true, permissions: [] as string[] },
}));

vi.mock("@/blocks/admin", async (importOriginal) => ({ ...(await importOriginal<object>()), usePlatformAccess: () => state.access }));
vi.mock("@/components/platform/engineData", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useEngineStatus: (enabled?: boolean) => {
    state.enabled = enabled;
    return state.query;
  },
  useRetryEngineHistory: () => () => {},
}));

const { default: EngineSection } = await import("../../src/components/platform/sections/EngineSection");

const host = (o: Partial<EngineHostView> = {}): EngineHostView => ({
  hostId: "madp-engine-main", name: "madp-engine-cloud", lastSeenAt: "2026-11-12T05:20:58.000Z", cpuPercent: 4, load1: 0.3, load5: 0.2, load15: 0.1, cpuCount: 8,
  memUsedMb: 1532, memTotalMb: 32021, diskUsedGb: 60, diskTotalGb: 200, runningJobs: 0, runningLanes: 0, activeAgents: 0, queueLength: 1,
  release: "4dbcf703-20261110T081824Z", uptime: 247655, ...o,
});
const sample = (at: string, cpu: number): EngineSampleView => ({ hostId: "madp-engine-main", at, cpuPercent: cpu, memUsedMb: 1500, runningJobs: 0, activeAgents: 0 });
const SERVER_NOW = "2026-11-12T05:21:10.000Z";

function held(o: Partial<EngineStatusHeld> = {}): EngineStatusHeld {
  const history = [sample("2026-11-12T04:00:00.000Z", 10), sample("2026-11-12T05:20:28.000Z", 4)];
  return { hosts: [host()], samples: history, now: SERVER_NOW, history, historyReadAt: 1, historyFailed: false, historyTriedAt: 1, ...o };
}

const render = () => renderToStaticMarkup(<EngineSection />);
const refetch = vi.fn();

beforeEach(() => {
  state.access = { ready: true, isSuperAdmin: true, permissions: [] };
  refetch.mockReset();
});

describe("Engine & capacity section states", () => {
  it("reading: says so in a status line, nothing else", () => {
    state.query = { isLoading: true, isError: false, data: undefined, dataUpdatedAt: 0, refetch };
    const html = render();
    expect(state.enabled).toBe(true);
    expect(html).toContain('role="status"');
    expect(html).toContain("Reading the engine hosts…");
    expect(html).not.toContain("CPU");
  });

  it("nothing readable: the error with Try again, never a spinner", () => {
    state.query = { isLoading: false, isError: true, data: undefined, dataUpdatedAt: 0, refetch };
    const html = render();
    expect(html).toContain("The engine hosts could not be read");
    expect(html).toContain("Try again");
    expect(html).not.toContain("Reading the engine hosts");
  });

  it("the hosts reporting: the engine's own numbers and the 24-hour charts", () => {
    state.query = { isLoading: false, isError: false, data: held(), dataUpdatedAt: Date.now(), refetch };
    const html = render();
    for (const text of ["madp-engine-cloud", "Reporting", "4 %", "1.5 GB of 31 GB", "4dbcf703-20261110T081824Z", "Last 24 hours · madp-engine-cloud", "highest 10 %"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("could not be read");
    expect(html).not.toContain("The engine is offline");
  });

  it("the latest reading failed: the last one is shown, judged at its own time, with Try again", () => {
    // the browser clock is a day past the reading: a failed read must not turn that into "offline"
    state.query = { isLoading: false, isError: true, data: held(), dataUpdatedAt: Date.now() - 86_400_000, refetch };
    const html = render();
    expect(html).toContain("The engine hosts could not be read just now");
    expect(html).toContain("Showing the last reading, from");
    expect(html).toContain("Try again");
    expect(html).toContain("Reporting");
    expect(html).not.toContain("The engine is offline");
  });

  it("the engine stopped: offline with the time of the last heartbeat", () => {
    state.query = { isLoading: false, isError: false, data: held({ hosts: [host({ lastSeenAt: "2026-11-12T03:00:00.000Z" })] }), dataUpdatedAt: Date.now(), refetch };
    const html = render();
    expect(html).toContain("The engine is offline");
    expect(html).toContain("No heartbeat since");
    expect(html).toContain("(2 h ago)");
  });

  it("the history missing: the host cards stay, the charts say why they are short, with Try again", () => {
    state.query = { isLoading: false, isError: false, data: held({ history: [], historyReadAt: 0, historyFailed: true, samples: [sample("2026-11-12T05:20:58.000Z", 4)] }), dataUpdatedAt: Date.now(), refetch };
    const html = render();
    expect(html).toContain("The last 24 hours could not be read");
    expect(html).toContain("The charts show only the latest heartbeat.");
    expect(html).toContain("Try again");
    expect(html).toContain("Jobs running");
  });

  it("no access: says whom to ask, reads nothing", () => {
    state.access = { ready: true, isSuperAdmin: false, permissions: [] };
    state.query = { isLoading: false, isError: false, data: undefined, dataUpdatedAt: 0, refetch };
    const html = render();
    expect(html).toContain("You can&#x27;t see the engine&#x27;s capacity");
    expect(html).toContain("Ask a platform admin");
    expect(state.enabled).toBe(false);
  });
});
