// Blocks project members (MF_BLOCKS_PROJECT_MEMBERS): the engine makes the configured people members of the Blocks
// projects its provisioning account owns (Blocks OS People API, as that account), right after provisioning and before a
// product's device login, so that they can approve the "Connect to Blocks" card. A fake CLI store and a fake API play
// Blocks: the token comes from the store only after the CLI's own call, and no log line carries it or an address.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// a ready tenant syncs the project's registry (registryWriter.ts): into a temporary folder, never the repository's
const paths = vi.hoisted(() => ({ projectsDir: "", artifactsDir: "" }));
vi.mock("../../server/api/engineBridge.ts", () => ({ paths }));

import { createProvisioner, type ProvisioningRow, type ProvisioningStore } from "../../server/blocks/provisioning.ts";
import { createProvisioningCli } from "../../server/blocks/provisioningCli.ts";
import {
  PEOPLE_GETS,
  PEOPLE_INVITE,
  addProjectMembers,
  addProjectMembersFromEnv,
  membersTag,
  projectMembers,
  type ExecRun,
} from "../../server/blocks/provisioningMembers.ts";
import { connectBlocks, type BlocksTarget } from "../../server/local/engine/official/blocksLogin.ts";
import { productStore } from "../../server/local/engine/official/home.ts";
import type { JobRun } from "../../server/local/engine/run.ts";
import { cliCalls, writeFakeBlocksCli } from "./fakeBlocksCli.ts";

const GROUP = "177a8535d9e94f9d8909569ff6c98b0f";
const TENANT = `D${GROUP}`;
const API = "https://api.example.test";
const OLD_TOKEN = "stale.account-token.0123456789abcdef";
const TOKEN = "fresh.account-token.0123456789abcdef";
const ROOT_KEY = "d7e5554c758541db8a18694b64ef423d";
const OWNER = "owner@example.org";
const ALREADY = "already@example.org";
const LISTED = JSON.stringify([{ name: "MADP Shop", tenantGroupId: GROUP, projects: [{ tenantId: TENANT, environment: "dev", name: "MADP Shop" }] }]);

let tmp = "";
let store = "";
const saved: Record<string, string | undefined> = {};
const setEnv = (k: string, v: string | undefined) => {
  if (!(k in saved)) saved[k] = process.env[k];
  if (v === undefined) delete process.env[k];
  else process.env[k] = v;
};
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mf-blocks-members-"));
  paths.projectsDir = path.join(tmp, "projects");
  paths.artifactsDir = path.join(tmp, "artifacts");
  store = path.join(tmp, "provisioning-store");
  writeStore();
});
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete saved[k];
  }
  vi.unstubAllGlobals();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** The provisioning account's CLI store: an account session (no project selected) whose access token has expired. */
function writeStore(o: { selected?: boolean; apiUrl?: string; account?: boolean } = {}) {
  fs.mkdirSync(store, { recursive: true, mode: 0o700 });
  const profile = { apiUrl: o.apiUrl ?? API, clientId: "client", ...(o.selected ? { selectedProject: { tenantId: TENANT } } : {}) };
  fs.writeFileSync(path.join(store, "config.json"), JSON.stringify({ activeAccount: "default", accounts: { default: profile } }));
  const account = { accessToken: OLD_TOKEN, accountTenant: ROOT_KEY, expiresAt: new Date(Date.now() - 60_000).toISOString(), refreshToken: "refresh-token-never-used-here" };
  fs.writeFileSync(path.join(store, "tokens.json"), JSON.stringify({ accounts: { default: o.account === false ? { projects: { [TENANT]: { accessToken: "project-token-0123456789" } } } : { account } } }));
}

/** A fake Blocks CLI: `projects list` refreshes the account session in place (as the real one does when it is about to
 *  expire) and prints the account's projects. */
