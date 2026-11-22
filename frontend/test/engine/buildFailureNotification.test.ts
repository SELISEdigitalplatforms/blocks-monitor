import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import vm from "node:vm";
import type { RawGateway, Row } from "../../functions/_lib/gateway";
import { buildFailureRecipients, createBuildFailureNotifier } from "../../server/local/engine/buildFailureNotification";
import { shapeNotificationRow } from "../../src/domain/notificationEmail";
import { plainJobWrites } from "../../server/local/engine/plainMessages";

const project = { ItemId: "p1", WorkspaceId: "w1", Name: "Demo", Status: "active", ReaderIds: ["owner", "member", "removed"] };
const members = [
  { UserId: "owner", WorkspaceId: "w1", Status: "active" },
  { UserId: "member", WorkspaceId: "w1", Status: "active" },
  { UserId: "removed", WorkspaceId: "w1", Status: "removed" },
  { UserId: "outsider", WorkspaceId: "w1", Status: "active" },
  { UserId: "foreign", WorkspaceId: "w2", Status: "active" },
];
const job = { ItemId: "j1", ProjectId: "p1", Kind: "build.run", Status: "failed", Attempts: 1, FinishedAt: "2026-11-08T00:00:00.000Z", Message: "The build could not finish." };
function setup() {
  const rows: Row[] = [];
  const raw = {
    get: vi.fn(async () => project),
    findAll: vi.fn(async (schema: string) => schema === "Membership" ? members : rows),
    insert: vi.fn(async (_schema: string, row: Row) => { rows.push(row); return { created: true, itemId: "n1" }; }),
  } as unknown as RawGateway;
  const email = vi.fn(async (id: string): Promise<string | null> => `${id}@example.org`);
  return { rows, raw, email, notify: createBuildFailureNotifier(raw, email) };
}
describe("build failure alerts", () => {
  it("uses active project readers and excludes outsiders and removed members", () => {
    expect(buildFailureRecipients(project, members)).toEqual(["owner", "member"]);
    expect(buildFailureRecipients({ ...project, ReaderIds: [] }, members)).toEqual([]);
  });
  it.each(["build.run", "change.build"])("creates emails once for %s and permits a new failed retry", async Kind => {
    const s = setup();
    await s.notify({ ...job, Kind });
    await s.notify({ ...job, Kind });
    expect(s.rows).toHaveLength(2);
    const row = s.rows[0];
    const shape = shapeNotificationRow(row, "https://factory.example.org");
    expect(shape.email).toBe(true);
    expect(shape.to).toBe("owner@example.org");
    expect(shape.body.link).toBe("https://factory.example.org/p/p1/build");
    // The persisted workflow and local mail renderer must shape the same alert.
    const workflow = JSON.parse(fs.readFileSync("blocks/logic/workflows/mf-doorbell.json", "utf8"));
    const script = workflow.nodes.find((n: { name: string }) => n.name === "Shape").parameters.script;
    const send = workflow.nodes.find((n: { name: string }) => n.name === "Send mf-build-failed");
    expect(send.parameters.Template).toBe(shape.template);
    expect(Object.keys(send.parameters.BodyDataContext)).toEqual(Object.keys(shape.body));
    expect(workflow.edges.some((e: { target: string; sourceHandle: string }) => e.target === send.id && e.sourceHandle === "if-true")).toBe(true);
    const actual = vm.runInNewContext(`(function(){${script}})()`, { $json: row });
    expect(JSON.parse(JSON.stringify(actual))).toEqual(shapeNotificationRow(row, "__APP_URL__"));
    s.rows.length = 0;
    await s.notify({ ...job, Kind, Attempts: 2, FinishedAt: "2026-11-08T01:00:00.000Z" });
    expect(s.rows[0].EventKey).not.toEqual(row.EventKey);
  });
  it("ignores other jobs, successes, and cancellations", async () => {
    const s = setup();
    for (const patch of [{ Kind: "scope.draft" }, { Status: "succeeded" }, { Status: "cancelled" }]) await s.notify({ ...job, ...patch });
    expect(s.raw.get).not.toHaveBeenCalled();
  });
  it("runs after the failure is saved and preserves it when alert creation fails", async () => {
    let saved: Row = { ...job, Status: "running" };
    const onFailed = vi.fn(async () => { throw new Error("mail unavailable"); });
    const raw = { update: vi.fn(async (_s: string, _id: string, patch: Row) => { saved = { ...saved, ...patch }; }) } as unknown as RawGateway;
    const wrapped = plainJobWrites(raw, { job: () => saved, log: vi.fn(), onFailed });
    await expect(wrapped.update("EngineJob", "j1", { Status: "failed" })).resolves.toBeUndefined();
    expect(saved.Status).toBe("failed");
    expect(onFailed).toHaveBeenCalledWith(saved);
  });
  it("does not alert when a conditional write lost to cancellation", async () => {
    const onFailed = vi.fn();
    const raw = { update: vi.fn(async () => {}) } as unknown as RawGateway;
    const wrapped = plainJobWrites(raw, { job: () => ({ ...job, Status: "cancelled" }), log: vi.fn(), onFailed });
    await wrapped.update("EngineJob", "j1", { Status: "failed" });
    expect(onFailed).not.toHaveBeenCalled();
  });
  it("writes the in-app alert without the e-mail when IAM refuses the lookup (403), and settles the failure", async () => {
    const s = setup();
    const log = vi.fn();
    const notify = createBuildFailureNotifier(s.raw, s.email, { log });
    s.email.mockImplementationOnce(async () => "owner@example.org").mockRejectedValueOnce(new Error("IAM lookup failed"));
    await expect(notify(job)).resolves.toBeUndefined();
    expect(s.rows).toHaveLength(2);
    const [owner, member] = s.rows;
    expect(owner).toMatchObject({ RecipientUserId: "owner", EmailStatus: "pending", Kind: "job.failed" });
    expect(JSON.parse(String(owner.ParamsJson)).emailTo).toBe("owner@example.org");
    expect(member).toMatchObject({ RecipientUserId: "member", EmailStatus: "none", Kind: "job.failed", IsRead: false, Link: "/p/p1/build" });
    const params = JSON.parse(String(member.ParamsJson));
    expect(params).not.toHaveProperty("emailTo");
    expect(params).toMatchObject({ projectId: "p1", projectName: "Demo", jobKind: "build.run", failure: "The build could not finish." });
    expect(member.RequestKey).toBeTruthy();
    expect(member.RequestKey).not.toEqual(owner.RequestKey);
    // the bell rings, no e-mail is sent
    expect(shapeNotificationRow(member, "https://factory.example.org")).toMatchObject({ ring: true, email: false, to: "" });
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/in-app only for 1 person.*IAM lookup failed/);
    // the reconciliation's next passes read nothing more and never fail again
    const reads = (s.raw.get as ReturnType<typeof vi.fn>).mock.calls.length;
    for (let i = 0; i < 3; i++) await expect(notify(job)).resolves.toBeUndefined();
    expect((s.raw.get as ReturnType<typeof vi.fn>).mock.calls.length).toBe(reads);
    expect(s.email).toHaveBeenCalledTimes(2);
    expect(s.rows).toHaveLength(2);
  });
  it("writes every alert in-app only while IAM user reads are refused", async () => {
    const s = setup();
    s.email.mockRejectedValue(new Error("403 Forbidden"));
    await s.notify(job);
    expect(s.rows.map((r) => [r.RecipientUserId, r.EmailStatus])).toEqual([["owner", "none"], ["member", "none"]]);
  });
  it("writes the in-app alert for a user without a usable address, and for a second user with the same address", async () => {
    const s = setup();
    s.email.mockResolvedValueOnce(null).mockResolvedValueOnce("not an address");
    await s.notify(job);
    expect(s.rows.map((r) => r.EmailStatus)).toEqual(["none", "none"]);
    const t = setup();
    t.email.mockResolvedValue("shared@example.org");
    await t.notify(job);
    expect(t.rows.map((r) => r.EmailStatus)).toEqual(["pending", "none"]);
  });
  it("after a restart, reads the written alerts once and adds none twice", async () => {
    const s = setup();
    s.email.mockRejectedValue(new Error("IAM lookup failed"));
    await s.notify(job);
    const again = createBuildFailureNotifier(s.raw, s.email);
    await again(job);
    expect(s.rows).toHaveLength(2);
  });
  it("throws when an alert cannot be written, so the reconciliation writes what is missing next time", async () => {
    const s = setup();
    const insert = s.raw.insert as ReturnType<typeof vi.fn>;
    const write = insert.getMockImplementation()!;
    insert.mockImplementationOnce(write).mockRejectedValueOnce(new Error("gateway unavailable"));
    await expect(s.notify(job)).rejects.toThrow("gateway unavailable");
    expect(s.rows).toHaveLength(1);
    await s.notify(job);
    expect(s.rows.map((r) => r.RecipientUserId)).toEqual(["owner", "member"]);
  });
});
