// What the material leaves out reaches "Not included", constraints get their kinds, an accepted second-opinion fix
// changes only what it says, the project's facts are read once for the design and the build, and people's actions
// and the worker's lines reach the project's trace.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { outOfScopeItems, plannedExtras, withMaterialExclusions } from "../../server/local/engine/kinds/analysis/extras.ts";
import { acceptExtras, constraintKindOf } from "../../server/local/engine/kinds/analysis/ai.ts";
import { clipKeeping } from "../../server/local/engine/ai/material.ts";
import { applyMove, checkChange, currentPlan, featuresNamed, moveOf, type PlannedMilestone } from "../../server/local/engine/kinds/scope/milestones.ts";
import type { FeatureInfo } from "../../server/local/engine/kinds/scope/common.ts";
import { factsLine, factsRules, projectFactsIn } from "../../server/engine-context/facts.ts";
import { userActionsOf } from "../../server/engine-context/userEvents.ts";
import { projectLogger } from "../../server/blocks/engineWorker/worker.ts";
import { milestoneNoteOf } from "../../functions/project/ops/scope/challenges.ts";
import { makeWorld, type World } from "./harness";

// the product brief of the Asset Market project as its extraction reads it (two pages)
const BRIEF = `# Asset-Market-Product-Brief.pdf

## Page 1

Asset Market
Product brief · Version 1.0 · October 2026 · Owner: Product, Asset Market GmbH · www.assetmarket.io
1. Summary
Asset Market is an online marketplace where independent creators sell digital assets — icons, fonts, 3D
models, design templates and stock photos — to designers, developers and marketing teams. Every
asset is sold with a clear licence. Asset Market keeps a 15% commission on each sale, pays creators
their earnings once a month, and gives buyers instant, repeatable downloads of everything they have
bought.
2. Who it is for
Creators — freelance designers, type foundries, 3D artists and photographers who want to earn
from their work without running their own shop. They upload assets, set prices per licence and track
sales and payouts.
Buyers — designers, developers, agencies and in-house marketing teams who need ready-to-use
assets quickly and want to know exactly what they are allowed to do with them.
Marketplace team — a small operations team that reviews new assets before they go live, handles
licence questions and refunds, and runs the monthly payout.
3. Problem
Creators spread their work across many generic stores with unclear licence terms and slow, opaque
payouts. Buyers waste time checking whether an asset can be used in a client project or a paid
product, and lose files they bought months ago. Asset Market fixes both: one catalogue, plain-language
licences, predictable monthly payouts and a permanent download library.
4. What it must do (first release)
Catalogue and search: browse by category (icons, fonts, 3D models, templates, photos), search
by keyword, filter by price, licence and file format; asset page with previews, description, file list and
creator profile.
Creator listings: creators sign up, create a shop profile, upload asset files and preview images,
choose a category and set a price for each licence type. New listings wait for review by the
marketplace team.
Licences: three licence types per asset — Personal (own non-commercial use), Commercial (client
and business work, one end product) and Extended (products for resale, unlimited end products).
The licence text is shown before purchase and attached to every order.
Checkout: cart, card payment, order confirmation by e-mail with a licence certificate (PDF) per
item.
Buyer downloads: a "My downloads" library with every purchased asset; files can be downloaded
again at any time; download links expire after 24 hours and are regenerated on request.
Commission: Asset Market keeps 15% of the net sale price on every order line; the creator earns
85%. Commission and earnings are visible on each order line.

## Page 2

Monthly payouts: on the 1st of each month, creators' earnings for the previous month are summed
and paid out. Minimum payout is EUR 50; smaller balances roll over to the next month. Creators
see a payout statement per month.
Creator dashboard: sales per asset, earnings this month, next payout date and amount, top-selling
assets.
Review and refunds: the marketplace team approves or rejects new listings with a reason, and can
refund an order within 14 days if the files are faulty; a refund reverses the creator's earning.
5. Key numbers
Item 	Rule
Commission 	15% of net sale price per order line
Creator share 	85% of net sale price
Payout schedule 	Monthly, on the 1st, for the previous calendar month
Minimum payout 	EUR 50 (balance rolls over)
Refund window 	14 days after purchase
Download link lifetime 	24 hours, regenerated on request
Currency 	EUR at launch
6. What success looks like (first 6 months)
500 approved creators and 10,000 listed assets.
Buyer checkout completed in under 2 minutes; 95% of downloads start within 3 seconds.
New listings reviewed within 2 working days.
Every monthly payout paid on time and matching the creator's statement to the cent.
7. What matters most
Licences must be impossible to misunderstand: plain language, shown before purchase, on every
receipt.
Money must always add up: price = commission + creator earning on every line, and payouts match
the statements.
Buyers never lose access to what they paid for.
Clean, modern look that lets the assets' previews stand out; works well on desktop and mobile.
8. Not in the first release
Subscriptions or credit packs, coupons, multiple currencies, creator-to-buyer messaging, affiliate
programme, native mobile apps.
Contact: product@assetmarket.io`;
const fold = (s: string) => s.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

