// product.document: a live product documented from its own code and documents (server/local/engine/kinds/document.ts).
// The readers of the product's sources (registry, module candidates, design tokens, git facts), the checks of the three
// answers (schema, evidence, internal terms, AI wording), and the writer on a fixture product: two local git
// repositories (web + api, branches dev and stg) in the project's engine folder, a stub runner, no network. The writer
// is checked for what it writes (every record marked Origin "live-product", nothing invented), that it runs again in
// place (people's edits kept, no duplicates), that the repositories stay as they were, and that it refuses a product
// that is not live or not attached.
//   npx vitest run --config test/engine/vitest.config.ts test/engine/documentProduct.test.ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { DOCUMENT_JOB_KIND, LIVE_PRODUCT_ORIGIN, documentRefusal, parseExistingDesignSystem, parseLiveProductSnapshot } from "../../src/domain/liveProduct";
import { ENGINE_JOB_KINDS, ENGINE_JOB_OUTPUTS, JOB_MAX_RUN_MS } from "../../src/domain/engineJob";
import { JOB_KIND_PERMISSION } from "../../functions/project/ops/jobs/permissions";
import { setAiRunner, type AiRequest } from "../../server/local/engine/ai/index.ts";
import { acceptModules, acceptPhases, acceptProfile } from "../../server/local/engine/kinds/document/ai.ts";
import { fallbackModules, languagesText, screenName } from "../../server/local/engine/kinds/document/plan.ts";
import { candidatesOf, colorOf, fontOfPackage, mergeCandidates, registryFacts, rootProperties, themesOf } from "../../server/local/engine/kinds/document/sources.ts";
import { termsOf } from "../../server/local/engine/kinds/document/terms.ts";
import { profilePatch } from "../../server/local/engine/kinds/document.ts";
import { projectWorkspace } from "../../server/local/engine/projectFolder.ts";
import { ProjectView } from "../../server/local/engine/context.ts";
import { hasFactoryScope } from "../../server/local/engine/kinds/changes/ai.ts";
import { makeWorld, type World } from "./harness";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "madp-document-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
const s = (v: unknown) => (typeof v === "string" ? v : "");
const terms = termsOf({} as NodeJS.ProcessEnv);

// ── the readers ─────────────────────────────────────────────────────────────────────────────────────────────────────

describe("the readers of the product's sources", () => {
  it("reads colours in every CSS form, the :root tokens, theme lists and typefaces", () => {
    expect(colorOf("#FF7A45")).toBe("#ff7a45");
    expect(colorOf("#abc")).toBe("#aabbcc");
    expect(colorOf("255 122 69")).toBe("#ff7a45");
    expect(colorOf("rgb(18, 160, 106)")).toBe("#12a06a");
    expect(colorOf("0 2px 8px -2px rgb(28 25 51 / 0.15)")).toBe("");
    expect(colorOf("var(--x)")).toBe("");
    const css = ":root,\n[data-theme=\"light\"] {\n  --coral: 255 122 69; /* #FF7A45 accent */\n  --radius-lg: 0.75rem;\n  --font-sans: 'Inter Variable', system-ui;\n}\n[data-theme=\"dark\"] { --coral: 1 2 3; }";
    expect(rootProperties(css)).toEqual([["coral", "255 122 69"], ["radius-lg", "0.75rem"], ["font-sans", "'Inter Variable', system-ui"]]);
    expect(themesOf(JSON.stringify([{ id: "teal", name: "Teal", signature: "#138086" }, { name: "No colour" }]))).toEqual([{ id: "teal", name: "Teal", color: "#138086" }]);
    expect(fontOfPackage("@fontsource-variable/plus-jakarta-sans")).toBe("Plus Jakarta Sans");
    expect(fontOfPackage("react")).toBe("");
  });

  it("finds the module candidates: screen folders and route files, plumbing left out, merged by name", () => {
    const e = (dir: string, name: string, lines = 10) => ({ dir, name, lines });
    const web = candidatesOf("web", "web", [e("src/pages/sales", "InvoicesPage.tsx"), e("src/pages/sales", "api.ts"), e("src/pages/purchases", "BillsPage.tsx"), e("src/pages/components", "Card.tsx"), e("src/lib", "x.ts")]);
    expect(web.map((p) => p.path)).toEqual(["src/pages/sales", "src/pages/purchases"]);
    const api = candidatesOf("api", "api", [e("src/routes", "sales.ts"), e("src/routes", "purchaseOrders.ts"), e("src/routes", "index.ts"), e("src/ledger", "posting.ts"), e("src/i18n", "en.ts"), e("src/mail", "send.ts")]);
    expect(api.map((p) => p.path).sort()).toEqual(["src/ledger", "src/mail", "src/routes/purchaseOrders.ts", "src/routes/sales.ts"]);
    const merged = mergeCandidates([...web, ...api]);
    expect(merged.find((c) => c.key === "sales")!.parts.map((p) => `${p.repo}:${p.path}`)).toEqual(["web:src/pages/sales", "api:src/routes/sales.ts"]);
    expect(merged.map((c) => c.key)).toContain("purchase-orders");
  });

  it("reads the registry's environments, branches, addresses and languages", () => {
    const r = registryFacts([
      "project: ledgerly",
      "description: Ledgerly accounting app (web + api)",
      "localization:",
      "  cultures: [en-US, de-CH]",
      "environments:",
      "  dev:",
      "    branch: dev",
      "  stg:",
      "    branch: stg",
      "    urls:",
      "      web: https://stage-web.example.test/",
      "repos:",
      "  web:",
      "    repo: example-org/ledgerly-web",
      "    branch: dev",
      "    role: web",
      "",
    ].join("\n"))!;
    expect(r.environments).toEqual({ dev: { branch: "dev", url: "" }, stage: { branch: "stg", url: "https://stage-web.example.test" } });
    expect(r.languages).toEqual(["en-US", "de-CH"]);
    expect(r.repos.web).toEqual({ branch: "dev", role: "web", repo: "example-org/ledgerly-web" });
    expect(languagesText(r.languages)).toBe("English, German (en-US, de-CH)");
  });

  it("names screens from their files, and modules from the code alone when there is no answer", () => {
    expect(screenName("ChartOfAccountsPage.tsx")).toBe("Chart of accounts");
    expect(screenName("VatReturnsPage.tsx")).toBe("Vat returns");
    expect(screenName("api.ts")).toBe("");
    const cands = mergeCandidates([
      { repo: "web", path: "src/pages/sales", kind: "dir", files: ["InvoicesPage.tsx", "QuotesPage.tsx"], lines: 50 },
      { repo: "api", path: "src/routes/sales.ts", kind: "file", files: [], lines: 20 },
      { repo: "api", path: "src/routes/jobs.ts", kind: "file", files: [], lines: 20 },
    ]);
    expect(fallbackModules(cands, { web: "web", api: "api" })).toEqual([{ key: "sales", title: "Sales", summary: "", capabilities: ["Invoices", "Quotes"], parts: ["sales"] }]);
  });
});

