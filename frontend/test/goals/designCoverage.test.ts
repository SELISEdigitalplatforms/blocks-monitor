// The requirement map a design returns is matched to the requirements' acceptance criteria: tolerant of how a model
// copied a criterion (screen references, node ids, quotes, case, a cut-off ending), strict on what is covered.
import { describe, expect, it } from "vitest";
import { checkDesignCoverage, coverageFailureMessage, designCoverageTemplate, designIntent, normaliseCriterion, resolveRequirementKey, validDesignCoverage } from "../../src/domain/factoryDesign";

const requirements = [
  { Key: "REQ-1", Title: "Approve leave", Text: "Managers approve leave.", AcceptanceCriteria: [
    "Approvers see all their waiting requests", "An approver can approve or reject a request with a comment"] },
  { Key: "REQ-2", Title: "Import staff", Text: "Staff come from the HR system.", AcceptanceCriteria: ["The organogram feed is imported every night"] },
  { Key: "REQ-3", Title: "Team limits", Text: "Limit absences.", AcceptanceCriteria: ["At most 3 people of a team are away on the same day", "At most 30 days can be requested at once"] },
];
const intent = () => designIntent({}, null, requirements, []);
const entry = (key: string, criteria: string[], screens = ["3:2"], noScreenReason: string | null = null) => ({ key, screens, criteria, noScreenReason });
const exact = () => [
  entry("REQ-1", ["Approvers see all their waiting requests", "An approver can approve or reject a request with a comment"]),
  entry("REQ-2", ["The organogram feed is imported every night"]),
  entry("REQ-3", ["At most 3 people of a team are away on the same day", "At most 30 days can be requested at once"]),
];
const withReq1 = (criteria: string[]) => [entry("REQ-1", criteria), ...exact().slice(1)];