describe("Not included and the constraints of the requirements draft", () => {
  it("reads the brief's own out-of-scope list, one item each", () => {
    expect(outOfScopeItems([BRIEF])).toEqual([
      "Subscriptions or credit packs", "Coupons", "Multiple currencies", "Creator-to-buyer messaging", "Affiliate programme", "Native mobile apps",
    ]);
    expect(outOfScopeItems(["## Out of scope\n- Gift cards\n- A loyalty programme\n\n## Users\nShop staff"])).toEqual(["Gift cards", "A loyalty programme"]);
    expect(outOfScopeItems(["Not included: invoices, a mobile app.", "Live chat is out of scope for now. Offline mode is not part of the first release."])).toEqual(["Invoices", "A mobile app", "Live chat", "Offline mode"]);
    expect(outOfScopeItems(["Buyers browse and pay. Payouts are monthly."])).toEqual([]);
  });

  it("a long file keeps its out-of-scope list and key numbers when it is cut for a prompt", () => {
    const t = fold(BRIEF);
    expect(t.length).toBeGreaterThan(3500);
    const cut = clipKeeping(t, 3500);
    expect(cut.length).toBeLessThanOrEqual(3600);
    expect(cut).toContain("8. Not in the first release");
    expect(cut).toContain("native mobile apps");
    expect(cut).toContain("Currency EUR at launch");
    expect(clipKeeping("short text", 3500)).toBe("short text");
  });

  it("constraints get the kind their words say; 'Something else' only for the few rules no kind fits", () => {
    expect(constraintKindOf("Prices include VAT, and Asset Market handles the VAT", "other")).toBe("compliance");
    expect(constraintKindOf("Refunds are possible within 14 days of purchase if the files are faulty", "other")).toBe("compliance");
    expect(constraintKindOf("Buyers pay by card or PayPal", "other")).toBe("integrations");
    expect(constraintKindOf("Screens in English and German", "other")).toBe("languages");
    expect(constraintKindOf("Live before 1 March 2027", "other")).toBe("deadline");
    expect(constraintKindOf("Currency is EUR for every price, fee and amount", "other")).toBe("other");
    expect(constraintKindOf("Anything", "budget")).toBe("budget");
    const out = acceptExtras({
      constraints: [
        { kind: "other", text: "Currency is EUR for every price, fee and amount" },
        { kind: "other", text: "Prices include VAT, and Asset Market handles the VAT" },
        { kind: "other", text: "The largest upload for one asset is 1 GB" },
        { kind: "other", text: "A creator sets a price of EUR 1 to EUR 500 per licence" },
        { kind: "other", text: "Buyers pay by card or PayPal" },
      ],
      notIncluded: ["Coupons", "Native mobile apps."],
    });
    expect(out.filter((e) => e.kind === "constraint").map((e) => e.constraintKind)).toEqual(["other", "compliance", "other", "integrations"]);
    expect(out.filter((e) => e.kind === "exclusion").map((e) => e.title)).toEqual(["Coupons", "Native mobile apps"]);
  });

  it("an empty Not included list is filled although the other lists have rows; a list with rows stays as it is", () => {
    const rows = [{ ItemId: "w1", Kind: "workflow" }, { ItemId: "c1", Kind: "constraint" }];
    const run = { p: { project: { ItemId: "p" }, rows: (s: string) => (s === "RequirementExtra" ? rows : []) } } as never;
    const fromAi = withMaterialExclusions(
      [{ kind: "constraint", title: "VAT", who: "", steps: [], constraintKind: "compliance" }],
      outOfScopeItems([BRIEF]),
    );
    const planned = plannedExtras(run, fromAi);
    expect(planned.map((e) => [e.kind, e.at, e.origin])).toEqual(outOfScopeItems([BRIEF]).map((_, i) => ["exclusion", i + 1, "engine"]));
    // Claude's own exclusions win over the material's reading
    expect(withMaterialExclusions([{ kind: "exclusion", title: "Coupons", who: "", steps: [], constraintKind: "" }], ["Gift cards"]).map((e) => e.title)).toEqual(["Coupons"]);
  });
});

