// The changes that need attention, in ONE place (src/components/delivery/attention.ts, AttentionPanel.tsx): the Release
// page shows one chip "Needs attention · N" instead of a full-width notice per change (09.11.2026: seven stacked
// "CR-0xx is on development, but not usable yet" notices on PrimaBook), and a right side panel lists each change in one
// row: code and title, its state in plain words, the version and the one next action, grouped by state with underline
// tabs and counts. A change whose failing checks pass since on a later version is listed for the record, never
// counted; none: no chip.
//   npx vitest run --config test/changes/vitest.config.ts test/changes/attentionPanel.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { DeliveryChangeRequest } from "../../src/blocks/delivery/types";
import type { EngineJob } from "../../src/blocks/engine/types";
import { ANALYSIS, OWNER, answered, cr, fakeCtx, job } from "./fixtures";
import { DEFAULT_CHECKS_POLICY, serializeChangeChecks, type ChecksRun } from "../../src/domain/changeChecks";
import { attentionCount, attentionItems, attentionRows, attentionTabs, blockedLine } from "../../src/components/delivery/attention";
import { AttentionList } from "../../src/components/delivery/AttentionPanel";

const APPROVED = answered(ANALYSIS, { q1: "The listing's own currency", q2: "No, hide them" });
const decided = { decidedAt: "2026-10-31T10:40:00.000Z", decidedByUserId: OWNER, selfApproved: true };
const t = (h: number, m = 0) => new Date(Date.UTC(2026, 10, 9, h, m)).toISOString();
const NOW = Date.UTC(2026, 10, 9, 22, 0);
const run = (o: Partial<ChecksRun> & Pick<ChecksRun, "jobId" | "at" | "version">): ChecksRun => ({
  kind: "build", env: "dev", status: "failed", commits: ["abc1234"], failed: 0, files: 0, fixtures: false, failing: [], round: 0, auto: false, baseJobId: "",
  known: [], diagnosed: [], ...o,
});
const fail = (name: string) => ({ repo: "api", name, reason: "FAIL not ok 1" });
const change = (n: number, o: Partial<DeliveryChangeRequest> = {}) => cr({
  id: `cr-${n}`, number: n, title: `Change ${n}`, status: "released-dev", analysisValue: APPROVED, ...decided, ...o,
});
const built = (id: string, crId: string, h: number, errorCode: string, input: Record<string, unknown> = {}, status: EngineJob["status"] = "succeeded"): EngineJob => ({
  ...job("change.build", status, 100, crId), id, errorCode: errorCode || null, finishedAt: status === "succeeded" ? t(h) : null, createdAt: t(h - 1),
  inputJson: JSON.stringify({ projectId: "p-asset", changeRequestId: crId, ...input }),
});

/** The PrimaBook evening in small. */
function primaBook() {
  const changes = [
    // CR-5: its own checks failed before they were recorded by name (an older run): only running them again tells
    change(5, { version: "0.13.0" }),
    // CR-9: its failing check passes since 0.15.0 (CR-15's run)
    change(9, { version: "0.10.0", checks: serializeChangeChecks({ v: 1, runs: [run({ jobId: "j-9", at: t(11, 33), version: "0.10.0", failed: 1, files: 1, failing: [fail("test/rates.mjs")] })] }) }),
    change(15, { version: "0.15.0", checks: serializeChangeChecks({ v: 1, runs: [run({ jobId: "j-15", at: t(13, 13), version: "0.15.0", status: "ok", files: 1, passed: [{ repo: "api", name: "test/rates.mjs" }] })] }) }),
    // CR-16: its checks could not judge it (a service of the environment refused)
    change(16, { version: "0.20.1" }),
    // CR-20: one of three checks fails, named on its record
    change(20, { version: "0.23.1", checks: serializeChangeChecks({ v: 1, runs: [run({ jobId: "j-20", at: t(21, 31), version: "0.23.1", failed: 1, files: 3, failing: [fail("test/platform-companies.mjs")] })] }) }),
    // CR-21: "building" for an hour, and no build of its own anywhere
    change(21, { status: "building", version: "0.23.0", updatedAt: t(21, 0) }),
  ];
  const jobs = [
    built("j-5", "cr-5", 12, "after-deploy:accept-failed=2/2"),
    built("j-9", "cr-9", 11, "after-deploy:accept-failed=1/1"),
    built("j-15", "cr-15", 13, ""),
    built("j-16", "cr-16", 19, "after-deploy:accept-not-run=service"),
    built("j-20", "cr-20", 21, "after-deploy:accept-failed=1/3", { fixChecks: true, afterJobId: "j-20b", baseJobId: "j-20b", round: 2, auto: true }),
    built("j-20b", "cr-20", 20, "after-deploy:accept-failed=2/8"),
    // CR-18's build runs: never CR-21's
    { ...built("j-18", "cr-18", 22, "", {}, "running"), createdAt: t(21, 36) },
  ];
  return { changes, jobs };
}
const items = (o: { canRun?: boolean; changes?: DeliveryChangeRequest[]; jobs?: EngineJob[] } = {}) => {
  const w = primaBook();
  return attentionItems({ projectId: "p-asset", changes: o.changes ?? w.changes, jobs: o.jobs ?? w.jobs, policy: DEFAULT_CHECKS_POLICY, now: NOW, canRun: o.canRun ?? true });
};

