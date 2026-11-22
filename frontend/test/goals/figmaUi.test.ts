import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { automaticDesignDirection, designSource } from "../../src/domain/figmaMake";

const state = vi.hoisted(() => ({ brief: null as any, jobs: [] as any[] }));
const reqs = [{ id: "r1", key: "R-1", title: "Order food", detail: "Customers order food from a table", criteria: ["An order number is shown"] }];
vi.mock("@/blocks/requirements/hooks", () => ({
  useDesignBrief: () => ({ data: state.brief, refetch: vi.fn() }),
  useRequirements: () => ({ data: reqs, isLoading: false, isError: false }),
}));
vi.mock("@/blocks/requirements/designContext", () => ({ useDesignContext: () => ({
  data: { source: designSource(automaticDesignDirection(reqs.map((r) => ({ key: r.key, title: r.title, text: r.detail, criteria: r.criteria }))), reqs.map((r) => ({ key: r.key, title: r.title, text: r.detail, criteria: r.criteria }))) }, isLoading: false, isError: false,
}) }));
vi.mock("@/blocks/requirements/mutations", () => ({
  useGenerateDesign: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConfirmDesignBrief: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/blocks/engine/jobs", () => ({ useEngineJobs: () => ({ data: state.jobs, isLoading: false, isError: false, refetch: vi.fn() }) }));
vi.mock("@/components/requirements/messages", () => ({ requirementsErrorMessage: () => "Could not save" }));
vi.mock("@/blocks/requirements/designScreens", () => ({ useScreenImages: () => ({}), loadDesignScreens: () => new Promise(() => undefined) }));
import { MakeDesignPanel } from "../../src/components/design/MakeDesignPanel";
import { LookAndFeel } from "../../src/components/requirements/LookAndFeel";

beforeEach(() => { state.brief = null; state.jobs = []; });
describe("Figma-only Look & feel", () => {
  it("shows the product design workspace without billing or engine setup controls", () => {
    const html = renderToStaticMarkup(createElement(LookAndFeel, { projectId: "p1", editable: true, waiting: false, onChange: vi.fn() }));
    expect(html).toContain("Your interactive design will appear here");
    expect(html).not.toMatch(/credit|consent|MCP|owner engine|checkbox|From a sample|Describe it|Describe the look|textarea|radiogroup/i);
  });
  it("shows revision approval, a tracked change request and its history instead of direct design editing", () => {
    const requirements = reqs.map((r) => ({ key: r.key, title: r.title, text: r.detail, criteria: r.criteria }));
    state.brief = { id: "b1", mode: "figma", status: "draft", prototypeJson: JSON.stringify({
      provider: "figma-make", projectUrl: "https://www.figma.com/make/food-app/", previewUrl: null,
      revision: "rev-2", source: designSource(automaticDesignDirection(requirements), requirements), jobId: "j2", artifactFileId: "f2",
    }) };
    state.jobs = [{ id: "j2", status: "succeeded", inputJson: JSON.stringify({ designBriefId: "b1", source: designSource(automaticDesignDirection(requirements), requirements), requestType: "design-change", previousRevision: "rev-1", feedback: "Bigger order status", requirementKeys: ["R-1"] }) }];
    const html = renderToStaticMarkup(createElement(MakeDesignPanel, { projectId: "p1", editable: true }));
    expect(html).toContain("Approve this design revision");
    // the change request is a quiet option that opens its form (MakeDesignView tests cover the form itself)
    expect(html).toContain("Change design");
    expect(html).toContain("Bigger order status");
    expect(html).toContain("Preparing live preview");
    expect(html).toContain("interactive live preview is being prepared");
    expect(html).not.toContain("Ready for review");
    expect(html).not.toContain("Describe the look");
  });
  it("renders a published prototype directly without another load-preview button", () => {
    state.brief = { id: "b1", mode: "figma", status: "draft", prototypeJson: JSON.stringify({
      provider: "figma-make", projectUrl: "https://www.figma.com/make/food-app/", previewUrl: "https://food-app.figma.site/",
      revision: "rev-2", source: "ux-old", jobId: "j2", artifactFileId: "f2",
    }) };
    const html = renderToStaticMarkup(createElement(MakeDesignPanel, { projectId: "p1", editable: true }));
    expect(html).toContain('View designs');
    expect(html).not.toContain('<iframe');
    expect(html).not.toMatch(/Load interactive preview|credit|consent/i);
  });
  it("does not pass provider billing/setup failures to the user or spin forever", () => {
    const requirements = reqs.map((r) => ({ key: r.key, title: r.title, text: r.detail, criteria: r.criteria }));
    state.jobs = [{ id: "j2", status: "failed", message: "Set MF_ENGINE_FIGMA_CREDITS_APPROVED=1; Figma credits required", inputJson: JSON.stringify({ source: designSource(automaticDesignDirection(requirements), requirements) }) }];
    const html = renderToStaticMarkup(createElement(MakeDesignPanel, { projectId: "p1", editable: true }));
    expect(html).toContain("Design unavailable");
    expect(html).toContain("Retry design");
    expect(html).not.toMatch(/MF_ENGINE|credits|consent|MCP/i);
  });
  it("does not present legacy screenshot progress as successful Make generation", () => {
    state.jobs = [{ id: "old-job", status: "running", progress: 70, message: "Saving 10 screen designs.", inputJson: JSON.stringify({ designBriefId: "old-brief" }) }];
    const html = renderToStaticMarkup(createElement(MakeDesignPanel, { projectId: "p1", editable: true }));
    expect(html).toContain("Finishing an earlier design task");
    expect(html).not.toContain("Saving 10");
    expect(html).not.toContain("Ready for review");
  });
  it("explains a worker mismatch when a Make request succeeded with screenshot outputs only", () => {
    const requirements = reqs.map((r) => ({ key: r.key, title: r.title, text: r.detail, criteria: r.criteria }));
    state.brief = { id: "b1", mode: "figma", status: "draft", prototypeJson: null };
    state.jobs = [{ id: "stale-worker-job", status: "succeeded", outputRefs: [{ schema: "DesignScreen", id: "screen-1" }],
      inputJson: JSON.stringify({ designBriefId: "b1", source: designSource(automaticDesignDirection(requirements), requirements) }) }];
    const html = renderToStaticMarkup(createElement(MakeDesignPanel, { projectId: "p1", editable: true }));
    expect(html).toContain("legacy screen images without the Figma design reference");
    expect(html).toContain("Update the assigned design worker before retrying");
    expect(html).not.toMatch(/credit|consent|MCP/i);
  });
  it("reports a terminal failure by its recorded cause without exposing engine internals", () => {
    const requirements = reqs.map((r) => ({ key: r.key, title: r.title, text: r.detail, criteria: r.criteria }));
    state.brief = { id: "b1", mode: "figma", status: "draft", prototypeJson: null };
    state.jobs = [{ id: "our-failed-attempt", status: "failed", errorCode: "design.figmaProviderFailed",
      inputJson: JSON.stringify({ designBriefId: "b1", source: designSource(automaticDesignDirection(requirements), requirements) }) }];
    const html = renderToStaticMarkup(createElement(MakeDesignPanel, { projectId: "p1", editable: true }));
    expect(html).toContain("check whether Figma saved any work");
    expect(html).not.toMatch(/static screens|MF_ENGINE|CREDITS|consent/i);
  });
  it("does not attach an older failed attempt to a newer legacy-screen result", () => {
    const requirements = reqs.map((r) => ({ key: r.key, title: r.title, text: r.detail, criteria: r.criteria }));
    state.brief = { id: "b1", mode: "figma", status: "draft", prototypeJson: null };
    const source = designSource(automaticDesignDirection(requirements), requirements);
    state.jobs = [
      { id: "stale-worker-job", status: "succeeded", outputRefs: [{ schema: "DesignScreen", id: "screen-1" }],
        inputJson: JSON.stringify({ designBriefId: "b1", source }) },
      { id: "our-failed-attempt", status: "failed", errorCode: "design.figmaProviderFailed",
        inputJson: JSON.stringify({ designBriefId: "b1", source }) },
    ];
    const html = renderToStaticMarkup(createElement(MakeDesignPanel, { projectId: "p1", editable: true }));
    expect(html).toContain("legacy screen images without the Figma design reference");
    expect(html).not.toContain("The newest failed attempt also said");
    expect(html).not.toMatch(/MF_ENGINE|consent/i);
  });
});
