// "Parallel streams" at the head of the Build step's Queue (src/components/build/queue/ParallelStreams.tsx): the 1..5
// control with the tech lead's suggestion marked and its reason, the options above it disabled with a plain reason, a
// person without the right reading it only, and the running and waiting change requests with their stream or what they
// wait for. Real components over fixed rows.
//   npx vitest run --config test/changes/vitest.config.ts test/changes/parallelStreams.test.tsx
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { EngineJob } from "../../src/blocks/engine/types";
import { ParallelStreams, ParallelStreamsView, mayMissBuilds, streamRunName } from "../../src/components/build/queue/ParallelStreams";
import { parseChangeAnalysis, serializeChangeAnalysis } from "../../src/domain/changeAnalysis";
import { planStreams, streamOptions } from "../../src/domain/parallelStreams";
import { ANALYSIS, cr, fakeCtx, job } from "./fixtures";

function render(el: ReactElement): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={qc}><MemoryRouter>{el}</MemoryRouter></QueryClientProvider>);
}
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
const radios = (html: string) => [...html.matchAll(/<button[^>]*role="radio"[^>]*>/g)].map((m) => m[0]);
const FORBIDDEN = /\b(AI|artificial|simulat\w*|mock\w*|demo|sample|fake|prototype)\b/i;

const withAreas = (codeAreas: string[]) => serializeChangeAnalysis(parseChangeAnalysis({ ...ANALYSIS, questions: [], codeAreas })!);
const changes = [
  cr({ id: "cr-3", number: 3, title: "Invoice totals", status: "building", analysis: withAreas(["api: src/invoices/"]) }),
  cr({ id: "cr-5", number: 5, title: "Profile photo", status: "building", analysis: withAreas(["web: src/profile/"]) }),
  cr({ id: "cr-6", number: 6, title: "Invoice export", status: "approved", analysis: withAreas(["api: src/invoices/export.ts"]) }),
  cr({ id: "cr-7", number: 7, title: "Report title", status: "approved", analysis: withAreas(["web: src/reports/"]) }),
];
const build = (id: string, crId: string, status: EngineJob["status"], m: number, message: string | null = null): EngineJob => ({
  ...job("change.build", status, status === "queued" ? 0 : 40, crId), id, message,
  createdAt: new Date(Date.UTC(2026, 10, 9, 9, m)).toISOString(), claimedAt: status === "queued" ? null : new Date(Date.UTC(2026, 10, 9, 9, m + 1)).toISOString(),
});
const jobs = [
  build("j3", "cr-3", "running", 1, "CR-003 is built; it waits for its turn to land on development (CR-005 is landing now)."),
  build("j5", "cr-5", "running", 2, "Building CR-005: 1 of 2 tickets done."),
  build("j6", "cr-6", "queued", 3),
  build("j7", "cr-7", "queued", 4),
];