// ── the checks of the answers ───────────────────────────────────────────────────────────────────────────────────────

describe("the checks of the answers", () => {
  const evidence = ["registry", "code", "readme", "N1", "F1"];

  it("keeps only what names its evidence, drops internal terms and AI wording, and leaves the rest empty", () => {
    const a = acceptProfile({
      description: "Ledgerly keeps the books of small Swiss companies.",
      goal: "Built with Claude to automate bookkeeping.",
      users: [{ role: "Accountant", does: "Posts invoices.", evidence: "code" }, { role: "Auditor", does: "Checks.", evidence: "N9" }, { role: "AGIS clerk", does: "x", evidence: "code" }],
      client: { name: "Example AG", industry: "Accounting", region: "Switzerland", evidence: "code" },
      objective: { statement: "Ledgerly lets a company keep its books and file its VAT.", criteria: ["Invoices carry a QR-bill", "An AI agent checks every entry"] },
      workflows: [{ title: "Send an invoice", who: "Accountant", steps: ["Create it", "Send it"], modules: ["sales", "made-up"], evidence: "code" }, { title: "No evidence", who: "", steps: [], modules: [], evidence: "" }],
      constraints: [{ kind: "compliance", text: "Swiss VAT rates", evidence: "code" }, { kind: "other", text: "Matches the Zoho layout", evidence: "readme" }, { kind: "bogus", text: "x y z", evidence: "code" }],
      exclusions: [{ text: "No payroll", evidence: "code" }, { text: "No payroll module", evidence: "F1" }],
      successTargets: [{ key: "users", value: "500 companies", evidence: "code" }, { key: "outcome", value: "Month-end closed in a day", evidence: "N1" }],
    }, { evidence, moduleKeys: ["sales"], terms })!;
    expect(a.description).toBe("Ledgerly keeps the books of small Swiss companies.");
    expect(a.goal).toBe(""); // AI wording
    expect(a.users).toEqual([{ role: "Accountant", does: "Posts invoices.", evidence: "code" }]);
    expect(a.client).toEqual({ name: "", industry: "", region: "", evidence: "" }); // the code never names a client
    expect(a.objective.criteria).toEqual(["Invoices carry a QR-bill"]);
    expect(a.workflows).toEqual([{ title: "Send an invoice", who: "Accountant", steps: ["Create it", "Send it"], modules: ["sales"], evidence: "code" }]);
    expect(a.constraints).toEqual([{ kind: "compliance", text: "Swiss VAT rates", evidence: "code" }]);
    expect(a.exclusions).toEqual([{ text: "No payroll module", evidence: "F1" }]);
    expect(a.successTargets).toEqual([{ key: "outcome", value: "Month-end closed in a day", evidence: "N1" }]);
    expect(acceptProfile("not an object", { evidence, moduleKeys: [], terms })).toBeNull();
  });

  it("makes modules only of the candidates, each candidate once, and cleans their names", () => {
    const candidates = [{ key: "sales", parts: [] }, { key: "purchases", parts: [] }];
    const a = acceptModules({
      modules: [
        { key: "sales", title: "Sales (AGIS: Verkauf)", summary: "Quotes and invoices.", capabilities: ["Send invoices", "Generated by AI magic"], parts: ["sales", "ghost"] },
        { key: "sales", title: "Purchases", summary: "", capabilities: [], parts: ["purchases", "sales"] },
        { key: "x", title: "Ghost", summary: "", capabilities: [], parts: ["ghost"] },
      ],
      crossCutting: [
        { title: "Sign-in and roles", text: "People sign in; roles decide what they see.", category: "security", criteria: ["Only signed-in people see data"], evidence: "code" },
        { title: "Odoo parity", text: "Works like the benchmark.", category: "ux", criteria: [], evidence: "code" },
        { title: "No evidence", text: "Something true.", category: "ux", criteria: [], evidence: "N7" },
      ],
    }, { candidates, evidence, terms })!;
    expect(a.modules).toEqual([
      { key: "sales", title: "Sales", summary: "Quotes and invoices.", capabilities: ["Send invoices"], parts: ["sales"] },
      { key: "purchases-2", title: "Purchases", summary: "", capabilities: [], parts: ["purchases"] },
    ]);
    expect(a.crossCutting.map((c) => c.title)).toEqual(["Sign-in and roles"]);
    expect(acceptModules({ modules: [{ title: "Ghost", parts: ["ghost"] }] }, { candidates, evidence, terms })).toBeNull();
  });

  it("puts each known module into one phase, and answers nothing without a phase", () => {
    const a = acceptPhases({ phases: [{ name: "Sales first", goal: "Invoicing went live.", modules: ["sales", "nope"] }, { name: "Again", goal: "", modules: ["sales"] }, { name: "Purchases", goal: "", modules: ["purchases"] }] }, { moduleKeys: ["sales", "purchases"], terms })!;
    expect(a.phases).toEqual([{ name: "Sales first", goal: "Invoicing went live.", modules: ["sales"] }, { name: "Purchases", goal: "", modules: ["purchases"] }]);
    expect(acceptPhases({ phases: [{ name: "x", modules: ["nope"] }] }, { moduleKeys: ["sales"], terms })).toBeNull();
  });

  it("cleans internal terms out of a title and knows the host's private terms", () => {
    expect(terms.clean("Employment categories with default rates (AGIS: Anstellungskategorien)")).toBe("Employment categories with default rates");
    expect(terms.clean("Tariff hierarchy: rates should follow the AGIS rules")).toBe("Tariff hierarchy: rates should follow the rules");
    expect(terms.clean("Nothing internal here")).toBe("Nothing internal here");
    const file = path.join(tmp, "terms.txt");
    fs.writeFileSync(file, "# private\nProjectFalcon\n");
    const host = termsOf({ MF_PRIVATE_TERMS_FILE: file } as NodeJS.ProcessEnv);
    expect(host.internal("Built for projectfalcon")).toBe(true);
    expect(host.clean("Ledger (ProjectFalcon) app")).toBe("Ledger app");
    expect(terms.ai("Uses AI to post entries")).toBe(true);
    expect(terms.ai("Posts entries to the ledger")).toBe(false);
  });

  it("fills in only empty project fields, or the ones it wrote itself", () => {
    const planned = { Brief: "New text", Goal: "", TargetUsers: "Accountants", ClientName: "Example AG", ClientIndustry: "", ClientRegion: "" };
    const r = profilePatch({ Brief: "Old documented text", TargetUsers: "Our own words", ClientName: "" }, planned, { Brief: "Old documented text", TargetUsers: "Accountants" });
    expect(r.patch).toEqual({ Brief: "New text", ClientName: "Example AG" });
    expect(r.written).toEqual({ Brief: "New text", ClientName: "Example AG" });
  });
});

