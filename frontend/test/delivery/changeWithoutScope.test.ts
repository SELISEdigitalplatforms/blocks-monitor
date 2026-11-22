import { describe, expect, it } from "vitest";
import { checkChangeDraft } from "../../src/domain/delivery";

describe("a change request on a product without a locked scope", () => {
  const draft = { lane: "change", featureRef: "", title: "Rename a button", description: "The button reads differently." };

  it("is about the product as a whole when the project has no features (an existing product attached as live)", () => {
    expect(checkChangeDraft(draft, []).ok).toBe(true);
    expect(checkChangeDraft({ ...draft, lane: "enhance" }, []).ok).toBe(true);
  });

  it("still names its feature when the project has a locked scope", () => {
    const r = checkChangeDraft(draft, ["feature:checkout"]);
    expect(r.ok).toBe(false);
    expect(checkChangeDraft({ ...draft, featureRef: "feature:checkout" }, ["feature:checkout"]).ok).toBe(true);
    expect(checkChangeDraft({ ...draft, featureRef: "feature:other" }, ["feature:checkout"]).ok).toBe(false);
  });
});
