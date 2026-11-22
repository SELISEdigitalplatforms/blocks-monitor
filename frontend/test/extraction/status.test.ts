import { describe, expect, it } from "vitest";
import { extractionStatus, extractionSummary } from "../../src/domain/extractionStatus";

describe("saved attempt status", () => {
  it("current processing supersedes old failed findings", () => {
    expect(extractionStatus({ status: "processing", startedAt: new Date().toISOString() }, { summary: "normalization failed" })).toBe("processing");
  });
  it("a queued source is never inferred to have failed", () => {
    expect(extractionStatus({ sourceType: "pending" }, { summary: "queued" })).toBe("pending");
  });
  it("recognizes legacy failures without labeling empty successful findings as failed", () => {
    expect(extractionStatus({}, { summary: "normalization failed" })).toBe("failed");
    expect(extractionStatus({ status: "ready" }, { summary: "No relevant findings" })).toBe("ready");
  });
  it("ends stale interrupted processing instead of spinning forever", () => {
    expect(extractionStatus({ status: "processing", startedAt: "2026-10-29T10:00:00Z" }, undefined, Date.parse("2026-10-29T10:06:00Z"))).toBe("failed");
  });
});

describe("aggregate analysis state", () => {
  it("stays processing while some files are active, even if other files failed", () => {
    expect(extractionSummary([{ status: "failed" }, { status: "processing" }, { status: "ready" }])).toMatchObject({ status: "processing", active: 1 });
  });
  it("distinguishes mixed terminal results from complete success", () => {
    expect(extractionSummary([{ status: "failed" }, { status: "ready" }]).status).toBe("partial");
    expect(extractionSummary([{ status: "ready" }]).status).toBe("ready");
    expect(extractionSummary([{ status: "failed" }]).status).toBe("failed");
  });
  it("treats queued and unknown states as unfinished, never as success", () => {
    expect(extractionSummary([{ status: "pending" }]).status).toBe("processing");
    expect(extractionSummary([{ status: "unknown" }]).status).toBe("processing");
    expect(extractionSummary([]).status).toBe("empty");
  });
});

// The files card's presentation (plain words per state) is tested in test/understanding/projectUnderstanding.test.ts.
