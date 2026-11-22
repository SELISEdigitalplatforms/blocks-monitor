// Translations after a deploy (official/uilm.ts): after a build or change lane, the modules whose dictionaries the
// lane's commits changed go to Blocks Localization through the official uilm lane: plan (dry run), the safety
// comparison against what Blocks holds (--pull into a scratch copy), then the push. Temp git repos for real; the lane
// runner is a fake that plays the uilm lane's JSON (and its --pull merge into the --repo-path copy). No Blocks call.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OfficialApp } from "../../server/local/engine/official/app.ts";
import type { LaneOptions, LaneResult } from "../../server/local/engine/official/madp.ts";
import {
  SYNCED_LINE,
  changedModules,
  dictionaryName,
  failedLine,
  flatten,
  isUilmPlaceholder,
  localizationOf,
  portalLine,
  problemLine,
  problemsLine,
  readRecord,
  syncTexts,
  withTexts,
  type DictProblem,
  type Localization,
} from "../../server/local/engine/official/uilm.ts";

const DIR = "src/i18n/locales";
const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "init.defaultBranch=dev", ...args], { cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull } }).trim();
}

type Dicts = Record<string, Record<string, unknown>>;

function writeDicts(repo: string, files: Dicts): void {
  for (const [name, body] of Object.entries(files)) {
    const f = path.join(repo, DIR, name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `${JSON.stringify(body, null, 2)}\n`);
  }
}

/** A lane's commit of these files; answers the 9-character sha the lanes print. */
function commit(repo: string, files: Dicts, msg = "feat(app): change"): string {
  writeDicts(repo, files);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", msg);
  return git(repo, "rev-parse", "HEAD").slice(0, 9);
}

const BASE: Dicts = {
  "profile.en-US.json": { profile: { title: "Your profile", actions: { save: "Save" } } },
  "profile.de-CH.json": { profile: { title: "Ihr Profil", actions: { save: "Speichern" } } },
  "sales.en-US.json": { invoice: { title: "Invoices" } },
  "sales-invoices.en-US.json": { invoice: { actions: { issue: "Issue" } } },
};

function product(o: { localization?: boolean; parts?: "merge" | "separate" } = {}): { app: OfficialApp; repo: string; store: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-uilm-test-"));
  made.push(root);
  const dir = path.join(root, "madp");
  const repo = path.join(dir, "shop-ab12cd-app");
  fs.mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "dev");
  commit(repo, BASE, "initial");
  const store = path.join(root, "stores", "shop-ab12cd-dev");
  const yml = [
    "project: shop-ab12cd",
    "default_env: dev",
    "environments:",
    "  dev:",
    "    branch: dev",
    `    tenant_id: D${"a".repeat(32)}`,
    `    cli_config_dir: ${store}`,
    "repos:",
    "  app:",
    `    path: ${repo}`,
    "    repo: example-org/shop-ab12cd",
    "    branch: dev",
    "    role: web",
    ...(o.localization === false
      ? []
      : ["localization:", "  repo: app", `  dir: ${DIR}`, "  source: en-US", "  cultures: [en-US, de-CH]", "  key_style: dot", `  parts: ${o.parts ?? "merge"}`]),
    "",
  ].join("\n");
  const registry = path.join(dir, "shop-ab12cd.yml");
  fs.writeFileSync(registry, yml);
  return { app: { name: "shop-ab12cd", dir, registry, org: "example-org", repos: { app: repo }, tenant: `D${"a".repeat(32)}`, url: "https://shop.example.test" }, repo, store };
}

const fakeRun = () => {
  const lines: string[] = [];
  const steps: string[] = [];
  return {
    id: "job-uilm-1",
    signal: new AbortController().signal,
    log: (l: string) => void lines.push(l),
    iso: () => "2026-11-05T10:00:00.000Z",
    heartbeat: async () => undefined,
    check: () => undefined,
    lines,
    steps,
  };
};

const flag = (args: string[], k: string): string => (args.includes(k) ? args[args.indexOf(k) + 1]! : "");
const modeOf = (args: string[]): "plan" | "pull" | "yes" => (args.includes("--pull") ? "pull" : args.includes("--yes") ? "yes" : "plan");

