// The product's code in the change analysis (server/local/engine/official/fileMap.ts, kinds/changes/ai.ts): the FILE
// MAP's rules and folding (the official engine's feature-lane rules), the registry reader, the "The product's code"
// section of the analysis ask, and change.analyse with and without the product's repositories on the host. Stub runner,
// no Claude.
//   npx vitest run test/engine/codeAwareAnalysis.test.ts
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { parseChangeAnalysis } from "../../src/domain/changeAnalysis";
import { setAiRunner, type AiRequest } from "../../server/local/engine/ai/index.ts";
import { ProjectView } from "../../server/local/engine/context.ts";
import { acceptAnalysis, analysisPrompt, analysisSchema, changeNames, codeAreasOf } from "../../server/local/engine/kinds/changes/ai.ts";
import { appName } from "../../server/local/engine/official/app.ts";
import {
  fileMap,
  mapEntries,
  mapWanted,
  parseRegistry,
  parseYaml,
  pathInMap,
  productCode,
  readRegistry,
  renderFileMap,
  type MapEntry,
  type ProductCode,
} from "../../server/local/engine/official/fileMap.ts";
import { projectWorkspace } from "../../server/local/engine/projectFolder.ts";
import { makeWorld, type World } from "./harness";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "madp-code-aware-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" };
const lines = (n: number): string => Array.from({ length: n }, (_, i) => `const line${i} = ${i};`).join("\n") + (n ? "\n" : "");

/** A git repository with `tracked` files in its index (no commit needed) and `untracked` files beside them. */
function gitRepo(dir: string, tracked: Record<string, string>, untracked: Record<string, string> = {}): string {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync("git", ["-c", "init.defaultBranch=dev", "init", "-q"], { cwd: dir, env: gitEnv });
  for (const [rel, body] of Object.entries({ ...tracked, ...untracked })) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  execFileSync("git", ["add", "-f", "--", ...Object.keys(tracked)], { cwd: dir, env: gitEnv });
  return dir;
}

/** Every file below `dir` (the .git folder too) with its size and change time: the same before and after a read-only run. */
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

const key = (e: MapEntry) => `${e.dir}|${e.name}|${e.lines}`;