describe("design coverage matching", () => {
  it("accepts the exact copy and returns the requirements' exact criteria", () => {
    const check = checkDesignCoverage(intent(), exact());
    expect(check).toMatchObject({ ok: true, problems: [], ignored: [] });
    expect(check.coverage.map((c) => c.criteria)).toEqual(requirements.map((r) => r.AcceptanceCriteria));
  });

  it("accepts the 04.11 form: a criterion with a cut-off node-id screen reference appended", () => {
    const check = checkDesignCoverage(intent(), withReq1(["Approvers see all their waiting requests (3:2 l…", "An approver can approve or reject a request with a comment [12:34]"]));
    expect(check.ok).toBe(true);
    expect(check.coverage[0].criteria).toEqual(requirements[0].AcceptanceCriteria);
  });

  it.each([
    "approvers see all their waiting requests",
    "  “Approvers see all their waiting requests.”  ",
    "Approvers see all their waiting requests (screen 3:2 Requests list)",
    "Approvers see all their waiting requests (see Requests list)",
    "Approvers see all their waiting requests — 3:2",
    "Approvers see all their waiting requests 3:2, 3:7",
    "- Approvers see all their waiting requests",
    "REQ-1: Approvers see all their waiting requests",
    "Approvers see all their waiting req…",
    "AC1",
    "REQ-1/AC1",
    "[AC1] Approvers see all their waiting requests",
  ])("matches %j to the first criterion", (written) => {
    expect(checkDesignCoverage(intent(), withReq1([written, requirements[0].AcceptanceCriteria[1]])).ok).toBe(true);
  });

  it("strips a parenthetical named after a screen of the result only when given that screen", () => {
    const written = ["Approvers see all their waiting requests (Inbox)", requirements[0].AcceptanceCriteria[1]];
    expect(checkDesignCoverage(intent(), withReq1(written)).ok).toBe(false);
    expect(checkDesignCoverage(intent(), withReq1(written), { screenRefs: ["Inbox", "3:2", "inbox.png"] }).ok).toBe(true);
  });

  it("never merges two criteria that differ only in a number", () => {
    const changed = [exact()[0], exact()[1], entry("REQ-3", ["At most 3 people of a team are away on the same day", "At most 3 days can be requested at once"])];
    const check = checkDesignCoverage(intent(), changed);
    expect(check.ok).toBe(false);
    expect(check.problems).toEqual([{ kind: "missingCriterion", key: "REQ-3", criterion: "At most 30 days can be requested at once" }]);
    expect(normaliseCriterion("At most 3 days")).not.toBe(normaliseCriterion("At most 30 days"));
    expect(normaliseCriterion("VAT of 8.1% is added")).not.toBe(normaliseCriterion("VAT of 81% is added"));
    expect(normaliseCriterion("Split 3:2")).not.toBe(normaliseCriterion("Split 3.2"));
    expect(normaliseCriterion("Up to CHF 1’000")).toBe(normaliseCriterion("up to chf 1'000"));
    // A number is never matched by its first digits, even when the text is cut off right after it.
    const cut = [exact()[0], exact()[1], entry("REQ-3", ["At most 3 people of a team are away on the same day", "At most 3…"])];
    expect(checkDesignCoverage(intent(), cut).ok).toBe(false);
  });

  it("does not accept a cut-off start that is too short or shared by several criteria", () => {
    expect(checkDesignCoverage(intent(), withReq1(["Appro…", requirements[0].AcceptanceCriteria[1]])).ok).toBe(false);
    const shared = [exact()[0], exact()[1], entry("REQ-3", ["At most…", "At most…"])];
    expect(checkDesignCoverage(intent(), shared).problems.map((p) => p.kind)).toEqual(["missingCriterion", "missingCriterion"]);
  });

  it("does not accept a paraphrase or an id that contradicts its text", () => {
    expect(checkDesignCoverage(intent(), withReq1(["Approvers can view pending requests", requirements[0].AcceptanceCriteria[1]])).ok).toBe(false);
    expect(checkDesignCoverage(intent(), withReq1(["AC1: An approver can approve or reject a request with a comment", requirements[0].AcceptanceCriteria[1]])).ok).toBe(false);
    expect(checkDesignCoverage(intent(), withReq1(["AC3", requirements[0].AcceptanceCriteria[1]])).ok).toBe(false);
  });

  it("keeps failing when a criterion is attached to the wrong requirement", () => {
    const moved = [entry("REQ-1", [...requirements[0].AcceptanceCriteria, "The organogram feed is imported every night (3:9)"]), entry("REQ-2", []), exact()[2]];
    const check = checkDesignCoverage(intent(), moved);
    expect(check.problems).toEqual(expect.arrayContaining([
      { kind: "wrongRequirement", key: "REQ-1", criterion: "The organogram feed is imported every night (3:9)", belongsTo: "REQ-2" },
      { kind: "missingCriterion", key: "REQ-2", criterion: "The organogram feed is imported every night" },
    ]));
    expect(checkDesignCoverage(intent(), withReq1([...requirements[0].AcceptanceCriteria, "REQ-2/AC1"])).problems).toEqual([
      { kind: "wrongRequirement", key: "REQ-1", criterion: "REQ-2/AC1", belongsTo: "REQ-2" }]);
  });

  it("keeps failing when a criterion or a requirement is missing, and leaves out lines that name no criterion", () => {
    expect(checkDesignCoverage(intent(), withReq1([requirements[0].AcceptanceCriteria[0]])).problems).toEqual([
      { kind: "missingCriterion", key: "REQ-1", criterion: requirements[0].AcceptanceCriteria[1] }]);
    expect(checkDesignCoverage(intent(), exact().slice(1)).problems).toEqual([{ kind: "missingRequirement", key: "REQ-1" }]);
    const noted = checkDesignCoverage(intent(), withReq1([...requirements[0].AcceptanceCriteria, "Empty and error states are shown"]));
    expect(noted.ok).toBe(true);
    expect(noted.ignored).toEqual([{ key: "REQ-1", text: "Empty and error states are shown" }]);
    expect(noted.coverage[0].criteria).toEqual(requirements[0].AcceptanceCriteria);
  });

  it("names requirement keys written in another case or with the title appended", () => {
    const keys = ["R1", "R10", "REQ-1"];
    expect(resolveRequirementKey(keys, " r1 ")).toBe("R1");
    expect(resolveRequirementKey(keys, "R10: Reports")).toBe("R10");
    expect(resolveRequirementKey(keys, "[REQ-1] Approve leave")).toBe("REQ-1");
    expect(resolveRequirementKey(keys, "R2")).toBeNull();
    expect(checkDesignCoverage(intent(), [{ ...exact()[0], key: "req-1" }, ...exact().slice(1)]).ok).toBe(true);
    expect(checkDesignCoverage(intent(), [...exact(), entry("GOAL-1", [])]).problems).toEqual([{ kind: "unknownRequirement", key: "GOAL-1" }]);
    expect(checkDesignCoverage(intent(), [...exact(), exact()[0]]).problems).toEqual([{ kind: "duplicateRequirement", key: "REQ-1" }]);
  });

  it("allows a requirement with no screen when the map says why", () => {
    const reason = "The nightly feed from the HR system runs in the background; nobody sees it on a screen.";
    const noScreen = [exact()[0], entry("REQ-2", [], [], reason), exact()[2]];
    const check = checkDesignCoverage(intent(), noScreen);
    expect(check.ok).toBe(true);
    expect(check.coverage[1]).toEqual({ key: "REQ-2", screens: [], criteria: requirements[1].AcceptanceCriteria, noScreenReason: reason });
    expect(checkDesignCoverage(intent(), [exact()[0], entry("REQ-2", [], [], "x".repeat(400)), exact()[2]]).coverage[1].noScreenReason).toHaveLength(300);
    // No screen and no reason still fails, and a screen given with a reason keeps the screen.
    expect(checkDesignCoverage(intent(), [exact()[0], entry("REQ-2", requirements[1].AcceptanceCriteria, [], " "), exact()[2]]).problems).toEqual([{ kind: "noScreens", key: "REQ-2" }]);
    expect(checkDesignCoverage(intent(), [exact()[0], entry("REQ-2", requirements[1].AcceptanceCriteria, ["3:4"], reason), exact()[2]]).coverage[1].noScreenReason).toBeNull();
  });

  it("takes the screens of a requirement from the screen list when its map entry names none", () => {
    const missing = [exact()[0], entry("REQ-2", requirements[1].AcceptanceCriteria, []), exact()[2]];
    expect(checkDesignCoverage(intent(), missing).ok).toBe(false);
    const check = checkDesignCoverage(intent(), missing, { manifest: [{ nodeId: "3:2", requirementKeys: ["REQ-1"] }, { nodeId: "3:9", requirementKeys: ["req-2"] }] });
    expect(check.ok).toBe(true);
    expect(check.coverage[1].screens).toEqual(["3:9"]);
    // A stated reason stands even when a screen lists the key.
    const explained = checkDesignCoverage(intent(), [exact()[0], entry("REQ-2", [], [], "Runs in the background."), exact()[2]], { manifest: [{ nodeId: "3:9", requirementKeys: ["REQ-2"] }] });
    expect(explained.ok).toBe(true);
    expect(explained.coverage[1]).toMatchObject({ screens: [], noScreenReason: "Runs in the background." });
  });

  it("keeps the structural contract for malformed maps", () => {
    expect(validDesignCoverage(intent(), [])).toBe(false);
    expect(checkDesignCoverage(intent(), null).ok).toBe(false);
    expect(checkDesignCoverage(intent(), [{ key: "REQ-1", screens: "3:2", criteria: [] }, ...exact().slice(1)]).problems[0]).toEqual({ kind: "malformed", index: 0 });
    expect(checkDesignCoverage(intent(), [{ ...exact()[0], screens: [" "] }, ...exact().slice(1)]).ok).toBe(false);
  });

  it("gives the planner an id per criterion", () => {
    expect(designCoverageTemplate(intent())[0]).toEqual({ key: "REQ-1", title: "Approve leave", criteria: [
      { id: "AC1", text: requirements[0].AcceptanceCriteria[0] }, { id: "AC2", text: requirements[0].AcceptanceCriteria[1] }] });
  });

  it("describes the first problem in plain words within the 200 characters a job keeps", () => {
    const check = checkDesignCoverage(intent(), [exact()[0], entry("REQ-2", [], []), entry("REQ-3", [])]);
    const message = coverageFailureMessage(intent(), check.problems);
    expect(message).toBe('Screens were made, but the requirement map is incomplete: "Import staff" has no screen and no reason why none is needed. (+2 more)');
    const long = designIntent({}, null, [{ Key: "R1", Title: "T".repeat(150), AcceptanceCriteria: ["C".repeat(300)] }], []);
    const longMessage = coverageFailureMessage(long, checkDesignCoverage(long, [entry("R1", [])]).problems);
    expect(longMessage.length).toBeLessThanOrEqual(200);
    expect(longMessage.startsWith("Screens were made, but the requirement map is incomplete: ")).toBe(true);
  });
});
