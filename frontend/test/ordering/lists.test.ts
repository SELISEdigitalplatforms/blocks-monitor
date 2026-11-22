// Newest first in the project's own lists: change requests (a number is given at creation, so the highest is the newest),
// a milestone's feedback tickets, the requirement suggestions (the open ones first, each group newest first).
//   npx vitest run --config test/ordering/vitest.config.ts test/ordering/lists.test.ts
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { byNewestNumber } from "@/lib/newest";
import { changesKeptForScope } from "@/components/changes/ScopeChangesWaiting";
import { ChangeRequestsCard } from "@/components/build/ChangesOverview";
import { feedbackOf } from "@/components/build/MilestoneReview";
import { selectSuggestions } from "@/blocks/requirements/hooks";
import type { DeliveryTicket } from "@/blocks/delivery/types";
import { FEATURE, cr } from "../changes/fixtures";

describe("change requests", () => {
  const list = [
    cr({ id: "c3", number: 3, title: "Third" }),
    cr({ id: "c1", number: 1, title: "First" }),
    cr({ id: "c12", number: 12, title: "Twelfth" }),
    cr({ id: "c7", number: 7, title: "Seventh" }),
  ];

  it("byNewestNumber puts the highest number (the newest request) on top", () => {
    expect(byNewestNumber(list, (c) => c.number).map((c) => c.number)).toEqual([12, 7, 3, 1]);
  });

  it("the Build page's list of all change requests shows CR-012 first", () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ChangeRequestsCard, { projectId: "p-asset", changes: list, tickets: [], jobs: [] })));
    const at = (code: string) => html.indexOf(code);
    expect(at("CR-012")).toBeGreaterThan(-1);
    expect(at("CR-012")).toBeLessThan(at("CR-007"));
    expect(at("CR-007")).toBeLessThan(at("CR-003"));
    expect(at("CR-003")).toBeLessThan(at("CR-001"));
  });

  it("the changes kept for Scope & success list the newest first", () => {
    const kept = [2, 9, 5].map((n) => cr({ id: `k${n}`, number: n, status: "approved", analysisValue: FEATURE }));
    expect(changesKeptForScope([...kept, cr({ id: "x", number: 11 })]).map((c) => c.number)).toEqual([9, 5, 2]);
  });
});

describe("a milestone's feedback", () => {
  it("lists the newest feedback ticket first", () => {
    const ticket = (id: string, number: number, milestoneId = "m1", source = "feedback") => ({ id, number, milestoneId, source, column: "planned" }) as unknown as DeliveryTicket;
    const tickets = [ticket("a", 4), ticket("b", 9), ticket("c", 6, "m2"), ticket("d", 2), ticket("e", 12, "m1", "plan")];
    expect(feedbackOf(tickets, "m1").map((t) => t.number)).toEqual([9, 4, 2]);
  });
});

describe("requirement suggestions", () => {
  it("keeps the open ones first, each group newest first, the same time by title", () => {
    const row = (id: string, title: string, status: string, at: string) => ({ ItemId: id, Title: title, Status: status, CreatedDate: at });
    const rows = [
      row("s1", "Bravo", "open", "2026-11-01T10:00:00Z"),
      row("s2", "Alpha", "accepted", "2026-11-09T10:00:00Z"),
      row("s3", "Delta", "open", "2026-11-08T10:00:00Z"),
      row("s4", "Charlie", "open", "2026-11-01T10:00:00Z"),
      row("s5", "Echo", "dismissed", "2026-11-02T10:00:00Z"),
    ];
    expect(selectSuggestions(rows).map((s) => s.id)).toEqual(["s3", "s1", "s4", "s2", "s5"]);
  });
});
