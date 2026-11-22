// The AI account pool: rotation at the threshold (99 % by default), resting until the reset, standby, the API key when
// every subscription rests, no pool = the lanes run exactly as before, and the usage it reads from the lanes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  accountPool, createAccountPool, discoverAccounts, installAccountPool, laneUsage, parseProbeAnswer, selectAccount, usageFromText,
  type PoolAccount,
} from "../../server/local/engine/ai/accountPool";

const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const acct = (label: string, o: Partial<PoolAccount> = {}): PoolAccount => ({
  label, provider: "claude-subscription", dir: `/hosts/${label}`, setting: "active", priority: 100, usage5h: null, usage7d: null,
  coolingUntil: null, resetsAt: null, lastUsedAt: null, running: 0, ...o,
});
const api = (o: Partial<PoolAccount> = {}) => acct("api-key", { provider: "anthropic-api", dir: null, ...o });
const pick = (list: PoolAccount[], rotateAtPercent = 99) => selectAccount(list, { rotateAtPercent, now: NOW });

describe("selectAccount", () => {
  it("picks the active subscription with the most headroom", () => {
    const r = pick([acct("a", { usage5h: 80 }), acct("b", { usage5h: 20, usage7d: 60 }), acct("c", { usage5h: 50 })]);
    expect(r).toMatchObject({ via: "subscription", account: { label: "c" } });
  });

  it("rotates away from an account at the threshold (99 %) and back once its window reset", () => {
    const busy = acct("a", { usage5h: 99, resetsAt: NOW + 3_600_000 });
    expect(pick([busy, acct("b", { usage5h: 90 })]).account?.label).toBe("b");
    expect(pick([acct("a", { usage5h: 98.9 }), acct("b", { usage5h: 99 })]).account?.label).toBe("a");
    // the reset has passed: the account may be used again
    expect(pick([acct("a", { usage5h: 99, resetsAt: NOW - 1 })]).account?.label).toBe("a");
    // a lower threshold rests it earlier
    expect(pick([acct("a", { usage5h: 92 }), acct("b", { usage5h: 95 })], 90).account).toBeNull();
  });

  it("leaves a resting (cooling) account until its reset, and uses standby before the API key", () => {
    const resting = acct("a", { coolingUntil: NOW + 60_000 });
    expect(pick([resting, acct("s", { setting: "standby" }), api()])).toMatchObject({ via: "standby", account: { label: "s" } });
    expect(pick([resting, api()])).toMatchObject({ via: "api", account: { label: "api-key" } });
    expect(pick([acct("a", { coolingUntil: NOW - 1 }), api()])).toMatchObject({ via: "subscription", account: { label: "a" } });
  });

  it("never uses a disabled account, and answers none when nothing can run", () => {
    expect(pick([acct("a", { setting: "disabled" }), api({ setting: "disabled" })])).toEqual({ account: null, via: "none" });
    expect(pick([acct("a", { coolingUntil: NOW + 1 })])).toEqual({ account: null, via: "none" });
  });

  it("breaks ties by order (priority), then by fewer running lanes, then the least recently used", () => {
    expect(pick([acct("a", { priority: 5 }), acct("b", { priority: 1 })]).account?.label).toBe("b");
    expect(pick([acct("a", { running: 2 }), acct("b", { running: 1 })]).account?.label).toBe("b");
    expect(pick([acct("a", { lastUsedAt: NOW - 10 }), acct("b", { lastUsedAt: NOW - 1000 })]).account?.label).toBe("b");
  });
});

