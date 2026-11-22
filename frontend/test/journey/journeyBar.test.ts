import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_NAV_VAR, ProjectNav, isStuck, progressOfNow, progressText, projectNavOffset } from "../../src/components/project/ProjectNav";
import { analysisParts, blocksProjectSteps, hasAside, journeyOf, navStepFromPath, phaseGuide, stepGuide, stepLabel, viewFromPath, type NavStepId } from "../../src/components/project/projectSteps";
import { STEP_ROLE } from "../../src/domain/projectNow";
import { SHOWN_STEPS, STEP_LABEL } from "../../src/domain/journey";
import { publishedAfter, type PhaseProgress } from "../../src/components/project/phaseProgress";

const project = vi.hoisted(() => ({ step: "sanitization", type: "greenfield" }));
vi.mock("../../src/blocks/projects/reads", () => ({ useProject: () => ({ data: project }) }));
vi.mock("../../src/components/workspace/ProjectTeamBar", () => ({ ProjectTeamBar: () => "TEAM-BAR" }));
// a server render reads a zustand store's initial state, so the bar is handed the published progress directly
const published = vi.hoisted(() => ({ progress: null as PhaseProgress | null }));
vi.mock("../../src/components/project/phaseProgress", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/components/project/phaseProgress")>()),
  usePhaseProgressStore: <T,>(select: (s: { progress: PhaseProgress | null }) => T) => select({ progress: published.progress }),
}));

const ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => { vi.restoreAllMocks(); project.step = "sanitization"; project.type = "greenfield"; published.progress = null; });

describe("plain step names", () => {
  it("shows four steps (owner 08.11.2026); the stored steps and their names stay", () => {
    expect(SHOWN_STEPS.map((s) => STEP_LABEL[s])).toEqual(["Project setup", "Project understanding", "Understanding your project", "Goals & requirements", "Scope & success", "Build", "Release"]);
    const j = journeyOf({ step: "business", viewing: null });
    expect(j.items.map((s) => s.label)).toEqual(["Project Setup", "Business Analysis", "Software Engineering", "Release"]);
    expect(j.items.map((s) => s.slug)).toEqual(["business", "analysis", "build", "delivered"]);
    expect(j.total).toBe(4);
  });
  it("an existing product names its analysis parts its own way", () => {
    expect(analysisParts({ step: "business", type: "brownfield" }).slice(1, 3).map((s) => s.label)).toEqual(["Understanding your product", "Goals for the change"]);
  });
  it("short labels between md and 1280 px only", () => {
    const req = { id: "requirements" as const, label: STEP_LABEL.requirements };
    expect([768, 1279].map((w) => stepLabel(req, w))).toEqual(["Goals", "Goals"]);
    expect([767, 1280].map((w) => stepLabel(req, w))).toEqual(["Goals & requirements", "Goals & requirements"]);
  });
});

