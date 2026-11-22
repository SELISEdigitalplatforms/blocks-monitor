// The engine steps of 31.10 with a stub runner instead of the Claude CLI: technical decisions from Claude (C1), the
// planners see the answered questions (C3), a requirements draft made before the answers is refreshed with them (C4),
// board tickets without the actor prefix (C5), an accepted milestone fix queues the milestone planner (C6), and the
// Blocks worker's speed settings (no paced waits, progress in the background, parallel writes).
//   npx vitest run --config test/engine/vitest.config.ts test/engine/claudeSteps.test.ts
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { assertRowValid } from "../../functions/_lib/testing";
import type { Row } from "../../functions/_lib/gateway";
import { setAiRunner, type AiRequest } from "../../server/local/engine/ai/index.ts";
import { acceptTech } from "../../server/local/engine/kinds/analysis/ai.ts";
import { planTickets } from "../../server/local/engine/kinds/scope/board.ts";
import { inParallel } from "../../server/local/engine/run.ts";
import { shouldRefresh } from "../../functions/project/ops/sanitization/autoDraft";
import { milestoneNoteOf } from "../../functions/project/ops/scope/challenges";
import { makeWorld, type World } from "./harness";

// These tests drive the focused AI calls; the planner agent mode (analysis/agent.ts) is off here, as on a host without
// the official engine's planner AGENT.md.
vi.mock("../../server/local/engine/kinds/analysis/agent.ts", async (orig) => ({ ...(await orig<Record<string, unknown>>()), hasAgentPlanner: () => false }));


const s = (v: unknown) => (typeof v === "string" ? v : "");
const props = (r: AiRequest): string[] => Object.keys((r.schema as { properties?: object }).properties ?? {});

let calls: AiRequest[] = [];
const install = (fn: (r: AiRequest) => unknown) => setAiRunner(async (r) => { calls.push(r); return fn(r); });
afterEach(() => {
  setAiRunner(null);
  calls = [];
});

function done(w: World, id: string): Row {
  const j = w.get("EngineJob", id);
  if (j.Status !== "succeeded") throw new Error(`job ${s(j.Kind)} ${s(j.Status)}: ${s(j.Message)}\n${w.log.join("\n")}`);
  return j;
}

const TECH = {
  decisions: [
    { area: "stack", title: "Marketplace web app on SELISE Blocks", choice: "A responsive web shop for buyers and a seller area, on SELISE Blocks with its sign-in, records and file storage.", rationale: "Buyers shop on phones and sellers upload from laptops; one web app serves both without app stores.", alternatives: ["Native apps", "A hosted shop product"], nfrCategory: "", nfrTarget: "", integrationSystem: "" },
    { area: "integration", title: "Card payments and seller payouts through Stripe Connect", choice: "Stripe Connect takes the card payment, keeps the marketplace fee and pays each seller monthly.", rationale: "The client answered that sellers are paid monthly after a 15% fee; Stripe Connect does both and handles seller checks.", alternatives: ["Manual bank transfers", "PayPal payouts"], nfrCategory: "", nfrTarget: "", integrationSystem: "Stripe Connect" },
    { area: "nfr", title: "Fast search across the catalogue", choice: "Search answers within one second for nine out of ten searches.", rationale: "Buyers leave a shop that makes them wait; the catalogue starts with about 5,000 assets.", alternatives: ["Browse by category only"], nfrCategory: "performance", nfrTarget: "Search answers within 1 second for 90% of searches", integrationSystem: "" },
    { area: "nfr", title: "A sample nfr", choice: "This one uses a staged word and is dropped.", rationale: "It says sample, which the visible text never says.", alternatives: [], nfrCategory: "performance", nfrTarget: "x", integrationSystem: "" },
  ],
};

