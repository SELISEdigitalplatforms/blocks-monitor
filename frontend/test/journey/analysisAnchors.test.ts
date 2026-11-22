// Business Analysis (owner approved 08.11.2026): an address's anchor opens the matching part of the page, including the
// former steps' addresses (/p/:id/<step> lands on /p/:id/analysis#<step>).
import { describe, expect, it } from "vitest";
import { anchorTarget } from "../../src/pages/AnalysisNext";
import { DOC_PARTS } from "../../src/components/analysis-next/model";

describe("Business Analysis anchors", () => {
  it("opens the part a former step became", () => {
    expect(anchorTarget("#understanding")).toEqual({ part: "understood" });
    expect(anchorTarget("#sanitization")).toEqual({ part: "understood", item: "questions" });
    expect(anchorTarget("#requirements")).toEqual({ part: "features" });
    expect(anchorTarget("#scope")).toEqual({ part: "scope" });
  });
  it("opens a part by its own id", () => {
    for (const part of DOC_PARTS) expect(anchorTarget(`#${part}`)).toEqual({ part });
    expect(anchorTarget("objective")).toEqual({ part: "objective" });
  });
  it("ignores anything else", () => {
    for (const h of ["", "#", "#board", "#constructor", "#part-objective", "#Scope"]) expect(anchorTarget(h)).toBeNull();
  });
});
