// The real build estimates (src/domain/engineEstimate.ts): what counts as a measured build, the calibration maths
// (Theil-Sen line per kind, range, cost), thin history (a kind with too few builds counts every build; too few in all:
// no number at all), the server's read and its 10-minute cache (functions/_lib/engineEstimates.ts, op
// engine.estimates), the words in English and de-CH (src/components/build/estimateText.ts) and the screens that show
// them (Studio, Timeline, ticket card): never the tickets' stored person-hours.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement as h, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeCtx, listRegisteredOps, memoryGateway, runOp, type MemoryGateway } from "../../functions/_lib/testing";
import { createEstimateSource, engineEstimates, readMeasuredBuilds } from "../../functions/_lib/engineEstimates";
import { engineEstimatesOp } from "../../functions/project/ops/jobs/estimates";
import { opKind } from "@/blocks/fnKinds";
import {
  MIN_MEASURED_BUILDS, calibrate, estimateBuild, estimateTicket, fitLine, kindOfLane, measuredBuildOf, minutesInWords, parseCalibration,
  planEstimateHours, quantile, ticketEstimateHours, type EstimateCalibration, type MeasuredBuild,
} from "@/domain/engineEstimate";
import {
  buildEstimateTitle, estimateCostText, estimateTimeText, minuteRangeText, minutesText, noEstimateYet, ticketEstimateChip, ticketEstimateText, ticketEstimateTitle, usdText,
} from "@/components/build/estimateText";
import { EstimatesValue } from "@/components/build/EstimatesContext";
import { StudioView } from "@/components/build/StudioView";
import { TimelineView } from "@/components/build/TimelineView";
import type { BuildFocus, BuildWindow } from "@/components/build/model";
import { BlocksTicketCard } from "@/components/board/BlocksTicketCard";
import type { EngineJob } from "@/blocks/engine/types";
import type { DeliveryTicket } from "@/blocks/delivery/types";
import { STAGES } from "@/data/pipeline";
import { resetI18nForTests, setCulture } from "@/i18n";

