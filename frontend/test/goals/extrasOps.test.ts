// extra.save / extra.remove / extra.move through the real router: the setup answers imported at the first edit (once),
// create / edit / restore, the soft remove, moves, the open step and the permission.
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedProject, seedWorkspace } from "../../functions/_lib/testing";
import { REQUIREMENT_EXTRA_OPS } from "../../functions/project/ops/requirements/extras";
import { EXTRA_SCHEMA } from "../../src/domain/requirementsExtras";

const ME = { userId: "member-1", email: "sandra.keller@selisegroup.com", displayName: "Sandra Keller" };
const VIEWER = { userId: "viewer-1", email: "jonas.meier@alpine-fresh.ch" };

function setup(o: { stage?: string; setup?: boolean } = {}) {
  const gateway = memoryGateway();
  const { workspaceId } = seedWorkspace(gateway, { members: [{ ...ME, roleKey: "member" }, { ...VIEWER, roleKey: "viewer" }] });
  const { projectId } = seedProject(gateway, {
    workspaceId, CreatedByUserId: ME.userId, Stage: o.stage ?? "requirements",
    ...(o.setup === false ? {} : {
      SetupWorkflows: JSON.stringify(["Buyer: opens last week's order → sends it before 10:00"]),
      SetupExclusions: JSON.stringify(["Online payment"]),
      SetupConstraints: JSON.stringify([{ kind: "deadline", text: "Live before March" }, { kind: "languages", text: "German and French" }]),
    }),
  });
  const call = (op: string, args: Record<string, unknown>, who: { userId: string; email: string } = ME) =>
    runOp("project", REQUIREMENT_EXTRA_OPS, { ctx: fakeCtx(who), gateway, request: { op, args: { projectId, ...args } } });
  const rows = () => gateway.rows(EXTRA_SCHEMA).filter((r) => r.ProjectId === projectId).sort((a, b) => String(a.Kind).localeCompare(String(b.Kind)) || Number(a.SortOrder) - Number(b.SortOrder));
  const live = (kind: string) => rows().filter((r) => r.Kind === kind && r.Status !== "removed").map((r) => r.Title);
  return { call, rows, live, workspaceId };
}

describe("extra.save", () => {
  it("the first edit imports the setup answers once, then edits the item a setup id names", async () => {
    const { call, rows, live, workspaceId } = setup();
    const res = await call("extra.save", { id: "setup:exclusion:1", kind: "exclusion", title: "Online payment: invoices stay as they are" });
    expect(res.status).toBe(200);
    expect(rows()).toHaveLength(4);
    expect(live("exclusion")).toEqual(["Online payment: invoices stay as they are"]);
    expect(live("workflow")).toEqual(["Buyer: Opens last week's order"]);
    expect(rows().find((r) => r.Kind === "workflow")).toMatchObject({ Who: "Buyer", Steps: ["Opens last week's order", "Sends it before 10:00"], Origin: "setup" });
    expect(rows().every((r) => r.WorkspaceId === workspaceId && Array.isArray(r.ReaderIds) && (r.ReaderIds as string[]).includes(ME.userId))).toBe(true);
    // the answer carries the imported rows, so the page shows them at once
    expect(res.body.data.changed.RequirementExtra).toHaveLength(4);
    // a second edit imports nothing again
    await call("extra.save", { clientKey: "new-item-0001", kind: "constraint", constraintKind: "budget", title: "About CHF 90 000" });
    expect(rows()).toHaveLength(5);
  });

  it("creates once per clientKey (a double submit finds the first row) and edits by id", async () => {
    const { call, rows, live } = setup({ setup: false });
    const a = await call("extra.save", { clientKey: "client-key-0001", kind: "workflow", title: "Approve leave", who: "Team lead", steps: ["Ask", "Approve"] });
    const b = await call("extra.save", { clientKey: "client-key-0001", kind: "workflow", title: "Approve leave", who: "Team lead", steps: ["Ask", "Approve"] });
    expect(a.status).toBe(200);
    expect(b.body.data.extra.ItemId).toBe(a.body.data.extra.ItemId);
    expect(rows()).toHaveLength(1);
    await call("extra.save", { id: a.body.data.extra.ItemId, kind: "workflow", title: "Approve a leave request", who: "Team lead", steps: ["Ask", "Approve", "Payroll sees it"] });
    expect(live("workflow")).toEqual(["Approve a leave request"]);
    expect(rows()[0]).toMatchObject({ Steps: ["Ask", "Approve", "Payroll sees it"], Origin: "person" });
  });

  it("refuses a wrong kind, missing words, a closed step and a viewer", async () => {
    const { call } = setup({ setup: false });
    const made = await call("extra.save", { clientKey: "client-key-0002", kind: "exclusion", title: "No app" });
    expect((await call("extra.save", { id: made.body.data.extra.ItemId, kind: "workflow", title: "x" })).body).toMatchObject({ error: { code: "invalid_input" } });
    expect((await call("extra.save", { clientKey: "client-key-0003", kind: "constraint", constraintKind: "other", title: " " })).body).toMatchObject({ error: { code: "invalid_input" } });
    expect((await call("extra.save", { clientKey: "client-key-0004", kind: "exclusion", title: "x" }, VIEWER)).status).toBe(403);
    const closed = setup({ stage: "scope", setup: false });
    expect((await closed.call("extra.save", { clientKey: "client-key-0005", kind: "exclusion", title: "x" })).body).toMatchObject({ error: { code: "conflict", messageKey: "requirements.closed" } });
  });
});

describe("extra.remove and extra.move", () => {
  it("removes softly, restores, and moves within a kind", async () => {
    const { call, rows, live } = setup();
    const removed = await call("extra.remove", { id: "setup:constraint:1" });
    expect(removed.status).toBe(200);
    expect(live("constraint")).toEqual(["German and French"]);
    const id = removed.body.data.extra.ItemId;
    await call("extra.save", { id, kind: "constraint", restore: true });
    expect(live("constraint")).toEqual(["Live before March", "German and French"]);
    const second = rows().find((r) => r.Title === "German and French")!.ItemId as string;
    const moved = await call("extra.move", { id: second, dir: -1 });
    expect(moved.status).toBe(200);
    expect(live("constraint")).toEqual(["German and French", "Live before March"]);
    // moving past the end changes nothing
    await call("extra.move", { id: second, dir: -1 });
    expect(live("constraint")).toEqual(["German and French", "Live before March"]);
  });
});
