import { describe, expect, it } from "vitest";
import { answerFields, optimisticRow, withPending } from "./optimisticAnswer";

const open = { ItemId: "c1", Number: 1, Status: "open", Answer: null, DeferReason: null, AnsweredByUserId: null, AnsweredAt: null, LastUpdatedDate: "2026-10-31T10:00:00Z", Question: "How many days?" };

describe("optimisticRow", () => {
  it("answers the question with the text, the person and the time", () => {
    const r = optimisticRow(open, { kind: "answer", text: "2 working days" }, "u1", "2026-10-31T13:10:00Z");
    expect(r).toMatchObject({ Status: "answered", Answer: "2 working days", AnsweredByUserId: "u1", AnsweredAt: "2026-10-31T13:10:00Z", DeferReason: null });
    expect(r.Question).toBe("How many days?");
    expect(r.LastUpdatedDate).toBe(open.LastUpdatedDate);
  });
  it("sets the question aside with the reason", () => {
    const r = optimisticRow(open, { kind: "defer", reason: "Not sure" }, "u1", "2026-10-31T13:10:00Z");
    expect(r).toMatchObject({ Status: "deferred", DeferReason: "Not sure", Answer: null });
  });
});

describe("withPending", () => {
  it("keeps the same rows when nothing is being written", () => {
    const rows = [open];
    expect(withPending(rows, new Map())).toBe(rows);
  });
  it("lays only the answer over the row, keeping newer fields", () => {
    const pending = new Map([["c1", optimisticRow(open, { kind: "answer", text: "Yes" }, "u1", "t")]]);
    const fresh = { ...open, Question: "How many working days?" };
    const [r] = withPending([fresh], pending);
    expect(r).toMatchObject({ Status: "answered", Answer: "Yes", Question: "How many working days?" });
  });
});

describe("answerFields", () => {
  it("picks the fields an answer changes, nothing else", () => {
    expect(Object.keys(answerFields(open)).sort()).toEqual(["Answer", "AnsweredAt", "AnsweredByUserId", "DeferReason", "Status"]);
  });
});
