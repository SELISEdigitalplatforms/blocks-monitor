// Stale data (audit 12.11.2026): writes and finished work refresh every screen that shows what they changed, and the
// screens that poll do so at a pace that follows the work instead of a fixed few seconds for as long as they are open.
//   npx vitest run --config test/project/vitest.config.ts test/project/staleData.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { arrivalKeys } from "../../src/blocks/realtime/refresh";
import { deliveryMutationConfig } from "../../src/blocks/delivery/actions";
import { deliveryProjectKey } from "../../src/blocks/delivery/context";
import { scopeProjectKey } from "../../src/blocks/scope/context";
import { putRows } from "../../src/blocks/projects/mutations";
import { queryClient } from "../../src/blocks/queryClient";
import { blocksKeys } from "../../src/blocks/data/keys";
import { designContextKey } from "../../src/blocks/requirements/designContext";
import { useWorkspaces } from "../../src/blocks/workspaces/store";
import { canNow } from "../../src/state/workspaces";
import { BRIEF_BUSY_MS, BRIEF_IDLE_MS, briefRefetchInterval } from "../../src/components/analysis/doc/briefQuery";
import { LANDING_FAST_FOR_MS, LANDING_FAST_MS, LANDING_SLOW_MS, landingPollMs } from "../../src/components/requirements/LandingPageSection";
import type { BellItem } from "../../src/blocks/workspaces/bell";

const WS = "ws-1";
const P = "p-1";
const keyText = (keys: readonly (readonly unknown[])[]) => keys.map((k) => JSON.stringify(k));
const bell = (kind: string, params: Record<string, unknown> = {}): BellItem =>
  ({ id: "n1", kind, workspaceId: WS, params, read: false } as unknown as BellItem);

afterEach(() => queryClient.clear());

describe("a new bell item refreshes what changed", () => {
  it("build.started: the project (its stage) and the private project keys of Scope and Build", () => {
    const keys = keyText(arrivalKeys(bell("build.started"), WS, "u1"));
    expect(keys).toContain(JSON.stringify(blocksKeys.schema(WS, "Project")));
    expect(keys).toContain(JSON.stringify(["delivery", "project"]));
    expect(keys).toContain(JSON.stringify(["scope", "project"]));
  });
  it("a finished build: what the job list reads again too (ticket moves, milestones, the project), not only its outputs", () => {
    const keys = keyText(arrivalKeys(bell("job.succeeded", { jobKind: "build.run" }), WS, "u1"));
    for (const s of ["EngineJob", "TicketEvent", "Milestone", "Project"]) expect(keys).toContain(JSON.stringify(blocksKeys.schema(WS, s)));
  });
  it("release.created: the milestone and the project the build moved", () => {
    const keys = keyText(arrivalKeys(bell("release.created"), WS, "u1"));
    expect(keys).toContain(JSON.stringify(blocksKeys.schema(WS, "Milestone")));
    expect(keys).toContain(JSON.stringify(blocksKeys.schema(WS, "Project")));
  });
});

describe("writes", () => {
  it("build.start reads the project again (it moves from Board to Build)", () => {
    const cfg = deliveryMutationConfig("build.start", WS, P) as unknown as { invalidate?: unknown };
    const text = JSON.stringify(cfg);
    expect(text).toContain(JSON.stringify(blocksKeys.schema(WS, "Project")));
  });
  it("a project row written by a save (rename, setup, hand-over) refreshes the Scope and Build pages' own copies", () => {
    queryClient.setQueryData(deliveryProjectKey(P), { ItemId: P, Name: "Old" });
    queryClient.setQueryData(scopeProjectKey(P), { id: P, name: "Old" });
    putRows(WS, "Project", [{ ItemId: P, Name: "New" }]);
    expect(queryClient.getQueryState(deliveryProjectKey(P))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(scopeProjectKey(P))?.isInvalidated).toBe(true);
  });
  it("the design context lives under the DesignBrief schema, so a finished design job reads it again", () => {
    expect(designContextKey(WS, P).slice(0, 3)).toEqual([...blocksKeys.schema(WS, "DesignBrief")]);
  });
});

describe("a workspace resumed during the session", () => {
  const ws = (status: "active" | "suspended") => ({ id: WS, name: "Acme", createdAt: "", role: "owner", roleKey: "owner", roleName: "Workspace admin", status, membershipId: "m1", viaPlatform: false });
  const me = { id: "u1", workspaceId: WS, name: "Ann", email: "a@x.ch", role: "owner", status: "active", invitedAt: null, joinedAt: null, userId: "u1", membershipId: "m1", roleKey: "owner", roleName: "Workspace admin", permissions: ["project.create", "project.edit"], isCustomRole: false };
  afterEach(() => useWorkspaces.setState({ ready: false, workspaceId: null, workspaces: [], me: null, suspended: [] }));

  it("is writable again once its row says active, although the sign-in said suspended", () => {
    useWorkspaces.setState({ ready: true, workspaceId: WS, workspaces: [ws("active")] as never, me: me as never, suspended: [{ workspaceId: WS, name: "Acme" }] });
    expect(canNow("project.create" as never)).toBe(true);
  });
  it("is read-only once its row says suspended", () => {
    useWorkspaces.setState({ ready: true, workspaceId: WS, workspaces: [ws("suspended")] as never, me: me as never, suspended: [] });
    expect(canNow("project.create" as never)).toBe(false);
  });
});

describe("polling paces", () => {
  it("the brief: 3 s while a file is read, a minute otherwise (it was 20 s for as long as a page showed it)", () => {
    expect(briefRefetchInterval({ state: { data: { attachmentStatus: [{ status: "processing" }] } as never } })).toBe(BRIEF_BUSY_MS);
    expect(briefRefetchInterval({ state: { data: { attachmentStatus: [{ status: "ready" }] } as never } })).toBe(BRIEF_IDLE_MS);
    expect(briefRefetchInterval({ state: { data: undefined } })).toBe(BRIEF_IDLE_MS);
    expect(BRIEF_IDLE_MS).toBe(60_000);
  });
  it("the landing section: fast while it is written, slow once the draft is late, off when it is not being written", () => {
    expect(landingPollMs(null, 1_000)).toBe(false);
    expect(landingPollMs(0, 60_000)).toBe(LANDING_FAST_MS);
    expect(landingPollMs(0, LANDING_FAST_FOR_MS + 1)).toBe(LANDING_SLOW_MS);
  });
});