describe("the file map", () => {
  it("lists source and config files only, by the feature lane's rules", () => {
    for (const p of ["src/a.ts", "src/pages/Invoice.tsx", "styles/app.css", "api/main.py", "db/schema.sql", "package.json", "tsconfig.app.json", ".eslintrc.json", "components.json", "index.html", "src/routes/report.mjs"]) {
      expect(mapWanted(p), p).toBe(true);
    }
    for (const p of ["package-lock.json", "src/i18n/locales/en-US.json", "seed/data/rows.json", "dist/app.js", "web/node_modules/x/index.js", "public/vendor.min.js", "public/vendor.min.css", "src/app.js.map", "src/api.generated.ts", "build/out.js", "coverage/x.js", "README.md", "assets/logo.png", ".eslintrc", "pnpm-lock.yaml"]) {
      expect(mapWanted(p), p).toBe(false);
    }
  });

  it("reads a repository's tracked files with their line counts (git ls-files), and leaves the repository as it was", async () => {
    const dir = gitRepo(path.join(tmp, "one"), {
      "src/a.ts": lines(3),
      "src/b.tsx": "export const b = 1;\nexport const c = 2;", // no newline at the end: still 2 lines
      "src/deep/c.ts": lines(10),
      "package.json": "{}\n",
      "root.ts": "",
      "package-lock.json": "{}\n",
      "src/i18n/en-US.json": '{"a": "b"}\n',
      "dist/app.js": lines(5),
      "node_modules/x/index.js": lines(5),
      "public/v.min.js": lines(1),
      "README.md": "# Read me\n",
    }, { "src/untracked.ts": lines(4) });
    const before = snapshot(dir);
    const entries = await mapEntries(dir);
    expect(entries.map(key).sort()).toEqual(["|package.json|1", "|root.ts|0", "src/deep|c.ts|10", "src|a.ts|3", "src|b.tsx|2"].sort());
    const map = await fileMap([{ key: "web", dir }]);
    expect(map).toBe([
      "### `web` — 5 source files, 16 lines",
      "(root) (2 files, 1 lines): package.json 1, root.ts 0",
      "src/ (2 files, 5 lines): a.ts 3, b.tsx 2",
      "src/deep/ (1 file, 10 lines): c.ts 10",
    ].join("\n"));
    expect(snapshot(dir)).toEqual(before);
  });

  it("folds the smallest files first, then folders into summaries, then cuts, always within the budget", () => {
    const entries: MapEntry[] = [];
    for (let d = 0; d < 30; d++) for (let f = 0; f < 20; f++) entries.push({ dir: `src/area${d}/part`, name: `file${f}.ts`, lines: f * 10 + d });
    const full = renderFileMap(entries, 1e9);
    expect(full).not.toContain("smaller");
    expect(full.split("\n")).toHaveLength(30);

    const half = Math.floor(full.length / 2);
    const folded = renderFileMap(entries, half);
    expect(folded.length).toBeLessThanOrEqual(half);
    expect(folded).toMatch(/\+\d+ smaller/);
    expect(folded).toContain("file19.ts 190"); // the largest files stay named
    expect(folded).not.toMatch(/file0\.ts 0(,|$)/m); // the smallest are folded first
    expect(folded.split("\n")).toHaveLength(30); // every folder keeps its line

    const summary = renderFileMap(entries, 400);
    expect(summary.length).toBeLessThanOrEqual(400);
    expect(summary).toContain("src/ (600 files,");
    expect(summary).toContain("(directory summaries only: the full listing exceeds the map budget)");

    const flat = Array.from({ length: 50 }, (_, i): MapEntry => ({ dir: `pkg${i}`, name: "index.ts", lines: i }));
    const cut = renderFileMap(flat, 200);
    expect(cut.length).toBeLessThanOrEqual(200);
    expect(cut.endsWith("… (file map truncated)")).toBe(true);
  });

  it("shares the budget between repositories and says when one cannot be listed", async () => {
    const big: Record<string, string> = {};
    for (let d = 0; d < 40; d++) for (let f = 0; f < 8; f++) big[`src/mod${d}/file${f}.ts`] = lines(f + 1);
    const api = gitRepo(path.join(tmp, "two-api"), big);
    const web = gitRepo(path.join(tmp, "two-web"), Object.fromEntries(Object.entries(big).map(([k, v]) => [k.replace("src/", "src/ui/"), v])));
    const plain = path.join(tmp, "not-a-repo");
    fs.mkdirSync(plain, { recursive: true });
    fs.writeFileSync(path.join(plain, "a.ts"), lines(2));
    const map = await fileMap([{ key: "api", dir: api }, { key: "web", dir: web }, { key: "docs", dir: plain }], { maxChars: 3000 });
    expect(map.length).toBeLessThanOrEqual(3000);
    expect(map).toContain("### `api` — 320 source files");
    expect(map).toContain("### `web` — 320 source files");
    expect(map).toMatch(/\+\d+ smaller/);
    expect(map).toContain("### `docs`\n(file map unavailable: the repository could not be listed)");
    expect(map).not.toContain(tmp); // no host paths in the map
  });

  it("places a path the analysis names: a file, a folder, something new just below a folder, or nothing", () => {
    const entries: MapEntry[] = [{ dir: "src/pages", name: "Invoices.tsx", lines: 10 }, { dir: "", name: "package.json", lines: 1 }];
    expect(pathInMap(entries, "src/pages/Invoices.tsx")).toBe("file");
    expect(pathInMap(entries, "src/pages")).toBe("dir");
    expect(pathInMap(entries, "src")).toBe("dir");
    expect(pathInMap(entries, "src/pages/Reports.tsx")).toBe("new");
    expect(pathInMap(entries, "src/pages/reports/Aging.tsx")).toBe("new");
    expect(pathInMap(entries, "index.html")).toBe("new");
    expect(pathInMap(entries, "app/controllers/invoices.rb")).toBeNull();
  });
});