function fakeCli(o: { listed?: string; fail?: boolean; refresh?: boolean } = {}) {
  const calls: Array<{ file: string; args: string[]; cwd?: string; config?: string }> = [];
  const run = vi.fn(async (file: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }) => {
    calls.push({ file, args, cwd: options.cwd, config: options.env?.BLOCKS_CONFIG_DIR });
    if (o.fail) throw Object.assign(new Error(`Command failed: blocks ${args.join(" ")}\n${OLD_TOKEN}`), { stdout: OLD_TOKEN });
    if (o.refresh !== false) {
      const file = path.join(String(options.env?.BLOCKS_CONFIG_DIR), "tokens.json");
      const doc = JSON.parse(fs.readFileSync(file, "utf8"));
      doc.accounts.default.account = { ...doc.accounts.default.account, accessToken: TOKEN, expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
      fs.writeFileSync(file, JSON.stringify(doc));
    }
    return { stdout: o.listed ?? LISTED };
  });
  return { run: run as unknown as ExecRun, calls };
}

/** A fake Blocks OS People API: the project's members and what Invite answers. */
function fakeApi(o: { members?: string[]; status?: number; getsStatus?: number; reject?: boolean } = {}) {
  const members = new Set(o.members ?? []);
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown>; redirect?: string }> = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, headers: init.headers as Record<string, string>, body, redirect: init.redirect });
    if (o.reject) throw new TypeError(`fetch failed for ${url}`);
    if (url.endsWith(PEOPLE_GETS)) {
      if (o.getsStatus) return json(o.getsStatus, { error: "nope" });
      const peoples = [...members].map((email) => ({ peopleDetails: { email, userId: email.length }, sharedEnviroments: [{ tenantId: TENANT, isInvitationConfirmed: false }] }));
      return json(200, { isSuccess: true, peoples, peoplesTotalCount: peoples.length, totalCount: peoples.length });
    }
    if (url.endsWith(PEOPLE_INVITE)) {
      if (o.status) return json(o.status, { title: `denied for ${Object.keys(body.invitations).join(",")}` });
      const results: Record<string, string> = {};
      for (const email of Object.keys(body.invitations)) {
        results[email] = members.has(email) ? "already_has_access" : "invited";
        members.add(email);
      }
      return json(200, { isSuccess: true, results });
    }
    return json(404, {});
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls, members };
}

const target = (members = [OWNER, ALREADY]) => ({ tenant: TENANT, label: "shop-1a2b3c-dev", account: "default", store, members });

/** No log line may carry a token, an address, or the API's raw answers. */
function expectClean(logs: string[]) {
  const all = logs.join("\n");
  for (const secret of [TOKEN, OLD_TOKEN, "refresh-token-never-used-here", "project-token-0123456789", OWNER, ALREADY, "@", "denied for"]) expect(all).not.toContain(secret);
}

