// Ticket.DependsOn as the web reads it (src/blocks/delivery/types.ts): the client field dependsOn, [] when the row has
// none, a malformed value makes the row unreadable (never guessed into validity).
import { describe, expect, it } from "vitest";
import { TICKET_FIELDS, parseTicket } from "../../src/blocks/delivery/types";
import { checkRowShape } from "../../functions/delivery/ops/rows";

const base = { ItemId: "t3", Number: 3, Title: "Order list", TicketType: "story", FeatureRef: "", AgentRole: "planner", Column: "planned", SortOrder: 0, Description: "", PlanRef: "r1.2", Source: "plan" };

describe("Ticket.DependsOn", () => {
  it("is read with the ticket", () => {
    expect(TICKET_FIELDS).toContain("DependsOn");
  });

  it("maps to dependsOn, [] when missing or null", () => {
    const a = parseTicket({ ...base, DependsOn: ["t1", "t2"] });
    expect(a.ok && a.value.dependsOn).toEqual(["t1", "t2"]);
    const b = parseTicket(base);
    expect(b.ok && b.value.dependsOn).toEqual([]);
    const c = parseTicket({ ...base, DependsOn: null });
    expect(c.ok && c.value.dependsOn).toEqual([]);
  });

  it("drops empty ids, repeats and the ticket itself", () => {
    const a = parseTicket({ ...base, DependsOn: ["t1", "", "t1", "t3"] });
    expect(a.ok && a.value.dependsOn).toEqual(["t1"]);
  });

  it("reports a malformed value as unreadable", () => {
    const a = parseTicket({ ...base, DependsOn: "t1" });
    expect(a.ok).toBe(false);
    const b = parseTicket({ ...base, DependsOn: [1, 2] });
    expect(b.ok).toBe(false);
  });

  it("is a known string list for the delivery ops", () => {
    expect(checkRowShape("Ticket", { DependsOn: ["a", "b"] })).toBeNull();
    expect(checkRowShape("Ticket", { DependsOn: "a" })).toMatch(/wrong type/);
  });
});
