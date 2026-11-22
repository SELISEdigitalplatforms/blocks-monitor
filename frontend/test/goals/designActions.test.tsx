// The design section's actions: one primary (Approve, top right), quiet Change / Generate fresh options with helper
// text, and the reason a disabled action is off. Logic in designActions; the layout rendered with the real view.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { changeHelp, freshHelp, designActions, designStatus, type DesignFacts } from "../../src/components/design/designActions";
import { MakeDesignView, type MakeDesignViewProps } from "../../src/components/design/MakeDesignView";
import { designProgress } from "../../src/components/design/designProgress";
import { designRequestSending, makeDesignState } from "../../src/components/design/makeDesignState";
import type { EngineJob } from "../../src/blocks/engine/types";

const ready: DesignFacts = {
  editable: true, hasPrototype: true, busy: false, readsUnavailable: false, readsFailed: false, incomplete: false, current: true,
  hasPreview: true, approving: false, confirmed: false, canGenerate: true, hasRequirements: true, unavailable: false,
};
const facts = (over: Partial<DesignFacts> = {}): DesignFacts => ({ ...ready, ...over });

describe("design actions", () => {
  it("offers Approve as the one usable primary action when the design is ready for review", () => {
    const a = designActions(ready);
    expect(a.approve).toEqual({ show: true, disabled: false, reason: null, pending: false });
    expect(a.approved).toBe(false);
    expect(a.change).toEqual({ show: true, disabled: false, reason: null });
    expect(a.fresh).toEqual({ show: true, disabled: false, reason: null });
    expect(a.retry.show).toBe(false);
    expect(designStatus(ready)).toEqual({ state: "review", label: "Ready for review", tone: "accent" });
  });

  it.each([
    [{ busy: true }, "Wait for the new design to finish, then review it."],
    [{ busy: true, hasPrototype: false }, "Available once your design is ready."],
    [{ hasPrototype: false }, "Available once there is a design to review."],
    [{ incomplete: true }, "Some screen previews are still missing, so this design cannot be approved yet."],
    [{ current: false }, "This design no longer matches the latest goals and requirements. Request an updated design first."],
    [{ hasPreview: false }, "Wait for the live preview to be ready."],
    [{ readsUnavailable: true }, "Loading the design…"],
    [{ readsUnavailable: true, readsFailed: true }, "The design details could not be loaded. Refresh the page to try again."],
  ] as [Partial<DesignFacts>, string][])("disables Approve with a visible reason: %o", (over, reason) => {
    const a = designActions(facts(over));
    expect(a.approve.show).toBe(true);
    expect(a.approve.disabled).toBe(true);
    expect(a.approve.reason).toBe(reason);
  });

  it("while approving: disabled and pending, without a reason", () => {
    expect(designActions(facts({ approving: true })).approve).toEqual({ show: true, disabled: true, reason: null, pending: true });
  });

  it("an approved, current design shows the Approved state instead of the button", () => {
    const a = designActions(facts({ confirmed: true }));
    expect(a.approved).toBe(true);
    expect(a.approve.show).toBe(false);
    expect(designStatus(facts({ confirmed: true }))).toEqual({ state: "approved", label: "Approved", tone: "success" });
    // approved but out of date: approval is needed again
    const stale = designActions(facts({ confirmed: true, current: false }));
    expect(stale.approved).toBe(false);
    expect(stale.approve.disabled).toBe(true);
    expect(designStatus(facts({ confirmed: true, current: false })).label).toBe("Needs a new revision");
  });

  it("explains why Change design and Generate fresh design are off", () => {
    const busy = designActions(facts({ busy: true, canGenerate: false }));
    expect(busy.change).toEqual({ show: true, disabled: true, reason: "A design is being made right now. Wait for it to finish." });
    expect(busy.fresh.reason).toBe("A design is being made right now. Wait for it to finish.");
    const incomplete = designActions(facts({ incomplete: true }));
    expect(incomplete.change).toEqual({ show: true, disabled: true, reason: "Changes can be requested once every screen preview is saved." });
    expect(incomplete.fresh).toEqual({ show: true, disabled: false, reason: null });
    const noReqs = designActions(facts({ hasRequirements: false, canGenerate: false }));
    expect(noReqs.fresh.reason).toBe("Add requirements first: the design is made from them.");
  });

  it("people who cannot edit see no actions; no design and a failure offers Retry design", () => {
    const viewer = designActions(facts({ editable: false }));
    expect([viewer.approve.show, viewer.change.show, viewer.fresh.show, viewer.retry.show]).toEqual([false, false, false, false]);
    const failed = designActions(facts({ hasPrototype: false, unavailable: true }));
    expect(failed.retry).toEqual({ show: true, disabled: false, reason: null });
    expect(failed.change.show).toBe(false);
    expect(failed.fresh.show).toBe(false);
  });

  it("keeps the panel's status wording", () => {
    expect(designStatus(facts({ busy: true })).label).toBe("Designing");
    expect(designStatus(facts({ incomplete: true })).label).toBe("Preview incomplete");
    expect(designStatus(facts({ unavailable: true })).label).toBe("Design unavailable");
    expect(designStatus(facts({ hasPrototype: false })).label).toBe("Preparing design");
    expect(designStatus(facts({ hasPreview: false })).label).toBe("Preparing live preview");
  });
});