const T0 = Date.parse("2026-11-10T08:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const USAGE = JSON.stringify({ v: 1, tokens: { in: 100, out: 5000, cacheRead: 100000, cacheWrite: 1000, total: 106100 }, costUsd: 4.5, models: ["m"], agents: 3, lanes: 1 });

/** A measured build row: `minutes` from start to finish, `tickets` Ticket refs, finished `at` minutes after T0. */
function jobRow(o: { minutes: number; tickets: number; at: number; kind?: string; status?: string; cr?: string; lane?: string; usage?: string | null; input?: Record<string, unknown>; claimedOnly?: boolean; cost?: number }) {
  const finish = T0 + o.at * 60_000;
  const start = finish - o.minutes * 60_000;
  const usage = o.usage === undefined ? (o.cost === undefined ? USAGE : JSON.stringify({ ...JSON.parse(USAGE), costUsd: o.cost })) : o.usage;
  return {
    Kind: o.kind ?? "change.build",
    Status: o.status ?? "succeeded",
    InputJson: JSON.stringify({ projectId: "p1", ...(o.cr ? { changeRequestId: o.cr } : {}), ...(o.lane ? { lane: o.lane } : {}), ...(o.input ?? {}) }),
    OutputRefs: [...(o.cr ? [`ChangeRequest:${o.cr}`] : []), ...Array.from({ length: o.tickets }, (_, i) => `Ticket:t-${o.at}-${i}`)],
    ClaimedAt: iso(start),
    ...(o.claimedOnly ? {} : { StartedAt: iso(start) }),
    FinishedAt: iso(finish),
    UsageJson: usage,
  };
}

/** Builds on a known line (base + perTicket x tickets) with a fixed, symmetric spread. */
function onLine(n: number, o: { kind: MeasuredBuild["kind"]; base: number; perTicket: number; cost?: [number, number] | null; from?: number }): MeasuredBuild[] {
  const spread = [0.8, 0.9, 1, 1.1, 1.2];
  return Array.from({ length: n }, (_, i) => {
    const tickets = 1 + (i % 12);
    const f = spread[i % spread.length]!;
    return {
      kind: o.kind,
      tickets,
      minutes: (o.base + o.perTicket * tickets) * f,
      costUsd: o.cost === null ? null : (o.cost ? o.cost[0] + o.cost[1] * tickets : 1 + 0.5 * tickets) * f,
      finishedAt: iso(T0 + ((o.from ?? 0) + i) * 60_000),
    };
  });
}

const FEATURE = { base: 13, perTicket: 0.75, cost: [1.5, 0.55] as [number, number] };
const FIX = { base: 6, perTicket: 0.7, cost: [0.25, 0.3] as [number, number] };
const fullCalibration = (): EstimateCalibration => calibrate([...onLine(130, { kind: "feature", ...FEATURE }), ...onLine(38, { kind: "fix", ...FIX, from: 200 })]);

describe("a measured build", () => {
  it("is a succeeded build with recorded engine usage, its times and its tickets", () => {
    const b = measuredBuildOf(jobRow({ minutes: 19, tickets: 8, at: 30, cr: "cr1" }), (id) => (id === "cr1" ? "add" : null));
    expect(b).toMatchObject({ kind: "feature", tickets: 8, costUsd: 4.5 });
    expect(b!.minutes).toBeCloseTo(19, 6);
    // the change request's lane decides the kind: fix and change are fixes
    expect(measuredBuildOf(jobRow({ minutes: 8, tickets: 2, at: 31, cr: "cr2" }), () => "fix")?.kind).toBe("fix");
    expect(measuredBuildOf(jobRow({ minutes: 8, tickets: 2, at: 31, cr: "cr2" }), () => "change")?.kind).toBe("fix");
    // an imported run names its lane in its input; a milestone build is feature work
    expect(measuredBuildOf(jobRow({ minutes: 8, tickets: 2, at: 32, lane: "fix" }))?.kind).toBe("fix");
    expect(measuredBuildOf(jobRow({ minutes: 20, tickets: 9, at: 33, kind: "build.run" }))?.kind).toBe("feature");
    // an unknown lane counts only for all kinds together
    expect(measuredBuildOf(jobRow({ minutes: 8, tickets: 2, at: 34, cr: "gone" }))?.kind).toBeNull();
    // without StartedAt the claim is the start
    expect(measuredBuildOf(jobRow({ minutes: 12, tickets: 3, at: 35, claimedOnly: true }))?.minutes).toBeCloseTo(12, 6);
    expect(kindOfLane("enhance")).toBe("feature");
    expect(kindOfLane("")).toBeNull();
  });

  it("is never a failed or cancelled build, a run after a deploy, one without usage, tickets or times, or another kind", () => {
    const no = [
      jobRow({ minutes: 10, tickets: 3, at: 1, status: "failed" }),
      jobRow({ minutes: 10, tickets: 3, at: 1, status: "cancelled" }),
      jobRow({ minutes: 3, tickets: 3, at: 1, input: { afterDeploy: true } }),
      jobRow({ minutes: 10, tickets: 3, at: 1, usage: "null" }),
      jobRow({ minutes: 10, tickets: 3, at: 1, usage: null }),
      jobRow({ minutes: 10, tickets: 3, at: 1, usage: JSON.stringify({ v: 1, tokens: { total: 0 }, costUsd: 0 }) }),
      jobRow({ minutes: 10, tickets: 0, at: 1 }),
      jobRow({ minutes: 10, tickets: 3, at: 1, kind: "board.plan" }),
      jobRow({ minutes: 25 * 60, tickets: 3, at: 2000 }),
      { ...jobRow({ minutes: 10, tickets: 3, at: 1 }), FinishedAt: null },
    ];
    for (const row of no) expect(measuredBuildOf(row), JSON.stringify(row).slice(0, 120)).toBeNull();
  });
});

describe("the calibration", () => {
  it("finds the per-build and per-ticket time of each kind, with a range around it and the cost", () => {
    const cal = fullCalibration();
    expect(cal.builds).toBe(168);
    expect(cal.feature.time!.base).toBeCloseTo(FEATURE.base, 0);
    expect(cal.feature.time!.perTicket).toBeCloseTo(FEATURE.perTicket, 1);
    expect(cal.fix.time!.base).toBeCloseTo(FIX.base, 0);
    expect(cal.feature.time!.low).toBeLessThan(1);
    expect(cal.feature.time!.high).toBeGreaterThan(1);
    expect(cal.feature.cost!.perTicket).toBeCloseTo(0.55, 1);
    expect(cal.feature.time!.maxTickets).toBe(12);
    expect(cal.from).toBe(iso(T0));
    expect(cal.to).toBe(iso(T0 + 237 * 60_000));
  });

  it("is a Theil-Sen line: one wild run does not pull it, and another ticket never makes a build shorter", () => {
    const points = Array.from({ length: 20 }, (_, i) => [1 + (i % 10), 10 + (1 + (i % 10))] as const);
    const wild = fitLine([...points, [2, 500]])!;
    expect(wild.base).toBeCloseTo(10, 6);
    expect(wild.perTicket).toBeCloseTo(1, 6);
    const falling = fitLine(Array.from({ length: 12 }, (_, i) => [i + 1, 30 - i] as const))!;
    expect(falling.perTicket).toBe(0);
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it("with too few builds of a kind counts every build, and with too few in all has no number", () => {
    const fewFixes = calibrate([...onLine(20, { kind: "feature", ...FEATURE }), ...onLine(MIN_MEASURED_BUILDS - 1, { kind: "fix", ...FIX, from: 100 })]);
    expect(fewFixes.fix.builds).toBe(9);
    expect(fewFixes.fix.time).toBeNull();
    const fix = estimateBuild(fewFixes, ["fix", "fix"])!;
    expect(fix.pooled).toBe(true);
    expect(fix.builds).toBe(29);
    expect(estimateTicket(fewFixes, "fix")!.pooled).toBe(true);
    expect(estimateBuild(fewFixes, ["story"])!.pooled).toBe(false);

    const thin = calibrate(onLine(MIN_MEASURED_BUILDS - 1, { kind: "feature", ...FEATURE }));
    expect(estimateBuild(thin, ["story", "task"])).toBeNull();
    expect(estimateTicket(thin, "story")).toBeNull();
    expect(ticketEstimateHours(thin, "story")).toBeUndefined();
    expect(planEstimateHours(thin, [["story"]])).toBeUndefined();
    expect(noEstimateYet(thin)).toEqual({ text: "No estimate yet", title: "Estimates start once MADP has finished 10 measured builds; 9 so far." });
    expect(noEstimateYet(null)).toBeNull();
    expect(noEstimateYet(fewFixes)).toBeNull();
    // too few builds with a recorded cost: the time, but no cost
    const noCost = calibrate(onLine(30, { kind: "feature", ...FEATURE, cost: null }));
    expect(estimateBuild(noCost, ["story"])!.costUsd).toBeNull();
    expect(estimateBuild(null, ["story"])).toBeNull();
    expect(estimateBuild(fewFixes, [])).toBeNull();
  });
});

describe("an estimate", () => {
  const cal = fullCalibration();

  it("of a build is its per-build time plus what each of its tickets adds, so its tickets add up to it", () => {
    const types = ["story", "story", "task", "story", "story", "task", "story", "story"];
    const b = estimateBuild(cal, types)!;
    const line = cal.feature.time!;
    expect(b.kind).toBe("feature");
    expect(b.minutes.value).toBeCloseTo(line.base + 8 * line.perTicket, 9);
    expect(b.minutes.low).toBeCloseTo(b.minutes.value * line.low, 9);
    expect(b.minutes.high).toBeCloseTo(b.minutes.value * line.high, 9);
    const tickets = types.map((x) => estimateTicket(cal, x)!.minutes.value).reduce((a, x) => a + x, 0);
    expect(b.baseMinutes + tickets).toBeCloseTo(b.minutes.value, 9);
    expect(b.costUsd!.value).toBeCloseTo(cal.feature.cost!.base + 8 * cal.feature.cost!.perTicket, 9);
    expect(b.beyond).toBe(false);
    // a fix ticket in a milestone build adds its own kind's time to the feature build
    const mixed = estimateBuild(cal, ["story", "fix"])!;
    expect(mixed.kind).toBe("feature");
    expect(mixed.minutes.value).toBeCloseTo(line.base + line.perTicket + cal.fix.time!.perTicket, 9);
    // only fix tickets: a fix build
    expect(estimateBuild(cal, ["fix"])!.minutes.value).toBeCloseTo(cal.fix.time!.base + cal.fix.time!.perTicket, 9);
    // more tickets than any measured build had
    expect(estimateBuild(cal, Array.from({ length: 13 }, () => "story"))!.beyond).toBe(true);
  });

  it("is what the planner stores: a ticket's minutes as a fraction of an hour, the plan's builds in hours", () => {
    const per = cal.feature.time!.perTicket;
    expect(ticketEstimateHours(cal, "story")).toBe(Math.round((per / 60) * 1e4) / 1e4);
    expect(ticketEstimateHours(cal, "task")).toBe(ticketEstimateHours(cal, "story"));
    const plan = planEstimateHours(cal, [["story", "story", "task"], [], ["story"]])!;
    const want = (estimateBuild(cal, ["story", "story", "task"])!.minutes.value + estimateBuild(cal, ["story"])!.minutes.value) / 60;
    expect(plan).toBeCloseTo(want, 3);
    expect(planEstimateHours(cal, [[], []])).toBeUndefined();
  });

  it("travels as JSON and nothing else reads as a calibration", () => {
    expect(parseCalibration(JSON.parse(JSON.stringify(cal)))).toEqual(cal);
    expect(parseCalibration(null)).toBeNull();
    expect(parseCalibration({ v: 2, builds: 1 })).toBeNull();
    const bad = parseCalibration({ ...cal, feature: { builds: 3, time: { base: -1, perTicket: 1, low: 0.8, high: 1.2, builds: 3, maxTickets: 4 }, cost: "x" } })!;
    expect(bad.feature).toEqual({ builds: 3, time: null, cost: null });
  });
});

describe("the words", () => {
  const cal = fullCalibration();
  afterEach(() => resetI18nForTests());

  it("in English", () => {
    expect(minutesText(0.3)).toBe("20 s");
    expect(minutesText(0.76)).toBe("45 s");
    expect(minutesText(0.995)).toBe("1 min");
    expect(minutesText(19.2)).toBe("19 min");
    expect(minutesText(65)).toBe("1 h 5 min");
    expect(minutesText(120)).toBe("2 h");
    expect(minuteRangeText({ value: 19, low: 15.8, high: 23.4 })).toBe("16–23 min");
    expect(minuteRangeText({ value: 0.76, low: 0.62, high: 0.93 })).toBe("35–55 s");
    expect(minuteRangeText({ value: 0.76, low: 0.75, high: 0.77 })).toBeNull();
    expect(minuteRangeText({ value: 0.9, low: 0.5, high: 2.1 })).toBe("30 s – 2 min");
    expect(minuteRangeText({ value: 60, low: 50, high: 70 })).toBe("50 min – 1 h 10 min");
    expect(estimateTimeText({ value: 19, low: 15.8, high: 23.4 })).toBe("about 19 min (16–23 min)");
    expect(estimateTimeText({ value: 0.76, low: 0.75, high: 0.77 })).toBe("about 45 s");
    expect(estimateCostText({ value: 5.87, low: 5.1, high: 7 })).toBe("about USD 6");
    expect(usdText(0.55)).toBe("USD 0.55");
    const ticket = estimateTicket(cal, "story")!;
    expect(ticketEstimateText(ticket)).toBe("≈ 45 s");
    expect(ticketEstimateChip(ticket)).toBe("≈ 45 s build time");
    expect(ticketEstimateTitle(ticket)).toMatch(/^This ticket adds about 45 s to its build's time and about USD 0\.\d\d to its cost\. Every build also takes about 13 min to plan, check and deploy\. Measured from 130 builds MADP finished\.$/);
    const title = buildEstimateTitle(estimateBuild(cal, ["story", "story"])!);
    expect(title).toContain("Measured from 130 builds MADP finished: about 13 min per build to plan, check and deploy, and about 2 min for its 2 tickets.");
    expect(title).toContain("Its agents work side by side, so it is not the sum of their own times.");
    expect(title).toContain("6 in 10 measured builds ended within the range.");
    expect(title).toMatch(/Cost: about USD 3 \(USD \d–\d\), measured from the same builds\./);
    expect(minutesInWords(0.2)).toBe("10 seconds");
    expect(minutesInWords(0.76)).toBe("45 seconds");
    expect(minutesInWords(1)).toBe("1 minute");
    expect(minutesInWords(19.4)).toBe("19 minutes");
    expect(minutesInWords(61)).toBe("1 hour 1 minute");
  });

  it("in Swiss German", () => {
    setCulture("de-CH");
    expect(minutesText(0.3)).toBe("20 Sek.");
    expect(minutesText(19.2)).toBe("19 Min.");
    expect(minutesText(65)).toBe("1 Std. 5 Min.");
    expect(estimateTimeText({ value: 19, low: 15.8, high: 23.4 })).toBe("rund 19 Min. (16–23 Min.)");
    expect(estimateCostText({ value: 5.87, low: 5.1, high: 7 })).toBe("rund USD 6");
    const ticket = estimateTicket(cal, "story")!;
    expect(ticketEstimateText(ticket)).toBe("≈ 45 Sek.");
    expect(ticketEstimateChip(ticket)).toBe("≈ 45 Sek. Build-Zeit");
    expect(ticketEstimateTitle(ticket)).toContain("Gemessen an 130 Builds, die MADP abgeschlossen hat.");
    const title = buildEstimateTitle(estimateBuild(cal, ["story"])!);
    expect(title).toContain("rund 13 Min. pro Build für Planung, Prüfung und Bereitstellung und rund 45 Sek. für sein Ticket.");
    expect(title).toContain("6 von 10 gemessenen Builds endeten innerhalb dieser Spanne.");
    expect(noEstimateYet(calibrate([]))).toEqual({ text: "Noch keine Schätzung", title: "Schätzungen gibt es, sobald MADP 10 gemessene Builds abgeschlossen hat; bisher 0." });
  });
});

describe("the screens", () => {
  const cal = fullCalibration();
  const ticket = (n: number, type: DeliveryTicket["type"] = "story"): DeliveryTicket => ({
    id: `t${n}`, number: n, title: `Ticket ${n}`, type, featureRef: "", agent: "dev", column: "planned", isDone: false, doneAt: null,
    milestoneId: "m1", sortOrder: n, description: "", acceptance: ["It works"], planRef: `r1.${n}`, source: "plan",
    // the old person-hour guess on the row: never shown again
    estimateHours: 6, dependsOn: [],
  });
  const job = { id: "j1", kind: "build.run", status: "running", inputJson: "{}", createdAt: iso(T0), message: "Building." } as unknown as EngineJob;
  const tickets = Array.from({ length: 8 }, (_, i) => ticket(i + 1, i % 4 === 3 ? "task" : "story"));
  const focus: BuildFocus = { job, milestone: null, change: null, tickets, events: [], previewJobs: [], planning: false, live: true };
  const within = (value: EstimateCalibration | null, node: ReactNode) => renderToStaticMarkup(h(EstimatesValue, { value }, node)).replace(/<!-- -->/g, "");
  const studio = (value: EstimateCalibration | null) => within(value, h(StudioView, { stage: null, focus, window: null, stages: [], gates: [], feed: [], when: () => "" }));

  it("the Studio shows the build's real estimate and cost, and its basis on hover", () => {
    const html = studio(cal);
    const e = estimateBuild(cal, tickets.map((t) => t.type))!;
    expect(html).toContain(`estimated ${estimateTimeText(e.minutes)}`);
    expect(html).toContain(estimateCostText(e.costUsd!));
    expect(html).toContain("Measured from 130 builds MADP finished");
    expect(html).not.toContain("of work planned");
    expect(html).not.toContain("48 h");
  });

  it("the Studio says plainly when there are too few measured builds, and shows nothing while it does not know", () => {
    const thin = studio(calibrate(onLine(3, { kind: "feature", ...FEATURE })));
    expect(thin).toContain("No estimate yet");
    expect(thin).toContain("Estimates start once MADP has finished 10 measured builds; 3 so far.");
    expect(thin).not.toContain("estimated ");
    const unknown = studio(null);
    expect(unknown).not.toContain("No estimate yet");
    expect(unknown).not.toContain("estimated ");
    expect(unknown).not.toContain("48 h");
  });

  it("the Timeline shows the same estimate beside the build time", () => {
    const win: BuildWindow = { start: T0, end: T0 + 60 * 60_000, head: T0 + 12 * 60_000, live: true };
    const stages = STAGES.map((s) => ({ id: s.id, status: s.id === "01" ? "done" as const : "planned" as const }));
    const html = within(cal, h(TimelineView, { focus, window: win, stages, ticketCode: (t: DeliveryTicket) => `T-${t.number}`, columnName: (c: string) => c }));
    const e = estimateBuild(cal, tickets.map((t) => t.type))!;
    expect(html).toContain(`estimated ${estimateTimeText(e.minutes)}`);
    expect(html).toContain(`Build time 12 min, estimated ${estimateTimeText(e.minutes)}`);
    expect(html).not.toContain("of work planned");
  });

  it("a ticket card shows what the ticket adds, never its stored hours", () => {
    const card = (value: EstimateCalibration | null, type: DeliveryTicket["type"]) => within(value, h(BlocksTicketCard, { ticket: ticket(1, type), feature: "Checkout", onOpen: () => undefined }));
    expect(card(cal, "story")).toContain("≈ 45 s");
    expect(card(cal, "story")).toContain("This ticket adds about 45 s to its build");
    expect(card(cal, "fix")).toContain("≈ 40 s");
    for (const html of [card(null, "story"), card(calibrate([]), "story")]) {
      expect(html).not.toContain("≈");
      expect(html).not.toContain("6 h");
    }
  });
});

describe("the server's calibration", () => {
  /** `n` measured builds (every 7th one in the fix lane), one older failed build and one run after a deploy. */
  function seedBuilds(gw: MemoryGateway, n: number): void {
    gw.seed("ChangeRequest", { ItemId: "cr-fix", WorkspaceId: "w1", ProjectId: "p1", Number: 1, Lane: "fix", Title: "Fix", Status: "released-dev", RequestKey: "cr-fix" });
    gw.seed("ChangeRequest", { ItemId: "cr-add", WorkspaceId: "w1", ProjectId: "p1", Number: 2, Lane: "add", Title: "Add", Status: "released-dev", RequestKey: "cr-add" });
    for (let i = 0; i < n; i += 1) {
      const fix = i % 7 === 0;
      gw.seed("EngineJob", { ...jobRow({ minutes: fix ? 6 + (i % 3) : 13 + (i % 12) * 0.75, tickets: 1 + (i % 12), at: i, cr: fix ? "cr-fix" : "cr-add" }), WorkspaceId: "w1", ProjectId: "p1", ActiveKey: `a${i}`, RequestKey: `k${i}` });
    }
    gw.seed("EngineJob", { ...jobRow({ minutes: 10, tickets: 3, at: -5, status: "failed" }), WorkspaceId: "w1", ProjectId: "p1", ActiveKey: "f", RequestKey: "f" });
    gw.seed("EngineJob", { ...jobRow({ minutes: 2, tickets: 3, at: n + 1, input: { afterDeploy: true } }), WorkspaceId: "w1", ProjectId: "p1", ActiveKey: "ad", RequestKey: "ad" });
  }
  beforeEach(() => engineEstimates.clear());

  it("reads the newest finished builds page by page, with their change requests' lanes", async () => {
    const gw = memoryGateway();
    seedBuilds(gw, 230);
    const all = await readMeasuredBuilds(gw);
    expect(all).toHaveLength(230);
    expect(all.filter((b) => b.kind === "fix")).toHaveLength(33);
    // only the newest window: the oldest finished builds are left out
    const newest = await readMeasuredBuilds(gw, 150);
    // the run after the deploy is among the newest 150 rows but is no build
    expect(newest).toHaveLength(149);
    expect(newest.map((b) => b.finishedAt).sort()[0]).toBe(iso(T0 + 81 * 60_000));
  });

  it("is kept 10 minutes, read once at a time, and a failed read is not kept", async () => {
    let clock = 0;
    let reads = 0;
    let fail = false;
    const source = createEstimateSource({
      now: () => clock,
      read: async () => {
        reads += 1;
        if (fail) throw new Error("gateway down");
        return onLine(12, { kind: "feature", ...FEATURE });
      },
    });
    const gw = memoryGateway();
    const [a, b] = await Promise.all([source.calibration(gw), source.calibration(gw)]);
    expect(reads).toBe(1);
    expect(a).toEqual(b);
    a.feature.time!.base = 999;
    clock = 9 * 60_000;
    expect((await source.calibration(gw)).feature.time!.base).not.toBe(999);
    expect(reads).toBe(1);
    clock = 10 * 60_000 + 1;
    fail = true;
    await expect(source.calibration(gw)).rejects.toThrow("gateway down");
    fail = false;
    await source.calibration(gw);
    expect(reads).toBe(3);
  });

  it("engine.estimates answers it to any signed-in person, as a view", async () => {
    expect(await listRegisteredOps("project")).toContain("engine.estimates");
    expect(engineEstimatesOp.kind).toBe("view");
    expect(opKind("project", "engine.estimates")).toBe("read");
    const gateway = memoryGateway();
    seedBuilds(gateway, 40);
    const r = await runOp("project", [engineEstimatesOp], { ctx: fakeCtx({ userId: "u1", email: "u1@example.org" }), gateway, request: { op: "engine.estimates" } });
    expect(r.status).toBe(200);
    const cal = parseCalibration(r.body.data)!;
    expect(cal.builds).toBe(40);
    expect(cal.feature.time).not.toBeNull();
    // figures only: no ids of builds, change requests, projects or workspaces
    for (const id of ["cr-fix", "cr-add", "p1", "w1", "t-1-0"]) expect(JSON.stringify(r.body.data)).not.toContain(`"${id}"`);
    // the first ask read the builds and their change requests; a second ask within 10 minutes reads nothing
    const jobReads = () => gateway.calls.filter((c) => c.schema === "EngineJob" || c.schema === "ChangeRequest").length;
    const first = jobReads();
    expect(first).toBeGreaterThan(0);
    await runOp("project", [engineEstimatesOp], { ctx: fakeCtx({ userId: "u1", email: "u1@example.org" }), gateway, request: { op: "engine.estimates" } });
    expect(jobReads()).toBe(first);
  });
});