describe("usage readings", () => {
  const ev = (info: Record<string, unknown>) => JSON.stringify({ type: "rate_limit_event", rate_limit_info: info });
  it("reads Claude Code's rate_limit_event lines (utilization share or percent; rejected = 100 %)", () => {
    const text = [
      "some tool output mentioning rate_limit but no event",
      ev({ status: "allowed_warning", rateLimitType: "five_hour", utilization: 0.82, resetsAt: 1762700000 }),
      ev({ status: "allowed", rateLimitType: "seven_day", utilization: 41 }),
      `[agent] ${ev({ status: "rejected", rateLimitType: "five_hour", resetsAt: 1762703600 })}`,
    ].join("\n");
    expect(usageFromText(text)).toEqual({ usage5h: 100, usage7d: 41, resetsAt: 1762703600_000, rejected: true });
    expect(usageFromText("nothing here")).toBeNull();
  });

  it("reads a probe's answer in percent", () => {
    expect(parseProbeAnswer('{"five_hour":{"utilization":42,"resets_at":"2026-11-09T14:00:00Z"},"seven_day":{"utilization":10,"resets_at":"2026-11-12T00:00:00Z"}}'))
      .toEqual({ usage5h: 42, usage7d: 10, resetsAt: Date.parse("2026-11-09T14:00:00Z") });
    expect(parseProbeAnswer("not json")).toBeNull();
    expect(parseProbeAnswer("{}")).toBeNull();
  });

  it("reads the agent logs a lane wrote since it started", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lane-"));
    try {
      fs.writeFileSync(path.join(dir, "x.agent.log"), `===== agent call [dev] (2.0s, rc=0) =====\n${ev({ status: "allowed", rateLimitType: "five_hour", utilization: 0.5 })}\n`);
      fs.writeFileSync(path.join(dir, "notes.txt"), ev({ status: "rejected", rateLimitType: "five_hour" }));
      expect(laneUsage({ reportDirs: [dir, path.join(dir, "missing")], since: Date.now() - 60_000 })).toMatchObject({ usage5h: 50, rejected: false });
      expect(laneUsage({ reportDirs: [dir], since: Date.now() + 60_000 })).toBeNull();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the pool on a host", () => {
  const made: string[] = [];
  afterEach(() => {
    installAccountPool(null);
    for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  function host(labels: string[], o: { key?: boolean } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-accounts-"));
    made.push(root);
    const accounts = path.join(root, "accounts");
    fs.mkdirSync(accounts, { mode: 0o700 });
    for (const l of labels) fs.mkdirSync(path.join(accounts, l), { mode: 0o700 });
    const keyFile = path.join(root, "anthropic-fallback.key");
    if (o.key) fs.writeFileSync(keyFile, "test-fallback-key-0123456789", { mode: 0o600 });
    const env = { MF_AI_ACCOUNTS_DIR: accounts, MADP_FALLBACK_KEY_FILE: keyFile, VITEST: "1" } as NodeJS.ProcessEnv;
    return { root, accounts, env, state: path.join(root, "state") };
  }

  it("has no pool without MF_AI_ACCOUNTS_DIR or without a usable folder: the lanes run as before", () => {
    expect(discoverAccounts({} as NodeJS.ProcessEnv)).toEqual([]);
    const h = host([]);
    expect(discoverAccounts(h.env)).toEqual([]);
    const pool = createAccountPool({ env: h.env, stateDir: h.state });
    expect(pool.lease()).toBeNull();
    expect(accountPool()).toBeNull();
  });

  it("finds private account folders, leaves out open ones and bad labels, and adds the API key when one is stored", () => {
    const h = host(["sub-a", "sub-b", "Bad.Label"], { key: true });
    fs.mkdirSync(path.join(h.accounts, "open"), { mode: 0o755 });
    fs.chmodSync(path.join(h.accounts, "open"), 0o755);
    const lines: string[] = [];
    const found = discoverAccounts(h.env, (l) => lines.push(l));
    expect(found.map((a) => `${a.label}:${a.provider}`)).toEqual(["sub-a:claude-subscription", "sub-b:claude-subscription", "api-key:anthropic-api"]);
    expect(lines.join("\n")).toMatch(/open is left out/);
  });

  it("gives each lane its account's config folder and own limit record, rotates on a limit and falls back to the key", () => {
    const h = host(["sub-a", "sub-b"], { key: true });
    let now = NOW;
    const pool = createAccountPool({ env: h.env, stateDir: h.state, now: () => now });
    pool.configure({ settings: new Map([["sub-b", { setting: "active", priority: 1 }]]) });
    const first = pool.lease()!;
    expect(first.label).toBe("sub-b");
    const env = first.env({ PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "parent-token", ANTHROPIC_API_KEY: "parent-key" });
    expect(env.CLAUDE_CONFIG_DIR).toBe(path.join(h.accounts, "sub-b"));
    expect(env.MADP_FALLBACK_HOME).toBe(path.join(h.state, "sub-b"));
    expect(env.MADP_FALLBACK_KEY_FILE).toBe(path.join(h.root, "anthropic-fallback.key"));
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    // the lane stopped at the subscription's limit: sub-b rests until the reset, sub-a takes over
    first.done({ capacity: { kind: "limit", resetsAt: NOW + 2 * 3_600_000 } });
    expect(pool.accounts().find((a) => a.label === "sub-b")?.coolingUntil).toBe(NOW + 2 * 3_600_000);
    const second = pool.lease()!;
    expect(second.label).toBe("sub-a");
    // sub-a's agents saw 99 % of the 5-hour window: it rests too
    second.done({ usage: { usage5h: 99, resetsAt: NOW + 3_600_000 } });
    const third = pool.lease()!;
    expect(third.label).toBe("api-key");
    expect(third.provider).toBe("anthropic-api");
    const keyEnv = third.env({ PATH: "/bin", CLAUDE_CODE_OAUTH_TOKEN: "parent-token" });
    expect(keyEnv.ANTHROPIC_API_KEY).toBe("test-fallback-key-0123456789");
    expect(keyEnv.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    third.done();
    // past sub-a's reset: back on sub-a (its window starts empty again)
    now = NOW + 3_600_000 + 1;
    expect(pool.lease()?.label).toBe("sub-a");
  });

  it("rests an account whose lanes recorded a limit in its own limit record", () => {
    const h = host(["sub-a", "sub-b"]);
    const pool = createAccountPool({ env: h.env, stateDir: h.state, now: () => NOW });
    fs.mkdirSync(path.join(h.state, "sub-a"), { recursive: true });
    fs.writeFileSync(path.join(h.state, "sub-a", "limit-state.json"), JSON.stringify({ until: (NOW + 600_000) / 1000 }));
    expect(pool.lease()?.label).toBe("sub-b");
  });

  it("answers no lease when every account rests and no key is stored", () => {
    const h = host(["sub-a"]);
    const pool = createAccountPool({ env: h.env, stateDir: h.state, now: () => NOW });
    pool.lease()!.done({ capacity: { kind: "rate", resetsAt: null } });
    expect(pool.lease()).toBeNull();
  });

  it("runs the usage probe at its interval and records what it reads", async () => {
    const h = host(["sub-a"]);
    let calls = 0;
    let now = NOW;
    const pool = createAccountPool({
      env: h.env, stateDir: h.state, now: () => now, probeEveryMs: 300_000,
      probe: async (a) => {
        calls += 1;
        expect(a.dir).toBe(path.join(h.accounts, "sub-a"));
        return { usage5h: 12, usage7d: 99.5, resetsAt: NOW + 86_400_000 };
      },
    });
    await pool.probe();
    await pool.probe();
    expect(calls).toBe(1);
    expect(pool.accounts()[0]).toMatchObject({ usage5h: 12, usage7d: 99.5 });
    expect(pool.lease()).toBeNull(); // 7-day window at 99.5 %: rests
    now += 300_001;
    await pool.probe();
    expect(calls).toBe(2);
  });
});
