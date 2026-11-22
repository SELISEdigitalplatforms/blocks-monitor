import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LANE_EXIT, laneFailure, needsAttention, parseStepLine, plainStep, runLane, stepFamily, type LaneStep } from "../../server/local/engine/official/madp.ts";
import { appName, findClientId, urlIn, withDevTenant } from "../../server/local/engine/official/app.ts";
import { clipTitle, commitOf, commitsOf, describeWork, LaneAttention, laneFor, type WorkAsk } from "../../server/local/engine/official/build.ts";
import { JobFailure } from "../../server/local/engine/run.ts";

const ticket = (n: number, extra: Partial<{ done: boolean; comments: string[] }> = {}) => ({
  id: `t${n}`, number: n, title: `Ticket ${n}`, description: `Do thing ${n}.`, acceptance: [`criterion ${n}a`, `criterion ${n}b`], feature: "Booking", done: false, ...extra,
});

describe("reading the official lanes' progress", () => {
  it("parses Run.step lines with and without colours", () => {
    expect(parseStepLine("\u001b[1;36m▸ gate[web]: pass (18.2s)\u001b[0m")).toEqual({ name: "gate[web]", outcome: "pass", seconds: 18.2 });
    expect(parseStepLine("plan: 3 step(s) of max 6, planner claude-opus-5-5 (41s)")).toEqual({ name: "plan", outcome: "3 step(s) of max 6, planner claude-opus-5-5", seconds: 41 });
    expect(parseStepLine("  ✓ deploy[api]: succeeded build 1f2e (95.0s)")?.name).toBe("deploy[api]");
    expect(parseStepLine("Traceback (most recent call last):")).toBeNull();
    expect(parseStepLine("feature  add CSV export")).toBeNull();
  });

  it("groups steps by family", () => {
    expect(stepFamily("gate[web]")).toBe("gate");
    expect(stepFamily("conflict-fix[api]")).toBe("conflict");
    expect(stepFamily("plan")).toBe("plan");
  });

  it("finds the commits a lane reports", () => {
    const steps: LaneStep[] = [{ name: "commit[web]", outcome: "abc1234def5 1 file", seconds: 1 }, { name: "push[web]", outcome: "origin/dev", seconds: 2 }];
    expect(commitsOf({ steps, stdout: "repos    web: 2 file(s) 0011223344 ; api: 1 file(s) 99887766aa" })).toEqual(["abc1234def5", "0011223344", "99887766aa"]);
  });

  it("explains a lane's exit in plain words, without host paths", () => {
    const f = laneFailure("Milestone 1: Booking", { code: 5, steps: [], tail: ["gate[web]: FAIL (20s)", "error TS2304 in /srv/madp-factory/projects/x/web/src/App.tsx"] });
    expect(f.code).toBe(LANE_EXIT[5]!.code);
    expect(f.message).toContain("did not pass the checks");
    expect(f.message).not.toContain("/srv/");
    expect(laneFailure("x", { code: 42, steps: [], tail: [] }).code).toBe("madp.failed");
  });

  it("names the step that stopped in plain words and never shows the tool's output", () => {
    const tail = ["npm warn install-scripts esbuild@0.28.2 (postinstall: node install.js)", "✗ step data-sync failed: exit 1", '{ "code": "command_failed" }'];
    const f = laneFailure("Setting up the product", { code: 1, steps: [], tail });
    expect(f.message).toBe('Setting up the product stopped at "setting up the product\'s data". Start it again; if it stops there again, ask the engine team to look into it.');
    expect(f.code).toBe("madp.data-sync");
    expect(f.message).not.toMatch(/npm|exit|command_failed/);
    expect(laneFailure("CR-2", { code: 8, tail: [], steps: [{ name: "deploy[web]", outcome: "FAIL verdict failed", seconds: 90 }] }).message)
      .toBe('CR-2 stopped at "the deployment of the web app": the Blocks deployment failed. Start it again in a few minutes; if the deployment fails again, ask the engine team to look into it.');
  });

  it("reads the acceptance step and tells a failed check of a live change from a failed deploy", () => {
    // the lines cli/quick.py and cli/feature.py print (acceptance_ops.AcceptanceResult.outcome)
    const ok = parseStepLine("\u001b[1;36m▸ accept[api]: ok: 2 file(s) passed, 37 checks (the change's own tests) (14.2s)\u001b[0m");
    expect(ok).toEqual({ name: "accept[api]", outcome: "ok: 2 file(s) passed, 37 checks (the change's own tests)", seconds: 14.2 });
    expect(ok!.outcome).not.toMatch(/\bfail/i);
    const bad = parseStepLine("▸ accept[api]: FAILED: 1 of 2 file(s): test/x.mjs (35 passed, 2 failed) (20.1s)")!;
    expect(bad).toMatchObject({ name: "accept[api]", outcome: "FAILED: 1 of 2 file(s): test/x.mjs (35 passed, 2 failed)" });
    expect(parseStepLine("▸ accept[web]: FAILED: the fixtures could not be prepared (exit 1, 3.0s); no test ran (3.1s)")?.seconds).toBe(3.1);
    expect(stepFamily("accept[api]")).toBe("accept");
    expect(plainStep("accept[api]")).toBe("checking the API change on the development environment");
    expect(plainStep("accept[web]")).toBe("checking the web app change on the development environment");
    expect(plainStep("accept[app]")).toBe("checking the change on the development environment");

    expect(LANE_EXIT[12]!.code).toBe("madp.accept");
    expect(needsAttention(12)).toBe(true);
    for (const c of [0, 5, 8, 9]) expect(needsAttention(c)).toBe(false);
    const steps: LaneStep[] = [{ name: "deploy[api]", outcome: "succeeded", seconds: 90 }, { name: "smoke[api]", outcome: "ok", seconds: 2 }, bad];
    const f = laneFailure("CR-7: Employment categories", { code: 12, tail: [], steps });
    expect(f.code).toBe("madp.accept");
    expect(f.message).toBe('CR-7: Employment categories is on dev, but not usable yet at "checking the API change on the development environment": the change\'s own tests on the development environment did not pass (nothing was rolled back). What the checks found goes back to the development team to fix.');
    expect(f.message).not.toMatch(/stopped|test\/x\.mjs/);
    // a deploy failure keeps its own words
    expect(laneFailure("CR-7", { code: 8, tail: [], steps: [{ name: "deploy[api]", outcome: "FAIL verdict failed", seconds: 9 }] }).message).toMatch(/^CR-7 stopped at "the deployment of the API"/);
    // runOfficialWork throws this on exit 12: a JobFailure that still carries the work (commits, steps)
    const work = { lane: "feature" as const, commits: ["abc1234"], seconds: 120, steps };
    const e = new LaneAttention(f.message, f.code, work);
    expect(e).toBeInstanceOf(JobFailure);
    expect(e).toMatchObject({ code: "madp.accept", work, name: "LaneAttention" });
  });
});