describe("the member list setting", () => {
  it("reads comma-separated e-mails, lower-cased and once each; anything else is dropped", () => {
    expect(projectMembers(` Owner@Example.org, ${ALREADY};bad-entry, owner@example.org ,, x@y`)).toEqual([OWNER, ALREADY]);
    expect(projectMembers("")).toEqual([]);
    expect(projectMembers(undefined)).toEqual([]);
    expect(membersTag([OWNER, ALREADY])).toBe(membersTag([ALREADY, OWNER]));
    expect(membersTag([OWNER])).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe("making the configured people members of a Blocks project", () => {
  it("invites each missing member once, as the provisioning account, with the token the CLI just refreshed", async () => {
    const cli = fakeCli();
    const api = fakeApi({ members: [ALREADY] });
    const logs: string[] = [];
    const r = await addProjectMembers(target(), { log: (l) => logs.push(l), run: cli.run, fetch: api.fetch });

    expect(r).toMatchObject({ state: "done", present: 1, invited: 1, outcomes: { invited: 1 } });
    // the CLI's own harmless call first, in the provisioning store and never in a workspace folder
    expect(cli.calls).toEqual([{ file: "blocks", args: ["projects", "list", "--account", "default", "--json"], cwd: store, config: store }]);
    // then the People API: who is a member, then one invite for the one who is not
    expect(api.calls.map((c) => c.url)).toEqual([`${API}${PEOPLE_GETS}`, `${API}${PEOPLE_INVITE}`]);
    expect(api.calls[0]!.body).toEqual({ projectGroupId: GROUP, environmentIds: [TENANT], page: 0, pageSize: 100 });
    expect(api.calls[1]!.body).toEqual({ groupId: GROUP, invitations: { [OWNER]: [{ tenantId: TENANT, roles: ["user"] }] } });
    for (const c of api.calls) {
      expect(c.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(c.headers["x-blocks-key"]).toBe(ROOT_KEY);
      expect(c.redirect).toBe("error");
    }
    expect(logs).toEqual([`blocks members shop-1a2b3c-dev: 2 configured (list ${membersTag([OWNER, ALREADY])}); 1 already members; 1 invited (invited 1)`]);
    expectClean(logs);
    // nothing was written into the store by the engine (the CLI's refresh is the only change)
    expect(JSON.parse(fs.readFileSync(path.join(store, "tokens.json"), "utf8")).accounts.default.account.accessToken).toBe(TOKEN);
  });

  it("is idempotent: a second run finds everyone a member and invites nobody", async () => {
    const api = fakeApi({ members: [ALREADY] });
    const logs: string[] = [];
    await addProjectMembers(target(), { log: (l) => logs.push(l), run: fakeCli().run, fetch: api.fetch });
    const again = await addProjectMembers(target(), { log: (l) => logs.push(l), run: fakeCli().run, fetch: api.fetch });
    expect(again).toMatchObject({ state: "done", present: 2, invited: 0, outcomes: {} });
    expect(api.calls.filter((c) => c.url.endsWith(PEOPLE_INVITE))).toHaveLength(1);
    expectClean(logs);
  });

  it("is off when no members are configured: no CLI call, no API call, no log line", async () => {
    const cli = fakeCli();
    const api = fakeApi();
    const logs: string[] = [];
    for (const value of [undefined, "", " , ;"]) {
      const r = await addProjectMembersFromEnv({ tenant: TENANT, label: "x", log: (l) => logs.push(l) }, { MF_BLOCKS_PROJECT_MEMBERS: value, MF_BLOCKS_PROVISIONING_ACCOUNT: "default", BLOCKS_CONFIG_DIR: store }, { run: cli.run, fetch: api.fetch });
      expect(r.state).toBe("off");
    }
    await createProvisioningCli("default", cli.run as never, { members: [], store, fetch: api.fetch, log: (l) => logs.push(l) }).addMembers({ tenantId: TENANT, domain: "https://x.example.org", environment: "dev" });
    expect(cli.calls).toEqual([]);
    expect(api.calls).toEqual([]);
    expect(logs).toEqual([]);
  });

  it("reads the engine's settings: the members, the provisioning account and its store", async () => {
    const cli = fakeCli();
    const api = fakeApi();
    const logs: string[] = [];
    const r = await addProjectMembersFromEnv(
      { tenant: TENANT, label: "shop-1a2b3c-dev", log: (l) => logs.push(l) },
      { MF_BLOCKS_PROJECT_MEMBERS: `${OWNER}`, MF_BLOCKS_PROVISIONING_ACCOUNT: "default", BLOCKS_CONFIG_DIR: store },
      { run: cli.run, fetch: api.fetch },
    );
    expect(r).toMatchObject({ state: "done", invited: 1 });
    expect(cli.calls[0]!.config).toBe(store);
    // a members list without a provisioning account is skipped plainly
    const none = await addProjectMembersFromEnv({ tenant: TENANT, label: "x", log: (l) => logs.push(l) }, { MF_BLOCKS_PROJECT_MEMBERS: OWNER, BLOCKS_CONFIG_DIR: store }, { run: cli.run, fetch: api.fetch });
    expect(none).toMatchObject({ state: "skipped", reason: "provisioning_account_not_set" });
    expect(cli.calls).toHaveLength(1);
    expectClean(logs);
  });

  it("invites everyone when the member list cannot be read; Blocks answers already_has_access for members", async () => {
    const api = fakeApi({ members: [ALREADY], getsStatus: 500 });
    const logs: string[] = [];
    const r = await addProjectMembers(target(), { log: (l) => logs.push(l), run: fakeCli().run, fetch: api.fetch });
    expect(r).toMatchObject({ state: "done", present: 0, invited: 2, outcomes: { invited: 1, already_has_access: 1 } });
    expectClean(logs);
  });

  describe("a failure is logged and the caller continues", () => {
    const cases: Array<[string, () => { run: ExecRun; fetch: typeof fetch; calls: () => number }, string]> = [
      ["the CLI fails", () => { const a = fakeApi(); return { run: fakeCli({ fail: true }).run, fetch: a.fetch, calls: () => a.calls.length }; }, "cli_failed"],
      ["the project is not the account's", () => { const a = fakeApi(); return { run: fakeCli({ listed: "[]" }).run, fetch: a.fetch, calls: () => a.calls.length }; }, "project_not_listed"],
      ["the session stayed expired", () => { const a = fakeApi(); return { run: fakeCli({ refresh: false }).run, fetch: a.fetch, calls: () => a.calls.length }; }, "account_session_expired"],
      ["the network is down", () => { const a = fakeApi({ reject: true }); return { run: fakeCli().run, fetch: a.fetch, calls: () => 0 }; }, "network"],
    ];
    for (const [name, make, reason] of cases) {
      it(name, async () => {
        const f = make();
        const logs: string[] = [];
        const r = await addProjectMembers(target(), { log: (l) => logs.push(l), run: f.run, fetch: f.fetch });
        expect(r).toMatchObject({ state: "skipped", reason, invited: 0 });
        expect(f.calls()).toBe(0);
        expect(logs).toHaveLength(1);
        expect(logs[0]).toContain(`not ensured (${reason})`);
        expectClean(logs);
      });
    }

    it("a refused invite is counted by its status, never with the API's answer", async () => {
      const api = fakeApi({ status: 403 });
      const logs: string[] = [];
      const r = await addProjectMembers(target([OWNER]), { log: (l) => logs.push(l), run: fakeCli().run, fetch: api.fetch });
      expect(r).toMatchObject({ state: "done", invited: 1, outcomes: { http_403: 1 } });
      expectClean(logs);
    });

    it("a store in a project session or on another API is left alone (no CLI call)", async () => {
      for (const [o, reason] of [[{ selected: true }, "account_in_project_session"], [{ account: false }, "account_session_missing"], [{ apiUrl: "http://api.example.test" }, "api_url_invalid"]] as const) {
        writeStore(o);
        const cli = fakeCli();
        const api = fakeApi();
        const logs: string[] = [];
        const r = await addProjectMembers(target(), { log: (l) => logs.push(l), run: cli.run, fetch: api.fetch });
        expect(r).toMatchObject({ state: "skipped", reason });
        expect(cli.calls).toEqual([]);
        expect(api.calls).toEqual([]);
        expectClean(logs);
      }
    });

    it("no store on the host", async () => {
      const cli = fakeCli();
      const r = await addProjectMembers({ ...target(), store: path.join(tmp, "missing") }, { log: () => undefined, run: cli.run, fetch: fakeApi().fetch });
      expect(r).toMatchObject({ state: "skipped", reason: "provisioning_store_missing" });
      expect(cli.calls).toEqual([]);
    });
  });
});

describe("after provisioning creates a project", () => {
  const ID = "887d4e76-ffcb-42e5-80ad-f90f77f8d266";
  const tenant = { tenantId: TENANT, domain: "https://product.example.org", environment: "dev" as const };
  function fixture(initial: ProvisioningRow = {}) {
    let row: ProvisioningRow = { ItemId: ID, Name: "A product", Status: "active", BlocksProvisioningStatus: "pending", ...initial };
    const provisioning: ProvisioningStore = {
      list: vi.fn(async () => [structuredClone(row)]),
      get: vi.fn(async () => structuredClone(row)),
      change: vi.fn(async (previous, patch) => {
        if (["BlocksProjectRef", "BlocksProvisioningStatus", "BlocksProvisioningName", "BlocksProvisioningAt"].some((key) => row[key] !== previous[key])) return false;
        row = { ...row, ...patch };
        return true;
      }),
    };
    const order: string[] = [];
    const cli = {
      preview: vi.fn(async () => undefined),
      create: vi.fn(async () => tenant),
      find: vi.fn(async () => tenant as typeof tenant | null),
      addMembers: vi.fn(async () => void order.push(`members while ${row.BlocksProvisioningStatus}`)),
    };
    return { provisioning, cli, order, row: () => row };
  }

  it("adds the members once the project is saved ready, and a failure leaves it ready", async () => {
    const f = fixture();
    await createProvisioner(f.provisioning, f.cli).enqueue(ID);
    expect(f.cli.addMembers).toHaveBeenCalledTimes(1);
    expect(f.cli.addMembers).toHaveBeenCalledWith(tenant);
    expect(f.order).toEqual(["members while ready"]);

    const g = fixture();
    g.cli.addMembers.mockRejectedValueOnce(new Error("boom"));
    await createProvisioner(g.provisioning, g.cli).enqueue(ID);
    expect(g.row()).toMatchObject({ BlocksProvisioningStatus: "ready", BlocksProjectRef: TENANT });
  });

  it("adds them after a reconciled creation too, and never when the creation is uncertain", async () => {
    const r = fixture({ BlocksProvisioningStatus: "needs-reconciliation", BlocksProvisioningName: "MADP A product x" });
    await createProvisioner(r.provisioning, r.cli).enqueue(ID);
    expect(r.cli.addMembers).toHaveBeenCalledTimes(1);

    const u = fixture();
    u.cli.create.mockRejectedValueOnce(new Error("timeout"));
    await createProvisioner(u.provisioning, u.cli).enqueue(ID);
    expect(u.row().BlocksProvisioningStatus).toBe("needs-reconciliation");
    expect(u.cli.addMembers).not.toHaveBeenCalled();
  });

  it("the provisioning CLI adds them as its own account, and runs every call outside the engine's folder", async () => {
    const cli = fakeCli();
    const api = fakeApi();
    const logs: string[] = [];
    const p = createProvisioningCli("default", cli.run as never, { members: [OWNER], store, fetch: api.fetch, log: (l) => logs.push(l) });
    await p.addMembers(tenant);
    expect(api.calls.filter((c) => c.url.endsWith(PEOPLE_INVITE))).toHaveLength(1);
    expect(logs).toEqual([expect.stringMatching(/^\[engine\] blocks members new project D177a85: 1 configured .*1 invited \(invited 1\)$/)]);
    expectClean(logs);
    await p.find("MADP Shop").catch(() => null);
    expect(cli.calls).toHaveLength(2);
    expect(cli.calls.every((c) => c.cwd === store && c.config === store)).toBe(true);
  });
});

describe("before a product's Blocks sign-in", () => {
  const DEV = TENANT;
  function fakeRun() {
    const logs: string[] = [];
    const lines: string[] = [];
    const run = {
      id: "job-1",
      projectId: "proj-1",
      p: { name: "Shop", project: {} },
      signal: new AbortController().signal,
      heartbeat: async () => undefined,
      log: (l: string) => void logs.push(l),
      check: () => undefined,
      step: async (_p: number, l: string) => void lines.push(l),
    } as unknown as JobRun;
    return { run, logs, lines };
  }
  function product(): BlocksTarget {
    const cli = writeFakeBlocksCli(path.join(tmp, "cli"));
    return { product: "Shop", name: "shop-1a2b3c", env: "dev", tenant: DEV, store: productStore("shop-1a2b3c", "dev"), account: "default", cliRunJs: cli.runJs };
  }
  beforeEach(() => {
    setEnv("MF_BLOCKS_PRODUCT_STORES", path.join(tmp, "stores"));
    setEnv("FAKE_CLI_LOG", path.join(tmp, "cli.log"));
    setEnv("FAKE_CLI_MODE", "approve");
    setEnv("FAKE_CLI_DELAY_MS", "100");
    setEnv("BLOCKS_CONFIG_DIR", undefined);
  });

  it("makes the members first, then shows the sign-in card, as the engine is set up", async () => {
    // the engine's settings and its `blocks` on PATH (the fake CLI), its provisioning store and the API
    const bin = writeFakeBlocksCli(path.join(tmp, "path-cli")).bin;
    setEnv("PATH", `${path.dirname(bin)}${path.delimiter}${process.env.PATH}`);
    setEnv("FAKE_PROJECTS", LISTED);
    setEnv("MF_BLOCKS_PROJECT_MEMBERS", OWNER);
    setEnv("MF_BLOCKS_PROVISIONING_ACCOUNT", "default");
    setEnv("BLOCKS_CONFIG_DIR", store);
    // the fake CLI on PATH does not refresh: the store's account session is fresh already
    const doc = JSON.parse(fs.readFileSync(path.join(store, "tokens.json"), "utf8"));
    doc.accounts.default.account = { ...doc.accounts.default.account, accessToken: TOKEN, expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
    fs.writeFileSync(path.join(store, "tokens.json"), JSON.stringify(doc));
    const api = fakeApi();
    vi.stubGlobal("fetch", api.fetch);

    const t = product();
    const r = fakeRun();
    expect(await connectBlocks(r.run, t, { step: r.run.step, pct: 4 })).toBe(true);
    expect(api.calls.map((c) => c.url)).toEqual([`${API}${PEOPLE_GETS}`, `${API}${PEOPLE_INVITE}`]);
    const calls = cliCalls(path.join(tmp, "cli.log")).map(([s, a]) => `${s === store ? "provisioning" : s === t.store ? "product" : s}|${a.split(" ").slice(0, 2).join(" ")}`);
    expect(calls).toEqual(["product|auth status", "provisioning|projects list", "product|login --account", "product|release repos", "product|use " + DEV, "product|auth status"]);
    expect(r.lines.some((l) => l.startsWith("Connect Shop to Blocks"))).toBe(true);
    expect(r.logs[0]).toMatch(/^blocks members shop-1a2b3c-dev: 1 configured .*1 invited \(invited 1\)$/);
    expectClean(r.logs);
  });

  it("goes on to the card when the member step fails, and skips it when the session is usable", async () => {
    const t = product();
    const addMembers = vi.fn(async () => {
      throw new Error("boom");
    });
    const r = fakeRun();
    expect(await connectBlocks(r.run, t, { step: r.run.step, pct: 4, addMembers })).toBe(true);
    expect(addMembers).toHaveBeenCalledWith(expect.objectContaining({ tenant: DEV, label: "shop-1a2b3c-dev" }));
    expect(r.lines.some((l) => l.startsWith("Connect Shop to Blocks"))).toBe(true);

    const again = vi.fn(async () => undefined);
    expect(await connectBlocks(fakeRun().run, t, { step: async () => undefined, pct: 4, addMembers: again })).toBe(false);
    expect(again).not.toHaveBeenCalled();
  });
});