// ── the job on a fixture product ────────────────────────────────────────────────────────────────────────────────────

const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" };
function git(dir: string, args: string[], at = "2026-09-01T10:00:00Z"): string {
  return execFileSync("git", ["-c", "user.name=Dev", "-c", "user.email=dev@example.test", "-c", "commit.gpgsign=false", ...args], { cwd: dir, env: { ...gitEnv, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } }).toString();
}
function commit(dir: string, files: Record<string, string>, message: string, at: string): void {
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  git(dir, ["add", "-A"], at);
  git(dir, ["commit", "-q", "-m", message], at);
}
function snapshot(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const st = fs.statSync(p);
        out.push(`${path.relative(dir, p)} ${st.size} ${st.mtimeMs}`);
      }
    }
  };
  walk(dir);
  return out.sort();
}
const lines = (n: number) => Array.from({ length: n }, (_, i) => `export const l${i} = ${i};`).join("\n") + "\n";

const TOKENS = ":root,\n[data-theme=\"light\"] {\n  --coral: 255 122 69;\n  --success: 18 160 106;\n  --radius-lg: 0.75rem;\n}\n[data-theme=\"dark\"] {\n  --coral: 255 132 88;\n}\n";
const THEMES = JSON.stringify([{ id: "teal", name: "Teal", signature: "#138086" }, { id: "plum", name: "Plum", signature: "#522157" }]);

