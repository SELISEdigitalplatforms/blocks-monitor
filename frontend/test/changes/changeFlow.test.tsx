// The change request light SDLC in the UI (CHANGE-PROCESS-31.10): the lifecycle model, the parts and the change request
// page in every state, rendered with real components over fixed rows (no network). With CR_HTML_DIR set, each page
// state is also written as HTML for the screenshots.
import fs from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { DeliveryChangeRequest, PolicyRecord } from "../../src/blocks/delivery/types";
import type { EngineJob } from "../../src/blocks/engine/types";
import { ANALYSIS, DEV_RELEASE, FEATURE, LEGACY, MILESTONE, NAMES, OTHER, OWNER, answered, cr, fakeCtx, job } from "./fixtures";

const rows = vi.hoisted(() => ({
  changes: [] as unknown[],
  jobs: [] as unknown[],
  policies: [] as unknown[],
}));

vi.mock("@/blocks/delivery/hooks", async (orig) => {
  const actual = await orig<typeof import("../../src/blocks/delivery/hooks")>();
  const { DEV_RELEASE: dev, MILESTONE: m } = await import("./fixtures");
  const list = <T,>(data: T[]) => ({ data, unreadable: [], isLoading: false, error: null });
  return {
    ...actual,
    useChangeRequests: () => list(rows.changes),
    useReleases: () => list([dev]),
    useMilestones: () => list([m]),
    useApprovalPolicies: () => list(rows.policies),
    useDeliveryJobs: () => ({ jobs: rows.jobs, isLoading: false, error: null }),
    useFeatureNames: () => new Map([["feature:catalogue", "Asset catalogue"]]),
  };
});

const { BlocksChangeBuildView } = await import("../../src/components/build/BlocksChangeBuildView");
const { ChangeRequestsPanel } = await import("../../src/components/delivery/ChangeRequestsPanel");
const { ChangeApprovalCard, ChangeQuestionsCard } = await import("../../src/components/changes/ChangeLifecycle");
const { changeStage, lifecycleSteps, analysisOf, decisionOf } = await import("../../src/components/changes/changeFlow");
const { changeRightFor } = await import("../../src/components/changes/changeDecide");
const { blocksChangeMessage } = await import("../../src/components/changes/blocksChanges");
const { FunctionError } = await import("../../src/blocks/fn");

const HTML_DIR = process.env.CR_HTML_DIR ?? "";

function render(el: ReactElement): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  return renderToStaticMarkup(<QueryClientProvider client={qc}><MemoryRouter>{el}</MemoryRouter></QueryClientProvider>);
}

/** Visible text, tags stripped, spaces collapsed. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();

function page(name: string, change: DeliveryChangeRequest, o: { jobs?: EngineJob[]; policies?: PolicyRecord[]; members?: string[]; userId?: string } = {}) {
  rows.changes = [change];
  rows.jobs = o.jobs ?? [];
  rows.policies = o.policies ?? [];
  const html = render(<BlocksChangeBuildView ctx={fakeCtx({ members: o.members, userId: o.userId })} number={change.number} />);
  if (HTML_DIR) {
    fs.mkdirSync(HTML_DIR, { recursive: true });
    fs.writeFileSync(path.join(HTML_DIR, `${name}.html`), html);
  }
  return { html, text: textOf(html) };
}

/** The state of each lifecycle step, in order, from the rendered bar. */
const barStates = (html: string) => [...html.matchAll(/<li[^>]*data-state="([a-z]+)"/g)].map((m) => m[1]);

/** No raw ids and no internal words on screen. */
function plain(text: string) {
  for (const id of ["cr-2", "cr-1", "u-owner", "u-other", "p-asset", "w-1", "feature:catalogue", "j-change"]) expect(text).not.toContain(id);
  expect(text).not.toMatch(/\b(mock|demo|test|undefined|null|NaN)\b/i);
}