// PyYAML's own output (yaml.safe_dump(..., sort_keys=False, allow_unicode=True, width=100), as `madp new-app` and
// `madp project add` write registries) and a hand-edited registry, with what PyYAML's safe_load reads from them.
const DUMPED = `project: ledger-a1b2c3
description: 'Ledger — SELISE Blocks app (web + api), created by madp new-app: a two-repo accounting app
  with a long description that wraps'
standards:
  profile: selise-blocks-app
  file: MADP/profiles/selise-blocks-app/CLAUDE.md
agent_rules:
- Keep the current colour themes intact. Use the theme tokens (rgb(var(--brand-...)), --surface, --ink...)
  and never hard-code brand colours.
- 'Swiss-first: CHF with apostrophe thousands separators, 5-Rappen rounding, VAT 8.1 / 2.6 / 3.8 %. It''s
  "exact" or nothing: #1 rule.'
- 'yes'
- Short rule
- 'Line one

  line two'
- "Tab\\there: a rule with a tab forces double quotes and it is long enough that PyYAML has to wrap it\\
  \\ over lines   "
default_env: dev
environments:
  dev:
    branch: dev
    tenant_id: T0123
deploy: false
cli:
  run_js: C:\\path\\to\\api\\node_modules\\@seliseblocks\\cli-os\\bin\\run.js
  deploy_timeout: 1500
  env:
    BLOCKS_STRICT_FLAGS: '1'
repos:
  web:
    path: /srv/products/ledger/ledger-a1b2c3-web
    repo: org/ledger-a1b2c3-web
    branch: dev
    role: web
    keywords:
    - ui
    - page
    verify:
    - name: typecheck
      argv:
      - node
      - node_modules/typescript/bin/tsc
      - --noEmit
      - -p
      - tsconfig.app.json
    health: []
  api:
    path: /srv/products/ledger/ledger-a1b2c3-api
    repo: org/ledger-a1b2c3-api
    branch: dev
    role: api
    keywords: []
    verify: []
    health:
    - https://example.slsblx.com/health
    secrets_file: ''
`;
const DUMPED_JSON = {
  project: "ledger-a1b2c3",
  description: "Ledger — SELISE Blocks app (web + api), created by madp new-app: a two-repo accounting app with a long description that wraps",
  standards: { profile: "selise-blocks-app", file: "MADP/profiles/selise-blocks-app/CLAUDE.md" },
  agent_rules: [
    "Keep the current colour themes intact. Use the theme tokens (rgb(var(--brand-...)), --surface, --ink...) and never hard-code brand colours.",
    'Swiss-first: CHF with apostrophe thousands separators, 5-Rappen rounding, VAT 8.1 / 2.6 / 3.8 %. It\'s "exact" or nothing: #1 rule.',
    "yes",
    "Short rule",
    "Line one\nline two",
    "Tab\there: a rule with a tab forces double quotes and it is long enough that PyYAML has to wrap it over lines   ",
  ],
  default_env: "dev",
  environments: { dev: { branch: "dev", tenant_id: "T0123" } },
  deploy: false,
  cli: { run_js: "C:\\path\\to\\api\\node_modules\\@seliseblocks\\cli-os\\bin\\run.js", deploy_timeout: 1500, env: { BLOCKS_STRICT_FLAGS: "1" } },
  repos: {
    web: {
      path: "/srv/products/ledger/ledger-a1b2c3-web", repo: "org/ledger-a1b2c3-web", branch: "dev", role: "web", keywords: ["ui", "page"],
      verify: [{ name: "typecheck", argv: ["node", "node_modules/typescript/bin/tsc", "--noEmit", "-p", "tsconfig.app.json"] }], health: [],
    },
    api: { path: "/srv/products/ledger/ledger-a1b2c3-api", repo: "org/ledger-a1b2c3-api", branch: "dev", role: "api", keywords: [], verify: [], health: ["https://example.slsblx.com/health"], secrets_file: "" },
  },
};

const HAND = `# MADP project registry, edited by hand
project: shop   # the id
description: A shop on SELISE Blocks OS (React/Vite web + Node API)

agent_rules:
  - "Keep the theme: use \\"tokens\\", never hard-coded colours."
  - Do not break existing features.
    Everything that works today must keep working.
  - >
    Folded text
    over two lines.
  - |-
    Literal
      kept
  # a comment between items
  - 'single # not a comment'

repos:
  web:                              # repo key used with --target
    path: C:\\code\\shop-web            # absolute local clone
    role: web
    keywords: [ui, "button, big", page]   # flow list
    health: { }
  api: {path: /srv/shop-api, role: api}
deploy: no
count: 0012
ratio: 1.5
none: ~
`;
const HAND_JSON = {
  project: "shop",
  description: "A shop on SELISE Blocks OS (React/Vite web + Node API)",
  agent_rules: ['Keep the theme: use "tokens", never hard-coded colours.', "Do not break existing features. Everything that works today must keep working.", "Folded text over two lines.\n", "Literal\n  kept", "single # not a comment"],
  repos: { web: { path: "C:\\code\\shop-web", role: "web", keywords: ["ui", "button, big", "page"], health: {} }, api: { path: "/srv/shop-api", role: "api" } },
  deploy: false,
  count: 10,
  ratio: 1.5,
  none: null,
};