// ------------------------------------------------------------------------------------------------- one change only

const story = (title: string, hours = 8) => ({ id: "", key: title, title, text: title, actor: "buyer", criteria: [], hours, sortOrder: 0 });
const feature = (key: string, title: string, stories: string[]): FeatureInfo => ({
  id: key, key, ref: `feature:${key}`, title, description: title, priority: "must", requirementRefs: [], sortOrder: 0,
  stories: stories.map((t) => story(t)), hours: stories.length * 8, words: new Set(), text: title.toLowerCase(),
});
const FEATURES = [
  feature("browse", "Browse, search and filter assets", ["Browse assets by category", "Search and filter results", "View an asset page"]),
  feature("creators", "Creators upload and list assets", ["Create a shop profile", "Upload an asset with prices"]),
  feature("licences", "Licences and certificates", ["Read licence terms before buying", "Get a licence certificate PDF"]),
  feature("checkout", "Cart and checkout", ["Add to cart and pay", "Receive order confirmation e-mail"]),
  feature("downloads", "My downloads", ["Download purchased assets again"]),
  feature("review", "Listing review by the team", ["Approve or reject a listing"]),
  feature("payouts", "Monthly payouts and statements", ["Run the monthly payout"]),
  feature("dashboard", "Creator dashboard", ["See sales and earnings"]),
];
const ROWS: Row[] = [
  { ItemId: "m1", Number: 1, Name: "Listing, finding and licences", Goal: "G1", PreviewPoint: "P1", FeatureRefs: ["feature:browse", "feature:creators", "feature:licences"] },
  { ItemId: "m2", Number: 2, Name: "Buying and downloads", Goal: "G2", PreviewPoint: "P2", FeatureRefs: ["feature:checkout", "feature:downloads", "feature:review"] },
  { ItemId: "m3", Number: 3, Name: "Payouts and creator view", Goal: "G3", PreviewPoint: "P3", FeatureRefs: ["feature:payouts", "feature:dashboard"] },
];
const where = (plan: readonly PlannedMilestone[]) => Object.fromEntries(plan.flatMap((m) => m.featureRefs.map((r) => [r, m.number])));

