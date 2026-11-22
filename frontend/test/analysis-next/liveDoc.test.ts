/** Business Analysis of an existing product attached as it is live (PrimaBook): the parts show what was written down
 *  from the live product, labelled "From the live product" with when, or say honestly that nothing is written down yet
 *  with the action that does it; the action is offered only when the server would accept it. */
import { describe, expect, it } from "vitest";
import {
  LIVE_SECTIONS, liveSectionsText, liveSectionStatus, LIVE_TEXT, canStartDocumentation, designSystemLine, documentBlockedText, documentButton, documentedChip, jobFacts, leftEmptyFor, liveNextAction,
  livePartSummary, runningLine, type LiveDocFacts,
} from "../../src/components/analysis-next/live/liveDoc";
import { PART_STATUS_LABEL, readiness, type PartSummary } from "../../src/components/analysis-next/model";
import { DOC_PARTS } from "../../src/components/analysis/model";
import { featuresSummary, filesSummary, objectiveSummary, understoodSummary, workflowsSummary } from "../../src/components/analysis-next/parts/brief/summaries";
import type { EngineJob } from "../../src/blocks/engine/types";

const facts = (o: Partial<LiveDocFacts> = {}): LiveDocFacts => ({
  documentedAt: null, running: null, stopped: false, canDocument: true, refusal: null, leftEmpty: [], loading: false, ...o,
});
const AT = "2026-11-09T01:40:00.000Z";

/** PrimaBook's nine rows before any documentation (the raw rules say "Not used" for every empty part). */
const known = { files: new Map<string, string>(), answers: new Set<string>() };
const files = (n: number) => Array.from({ length: n }, (_, i) => ({ fileId: `f${i}`, name: `file-${i}.md`, status: "ready", observationCount: 1, requirementCount: 0, summary: "" }));
function primaBookRows(o: { objective?: string; requirements?: number } = {}): PartSummary[] {
  const live = true;
  const reqs = Array.from({ length: o.requirements ?? 0 }, (_, i) => ({ id: `r${i}`, title: `Module ${i}`, priority: "must", criteria: ["works"], status: "confirmed", sourceRefs: [`live-product:web:src/pages/m${i}`] }));
  const empty = (id: PartSummary["id"]): PartSummary => ({ id, status: "skipped", summary: "Not part of this project: it came to the Factory as a live product.", fingerprint: "skipped" });
  return [
    understoodSummary({ open: true, loading: false, signed: true, canAct: true, about: "", objective: "", users: "", conflictsOpen: 0, toCheck: 0, reading: 0, filesRead: 12, changes: [], live, sources: [], content: 1 }),
    filesSummary({ open: true, loading: false, error: false, signed: true, canAct: true, files: files(12), live }),
    objectiveSummary({ open: true, loading: false, approved: true, canAct: false, text: o.objective ?? "", criteria: [], origin: null, drafting: false, live }),
    featuresSummary({ open: true, loading: false, approved: true, canAct: false, requirements: reqs, openSuggestions: 0, known, drafting: false, live }),
    workflowsSummary({ open: true, loading: false, approved: true, items: [], drafting: false, live }),
    empty("scope"), empty("screens"), empty("milestones"), empty("success"),
  ];
}