describe("the registry", () => {
  it("reads YAML as PyYAML writes and people edit it", () => {
    expect(parseYaml(DUMPED)).toEqual(DUMPED_JSON);
    expect(parseYaml(HAND)).toEqual(HAND_JSON);
    expect(parseYaml("")).toBeNull();
    expect(() => parseYaml("repos: [web, api")).toThrow();
    expect(() => parseYaml("a: *ref")).toThrow();
  });

  it("answers the description, the owner's rules and the repositories with their roles", () => {
    const r = parseRegistry(DUMPED)!;
    expect(r.project).toBe("ledger-a1b2c3");
    expect(r.agentRules).toHaveLength(6);
    expect(r.repos).toEqual([
      { key: "web", role: "web", path: "/srv/products/ledger/ledger-a1b2c3-web" },
      { key: "api", role: "api", path: "/srv/products/ledger/ledger-a1b2c3-api" },
    ]);
    expect(parseRegistry("project: x\nrepos: {}\n")).toBeNull(); // no repositories, nothing to read
    expect(parseRegistry("project: [unclosed\n")).toBeNull();
    expect(readRegistry(path.join(tmp, "missing.yml"))).toBeNull();
  });
});

describe("the product's code on the host", () => {
  const madp = path.join(tmp, "product", "madp");
  const name = "ledger-a1b2c3";
  let elsewhere = "";
  beforeAll(() => {
    fs.mkdirSync(madp, { recursive: true });
    // the api where the registry says (outside the folder), the web at the folder's own <name>-web
    elsewhere = gitRepo(path.join(tmp, "elsewhere", `${name}-api`), { "src/routes/invoices.ts": lines(40), "package.json": "{}\n" });
    gitRepo(path.join(madp, `${name}-web`), { "src/pages/Invoices.tsx": lines(120), "src/pages/Ledger.tsx": lines(80), "package.json": "{}\n" });
    fs.writeFileSync(path.join(madp, `${name}.yml`), DUMPED.replace("/srv/products/ledger/ledger-a1b2c3-api", elsewhere));
    fs.writeFileSync(path.join(madp, "factory.json"), JSON.stringify({ name, org: "org" }));
  });

  it("finds the registry and its repositories, and builds their map", async () => {
    const code = (await productCode(madp))!;
    expect(code.name).toBe(name);
    expect(code.description).toContain("two-repo accounting app");
    expect(code.agentRules[0]).toContain("Keep the current colour themes intact");
    expect(code.repos.map((r) => [r.key, r.role, r.entries?.length])).toEqual([["web", "web", 3], ["api", "api", 2]]);
    expect(code.map).toContain("### `web` — 3 source files, 201 lines");
    expect(code.map).toContain("src/pages/ (2 files, 200 lines): Invoices.tsx 120, Ledger.tsx 80");
    expect(code.map).toContain("src/routes/ (1 file, 40 lines): invoices.ts 40");
    expect(code.map).not.toContain(tmp);
  });

  it("finds the registry by the product's name, or as the folder's only registry, without factory.json", async () => {
    const other = path.join(tmp, "product-b", "madp");
    fs.mkdirSync(other, { recursive: true });
    gitRepo(path.join(other, "shop-web"), { "src/app.ts": lines(2) });
    fs.writeFileSync(path.join(other, "shop.yml"), "project: shop\nrepos:\n  web:\n    role: web\n");
    expect((await productCode(other, { name: "shop" }))?.repos.map((r) => r.key)).toEqual(["web"]);
    expect((await productCode(other, { name: "another-name" }))?.name).toBe("shop");
    fs.writeFileSync(path.join(other, "second.yml"), "project: second\nrepos:\n  web: {}\n");
    expect(await productCode(other, { name: "another-name" })).toBeNull(); // two registries and no name: none is guessed
  });

  it("is null, never an error, when the folder, the registry or every repository is missing", async () => {
    expect(await productCode(path.join(tmp, "nowhere", "madp"))).toBeNull();
    const empty = path.join(tmp, "empty", "madp");
    fs.mkdirSync(empty, { recursive: true });
    expect(await productCode(empty, { name })).toBeNull();
    fs.writeFileSync(path.join(empty, `${name}.yml`), "project: ledger\nrepos:\n  api:\n    path: /srv/does-not-exist/api\n");
    expect(await productCode(empty, { name })).toBeNull();
    fs.writeFileSync(path.join(empty, `${name}.yml`), "repos: {api: [unclosed\n");
    expect(await productCode(empty, { name })).toBeNull();
    fs.writeFileSync(path.join(empty, "factory.json"), "{ not json");
    expect(await productCode(empty, { name })).toBeNull();
  });

  it("still answers the repositories and rules when a repository cannot be listed", async () => {
    const odd = path.join(tmp, "odd", "madp");
    fs.mkdirSync(path.join(odd, "odd-api"), { recursive: true });
    fs.writeFileSync(path.join(odd, "odd.yml"), "project: odd\nagent_rules:\n- Keep it.\nrepos:\n  api:\n    role: api\n");
    const code = (await productCode(odd, { name: "odd" }))!;
    expect(code.repos).toEqual([{ key: "api", role: "api", entries: null }]);
    expect(code.agentRules).toEqual(["Keep it."]);
    expect(code.map).toContain("(file map unavailable");
  });
});

