// The account menu at the top right: the button shows my role under my name (Super admin, else my role in the open
// workspace, whose name is in the switcher at the top left), the menu's head keeps the same role as a chip beside the name
// and e-mail, and its workspace switcher lists my workspaces as radio rows (monogram, role,
// the open one pinned first and checked, the rest newest first, a field to find one in a long list) with Create workspace below: a side column from sm, a folded "Switch workspace" row on a phone.
// The keyboard moves within a column with Up / Down and between the columns with Left / Right.
//   npx vitest run --config test/workspace/vitest.config.ts test/workspace/accountMenu.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import type { MyWorkspace } from "../../src/blocks/workspaces/store";
import { setCulture } from "../../src/i18n";
import { accountRoleLine, workspaceRoleLabel } from "../../src/components/roles/permissionText";
import { AccountHeader, AccountRoleLine, menuKeyTarget, type MenuSpot } from "../../src/ui/Shell";
import {
  AccountWorkspaces, AccountWorkspacesFold, FIND_FROM, WorkspaceRadioRows, accountWorkspaceOrder, findWorkspaces, labelWorkspaces,
} from "../../src/components/workspace/WorkspaceSwitcher";
import { FOCUS_ITEMS } from "../../src/ui/popover";

const ws = (id: string, name: string, extra: Partial<MyWorkspace> = {}): MyWorkspace => ({
  id, name, createdAt: "2026-11-01T09:00:00Z", role: "owner", roleKey: "owner", roleName: "Workspace admin", status: "active",
  membershipId: `m-${id}`, viaPlatform: false, ...extra,
} as MyWorkspace);

const rows = (html: string) => html.split('role="menuitemradio"').slice(1);

describe("the account button", () => {
  it("shows my role under the name, whole in its title when it is cut short", () => {
    const html = renderToStaticMarkup(<AccountRoleLine role="Workspace admin" loading={false} />);
    expect(html).toContain(">Workspace admin<");
    expect(html).toContain('title="Workspace admin"');
    expect(html).toContain("truncate");
  });

  it("holds a placeholder while the workspaces load, and nothing without a workspace", () => {
    expect(renderToStaticMarkup(<AccountRoleLine role={null} loading />)).toContain("Loading your role");
    expect(renderToStaticMarkup(<AccountRoleLine role={null} loading={false} />)).toBe("");
  });
});

describe("the account's role line", () => {
  afterEach(() => setCulture("en"));
  const customRoles = [
    { key: "reviewer", name: "Reviewer", isBuiltIn: false },
    { key: "owner", name: "Not the built-in", isBuiltIn: true },
  ];
  const line = (o: { isSuperAdmin?: boolean; ready?: boolean; roleKey: string | null }) =>
    accountRoleLine({ isSuperAdmin: false, ready: true, customRoles, ...o });

  it("names a built-in workspace role as the team and roles screens do", () => {
    expect(line({ roleKey: "owner" })).toBe("Workspace admin");
    expect(line({ roleKey: "member" })).toBe("Member");
    expect(line({ roleKey: "viewer" })).toBe("Viewer");
  });

  it("names a custom role by its own name, and plainly while its definition is not there", () => {
    expect(line({ roleKey: "reviewer" })).toBe("Reviewer");
    expect(line({ roleKey: "gone" })).toBe("Custom role");
    expect(accountRoleLine({ isSuperAdmin: false, ready: true, roleKey: "reviewer", customRoles: [{ key: "reviewer", name: "  ", isBuiltIn: false }] })).toBe("Custom role");
  });

  it("says Super admin for a platform super admin, whatever the workspace role and before the workspaces load", () => {
    expect(line({ isSuperAdmin: true, roleKey: "member" })).toBe("Super admin");
    expect(line({ isSuperAdmin: true, roleKey: null })).toBe("Super admin");
    expect(line({ isSuperAdmin: true, ready: false, roleKey: null })).toBe("Super admin");
  });

  it("is empty until the workspaces have loaded, and without an open workspace", () => {
    expect(line({ ready: false, roleKey: "owner" })).toBeNull();
    expect(line({ roleKey: null })).toBeNull();
  });

  it("speaks German (Switzerland); a custom role keeps its own name", () => {
    setCulture("de-CH");
    expect(line({ roleKey: "owner" })).toBe("Workspace-Admin");
    expect(line({ roleKey: "member" })).toBe("Mitglied");
    expect(line({ roleKey: "viewer" })).toBe("Betrachter");
    expect(line({ roleKey: "gone" })).toBe("Eigene Rolle");
    expect(line({ roleKey: "reviewer" })).toBe("Reviewer");
    expect(line({ isSuperAdmin: true, roleKey: "owner" })).toBe("Super-Admin");
    expect(renderToStaticMarkup(<AccountRoleLine role={null} loading />)).toContain("Ihre Rolle wird geladen");
  });
});