/** The product as the attach command leaves it in the project's engine folder: factory.json, the registry and two repos. */
function fixtureProduct(madp: string, name: string, o: { existing?: boolean } = {}): { web: string; api: string; stgHead: string } {
  fs.mkdirSync(madp, { recursive: true });
  fs.writeFileSync(path.join(madp, "factory.json"), JSON.stringify({ name, org: "example-org", existing: o.existing !== false, data: true, url: "https://dev-web.example.test" }));
  fs.writeFileSync(path.join(madp, `${name}.yml`), [
    `project: ${name}`,
    "description: Ledgerly accounting app for small Swiss companies (web + api)",
    "agent_rules:",
    "- Keep the current colour themes intact.",
    "localization:",
    "  cultures: [en-US, de-CH]",
    "environments:",
    "  dev:",
    "    branch: dev",
    "  stg:",
    "    branch: stg",
    "    urls:",
    "      web: https://stage-web.example.test",
    "repos:",
    "  web:",
    "    repo: example-org/ledgerly-web",
    "    branch: dev",
    "    role: web",
    "  api:",
    "    repo: example-org/ledgerly-api",
    "    branch: dev",
    "    role: api",
    "",
  ].join("\n"));
  const web = path.join(madp, `${name}-web`);
  const api = path.join(madp, `${name}-api`);
  for (const d of [web, api]) {
    fs.mkdirSync(d, { recursive: true });
    git(d, ["-c", "init.defaultBranch=dev", "init", "-q"]);
  }
  commit(web, {
    "package.json": JSON.stringify({ name: "ledgerly-web", version: "0.2.0", dependencies: { "@fontsource-variable/plus-jakarta-sans": "^5.0.0", react: "^18.0.0" } }),
    "README.md": "# Ledgerly web\n\nThe accounting app's screens: sales, purchases and settings.\n",
    "src/styles/tokens.css": TOKENS,
    "scripts/themes.source.json": THEMES,
    "src/pages/sales/InvoicesPage.tsx": lines(120),
    "src/pages/sales/QuotesPage.tsx": lines(80),
    "src/pages/auth/LoginPage.tsx": lines(30),
  }, "feat(sales): invoices and quotes", "2026-09-01T10:00:00Z");
  git(web, ["branch", "stg"], "2026-09-02T10:00:00Z");
  const stgHead = git(web, ["rev-parse", "stg"]).trim();
  commit(web, { "src/pages/purchases/BillsPage.tsx": lines(60), "package.json": JSON.stringify({ name: "ledgerly-web", version: "0.3.0", dependencies: { "@fontsource-variable/plus-jakarta-sans": "^5.0.0" } }) }, "feat(purchases): bills", "2026-10-01T10:00:00Z");
  commit(api, {
    "package.json": JSON.stringify({ name: "ledgerly-api", version: "0.3.0" }),
    "src/routes/sales.ts": lines(40),
    "src/routes/purchases.ts": lines(30),
    "src/routes/auth.ts": lines(20),
    "blocks/data/schemas/Invoice.json": "{}\n",
    "blocks/data/schemas/Bill.json": "{}\n",
  }, "feat: routes", "2026-09-01T11:00:00Z");
  git(api, ["branch", "stg"], "2026-09-02T10:00:00Z");
  return { web, api, stgHead };
}