describe("an accepted second-opinion fix changes only what it says", () => {
  const cur = currentPlan(ROWS, FEATURES);

  it("a simple move (a story and a milestone) is applied directly; every other assignment stays", () => {
    const note = 'Move "Get a licence certificate PDF" from milestone 1 to milestone 2, next to "Receive order confirmation e-mail".';
    const mv = moveOf(note, cur, FEATURES);
    expect(mv).toEqual({ featureRef: "feature:licences", to: 2, after: "feature:checkout" });
    const next = applyMove(cur, FEATURES, mv!)!;
    expect(next[1]!.featureRefs).toEqual(["feature:checkout", "feature:licences", "feature:downloads", "feature:review"]);
    const before = where(cur);
    const after = where(next);
    for (const ref of Object.keys(before)) if (ref !== "feature:licences") expect(after[ref], ref).toBe(before[ref]);
    // the untouched milestone keeps its texts word for word; the source loses a name that only fitted the moved feature
    expect(next[2]).toEqual(cur[2]);
    expect(next[0]!.name).not.toMatch(/licence/i);
    expect(next[1]!.name).toBe("Buying and downloads");
  });

  it("plain words and other ways of naming the milestone work too; unclear fixes are not guessed", () => {
    expect(moveOf("Move the certificate story to M2", cur, FEATURES)?.featureRef).toBe("feature:licences");
    expect(moveOf("Deliver the creator dashboard in the second milestone.", cur, FEATURES)).toMatchObject({ featureRef: "feature:dashboard", to: 2 });
    expect(moveOf("Move the certificate story to milestone 7", cur, FEATURES)).toBeNull();
    expect(moveOf("Move it earlier", cur, FEATURES)).toBeNull();
    expect(moveOf("Bring payments forward so the money flow is tested sooner", cur, FEATURES)).toBeNull();
    // a move that would empty a milestone is not a simple move
    const single = currentPlan([{ ...ROWS[0]!, FeatureRefs: ["feature:browse"] }, ROWS[1]!], FEATURES);
    expect(applyMove(single, FEATURES, { featureRef: "feature:browse", to: 2, after: null })).toBeNull();
  });

  it("Claude's change is kept only when nothing but the named work moved, and untouched milestones keep their texts", () => {
    const note = "Move the certificate story to milestone 2.";
    const named = featuresNamed(note, FEATURES);
    expect([...named]).toEqual(["feature:licences"]);
    const ok: PlannedMilestone[] = [
      { ...cur[0]!, name: "Listing and finding", goal: "new 1", featureRefs: ["feature:browse", "feature:creators"] },
      { ...cur[1]!, goal: "new 2", featureRefs: [...cur[1]!.featureRefs, "feature:licences"] },
      { ...cur[2]!, name: "Renamed by Claude", goal: "rewritten" },
    ];
    const kept = checkChange(ok, cur, named, note)!;
    expect(kept[2]).toEqual(cur[2]);
    expect(kept[1]!.goal).toBe("new 2");
    // browsing moved too: refused
    const bad: PlannedMilestone[] = [
      { ...cur[0]!, featureRefs: ["feature:creators"] },
      { ...cur[1]!, featureRefs: ["feature:browse", ...cur[1]!.featureRefs, "feature:licences"] },
      cur[2]!,
    ];
    expect(checkChange(bad, cur, named, note)).toBeNull();
    expect(checkChange([...ok, { ...cur[2]!, number: 4 }], cur, named, note)).toBeNull();
    expect(checkChange(cur, cur, named, note)).toBeNull();
  });

  it("the accept queues the planner for a milestone fix only", () => {
    expect(milestoneNoteOf({ ChallengeType: "coverage" }, "Move the certificate story to milestone 2.")).toBe("Move the certificate story to milestone 2.");
    expect(milestoneNoteOf({ ChallengeType: "acceptance" }, "Add a check for an empty cart.")).toBeNull();
  });
});

describe("milestones.suggest with an accepted fix (local engine)", () => {
  let w: World;
  beforeAll(async () => {
    w = await makeWorld();
  });
  afterAll(() => w?.close());
  const s = (v: unknown) => (typeof v === "string" ? v : "");

  it("moves the one feature and writes only the two milestones it touches", async () => {
    const order = w.project("B2B Order Portal");
    const pid = s(order.ItemId);
    const v = w.rows("ScopeVersion", pid).find((r) => r.Number === 1)!;
    const first = await w.queue({ project: "B2B Order Portal", kind: "milestones.suggest", input: { projectId: pid, scopeVersion: 1 }, target: { type: "scope-version", id: s(v.ItemId) }, key: "plan" });
    await w.settle();
    expect(w.get("EngineJob", first).Status).toBe("succeeded");
    const plan = () => w.rows("Milestone", pid).filter((m) => m.ScopeVersion === 1).sort((a, b) => Number(a.Number) - Number(b.Number));
    const before = plan().map((m) => ({ ...m }));
    expect(before.length).toBeGreaterThanOrEqual(3);
    const from = before.find((m) => (m.FeatureRefs as string[]).length >= 2)!;
    const to = before.find((m) => m !== from)!;
    const moved = (from.FeatureRefs as string[])[0]!;
    const f = w.rows("Feature", pid).find((x) => `feature:${s(x.Key)}` === moved && x.ScopeVersion === 1)!;
    const st = w.rows("Story", pid).find((x) => x.FeatureId === f.ItemId) ?? null;
    const what = st ? s(st.Title) || s(st.Text) : s(f.Title);
    const note = `Move "${what}" from milestone ${from.Number} to milestone ${to.Number}.`;
    const id = await w.queue({ project: "B2B Order Portal", kind: "milestones.suggest", input: { projectId: pid, scopeVersion: 1, note, adjust: true, challengeId: "c1" }, target: { type: "scope-version", id: s(v.ItemId) }, key: "fix" });
    await w.settle();
    const j = w.get("EngineJob", id);
    expect(j.Status, `${s(j.Message)}\n${w.log.join("\n")}`).toBe("succeeded");
    const after = plan();
    expect(after.length).toBe(before.length);
    for (const m of after) {
      const old = before.find((b) => b.Number === m.Number)!;
      const refs = m.FeatureRefs as string[];
      if (m.Number === from.Number) expect(refs).toEqual((old.FeatureRefs as string[]).filter((r) => r !== moved));
      else if (m.Number === to.Number) expect(refs).toEqual([...(old.FeatureRefs as string[]), moved]);
      else expect([m.Name, m.Goal, m.PreviewPoint, refs]).toEqual([old.Name, old.Goal, old.PreviewPoint, old.FeatureRefs]);
    }
    expect((j.OutputRefs as string[] | undefined)?.length ?? JSON.parse(s(j.OutputRefsJson) || "[]").length).toBe(2);
  });
});