describe("my role in each workspace of the lists", () => {
  afterEach(() => setCulture("en"));
  const customRoles = [{ key: "reviewer", name: "Reviewer", isBuiltIn: false }];
  const label = (roleKey: string, isSuperAdmin = false) => workspaceRoleLabel({ roleKey, roleName: "as stored" }, { isSuperAdmin, customRoles });

  it("is named like the account button: built-in roles by their names, a custom role by its own", () => {
    expect(label("owner")).toBe("Workspace admin");
    expect(label("member")).toBe("Member");
    expect(label("viewer")).toBe("Viewer");
    expect(label("reviewer")).toBe("Reviewer");
    expect(label("gone")).toBe("Custom role");
    // a platform super admin may do everything in every workspace, whatever their membership there says
    expect(label("member", true)).toBe("Workspace admin");
  });

  it("the account menu's rows show each role in German (Switzerland), a custom role by its own name, and are found by it", () => {
    const stored = [
      ws("w1", "SELISE App Center"),
      ws("w2", "Northwind Lab", { role: "member", roleKey: "member", roleName: "Member" }),
      ws("w3", "Zürich Logistics", { role: "viewer", roleKey: "reviewer", roleName: "Reviewer" }),
      ws("w4", "Acme", { role: "viewer", roleKey: "elsewhere", roleName: "Custom role" }),
    ];
    setCulture("de-CH");
    const labelled = labelWorkspaces(stored, { isSuperAdmin: false, customRoles });
    const r = rows(renderToStaticMarkup(<WorkspaceRadioRows workspaces={accountWorkspaceOrder(labelled, "w1")} currentId="w1" onChoose={() => {}} />));
    expect(r).toHaveLength(4);
    // the open one first, then by name
    expect(r[0]).toContain(">Workspace-Admin<");
    expect(r[1]).toContain(">Eigene Rolle<");
    expect(r[2]).toContain(">Mitglied<");
    expect(r[3]).toContain(">Reviewer<");
    expect(r.join("")).not.toMatch(/>(Workspace admin|Member|Custom role)</);
    // the find field searches the role as shown
    expect(findWorkspaces(labelled, "mitglied").map((w) => w.id)).toEqual(["w2"]);
    // the store's own list is left as it was
    expect(stored[1].roleName).toBe("Member");
  });
});

describe("the account menu's head", () => {
  it("names the person with their e-mail and keeps the role as a chip", () => {
    const html = renderToStaticMarkup(<AccountHeader name="Ada Lovelace" initials="AL" email="ada@example.com" role="Super admin" />);
    expect(html).toContain(">Ada Lovelace<");
    expect(html).toContain(">ada@example.com<");
    expect(html).toContain(">Super admin<");
    expect(html).toContain("rounded-full");
  });

  it("has no chip before the role is known", () => {
    const html = renderToStaticMarkup(<AccountHeader name="Ada Lovelace" initials="AL" email={null} role={null} />);
    expect(html).not.toContain("Super admin");
    expect(html).not.toContain("@");
  });
});

