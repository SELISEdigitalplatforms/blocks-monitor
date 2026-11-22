// Settings → Workspace: the form state (who edits, when Save is possible, why a name is refused), the card rendered for an
// admin and for a viewer, and a saved name reaching the cached workspace lists the top bar is built from (no reload).
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKSPACE_PERMISSIONS } from "../../src/domain/rbac";
import { workspacePermissionsFor } from "../../src/domain/roles";

const fn = vi.hoisted(() => ({ callFunction: vi.fn() }));
vi.mock("../../src/blocks/fn", async (orig) => ({ ...(await orig<typeof import("../../src/blocks/fn")>()), callFunction: fn.callFunction }));

const { FunctionError } = await import("../../src/blocks/fn");
const { RENAME_ADMIN_ONLY, RENAME_SUSPENDED, workspaceNameForm } = await import("../../src/components/settings/workspaceNameForm");
const { WorkspaceNameSection } = await import("../../src/components/settings/WorkspaceNameCard");
const { resetWorkspaceStore } = await import("../../src/blocks/workspaces/store");
const { applyWorkspaceName, meKeys } = await import("../../src/blocks/workspaces/queries");
const { renameWorkspace } = await import("../../src/blocks/workspaces/ops");
const { queryClient } = await import("../../src/blocks/queryClient");
const { useSession } = await import("../../src/blocks/session");

const WS = "ws-1";
const UID = "user-1";
const OWNER = [...WORKSPACE_PERMISSIONS];
const VIEWER = workspacePermissionsFor({ roleKey: "viewer", customRoles: [] });
const MEMBER = workspacePermissionsFor({ roleKey: "member", customRoles: [] });

afterEach(() => {
  resetWorkspaceStore(false);
  queryClient.clear();
  fn.callFunction.mockReset();
  useSession.setState({ profile: null } as never);
});

describe("the workspace name form", () => {
  const base = { current: "Northwind Lab", draft: "Northwind Lab", permissions: OWNER, status: "active", saving: false };

  it("a Workspace admin edits; Save waits for a real change", () => {
    expect(workspaceNameForm(base)).toEqual({ mode: "edit", readOnlyReason: null, dirty: false, problem: null, canSave: false, value: "Northwind Lab" });
    expect(workspaceNameForm({ ...base, draft: "  Northwind Lab " })).toMatchObject({ dirty: false, canSave: false });
    expect(workspaceNameForm({ ...base, draft: " Northwind App Center " })).toMatchObject({ dirty: true, canSave: true, value: "Northwind App Center", problem: null });
    expect(workspaceNameForm({ ...base, draft: "Northwind App Center", saving: true })).toMatchObject({ canSave: false });
  });

  it("explains a refused name under the field and keeps Save off", () => {
    expect(workspaceNameForm({ ...base, draft: "S" })).toMatchObject({ canSave: false, value: null, problem: "Use 2 to 60 characters for the workspace name." });
    expect(workspaceNameForm({ ...base, draft: "x".repeat(61) })).toMatchObject({ canSave: false, problem: "Use 2 to 60 characters for the workspace name." });
    expect(workspaceNameForm({ ...base, draft: "Two\tparts" })).toMatchObject({ canSave: false, problem: expect.stringContaining("control characters") });
  });

  it("members and viewers read the name; a suspended workspace is read-only for everyone", () => {
    expect(workspaceNameForm({ ...base, permissions: VIEWER, draft: "Changed" })).toMatchObject({ mode: "read", readOnlyReason: RENAME_ADMIN_ONLY, canSave: false, problem: null });
    expect(workspaceNameForm({ ...base, permissions: MEMBER })).toMatchObject({ mode: "read", readOnlyReason: RENAME_ADMIN_ONLY });
    expect(workspaceNameForm({ ...base, status: "suspended" })).toMatchObject({ mode: "read", readOnlyReason: RENAME_SUSPENDED, canSave: false });
  });
});

// zustand's server snapshot is the store's initial state, so the card is rendered through its props-driven section.
const render = (permissions: readonly string[], status = "active", ready = true) =>
  renderToStaticMarkup(
    <MemoryRouter>
      <WorkspaceNameSection ready={ready} permissions={permissions} workspace={{ id: WS, name: "Northwind Lab", status }} />
    </MemoryRouter>,
  );