describe("the parts of a live product", () => {
  it("say honestly that nothing is written down yet, never 'Not used' or 'Confirmed', before any documentation", () => {
    const rows = primaBookRows().map((r) => livePartSummary(r, facts()));
    expect(rows.map((r) => r.id)).toEqual([...DOC_PARTS]);
    for (const r of rows.filter((x) => x.id !== "files")) {
      expect(r.status, r.id).toBe("undocumented");
      expect(r.summary, r.id).toBe(LIVE_TEXT.emptyPart);
      expect(r.summary, r.id).not.toMatch(/came to the Factory|Not used/);
    }
    expect(PART_STATUS_LABEL.undocumented).toBe("Not documented yet");
    // the files are the person's own material and keep their words
    expect(rows[1]).toMatchObject({ status: "confirmed", summary: "12 files read" });
  });

  it("without the right (or when the server would refuse) the rows never invite an action", () => {
    for (const f of [facts({ canDocument: false }), facts({ refusal: "notLive" })]) {
      const row = livePartSummary(primaBookRows()[2], f);
      expect(row.summary).toBe(LIVE_TEXT.emptyPartNoRight);
    }
  });

  it("while the documentation runs, the empty parts say they are being written down", () => {
    const row = livePartSummary(primaBookRows()[3], facts({ running: { progress: 40, message: null } }));
    expect(row).toMatchObject({ status: "undocumented", summary: LIVE_TEXT.writing });
  });

  it("once documented, a part with content reads 'From the live product' with the date, and no issues", () => {
    const raw = primaBookRows({ objective: "Swiss accounting for small firms. More text.", requirements: 9 });
    const rows = raw.map((r) => livePartSummary(r, facts({ documentedAt: AT })));
    const objective = rows[2];
    expect(objective.status).toBe("documented");
    expect(PART_STATUS_LABEL[objective.status]).toBe("From the live product");
    expect(objective.summary).toBe("Swiss accounting for small firms");
    expect(objective.sources).toEqual([documentedChip(AT)]);
    expect(documentedChip(AT)).toMatch(/^Documented \d{1,2} Nov 2026, \d{2}:\d{2}$/);
    expect(objective.issues).toBeUndefined();
    expect(rows[3]).toMatchObject({ status: "documented", summary: "9 master features" });
    // nothing a documentation writes counts as an analysis to be ready for
    expect(readiness(rows)).toEqual({ ready: 1, total: 1, needsYou: 0 });
  });

  it("once documented, a part nothing was found for says so plainly (the snapshot's own sentence when it has one)", () => {
    const f = facts({ documentedAt: AT, leftEmpty: ["The goal: no source states it.", "The success targets: no source states them."] });
    const rows = primaBookRows().map((r) => livePartSummary(r, f));
    expect(rows[0]).toMatchObject({ status: "skipped", summary: "The goal: no source states it." });
    expect(rows[8]).toMatchObject({ status: "skipped", summary: "The success targets: no source states them." });
    expect(rows[4]).toMatchObject({ status: "skipped", summary: LIVE_TEXT.nothingFound });
    expect(leftEmptyFor("files", f.leftEmpty)).toBeNull();
  });

  it("leaves every other project's rows exactly as they are", () => {
    const row = primaBookRows()[2];
    expect(livePartSummary(row, null)).toBe(row);
    const loading: PartSummary = { id: "objective", status: "draft", summary: "Opening…", fingerprint: "x", loading: true };
    expect(livePartSummary(loading, facts())).toBe(loading);
  });
});

describe("Next for you on a live product", () => {
  it("offers to document it while nothing is written down", () => {
    const a = liveNextAction(facts());
    expect(a).toMatchObject({ title: "Document the live product", button: "Document from the live product", action: "document", item: null });
    expect(a.blockedBecause).toBeUndefined();
  });

  it("says who does it, or why it can't be done, instead of a button the server would refuse", () => {
    expect(liveNextAction(facts({ canDocument: false })).blockedBecause).toBe(LIVE_TEXT.team);
    expect(liveNextAction(facts({ refusal: "notLive" })).blockedBecause).toBe("The product is documented once it is live: no release is recorded yet.");
    expect(liveNextAction(facts({ refusal: "paused" })).blockedBecause).toBe("Resume the project before it is documented.");
    expect(canStartDocumentation(facts({ refusal: "notLive" }))).toBe(false);
    expect(documentBlockedText(facts())).toBeNull();
  });

  it("shows the job's progress like other jobs while it runs, with no button", () => {
    const a = liveNextAction(facts({ running: { progress: 60, message: "Writing the objective and the requirements, one per module." } }));
    expect(a).toMatchObject({ working: true, button: null });
    expect(a.detail).toBe("Writing the objective and the requirements, one per module (60%).");
    expect(runningLine({ progress: 0, message: null })).toBe("Reading the product's code and documents.");
    expect(canStartDocumentation(facts({ running: { progress: 1, message: null } }))).toBe(false);
  });

  it("offers it again when the last run stopped, and is calm once it is documented", () => {
    expect(liveNextAction(facts({ stopped: true, documentedAt: AT }))).toMatchObject({ title: "The documentation stopped", button: "Refresh from the live product", action: "document" });
    const done = liveNextAction(facts({ documentedAt: AT }));
    expect(done).toMatchObject({ title: "All written down", button: null });
    expect(done.detail).toMatch(/^Documented from the live product on \d{1,2} Nov 2026, \d{2}:\d{2}\. To change the product, request a change or a new feature\.$/);
    expect(documentButton(facts())).toBe("Document from the live product");
    expect(documentButton(facts({ documentedAt: AT }))).toBe("Refresh from the live product");
  });

  it("never names AI, never shouts", () => {
    const all = [facts(), facts({ canDocument: false }), facts({ running: { progress: 5, message: null } }), facts({ stopped: true }), facts({ documentedAt: AT })].map(liveNextAction);
    for (const a of all) for (const t of [a.title, a.detail, a.button ?? "", a.blockedBecause ?? ""]) {
      expect(t).not.toMatch(/\bAI\b|artificial|magic|!/);
    }
  });
});

