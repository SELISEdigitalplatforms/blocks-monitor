// Requirement titles from any input: a short noun or verb phrase (about eight words at most), one sentence, no lead-in
// ("The application connects to it", "It fits", "Each …"), no determiner first, no glued sentences, capitalised, no
// trailing punctuation. The full sentence stays in the requirement's text.
//   npx vitest run --config frontend/test/engine/vitest.config.ts test/engine/titles.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { parseOutputRef } from "../../src/domain/engineJob";
import { clausesOf, titleOf } from "../../server/local/engine/kinds/analysis/grammar.ts";
import { makeWorld, type World } from "./harness";

/** What every title must be. */
function expectCleanTitle(title: string, from = "") {
  const why = `"${title}" (from "${from}")`;
  expect(title, why).toMatch(/^[A-Z0-9“"]/);
  expect(title, why).not.toMatch(/[.,;:!?…]$/);
  expect(title, why).not.toMatch(/^(each|every|the|a|an)\b/i);
  expect(title, why).not.toMatch(/\bconnects? to it\b|\bit [A-Z]|\bshould:|\.\s+[A-Z]/);
  expect(title, why).not.toMatch(/\s(of|in|on|at|the|a|an|and|or|with|to|for|from|by|per|each|every|is|are|has|have)$/i);
  expect(title.split(/\s+/).length, why).toBeLessThanOrEqual(9);
}

describe("titleOf", () => {
  it("cleans the titles that came out wrong", () => {
    const cases: Array<[string, string]> = [
      ["Each event calendar", "Event calendar"],
      ["Each rights detail", "Rights detail"],
      ["The application connects to it Read access to the door lock system", "Read access to the door lock system"],
      ["Drivers show the minutes lost per site at a glance", "Minutes lost per site at a glance"],
      ["Managers show the minutes lost per site at a glance", "Minutes lost per site at a glance"],
      ["The application shows the minutes lost per site at a glance", "Minutes lost per site at a glance"],
      ["Rights tracker: attach licence terms to each asset and warn before expired material is used", "Rights tracker"],
      ["Table turn planner: show each room's cleaning status live", "Table turn planner"],
      ["The application should: reminder e-mail one day before", "Reminder e-mail one day before"],
      ["It fits SAP for invoicing", "Works with SAP for invoicing"],
      ["It fits the point-of-sale system", "Works with the point-of-sale system"],
      ["Meter readings arrive in several formats and need retyping before billing. Catering Orders should accept readings", "Meter readings arrive in several formats"],
      ["Staff is able to use it on their phones after ten minutes of practice", "Staff can use it on their phones"],
      ["The application respects peak times are Monday mornings", "Peak times are Monday mornings"],
      ["Nobody wants to type the same data twice", "Nobody has to type the same data twice"],
      ["Room status or prep sheet has an owner who moves it from Open to Done", "Room status or prep sheet has an owner"],
      ["Every item has one owner who moves it from Open to Done and escalates it when it runs late", "Items have one owner"],
      ["Each customer sees only their articles at their own prices", "Customers see only their articles"],
      ["The application complies with GDPR", "Complies with GDPR"],
      ["The application is available in English, with German later", "Available in English, with German later"],
      ["The application has read access to the door lock system", "Read access to the door lock system"],
      ["The application connects to the Lohnquelle payroll system", "Connection to the Lohnquelle payroll system"],
      ["Watch cold store temperatures and alert the right person before stock is at risk", "Watch cold store temperatures"],
      ["Drivers record every pallet move once and keep stock locations current", "Drivers record every pallet move once"],
      ["Customers book a class online and pay by card or TWINT", "Customers book a class online"],
      ["Clients upload receipts, invoices and bank statements from the phone", "Clients upload receipts, invoices and bank statements"],
      ["Quality assurance sees expiring certificates and failed deliveries at a glance", "Quality assurance sees expiring certificates and failed deliveries"],
      ["Central register of certificates with reminders 60 and 30 days before expiry", "Central register of certificates"],
      ["Orders reach the ERP as SAP sales orders", "Orders reach the ERP as SAP sales orders"],
      ["The order desk can change orders before the cut-off", "Order desk can change orders before the cut-off"],
      ["Peak times: Monday mornings", "Peak times: Monday mornings"],
      ["The driver checks “Order catering” at the end of the week and sends a summary to Tomasz", "Driver checks “Order catering”"],
      ["Turn the confirmed orders of a day into the kitchen's production list", "Turn the confirmed orders"],
      ["New suppliers register themselves in the existing purchasing portal", "New suppliers register themselves"],
    ];
    for (const [input, want] of cases) {
      expect(titleOf(input), input).toBe(want);
      expectCleanTitle(titleOf(input), input);
    }
  });

  it("keeps a comma inside a noun phrase together when it splits a line into needs", () => {
    expect(clausesOf("Send each driver a single, current route and update it when a stop changes")).toEqual([
      "Send each driver a single, current route and update it when a stop changes",
    ]);
    expect(clausesOf("Each table plan, event calendar or arrivals today has an owner who moves it from Open to Done")).toHaveLength(1);
    expect(clausesOf("Let customers order catering online with menu, headcount and dietary needs, and change the headcount until the cut-off")).toEqual([
      "Let customers order catering online with menu, headcount and dietary needs", "Let customers change the headcount until the cut-off",
    ]);
    // two real needs still split
    expect(clausesOf("Suppliers upload certificates themselves, QA gets a list of expiring ones")).toHaveLength(2);
  });
});

describe("requirements.draft titles on real projects", () => {
  let w: World;
  beforeAll(async () => { w = await makeWorld(); });
  afterAll(() => w?.close());

  const refsOf = (projectId: string) => {
    const ids = (s: string, f: (r: Row) => boolean = () => true) => w.rows(s, projectId).filter(f).map((r) => String(r.ItemId)).sort();
    return {
      docNoteIds: ids("DocNote"), docFileIds: ids("DocFile", (r) => r.Status === "ready"),
      clarificationIds: ids("Clarification", (r) => r.Status === "answered" || r.Status === "deferred"),
      decisionIds: ids("Decision", (r) => r.Status === "accepted"), techDecisionIds: ids("TechDecision", (r) => r.Status !== "rejected"),
      requirementIds: ids("Requirement"),
    };
  };
  const draftTitles = async (name: string): Promise<Array<{ title: string; text: string }>> => {
    const pid = String(w.project(name).ItemId);
    const id = await w.queue({ project: name, kind: "requirements.draft", input: { projectId: pid, sanitizationVersion: 1, refs: refsOf(pid) }, key: `titles-${name}` });
    await w.settle();
    const job = w.get("EngineJob", id);
    expect(job.Status, String(job.Message)).toBe("succeeded");
    return ((job.OutputRefs as string[]) ?? []).map(parseOutputRef)
      .filter((r): r is { schema: string; id: string } => r !== null && r.schema === "Requirement")
      .map((r) => w.get("Requirement", r.id)).map((r) => ({ title: String(r.Title), text: String(r.Text) }));
  };
  const print = (name: string, reqs: Array<{ title: string; text: string }>) => {
    if (process.env.PRINT) console.log(`\n### ${name}\n${reqs.map((r) => `${r.title}  ||  ${r.text}`).join("\n")}`);
  };

  it("the catering project's setup (the lines that came out wrong) drafts clean titles, the text keeps the sentence", async () => {
    const pid = String(w.project("Supplier Quality Portal").ItemId);
    await w.gw.update("Project", pid, {
      SetupMustHaves: JSON.stringify([
        { text: "Table turn planner: show each room's cleaning status live and tell the front desk the moment it is ready", priority: "must" },
        { text: "Send each driver a single, current route and update it when a stop changes", priority: "should" },
        { text: "Show the minutes lost per site at a glance", priority: "should" },
        { text: "Plan delivery slots for each order and give drivers the address, the contact on site and the time window", priority: "must" },
        { text: "Let customers order catering online with menu, headcount and dietary needs, and change the headcount until the cut-off", priority: "must" },
      ]),
      SetupWorkflows: JSON.stringify(["Each table plan, event calendar or arrivals today has an owner who moves it from Open to Done and escalates it when it runs late"]),
      SetupConstraints: JSON.stringify([
        { kind: "other", text: "Staff must be able to use it on their phones after ten minutes of practice" },
        { kind: "integrations", text: "It has to fit the point-of-sale system; Read access to the door lock system" },
        { kind: "other", text: "Peak times are the first week of the quarter" },
      ]),
    });
    const reqs = await draftTitles("Supplier Quality Portal");
    print("catering setup", reqs);
    for (const r of reqs) expectCleanTitle(r.title, r.text);
    const titles = reqs.map((r) => r.title);
    expect(titles.join(" | ")).not.toMatch(/connects to it|Each event calendar|Drivers show|Customers show|Managers show|Staff is able|Customers plan|^Headcount and dietary needs$/m);
    expect(titles).toContain("Plan delivery slots for each order");
    // the text never names the wrong people for the team's own work
    const slots = reqs.find((r) => r.title === "Plan delivery slots for each order")!;
    expect(slots.text).toMatch(/^The \w+ lets the team plan delivery slots/);
    expect(reqs.find((r) => r.title === "Let customers order catering online")?.text).toMatch(/^The \w+ lets customers order catering online/);
    expect(titles).not.toContain("Headcount and dietary needs");
    // the full sentence is still in the text
    expect(reqs.some((r) => /minutes lost per site at a glance/i.test(r.text))).toBe(true);
  });

  it("titles stay clean across the seeded projects", async () => {
    for (const name of ["Supplier Onboarding Portal", "Client Document Portal", "Expense Receipts App"]) {
      const reqs = await draftTitles(name);
      print(name, reqs);
      expect(reqs.length, name).toBeGreaterThan(0);
      for (const r of reqs) expectCleanTitle(r.title, `${name}: ${r.text}`);
    }
  });
});