/** The answers of a model that tries to slip in what the sources do not say. */
function answers(r: AiRequest, o: { modules?: string[] } = {}): unknown {
  if (r.prompt.includes("Document the profile of")) {
    return {
      description: "Ledgerly keeps the books of small Swiss companies: sales, purchases and VAT.",
      goal: "",
      users: [{ role: "Accountant", does: "Posts invoices and bills.", evidence: "code" }, { role: "AGIS clerk", does: "Checks rates.", evidence: "code" }],
      client: { name: "Example AG", industry: "", region: "", evidence: "code" },
      objective: { statement: "Ledgerly lets a small company keep its books and file its VAT.", criteria: ["Invoices and bills are posted to the ledger", "Made by an AI"] },
      workflows: [{ title: "Send an invoice", who: "Accountant", steps: ["Create the invoice", "Send it to the customer"], modules: ["sales"], evidence: "code" }],
      constraints: [{ kind: "compliance", text: "Swiss VAT rates", evidence: "code" }],
      exclusions: [],
      successTargets: [{ key: "users", value: "500 companies", evidence: "code" }],
    };
  }
  if (r.prompt.includes("List the modules of")) {
    const all = [
      { key: "sales", title: "Sales", summary: "Quotes and invoices for customers.", capabilities: ["Create quotes", "Send invoices", "Generated by AI magic"], parts: ["sales"] },
      { key: "purchases", title: "Purchases", summary: "Bills from suppliers.", capabilities: ["Record bills"], parts: ["purchases"] },
    ];
    return {
      modules: all.filter((m) => !o.modules || o.modules.includes(m.key)),
      crossCutting: [{ title: "Sign-in and roles", text: "People sign in, and their role decides what they see.", category: "security", criteria: ["Only signed-in people see the books"], evidence: "code" }],
    };
  }
  if (r.prompt.includes("Group the live modules of")) {
    const keys = o.modules ?? ["sales", "purchases"];
    return { phases: keys.map((k) => ({ name: k === "sales" ? "Sales first" : "Purchases", goal: k === "sales" ? "Invoicing went live." : "Supplier bills went live.", modules: [k] })) };
  }
  throw new Error("unexpected ask");
}