describe("lifecycle model", () => {
  const steps = (status: string, a = ANALYSIS, decidedAt: string | null = null) =>
    lifecycleSteps(status, changeStage(status, a, { decidedAt }), a, decidedAt).map((s) => s.state);

  it("puts each status on its step", () => {
    expect(steps("draft", null as never)).toEqual(["now", "todo", "todo", "todo", "todo", "todo", "todo", "todo"]);
    expect(steps("analysing", null as never)).toEqual(["done", "now", "todo", "todo", "todo", "todo", "todo", "todo"]);
    expect(steps("questions")).toEqual(["done", "done", "now", "todo", "todo", "todo", "todo", "todo"]);
    expect(steps("review")).toEqual(["done", "done", "done", "now", "todo", "todo", "todo", "todo"]);
    expect(steps("approved", ANALYSIS, "2026-10-31T10:30:00Z")).toEqual(["done", "done", "done", "done", "now", "todo", "todo", "todo"]);
    expect(steps("building", ANALYSIS, "2026-10-31T10:30:00Z")).toEqual(["done", "done", "done", "done", "now", "todo", "todo", "todo"]);
    expect(steps("released-dev", ANALYSIS, "x")).toEqual(["done", "done", "done", "done", "done", "done", "todo", "todo"]);
    expect(steps("promoted-stage", ANALYSIS, "x")).toEqual(["done", "done", "done", "done", "done", "done", "done", "todo"]);
    expect(steps("promoted-production", ANALYSIS, "x")).toEqual(Array(8).fill("done"));
  });

  it("shows rejected at Approval and failed at Analysis or Build", () => {
    expect(steps("rejected")[3]).toBe("rejected");
    expect(steps("failed", null as never)).toEqual(["done", "failed", "todo", "todo", "todo", "todo", "todo", "todo"]);
    expect(steps("failed", ANALYSIS, "2026-10-31T10:30:00Z")[4]).toBe("failed");
  });

  it("marks Questions skipped when the analysis asked none", () => {
    expect(steps("review", { ...ANALYSIS, questions: [] })[2]).toBe("skipped");
  });

  it("refines once every question is answered, and sends a new feature through scope", () => {
    expect(changeStage("questions", answered(ANALYSIS, { q1: "Always CHF", q2: "No, hide them" }), { decidedAt: null })).toBe("refining");
    expect(changeStage("questions", answered(ANALYSIS, { q1: "Always CHF" }), { decidedAt: null })).toBe("questions");
    expect(changeStage("approved", FEATURE, { decidedAt: "x" })).toBe("scope");
    expect(changeStage("approved", ANALYSIS, { decidedAt: "x" })).toBe("approved");
  });

  it("is buildFailed while still building once its change.build job stopped", () => {
    expect(changeStage("building", ANALYSIS, { decidedAt: "x" }, { status: "failed" })).toBe("buildFailed");
    expect(changeStage("building", ANALYSIS, { decidedAt: "x" }, { status: "cancelled" })).toBe("buildFailed");
    expect(changeStage("building", ANALYSIS, { decidedAt: "x" }, { status: "running" })).toBe("building");
    expect(changeStage("building", ANALYSIS, { decidedAt: "x" }, null)).toBe("building");
    // an old change request (no analysis) keeps its old view: it has no approval to build again
    expect(changeStage("building", null, { decidedAt: null }, { status: "failed" })).toBe("legacy");
  });

  it("keeps old change requests (no analysis, building or released) on their old view", () => {
    expect(changeStage(LEGACY.status, analysisOf(LEGACY), decisionOf(LEGACY))).toBe("legacy");
    expect(changeStage("building", null, { decidedAt: null })).toBe("legacy");
    expect(changeStage("draft", null, { decidedAt: null })).toBe("draft");
  });
});

describe("approval rule (the release rule)", () => {
  const policy = (ids: string[]): PolicyRecord[] => [{ id: "pol", environment: "stage", updatedAt: null, policy: { environment: "stage", steps: [{ type: "architect", required: true, approverUserIds: ids }] } }];

  it("lets the requester self-approve only as the only approver", () => {
    expect(changeRightFor({ userId: OWNER, requesterId: OWNER, policies: [], activeMemberIds: [OWNER] })).toEqual({ ok: true, self: true });
    expect(changeRightFor({ userId: OWNER, requesterId: OWNER, policies: policy([OWNER, OTHER]), activeMemberIds: [OWNER, OTHER] }))
      .toEqual({ ok: false, reason: "ownRequest", others: [OTHER] });
    expect(changeRightFor({ userId: OTHER, requesterId: OWNER, policies: policy([OWNER, OTHER]), activeMemberIds: [OWNER, OTHER] })).toEqual({ ok: true, self: false });
  });

  it("renders the same lines as the release approvals", () => {
    const nameOf = (id: string | null) => (id ? NAMES[id] ?? "" : "");
    const self = textOf(render(<ChangeApprovalCard right={{ ok: true, self: true }} busy={false} error={null} onDecide={async () => true} nameOf={nameOf} />));
    expect(self).toContain("You're the only approver, so you can approve this yourself.");
    expect(self).toContain("Approve change");
    expect(self).toContain("Reject");
    expect(self).toContain("A note (optional)");
    const own = textOf(render(<ChangeApprovalCard right={{ ok: false, reason: "ownRequest", others: [OTHER] }} busy={false} error={null} onDecide={async () => true} nameOf={nameOf} />));
    expect(own).toContain("You asked for this change, so Jonas Brandt must approve it.");
    expect(own).not.toContain("Approve change");
  });
});

