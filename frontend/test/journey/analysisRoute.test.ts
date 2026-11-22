// /p/:id/analysis shows the Business Analysis design the owner approved (08.11.2026); ?view=sections keeps the former
// four steps as sections; /p/:id/analysis-next (the review address) redirects there with its query and anchor.
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { viewFromPath } from "../../src/components/project/projectSteps";

// a server render runs no effects: a redirect shows where it goes
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  Navigate: ({ to }: { to: string }) => `NAVIGATE:${to}`,
}));
vi.mock("../../src/pages/AnalysisNext", () => ({ BusinessAnalysis: ({ id }: { id: string }) => `APPROVED-PAGE:${id}` }));
vi.mock("../../src/blocks/projects/reads", () => ({ useProject: () => ({ data: { step: "sanitization", type: "greenfield" } }) }));

const { default: Analysis } = await import("../../src/pages/Analysis");
const { StepRedirect } = await import("../../src/components/project/StepRedirect");

const ID = "11111111-1111-4111-8111-111111111111";

const render = (path: string, routes: [string, ReactNode][]) =>
  renderToString(createElement(MemoryRouter, { initialEntries: [path] },
    createElement(Routes, null, ...routes.map(([p, element]) => createElement(Route, { key: p, path: p, element })))));
const analysisAt = (path: string) => render(path, [["/p/:id/analysis", createElement(Analysis)]]);

describe("the Business Analysis address", () => {
  it("shows the approved page", () => {
    expect(analysisAt(`/p/${ID}/analysis`)).toContain(`APPROVED-PAGE:${ID}`);
    expect(analysisAt(`/p/${ID}/analysis#sanitization`)).toContain(`APPROVED-PAGE:${ID}`);
  });
  it("keeps the former four steps as sections behind ?view=sections", () => {
    const html = analysisAt(`/p/${ID}/analysis?view=sections`);
    expect(html).not.toContain("APPROVED-PAGE");
    expect(html).toContain('aria-label="Parts of the business analysis"');
    for (const section of ["understanding", "sanitization", "requirements", "scope"]) expect(html).toContain(`id="${section}"`);
  });
  it("sends a project that is not a Blocks project to the projects list", () => {
    expect(analysisAt("/p/demo-project/analysis")).toContain("NAVIGATE:/projects");
  });
  it("/analysis-next redirects to /analysis keeping the query and the anchor", () => {
    const at = (path: string) => render(path, [["/p/:id/analysis-next", createElement(StepRedirect, { to: "analysis" })]]);
    expect(at(`/p/${ID}/analysis-next`)).toContain(`NAVIGATE:/p/${ID}/analysis`);
    expect(at(`/p/${ID}/analysis-next?view=sections#scope`)).toContain(`NAVIGATE:/p/${ID}/analysis?view=sections#scope`);
  });
  it("both addresses are the Business Analysis phase", () => {
    expect(viewFromPath(`/p/${ID}/analysis`)).toBe("analysis");
    expect(viewFromPath(`/p/${ID}/analysis-next`)).toBe("analysis");
  });
});