describe("pure checks", () => {
  it("acceptTech keeps product-specific proposals with their area fields and refuses the rest", () => {
    const ctx = { existing: [], decidedAreas: new Set<string>(), min: 2, max: 4 };
    const plan = acceptTech(TECH, ctx)!;
    expect(plan.map((t) => t.Area)).toEqual(["stack", "integration", "nfr"]);
    expect(plan[1]).toMatchObject({ IntegrationSystem: "Stripe Connect" });
    expect(plan[2]).toMatchObject({ NfrCategory: "performance", NfrTarget: "Search answers within 1 second for 90% of searches" });
    expect(acceptTech({ decisions: [] }, ctx)).toBeNull();
    // an area decided already is left out, a follow-up keeps to its area
    expect(acceptTech(TECH, { ...ctx, decidedAreas: new Set(["stack"]), min: 1 })!.map((t) => t.Area)).toEqual(["integration", "nfr"]);
    expect(acceptTech(TECH, { ...ctx, area: "integration", min: 1, max: 1 })!.map((t) => t.Title)).toEqual(["Card payments and seller payouts through Stripe Connect"]);
  });

  it("shouldRefresh asks for a refresh only when the newest draft missed answers and nothing runs", () => {
    const draft = (ids: string[], status = "succeeded", purpose = "") => ({ ItemId: `j-${status}-${purpose}-${ids.length}`, Kind: "requirements.draft", Status: status, InputJson: JSON.stringify({ refs: { clarificationIds: ids }, ...(purpose ? { purpose } : {}) }) });
    const base = { openQuestions: 0, anyQuestions: 3, requirements: 5, handledIds: ["a", "b"] };
    expect(shouldRefresh({ ...base, jobs: [draft([])] })).toBe(true);
    expect(shouldRefresh({ ...base, jobs: [draft(["a", "b"])] })).toBe(false);
    expect(shouldRefresh({ ...base, jobs: [draft(["a", "b"], "succeeded", "refresh"), draft([])] })).toBe(false); // refreshed already
    expect(shouldRefresh({ ...base, jobs: [draft([], "running")] })).toBe(false);
    expect(shouldRefresh({ ...base, openQuestions: 1, jobs: [draft([])] })).toBe(false);
    expect(shouldRefresh({ ...base, jobs: [draft([], "succeeded", "landingPage")] })).toBe(false); // not a draft
  });

  it("milestoneNoteOf turns a milestone fix into the planner's note", () => {
    expect(milestoneNoteOf({ ChallengeType: "acceptance" }, "Add a check for a failed upload.")).toBeNull();
    expect(milestoneNoteOf({ ChallengeType: "acceptance" }, "Move “Seller payouts” from milestone 3 to milestone 2.")).toBe("Move “Seller payouts” from milestone 3 to milestone 2.");
    expect(milestoneNoteOf({ ChallengeType: "milestone-order" }, "Deliver checkout before the seller dashboard.")).toBe("Deliver checkout before the seller dashboard.");
    expect(milestoneNoteOf({ ChallengeType: "milestone-gap" }, "  ")).toBeNull();
  });

  it("board tickets carry the story text without the actor prefix", () => {
    const st = { id: "s", key: "a-1", title: "Upload an asset", text: "As a creator, I want to upload an asset so that I can sell it.", actor: "creator", criteria: ["It is listed"], hours: 3, sortOrder: 0 };
    const f = { id: "f", key: "a", ref: "feature:a", title: "Uploads", description: "", priority: "must" as const, requirementRefs: [], sortOrder: 0, stories: [st], hours: 3, words: new Set<string>(), text: "" };
    const [t] = planTickets({ milestones: [{ id: "m1", number: 1, features: [f] }], tasks: [[]] });
    expect(t!.description).toBe("As a creator, I want to upload an asset so that I can sell it.");
  });

  it("inParallel keeps the order, limits the lanes and stops on the first failure", async () => {
    let live = 0;
    let most = 0;
    const out = await inParallel([5, 1, 3, 2, 4], 2, async (n) => {
      live += 1;
      most = Math.max(most, live);
      await new Promise((r) => setTimeout(r, n));
      live -= 1;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20, 40]);
    expect(most).toBe(2);
    const seen: number[] = [];
    await expect(inParallel([1, 2, 3, 4], 1, async (n) => { seen.push(n); if (n === 2) throw new Error("stop"); return n; })).rejects.toThrow("stop");
    expect(seen).toEqual([1, 2]);
  });
});