// ------------------------------------------------------------------------------------------------- facts

describe("the project's facts", () => {
  const answers = ["Who pays VAT on sales, and should prices shown to buyers include it? Prices include VAT, Asset Market handles it"];

  it("reads currency, VAT, payout schedule and leaves the country out when the material names none", () => {
    const f = projectFactsIn([BRIEF, ...answers]);
    expect(f).toEqual({ currency: "EUR", tax: { name: "VAT", included: true }, payout: { schedule: "monthly", dayOfMonth: 1, covers: "the previous month", minimum: 50 } });
    const rules = factsRules(f).join("\n");
    expect(rules).toContain("Currency: EUR");
    expect(rules).toMatch(/VAT: included in the prices shown; the material gives no rate, so never show a percentage/);
    expect(rules).toMatch(/Every payout date shown is the 1st of a month/);
    expect(rules).toMatch(/no "CH-" or "DE-" references/);
    expect(factsLine(f)).toBe("EUR · VAT incl. · payouts monthly, on the 1st of the month, for the previous month; at least €50.00 (smaller balances wait for the next payout)");
  });

  it("a stated rate and country are used as they are; nothing is assumed otherwise", () => {
    const f = projectFactsIn(["Country: Switzerland. Prices are in CHF and include 8.1% VAT. Partners are paid out every Friday.", "We keep a 15% commission."]);
    expect(f).toEqual({ currency: "CHF", tax: { name: "VAT", percent: 8.1, included: true }, payout: { schedule: "weekly", weekday: "Friday" }, country: "Switzerland" });
    expect(factsRules(f).join("\n")).toMatch(/VAT: 8.1%, included in the prices shown/);
    expect(projectFactsIn(["A booking tool for yoga classes."])).toEqual({});
    expect(projectFactsIn(["Payouts on the last day of each month."], { region: "Germany" })).toEqual({ payout: { schedule: "monthly", dayOfMonth: 31 }, country: "Germany" });
    expect(projectFactsIn(["We keep 15% commission on each sale."]).tax).toBeUndefined();
  });
});

// ------------------------------------------------------------------------------------------------- trace