describe("product.document on a live product", () => {
  let w: World;
  let root = "";
  const calls: AiRequest[] = [];
  let n = 0;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(tmp, "engine-root-"));
    w = await makeWorld({ engine: { projectFolder: (ws, id, o) => projectWorkspace(root, ws, id, o) } });
  });
  afterAll(() => w?.close());
  afterEach(() => setAiRunner(null));

  /** A live product like PrimaBook: an existing product with one dev release and no Business Analysis records. */
  async function liveProject(name: string, over: Row = {}): Promise<{ pid: string; madp: string; base: Row }> {
    const base = w.project("Service Technician Portal");
    const stamp = { WorkspaceId: base.WorkspaceId, ReaderIds: base.ReaderIds, CreatedByUserId: base.CreatedByUserId, UpdatedByUserId: base.CreatedByUserId };
    const res = await w.gw.insert("Project", { ...stamp, Name: name, Stage: "release", Status: "active", RepoMode: "existing", RepoProvider: "github", RepoOwner: "example-org", RepoName: "ledgerly-web", RepoBranch: "dev", CurrentScopeVersion: 1, Rev: 3, AppUrl: "https://dev-web.example.test", RequestKey: `t:doc:${name}`, ...over });
    const pid = res.itemId!;
    await w.gw.insert("Release", { ...stamp, ProjectId: pid, Environment: "dev", Version: "0.1.0", Url: "https://dev-web.example.test", Status: "released", ChangeRequestIds: [], ReleasedAt: "2026-11-05T02:17:00.000Z", ReleasedByUserId: s(base.CreatedByUserId), EngineJobId: "", RequestKey: `t:doc:${name}:release` });
    const cr = (num: number, title: string, status: string, version = "") =>
      w.gw.insert("ChangeRequest", { ...stamp, ProjectId: pid, Number: num, Lane: "change", FeatureRef: "", Title: title, Description: "From the client.", Status: status, Version: version, RequestedByUserId: s(base.CreatedByUserId), EngineJobId: "", RequestKey: `t:doc:${name}:cr:${num}` });
    await cr(1, "Profile: rename the Save preferences button", "released-dev", "0.2.0");
    await cr(2, "Employment categories with default rates (AGIS: Anstellungskategorien)", "review");
    const madp = path.join(projectWorkspace(root, s(base.WorkspaceId), pid).dir, "madp");
    return { pid, madp, base };
  }

  async function document(name: string): Promise<Row> {
    n += 1;
    const id = await w.queue({ project: name, kind: DOCUMENT_JOB_KIND, input: { projectId: w.project(name).ItemId }, key: `doc-${n}` });
    await w.settle();
    return w.get("EngineJob", id);
  }

  const mine = (schema: string, pid: string) => w.rows(schema, pid).filter((r) => r.IsDeleted !== true && r.Origin === LIVE_PRODUCT_ORIGIN);

  it("documents every section from the sources, marks it, invents nothing and leaves the code as it was", async () => {
    const { pid, madp } = await liveProject("Ledgerly");
    const { web, api, stgHead } = fixtureProduct(madp, "ledgerly");
    const before = [snapshot(web), snapshot(api)];
    setAiRunner(async (r) => {
      calls.push(r);
      return answers(r);
    });
    const job = await document("Ledgerly");
    expect(job.Status, `${s(job.Message)}\n${w.log.slice(-15).join("\n")}`).toBe("succeeded");
    expect(s(job.Message)).toMatch(/^Documented the live product: 2 modules, 3 requirements, 4 milestones and the design system/);

    // the asks: the product's code and registry, no host paths
    expect(calls.map((c) => (c.prompt.includes("Document the profile") ? "profile" : c.prompt.includes("List the modules") ? "modules" : "phases")).sort()).toEqual(["modules", "phases", "profile"]);
    const modulesAsk = calls.find((c) => c.prompt.includes("List the modules"))!;
    expect(modulesAsk.prompt).toContain("- sales: web:src/pages/sales [InvoicesPage.tsx, QuotesPage.tsx] (200 lines); api:src/routes/sales.ts (40 lines)");
    expect(modulesAsk.prompt).toContain("Data tables (2): Bill, Invoice");
    expect(modulesAsk.prompt).toContain("Languages the product is translated into (registry): en-US, de-CH");
    for (const c of calls) expect(c.prompt).not.toContain(root);
    calls.length = 0;

    // the profile: what the sources give; the goal and the client stay empty
    const p = w.get("Project", pid);
    expect(p.Brief).toBe("Ledgerly keeps the books of small Swiss companies: sales, purchases and VAT.");
    expect(p.TargetUsers).toBe("Accountant: Posts invoices and bills.");
    expect(s(p.Goal)).toBe("");
    expect(s(p.ClientName)).toBe("");
    expect(p.Rev).toBe(4);
    expect(p.Stage).toBe("release");
    expect(p.ScopeLockedAt ?? null).toBeNull();
    const snap = parseLiveProductSnapshot(p.LiveProductJson)!;
    expect(snap.product).toBe("ledgerly");
    expect(snap.environments.map((e) => [e.environment, e.branch, e.url, e.version])).toEqual([
      ["dev", "dev", "https://dev-web.example.test", "0.3.0"],
      ["stage", "stg", "https://stage-web.example.test", "0.2.0"],
    ]);
    expect(snap.environments[1]!.commits.find((c) => c.repo === "web")!.commit).toBe(stgHead);
    expect(snap.modules.map((m) => [m.key, m.title, m.paths])).toEqual([["sales", "Sales", ["web/src/pages/sales", "api/src/routes/sales.ts"]], ["purchases", "Purchases", ["web/src/pages/purchases", "api/src/routes/purchases.ts"]]]);
    expect(snap.releases.find((r) => r.environment === "dev")).toMatchObject({ version: "0.1.0", commit: "", documented: false });
    expect(snap.leftEmpty).toEqual(expect.arrayContaining([
      "The goal: no source states it.", "The client: no source names it.", "The success targets: no note or file states them.", "The commit of one release was not recorded when it was released.",
    ]));
    expect(snap.profile).toEqual({ Brief: p.Brief, TargetUsers: p.TargetUsers });

    // the objective, the requirements (one per module, then the cross-cutting one) and the features
    const [objective] = mine("Objective", pid);
    expect(objective).toMatchObject({ Status: "confirmed", Statement: "Ledgerly lets a small company keep its books and file its VAT.", AcceptanceCriteria: ["Invoices and bills are posted to the ledger"] });
    expect(s(objective!.HighLevelMd)).toContain("## Users and roles\n- **Accountant**: Posts invoices and bills.");
    expect(s(objective!.ArchitectureMd)).toContain("2 data tables: Bill, Invoice.");
    const reqs = mine("Requirement", pid).sort((a, b) => Number(a.SortOrder) - Number(b.SortOrder));
    expect(reqs.map((r) => [r.Key, r.Title, r.Category, r.Status, r.Priority])).toEqual([
      ["sales", "Sales", "functional", "confirmed", "must"],
      ["purchases", "Purchases", "functional", "confirmed", "must"],
      ["sign-in-and-roles", "Sign-in and roles", "security", "confirmed", "must"],
    ]);
    expect(reqs[0]!.AcceptanceCriteria).toEqual(["Create quotes", "Send invoices"]);
    expect(reqs[0]!.SourceRefs).toEqual(["live-product:web/src/pages/sales", "live-product:api/src/routes/sales.ts"]);
    expect(reqs[2]!.SourceRefs).toEqual(["live-product:code"]);
    const features = mine("Feature", pid);
    expect(features.map((f) => [f.Key, f.Status, f.RequirementRefs, f.ScopeVersion])).toEqual([["sales", "planned", ["requirement:sales"], 1], ["purchases", "planned", ["requirement:purchases"], 1]]);
    expect(mine("ScopeVersion", pid)).toEqual([expect.objectContaining({ Number: 1, Status: "locked", Title: "The live product" })]);
    expect(s(mine("ScopeVersion", pid)[0]!.SuccessTargets)).toBe("");
    // the documented modules describe what is built: a change request is still about the product as a whole
    expect(hasFactoryScope(new ProjectView(w.store, pid))).toBe(false);

    // the milestones: the phases, then the change requests (released, then open), no internal names
    const ms = mine("Milestone", pid).sort((a, b) => Number(a.SortOrder) - Number(b.SortOrder));
    expect(ms.map((m) => [m.Name, m.Status, m.FeatureRefs])).toEqual([
      ["Sales first", "done", ["feature:sales"]],
      ["Purchases", "done", ["feature:purchases"]],
      ["CR-001: Profile: rename the Save preferences button", "done", []],
      ["CR-002: Employment categories with default rates", "planned", []],
    ]);
    expect(s(ms[0]!.Goal)).toBe("Invoicing went live. In the code since 1 Sept 2026.");
    expect(s(ms[2]!.Goal)).toBe("Released to development in version 0.2.0.");

    // workflows and constraints: the model's, plus the languages from the registry
    const extras = mine("RequirementExtra", pid);
    expect(extras.map((e) => [e.Kind, e.Title, e.ConstraintKind])).toEqual([
      ["workflow", "Send an invoice", ""],
      ["constraint", "Swiss VAT rates", "compliance"],
      ["constraint", "English, German (en-US, de-CH)", "languages"],
    ]);

    // the existing design system
    const [brief] = mine("DesignBrief", pid);
    expect(brief).toMatchObject({ Mode: "describe", Status: "confirmed" });
    const design = parseExistingDesignSystem(brief!.PrototypeJson)!;
    expect(design.themes.map((t) => t.name)).toEqual(["Teal", "Plum"]);
    expect(design).toMatchObject({ repo: "web", fonts: ["Plus Jakarta Sans"], modes: ["light", "dark"], radius: { "radius-lg": "0.75rem" } });
    expect(design.colors).toEqual({ coral: "#ff7a45", success: "#12a06a" });
    expect(design.files).toEqual(["src/styles/tokens.css", "scripts/themes.source.json"]);
    expect(s(brief!.Instructions)).toContain("2 colour themes (Teal, Plum)");

    // the stage release the Factory did not know; the Factory's own dev release is left as it is
    const releases = w.rows("Release", pid);
    expect(releases.filter((r) => r.Environment === "dev").map((r) => [r.Version, s(r.SourceCommit), s(r.Origin)])).toEqual([["0.1.0", "", ""]]);
    expect(releases.filter((r) => r.Environment === "stage").map((r) => [r.Version, r.Url, r.SourceCommit, r.Origin, r.Status])).toEqual([["0.2.0", "https://stage-web.example.test", stgHead, LIVE_PRODUCT_ORIGIN, "released"]]);

    // nothing people see names an internal term or the AI
    const written = ["Objective", "Requirement", "Feature", "Milestone", "ScopeVersion", "DesignBrief", "RequirementExtra"].flatMap((sc) => mine(sc, pid));
    const text = JSON.stringify([...written, { Brief: p.Brief, TargetUsers: p.TargetUsers }]);
    expect(text).not.toMatch(/AGIS|\bAI\b|Claude|Generated by|\[private\]/i);
    expect(text).not.toContain("500 companies"); // a target no note or file states
    expect(text).not.toContain("Example AG"); // a client the code cannot name

    // the Wiki and Produced are rebuilt from the records
    const follow = w.rows("EngineJob", pid).filter((j) => j.Kind === "wiki.generate" || j.Kind === "docs.generate");
    expect(follow.map((j) => j.Kind).sort()).toEqual(["docs.generate", "wiki.generate"]);
    expect((job.OutputRefs as string[]).filter((r) => r.startsWith("EngineJob:"))).toHaveLength(2);
    expect(w.rows("WikiPage", pid).length).toBeGreaterThan(0);

    // read-only: not one file of either repository (its .git folder included) changed
    expect([snapshot(web), snapshot(api)]).toEqual(before);
  });

  it("runs again in place: no duplicates, people's edits kept, what is gone is dropped", async () => {
    const pid = s(w.project("Ledgerly").ItemId);
    const person = "00000000-0000-4000-8000-0000000000aa";
    const sales = mine("Requirement", pid).find((r) => r.Key === "sales")!;
    await w.gw.update("Requirement", s(sales.ItemId), { Title: "Sales and invoicing", UpdatedByUserId: person });
    await w.gw.update("Project", pid, { Goal: "Our own goal", TargetUsers: "Accountants and auditors", UpdatedByUserId: person });
    const ids = (sc: string) => mine(sc, pid).map((r) => s(r.ItemId)).sort();
    const before = { req: ids("Requirement"), feat: ids("Feature"), obj: ids("Objective"), sv: ids("ScopeVersion"), brief: ids("DesignBrief"), extras: ids("RequirementExtra") };
    const stage = w.rows("Release", pid).filter((r) => r.Environment === "stage").length;
    setAiRunner(async (r) => answers(r, { modules: ["sales"] }));
    const job = await document("Ledgerly");
    expect(job.Status, `${s(job.Message)}\n${w.log.slice(-15).join("\n")}`).toBe("succeeded");

    expect({ req: ids("Requirement"), feat: ids("Feature"), obj: ids("Objective"), sv: ids("ScopeVersion"), brief: ids("DesignBrief"), extras: ids("RequirementExtra") }).toEqual(before);
    const reqs = mine("Requirement", pid);
    expect(reqs.find((r) => r.Key === "sales")!.Title).toBe("Sales and invoicing"); // the person's edit stays
    expect(reqs.find((r) => r.Key === "purchases")!.Status).toBe("dropped");
    expect(mine("Feature", pid).find((f) => f.Key === "purchases")!.Status).toBe("dropped");
    expect(mine("Milestone", pid).map((m) => m.Name)).toEqual(["Sales first", "CR-001: Profile: rename the Save preferences button", "CR-002: Employment categories with default rates"]);
    const p = w.get("Project", pid);
    expect(p.Goal).toBe("Our own goal");
    expect(p.TargetUsers).toBe("Accountants and auditors");
    expect(parseLiveProductSnapshot(p.LiveProductJson)!.profile).toEqual({ Brief: p.Brief });
    expect(w.rows("Release", pid).filter((r) => r.Environment === "stage")).toHaveLength(stage);
  });

  it("documents from the code alone when no answer comes: modules from the screen folders, nothing guessed", async () => {
    const { pid, madp } = await liveProject("Ledgerly Two");
    fixtureProduct(madp, "ledgerly-two");
    const job = await document("Ledgerly Two"); // no runner installed: the engine's AI is off in tests
    expect(job.Status, `${s(job.Message)}\n${w.log.slice(-15).join("\n")}`).toBe("succeeded");
    // the web app's screen folders in the code's order, each with its screens
    expect(mine("Requirement", pid).map((r) => [r.Key, r.Title, r.AcceptanceCriteria])).toEqual([
      ["auth", "Auth", ["Login"]],
      ["purchases", "Purchases", ["Bills"]],
      ["sales", "Sales", ["Invoices", "Quotes"]],
    ]);
    expect(mine("Requirement", pid).find((r) => r.Key === "sales")!.Text).toBe("Sales: Invoices; Quotes.");
    const p = w.get("Project", pid);
    expect(p.Brief).toBe("Ledgerly accounting app for small Swiss companies (web + api)"); // the registry's own words
    expect(s(p.TargetUsers)).toBe("");
    expect(mine("Milestone", pid).map((m) => m.Name)).toEqual(["The product as it is live", "CR-001: Profile: rename the Save preferences button", "CR-002: Employment categories with default rates"]);
    expect(mine("RequirementExtra", pid).map((e) => e.Title)).toEqual(["English, German (en-US, de-CH)"]);
  });

  it("refuses a product that is not existing, not live or not attached on the engine host", async () => {
    const fresh = await liveProject("Not Existing", { RepoMode: "new" });
    fixtureProduct(fresh.madp, "not-existing");
    const a = await document("Not Existing");
    expect([a.Status, a.ErrorCode]).toEqual(["failed", "document.notExisting"]);

    const detached = await liveProject("Not Attached");
    fixtureProduct(detached.madp, "not-attached", { existing: false });
    const b = await document("Not Attached");
    expect([b.Status, b.ErrorCode]).toEqual(["failed", "document.notAttached"]);

    const nowhere = await liveProject("No Code");
    const c = await document("No Code");
    expect([c.Status, c.ErrorCode]).toEqual(["failed", "document.notAttached"]);
    for (const pid of [fresh.pid, detached.pid, nowhere.pid]) expect(mine("Requirement", pid)).toEqual([]);
  });
});

