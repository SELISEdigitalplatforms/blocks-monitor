// The Engine & capacity and AI accounts sections, rendered from op answers: host cards with a stale warning, the 24 h
// charts (one series each, labelled, with a table view), the account pool table and plain words throughout.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EngineView, HostTrends } from "../../src/components/platform/sections/EngineSection";
import { AiAccountsView, changesFrom } from "../../src/components/platform/sections/AiAccountsSection";
import { ago, samplesByHour, until } from "../../src/components/platform/engineData";
import { formatDateTime } from "../../src/i18n/format";
import { trendPath } from "../../src/components/platform/TrendChart";
import type { AiAccountView, EngineHostView, EngineSampleView } from "../../src/domain/platformEngine";

const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const host = (o: Partial<EngineHostView> = {}): EngineHostView => ({
  hostId: "madp-engine-vm1", name: "vm1", lastSeenAt: "2026-11-09T11:59:45.000Z", cpuPercent: 37, load1: 2.1, load5: 1.8, load15: 1.5, cpuCount: 8,
  memUsedMb: 9216, memTotalMb: 16384, diskUsedGb: 40, diskTotalGb: 100, runningJobs: 2, runningLanes: 2, activeAgents: 5, queueLength: 1,
  release: "20261109-1100-abc", uptime: 93784, ...o,
});
const samples: EngineSampleView[] = [
  { hostId: "madp-engine-vm1", at: "2026-11-09T10:10:00.000Z", cpuPercent: 20, memUsedMb: 8000, runningJobs: 1, activeAgents: 2 },
  { hostId: "madp-engine-vm1", at: "2026-11-09T10:40:00.000Z", cpuPercent: 60, memUsedMb: 9000, runningJobs: 2, activeAgents: 6 },
  { hostId: "madp-engine-vm1", at: "2026-11-09T11:59:00.000Z", cpuPercent: 37, memUsedMb: 9216, runningJobs: 2, activeAgents: 5 },
];
const BANNED = /prototype|mock|demo|sample data|test data|fake|simulated|magic|✨/i;