describe("questions", () => {
  it("offers one-click options plus Other…, and marks the answer", () => {
    const html = render(<ChangeQuestionsCard questions={answered(ANALYSIS, { q1: "Always CHF" }).questions} canAnswer refining={false} savingId={null} error={null}
      onAnswer={async () => true} nameOf={(id) => (id ? NAMES[id] ?? "" : "")} />);
    const t = textOf(html);
    expect(t).toContain("Which currency should the price range use?");
    expect((html.match(/>Other…</g) ?? []).length).toBe(2);
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*Always CHF/);
    expect(t).toContain("1 of 2 still open");
    expect(t).toContain("Answered by Mira Keller");
  });
});

describe("change request page, every state", () => {
  const decided = { decidedAt: "2026-10-31T10:40:00.000Z", decidedByUserId: OWNER, selfApproved: true };

  it("draft: send for analysis, not the build", () => {
    const { html, text } = page("01-draft", cr());
    expect(text).toContain("CR-002 is saved; send it for analysis");
    expect(text).toContain("Send for analysis");
    expect(text).not.toContain("Start the build");
    expect(barStates(html)).toEqual(["now", "todo", "todo", "todo", "todo", "todo", "todo", "todo"]);
    plain(text);
  });

  it("analysing: the business analyst's honest line with progress", () => {
    const { text } = page("02-analysing", cr({ status: "analysing" }), { jobs: [job("change.analyse", "running", 40)] });
    expect(text).toContain("The business analyst is analysing your change…");
    expect(text).toContain("40%");
    expect(text).not.toContain("Send for analysis");
    plain(text);
  });

  it("questions: the analysis card and the questions first", () => {
    const { html, text } = page("03-questions", cr({ status: "questions", analysisValue: ANALYSIS }));
    expect(text).toContain("CR-002 has 2 questions for you");
    expect(text).toContain("Questions from the business analyst");
    expect(text.indexOf("Questions from the business analyst")).toBeLessThan(text.indexOf("The business analyst's analysis"));
    for (const s of ["Change", "Estimate: 2 tickets", "What it touches", "Asset catalogue", "Saved searches", "Milestone 1: Marketplace basics",
      "No conflicts with the locked scope.", "Risks", "Acceptance criteria", "A saved search keeps its price range.", "Planned tickets · 2 tickets",
      "Price range filter on the asset list"]) expect(text).toContain(s);
    expect(barStates(html)[2]).toBe("now");
    plain(text);
  });

  it("refining: answers in, the analysis is being refined", () => {
    const { text } = page("04-refining", cr({ status: "questions", analysisValue: answered(ANALYSIS, { q1: "Always CHF", q2: "No, hide them" }) }),
      { jobs: [job("change.analyse", "running", 55)] });
    expect(text).toContain("The business analyst is refining the analysis with your answers…");
    expect(text).toContain("Every question is answered; the analysis is being refined");
    plain(text);
  });

  it("review: approve or reject, the only-approver line", () => {
    const { text } = page("05-review", cr({ status: "review", analysisValue: answered(ANALYSIS, { q1: "Always CHF", q2: "No, hide them" }) }));
    expect(text).toContain("CR-002 is waiting for your approval");
    expect(text).toContain("You're the only approver, so you can approve this yourself.");
    expect(text).toContain("Approve change");
    expect(text).not.toContain("Start the build");
    plain(text);
  });

  it("review on the scope route: build it as a change or keep it for Scope & success, never a plain approval", () => {
    const { text } = page("05c-review-scope-route", cr({ status: "review", lane: "add", featureRef: "", title: "Auctions for assets", analysisValue: FEATURE }));
    expect(text).toContain("The business analyst sees this as new work beyond the locked scope.");
    expect(text).toContain("Build it as a change");
    expect(text).toContain("Keep it for Scope & success");
    expect(text).toContain("Reject");
    expect(text).not.toContain("Approve change");
    plain(text);
  });

  it("review, asked by you while someone else approves", () => {
    const policies: PolicyRecord[] = [{ id: "pol", environment: "stage", updatedAt: null, policy: { environment: "stage", steps: [{ type: "architect", required: true, approverUserIds: [OWNER, OTHER] }] } }];
    const { text } = page("05b-review-other-approver", cr({ status: "review", analysisValue: answered(ANALYSIS, { q1: "Always CHF", q2: "No, hide them" }) }),
      { policies, members: [OWNER, OTHER] });
    expect(text).toContain("You asked for this change, so Jonas Brandt must approve it.");
    expect(text).not.toContain("Approve change");
  });

  it("approved, fast route: tickets on the board and Start the build", () => {
    const { html, text } = page("06-approved", cr({ status: "approved", analysisValue: answered(ANALYSIS, { q1: "Always CHF", q2: "No, hide them" }), ...decided, decisionNote: "Fine for the next release." }));
    expect(text).toContain("Approved. The planned tickets are on the board.");
    expect(text).toContain("self-approved as the only approver");
    expect(text).toContain("Fine for the next release.");
    expect(text).toContain("Start the build");
    expect(text).toContain("Open the board");
    expect(barStates(html)).toEqual(["done", "done", "done", "done", "now", "todo", "todo", "todo"]);
    plain(text);
  });

  it("scope route: no build yet, kept for Scope & success, and it can still be built as a change (never a dead end)", () => {
    const { html, text } = page("07-scope-route", cr({ status: "approved", lane: "add", featureRef: "", title: "Auctions for assets", description: "Sellers want to auction an asset: buyers bid until a closing time and the highest bid wins.", analysisValue: FEATURE, ...decided }));
    expect(text).toContain("CR-002 is kept for Scope & success; it can be built now as a change");
    expect(text).toContain("It's listed on the Scope & success page with its description");
    expect(text).toContain("Build it as a change");
    expect(text).toContain("Open Scope & success");
    expect(html).toContain('href="/p/p-asset/scope"');
    expect(text).not.toContain("Start the build");
    expect(text).toContain("The locked scope sells assets at a fixed price only.");
    plain(text);
  });

  it("rejected: a clear state with who decided", () => {
    const { html, text } = page("08-rejected", cr({ status: "rejected", analysisValue: answered(ANALYSIS, { q1: "Always CHF", q2: "No, hide them" }), decidedAt: decided.decidedAt, decidedByUserId: OWNER, decisionNote: "Not before the launch." }));
    expect(text).toContain("CR-002 was rejected");
    expect(text).toContain("Rejected by Mira Keller");
    expect(text).toContain("Not before the launch.");
    expect(barStates(html)[3]).toBe("rejected");
    expect(text).not.toContain("Start the build");
    plain(text);
  });

  it("analysis failed: retry the analysis", () => {
    const { html, text } = page("09-analysis-failed", cr({ status: "failed" }), { jobs: [job("change.analyse", "failed", 20)] });
    expect(text).toContain("The analysis of CR-002 stopped");
    expect(text).toContain("Try the analysis again");
    expect(barStates(html)[1]).toBe("failed");
    plain(text);
  });

  it("build failed: start the build again", () => {
    const { html, text } = page("10-build-failed", cr({ status: "failed", analysisValue: ANALYSIS, ...decided }), { jobs: [job("change.build", "failed", 60)] });
    expect(text).toContain("The build of CR-002 stopped");
    expect(text).toContain("Start the build again");
    expect(barStates(html)[4]).toBe("failed");
    plain(text);
  });

  it("build failed while the change is still building (the engine's real rows): start the build again", () => {
    // the engine leaves the change request at "building" and fails its change.build job
    const change = cr({ status: "building", version: "1.2.0", analysisValue: ANALYSIS, ...decided });
    const failed = page("10b-build-failed-building", change, { jobs: [job("change.build", "failed", 60)] });
    expect(failed.text).toContain("The build of CR-002 stopped");
    expect(failed.text).toContain("Start the build again");
    expect(failed.text).not.toContain("is being built");
    expect(barStates(failed.html)[4]).toBe("failed");
    plain(failed.text);
    // a cancelled build can be started again too; a newer running job is the build again
    expect(page("10c-build-cancelled", change, { jobs: [job("change.build", "cancelled", 30)] }).text).toContain("Start the build again");
    const again = { ...job("change.build", "running", 5), id: "j-again", createdAt: "2026-10-31T11:00:00.000Z" };
    expect(page("10d-build-again", change, { jobs: [job("change.build", "failed", 60), again] }).text).not.toContain("Start the build again");
    // a failed job of another change request changes nothing
    expect(page("10e-other-failed", change, { jobs: [job("change.build", "failed", 60, "cr-9")] }).text).toContain("is being built");
  });

  it("a stopped build says why (its job's line), and a build waiting for the Blocks sign-in says it waits for you", () => {
    const change = cr({ status: "building", version: "1.2.0", analysisValue: ANALYSIS, ...decided });
    const why = "The Blocks sign-in for Asset Market could not be started on the engine host. The engine team has the details.";
    const failed = page("10f-build-failed-reason", change, { jobs: [{ ...job("change.build", "failed", 60), message: why }] });
    expect(failed.text).toContain("The build of CR-002 stopped");
    expect(failed.text).toContain(why);
    plain(failed.text);
    const line = "Connect Asset Market to Blocks: open https://iam.seliseblocks.com/device, sign in with the Blocks account that may deploy this product and confirm code WXYZ-1234.";
    const waiting = page("11b-building-waits-for-sign-in", change, { jobs: [{ ...job("change.build", "running", 35), message: line }] });
    expect(waiting.text).toContain("Waiting for you: connect to Blocks");
    expect(waiting.text).toContain("Connect Asset Market to Blocks");
    expect(waiting.text).not.toContain("The development team is building CR-002");
    expect(waiting.text).not.toContain("is being built");
    plain(waiting.text);
  });

  it("building and released follow the same bar", () => {
    const b = page("11-building", cr({ status: "building", version: "1.2.0", analysisValue: ANALYSIS, ...decided }), { jobs: [job("change.build", "running", 35)] });
    expect(b.text).toContain("The development team is building CR-002…");
    const r = page("12-released-dev", cr({ status: "released-dev", version: "1.2.0", analysisValue: ANALYSIS, ...decided }));
    expect(r.text).toContain("Released to development as version 1.2.0");
    expect(barStates(r.html)).toEqual(["done", "done", "done", "done", "done", "done", "todo", "todo"]);
  });

  it("CR-001 (released before the analysis existed) keeps its old view", () => {
    const { html, text } = page("13-legacy-cr-001", LEGACY);
    expect(text).toContain("CR-001 · Released to development as version 1.1.0");
    expect(text).toContain("Show the seller's rating on each asset");
    expect(barStates(html)).toEqual([]);
    expect(text).not.toContain("analysis");
  });
});