interface Call {
  mode: "plan" | "pull" | "yes";
  args: string[];
  o: LaneOptions;
  /** The --repo-path copy's dictionaries when the lane ran (flat, per file name). */
  copy: Record<string, Record<string, string>>;
  /** The --baseline-path copy's dictionaries, or null without one. */
  base: Record<string, Record<string, string>> | null;
}

/** The check's findings the fake lane plays: problems already in the baseline, and new ones. */
interface Findings {
  known?: DictProblem[];
  new?: DictProblem[];
}

const readCopy = (root: string): Record<string, Record<string, string>> => {
  const dir = path.join(root, DIR);
  const out: Record<string, Record<string, string>> = {};
  if (fs.existsSync(dir)) for (const f of fs.readdirSync(dir)) out[f] = flatten(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
  return out;
};

/** The official uilm lane, played: Blocks holds `remote` ("<module>.<culture>" -> flat dictionary); --pull merges it
 *  into the --repo-path copy like uilm_sync.py (changed keys where they are, new keys into the main file). */
function fakeLane(remote: Record<string, Record<string, string>>, fail: Partial<Record<Call["mode"], number>> = {}, findings: Findings = {}) {
  const calls: Call[] = [];
  const lane = async (_run: unknown, args: string[], o: LaneOptions): Promise<LaneResult> => {
    const mode = modeOf(args);
    const dir = path.join(flag(args, "--repo-path"), DIR);
    const copy: Call["copy"] = {};
    for (const f of fs.readdirSync(dir)) copy[f] = flatten(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
    calls.push({ mode, args, o, copy, base: args.includes("--baseline-path") ? readCopy(flag(args, "--baseline-path")) : null });
    const report = path.join(flag(args, "--report-dir"), `20261105-100000-shop-ab12cd${calls.length}.md`);
    if (fail[mode]) return { code: fail[mode]!, stdout: JSON.stringify({ status: "FAILED (not_logged_in)", report }), tail: ["x not_logged_in"], steps: [] };
    if (mode !== "pull") {
      // the check as uilm_sync.py runs it: with --baseline-path only new problems stop it, without one every problem
      const ms = flag(args, "--modules").split(",");
      const known = (findings.known ?? []).filter((p) => ms.includes(p.module));
      const fresh = (findings.new ?? []).filter((p) => ms.includes(p.module));
      const withBase = args.includes("--baseline-path");
      const doc = { modules: ms, problems: [...known, ...fresh], ...(withBase ? { new_problems: fresh, known_problems: known } : {}), report };
      if ((withBase ? fresh : [...known, ...fresh]).length) return { code: 5, stdout: JSON.stringify({ ...doc, status: "FAILED (check_failed)" }), tail: ["x check_failed"], steps: [] };
      return { code: 0, stdout: JSON.stringify({ ...doc, status: mode === "yes" ? "PUSHED" : "PLAN ONLY" }), tail: [], steps: [] };
    }
    const pulls: unknown[] = [];
    for (const m of flag(args, "--modules").split(",")) {
      for (const c of ["en-US", "de-CH"]) {
        const remoteDict = remote[`${m}.${c}`] ?? {};
        const files = Object.keys(copy).filter((f) => dictionaryName(f, "merge")?.module === m && f.endsWith(`.${c}.json`)).sort((a, b) => Number(a.includes("-")) - Number(b.includes("-")) || a.localeCompare(b));
        const local: Record<string, string> = Object.assign({}, ...files.map((f) => copy[f]));
        const added = Object.keys(remoteDict).filter((k) => !(k in local) && remoteDict[k]!.trim());
        const changed = Object.keys(remoteDict).filter((k) => k in local && local[k] !== remoteDict[k] && remoteDict[k]!.trim()).map((k) => ({ key: k, local: local[k], remote: remoteDict[k] }));
        const main = `${m}.${c}.json`;
        if (added.length) {
          const cur = fs.existsSync(path.join(dir, main)) ? flatten(JSON.parse(fs.readFileSync(path.join(dir, main), "utf8"))) : {};
          for (const k of added) cur[k] = remoteDict[k]!;
          fs.writeFileSync(path.join(dir, main), JSON.stringify(cur));
        }
        pulls.push({ module: m, culture: c, file: main, part: "", remote_keys: Object.keys(remoteDict).length, written: added.length > 0, new_file: false, added, changed, local_only: [], kept_blank_remote: [], unchanged: 0 });
      }
    }
    return { code: 0, stdout: `${JSON.stringify({ status: "PULLED", pulls, report }, null, 2)}\n`, tail: [], steps: [] };
  };
  return { lane, calls };
}

/** What Blocks holds when it was synced with BASE. */
const synced = (): Record<string, Record<string, string>> => ({
  "profile.en-US": flatten(BASE["profile.en-US.json"]),
  "profile.de-CH": flatten(BASE["profile.de-CH.json"]),
  "sales.en-US": { ...flatten(BASE["sales.en-US.json"]), ...flatten(BASE["sales-invoices.en-US.json"]) },
});

describe("which modules a lane's commits changed", () => {
  const loc: Localization = { repo: "app", dir: DIR, source: "en-US", cultures: ["en-US", "de-CH"], parts: "merge" };

  it("maps dictionary files to their module, part files under their module", () => {
    const files = [
      `${DIR}/profile.en-US.json`,
      `${DIR}/sales-invoices.de-CH.json`,
      `${DIR}/accounting-journals.en-US.json`,
      `${DIR}/nested/other.en-US.json`,
      `${DIR}/Bad-Part.en-US.json`,
      "src/pages/Profile.tsx",
      "package.json",
    ];
    expect(changedModules(files, loc)).toEqual(["accounting", "profile", "sales"]);
    expect(changedModules(files, { ...loc, parts: "separate" })).toEqual(["accounting-journals", "Bad-Part", "profile", "sales-invoices"]);
    expect(changedModules([`./${DIR}/profile.en-US.json`], { ...loc, dir: `./${DIR}/` })).toEqual(["profile"]);
  });

  it("reads the registry's localization section, and none without one", () => {
    expect(localizationOf({ repos: { web: {} }, localization: { repo: "web", dir: "src/i18n/locales/", source: "en-US", cultures: ["en-US", "de-CH"], parts: "merge" } })).toEqual({ repo: "web", dir: DIR, source: "en-US", cultures: ["en-US", "de-CH"], parts: "merge" });
    expect(localizationOf({ repos: { web: {} } })).toBeNull();
    expect(localizationOf({ repos: { web: {} }, localization: { repo: "api", dir: DIR } })).toBeNull();
  });
});

describe("texts after a deploy", () => {
  it("pushes only the changed module, from the deployed commit, in the product's own Blocks store", async () => {
    const { app, repo, store } = product();
    const sha = commit(repo, { "profile.en-US.json": { profile: { title: "Your profile", actions: { save: "Save changes" } } } });
    // someone edits the working tree after the lane: the push still carries what was committed and deployed
    writeDicts(repo, { "profile.en-US.json": { profile: { title: "Draft", actions: { save: "Draft" } } } });
    const { lane, calls } = fakeLane(synced());
    const run = fakeRun();
    const steps: string[] = [];
    const out = await syncTexts(run as never, app, { commits: ["abcdef123", sha] }, { lane, step: async (_p, l) => void steps.push(l) });

    expect(out).toMatchObject({ status: "synced", modules: ["profile"], line: SYNCED_LINE });
    expect(calls.map((c) => c.mode)).toEqual(["plan", "pull", "yes"]);
    for (const c of calls) {
      expect(c.args.slice(0, 7)).toEqual(["uilm", "--project", app.registry, "--env", "dev", "--modules", "profile"]);
      expect(flag(c.args, "--report-dir")).toBe(path.join(app.dir, "reports", "uilm"));
      expect(c.args).toContain("--json");
      expect(c.o.blocksConfigDir).toBe(store);
      expect(c.o.projectDir).toBe(app.dir);
      expect(flag(c.args, "--repo-path").startsWith(repo)).toBe(false);
    }
    expect(calls[2]!.copy["profile.en-US.json"]!["profile.actions.save"]).toBe("Save changes");
    expect(steps[0]).toContain("Syncing the new texts to Blocks Localization (profile)");
    expect(readRecord(app)).toMatchObject({ pending: {}, last: { status: "synced", modules: ["profile"] } });
    // the scratch copies are gone
    expect(calls.every((c) => !fs.existsSync(flag(c.args, "--repo-path")))).toBe(true);
  });

  it("syncs a part file's module as the merged module", async () => {
    const { app, repo } = product();
    const sha = commit(repo, { "sales-invoices.en-US.json": { invoice: { actions: { issue: "Issue invoice" } } } });
    const { lane, calls } = fakeLane(synced());
    const out = await syncTexts(fakeRun() as never, app, { commits: [sha] }, { lane });
    expect(out).toMatchObject({ status: "synced", modules: ["sales"] });
    expect(flag(calls[2]!.args, "--modules")).toBe("sales");
  });

  it("pushes over a Blocks value that was the repo's own earlier (a change never synced), not a portal edit", async () => {
    const { app, repo } = product();
    // an earlier change of the title that never reached Blocks
    commit(repo, { "profile.en-US.json": { profile: { title: "My profile", actions: { save: "Save" } } } }, "feat(app): earlier");
    const sha = commit(repo, { "profile.en-US.json": { profile: { title: "My profile", actions: { save: "Save changes" } } } });
    const { lane, calls } = fakeLane(synced());
    const out = await syncTexts(fakeRun() as never, app, { commits: [sha] }, { lane });
    expect(out.status).toBe("synced");
    expect(calls.map((c) => c.mode)).toEqual(["plan", "pull", "yes"]);
  });

  it("the missing-key placeholder Blocks answers for a text it does not hold is no portal edit: the push fills it", async () => {
    const { app, repo } = product();
    const sha = commit(repo, { "profile.en-US.json": { profile: { title: "Your profile", actions: { save: "Save changes" } } } });
    const remote = synced();
    // 05.11: 5878 texts were "[ KEY MISSING ]" in Blocks (BLK-31), all flagged as portal edits until this fix
    remote["profile.de-CH"]!["profile.title"] = "[ KEY MISSING ]";
    remote["profile.de-CH"]!["profile.extra"] = "[KEY_MISSING]";
    const { lane, calls } = fakeLane(remote);
    const out = await syncTexts(fakeRun() as never, app, { commits: [sha] }, { lane });
    expect(out.status).toBe("synced");
    expect(calls.map((c) => c.mode)).toEqual(["plan", "pull", "yes"]);
    expect(isUilmPlaceholder(" [ KEY MISSING ] ")).toBe(true);
    expect(isUilmPlaceholder("Key missing in the form")).toBe(false);
  });

  it("does not push when Blocks has texts edited in the portal, and says so plainly", async () => {
    const { app, repo } = product();
    const sha = commit(repo, { "profile.en-US.json": { profile: { title: "Your profile", actions: { save: "Save changes" } } } });
    const remote = synced();
    remote["profile.de-CH"]!["profile.title"] = "Mein Profil";
    const { lane, calls } = fakeLane(remote);
    const run = fakeRun();
    const out = await syncTexts(run as never, app, { commits: [sha] }, { lane });
    expect(out.status).toBe("portal-edits");
    expect(out.line).toBe(portalLine(["profile"]));
    expect(out.line).toBe("The new texts are deployed, but Blocks Localization has texts edited in the portal for profile; they were kept until the engine team takes them in.");
    expect(out.line).not.toMatch(/--pull/);
    expect(out.edits).toEqual([{ module: "profile", culture: "de-CH", key: "profile.title", kind: "changed" }]);
    expect(calls.map((c) => c.mode)).toEqual(["plan", "pull"]);
    expect(readRecord(app).pending.profile).toMatchObject({ reason: "portal-edits", job: "job-uilm-1" });
    // the repo itself is never written by the comparison
    expect(git(repo, "status", "--porcelain")).toBe("");
  });

  it("still pushes the modules without portal edits", async () => {
    const { app, repo } = product();
    const sha = commit(repo, {
      "profile.en-US.json": { profile: { title: "Your profile", actions: { save: "Save changes" } } },
      "sales-invoices.en-US.json": { invoice: { actions: { issue: "Issue invoice" } } },
    });
    const remote = synced();
    remote["profile.en-US"]!["profile.title"] = "Edited in the portal";
    const { lane, calls } = fakeLane(remote);
    const out = await syncTexts(fakeRun() as never, app, { commits: [sha] }, { lane });
    expect(out).toMatchObject({ status: "portal-edits", modules: ["profile"], synced: ["sales"], line: portalLine(["profile"]) });
    expect(calls.map((c) => `${c.mode}:${flag(c.args, "--modules")}`)).toEqual(["plan:profile,sales", "pull:profile,sales", "yes:sales"]);
    expect(Object.keys(readRecord(app).pending)).toEqual(["profile"]);
  });

  it("does not push when Blocks has a key the repo never had", async () => {
    const { app, repo } = product();
    const sha = commit(repo, { "profile.en-US.json": { profile: { title: "Your profile", actions: { save: "Save changes" } } } });
    const remote = synced();
    remote["profile.en-US"]!["profile.hint"] = "Added in the portal";
    const { lane, calls } = fakeLane(remote);
    const out = await syncTexts(fakeRun() as never, app, { commits: [sha] }, { lane });
    expect(out.status).toBe("portal-edits");
    expect(out.edits).toEqual([{ module: "profile", culture: "en-US", key: "profile.hint", kind: "only-in-blocks" }]);
    expect(calls.some((c) => c.mode === "yes")).toBe(false);
  });

  it("overwrites a Blocks value of a key this work changed", async () => {
    const { app, repo } = product();
    const sha = commit(repo, { "profile.en-US.json": { profile: { title: "Your profile", actions: { save: "Save changes" } } } });
    const remote = synced();
    remote["profile.en-US"]!["profile.actions.save"] = "Store";
    const { lane, calls } = fakeLane(remote);
    const out = await syncTexts(fakeRun() as never, app, { commits: [sha] }, { lane });
    expect(out.status).toBe("synced");
    expect(calls.at(-1)!.mode).toBe("yes");
  });

  it("runs nothing for a product without a localization section, or a lane that changed no dictionary", async () => {
    const plain = product({ localization: false });
    const sha = commit(plain.repo, { "profile.en-US.json": { profile: { title: "Changed", actions: { save: "Save" } } } });
    const a = fakeLane(synced());
    expect(await syncTexts(fakeRun() as never, plain.app, { commits: [sha] }, { lane: a.lane })).toEqual({ status: "none", modules: [], line: "" });
    expect(a.calls).toHaveLength(0);
    expect(fs.existsSync(path.join(plain.app.dir, "uilm.json"))).toBe(false);

    const { app, repo } = product();
    fs.writeFileSync(path.join(repo, "README.md"), "changed\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "docs");
    const b = fakeLane(synced());
    expect((await syncTexts(fakeRun() as never, app, { commits: [git(repo, "rev-parse", "HEAD").slice(0, 9)] }, { lane: b.lane })).status).toBe("none");
    expect(b.calls).toHaveLength(0);
  });

  it("a failed sync gives a plain line, keeps the deploy, and the next build retries the module", async () => {
    const { app, repo } = product();
    const sha = commit(repo, { "profile.en-US.json": { profile: { title: "Your profile", actions: { save: "Save changes" } } } });
    const first = fakeLane(synced(), { plan: 3 });
    const run = fakeRun();
    const out = await syncTexts(run as never, app, { commits: [sha] }, { lane: first.lane });
    expect(out.status).toBe("failed");
    expect(out.line).toBe(failedLine(["profile"]));
    expect(out.line).not.toMatch(/exit \d|\/|BLOCKS_|token|madp\.|not_logged_in|FAILED/);
    expect(first.calls.map((c) => c.mode)).toEqual(["plan"]);
    expect(readRecord(app).pending.profile).toMatchObject({ reason: "failed" });
    expect(run.lines.join("\n")).toContain("madp uilm --project shop-ab12cd.yml --modules profile --yes");

    // the next build changed only code: the pending module is synced now
    fs.writeFileSync(path.join(repo, "README.md"), "changed\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "fix(app): code only");
    const next = fakeLane(synced());
    const again = await syncTexts(fakeRun() as never, app, { commits: [git(repo, "rev-parse", "HEAD").slice(0, 9)] }, { lane: next.lane });
    expect(again).toMatchObject({ status: "synced", modules: ["profile"] });
    expect(readRecord(app).pending).toEqual({});
  });

  it("a push that stops is a plain failure too", async () => {
    const { app, repo } = product();
    const sha = commit(repo, { "profile.de-CH.json": { profile: { title: "Ihr Profil", actions: { save: "Änderungen speichern" } } } });
    const { lane, calls } = fakeLane(synced(), { yes: 8 });
    const out = await syncTexts(fakeRun() as never, app, { commits: [sha] }, { lane });
    expect(out).toMatchObject({ status: "failed", modules: ["profile"], line: failedLine(["profile"]) });
    expect(calls.map((c) => c.mode)).toEqual(["plan", "pull", "yes"]);
  });
});

describe("problems the dictionaries already had (a baseline)", () => {
  // a key that breaks key style dot long before the work, and a placeholder the work's German text lacks
  const OLD: DictProblem = { kind: "key_style", module: "profile", culture: "", key: "items.public-api", message: "key 'items.public-api' breaks key_style dot (lowerCamelCase segments joined by '.', e.g. invoice.actions.issue)" };
  const NEW: DictProblem = { kind: "placeholder", module: "profile", culture: "de-CH", key: "profile.actions.save", message: "'profile.actions.save' placeholders differ: en-US {count} vs de-CH {}" };
  const change = { "profile.en-US.json": { profile: { title: "Your profile", actions: { save: "Save {count} changes" } } } };

  it("checks the deployed texts against the commit before the work: old problems do not stop the sync", async () => {
    const { app, repo } = product();
    const sha = commit(repo, change);
    const { lane, calls } = fakeLane(synced(), {}, { known: [OLD] });
    const out = await syncTexts(fakeRun() as never, app, { commits: [sha] }, { lane });
    expect(out).toMatchObject({ status: "synced", modules: ["profile"], line: SYNCED_LINE });
    expect(calls.map((c) => c.mode)).toEqual(["plan", "pull", "yes"]);
    // the plan and the push read the baseline: the dictionaries as they were before the work's commits
    for (const c of [calls[0]!, calls[2]!]) {
      expect(c.base!["profile.en-US.json"]!["profile.actions.save"]).toBe("Save");
      expect(c.copy["profile.en-US.json"]!["profile.actions.save"]).toBe("Save {count} changes");
      expect(flag(c.args, "--baseline-path").startsWith(repo)).toBe(false);
    }
    expect(calls[1]!.base).toBeNull();
    expect(readRecord(app).problems).toBeUndefined();
    expect(calls.every((c) => !fs.existsSync(flag(c.args, "--baseline-path") || flag(c.args, "--repo-path")))).toBe(true);
  });

  it("holds back a module with new problems, syncs the others, and logs and records the problems", async () => {
    const { app, repo } = product();
    const sha = commit(repo, { ...change, "sales-invoices.en-US.json": { invoice: { actions: { issue: "Issue invoice" } } } });
    const { lane, calls } = fakeLane(synced(), {}, { known: [OLD], new: [NEW] });
    const run = fakeRun();
    const out = await syncTexts(run as never, app, { commits: [sha] }, { lane });
    expect(out).toMatchObject({ status: "failed", modules: ["profile"], synced: ["sales"], line: problemsLine(["profile"], 1), problems: [problemLine(NEW)] });
    expect(out.line).toBe("The new texts are deployed, but this change brought 1 text problem into profile, so they did not go to Blocks Localization yet; the next build syncs them again.");
    expect(out.line).not.toMatch(/exit \d|\/|FAILED|check_failed/);
    expect(calls.map((c) => `${c.mode}:${flag(c.args, "--modules")}`)).toEqual(["plan:profile,sales", "plan:sales", "pull:sales", "yes:sales"]);
    const log = run.lines.join("\n");
    expect(log).toContain("profile not synced: this work brought 1 new dictionary problem(s) into it: profile.de-CH placeholder: 'profile.actions.save' placeholders differ: en-US {count} vs de-CH {}");
    expect(log).toContain("(1 problem(s) that were there before do not count)");
    const record = readRecord(app);
    expect(record.pending.profile).toMatchObject({ reason: "problems", job: "job-uilm-1" });
    expect(record.pending.sales).toBeUndefined();
    expect(record.problems).toEqual({ profile: { at: "2026-11-05T10:00:00.000Z", job: "job-uilm-1", lines: [problemLine(NEW)] } });
    expect(record.last).toMatchObject({ status: "failed", modules: ["profile"], problems: [problemLine(NEW)] });
  });

  it("syncs the module at the next build and keeps its problem on record until a change fixes it", async () => {
    const { app, repo } = product();
    const sha = commit(repo, change);
    const first = fakeLane(synced(), {}, { known: [OLD], new: [NEW] });
    expect((await syncTexts(fakeRun() as never, app, { commits: [sha] }, { lane: first.lane })).status).toBe("failed");
    expect(first.calls.map((c) => c.mode)).toEqual(["plan"]);
    // the next build changed only code: the problem is in its baseline now, so the module goes to Blocks
    fs.writeFileSync(path.join(repo, "README.md"), "changed\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "fix(app): code only");
    const next = fakeLane(synced(), {}, { known: [OLD, NEW] });
    const again = await syncTexts(fakeRun() as never, app, { commits: [git(repo, "rev-parse", "HEAD").slice(0, 9)] }, { lane: next.lane });
    expect(again).toMatchObject({ status: "synced", modules: ["profile"] });
    expect(next.calls[0]!.base!["profile.en-US.json"]!["profile.actions.save"]).toBe("Save {count} changes");
    expect(readRecord(app).pending).toEqual({});
    expect(readRecord(app).problems?.profile?.lines).toEqual([problemLine(NEW)]);
    // a change that fixes it: the record lets it go
    const fix = commit(repo, { "profile.de-CH.json": { profile: { title: "Ihr Profil", actions: { save: "{count} Änderungen speichern" } } } });
    const fixed = fakeLane(synced(), {}, { known: [OLD] });
    expect((await syncTexts(fakeRun() as never, app, { commits: [fix] }, { lane: fixed.lane })).status).toBe("synced");
    expect(readRecord(app).problems).toBeUndefined();
  });

  it("checks a pending module against the deployed commit when the work changed nothing in the localization repo", async () => {
    const { app, repo } = product();
    const sha = commit(repo, change);
    await syncTexts(fakeRun() as never, app, { commits: [sha] }, { lane: fakeLane(synced(), { plan: 3 }).lane });
    expect(readRecord(app).pending.profile).toMatchObject({ reason: "failed" });
    const { lane, calls } = fakeLane(synced(), {}, { known: [OLD] });
    const out = await syncTexts(fakeRun() as never, app, { commits: ["abcdef123"] }, { lane });
    expect(out).toMatchObject({ status: "synced", modules: ["profile"] });
    expect(calls[0]!.base).toEqual(calls[0]!.copy);
  });
});

describe("the job's message with the texts' line", () => {
  it("adds the line, shortening the message when both do not fit", () => {
    expect(withTexts("CR-3 released to dev as 1.2.0; commit abc1234.", { status: "synced", line: SYNCED_LINE }, "CR-3 is on dev as 1.2.0.")).toBe(`CR-3 released to dev as 1.2.0; commit abc1234. ${SYNCED_LINE}`);
    const note = portalLine(["profile"]);
    expect(withTexts("CR-3 released to dev as 1.2.0; commit abc1234.", { status: "portal-edits", line: note }, "CR-3 is on dev as 1.2.0.")).toBe(`CR-3 released to dev as 1.2.0; commit abc1234. ${note}`);
    const msg = withTexts("Milestone 2 Checkout and payment built by MADP: 12 of 12 tickets done, commit abc1234.", { status: "portal-edits", line: note }, "Checkout and payment is on dev.");
    expect(msg).toBe(`Checkout and payment is on dev. ${note}`);
    expect(msg.length).toBeLessThanOrEqual(200);
    expect(withTexts("Done.", { status: "none", line: "" }, "x")).toBe("Done.");
  });
});