describe("Engine & capacity", () => {
  it("shows each host's load, memory, disk, work and release, without a page title of its own", () => {
    const html = renderToStaticMarkup(<EngineView status={{ hosts: [host()], samples, now: new Date(NOW).toISOString() }} now={NOW} />);
    for (const text of ["vm1", "37 %", "9.0 GB of 16 GB", "40 of 100 GB", "2.10", "Jobs running", "Lanes running", "Agents working", "Waiting in the queue", "20261109-1100-abc", "1 day 2 h", "Reporting"]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("<h1");
    expect(html).not.toMatch(BANNED);
    // the charts: one series each, named by the title, with the latest value and a summary for screen readers
    expect(html).toContain("CPU: now 37 %, highest 60 % in the last 24 hours");
    expect(html).toContain("Agents working: now 5, highest 6 in the last 24 hours");
    expect(html).toContain("Charts");
    expect(html).toContain("Table");
  });

  it("says the engine is offline, with the time of its last heartbeat, when every host stopped reporting", () => {
    const html = renderToStaticMarkup(<EngineView status={{ hosts: [host({ lastSeenAt: "2026-11-09T11:50:00.000Z" })], samples: [], now: "" }} now={NOW} />);
    const since = formatDateTime("2026-11-09T11:50:00.000Z");
    expect(html).toContain("The engine is offline");
    expect(html).toContain(`No heartbeat since ${since} (10 min ago).`);
    expect(html).toContain("Check that the engine service is running.");
    expect(html).toContain("Not reporting · last seen 10 min ago");
    expect(html).toContain(`No heartbeat since ${since}, so the numbers below are from its last report.`);
    expect(html).toContain("No samples in the last 24 hours");
    expect(html).not.toContain("One engine host is not reporting");
    expect(html).not.toMatch(BANNED);
  });

  it("names the silent hosts when only some stopped reporting", () => {
    const html = renderToStaticMarkup(
      <EngineView status={{ hosts: [host({ hostId: "a", name: "vm-a" }), host({ hostId: "b", name: "vm-b", lastSeenAt: "2026-11-09T11:50:00.000Z" })], samples, now: "" }} now={NOW} />,
    );
    expect(html).toContain("One engine host is not reporting");
    expect(html).toContain("Not reporting · last seen 10 min ago");
    expect(html).toContain("Reporting · 15 s ago");
    expect(html).not.toContain("The engine is offline");
  });

  it("says when a host never sent a heartbeat", () => {
    const html = renderToStaticMarkup(<EngineView status={{ hosts: [host({ lastSeenAt: "" })], samples: [], now: "" }} now={NOW} />);
    expect(html).toContain("The engine is offline");
    expect(html).toContain("No engine host has sent a heartbeat yet.");
    expect(html).toContain("This host has not sent a heartbeat yet.");
    expect(html).toContain("Not reporting · last seen never");
  });

  it("keeps the host cards and offers Try again when the history or the latest reading could not be read", () => {
    const missing = renderToStaticMarkup(<EngineView status={{ hosts: [host()], samples: [], now: "" }} now={NOW} history={{ failed: true, readAt: 0, onRetry: () => {} }} />);
    expect(missing).toContain("The last 24 hours could not be read");
    expect(missing).toContain("The charts show only the latest heartbeat.");
    expect(missing).toContain("Try again");
    expect(missing).toContain("Jobs running");
    const readAt = Date.parse("2026-11-09T11:30:00.000Z");
    const older = renderToStaticMarkup(<EngineView status={{ hosts: [host()], samples, now: "" }} now={NOW} history={{ failed: true, readAt, onRetry: () => {} }} />);
    expect(older).toContain(`The charts show the history as read at ${formatDateTime(readAt)} and the latest heartbeat.`);
    const fine = renderToStaticMarkup(<EngineView status={{ hosts: [host()], samples, now: "" }} now={NOW} history={{ failed: false, readAt, onRetry: () => {} }} />);
    expect(fine).not.toContain("could not be read");
    expect(fine).not.toContain("Try again");
    const stale = renderToStaticMarkup(<EngineView status={{ hosts: [host()], samples, now: "2026-11-09T12:00:00.000Z" }} now={NOW} readFailed={{ at: "2026-11-09T12:00:00.000Z", onRetry: () => {} }} />);
    expect(stale).toContain("The engine hosts could not be read just now");
    expect(stale).toContain(`Showing the last reading, from ${formatDateTime("2026-11-09T12:00:00.000Z")}.`);
    expect(stale).toContain("Try again");
    expect(stale).toContain("Reporting · 15 s ago");
  });

  it("says what the section will hold when no host reports yet", () => {
    const html = renderToStaticMarkup(<EngineView status={{ hosts: [], samples: [], now: "" }} now={NOW} />);
    expect(html).toContain("No engine host is reporting yet");
    expect(html).not.toMatch(/coming soon/i);
  });

  it("has an hourly table view of the samples and draws the line inside the frame", () => {
    expect(samplesByHour(samples)).toEqual([
      { hour: "2026-11-09T10:00:00.000Z", cpuAvg: 40, cpuMax: 60, memAvgMb: 8500, agentsMax: 6, jobsMax: 2 },
      { hour: "2026-11-09T11:00:00.000Z", cpuAvg: 37, cpuMax: 37, memAvgMb: 9216, agentsMax: 5, jobsMax: 2 },
    ]);
    const d = trendPath([{ at: "2026-11-09T00:00:00.000Z", value: 0 }, { at: "2026-11-09T12:00:00.000Z", value: 150 }], 100, Date.parse("2026-11-09T00:00:00.000Z"), NOW);
    expect(d).toBe("M0.00,40.00 L100.00,0.00");
    expect(renderToStaticMarkup(<HostTrends host={host()} samples={samples} now={NOW} />)).toContain("Last 24 hours · vm1");
  });

  it("speaks of times in plain words", () => {
    expect(ago("2026-11-09T11:59:55.000Z", NOW)).toBe("just now");
    expect(ago("2026-11-09T11:00:00.000Z", NOW)).toBe("1 h ago");
    expect(ago("2026-11-09T11:48:00.000Z", NOW)).toBe("12 min ago");
    expect(ago("", NOW)).toBe("never");
    expect(until("2026-11-09T14:10:00.000Z", NOW)).toBe("in 2 h 10 min");
    expect(until("2026-11-09T11:00:00.000Z", NOW)).toBe("");
  });
});

const account = (o: Partial<AiAccountView> = {}): AiAccountView => ({
  itemId: "0123456789abcdef01234567", label: "sub-a", provider: "claude-subscription", status: "active", usage5hPercent: 42, usage7dPercent: null,
  resetsAt: "2026-11-09T14:00:00.000Z", lastUsedAt: "2026-11-09T11:58:00.000Z", priority: 100, note: "", hostId: "madp-engine-vm1", ...o,
});

describe("AI accounts", () => {
  const answer = {
    accounts: [account(), account({ itemId: "1123456789abcdef01234567", label: "sub-b", status: "cooling", usage5hPercent: 99.5 }), account({ itemId: "2123456789abcdef01234567", label: "api-key", provider: "anthropic-api", usage5hPercent: null })],
    rotateAtPercent: 99,
    rotateIsDefault: true,
  };

  it("lists the pool with usage, resets, last use and order, and explains how accounts are added on the host", () => {
    const html = renderToStaticMarkup(<AiAccountsView answer={answer} now={NOW} canManage={false} />);
    for (const text of ["sub-a", "sub-b", "api-key", "Claude subscription", "API key (pay per use)", "In rotation", "Resting", "42 %", "100 %", "Not measured yet", "in 2 h", "2 min ago", "2 of 3 accounts in rotation", "Rest an account at", "Default", "Adding an account", "signed in once on\n          the host".replace(/\n\s+/, " ")]) {
      expect(html).toContain(text);
    }
    expect(html).not.toContain("<h1");
    expect(html).not.toMatch(BANNED);
    expect(html).not.toMatch(/CLAUDE_CONFIG_DIR|secrets\/|\.key\b/);
    // without the manage permission there are no controls
    expect(html).not.toContain("Save changes");
  });

  it("offers status, order and note controls to people who manage the accounts (never cooling)", () => {
    const html = renderToStaticMarkup(<AiAccountsView answer={answer} now={NOW} canManage />);
    expect(html).toContain("Save changes");
    expect(html).toContain("Status of sub-a");
    expect(html).toContain("Order of sub-b");
    expect(html).toContain("Resting now");
  });

  it("turns edits into changes with only what differs, and checks the order", () => {
    const base = answer.accounts;
    expect(changesFrom(base, {})).toEqual({ ok: true, changes: [] });
    expect(changesFrom(base, { [base[1]!.itemId]: { status: "active", priority: "100", note: "" } })).toEqual({ ok: true, changes: [] });
    expect(changesFrom(base, { [base[0]!.itemId]: { status: "standby", priority: "3", note: " team plan " } }))
      .toEqual({ ok: true, changes: [{ itemId: base[0]!.itemId, status: "standby", priority: 3, note: "team plan" }] });
    expect(changesFrom(base, { [base[0]!.itemId]: { status: "active", priority: "x", note: "" } })).toMatchObject({ ok: false });
  });

  it("says what is missing when no account is listed", () => {
    const html = renderToStaticMarkup(<AiAccountsView answer={{ accounts: [], rotateAtPercent: 99, rotateIsDefault: true }} now={NOW} canManage />);
    expect(html).toContain("No model accounts listed yet");
    expect(html).toContain("When an account rests");
  });
});