describe("people's actions and the worker's lines in the project's trace", () => {
  const view = (project: Row, data: Record<string, Row[]>) => ({ project, clarifications: () => [], rows: (s: string) => data[s] ?? [] }) as never;

  it("records the second-opinion decisions, the approval policy and the office's who-it's-for and goal answers", () => {
    const project: Row = {
      ItemId: "p1", Goal: "Creators get paid fairly", TargetUsers: "Designers and buyers", CreatedByUserId: "u1", UpdatedByUserId: "svc",
      CreatedDate: "2026-10-31T13:00:00.000Z", LastUpdatedDate: "2026-10-31T14:00:00.000Z", BusinessHandedOverAt: "2026-10-31T13:08:00.000Z", BusinessHandedOverByUserId: "u1",
    };
    const acts = userActionsOf(view(project, {
      Challenge: [
        { ItemId: "c1", Status: "accepted", Question: "Certificates late?", ChallengeType: "milestone-order", FinalText: "Move the certificate story to milestone 2.", DecidedByUserId: "u1", DecidedAt: "2026-10-31T13:15:00.000Z" },
        { ItemId: "c2", Status: "dismissed", Question: "Offline?", DismissReason: "Not needed", DecidedByUserId: "u1", DecidedAt: "2026-10-31T13:16:00.000Z" },
        { ItemId: "c3", Status: "open", Question: "Open point" },
      ],
      ApprovalPolicy: [{ ItemId: "ap1", Environment: "stage", Status: "active", RequestKey: "approvalPolicy:p1:stage", CreatedByUserId: "u1", UpdatedByUserId: "u1", CreatedDate: "2026-10-31T13:50:00.000Z", LastUpdatedDate: "2026-10-31T13:50:00.000Z" }],
      ApprovalStep: [{ ItemId: "s1", ParentType: "policy", ParentId: "ap1", ApproverUserIds: ["u1"], UpdatedByUserId: "u1", LastUpdatedDate: "2026-10-31T13:51:00.000Z" }],
    }));
    const by = (a: string) => acts.filter((x) => x.action === a);
    expect(by("setup.goal-answered")).toMatchObject([{ ref: "Project:p1", by: "u1", at: "2026-10-31T13:08:00.000Z", detail: { answer: "Creators get paid fairly" } }]);
    expect(by("setup.users-answered")).toMatchObject([{ by: "u1", detail: { answer: "Designers and buyers" } }]);
    expect(by("second-opinion.accepted")).toMatchObject([{ ref: "Challenge:c1", by: "u1", detail: { fix: "Move the certificate story to milestone 2.", rule: "milestone-order" } }]);
    expect(by("second-opinion.dismissed")).toMatchObject([{ ref: "Challenge:c2", detail: { reason: "Not needed" } }]);
    expect(acts.some((a) => a.ref === "Challenge:c3")).toBe(false);
    expect(by("approval-policy.saved")).toMatchObject([{ ref: "ApprovalPolicy:ap1", by: "u1", at: "2026-10-31T13:51:00.000Z", detail: { environment: "stage", steps: 1, approvers: 1 } }]);
    // the same answer is one action; a changed answer is a new one
    const again = userActionsOf(view({ ...project, LastUpdatedDate: "2026-10-31T15:00:00.000Z" }, {}));
    expect(again.find((a) => a.action === "setup.goal-answered")!.key).toBe(by("setup.goal-answered")[0]!.key);
    const changed = userActionsOf(view({ ...project, Goal: "Buyers find assets fast" }, {}));
    expect(changed.find((a) => a.action === "setup.goal-answered")!.key).not.toBe(by("setup.goal-answered")[0]!.key);
  });

  it("the worker's lines about a project go to that project's logs/engine.log", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-logs-"));
    try {
      const logs = path.join(root, "projects", "ws1", "5c3d2e1f-0a9b-4c8d-9e7f-6a5b4c3d2e1f", "logs");
      fs.mkdirSync(logs, { recursive: true });
      const store = { rows: (s: string) => (s === "EngineJob" ? [{ ItemId: "88e5be9c-1111", ProjectId: "5c3d2e1f-0a9b-4c8d-9e7f-6a5b4c3d2e1f", WorkspaceId: "ws1" }] : s === "Project" ? [{ ItemId: "5c3d2e1f-0a9b-4c8d-9e7f-6a5b4c3d2e1f", WorkspaceId: "ws1" }] : []) };
      const seen: string[] = [];
      const log = projectLogger(root, store, (l) => seen.push(l));
      log("[engine] board.plan 88e5be9c done in 13.5 s: Planned 24 tickets for 3 milestones.");
      log("[engine] job 88e5be9c failed: Error");
      log("[engine] context of 5c3d2e1f: v21 (milestones), 1 people's action(s) recorded");
      log("[engine] poll failed (1x): offline");
      log("[engine] chat.reply 00000000 done");
      expect(seen.length).toBe(5);
      const lines = fs.readFileSync(path.join(logs, "engine.log"), "utf8").trim().split("\n");
      expect(lines.length).toBe(3);
      expect(lines[0]).toMatch(/^\d{4}-\d\d-\d\dT.* \[engine\] board\.plan 88e5be9c done/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