const PROTOTYPE = {
  provider: "figma-design" as const, projectId: "p1", projectUrl: "[private]", previewUrl: "/api/design-preview/p1/rev-2",
  revision: "rev-2", source: "ux-1", jobId: "j1", artifactFileId: "f1", reviewComplete: true, totalScreens: 3,
  screens: [
    { name: "01 Sign in", nodeId: "1:1", requirementKeys: ["R-1"], viewport: { width: 1440, height: 900 } },
    { name: "02 Orders", nodeId: "1:2", requirementKeys: ["R-1", "R-2"], viewport: { width: 390, height: 844 } },
    { name: "03 Order detail", nodeId: "1:3", requirementKeys: [] },
  ],
  noScreen: [{ key: "R-9", title: "Nightly import", reason: "Runs in the background with nothing to see." }],
};
const props = (over: Partial<MakeDesignViewProps> = {}, f: Partial<DesignFacts> = {}): MakeDesignViewProps => {
  const all = facts(f);
  return {
    editable: all.editable, status: designStatus(all), actions: designActions(all), onApprove: vi.fn(), busy: all.busy, progress: null,
    legacyActive: false, failure: null, prototype: PROTOTYPE, incomplete: all.incomplete, current: all.current, feedback: "",
    onFeedback: vi.fn(), onRequestChange: vi.fn(() => true), onFresh: vi.fn(), onRetry: vi.fn(), history: [], error: null, reads: "ready",
    onView: vi.fn(), ...over,
  };
};
const html = (p: MakeDesignViewProps) => renderToStaticMarkup(createElement(MakeDesignView, p));
/** The buttons in order with their variant and state: the primary is the accent-filled one. */
const buttons = (markup: string) => [...markup.matchAll(/<button([^>]*)>(.*?)<\/button>/g)].map(([, attrs, body]) => ({
  text: body.replace(/<[^>]+>/g, "").trim(), primary: /[\s"]bg-accent[\s"]/.test(attrs), disabled: /\bdisabled=""/.test(attrs),
}));

describe("design section layout", () => {
  it("puts Approve in the header as the only primary button, before the content and the quiet options", () => {
    const markup = html(props());
    const primary = buttons(markup).filter((b) => b.primary);
    expect(primary).toEqual([{ text: "Approve this design revision", primary: true, disabled: false }]);
    const header = markup.slice(0, markup.indexOf('data-design-section'));
    expect(header).toContain("Look &amp; feel");
    expect(header).toContain("Approve this design revision");
    expect(header).toContain("Ready for review");
    // the quiet options carry their helper text and come after the design
    expect(markup.indexOf("Your product, screen by screen")).toBeLessThan(markup.indexOf('data-design-options'));
    expect(markup).toContain(changeHelp());
    expect(markup).toContain(freshHelp());
    expect(buttons(markup).find((b) => b.text.startsWith("Generate fresh design"))?.primary).toBe(false);
    expect(buttons(markup).find((b) => b.text.startsWith("Change design"))?.primary).toBe(false);
  });

  it("shows the reason under a disabled Approve and links it for screen readers", () => {
    const markup = html(props({}, { current: false }));
    const approve = /<button([^>]*)>(?:(?!<\/button>).)*Approve this design revision<\/button><span id="([^"]+)"[^>]*>([^<]+)<\/span>/.exec(markup);
    expect(approve).not.toBeNull();
    expect(approve![1]).toContain('disabled=""');
    expect(approve![1]).toContain(`aria-describedby="${approve![2]}"`);
    expect(approve![3]).toBe("This design no longer matches the latest goals and requirements. Request an updated design first.");
    expect(markup).toContain("This design does not match the latest goals and requirements.");
  });

  it("an approved design shows the Approved chip and no approve button", () => {
    const markup = html(props({}, { confirmed: true }));
    expect(markup).toContain("Approved");
    expect(markup).not.toContain("Approve this design revision");
    expect(buttons(markup).some((b) => b.primary)).toBe(false);
  });

  it("draws the screens as tiles that open the viewer, and the requirements with no screen", () => {
    const markup = html(props());
    expect(markup).toContain('aria-label="Open screen 1: Sign in"');
    expect(markup).toContain('aria-label="Open screen 2: Orders"');
    const text = markup.replace(/<[^>]+>/g, "");
    expect(text).toContain("Sign inDesktop·1 requirement");
    expect(text).toContain("OrdersMobile·2 requirements");
    expect(text).toContain("Order detail0 requirements"); // no viewport: no device claimed
    expect(markup).toContain("Not shown on a screen (1)");
    expect(markup).toContain("Nightly import");
  });

  it("opens the change form with its own submit and Cancel, never as a primary", () => {
    const closed = html(props());
    expect(closed).not.toContain("<textarea");
    expect(closed).toContain('aria-expanded="false"');
    const open = html(props({ defaultChanging: true, feedback: "Bigger order status" }));
    expect(open).toContain("<textarea");
    expect(open).toContain('aria-expanded="true"');
    const submit = buttons(open).find((b) => b.text === "Request design changes");
    expect(submit).toEqual({ text: "Request design changes", primary: false, disabled: false });
    expect(buttons(html(props({ defaultChanging: true, feedback: "  " }))).find((b) => b.text === "Request design changes")?.disabled).toBe(true);
  });

  it("while designing: the shimmer line with the last step and elapsed time; Approve waits with its reason", () => {
    const now = Date.parse("2026-11-05T10:03:00.000Z");
    const progress = designProgress(null, { id: "j1", status: "running", progress: 10, message: "The planner is designing screens from the complete requirements.",
      createdAt: "2026-11-05T10:00:00.000Z", claimedAt: "2026-11-05T10:00:00.000Z", updatedAt: "2026-11-05T10:00:10.000Z" }, now, "x");
    const markup = html(props({ progress }, { busy: true, canGenerate: false }));
    expect(markup).toContain("Your business analyst is making a new design");
    // the engine's step still says "The planner"; people read the business analyst
    expect(markup).toContain("The business analyst is designing screens from the complete requirements.");
    expect(markup).not.toMatch(/planner/i);
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain("shimmer-progress-sweep");
    expect(markup).toContain("Still working · 3 min 00 s so far · usually about 45 to 75 minutes");
    expect(markup).toContain("Wait for the new design to finish, then review it.");
    expect(markup).toContain("Designing");
  });

  it("offers Stop design and disables it while waiting for server acknowledgement", () => {
    const running = html(props({ onStop: () => {} }, { busy: true, canGenerate: false }));
    expect(buttons(running).find((b) => b.text === "Stop design")?.disabled).toBe(false);
    const stopping = html(props({ onStop: () => {}, stopping: true }, { busy: true, canGenerate: false }));
    expect(buttons(stopping).find((b) => b.text === "Stopping…")?.disabled).toBe(true);
    expect(stopping).toContain("If it is offline");
  });

  it("a first design that failed explains itself with Retry design and its helper", () => {
    const markup = html(props({ prototype: null, failure: "Your screen designs could not be completed." }, { hasPrototype: false, hasPreview: false, unavailable: true }));
    expect(markup).toContain("The design could not be completed");
    expect(markup).toContain("Retry design");
    expect(markup).toContain("Starts a new design attempt");
    expect(markup).toContain("Design unavailable");
    expect(markup).not.toContain("Not quite right?");
  });
});

