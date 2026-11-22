// Newest first in the platform's paged tables: the server reads each page sorted by the date field, so the newest
// organizations come first even when only one page is read.
//   npx vitest run --config test/ordering/vitest.config.ts test/ordering/platformLists.test.ts
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedRow } from "../../functions/_lib/testing";
import { ADMIN_DEFS } from "../../functions/admin/ops";

const SUPER = { userId: "super-1", email: "super@example.org", roles: ["mf-user", "mf-super-admin"] };

describe("Platform · Organizations", () => {
  it("lists the newest organization first", async () => {
    const gateway = memoryGateway();
    const org = (name: string, at: string) => seedRow(gateway, "Workspace", { WorkspaceId: name, ReaderIds: [], Name: name, Status: "active", CreatedDate: at });
    org("Alpine", "2026-03-01T09:00:00.000Z");
    org("Zenith", "2026-11-10T09:00:00.000Z");
    org("Harbor", "2026-07-15T09:00:00.000Z");
    seedRow(gateway, "Account", { UserId: SUPER.userId, Email: SUPER.email, Status: "active" });
    const res = await runOp("admin", ADMIN_DEFS, { ctx: fakeCtx(SUPER), gateway, request: { op: "workspace.list", args: {}, requestId: randomUUID() } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as { data: { items: { name: string }[] } }).data.items.map((w) => w.name)).toEqual(["Zenith", "Harbor", "Alpine"]);
  });
});