describe("one row per change, its state in plain words and the one next action", () => {
  it("the PrimaBook evening: four need attention, one passes since a later version", () => {
    const list = items();
    const row = (code: string) => list.find((x) => x.code === code);
    expect(row("CR-020")).toMatchObject({ group: "checks", state: "Checks fail on development (1 of 3)", version: "0.23.1", action: { kind: "fix", label: "Fix what the checks found" } });
    expect(row("CR-021")).toMatchObject({ group: "lost", state: "Build requested but not picked up", action: { kind: "start", label: "Start the build again" } });
    expect(row("CR-005")).toMatchObject({ group: "checks", state: "Checks fail on development (2 of 2)", action: { kind: "recheck", label: "Run the checks again", jobId: "j-5" } });
    expect(row("CR-016")).toMatchObject({ group: "unfinished", state: "Not finished: its checks could not judge it on development", action: { kind: "recheck", jobId: "j-16" } });
    expect(row("CR-009")).toMatchObject({ group: "passed", state: "Superseded: its checks pass since 0.15.0 (after CR-015)", action: { kind: "open" } });
    expect(row("CR-015")).toBeUndefined();
    expect(attentionCount(list)).toBe(4);
    expect(attentionTabs(list).map((x) => `${x.label} ${x.count}`)).toEqual(["All 4", "Checks fail 2", "Not finished 1", "Not started 1", "Pass since 1"]);
    expect(attentionRows(list, "all").map((x) => x.code)).toEqual(["CR-021", "CR-020", "CR-016", "CR-005"]);
    expect(attentionRows(list, "passed").map((x) => x.code)).toEqual(["CR-009"]);
  });

  it("while a fix round runs: the team is fixing it; the row opens the change", () => {
    const w = primaBook();
    const jobs = [...w.jobs, built("j-20c", "cr-20", 22, "", { fixChecks: true, afterJobId: "j-20", baseJobId: "j-20b", round: 3, auto: false }, "running")];
    expect(items({ jobs }).find((x) => x.code === "CR-020")).toMatchObject({
      group: "checks", state: "Checks fail on development; the development team is fixing them (round 3)", action: { kind: "open" },
    });
  });

  it("the automatic rounds are used: Put development back (on the change's page)", () => {
    const w = primaBook();
    const jobs = w.jobs.filter((j) => j.id !== "j-20").concat(
      built("j-20r1", "cr-20", 20, "after-deploy:accept-failed=2/8", { fixChecks: true, afterJobId: "j-20b", baseJobId: "j-20b", round: 1, auto: true }),
      built("j-20", "cr-20", 21, "after-deploy:accept-failed=1/3", { fixChecks: true, afterJobId: "j-20r1", baseJobId: "j-20b", round: 2, auto: true }),
    );
    expect(items({ jobs }).find((x) => x.code === "CR-020")?.action).toEqual({ kind: "revert", label: "Put development back" });
  });

  it("without the right to run builds every row opens its change", () => {
    expect(items({ canRun: false }).every((x) => x.action.kind === "open")).toBe(true);
  });

  it("nothing open: no rows, the chip's count is 0 (the chip is hidden)", () => {
    const w = primaBook();
    const ok = [change(15, { version: "0.15.0" })];
    const list = items({ changes: ok, jobs: w.jobs.filter((j) => j.id === "j-15") });
    expect(list).toEqual([]);
    expect(attentionCount(list)).toBe(0);
  });

  it("the line under Send to Staging names the change, briefly", () => {
    expect(blockedLine("0.23.1", { code: "CR-020" })).toBe("v0.23.1 carries CR-020, whose own checks fail on development.");
  });
});

describe("the panel's list", () => {
  const html = (tab?: "all" | "passed") => {
    const w = primaBook();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
    return renderToStaticMarkup(
      <QueryClientProvider client={qc}><MemoryRouter>
        <AttentionList onClose={() => undefined} ctx={fakeCtx()} items={items()} jobs={w.jobs} tab={tab} />
      </MemoryRouter></QueryClientProvider>,
    ).replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ").trim();
  };

  it("tabs with counts, one row per change with its state, version and action", () => {
    const text = html();
    expect(text).toContain("All 4");
    expect(text).toContain("Checks fail 2");
    expect(text).toContain("Pass since 1");
    expect(text).toContain("CR-020 Change 20 v0.23.1 Checks fail on development (1 of 3) Fix what the checks found Open the change");
    expect(text).toContain("CR-021 Change 21 v0.23.0 Build requested but not picked up Start the build again Open the change");
    // the change whose checks pass since is not among those that need attention
    expect(text).not.toContain("CR-009");
    // never the old notice
    expect(text).not.toContain("is on development, but not usable yet");
  });

  it("the Pass since tab lists it for the record", () => {
    expect(html("passed")).toContain("CR-009 Change 9 v0.10.0 Superseded: its checks pass since 0.15.0 (after CR-015) Open the change");
  });
});
