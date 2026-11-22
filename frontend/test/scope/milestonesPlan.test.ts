// The readable milestones of the Scope & delivery plan: delivery order, feature names, plain status, unplaced features.
import { describe, expect, it } from "vitest";
import type { MilestoneRecord } from "../../src/blocks/scope/records";
import { milestonePlan, milestoneStatusWord } from "../../src/components/scope/blocks/MilestonesPlan";

const m = (id: string, number: number, sortOrder: number, refs: string[], status = "planned"): MilestoneRecord =>
  ({ id, number, name: `M${number}`, goal: "", featureRefs: refs, sortOrder, status, scopeVersion: 1, updatedAt: "" });
const features = [
  { ref: "feature:a", name: "Catalogue", priority: "must" as const },
  { ref: "feature:b", name: "Order desk", priority: "must" as const },
  { ref: "feature:c", name: "Delivery windows", priority: "later" as const },
  { ref: "feature:d", name: "Loyalty points", priority: "excluded" as const },
];

describe("milestonePlan", () => {
  it("orders by plan order, names the features and the delivery order", () => {
    const { rows, unplaced } = milestonePlan([m("2", 2, 1, ["feature:b"], "building"), m("1", 1, 0, ["feature:a", "feature:x"])], features);
    expect(rows.map((r) => [r.number, r.order, r.features, r.status.text])).toEqual([
      [1, "First of 2", ["Catalogue"], "Planned"],
      [2, "Second of 2", ["Order desk"], "Being built"],
    ]);
    expect(unplaced).toEqual(["Delivery windows"]);
  });

  it("a single milestone has no 'of n'; statuses read plainly", () => {
    expect(milestonePlan([m("1", 1, 0, [])], []).rows[0]!.order).toBe("First");
    expect(milestoneStatusWord("preview-ready").text).toBe("Preview ready");
    expect(milestoneStatusWord("done").tone).toBe("success");
    expect(milestoneStatusWord("anything").text).toBe("Planned");
  });
});
