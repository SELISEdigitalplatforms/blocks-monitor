// The Projects page: grid or list (grid by default, remembered per browser, a refusing storage only forgets), where a
// project stands as "step n of 4", its newest release, which projects build right now, and the quick actions that fit
// where a project stands (Docs always; Tests and Watch the build from Software Engineering on; none while deleting).
import { describe, expect, it } from "vitest";
import {
  buildingProjects, DEFAULT_PROJECTS_VIEW, journeyAt, latestReleases, PROJECTS_VIEW_KEY, quickActions, readProjectsView, relativeTime,
  writeProjectsView,
} from "../../src/components/home/projects/projectCards";
import type { DashJob, DashProject, DashRelease } from "../../src/domain/dashboard";
import type { JourneyStep } from "../../src/domain/journey";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};
const refusing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

describe("the view toggle", () => {
  it("is the grid until a choice is remembered", () => {
    expect(DEFAULT_PROJECTS_VIEW).toBe("grid");
    expect(readProjectsView(memory())).toBe("grid");
    expect(readProjectsView(null)).toBe("grid");
  });

  it("remembers grid or list per browser", () => {
    const s = memory();
    writeProjectsView("list", s);
    expect(s.m.get(PROJECTS_VIEW_KEY)).toBe("list");
    expect(readProjectsView(s)).toBe("list");
    writeProjectsView("grid", s);
    expect(readProjectsView(s)).toBe("grid");
  });

  it("ignores an unknown stored value and a storage that refuses", () => {
    const s = memory();
    s.setItem(PROJECTS_VIEW_KEY, "table");
    expect(readProjectsView(s)).toBe("grid");
    expect(readProjectsView(refusing)).toBe("grid");
    expect(() => writeProjectsView("list", refusing)).not.toThrow();
  });
});

describe("the quick actions", () => {
  const ids = (step: JourneyStep, building = false, status = "active") => quickActions({ id: "p1", step, status }, building).map((a) => a.id);

  it("offers Docs at every step, Tests and Watch the build from Software Engineering on", () => {
    expect(ids("business")).toEqual(["docs"]);
    for (const s of ["understanding", "sanitization", "requirements", "scope"] as const) expect(ids(s)).toEqual(["docs"]);
    for (const s of ["board", "build", "release"] as const) expect(ids(s)).toEqual(["docs", "tests", "watch"]);
  });

  it("links Docs to what MADP produced, Tests to the Test stage of the build timeline, Watch the build to the Studio", () => {
    const by = Object.fromEntries(quickActions({ id: "p1", step: "build" }).map((a) => [a.id, a]));
    expect(by.docs).toMatchObject({ label: "Docs", to: "/p/p1/produced" });
    expect(by.tests).toMatchObject({ label: "Tests", to: "/p/p1/build?tab=timeline&stage=test" });
    expect(by.watch).toMatchObject({ label: "Watch the build", to: "/p/p1/build?tab=studio", highlight: false });
  });

  it("highlights Watch the build while a build runs", () => {
    const watch = quickActions({ id: "p1", step: "build" }, true).find((a) => a.id === "watch");
    expect(watch).toMatchObject({ highlight: true, title: "A build is running: watch it live" });
    expect(quickActions({ id: "p1", step: "build" }, true).filter((a) => a.highlight)).toHaveLength(1);
  });

  it("shows none for a project being deleted", () => {
    expect(ids("build", true, "deleting")).toEqual([]);
  });
});