describe("the Settings card", () => {
  it("gives a Workspace admin the name field and the primary Save button (off until the name changes)", () => {
    const html = render(OWNER);
    expect(html).toContain('id="workspace"');
    expect(html).toMatch(/<label for="workspace-name"[^>]*>Workspace name<\/label>/);
    expect(html).toMatch(/<input id="workspace-name" maxLength="60"[^>]*value="Northwind Lab"\/>/);
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*\bbg-accent text-white\b[^>]*>Save<\/button>/);
  });

  it("shows a viewer the name read-only, with no field and no Save", () => {
    const html = render(VIEWER);
    expect(html).toContain("Northwind Lab");
    expect(html).not.toContain("<input");
    expect(html).not.toContain(">Save<");
    expect(html).toContain(RENAME_ADMIN_ONLY);
  });

  it("is read-only in a suspended workspace, even for its admin", () => {
    const html = render(OWNER, "suspended");
    expect(html).not.toContain("<input");
    expect(html).toContain(RENAME_SUSPENDED.replace("'", "&#x27;"));
  });

  it("shows a placeholder until the workspace snapshot is ready", () => {
    const html = render(OWNER, "active", false);
    expect(html).toContain('aria-label="Loading the workspace"');
    expect(html).not.toContain("<input");
  });

  it("is placed in Settings between You and Team, with a section chip", async () => {
    const fs = await import("node:fs");
    const view = fs.readFileSync(new URL("../../src/components/settings/SettingsView.tsx", import.meta.url), "utf8");
    expect(view).toMatch(/<ProfileCard \/>\s*<WorkspaceNameCard \/>\s*<TeamCard \/>/);
    expect(view).toContain('"#workspace"');
  });
});

describe("a saved name everywhere at once", () => {
  const rows = (name: string) => [
    { ItemId: WS, WorkspaceId: WS, Name: name, Status: "active" },
    { ItemId: "ws-2", WorkspaceId: "ws-2", Name: "Other workspace", Status: "active" },
  ];

  it("applyWorkspaceName rewrites every cached workspace list of the person and notifies its observers", () => {
    const client = new QueryClient();
    const mine = [...meKeys.workspaces(UID), [WS, "ws-2"]];
    const all = [...meKeys.workspaces(UID), "all"];
    const otherPerson = [...meKeys.workspaces("someone-else"), [WS]];
    client.setQueryData(mine, rows("Northwind Lab"));
    client.setQueryData(all, rows("Northwind Lab"));
    client.setQueryData(otherPerson, rows("Northwind Lab"));
    const seen: string[] = [];
    const observer = new QueryObserver<{ ItemId: string; Name: string }[]>(client, { queryKey: mine, enabled: false });
    const stop = observer.subscribe((r) => seen.push(r.data?.[0]?.Name ?? ""));

    applyWorkspaceName(client, UID, WS, "Northwind App Center");
    stop();

    expect(client.getQueryData<{ Name: string }[]>(mine)?.map((r) => r.Name)).toEqual(["Northwind App Center", "Other workspace"]);
    expect(client.getQueryData<{ Name: string }[]>(all)?.map((r) => r.Name)).toEqual(["Northwind App Center", "Other workspace"]);
    expect(client.getQueryData<{ Name: string }[]>(otherPerson)?.[0].Name).toBe("Northwind Lab");
    expect(seen).toEqual(["Northwind App Center"]);
  });

  it("renameWorkspace sends the name the admin saw and writes the answer into the cache before the refetch", async () => {
    useSession.setState({ profile: { userId: UID } } as never);
    const key = [...meKeys.workspaces(UID), [WS, "ws-2"]];
    queryClient.setQueryData(key, rows("Northwind Lab"));
    fn.callFunction.mockResolvedValue({ data: { workspace: { id: WS, name: "Northwind App Center", updatedAt: "2026-11-05T10:00:00.000Z" }, changed: true } });

    const r = await renameWorkspace({ workspaceId: WS, name: "Northwind App Center", expectedName: "Northwind Lab" });

    expect(r).toMatchObject({ ok: true, value: { changed: true } });
    expect(fn.callFunction).toHaveBeenCalledWith("workspace", "workspace.rename",
      { workspaceId: WS, name: "Northwind App Center", expectedName: "Northwind Lab" }, expect.objectContaining({ requestId: expect.any(String) }));
    expect(queryClient.getQueryData<{ Name: string }[]>(key)?.[0].Name).toBe("Northwind App Center");
  });

  it("a conflict keeps the cache as it is and says someone else renamed it", async () => {
    useSession.setState({ profile: { userId: UID } } as never);
    const key = [...meKeys.workspaces(UID), [WS]];
    queryClient.setQueryData(key, rows("Renamed elsewhere").slice(0, 1));
    fn.callFunction.mockRejectedValue(new FunctionError("conflict", "conflict", "request-1", "tenancy.workspaceRenamed"));

    const r = await renameWorkspace({ workspaceId: WS, name: "Northwind App Center", expectedName: "Northwind Lab" });

    expect(r).toMatchObject({ ok: false, code: "conflict", error: expect.stringContaining("Someone else renamed this workspace") });
    expect(queryClient.getQueryData<{ Name: string }[]>(key)?.[0].Name).toBe("Renamed elsewhere");
  });
});
