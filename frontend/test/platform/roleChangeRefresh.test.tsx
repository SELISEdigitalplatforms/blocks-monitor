// The app's own role changes read the signed-in person's profile and platform permissions again at once (they may have
// changed their own access): platform roles saved, deleted, assigned or removed, the super admin flag granted or removed,
// and every IAM roles and access write. A failed write reads nothing; writes that cannot change platform access (a
// workspace setting) read nothing either.
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spy = vi.hoisted(() => ({ refresh: 0, fail: false }));
vi.mock("../../src/blocks/sessionFreshness", () => ({
  refreshSessionAccess: async () => { spy.refresh += 1; },
}));
vi.mock("../../src/blocks/fn", async (orig) => ({
  ...(await orig<typeof import("../../src/blocks/fn")>()),
  callFunction: async () => {
    if (spy.fail) throw new Error("refused");
    return { data: { ok: true }, serverNow: null, requestId: "req-1" };
  },
}));
vi.mock("../../src/blocks/workspaces/ops", async (orig) => {
  const answer = async () => (spy.fail ? { ok: false, error: "Refused." } : { ok: true, value: { assignment: null, iam: null } });
  return {
    ...(await orig<typeof import("../../src/blocks/workspaces/ops")>()),
    savePlatformRole: answer, deletePlatformRole: answer, assignPlatformRole: answer, unassignPlatformRole: answer,
    getAllowedEmailDomains: async () => ({ ok: true, value: { domains: [], exceptions: [] } }),
    saveAllowedEmailDomains: answer,
  };
});

import { useSession } from "../../src/blocks/session";
import {
  applyIamRoleChange, useAssignPlatformRole, useDeletePlatformRole, useSavePlatformRole, useSaveSetting, useUnassignPlatformRole,
} from "../../src/blocks/admin";
import { setSuperAdmin, type PersonRow } from "../../src/blocks/people";
import { useDeleteIamRole, useSaveIamRole, useSetIamAccess, useSetRbacSource } from "../../src/blocks/iam";

/** The mutation a hook returns, taken from a static render (its observer runs the write and its onSuccess). */
function mutationOf<T>(hook: () => T): T {
  const out: { m?: T } = {};
  function Grab() { out.m = hook(); return null; }
  renderToStaticMarkup(<QueryClientProvider client={new QueryClient()}><Grab /></QueryClientProvider>);
  return out.m!;
}

const ROW: PersonRow = { userId: "u-2", email: "bob@example.org", firstName: "Bob", lastName: "B", displayName: "Bob B", roles: ["mf-user"], superAdmin: false, active: true } as PersonRow;

beforeEach(() => {
  spy.refresh = 0;
  spy.fail = false;
  useSession.setState({
    status: "signed-in", notice: null,
    profile: { userId: "u-1", email: "ada@example.org", firstName: "Ada", lastName: "L", displayName: "Ada L", roles: ["mf-user", "mf-super-admin"], permissions: [], isSuperAdmin: true },
  });
});
afterEach(() => useSession.setState({ status: "restoring", profile: null, notice: null }));

describe("after the app's own role changes", () => {
  it("platform role writes read the session's access again", async () => {
    await mutationOf(useSavePlatformRole).mutateAsync({ key: "auditor", name: "Auditor", description: "", permissions: ["platform.audit.view"] });
    await mutationOf(useDeletePlatformRole).mutateAsync({ itemId: "r-1", key: "auditor" });
    await mutationOf(useAssignPlatformRole).mutateAsync({ userId: "u-1", roleKey: "auditor" });
    await mutationOf(useUnassignPlatformRole).mutateAsync({ userId: "u-1", roleKey: "auditor" });
    expect(spy.refresh).toBe(4);
  });

  it("the super admin flag and IAM role changes too", async () => {
    expect(await setSuperAdmin(ROW, true)).toMatchObject({ ok: true });
    expect(await applyIamRoleChange({ userId: "u-2", role: "mf-super-admin", grant: true } as never, "bob@example.org")).toEqual({ ok: true });
    await mutationOf(useSaveIamRole).mutateAsync({ scope: "platform", key: "auditor", name: "Auditor", description: "", permissions: [] });
    await mutationOf(useDeleteIamRole).mutateAsync({ scope: "platform", key: "auditor" });
    await mutationOf(useSetIamAccess).mutateAsync({ userId: "u-1", roleKeys: ["auditor"] });
    await mutationOf(useSetRbacSource).mutateAsync({ source: "iam" });
    expect(spy.refresh).toBe(6);
  });

  it("a refused write reads nothing, and neither does a write that cannot change platform access", async () => {
    spy.fail = true;
    await expect(mutationOf(useAssignPlatformRole).mutateAsync({ userId: "u-1", roleKey: "auditor" })).rejects.toThrow();
    expect(await setSuperAdmin(ROW, true)).toMatchObject({ ok: false });
    expect(spy.refresh).toBe(0);
    spy.fail = false;
    await mutationOf(useSaveSetting).mutateAsync({ key: "allowedEmailDomains", values: ["example.org"] } as never);
    expect(spy.refresh).toBe(0);
  });
});