describe("what the cards read", () => {
  it("names the step of four with its bar", () => {
    expect(journeyAt("business")).toEqual({ label: "Project Setup", n: 1, total: 4, pct: 25 });
    expect(journeyAt("scope")).toMatchObject({ label: "Business Analysis", n: 2, pct: 50 });
    expect(journeyAt("board")).toMatchObject({ label: "Software Engineering", n: 3 });
    expect(journeyAt("release")).toMatchObject({ label: "Release", n: 4, pct: 100 });
  });

  it("knows which projects build right now (build or change build, queued or running)", () => {
    const job = (projectId: string, kind: DashJob["kind"], status: DashJob["status"]) => ({ projectId, kind, status });
    const set = buildingProjects([
      job("a", "build.run", "running"), job("b", "change.build", "queued"), job("c", "build.run", "succeeded"),
      job("d", "requirements.draft", "running"),
    ]);
    expect([...set].sort()).toEqual(["a", "b"]);
  });

  it("takes the newest release on the furthest environment", () => {
    const project = (id: string): DashProject => ({
      id, name: id, clientName: "", stage: "release", step: "release", assigneeUserId: "", createdByUserId: "", updatedAt: "2026-11-07T10:00:00Z",
      handedOverAt: "", sanitizedAt: "", confirmedAt: "", lockedAt: "",
    });
    const rel = (projectId: string, env: DashRelease["env"], version: string, releasedAt: string, status = "released"): DashRelease => ({ projectId, env, version, status, releasedAt });
    const map = latestReleases([project("a"), project("b"), project("c")], [
      rel("a", "dev", "1.3.0", "2026-11-06T10:00:00Z"), rel("a", "production", "1.1.0", "2026-11-01T10:00:00Z"), rel("a", "production", "1.2.0", "2026-11-04T10:00:00Z"),
      rel("b", "dev", "0.2.0", "2026-11-05T10:00:00Z"),
      rel("c", "dev", "0.1.0", "2026-11-05T10:00:00Z", "failed"),
    ]);
    expect(map.get("a")).toMatchObject({ version: "1.2.0", env: "production", envLabel: "Production" });
    expect(map.get("b")).toMatchObject({ version: "0.2.0", env: "dev", envLabel: "Development" });
    expect(map.has("c")).toBe(false);
  });

  it("words the update time as before", () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    expect(relativeTime("2026-11-08T11:55:00Z", now)).toBe("5 min ago");
    expect(relativeTime("", now)).toBe("");
  });
});

describe("the grid and the list, rendered", async () => {
  const { createElement: h } = await import("react");
  const { renderToString } = await import("react-dom/server");
  const { MemoryRouter } = await import("react-router-dom");
  const { ProjectGrid, ProjectGridSkeleton } = await import("../../src/components/home/projects/ProjectGrid");
  const { ViewToggle } = await import("../../src/components/home/projects/ViewToggle");
  const { ProjectTable } = await import("../../src/components/home/ProjectsView");
  type Rec = import("../../src/blocks/projects").ProjectRecord;
  const rec = (id: string, name: string, step: JourneyStep, status = "active") =>
    ({ id, name, step, status, type: "greenfield", clientName: "Sero AG", clientRegion: "", assigneeUserId: "", lastUpdatedDate: "" }) as unknown as Rec;
  const items = [rec("a", "Asset Market", "requirements"), rec("b", "PrimaBook", "build"), rec("c", "Old one", "scope", "deleting")];
  const act = { onOpen() {}, onRename() {}, onDelete() {}, building: new Set(["b"]) };
  // without the "<!-- -->" React puts between adjacent text parts
  const render = (el: ReturnType<typeof h>) => renderToString(h(MemoryRouter, null, el)).replace(/<!-- -->/g, "");
  const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));

  it("draws one card per project: the name opens it, the quick actions fit its step, the ⋯ menu on every live one", () => {
    const html = render(h(ProjectGrid, { items, ...act }));
    expect(hrefs(html)).toEqual([
      "/p/a", "/p/a/produced",
      "/p/b", "/p/b/produced", "/p/b/build?tab=timeline&stage=test", "/p/b/build?tab=studio",
    ]);
    expect(html).toContain('aria-label="Actions for Asset Market"');
    expect(html).toContain('aria-label="Actions for PrimaBook"');
    expect(html).not.toContain('aria-label="Actions for Old one"');
    expect(html).toContain("Deleting…");
    expect(html).toContain("Step 2 of 4");
    expect(html).toContain("Watch the build · PrimaBook · build running");
  });

  it("keeps the list rows clean: no quick-action buttons (they sit in the ⋯ menu), the ⋯ menu on every live row", () => {
    const html = render(h(ProjectTable, { items, ...act }));
    expect(hrefs(html)).toEqual(["/p/a", "/p/b"]);
    expect(html).not.toContain("data-quick-action");
    expect(html).toContain('aria-label="Actions for Asset Market"');
    expect(html).toContain('aria-label="Actions for PrimaBook"');
    expect(html).not.toContain('aria-label="Actions for Old one"');
    expect(html).toContain("Step 3 of 4");
  });

  it("marks the chosen view and shows loading cards", () => {
    const html = render(h(ViewToggle, { value: "list", onChange() {} }));
    expect(html).toMatch(/role="radio" aria-checked="false"[^>]*>.*Grid/);
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>.*List/);
    expect(render(h(ProjectGridSkeleton, { count: 3 }))).toContain('aria-label="Loading your projects"');
  });
});