describe("the documentation job's state", () => {
  const job = (o: Partial<EngineJob>): EngineJob => ({
    id: "j", workspaceId: "w", projectId: "p", kind: "product.document", status: "succeeded", inputJson: null, outputRefs: [], progress: 100,
    message: null, errorCode: null, attempts: 1, claimedBy: null, claimedAt: null, finishedAt: null, createdBy: null, createdAt: "2026-11-09T01:00:00Z", updatedAt: null, ...o,
  });

  it("is running while the newest job is queued, claimed or running", () => {
    expect(jobFacts([job({ status: "running", progress: 30, message: "Reading" })], null)).toEqual({ running: { progress: 30, message: "Reading" }, stopped: false });
    expect(jobFacts([], null)).toEqual({ running: null, stopped: false });
  });

  it("stopped only when the newest job failed or was cancelled after the last documentation", () => {
    expect(jobFacts([job({ status: "failed", finishedAt: "2026-11-09T02:00:00Z" })], AT).stopped).toBe(true);
    expect(jobFacts([job({ status: "cancelled", finishedAt: "2026-11-09T01:10:00Z" })], AT).stopped).toBe(false);
    expect(jobFacts([job({ status: "failed" })], null).stopped).toBe(true);
    expect(jobFacts([job({ status: "succeeded" })], AT).stopped).toBe(false);
    // another kind never counts
    expect(jobFacts([job({ kind: "wiki.generate", status: "failed" })], null)).toEqual({ running: null, stopped: false });
  });
});

describe("the existing design system", () => {
  it("is named plainly in the Look & feel row", () => {
    expect(designSystemLine({
      provider: "existing-system", version: 1, repo: "web", files: ["src/styles/tokens.css"],
      themes: [{ id: "teal", name: "Teal", color: "#138086" }, { id: "blue", name: "Blue", color: "#2457f5" }],
      colors: {}, fonts: ["Plus Jakarta Sans"], modes: ["light", "dark"], radius: {},
    })).toBe("The existing design system · 2 colour themes · Plus Jakarta Sans · light and dark");
  });
});

describe("the detailed pages of a live product (Show them)", () => {
  it("hold every part of the main view exactly once, and no questions section", () => {
    const all = LIVE_SECTIONS.flatMap((s) => s.parts);
    expect([...all].sort()).toEqual([...DOC_PARTS].sort());
    expect(new Set(all).size).toBe(all.length);
    expect(LIVE_SECTIONS.map((s) => s.id)).toEqual(["understanding", "requirements", "scope"]);
  });

  it("never say more in a section header than its parts do", () => {
    const rows = primaBookRows().map((r) => livePartSummary(r, facts()));
    const statusOf = (id: string) => liveSectionStatus(LIVE_SECTIONS.find((s) => s.id === id)!.parts.map((p) => rows.find((r) => r.id === p)!));
    // before any documentation: never "Done", "Requirements approved" or "Scope locked" over nothing
    expect(statusOf("understanding")).toBe("undocumented");
    expect(statusOf("requirements")).toBe("undocumented");
    expect(statusOf("scope")).toBe("undocumented");
    const after = primaBookRows({ objective: "Accounting.", requirements: 3 }).map((r) => livePartSummary(r, facts({ documentedAt: AT })));
    const req = liveSectionStatus(["objective", "features", "workflows"].map((p) => after.find((r) => r.id === p)!));
    expect(req).toBe("documented");
    expect(liveSectionStatus([{ status: "skipped" }, { status: "skipped" }])).toBe("skipped");
    expect(liveSectionStatus([{ status: "confirmed" }, { status: "skipped" }])).toBe("confirmed");
    expect(liveSectionsText(true)).toMatch(/as they were written down from it/);
    // before any documentation it never claims parts were written down
    expect(liveSectionsText(false)).not.toMatch(/were written down/);
  });
});