describe("the work handed to the official engine", () => {
  it("carries the tickets, acceptance, comments, facts and the product's history", () => {
    const md = describeWork({
      product: "Room Booking",
      label: "Milestone 2: Rooms",
      goal: "People book rooms.",
      tickets: [ticket(4, { comments: ["Use 24-hour times."] }), ticket(5, { done: true })],
      built: [ticket(1)],
      later: ["Milestone 3: Reports"],
      facts: ["- Currency: CHF."],
    });
    // the first line is a plain title (no markdown heading)
    expect(md.split("\n")[0]).toBe("Room Booking: Milestone 2: Rooms");
    expect(md).toContain("### #4 Ticket 4");
    expect(md).toContain("- criterion 4a");
    expect(md).toContain("- Use 24-hour times.");
    expect(md).not.toContain("### #5");
    expect(md).toContain("- Currency: CHF.");
    expect(md).not.toContain("- - Currency");
    expect(md).toContain("#1 Ticket 1");
    expect(md).toContain("Milestone 3: Reports");
  });

  it("gives the commits a short conventional subject and body, never the description", () => {
    const ask = (label: string, goal = ""): WorkAsk => ({ product: "PrimaBook", label, goal, tickets: [ticket(4)], built: [], later: [] });
    // 05.11: the subject was "feat(web): # PrimaBook: CR-001: Profile: rename the Save preferences..." and the body the whole brief;
    // 09.11: no change request code, no people and no "(MADP Factory)" line in a product's history (neutralCommits.test.ts)
    expect(commitOf(ask("CR-001: Profile: rename the Save preferences button", "People look for **Save** on the `profile` page (asked by anna@example.com, @anna). It is the word they know."))).toEqual({
      title: "feat: rename the Save preferences button",
      summary: "People look for Save on the profile page. It is the word they know.",
    });
    expect(commitOf(ask("CR-002: Profile: Rename the button"))).toEqual({ title: "feat: rename the button", summary: "Profile: Rename the button." });
    expect(commitOf(ask("CR-003: Dark mode: add a toggle", "People who work at night want a darker screen."))).toEqual({
      title: "feat: add a toggle",
      summary: "Dark mode: People who work at night want a darker screen.",
    });
    // a colon before a code or acronym is part of the title
    expect(commitOf(ask("CR-004: Allow export: CSV and PDF")).title).toBe("feat: allow export: CSV and PDF");
    expect(commitOf(ask("FX-7: The login fails on Safari", "## Why\nSign-in hangs."))).toEqual({ title: "fix: the login fails on Safari", summary: "Sign-in hangs." });
    expect(commitOf(ask("CR-5: Reports (increment 2 of 3: Charts)", "Charts on the reports page."))).toEqual({
      title: "feat: reports (part 2 of 3)",
      summary: "Charts on the reports page.",
    });
    expect(commitOf(ask("Milestone 2: Rooms", "People book rooms."))).toEqual({ title: "feat: build milestone 2: Rooms", summary: "People book rooms." });
    // short: the subject fits 72 characters with the lane's "feat(web): ", the body about three lines
    const long = commitOf(ask(`CR-009: ${"make the invoice list remember its filters ".repeat(4)}`, "A sentence that explains why. ".repeat(20)));
    expect(`feat(web): ${long.title.replace(/^feat: /, "")}`.length).toBeLessThanOrEqual(72);
    expect(long.title).toMatch(/^feat: make the invoice list remember its filters/);
    expect(long.title).not.toMatch(/\.\.\.|…|\s(the|its|and|with)$/);
    expect(long.summary.length).toBeLessThanOrEqual(220);
    for (const c of [commitOf(ask("CR-001: Profile: rename the Save button", "x")), long]) expect(`${c.title}\n${c.summary}`).not.toMatch(/PrimaBook|#|Acceptance|criterion|CR-0|MADP|Factory/);
  });

  it("cuts a long title where a phrase ends, never mid-phrase with '...', and keeps its part", () => {
    const ask = (label: string): WorkAsk => ({ product: "PrimaBook", label, goal: "", tickets: [ticket(4)], built: [], later: [] });
    // 05.11: "feat(api): CR-002 employment categories with default... (part 1 of 4)"
    const c = commitOf(ask("CR-002: Employment categories with default languages and per-category settings (increment 1 of 4: API and data)"));
    expect(c.title).toBe("feat: employment categories with default languages (part 1 of 4)");
    for (const scope of ["api", "web", "app"]) expect(`feat(${scope}): ${c.title.replace(/^feat: /, "")}`.length).toBeLessThanOrEqual(72);
    expect(commitOf(ask("Milestone 3: Checkout with saved cards, invoices and refunds for every country we sell in")).title).toBe("feat: build milestone 3: Checkout with saved cards, invoices");
    // the same rule as the engine's quick_ops.shorten
    expect(clipTitle("employment categories with default languages and settings", 46)).toBe("employment categories with default languages");
    expect(clipTitle("employment categories with default languages and settings", 40)).toBe("employment categories");
    expect(clipTitle("show the totals, the VAT lines and the rounding difference", 25)).toBe("show the totals");
    expect(clipTitle("make the invoice list remember the filters", 25)).toBe("make the invoice list");
    expect(clipTitle("remember the selected the filters", 20)).toBe("remember");
    expect(clipTitle("Supercalifragilistic", 10)).toBe("Supercalif");
    expect(clipTitle("rename the button", 40)).toBe("rename the button");
  });

  it("sends a one-ticket change through the quick lane, the rest through the feature lane", () => {
    expect(laneFor("change", 1)).toBe("quick");
    expect(laneFor("change", 2)).toBe("feature");
    expect(laneFor("milestone", 1)).toBe("feature");
  });

  it("names products the way madp new-app accepts", () => {
    const re = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;
    for (const name of ["E2E DEV - Room Booking", "Zürich Café Ordering", "3D Printing Shop", "x", "AssetTrack — IT Asset Management of the very long kind"]) {
      const n = appName(name, "9d4c534d-b931-45ac-a18d-21769bd07a89");
      expect(n).toMatch(re);
      expect(n.endsWith("-9d4c53")).toBe(true);
    }
    expect(appName("E2E DEV - Room Booking", "9d4c534d-b931")).toBe("e2e-dev-room-booking-9d4c53");
  });

  it("adds the dev tenant to a registry written without it, and leaves one that has it", () => {
    const t = "D3f4da5a5e89d4ab1aa2d40b8fbfc4f91";
    const yml = "project: x\ndefault_env: dev\nenvironments:\n  dev:\n    branch: dev\ndeploy: false\n";
    const fixed = withDevTenant(yml, t)!;
    expect(fixed).toBe(`project: x\ndefault_env: dev\nenvironments:\n  dev:\n    branch: dev\n    tenant_id: ${t}\ndeploy: false\n`);
    expect(withDevTenant(fixed, t)).toBe(fixed);
    expect(withDevTenant("project: x\n", t)).toBeNull();
  });

  it("reads the login client id and the web address from Blocks answers, never the secret", () => {
    expect(findClientId({ data: { clientId: "abc-123", client_secret: "s3cret" }, isSuccess: true })).toBe("abc-123");
    expect(findClientId({ itemId: "item-9" })).toBe("item-9");
    expect(findClientId({ client_secret: "s3cret" })).toBe("");
    expect(urlIn({ verdict: "succeeded", url: "https://app.example.com" })).toBe("https://app.example.com");
    expect(urlIn({ build: { log: "rolled out to https://dbx-web.slsblx.com/ ok" } })).toBe("https://dbx-web.slsblx.com/");
  });
});

describe("running a lane", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    delete process.env.MF_MADP_ENGINE_HOME;
    delete process.env.MF_MADP_PYTHON;
  });

  function fakeEngine(script: string): { home: string; project: string } {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-lane-"));
    made.push(root);
    const home = path.join(root, "engine");
    fs.mkdirSync(path.join(home, "MADP", "orchestrator", "cli"), { recursive: true });
    fs.writeFileSync(path.join(home, "MADP", "orchestrator", "cli", "project.py"), "");
    const py = path.join(root, "fake-python.sh");
    fs.writeFileSync(py, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    process.env.MF_MADP_ENGINE_HOME = home;
    process.env.MF_MADP_PYTHON = py;
    return { home, project: path.join(root, "project") };
  }

  const fakeRun = () => {
    const lines: string[] = [];
    return {
      id: "job-1",
      signal: new AbortController().signal,
      heartbeat: async () => undefined,
      log: (l: string) => lines.push(l),
      check: () => undefined,
      lines,
    };
  };

  it("streams the steps, keeps the full output and answers the exit code", async () => {
    const { project } = fakeEngine([
      'echo "args: $*" >&2',
      'echo "plan: 2 step(s) of max 6 (3.0s)" >&2',
      'echo "gate[web]: pass (1.5s)" >&2',
      'echo "repos    web: 1 file(s) abcdef1234"',
      "exit 0",
    ].join("\n"));
    const seen: string[] = [];
    const r = await runLane(fakeRun() as never, ["feature", "--project", "x.yml"], { projectDir: project, label: "feature", timeoutMs: 20_000, onStep: (s) => void seen.push(s.name) });
    expect(r.code).toBe(0);
    expect(seen).toEqual(["plan", "gate[web]"]);
    expect(r.tail[0]).toContain("-B -m MADP.orchestrator.cli.project feature --project x.yml");
    expect(commitsOf(r)).toEqual(["abcdef1234"]);
    const logs = fs.readdirSync(path.join(project, "logs"));
    expect(logs.some((f) => f.endsWith("-feature.log"))).toBe(true);
  });

  it("answers a failing lane's code", async () => {
    const { project } = fakeEngine('echo "verify: FAIL (2.0s)" >&2\nexit 5');
    const r = await runLane(fakeRun() as never, ["quick"], { projectDir: project, label: "quick", timeoutMs: 20_000 });
    expect(r.code).toBe(5);
    expect(laneFailure("CR-1", r).code).toBe("madp.verify");
  });

  it("a lane whose acceptance failed after the deploy: exit 12, its steps read, the report folder given", async () => {
    const { project } = fakeEngine([
      'echo "deploy[api]: succeeded (90.0s)" >&2',
      'echo "accept[api]: FAILED: 1 of 1 file(s): test/x.mjs (1 passed, 1 failed) (4.0s)" >&2',
      'echo "accept dir: $MADP_ACCEPT_REPORT_DIR" >&2',
      'echo "accept   api: FAILED 1 of 1 file(s), 1 passed, 1 failed"',
      "exit 12",
    ].join("\n"));
    const r = await runLane(fakeRun() as never, ["feature"], { projectDir: project, label: "feature", timeoutMs: 20_000 });
    expect(r.code).toBe(12);
    expect(r.steps.map((s) => s.name)).toEqual(["deploy[api]", "accept[api]"]);
    expect(r.tail.join("\n")).toContain(`accept dir: ${path.join(project, "reports", "accept")}`);
    expect(laneFailure("CR-1", r)).toMatchObject({ code: "madp.accept", message: expect.stringMatching(/^CR-1 is on dev, but not usable yet/) });
  });

  it("refuses to run when the official engine is not installed", async () => {
    process.env.MF_MADP_ENGINE_HOME = path.join(os.tmpdir(), "no-such-madp-engine");
    await expect(runLane(fakeRun() as never, ["quick"], { projectDir: os.tmpdir(), label: "quick", timeoutMs: 5_000 })).rejects.toMatchObject({ code: "madp.missing" });
  });
});