// ── the ask and the answer ───────────────────────────────────────────────────────────────────────────────────────

const PROJECT = "Service Technician Portal";
const s = (v: unknown) => (typeof v === "string" ? v : "");

function fakeCode(): ProductCode {
  return {
    name: "ledger-a1b2c3",
    description: "Ledger, a two-repo accounting app",
    agentRules: ["Keep the current colour themes intact.", "Never change posted figures."],
    repos: [
      { key: "api", role: "api", entries: [{ dir: "src/routes", name: "invoices.ts", lines: 40 }, { dir: "", name: "package.json", lines: 1 }] },
      { key: "web", role: "web", entries: [{ dir: "src/pages", name: "Invoices.tsx", lines: 120 }] },
    ],
    map: "### `api` — 2 source files, 41 lines\n(root) (1 file, 1 lines): package.json 1\nsrc/routes/ (1 file, 40 lines): invoices.ts 40\n\n### `web` — 1 source files, 120 lines\nsrc/pages/ (1 file, 120 lines): Invoices.tsx 120",
  };
}

function answerOf(names: ReturnType<typeof changeNames>, over: Record<string, unknown> = {}) {
  return {
    kind: "change",
    scopeChange: false,
    summary: "Invoices can be filtered by their due date, so overdue ones are found at once.",
    impact: { features: names.features.slice(0, 1), stories: [], screens: [], milestones: [] },
    conflicts: [],
    risks: ["The invoice list's API route is shared with the ledger export; its answer must stay the same."],
    acceptanceCriteria: ["The invoice list filters by due date.", "The ledger export is unchanged."],
    tickets: [{ title: "Due-date filter", description: "web: src/pages/Invoices.tsx gets a due-date filter; api: src/routes/invoices.ts accepts dueBefore." }],
    questions: [],
    ...over,
  };
}

