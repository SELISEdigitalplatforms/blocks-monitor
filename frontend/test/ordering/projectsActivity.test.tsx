// The Projects page shows the time it sorts by: each project's last activity (its own update, or a newer job, release,
// change request or done task), so the order and the "Last activity" column always agree.
//   npx vitest run --config test/ordering/vitest.config.ts test/ordering/projectsActivity.test.tsx
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { projectActivityAt, projectsByActivity } from "@/domain/dashboard";
import { timeOf } from "@/lib/newest";
import { ProjectGrid } from "@/components/home/projects/ProjectGrid";
import type { ProjectRecord } from "@/blocks/projects";

const NOW = Date.now();
const ago = (h: number) => new Date(NOW - h * 3_600_000).toISOString();
const project = (id: string, name: string, lastUpdatedDate: string) => ({
  id, name, clientName: "", clientRegion: "", status: "active", step: "build", type: "greenfield", lastUpdatedDate, createdDate: ago(500),
}) as unknown as ProjectRecord;

// PrimaBook's own row changed 3 days ago; its newest release went out 1 hour ago
const projects = [project("asset", "Asset Market", ago(5)), project("prima", "PrimaBook", ago(72)), project("kairo", "Kairo", ago(30))];
const activity = new Map([["prima", Date.parse(ago(1))]]);

describe("the Projects page's last activity", () => {
  it("is the time the list is sorted by, so the times shown only ever go back in time down the list", () => {
    const sorted = projectsByActivity(projects, activity);
    expect(sorted.map((p) => p.name)).toEqual(["PrimaBook", "Asset Market", "Kairo"]);
    const shown = sorted.map((p) => timeOf(projectActivityAt(p, activity)));
    expect(shown).toEqual([...shown].sort((a, b) => b - a));
    expect(projectActivityAt(projects[1]!, activity)).toBe(Date.parse(ago(1)));
    expect(projectActivityAt(projects[0]!, activity)).toBe(ago(5));
  });

  it("the grid cards show it as the last activity: PrimaBook first, 1 h ago, not 3 d ago", () => {
    const items = projectsByActivity(projects, activity);
    const html = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(ProjectGrid, { items, activity, onOpen: () => {}, onRename: () => {}, onDelete: () => {} })));
    expect(html.indexOf("PrimaBook")).toBeLessThan(html.indexOf("Asset Market"));
    expect(html).toContain("Last activity 1 h ago");
    expect(html).not.toContain("Last activity 3 d ago");
    expect(html).toContain("Last activity 5 h ago");
  });
});