describe("the account menu's workspace switcher", () => {
  const list = [ws("w1", "SELISE App Center"), ws("w2", "Northwind Lab", { roleName: "Member" }), ws("w3", "acme", { roleName: "", viaPlatform: true })];

  it("lists every workspace as a radio row with its monogram and my role there; only the open one is checked", () => {
    const html = renderToStaticMarkup(<WorkspaceRadioRows workspaces={list} currentId="w2" onChoose={() => {}} />);
    const r = rows(html);
    expect(r).toHaveLength(3);
    expect(r.map((x) => x.match(/aria-checked="(true|false)"/)?.[1])).toEqual(["false", "true", "false"]);
    expect(r[0]).toContain(">SA<");
    expect(r[0]).toContain(">Workspace admin<");
    expect(r[1]).toContain(">NL<");
    expect(r[1]).toContain(">Member<");
    expect(r[2]).toContain(">AC<");
    expect(r[2]).toContain(">Platform access<");
    expect(r[2]).toContain('title="Platform access"');
    // the open one is highlighted, its tile filled, and it alone carries the check
    expect(r[1]).toContain("bg-surface2 text-ink");
    expect(r[1]).toContain("bg-accent text-white");
    expect(r[0]).not.toContain("bg-accent text-white");
    expect(html.match(/lucide-check/g)).toHaveLength(1);
  });

  it("keeps the role line whole: platform access is a small badge on the name line, not beside the role", () => {
    const html = renderToStaticMarkup(<WorkspaceRadioRows workspaces={[ws("w1", "SELISE App Center", { viaPlatform: true })]} currentId="w1" onChoose={() => {}} />);
    // the badge comes right after the name, before the role line starts
    expect(html.indexOf('title="Platform access"')).toBeGreaterThan(html.indexOf(">SELISE App Center<"));
    expect(html.indexOf('title="Platform access"')).toBeLessThan(html.indexOf(">Workspace admin<"));
    // the role is a line of its own, the full width of the row
    expect(html).toContain('<span class="mt-0.5 block truncate text-[12px] text-ink3">Workspace admin</span>');
  });

  it("checks nothing when no workspace is open", () => {
    const html = renderToStaticMarkup(<WorkspaceRadioRows workspaces={list} currentId={null} onChoose={() => {}} />);
    expect(html).not.toContain('aria-checked="true"');
  });

  it("pins the open workspace first, then lists the rest newest first", () => {
    const dated = [
      ws("old", "Alpha", { createdAt: "2026-01-05T09:00:00Z" }), ws("new", "Zulu", { createdAt: "2026-11-10T09:00:00Z" }),
      ws("mid", "Mike", { createdAt: "2026-06-01T09:00:00Z" }), ws("open", "Open one", { createdAt: "2026-02-01T09:00:00Z" }),
    ];
    expect(accountWorkspaceOrder(dated, "open").map((w) => w.id)).toEqual(["open", "new", "mid", "old"]);
    expect(accountWorkspaceOrder(dated, null).map((w) => w.id)).toEqual(["new", "mid", "open", "old"]);
  });

  it("lists workspaces created at the same time by name (case and numbers read naturally)", () => {
    const many = [ws("a", "Isolation probe (A)"), ws("b", "workspace 10"), ws("c", "SELISE App Center"), ws("d", "acme"), ws("e", "Workspace 2")];
    expect(accountWorkspaceOrder(many, "c").map((w) => w.name)).toEqual(["SELISE App Center", "acme", "Isolation probe (A)", "Workspace 2", "workspace 10"]);
    expect(accountWorkspaceOrder(many, null).map((w) => w.id)).toEqual(["d", "a", "c", "e", "b"]);
    expect(accountWorkspaceOrder(many, "gone").map((w) => w.id)).toEqual(["d", "a", "c", "e", "b"]);
    // the list it was given stays as it was
    expect(many.map((w) => w.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("finds workspaces by every word of the query in the name or my role, ignoring case and accents, keeping the order", () => {
    const many = [ws("c", "SELISE App Center"), ws("z", "Zürich Logistics", { roleName: "Viewer" }), ws("n", "Northwind Lab", { roleName: "Member" })];
    expect(findWorkspaces(many, "").map((w) => w.id)).toEqual(["c", "z", "n"]);
    expect(findWorkspaces(many, "  ").map((w) => w.id)).toEqual(["c", "z", "n"]);
    expect(findWorkspaces(many, "zurich").map((w) => w.id)).toEqual(["z"]);
    expect(findWorkspaces(many, "selise CENTER").map((w) => w.id)).toEqual(["c"]);
    expect(findWorkspaces(many, "member").map((w) => w.id)).toEqual(["n"]);
    expect(findWorkspaces(many, "lab viewer")).toEqual([]);
    // the field shows from seven workspaces on
    expect(FIND_FROM).toBe(7);
  });

  it("is a labelled group of the menu that offers Create workspace, and says so while the list loads", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AccountWorkspaces close={() => {}} onCreate={() => {}} /></MemoryRouter>);
    expect(html).toContain('role="group" aria-label="Workspaces"');
    expect(html).toContain("Loading workspaces");
    expect(html).toMatch(/role="menuitem"[^>]*>.*Create workspace/);
    // Workspace settings only once a workspace is open
    expect(html).not.toContain("Workspace settings");
  });

  it("as the side column it is titled and its list takes the room left, scrolling inside", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AccountWorkspaces variant="panel" close={() => {}} onCreate={() => {}} /></MemoryRouter>);
    expect(html).toContain(">Workspaces</span>");
    expect(html).toContain("flex h-full min-h-0 flex-col");
    expect(html).toMatch(/class="[^"]*min-h-0 flex-1[^"]*overflow-y-auto|class="[^"]*overflow-y-auto[^"]*min-h-0 flex-1/);
  });

  it("inline, under the phone's Switch workspace row, it has no title and a short capped list", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AccountWorkspaces variant="inline" close={() => {}} onCreate={() => {}} /></MemoryRouter>);
    expect(html).not.toContain(">Workspaces</span>");
    expect(html).toContain("max-h-[min(264px,40dvh)]");
    expect(html).toContain("Create workspace");
  });

  it("on a phone it starts folded into one Switch workspace row", () => {
    const html = renderToStaticMarkup(<MemoryRouter><AccountWorkspacesFold close={() => {}} onCreate={() => {}} /></MemoryRouter>);
    expect(html).toMatch(/role="menuitem" aria-expanded="false" aria-controls="[^"]+"/);
    expect(html).toContain("Switch workspace");
    expect(html).not.toContain('role="menuitemradio"');
    expect(html).not.toContain("Create workspace");
  });

  it("its radio rows are reached by the menu's arrow keys", () => {
    expect(FOCUS_ITEMS).toContain('[role="menuitemradio"]');
    expect(FOCUS_ITEMS).toContain('[role="menuitem"]');
  });
});