describe("the parallel streams control", () => {
  it("marks the suggestion, disables the options above it with a plain reason and lists every build with its state", () => {
    const plan = planStreams({ jobs, changes: changes.map((c) => ({ ...c, analysis: c.analysis })), limit: 3 });
    const html = render(<ParallelStreamsView chosen={2} inUse={2} inUseWhy="" suggestion={{ suggested: 3, cap: 5, reason: "3 of the 4 waiting changes touch different code." }}
      options={streamOptions({ suggested: 3, cap: 5 }, true)} plan={plan} linkOf={(id) => `/p/p-asset/build?cr=${id.slice(3)}`}
      lineOf={(id) => jobs.find((j) => j.id === id)?.message ?? ""} onChoose={() => undefined} />);
    const text = textOf(html);
    expect(text).toContain("Parallel streams");
    expect(text).toContain("Tech lead suggests 3: 3 of the 4 waiting changes touch different code.");
    expect(text).toContain("4 and 5: Above the tech lead's suggestion of 3.");
    const r = radios(html);
    expect(r).toHaveLength(5);
    expect(r.map((b) => /aria-checked="true"/.test(b))).toEqual([false, true, false, false, false]);
    expect(r.map((b) => /disabled=""/.test(b))).toEqual([false, false, false, true, true]);
    expect(r[2]).toContain('aria-label="3 streams, suggested"');
    expect(r[3]).toContain("Above the tech lead");
    // what runs, in which stream, what starts now and what waits for what
    expect(text).toContain("Stream 1 CR-003 Invoice totals CR-003 is built; it waits for its turn to land on development (CR-005 is landing now).");
    expect(text).toContain("Stream 2 CR-005 Profile photo Building CR-005: 1 of 2 tickets done.");
    // optimistic parallel development: the overlapping one starts too, and is told it lands after CR-003
    expect(text).toContain("Starting CR-006 Invoice export Starting: developing in parallel; lands after CR-003 (both change api: src/invoices/export.ts — will be rebased and checked again).");
    expect(text).toContain("Waiting CR-007 Report title Waits for a free stream: all 3 are busy.");
    expect(html).toContain('href="/p/p-asset/build?cr=6"');
    expect(text).not.toMatch(FORBIDDEN);
    expect(html).not.toMatch(/sparkle/i);
  });

  it("says when fewer run than chosen, and when nothing runs", () => {
    const html = render(<ParallelStreamsView chosen={4} inUse={2} inUseWhy="The development environment allows only a few check runs an hour; 2 at most."
      suggestion={{ suggested: 2, cap: 2, reason: "The development environment allows only a few check runs an hour; 2 at most." }}
      options={streamOptions({ suggested: 2, cap: 2 }, true, 4)} plan={{ limit: 2, running: [], starting: [], waiting: [], startable: [] }} linkOf={() => null} lineOf={() => ""} />);
    const text = textOf(html);
    expect(text).toContain("2 run for now: The development environment allows only a few check runs an hour; 2 at most.");
    // the saved choice stays checked, never "above the suggestion"
    expect(text).toContain("3 and 5: The product's set-up does not allow this many yet.");
    expect(radios(html).map((b) => /aria-checked="true"/.test(b))).toEqual([false, false, false, true, false]);
    expect(radios(html)[3]).not.toMatch(/disabled=""/);
    expect(text).toContain("No change request is being built right now.");
  });

  it("over the project's rows: one stream without a choice; read-only for a person without the right", () => {
    const html = render(<ParallelStreams ctx={fakeCtx()} projectId="p-asset" jobs={jobs} changes={changes} />);
    const text = textOf(html);
    // no stored choice: one at a time, as before; before the build host checked the set-up, a safe start of 2
    expect(radios(html).map((b) => /aria-checked="true"/.test(b))).toEqual([true, false, false, false, false]);
    expect(text).toContain("Tech lead suggests 2: 3 approved changes touch separate code; the build host has not checked the product's set-up yet, so 2 for now.");
    // every queued build is listed with what it waits for (one stream: a free stream; overlapping code: that build)
    expect(text).toContain("Waiting CR-006 Invoice export Waits for a free stream: one build at a time.");
    expect(text).toContain("Waiting CR-007 Report title Waits for a free stream: one build at a time.");
    // a queued fix round reads in the Build step's own words, with what it waits for
    const round: EngineJob = { ...build("f6", "cr-6", "queued", 5), inputJson: JSON.stringify({ projectId: "p-asset", changeRequestId: "cr-6", fixChecks: true, afterJobId: "j0", baseJobId: "j0", round: 1, auto: true, version: "1.2.1" }) };
    expect(streamRunName(round, { jobs: [...jobs, round], changes })).toBe("Fix round 1 of CR-006");
    expect(streamRunName(jobs[2], { jobs, changes })).toBeNull();
    const withRound = textOf(render(<ParallelStreams ctx={fakeCtx()} projectId="p-asset" jobs={[...jobs.slice(0, 2), round]} changes={changes} />));
    expect(withRound).toContain("Waiting CR-006 Fix round 1 of CR-006 Waits for a free stream: one build at a time.");
    const reader = { ...fakeCtx(), can: () => false } as ReturnType<typeof fakeCtx>;
    const ro = render(<ParallelStreams ctx={reader} projectId="p-asset" jobs={jobs} changes={changes} />);
    expect(radios(ro).every((b) => /disabled=""/.test(b))).toBe(true);
    expect(textOf(ro)).toContain("Only people who run builds or edit the business context choose this.");
  });

  it("reads the builds on their own when the page's job list may miss one", () => {
    // every change being built has its build in the list: the list is enough
    expect(mayMissBuilds(jobs, changes)).toBe(false);
    // CR-003 is being built but its build dropped out of the newest jobs (chat replies, analyses came after it)
    expect(mayMissBuilds(jobs.filter((j) => j.id !== "j3"), changes)).toBe(true);
    // a full list may have dropped one too
    expect(mayMissBuilds(Array.from({ length: 100 }, (_x, i) => ({ ...job("chat.reply", "succeeded", 100), id: `c${i}` })), [])).toBe(true);
  });

  it("a running build that shares code with one that started before it says it lands after it", () => {
    const running = [...jobs.slice(0, 2), build("j6", "cr-6", "running", 3, "Building CR-006: 1 of 2 tickets done.")];
    const plan = planStreams({ jobs: running, changes, limit: 3 });
    const text = textOf(render(<ParallelStreamsView chosen={3} inUse={3} inUseWhy="" suggestion={{ suggested: 3, cap: 5, reason: "3 approved changes touch separate code; the environment allows 5." }}
      options={streamOptions({ suggested: 3, cap: 5 }, true, 3)} plan={plan} linkOf={() => null} lineOf={(id) => running.find((j) => j.id === id)?.message ?? ""} />));
    expect(text).toContain("Stream 3 CR-006 Invoice export Building CR-006: 1 of 2 tickets done. Developing in parallel; lands after CR-003 (both change api: src/invoices/export.ts — will be rebased and checked again).");
  });

  it("the 'continue with the next increment' control sits beside the streams: on, off, read-only", () => {
    const view = (o: { on: boolean; canChange: boolean }) => render(<ParallelStreamsView chosen={1} inUse={1} inUseWhy=""
      suggestion={{ suggested: 2, cap: 5, reason: "x" }} options={streamOptions({ suggested: 2, cap: 5 }, true, 1)}
      plan={{ limit: 1, running: [], starting: [], waiting: [], startable: [] }} linkOf={() => null} lineOf={() => ""}
      continueIncrements={{ ...o, onChange: () => undefined }} />);
    const on = view({ on: true, canChange: true });
    expect(textOf(on)).toContain("Continue with the next increment when the checks pass");
    expect(textOf(on)).toContain("Only when its checks pass on development, never past the last increment. Cancel a next increment that started by itself to pause that change.");
    expect(on).toMatch(/<input type="checkbox"[^>]*checked=""/);
    expect(view({ on: false, canChange: true })).not.toMatch(/<input type="checkbox"[^>]*checked=""/);
    const ro = view({ on: false, canChange: false });
    expect(ro).toMatch(/<input type="checkbox"[^>]*disabled=""/);
    expect(textOf(ro)).toContain("Only people who run builds or edit the business context change this.");
    // over the project's rows: shown with the streams, off without the field
    const page = render(<ParallelStreams ctx={fakeCtx()} projectId="p-asset" jobs={jobs} changes={changes} />);
    expect(textOf(page)).toContain("Continue with the next increment when the checks pass");
    expect(page).not.toMatch(/<input type="checkbox"[^>]*checked=""/);
  });
});