describe("the job kind", () => {
  it("is a kind with its outputs, time limit, permission and refusals", () => {
    expect(ENGINE_JOB_KINDS).toContain(DOCUMENT_JOB_KIND);
    expect(ENGINE_JOB_OUTPUTS[DOCUMENT_JOB_KIND]).toEqual(expect.arrayContaining(["Project", "Objective", "Requirement", "Feature", "Milestone", "ScopeVersion", "DesignBrief", "Release", "RequirementExtra", "EngineJob"]));
    expect(JOB_MAX_RUN_MS[DOCUMENT_JOB_KIND]).toBe(30 * 60_000);
    expect(JOB_KIND_PERMISSION[DOCUMENT_JOB_KIND]).toEqual(["business.edit"]);
    const live = [{ Status: "released" }];
    expect(documentRefusal({ RepoMode: "existing", Stage: "release" }, live)).toBeNull();
    expect(documentRefusal({ RepoMode: "new", Stage: "release" }, live)).toBe("notExisting");
    expect(documentRefusal({ RepoMode: "existing", Stage: "release" }, [{ Status: "failed" }])).toBe("notLive");
    expect(documentRefusal({ RepoMode: "existing", Stage: "paused" }, live)).toBe("paused");
    expect(documentRefusal({ RepoMode: "existing", Status: "deleting" }, live)).toBe("notFound");
    expect(documentRefusal(null, live)).toBe("notFound");
  });
});