describe("the account menu's keyboard", () => {
  // left column: Settings, Change password, Export, Theme, Sign out (0-4); right column: three workspaces, the second
  // open, then Create workspace (5-8)
  const two: MenuSpot[] = [
    ...Array.from({ length: 5 }, () => ({ column: 0 })),
    { column: 1 }, { column: 1, checked: true }, { column: 1 }, { column: 1 },
  ];

  it("Up and Down stay in the focused row's column and wrap at its ends; Home and End jump within it", () => {
    expect(menuKeyTarget("ArrowDown", two, 1)).toBe(2);
    expect(menuKeyTarget("ArrowDown", two, 4)).toBe(0);
    expect(menuKeyTarget("ArrowUp", two, 0)).toBe(4);
    expect(menuKeyTarget("ArrowDown", two, 8)).toBe(5);
    expect(menuKeyTarget("ArrowUp", two, 5)).toBe(8);
    expect(menuKeyTarget("Home", two, 7)).toBe(5);
    expect(menuKeyTarget("End", two, 1)).toBe(4);
  });

  it("Right goes to the open workspace, Left back to the row last focused on the left (else its first)", () => {
    expect(menuKeyTarget("ArrowRight", two, 2)).toBe(6);
    expect(menuKeyTarget("ArrowLeft", two, 7)).toBe(0);
    expect(menuKeyTarget("ArrowLeft", two, 7, new Map([[0, 3]]))).toBe(3);
    expect(menuKeyTarget("ArrowRight", two, 0, new Map([[1, 8]]))).toBe(8);
    // nowhere further to go
    expect(menuKeyTarget("ArrowRight", two, 6)).toBe(-1);
    expect(menuKeyTarget("ArrowLeft", two, 1)).toBe(-1);
  });

  it("a one-column menu keeps Up / Down over every row and leaves Left / Right alone", () => {
    const one: MenuSpot[] = Array.from({ length: 4 }, () => ({ column: -1 }));
    expect(menuKeyTarget("ArrowDown", one, -1)).toBe(0);
    expect(menuKeyTarget("ArrowUp", one, -1)).toBe(3);
    expect(menuKeyTarget("ArrowDown", one, 3)).toBe(0);
    expect(menuKeyTarget("ArrowLeft", one, 1)).toBe(-1);
    expect(menuKeyTarget("ArrowRight", one, 1)).toBe(-1);
    expect(menuKeyTarget("Enter", one, 1)).toBe(-1);
  });
});