describe("journeyOf", () => {
  it("marks done / now / next / locked from the project's step, with the reasons of the locked ones", () => {
    const j = journeyOf({ step: "requirements", viewing: "requirements" });
    expect(j.at).toBe(2);
    expect(j.now?.id).toBe("analysis");
    expect(j.viewing?.id).toBe("analysis");
    expect(j.items.map((s) => s.status)).toEqual(["done", "now", "next", "locked"]);
    expect(j.items.map((s) => s.open)).toEqual([true, true, false, false]);
    expect(j.items.map((s) => s.reason ?? null)).toEqual([null, null, "Lock the scope first", "Finish the build first"]);
  });
  it("shows the stored stage board as the Build step", () => {
    const j = journeyOf({ step: "board", viewing: "board" });
    expect(j.at).toBe(3);
    expect(j.now?.label).toBe("Software Engineering");
    expect(j.viewing?.id).toBe("engineering");
  });
  it("keeps where the project stands when an earlier step is viewed", () => {
    const j = journeyOf({ step: "scope", viewing: "business" });
    expect(j.now?.id).toBe("analysis");
    expect(j.viewing?.id).toBe("setup");
    expect(j.viewing?.status).toBe("done");
  });
  it("names the reason after sanitization by project type", () => {
    expect(analysisParts({ step: "sanitization" })[2].reason).toBe("Finish understanding your project first");
    expect(analysisParts({ step: "sanitization", type: "brownfield" })[2].reason).toBe("Finish understanding your product first");
    expect(analysisParts({ step: "sanitization" }).map((p) => p.status)).toEqual(["done", "now", "next", "locked"]);
    expect(analysisParts({ step: "build" }).every((p) => p.status === "done" && p.open)).toBe(true);
  });
  it("is neutral while the project loads: no step, no reasons, only the viewed page open", () => {
    const j = journeyOf({ step: null, viewing: "scope" });
    expect(j.at).toBeNull();
    expect(j.now).toBeNull();
    expect(j.items.filter((s) => s.open).map((s) => s.id)).toEqual(["analysis"]);
    expect(j.items.some((s) => s.reason)).toBe(false);
  });
  it("says who works on each step: business analyst (Project Setup and Business Analysis), build team", () => {
    expect(SHOWN_STEPS.map((s) => stepGuide(s).who)).toEqual(["Business analyst", "Business analyst", "Business analyst", "Business analyst", "Business analyst", "Build team", "Build team"]);
    for (const type of ["greenfield", "brownfield"] as const) for (const s of SHOWN_STEPS) expect(stepGuide(s, type).what).toMatch(/^[A-Z].{20,140}\.$/);
  });
  it("names the business analyst on Project Setup in the step list and on the dashboard, for every kind of project", () => {
    for (const type of ["greenfield", "brownfield", "greyfield"] as const) expect(phaseGuide("setup", type).who).toBe("Business analyst");
    expect(STEP_ROLE.business).toEqual({ who: "Business analyst", short: "Business analyst" });
  });
});

describe("blocksProjectSteps", () => {
  it("keeps one current step (the viewed page) and the old reasons", () => {
    const list = blocksProjectSteps({ step: "scope", viewing: "scope" }).filter((s) => s.n !== null);
    expect(list.map((s) => s.state)).toEqual(["done", "done", "done", "done", "current", "disabled", "disabled"]);
    expect(list[5].reason).toBe("Lock the scope first");
  });
});

describe("navStepFromPath", () => {
  it("maps every project slug", () => {
    const m: Record<string, NavStepId> = {
      business: "business", understanding: "understanding", sanitization: "sanitization", brief: "business", requirements: "requirements", objective: "requirements",
      scope: "scope", board: "build", build: "build", delivered: "release", wiki: "wiki",
    };
    for (const [slug, id] of Object.entries(m)) expect(navStepFromPath(`/p/x/${slug}`)).toBe(id);
    expect(navStepFromPath("/home")).toBeNull();
    expect(navStepFromPath("/p/x")).toBeNull();
  });
  it("hasAside is true for the four front steps", () => {
    expect((["business", "sanitization", "requirements", "scope", "build", "wiki"] as const).map(hasAside)).toEqual([true, true, true, true, false, false]);
  });
});