describe("the analysis ask", () => {
  let w: World;
  let p: ProjectView;
  let cr: Row;
  beforeAll(async () => {
    w = await makeWorld();
    const pid = s(w.project(PROJECT).ItemId);
    p = new ProjectView(w.store, pid);
    cr = { Title: "Filter invoices by due date", Lane: "enhance", Number: 7, Description: "Accountants want to see overdue invoices first." };
  });
  afterAll(() => w?.close());

  it("carries the product's code when it is there: repositories, rules, file map and what to name", () => {
    const code = fakeCode();
    const prompt = analysisPrompt({ p, cr, material: "M", prior: null, refine: false, code });
    expect(prompt).toContain("The product's code (what is built today, read from its repositories):");
    expect(prompt).toContain("About the product: Ledger, a two-repo accounting app");
    expect(prompt).toContain("- `api` (api)\n- `web` (web)");
    expect(prompt).toContain("- Never change posted figures.");
    expect(prompt).toContain(`FILE MAP (the tracked source files of each repository`);
    expect(prompt).toContain(code.map);
    expect(prompt).toContain("- codeAreas: up to 12 files or folders");
    expect(prompt).toContain("Name the existing behaviour at risk");
    expect(prompt).toContain("Each description also names the repository and the files or folders the ticket changes");
    expect(prompt.indexOf("The product's code (what")).toBeGreaterThan(prompt.indexOf("What the client told us"));

    const schema = analysisSchema(changeNames(p), 3, code) as { properties: Record<string, { items?: { properties: { repo: { enum: string[] } } } }>; required: string[] };
    expect(schema.properties.codeAreas!.items!.properties.repo.enum).toEqual(["api", "web"]);
    expect(schema.required).toContain("codeAreas");
  });

  it("is the same ask as before without the product's code", () => {
    const plain = analysisPrompt({ p, cr, material: "M", prior: null, refine: false });
    expect(analysisPrompt({ p, cr, material: "M", prior: null, refine: false, code: null })).toBe(plain);
    for (const t of ["The product's code", "FILE MAP", "codeAreas", "Name the existing behaviour at risk", "files or folders the ticket changes"]) expect(plain).not.toContain(t);
    expect(plain).toContain("- risks: what could break or what needs care, plainly; empty when there is none.");
    const schema = analysisSchema(changeNames(p), 3) as { properties: Record<string, unknown>; required: string[] };
    expect(schema.properties.codeAreas).toBeUndefined();
    expect(schema.required).not.toContain("codeAreas");
  });

  it("keeps only the codeAreas that fit the code", () => {
    const code = fakeCode();
    const raw = [
      { repo: "web", path: "src/pages/Invoices.tsx" },
      { repo: "web", path: "./src/pages/" },
      { repo: "web", path: "src/pages/Overdue.tsx" },
      { repo: "api", path: "api/src/routes/invoices.ts" },
      { repo: "api", path: "src\\routes\\invoices.ts" },
      { repo: "web", path: "app/controllers/invoices.rb" },
      { repo: "mobile", path: "src/app.ts" },
      { repo: "web", path: "../../secrets.env" },
      { repo: "web", path: "C:/elsewhere/x.ts" },
      "web: src/pages/Invoices.tsx",
    ];
    expect(codeAreasOf(raw, code)).toEqual(["web: src/pages/Invoices.tsx", "web: src/pages/", "web: src/pages/Overdue.tsx", "api: src/routes/invoices.ts"]);
    expect(codeAreasOf("nope", code)).toEqual([]);

    const names = changeNames(p);
    const withCode = acceptAnalysis(answerOf(names, { codeAreas: raw }), { names, prior: null, contextVersion: 3, code });
    expect(withCode.codeAreas).toEqual(["web: src/pages/Invoices.tsx", "web: src/pages/", "web: src/pages/Overdue.tsx", "api: src/routes/invoices.ts"]);
    const none = acceptAnalysis(answerOf(names, { codeAreas: [{ repo: "web", path: "nowhere/at/all.ts" }] }), { names, prior: null, contextVersion: 3, code });
    expect("codeAreas" in none).toBe(false);
    const without = acceptAnalysis(answerOf(names, { codeAreas: ["web: src/pages/Invoices.tsx"] }), { names, prior: null, contextVersion: 3 });
    expect("codeAreas" in without).toBe(false);
    // stored and read back
    expect(parseChangeAnalysis(JSON.stringify(withCode))?.codeAreas).toEqual(withCode.codeAreas);
    expect("codeAreas" in parseChangeAnalysis(JSON.stringify(without))!).toBe(false);
  });
});