// 09.11.2026: the finished design on screen and its own job, still marked running for a moment (the design is saved a
// moment before the job's row turns succeeded). The panel's facts, worked out as MakeDesignPanel works them out.
describe("the design on screen while the job that made it is still marked running", () => {
  const made = { id: PROTOTYPE.jobId, status: "running", inputJson: JSON.stringify({ designBriefId: "b1", source: "ux-1" }) } as EngineJob;
  const panel = (complete: boolean, sent: Parameters<typeof designRequestSending>[0] = null, pending = false) => {
    const state = makeDesignState([made], "b1", "ux-1", { jobId: PROTOTYPE.jobId, complete });
    const busy = (pending && designRequestSending(sent, [made], true)) || !!state.active;
    const f: Partial<DesignFacts> = { busy, finishing: state.finishing, canGenerate: !busy, incomplete: !complete };
    return html(props({ finishing: state.finishing, prototype: complete ? PROTOTYPE : { ...PROTOTYPE, reviewComplete: false }, incomplete: !complete }, f));
  };

  it("reads as ready for review: no new design, and Approve, Change design and Generate fresh design are usable", () => {
    const markup = panel(true);
    expect(markup).not.toContain("making a new design");
    expect(markup).not.toContain("Sending your request");
    expect(markup).not.toContain("A design is being made right now");
    expect(markup).not.toContain("Wait for the new design to finish");
    expect(markup).toContain("Ready for review");
    const b = buttons(markup);
    expect(b.find((x) => x.text === "Approve this design revision")?.disabled).toBe(false);
    expect(b.find((x) => x.text.startsWith("Change design"))?.disabled).toBe(false);
    expect(b.find((x) => x.text.startsWith("Generate fresh design"))?.disabled).toBe(false);
  });

  it("a first-design request this page sent on its own and never heard back from is not a new design either", () => {
    const markup = panel(true, { automatic: true, knownJobIds: [PROTOTYPE.jobId] }, true);
    expect(markup).not.toContain("making a new design");
    expect(markup).not.toContain("Sending your request");
    expect(markup).toContain("Ready for review");
  });

  it("with screens still missing it is finishing this same design, never a new one", () => {
    const markup = panel(false);
    expect(markup).toContain("Your business analyst is finishing this design");
    expect(markup).not.toContain("making a new design");
    expect(markup).toContain("Wait for this design to finish, then review it.");
    expect(markup).toContain("This design is still being finished. Wait for it to finish.");
  });
});