describe("ProjectNav (the journey bar)", () => {
  const render = (path: string) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const html = renderToString(createElement(MemoryRouter, { initialEntries: [path] }, createElement(ProjectNav, { projectId: ID })));
    expect(errors.mock.calls.filter((c) => !String(c[0]).includes("useLayoutEffect"))).toEqual([]);
    return html;
  };
  // one step's segment (its <li>), found by the step's label
  const segment = (html: string, label: string) => {
    const seg = html.slice(html.indexOf('aria-label="Project steps"'));
    return seg.slice(0, seg.indexOf("</ol>")).split("<li").slice(1).find((li) => li.includes(`>${label}<`)) ?? "";
  };
  it("renders one slim row: the step, Step N of 4, the progress, All steps and the Wiki", () => {
    const html = render(`/p/${ID}/analysis`);
    expect(html).toContain('aria-label="Project journey"');
    expect(html).toContain("Business Analysis");
    expect(html).toContain("· Step 2 of 4");
    // the compact bar (phones) and the shimmer of the current segment
    expect(html.match(/role="progressbar"/g)).toHaveLength(2);
    expect(html).toContain('aria-valuetext="Step 2 of 4: Business Analysis"');
    expect(html).toMatch(/aria-haspopup="dialog"[^>]*aria-expanded="false"/);
    expect(html).toContain("All steps");
    expect(html).toContain(`href="/p/${ID}/wiki"`);
    expect(html).not.toContain("Not assigned yet");
    // the list of steps is drawn only once "All steps" is opened
    expect(html).not.toContain("Your project&#x27;s journey");
  });
  it("draws the four steps as segments: done and current open, later ones locked with the reason", () => {
    project.step = "requirements";
    const html = render(`/p/${ID}/analysis`);
    const seg = html.slice(html.indexOf('aria-label="Project steps"'));
    expect(seg.match(/data-seg/g)).toHaveLength(4);
    for (const slug of ["business", "analysis"]) expect(seg).toContain(`href="/p/${ID}/${slug}"`);
    for (const slug of ["build", "delivered"]) expect(seg).not.toContain(`href="/p/${ID}/${slug}"`);
    expect(seg.match(/aria-disabled="true"/g)).toHaveLength(2);
    expect(seg).toContain('title="Lock the scope first"');
    expect(seg).toContain('title="Finish the build first"');
    expect(seg.match(/aria-current="page"/g)).toHaveLength(1);
    expect(seg).toContain("Business Analysis");
  });
  it("links back to where the project stands when an earlier step is viewed", () => {
    project.step = "scope";
    const html = render(`/p/${ID}/business`);
    expect(html).toContain("· Step 2 of 4");
    expect(html).toContain(`href="/p/${ID}/analysis"`);
  });
  it("looks the same on every step page: no Viewing chip, only the viewed segment's own highlight differs (owner 09.11.2026)", () => {
    project.step = "release";
    published.progress = null;
    const pages = ["business", "analysis", "build", "delivered"];
    // the bar without the segments: the phone row before them, All steps, Wiki and Produced after them
    const parts = pages.map((page) => {
      const html = render(`/p/${ID}/${page}`);
      expect(html).not.toContain("Viewing");
      const start = html.indexOf('aria-label="Project steps"');
      const end = html.indexOf("</ol>", start);
      return { before: html.slice(0, start), after: html.slice(end), segments: html.slice(start, end) };
    });
    for (const p of parts) {
      expect(p.before).toBe(parts[0].before);
      expect(p.after).toBe(parts[0].after);
      // the phone row always names the current step, as a link to it
      expect(p.before).toContain(`href="/p/${ID}/delivered"`);
      expect(p.segments.match(/data-seg/g)).toHaveLength(4);
      expect(p.segments.match(/aria-current="page"/g)).toHaveLength(1);
    }
    // the viewed step is shown only by the stepper's own highlight: without it the segments are identical
    const plain = (seg: string) => seg.replace(/ aria-current="page"/g, "").replace(/ bg-surface2\/60/g, "").replace(/font-semibold text-ink/g, "font-medium text-ink2");
    for (const p of parts) expect(plain(p.segments)).toBe(plain(parts[0].segments));
  });
  it("marks the Wiki as the page when it is viewed", () => {
    expect(render(`/p/${ID}/wiki`)).toMatch(/<a aria-current="page"[^>]*href="\/p\/[^"]+\/wiki"/);
    expect(render(`/p/${ID}/sanitization`)).not.toMatch(/<a aria-current="page"[^>]*\/wiki"/);
  });
  it("renders nothing for an id that is not a Blocks project", () => {
    expect(renderToString(createElement(MemoryRouter, null, createElement(ProjectNav, { projectId: "x" })))).toBe("");
  });
  it("treats the old /brief path as Project setup", () => {
    project.step = "business";
    const html = render(`/p/${ID}/brief`);
    expect(html).toContain("· Step 1 of 4");
    expect(html).toContain('aria-valuetext="Step 1 of 4: Project Setup"');
  });
  it("stays in view: sticks right below the shell's top bar, above the page, below the top bar's menus and dialogs", () => {
    const html = render(`/p/${ID}/analysis`);
    // one band around the journey card, from the first tag
    expect(html).toMatch(/^<div class="sticky top-\[var\(--topbar-h,0px\)\] z-20 [^"]*"><nav aria-label="Project journey"/);
    expect(html.match(/class="sticky /g)).toHaveLength(1);
    // at the top of the page it only sits there: no backdrop until the page scrolls under it
    expect(html).not.toContain("data-stuck");
    expect(html).not.toContain("bg-canvas/85");
  });
  it("has no Assign card: people are managed in the workspace, the stepper takes the full width", () => {
    const html = render(`/p/${ID}/analysis`);
    expect(html).not.toContain("TEAM-BAR");
    expect(html).not.toMatch(/grid-cols-\[minmax\(0,1fr\)_(auto|340px)\]/);
  });
  it("shows the current step's published progress on its segment: the fill, the percentage and who it waits on", () => {
    project.step = "requirements";
    published.progress = { projectId: ID, phase: "analysis", done: 2, total: 9, needsYou: 2 };
    const html = render(`/p/${ID}/analysis`);
    const seg = html.slice(html.indexOf('aria-label="Project steps"'));
    // the segment's bar is filled 2 of 9 instead of the in-progress shimmer
    expect(seg).toContain('aria-label="Business Analysis progress"');
    expect(seg).toMatch(/aria-valuenow="22"[^>]*aria-valuetext="22% done"/);
    expect(seg).not.toContain("Business Analysis in progress");
    expect(seg).toContain("22%<span class=\"sr-only\"> done</span>");
    expect(seg).toContain('title="2 need you"');
    // in the accent, with the shimmer: the current step's style, not a done one's
    const ba = segment(html, "Business Analysis");
    expect(ba).toContain("shimmer-progress-sweep");
    expect(ba).not.toContain("bg-success");
    expect(ba).not.toContain("lucide-check");
    expect(ba).not.toContain("Ready");
    // the phone row
    expect(html).toContain("· Step 2 of 4 · 22%");
  });
  it("never shows a percentage on a done step, even when its page published progress (owner 08.11.2026: 100% in blue at Release)", () => {
    project.step = "release";
    for (const done of [9, 5]) {
      published.progress = { projectId: ID, phase: "analysis", done, total: 9, needsYou: 1 };
      for (const page of ["analysis", "delivered"]) {
        const html = render(`/p/${ID}/${page}`);
        const seg = html.slice(html.indexOf('aria-label="Project steps"'));
        // every earlier step looks the same: a green bar and a check, no percentage, no accent, nobody waited on
        for (const label of ["Project Setup", "Business Analysis", "Software Engineering"]) {
          const li = segment(html, label);
          expect(li).toContain('class="block h-1.5 w-full rounded-full bg-success"');
          expect(li).toContain("lucide-check");
          expect(li).not.toContain("shimmer-progress");
          expect(li).not.toContain('role="progressbar"');
          expect(li).not.toMatch(/\d+%/);
          expect(li).not.toContain("Ready");
          expect(li).not.toContain("need you");
        }
        // the current step keeps the accent shimmer (it publishes nothing here)
        const release = segment(html, "Release");
        expect(release).toContain("Release in progress");
        expect(release).toContain("shimmer-progress-sweep");
        expect(release).not.toContain("bg-success");
        expect(seg).not.toContain("Business Analysis progress");
        // the phone row says where the project is, without the done step's progress
        expect(html).toContain("· Step 4 of 4</span>");
        expect(html).not.toMatch(/\d+%</);
      }
    }
  });
  it("keeps a viewed done step in its done style: viewing does not turn it blue", () => {
    project.step = "requirements";
    published.progress = { projectId: ID, phase: "setup", done: 3, total: 4, needsYou: 0 };
    const html = render(`/p/${ID}/business`);
    const setup = segment(html, "Project Setup");
    expect(setup).toContain('aria-current="page"');
    expect(setup).toContain("bg-success");
    expect(setup).toContain("lucide-check");
    expect(setup).not.toContain("shimmer-progress");
    expect(setup).not.toContain("75%");
    // the current step still shimmers
    expect(segment(html, "Business Analysis")).toContain("Business Analysis in progress");
  });
  it("says Ready (a green bar and a check, ready to lock) instead of 100% once every part of the current step is ready", () => {
    project.step = "scope";
    published.progress = { projectId: ID, phase: "analysis", done: 9, total: 9, needsYou: 0 };
    const html = render(`/p/${ID}/analysis`);
    const ba = segment(html, "Business Analysis");
    expect(ba).toContain('aria-label="Business Analysis progress"');
    expect(ba).toMatch(/aria-valuenow="100"[^>]*aria-valuetext="Ready to lock"[^>]*class="block h-1.5 w-full rounded-full bg-success"/);
    expect(ba).toContain("lucide-check");
    expect(ba).toContain('Ready<span class="max-2xl:sr-only"> to lock</span>');
    expect(ba).not.toContain("shimmer-progress");
    expect(html).not.toContain("100%<");
    // the phone row
    expect(html).toContain("· Step 2 of 4 · Ready");
  });
  it("shows progress for the current step only, and never 100% before every part is ready", () => {
    const p = (phase: PhaseProgress["phase"], done = 2, total = 9): PhaseProgress => ({ projectId: ID, phase, done, total, needsYou: 0 });
    const atAnalysis = journeyOf({ step: "requirements", viewing: "business" });
    expect(progressOfNow(p("analysis"), atAnalysis)).toEqual(p("analysis"));
    expect(progressOfNow(p("setup"), atAnalysis)).toBeNull();
    expect(progressOfNow(p("engineering"), atAnalysis)).toBeNull();
    expect(progressOfNow(p("analysis"), journeyOf({ step: "release", viewing: "analysis" }))).toBeNull();
    expect(progressOfNow(p("analysis"), journeyOf({ step: null, viewing: "analysis" }))).toBeNull();
    expect(progressOfNow(null, atAnalysis)).toBeNull();
    expect([[2, 9], [199, 200], [0, 9], [0, 0], [9, 9], [10, 9]].map(([done, total]) => progressText({ done, total }))).toEqual(["22%", "99%", "0%", "0%", "Ready", "Ready"]);
  });
  it("keeps the published progress when its page closes or reloads, so the bar does not change between pages", () => {
    const p: PhaseProgress = { projectId: ID, phase: "analysis", done: 2, total: 9, needsYou: 1 };
    const later: PhaseProgress = { ...p, done: 3 };
    // the page is loading: what it last published stays
    expect(publishedAfter(p, undefined)).toBe(p);
    expect(publishedAfter(null, undefined)).toBeNull();
    // a new value replaces it; null means the page has no progress to show
    expect(publishedAfter(p, later)).toBe(later);
    expect(publishedAfter(p, null)).toBeNull();
    // the bar shows the kept progress on every page while that step is the current one
    project.step = "requirements";
    published.progress = p;
    for (const page of ["business", "analysis", "wiki", "produced"]) {
      const ba = segment(render(`/p/${ID}/${page}`), "Business Analysis");
      expect(ba).toMatch(/aria-valuenow="22"[^>]*aria-valuetext="22% done"/);
      expect(ba).toContain('title="1 needs you"');
    }
  });
  it("keeps the shimmer when no progress is published, or it is another project's", () => {
    project.step = "requirements";
    published.progress = { projectId: "22222222-2222-4222-8222-222222222222", phase: "analysis", done: 2, total: 9, needsYou: 0 };
    const html = render(`/p/${ID}/analysis`);
    expect(html).toContain("Business Analysis in progress");
    expect(html).not.toContain("22%");
    expect(html).not.toContain("need you");
  });
  it("publishes where the stuck bar ends as --project-nav-h (the top bar included) and knows when it is stuck", () => {
    expect(PROJECT_NAV_VAR).toBe("--project-nav-h");
    expect(projectNavOffset(88)).toBe("calc(var(--topbar-h, 0px) + 88px)");
    expect(projectNavOffset(87.6)).toBe("calc(var(--topbar-h, 0px) + 88px)");
    expect(isStuck(0, 92, 92)).toBe(false);
    expect(isStuck(40, 92, 92)).toBe(true);
    // something above the bar (a banner): not on its line yet
    expect(isStuck(10, 140, 92)).toBe(false);
  });
  it("knows the Business Analysis page from its address", () => {
    expect(viewFromPath(`/p/${ID}/analysis`)).toBe("analysis");
    expect(viewFromPath(`/p/${ID}/scope`)).toBe("scope");
    expect(viewFromPath("/home")).toBeNull();
  });
});

describe("the step guides of a live product (attached as it is, working through change requests)", () => {
  it("never speak of milestones, a locked scope or an analysis that never happened", () => {
    const j = journeyOf({ step: "release", viewing: "analysis", type: "brownfield", live: true });
    for (const item of j.items) {
      expect(item.what, item.id).not.toMatch(/milestone|locked|start the project analysis/i);
    }
    expect(j.items.find((i) => i.id === "engineering")?.what).toMatch(/change request/);
    // every other existing product keeps its own guide
    expect(journeyOf({ step: "release", viewing: "analysis", type: "brownfield" }).items.find((i) => i.id === "engineering")?.what).toMatch(/milestone by milestone/);
  });
});