describe("change.analyse with the product's code on the host", () => {
  let w: World;
  let root = "";
  let pid = "";
  let calls: AiRequest[] = [];
  let crNumber = 80;
  const install = (fn: (r: AiRequest) => unknown) => setAiRunner(async (r) => { calls.push(r); return fn(r); });

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(tmp, "engine-root-"));
    w = await makeWorld({ engine: { projectFolder: (ws, id, o) => projectWorkspace(root, ws, id, o) } });
    pid = s(w.project(PROJECT).ItemId);
  });
  afterAll(() => w?.close());
  afterEach(() => {
    setAiRunner(null);
    calls = [];
  });

  async function analyse(title: string): Promise<{ job: Row; crId: string }> {
    const p = w.project(PROJECT);
    crNumber += 1;
    const res = await w.gw.insert("ChangeRequest", {
      WorkspaceId: p.WorkspaceId, ReaderIds: p.ReaderIds, CreatedByUserId: p.CreatedByUserId, UpdatedByUserId: p.CreatedByUserId,
      ProjectId: pid, Number: crNumber, Lane: "enhance", FeatureRef: "", Title: title, Description: "Accountants want to see overdue invoices first.",
      Status: "analysing", Version: "", RequestedByUserId: p.CreatedByUserId, EngineJobId: "", RequestKey: `t:code:${crNumber}`,
    });
    const crId = res.itemId!;
    const id = await w.queue({ project: PROJECT, kind: "change.analyse", input: { projectId: pid, changeRequestId: crId }, target: { type: "ChangeRequest", id: crId }, key: `code-${crId}` });
    await w.settle();
    return { job: w.get("EngineJob", id), crId };
  }

  it("analyses exactly as before when the product has no registry here", async () => {
    const names = changeNames(new ProjectView(w.store, pid));
    install(() => answerOf(names, { codeAreas: [{ repo: "web", path: "src/pages/Invoices.tsx" }] }));
    const { job, crId } = await analyse("Due-date filter, no code here");
    expect(job.Status, `${s(job.Message)}\n${w.log.slice(-10).join("\n")}`).toBe("succeeded");
    expect(calls[0]!.prompt).not.toContain("The product's code");
    expect((calls[0]!.schema as { properties: Record<string, unknown> }).properties.codeAreas).toBeUndefined();
    expect(calls[0]!.system).not.toContain("the product's code");
    expect("codeAreas" in parseChangeAnalysis(w.get("ChangeRequest", crId).Analysis)!).toBe(false);
  });

  it("reads the product's repositories read-only and names where the change lands", async () => {
    const p = w.project(PROJECT);
    const madp = path.join(projectWorkspace(root, s(p.WorkspaceId), pid).dir, "madp");
    const name = appName(PROJECT, pid);
    const api = gitRepo(path.join(madp, `${name}-api`), { "src/routes/invoices.ts": lines(40), "src/routes/ledger.ts": lines(60), "package.json": "{}\n" });
    const web = gitRepo(path.join(madp, `${name}-web`), { "src/pages/Invoices.tsx": lines(120), "src/i18n/en-US.json": "{}\n", "package.json": "{}\n" });
    // as `madp new-app` writes it: no factory.json name needed, the repos at <name>-<key>
    fs.writeFileSync(path.join(madp, `${name}.yml`), [
      `project: ${name}`,
      "description: An accounting app (web + api)",
      "agent_rules:",
      "- Never change posted figures.",
      "repos:",
      "  web:",
      "    role: web",
      "  api:",
      "    role: api",
      "",
    ].join("\n"));
    const before = [snapshot(api), snapshot(web)];

    const names = changeNames(new ProjectView(w.store, pid));
    install(() => answerOf(names, { codeAreas: [{ repo: "web", path: "src/pages/Invoices.tsx" }, { repo: "api", path: "src/routes/invoices.ts" }, { repo: "api", path: "lib/made-up/thing.ts" }] }));
    const { job, crId } = await analyse("Due-date filter on invoices");
    expect(job.Status, `${s(job.Message)}\n${w.log.slice(-10).join("\n")}`).toBe("succeeded");
    const ask = calls[0]!;
    expect(ask.prompt).toContain("The product's code (what is built today, read from its repositories):");
    expect(ask.prompt).toContain("- `web` (web)\n- `api` (api)");
    expect(ask.prompt).toContain("- Never change posted figures.");
    expect(ask.prompt).toContain("src/pages/ (1 file, 120 lines): Invoices.tsx 120");
    expect(ask.prompt).toContain("src/routes/ (2 files, 100 lines): invoices.ts 40, ledger.ts 60");
    expect(ask.prompt).not.toContain("en-US.json"); // locale JSON stays out of the map
    expect(ask.prompt).not.toContain(root); // no host paths in the ask
    expect(ask.system).toContain("the product's code");
    expect((ask.schema as { properties: { codeAreas: { items: { properties: { repo: { enum: string[] } } } } } }).properties.codeAreas.items.properties.repo.enum).toEqual(["web", "api"]);

    const a = parseChangeAnalysis(w.get("ChangeRequest", crId).Analysis)!;
    expect(a.codeAreas).toEqual(["web: src/pages/Invoices.tsx", "api: src/routes/invoices.ts"]);
    expect(w.get("ChangeRequest", crId).Status).toBe("review");
    expect(w.log.some((l) => /the product's code: web 2 files, api 3 files/.test(l))).toBe(true);
    // read-only: not one file of either repository (its .git folder included) changed
    expect([snapshot(api), snapshot(web)]).toEqual(before);
  });
});
