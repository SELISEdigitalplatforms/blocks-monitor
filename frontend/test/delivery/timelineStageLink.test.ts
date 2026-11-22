// A link that opens the Build page's Timeline on one stage (/p/:id/build?tab=timeline&stage=test, the Projects page's
// Tests quick action): the URL helper stays backward compatible, ?stage names a track, picking or following drops it,
// and a selected Test track with nothing recorded says so calmly.
import { describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { renderToString } from "react-dom/server";
import type { EngineJob } from "@/blocks/engine/types";
import type { DeliveryTicket } from "@/blocks/delivery/types";
import { STAGES } from "@/data/pipeline";
import { buildTabPath, TIMELINE_STAGES } from "@/domain/journey";
import { linkedTimelineStage, searchWithoutStage, STAGE_EMPTY_NOTE, TIMELINE_STAGE_ID } from "@/components/build/buildTabs";
import type { BuildFocus, BuildWindow } from "@/components/build/model";
import { TimelineView } from "@/components/build/TimelineView";
import { quickActions } from "@/components/home/projects/projectCards";

const NOTE = "No test runs yet. Tests run during each build.";

describe("the Build page link", () => {
  it("is unchanged without a stage", () => {
    expect(buildTabPath("p1", "timeline")).toBe("/p/p1/build?tab=timeline");
    expect(buildTabPath("p1", "board", "t 1")).toBe("/p/p1/build?tab=board&ticket=t%201");
    expect(buildTabPath("p1", "timeline", null, null)).toBe("/p/p1/build?tab=timeline");
  });

  it("names a Timeline stage", () => {
    expect(buildTabPath("p1", "timeline", null, "test")).toBe("/p/p1/build?tab=timeline&stage=test");
    expect(buildTabPath("p1", "timeline", "t1", "review")).toBe("/p/p1/build?tab=timeline&ticket=t1&stage=review");
  });

  it("is what the Projects page's Tests quick action opens", () => {
    const tests = quickActions({ id: "p1", step: "build" }).find((a) => a.id === "tests");
    expect(tests?.to).toBe("/p/p1/build?tab=timeline&stage=test");
    const q = new URLSearchParams(tests!.to.split("?")[1]);
    expect(linkedTimelineStage(q.get("stage"))).toBe("04");
  });
});

describe("?stage on the Build page", () => {
  it("names one track each, in the tracks' order; Test is the tester's track", () => {
    expect(TIMELINE_STAGES.map((s) => TIMELINE_STAGE_ID[s])).toEqual(STAGES.map((s) => s.id));
    expect(linkedTimelineStage("test")).toBe("04");
    expect(STAGES.find((s) => s.id === "04")?.name).toBe("Test");
  });

  it("ignores none or an unknown name", () => {
    expect(linkedTimelineStage(null)).toBeNull();
    expect(linkedTimelineStage("")).toBeNull();
    expect(linkedTimelineStage("04")).toBeNull();
    expect(linkedTimelineStage("Test")).toBeNull();
  });

  it("is dropped once the person picks a stage, every other param kept", () => {
    const next = searchWithoutStage(new URLSearchParams("tab=timeline&stage=test&ticket=t1"));
    expect(next.toString()).toBe("tab=timeline&ticket=t1");
  });
});

describe("the Timeline opened on the Test stage", () => {
  const T0 = Date.parse("2026-11-05T09:00:00.000Z");
  const job = { id: "j1", kind: "build.run", status: "running", inputJson: "{}", createdAt: new Date(T0).toISOString() } as unknown as EngineJob;
  const focus = (o: Partial<BuildFocus> = {}): BuildFocus =>
    ({ job, milestone: null, change: null, tickets: [], events: [], previewJobs: [], planning: false, live: true, ...o });
  const win: BuildWindow = { start: T0, end: T0 + 60 * 60_000, head: T0 + 20 * 60_000, live: true };
  const stages = STAGES.map((s) => ({ id: s.id, status: s.id === "02" ? "active" as const : s.id === "01" ? "done" as const : "planned" as const }));
  const base = { stages, ticketCode: (t: DeliveryTicket) => `T-${t.number}`, columnName: (c: string) => c };
  const render = (props: Partial<Parameters<typeof TimelineView>[0]>) =>
    renderToString(h(TimelineView, { focus: focus(), window: win, ...base, ...props })).replace(/<!-- -->/g, "");

  it("selects the Test track over the live stage and says calmly that nothing ran yet", () => {
    expect(STAGE_EMPTY_NOTE["04"]).toBe(NOTE);
    const html = render({ linkedStage: "04" });
    expect(html).toContain(NOTE);
    expect(html).toMatch(/aria-pressed="true" aria-label="Test\b/);
    expect(html).not.toMatch(/aria-pressed="true" aria-label="Build\b/);
  });

  it("follows the live stage without a link, with no note", () => {
    const html = render({});
    expect(html).not.toContain(NOTE);
    expect(html).toMatch(/aria-pressed="true" aria-label="Build\b/);
  });

  it("drops the note once the Test track has a recorded stretch", () => {
    const t = { id: "t1", number: 1, title: "Login", column: "test", sortOrder: 0 } as unknown as DeliveryTicket;
    const move = (from: string | null, to: string, min: number) => ({
      id: `e${min}`, ticketId: "t1", kind: "move", fromColumn: from, toColumn: to, at: new Date(T0 + min * 60_000).toISOString(),
    });
    const html = renderToString(h(TimelineView, {
      focus: focus({ tickets: [t], events: [move(null, "dev", 1), move("dev", "test", 5)] as unknown as BuildFocus["events"] }),
      window: win, ...base, linkedStage: "04",
    }));
    expect(html).toMatch(/aria-pressed="true" aria-label="Test\b/);
    expect(html).toContain('aria-label="T-1 Login: Working');
    expect(html).not.toContain(NOTE);
  });

  it("before any build: the Test track marked, and the note under why the tracks are empty", () => {
    const html = render({ focus: focus({ job: null }), window: null, linkedStage: "04" });
    expect(html).toContain("No build has run yet");
    expect(html).toContain(NOTE);
    expect(html).toMatch(/aria-label="Test\b[^"]*" aria-current="true"/);
  });
});