describe("writers with Claude's answers (stub runner, the worker's speed settings)", () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld({ engine: { waitScale: () => 0, backgroundProgress: true, pickupDelay: false } });
  });
  afterAll(() => w?.close());

  it("sanitization.assist (technical) writes Claude's decisions, valid for the schema, with no paced waits", async () => {
    install((r) => (props(r).includes("decisions") ? TECH : (() => { throw new Error("unexpected"); })()));
    const p = w.project("Supplier Quality Portal");
    const pid = s(p.ItemId);
    const t0 = w.now().getTime();
    const id = await w.queue({ project: s(p.Name), kind: "sanitization.assist", input: { projectId: pid, focus: "technical" }, key: "c1" });
    await w.settle();
    const job = done(w, id);
    expect(w.now().getTime() - t0).toBeLessThan(1000); // the virtual clock moved by no paced wait
    expect(job.Progress).toBe(100);
    const rows = w.rows("TechDecision", pid).filter((r) => s(r.RequestKey).startsWith(`engine:${id}:`));
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) expect(() => assertRowValid("TechDecision", r, { read: true })).not.toThrow();
    expect(rows.some((r) => r.Title === "Card payments and seller payouts through Stripe Connect" && r.IntegrationSystem === "Stripe Connect")).toBe(true);
    expect(new Set(rows.map((r) => r.Number)).size).toBe(rows.length); // numbers given out once, in parallel
    expect(calls[0]!.prompt).toContain("Material:");
    expect(w.log.some((l) => /AI technical decisions: Claude answer used/.test(l))).toBe(true);
  });

  it("the second opinion and the board planner get the answered questions and decisions", async () => {
    install((r) => {
      const k = props(r);
      // a usable answer (without one the job fails and writes nothing): a point on each of the scope's first features
      if (k.includes("points")) {
        const tags = [...new Set([...r.prompt.matchAll(/\[(F\d+)\]/g)].map((m) => m[1]!))].slice(0, 3);
        return { points: tags.map((tag, i) => ({ rule: "acceptance", severity: "medium", question: `What happens when step ${i + 1} of ${tag} fails halfway?`, why: "Nothing says what people see then.", fix: "Add a check for the failure and the message people see.", target: tag })) };
      }
      if (k.includes("tasks")) return { tasks: [] };
      throw new Error("unexpected");
    });
    const p = w.rows("Project").find((x) => w.rows("Feature", s(x.ItemId)).length > 0 && w.rows("Clarification", s(x.ItemId)).some((c) => c.Status === "answered"))!;
    expect(p).toBeTruthy();
    const pid = s(p.ItemId);
    const version = Number(p.CurrentScopeVersion) || 1;
    const id = await w.queue({ project: s(p.Name), kind: "scope.grill", input: { projectId: pid, scopeVersion: version }, key: "c3" });
    await w.settle();
    done(w, id);
    const grill = calls.find((c) => props(c).includes("points"));
    expect(grill?.prompt).toContain("The client's answers and decisions (The client's answers and decisions come first: they override the notes, the files");
    expect(grill?.prompt).toMatch(/settled by the client/);
  });

  it("requirements.draft with purpose refresh rewrites the untouched drafted requirements with the answers", async () => {
    const p = w.project("Supplier Quality Portal");
    const pid = s(p.ItemId);
    // a first draft made by the engine (before the answers), and one requirement a person edited since
    install((r) => {
      const k = props(r);
      if (k.includes("requirements")) return { requirements: [
        { title: "Sellers upload an asset with its licence", text: "A seller uploads a file and picks a licence.", category: "functional", priority: "must", acceptanceCriteria: ["The upload is listed at once", "An upload without a licence is refused"], sources: [] },
        { title: "Buyers pay by card", text: "A buyer pays by card.", category: "functional", priority: "must", acceptanceCriteria: ["A paid order shows the download", "A failed payment leaves nothing half paid"], sources: [] },
        { title: "Sellers see their payouts", text: "A seller sees what they earned.", category: "data", priority: "nice", acceptanceCriteria: ["The payout matches the sales", "Each payout lists its sales"], sources: [] },
      ] };
      // the objective (without a usable answer the job fails and writes nothing)
      if (k.includes("statement")) return {
        statement: "Suppliers keep their quality records in one place the quality team trusts",
        acceptanceCriteria: ["Every supplier uploads its certificates in the portal", "The quality team sees open issues per supplier"],
        highLevelMd: "## Goal\n- One place for supplier quality",
        architectureMd: "## Components\n- Supplier area\n- Quality team area",
        lookAndFeel: "Calm and clear, built for suppliers on a laptop and the quality team on a large screen.",
        workflows: [], notIncluded: [], constraints: [],
      };
      throw new Error("unexpected");
    });
    const first = await w.queue({ project: s(p.Name), kind: "requirements.draft", input: { projectId: pid, sanitizationVersion: 1 }, key: "c4-first" });
    await w.settle();
    done(w, first);
    const drafted = w.rows("Requirement", pid).filter((r) => s(r.RequestKey).startsWith(`engine:${first}:`));
    expect(drafted.length).toBe(3);
    const edited = drafted.find((r) => r.Title === "Buyers pay by card")!;
    await w.gw.update("Requirement", s(edited.ItemId), { Text: "A buyer pays by card or TWINT.", LastUpdatedDate: new Date(Date.parse(s(edited.CreatedDate)) + 60_000).toISOString() });

    install((r) => {
      const k = props(r);
      if (k.includes("requirements")) return { requirements: [
        { title: "Sellers upload an asset and set a licence and price", text: "A seller uploads a file, picks a licence and sets the price; the marketplace keeps 15% of each sale.", category: "functional", priority: "must", acceptanceCriteria: ["The seller sees the 15% fee before saving", "An upload without a licence is refused"], sources: [] },
        { title: "Sellers are paid once a month", text: "Sellers get their earnings on the first working day of each month.", category: "data", priority: "must", acceptanceCriteria: ["The payout matches the month's sales minus the fee", "Each payout lists its sales"], sources: [] },
      ] };
      // the objective (without a usable answer the job fails and writes nothing)
      if (k.includes("statement")) return {
        statement: "Suppliers keep their quality records in one place the quality team trusts",
        acceptanceCriteria: ["Every supplier uploads its certificates in the portal", "The quality team sees open issues per supplier"],
        highLevelMd: "## Goal\n- One place for supplier quality",
        architectureMd: "## Components\n- Supplier area\n- Quality team area",
        lookAndFeel: "Calm and clear, built for suppliers on a laptop and the quality team on a large screen.",
        workflows: [], notIncluded: [], constraints: [],
      };
      throw new Error("unexpected");
    });
    const refresh = await w.queue({ project: s(p.Name), kind: "requirements.draft", input: { projectId: pid, sanitizationVersion: 1, purpose: "refresh" }, key: "c4-refresh" });
    await w.settle();
    const job = done(w, refresh);
    expect(String(job.Message)).toMatch(/^Updated the requirements with/);
    const after = w.rows("Requirement", pid);
    const byId = new Map(after.map((r) => [s(r.ItemId), r]));
    // the untouched ones were rewritten in place (same rows), the edited one stays as the person left it
    const untouched = drafted.filter((r) => r !== edited);
    expect(untouched.map((r) => byId.get(s(r.ItemId))?.Title)).toEqual(["Sellers upload an asset and set a licence and price", "Sellers are paid once a month"]);
    expect(byId.get(s(edited.ItemId))?.Text).toBe("A buyer pays by card or TWINT.");
    for (const r of untouched) expect(() => assertRowValid("Requirement", byId.get(s(r.ItemId))!, { read: true })).not.toThrow();
    const prompt = calls.filter((c) => props(c).includes("requirements")).at(-1)!.prompt;
    expect(prompt).toContain("answered the open questions");
    expect(prompt).not.toContain("- Sellers upload an asset with its licence\n"); // a replaced one is not "existing"
    expect(prompt).toContain("Buyers pay by card"); // the edited one is
  });
});