describe("Release page change requests", () => {
  it("lists old and new change requests with their next step", () => {
    const list = [LEGACY, cr(), cr({ id: "cr-3", number: 3, status: "questions", analysisValue: ANALYSIS, title: "Price range in alerts" })];
    const html = render(<ChangeRequestsPanel ctx={fakeCtx()} changeRequests={list} milestones={[MILESTONE]} releases={[DEV_RELEASE]} jobs={[]} />);
    if (HTML_DIR) fs.writeFileSync(path.join(HTML_DIR, "14-release-page-list.html"), html);
    const t = textOf(html);
    expect(t).toContain("CR-001");
    expect(t).toContain("Released to development");
    expect(t).toContain("Send for analysis");
    expect(t).toContain("Questions for you");
    expect(t).toContain("Answer the questions");
    expect(t).not.toContain("Start the build");
    // two lifecycle bars: the draft and the one with questions; CR-001 keeps its row as before
    expect((html.match(/aria-label="Change request steps"/g) ?? []).length).toBe(2);
  });

  it("offers the build again for a change still building whose change.build job failed", () => {
    const building = cr({ status: "building", version: "1.2.0", analysisValue: ANALYSIS, decidedAt: "2026-10-31T10:30:00.000Z", decidedByUserId: OWNER });
    const before = textOf(render(<ChangeRequestsPanel ctx={fakeCtx()} changeRequests={[building]} milestones={[MILESTONE]} releases={[DEV_RELEASE]} jobs={[job("change.build", "running", 40)]} />));
    expect(before).toContain("Being built");
    expect(before).toContain("Follow the build");
    const after = textOf(render(<ChangeRequestsPanel ctx={fakeCtx()} changeRequests={[building]} milestones={[MILESTONE]} releases={[DEV_RELEASE]} jobs={[job("change.build", "failed", 40)]} />));
    expect(after).toContain("Start the build again");
    expect(after).toContain("Stopped");
    expect(after).not.toContain("Being built");
  });
});

describe("messages", () => {
  it("words the server's change request keys plainly", () => {
    expect(blocksChangeMessage(new FunctionError("conflict", "", "r1", "delivery.cr.scopeRoute"))).toBe("This is a new feature: add it through Scope & success.");
    expect(blocksChangeMessage(new FunctionError("conflict", "", "r1", "delivery.cr.notApproved"))).toBe("Approve the change first.");
    expect(blocksChangeMessage(new FunctionError("conflict", "", "r1", "delivery.cr.notInReview"))).toBe("This change isn't waiting for approval.");
  });
});
