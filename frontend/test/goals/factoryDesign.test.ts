import { describe, expect, it } from "vitest";
import { designIntent, factoryDesignSource, factoryPreviewPath, parseFactoryPrototype, screenRequirementTitles, validDesignCoverage } from "../../src/domain/factoryDesign";

const requirements = [{ Key: "R1", Title: "Order", Text: "Send an order", AcceptanceCriteria: ["Name required"], Status: "draft" }];
const intent = () => designIntent({ Goal: "Reduce order errors", SetupExclusions: "No online payment" }, { Statement: "Order at the table" }, requirements, []);
describe("Factory design intent and revision contract", () => {
  it("invalidates a revision when goals, objectives, acceptance criteria or constraints change", () => {
    const base = intent(); const hash = factoryDesignSource(base);
    expect(factoryDesignSource({ ...base, project: { ...base.project, Goal: "Different goal" } })).not.toBe(hash);
    expect(factoryDesignSource({ ...base, objective: { statement: "New objective", criteria: [] } })).not.toBe(hash);
    expect(factoryDesignSource({ ...base, extras: [{ kind: "constraint", title: "Keyboard access" }] })).not.toBe(hash);
    expect(factoryDesignSource({ ...base, requirements: [{ ...base.requirements[0], criteria: ["Different rule"] }] })).not.toBe(hash);
  });
  it("does not let reorder or removed extras manufacture changes to product scope", () => {
    const a = { Kind: "constraint", Title: "Keyboard" }, b = { Kind: "exclusion", Title: "No payments" };
    expect(designIntent({}, null, requirements, [a, b])).toEqual(designIntent({}, null, requirements, [b, a, { Kind: "constraint", Title: "Removed", Status: "removed" }]));
  });
  it("requires exact coverage of every active requirement and acceptance criterion", () => {
    const good = [{ key: "R1", screens: ["checkout"], criteria: ["Name required"] }];
    expect(validDesignCoverage(intent(), good)).toBe(true);
    expect(validDesignCoverage(intent(), [])).toBe(false);
    expect(validDesignCoverage(intent(), [{ ...good[0], criteria: [] }])).toBe(false);
    expect(validDesignCoverage(intent(), [...good, ...good])).toBe(false);
  });
  it("accepts only the recorded same-project immutable preview path", () => {
    const revision = "a".repeat(64), previewUrl = factoryPreviewPath("p1", revision);
    const p = { provider: "factory", projectId: "p1", previewUrl, projectUrl: previewUrl, revision, source: factoryDesignSource(intent()), jobId: "j1", artifactFileId: "f1", figmaReferenceUrl: null };
    expect(parseFactoryPrototype(p)).toEqual(p);
    expect(parseFactoryPrototype({ ...p, previewUrl: "https://evil.example" })).toBeNull();
    expect(parseFactoryPrototype({ ...p, projectId: "p2" })).toBeNull();
  });
});

describe("the design viewer names a screen's requirements (E2E 08.11)", () => {
  const reqs = [
    { key: "team-members-pick-their-lunch-for-the-wh", title: "Team members pick their lunch for the whole week at once" },
    { key: "orders-close-at-10-00-on-each-working-da", title: "Orders close at 10:00 on each working day" },
    { key: "R1", title: "" },
  ];
  it("shows each requirement's title, not its cut-off key, once and in the manifest's order", () => {
    expect(screenRequirementTitles(["orders-close-at-10-00-on-each-working-da", "team-members-pick-their-lunch-for-the-wh", " ORDERS-CLOSE-AT-10-00-ON-EACH-WORKING-DA "], reqs))
      .toEqual(["Orders close at 10:00 on each working day", "Team members pick their lunch for the whole week at once"]);
  });
  it("falls back to the key only when no title is known", () => {
    expect(screenRequirementTitles(["R1", "unknown-key", "", 7], reqs)).toEqual(["R1", "unknown-key"]);
    expect(screenRequirementTitles(["team-members-pick-their-lunch-for-the-wh"], [])).toEqual(["team-members-pick-their-lunch-for-the-wh"]);
  });
});
