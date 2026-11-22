// The planner's requirement coverage may name screens by number, name or file instead of the frame node id.
import { describe, expect, it } from "vitest";
import { resolveCoverageScreens, type PlannedScreen } from "../../server/local/engine/kinds/scope/figmaCoverage";

const screens: PlannedScreen[] = [
  { name: "01 Browse assets", nodeId: "2:2", file: "01-browse-assets.png", requirementKeys: ["browse"] },
  { name: "09 Creator dashboard", nodeId: "2:90", file: "09-creator-dashboard-payouts.png", requirementKeys: ["payouts", "licence"] },
  { name: "14 Empty and error states", nodeId: "2:140", file: "14-empty-error-states.png", requirementKeys: ["licence"] },
];

describe("requirement coverage of the planned screens", () => {
  it("keeps node ids as they are", () => {
    expect(resolveCoverageScreens(screens, [{ key: "browse", screens: ["2:2"], criteria: [] }])[0].screens).toEqual(["2:2"]);
  });

  it("resolves a screen named by its number, name or file to its node id", () => {
    const out = resolveCoverageScreens(screens, [
      { key: "licence", screens: ["09", "14"], criteria: ["a"] },
      { key: "payouts", screens: ["09 Creator dashboard"], criteria: [] },
      { key: "browse", screens: ["01-browse-assets.png"], criteria: [] },
      { key: "browse", screens: ["1"], criteria: [] },
    ]);
    expect(out.map((c) => c.screens)).toEqual([["2:90", "2:140"], ["2:90"], ["2:2"], ["2:2"]]);
    expect(out[0].criteria).toEqual(["a"]);
  });

  it("keeps a reference to no screen or to several screens as it was, so the strict check still fails", () => {
    const twins: PlannedScreen[] = [...screens, { name: "09 Creator dashboard (mobile)", nodeId: "3:9", file: "09-mobile.png", requirementKeys: [] }];
    const out = resolveCoverageScreens(twins, [{ key: "licence", screens: ["09", "42", "Checkout"], criteria: [] }]);
    expect(out[0].screens).toEqual(["09", "42", "Checkout"]);
  });
});
