// Out of AI capacity (server/api/extraction/claudeCapacity.ts): detection on Claude Code's real output shapes, the
// one retry on the operator's fallback key (a fake CLI, a fake key in a temporary home: never the real one), the plain
// message without a key, the official lanes, and the job keeping its tries so people can start it again.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { canApplyJobEvent } from "../../src/domain/engineJob";
import type { EngineJobKind } from "../../src/domain/engineJob";
import {
  CAPACITY_CODE, CapacityError, agentLogCapacity, capacityMessage, detectCapacity, detectLimitText, limitUntil, markLimit,
} from "../../server/api/extraction/claudeCapacity.ts";
import { callClaudeRunner } from "../../server/api/extraction/claudeRunner.ts";
import { readSource } from "../../server/api/extraction/process.ts";
import { claudeRunner } from "../../server/local/engine/ai/claude.ts";
import { aiJson, setAiRunner } from "../../server/local/engine/ai/index.ts";
import { laneFailure, runLane } from "../../server/local/engine/official/madp.ts";
import { JobFailure, type KindWriter } from "../../server/local/engine/run.ts";
import { makeWorld, type World } from "./harness";

const FAKE_KEY = "sk-ant-test-fallback-0123456789";
const RESET_S = 2_000_000_000; // 2033-05-18, always in the future for these tests

const line = (o: object) => JSON.stringify(o);
/** A stream-json run that hit the weekly limit, as Claude Code prints it. */
const WEEKLY_STREAM = [
  line({ type: "system", subtype: "init", apiKeySource: "none", model: "claude-sonnet-4-5", tools: [] }),
  line({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: RESET_S, rateLimitType: "seven_day", overageStatus: "rejected" } }),
  line({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "You've hit your weekly limit · resets Nov 6, 7pm (Europe/Zurich)" }] } }),
  line({ type: "result", subtype: "success", is_error: true, duration_ms: 212, num_turns: 1, result: "You've hit your weekly limit · resets Nov 6, 7pm (Europe/Zurich)", usage: { input_tokens: 0, output_tokens: 0 } }),
].join("\n");
/** --output-format json: one result object. */
const SESSION_JSON = line({ type: "result", subtype: "success", is_error: true, duration_ms: 180, result: "You've hit your session limit · resets 7:10pm", usage: { input_tokens: 0, output_tokens: 0 } });
const OK_JSON = line({ type: "result", subtype: "success", is_error: false, result: "", structured_output: { ok: true }, usage: { input_tokens: 10, output_tokens: 4 } });

describe("detecting out of capacity", () => {
  it("reads the subscription limit from stream-json, json and the older text form, with its reset", () => {
    expect(detectCapacity(WEEKLY_STREAM)).toEqual({ kind: "limit", resetsAt: RESET_S * 1000, resetsText: null });
    expect(detectCapacity(SESSION_JSON)).toEqual({ kind: "limit", resetsAt: null, resetsText: "7:10pm" });
    const legacy = line({ type: "result", subtype: "success", is_error: true, result: "Claude AI usage limit reached|1762452600" });
    expect(detectCapacity(legacy)).toMatchObject({ kind: "limit", resetsAt: 1762452600_000 });
    expect(detectCapacity("", "Error: You've hit your weekly limit · resets Nov 6, 7pm (Europe/Zurich)\n"))
      .toEqual({ kind: "limit", resetsAt: null, resetsText: "Nov 6, 7pm (Europe/Zurich)" });
  });

  it("reads a 429 rate limit, an overloaded API and a key without credit as out of capacity", () => {
    const rate = line({ type: "result", subtype: "success", is_error: true, result: 'API Error: 429 {"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed the rate limit for your organization of 50,000 input tokens per minute."}}' });
    expect(detectCapacity(rate)?.kind).toBe("rate");
    const overloaded = line({ type: "result", subtype: "success", is_error: true, result: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' });
    expect(detectCapacity(overloaded)?.kind).toBe("overloaded");
    expect(detectCapacity(line({ type: "result", is_error: true, result: "Credit balance is too low" }))?.kind).toBe("credit");
  });

  it("leaves every other failure alone", () => {
    const allowed = line({ type: "rate_limit_event", rate_limit_info: { status: "allowed", overageStatus: "rejected", overageDisabledReason: "out_of_credits" } });
    expect(detectCapacity(`${allowed}\n${line({ type: "result", is_error: true, result: "API Error: 500 Internal server error" })}`)).toBeNull();
    expect(detectCapacity(line({ type: "result", is_error: true, result: "Invalid API key · Please run /login" }))).toBeNull();
    // the assistant's own writing is never read: a Make session may write about limits or overloaded functions
    const writing = [
      line({ type: "assistant", message: { content: [{ type: "text", text: "The overloaded handler hit your usage limit check; API Error: 429 is handled." }] } }),
      line({ type: "result", is_error: true, subtype: "error_max_turns", result: "" }),
    ].join("\n");
    expect(detectCapacity(writing)).toBeNull();
    // a lane's stderr also holds tool output: GitHub's rate limit and line numbers are not Claude's capacity
    expect(detectLimitText("git push: API rate limit exceeded for installation\nsrc/App.tsx(429,7): error TS2304\nHTTP 429")).toBeNull();
    expect(detectLimitText("✗ agent_failed: agent exited 1: You've hit your session limit · resets 7:10pm")).toMatchObject({ kind: "limit", resetsText: "7:10pm" });
  });

  it("reads which agent of a lane stopped out of capacity from its agent log", () => {
    const call = (label: string, rc: number, out: string, key = false) =>
      `\n===== agent call${label ? ` [${label}]` : ""} (0.4s, rc=${rc}${key ? ", auth: fallback API key" : ""}) =====\nclaude -p --output-format stream-json\n${out}\n`;
    expect(agentLogCapacity(call("dev s1", 1, WEEKLY_STREAM))?.kind).toBe("limit");
    // the limit, then the key answered: not a capacity stop
    expect(agentLogCapacity(call("dev s1", 1, WEEKLY_STREAM) + call("dev s1", 0, OK_JSON, true))).toBeNull();
    // the limit, then the key failed too: a capacity stop
    expect(agentLogCapacity(call("planner", 1, SESSION_JSON) + call("planner", 1, line({ type: "result", is_error: true, result: "Invalid API key" }), true))).toMatchObject({ resetsText: "7:10pm" });
    // a later call of another agent that failed for another reason does not hide it, and a failure without one is no stop
    expect(agentLogCapacity(call("dev s1", 1, WEEKLY_STREAM) + call("dev s2", 0, OK_JSON))?.kind).toBe("limit");
    expect(agentLogCapacity(call("", 1, line({ type: "result", is_error: true, result: "API Error: 500" })))).toBeNull();
  });

  it("says it in plain words, with the reset when it is known", () => {
    const now = Date.UTC(2026, 10, 5, 12, 0);
    const at = capacityMessage({ resetsAt: Date.UTC(2026, 10, 6, 18, 10), resetsText: null }, { now, timeZone: "UTC" });
    expect(at).toMatch(/^The engine's AI capacity is used up until Fri 6 Nov, 18:10 UTC\. Nothing was lost; start it again then\.$/);
    expect(capacityMessage({ resetsAt: null, resetsText: "7:10pm" }, { now })).toBe("The engine's AI capacity is used up until 7:10pm. Nothing was lost; start it again then.");
    expect(capacityMessage(null)).toBe("The engine's AI capacity is used up for now. Nothing was lost; start it again once it is back.");
    expect(new CapacityError(null).code).toBe(CAPACITY_CODE);
  });
});

describe("one call out of capacity, with and without the fallback key", () => {
  let root: string;
  let home: string;
  let bin: string;
  const logs: string[] = [];
  const keyFile = () => path.join(home, "anthropic-fallback.key");
  const writeKey = (mode = 0o600) => {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(keyFile(), `${FAKE_KEY}\n`, { mode });
    fs.chmodSync(keyFile(), mode);
  };
  /** The fake CLI: the subscription is out (json or stream-json); with ANTHROPIC_API_KEY set it answers, unless `mode`
   *  says the key is out too. It records its argv and which login it had, never the key's value. */
  const fakeCli = (stream: boolean) => {
    const limited = stream ? WEEKLY_STREAM : SESSION_JSON;
    fs.writeFileSync(path.join(root, "limited.out"), `${limited}\n`);
    fs.writeFileSync(path.join(root, "ok.out"), `${OK_JSON}\n`);
    fs.writeFileSync(path.join(root, "expected"), FAKE_KEY);
    fs.writeFileSync(bin, [
      "#!/bin/sh",
      'dir=$(dirname "$0")',
      'printf "%s\\n" "$*" >> "$dir/argv.log"',
      "cat > /dev/null",
      'match=no; [ "$ANTHROPIC_API_KEY" = "$(cat "$dir/expected")" ] && match=yes',
      'echo "key=${ANTHROPIC_API_KEY:+set} match=$match oauth=${CLAUDE_CODE_OAUTH_TOKEN:+set}" >> "$dir/auth.log"',
      'if [ -n "$ANTHROPIC_API_KEY" ] && [ ! -f "$dir/key-out" ]; then cat "$dir/ok.out"; exit 0; fi',
      'cat "$dir/limited.out"; exit 1',
      "",
    ].join("\n"), { mode: 0o755 });
  };
  const auth = () => fs.readFileSync(path.join(root, "auth.log"), "utf8").trim().split("\n");
  const argv = () => fs.readFileSync(path.join(root, "argv.log"), "utf8");
  const everything = () => [argv(), ...logs, fs.existsSync(path.join(home, "limit-state.json")) ? fs.readFileSync(path.join(home, "limit-state.json"), "utf8") : ""].join("\n");

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-capacity-"));
    home = path.join(root, "madp-home");
    bin = path.join(root, "claude");
    logs.length = 0;
    vi.stubEnv("MADP_FALLBACK_HOME", home);
    vi.stubEnv("MADP_FALLBACK_KEY_FILE", "");
    vi.stubEnv("CLAUDE_CODE_OAUTH_TOKEN", "fake-oauth-login");
    vi.stubEnv("MF_ENGINE_AI_CLAUDE_BINARY", bin);
    vi.stubEnv("MF_EXTRACTION_CLAUDE_BINARY", bin);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const ask = () => claudeRunner({ system: "Write", prompt: "Write the plan", schema: { type: "object" }, timeoutMs: 20_000, log: (l) => logs.push(l) });

  it("retries once on the fallback key and answers; the key is never in argv, logs or the record", async () => {
    fakeCli(false);
    writeKey();
    await expect(ask()).resolves.toEqual({ ok: true });
    expect(auth()).toEqual(["key= match=no oauth=set", "key=set match=yes oauth="]);
    expect(everything()).not.toContain(FAKE_KEY);
    expect(logs.join("\n")).toMatch(/trying once more on the fallback API key/);
    // the limit is recorded (one hour without a reset time), so the next call goes straight to the key
    expect(limitUntil(process.env)).toBeGreaterThan(Date.now() + 3_500_000);
    await expect(ask()).resolves.toEqual({ ok: true });
    expect(auth()).toHaveLength(3);
    expect(auth()[2]).toBe("key=set match=yes oauth=");
  });

  it("fails with the plain capacity message and its own code when no key is stored", async () => {
    fakeCli(true);
    const err = await ask().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobFailure);
    expect((err as JobFailure).code).toBe(CAPACITY_CODE);
    expect((err as JobFailure).message).toMatch(/^The engine's AI capacity is used up until \w{3} \d{1,2} \w{3}, \d{2}:\d{2} \S+\. Nothing was lost; start it again then\.$/);
    expect(auth()).toHaveLength(1);
  });

  it("ignores a key file other users can read", async () => {
    fakeCli(false);
    writeKey(0o644);
    const err = await ask().catch((e: unknown) => e);
    expect((err as JobFailure).code).toBe(CAPACITY_CODE);
    expect((err as JobFailure).message).toContain("until 7:10pm");
    expect(auth()).toEqual(["key= match=no oauth=set"]);
    expect(logs.join("\n")).toMatch(/fallback API key file is ignored/);
    expect(everything()).not.toContain(FAKE_KEY);
  });

  it("names only the reset Claude Code gave, never the record's one-hour guess (it would slide with every call)", async () => {
    fakeCli(false);
    const first = await ask().catch((e: unknown) => e);
    expect((first as JobFailure).message).toBe("The engine's AI capacity is used up until 7:10pm. Nothing was lost; start it again then.");
    // Claude Code gave no exact time: the record holds the one-hour guess, which only decides when to try again
    expect(limitUntil(process.env)).toBeGreaterThan(Date.now() + 3_500_000);
    const again = await ask().catch((e: unknown) => e);
    expect((again as JobFailure).message).toBe("The engine's AI capacity is used up until 7:10pm. Nothing was lost; start it again then.");
    // a later answer without any reset says "for now", not the recorded guess
    fs.writeFileSync(path.join(root, "limited.out"), `${line({ type: "result", subtype: "success", is_error: true, result: "You've hit your session limit" })}\n`);
    const plain = await ask().catch((e: unknown) => e);
    expect((plain as JobFailure).code).toBe(CAPACITY_CODE);
    expect((plain as JobFailure).message).toBe("The engine's AI capacity is used up for now. Nothing was lost; start it again once it is back.");
    expect(auth()).toEqual(Array(3).fill("key= match=no oauth=set"));
  });

  it("does not show the recorded guess either when the fallback key is out too", async () => {
    fakeCli(false);
    writeKey();
    fs.writeFileSync(path.join(root, "key-out"), "");
    fs.writeFileSync(path.join(root, "limited.out"), `${line({ type: "result", subtype: "success", is_error: true, result: "Credit balance is too low" })}\n`);
    markLimit(null, process.env);
    const err = await ask().catch((e: unknown) => e);
    expect((err as JobFailure).code).toBe(CAPACITY_CODE);
    expect((err as JobFailure).message).toBe("The engine's AI capacity is used up for now. Nothing was lost; start it again once it is back.");
    expect(auth()).toEqual(["key=set match=yes oauth="]);
  });

  it("fails with the capacity message when the key is out too, and never shows the key", async () => {
    fakeCli(false);
    writeKey();
    fs.writeFileSync(path.join(root, "key-out"), "");
    const err = await ask().catch((e: unknown) => e);
    expect((err as JobFailure).code).toBe(CAPACITY_CODE);
    expect(String((err as Error).message)).not.toContain(FAKE_KEY);
    expect(auth()).toHaveLength(2);
    expect(everything()).not.toContain(FAKE_KEY);
  });

  it("does the same for the file extraction runner, and the reading carries the code", async () => {
    fakeCli(true);
    writeKey();
    await expect(callClaudeRunner("Read this", { outputSchema: { type: "object" } })).resolves.toBe('{"ok":true}');
    expect(auth()).toEqual(["key= match=no oauth=set", "key=set match=yes oauth="]);
    expect(argv()).not.toContain(FAKE_KEY);

    fs.rmSync(keyFile());
    fs.rmSync(path.join(home, "limit-state.json"), { force: true });
    const err = await callClaudeRunner("Read this", { outputSchema: { type: "object" } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CapacityError);
    const reading = await readSource(
      { fileId: "f1", fileName: "notes.txt", mimeType: "text/plain", bytes: Buffer.from("The booking needs a deposit.") },
      { callAI: () => Promise.reject(new CapacityError({ resetsAt: null, resetsText: "7:10pm" })) },
    );
    expect(reading.result.status).toBe("failed");
    expect(reading.errorCode).toBe(CAPACITY_CODE);
    expect(reading.error).toBe("The engine's AI capacity is used up until 7:10pm. Nothing was lost; start it again then.");
  });
});

describe("an engine step out of capacity", () => {
  afterEach(() => setAiRunner(null));
  const fakeRun = (logs: string[]) => ({
    id: "job-cap", attempt: 1, signal: new AbortController().signal, job: { Progress: 10 },
    step: async () => undefined, check: () => undefined, log: (l: string) => logs.push(l),
  });

  it("stops the job with the capacity message instead of writing the built-in text", async () => {
    const logs: string[] = [];
    let calls = 0;
    setAiRunner(async () => {
      calls += 1;
      throw new CapacityError({ resetsAt: null, resetsText: "7:10pm" });
    });
    const err = await aiJson(fakeRun(logs) as never, { task: "requirements", role: "You are the analyst.", prompt: "x", schema: {}, accept: () => ({}) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobFailure);
    expect((err as JobFailure).code).toBe(CAPACITY_CODE);
    expect(calls).toBe(1);
    expect(logs.join("\n")).not.toMatch(/FALLBACK to the built-in text/);
  });
});

describe("an official lane out of capacity", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });
  function fakeEngine(script: string): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-lane-cap-"));
    made.push(root);
    const home = path.join(root, "engine");
    fs.mkdirSync(path.join(home, "MADP", "orchestrator", "cli"), { recursive: true });
    fs.writeFileSync(path.join(home, "MADP", "orchestrator", "cli", "project.py"), "");
    const py = path.join(root, "fake-python.sh");
    fs.writeFileSync(py, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    vi.stubEnv("MF_MADP_ENGINE_HOME", home);
    vi.stubEnv("MF_MADP_PYTHON", py);
    return path.join(root, "project");
  }
  const fakeRun = () => ({ id: "job-lane", signal: new AbortController().signal, heartbeat: async () => undefined, log: () => undefined, check: () => undefined });
  const agentLog = (dir: string, body: string) => `mkdir -p "${dir}"\ncat > "${dir}/20261105-120000-cr-1.agent.log" <<'LOG'\n${body}\nLOG`;

  it("gives the job the plain capacity message, and passes the fallback settings on", async () => {
    vi.stubEnv("MADP_FALLBACK_HOME", "/srv/fallback-test-home");
    const project = fakeEngine([
      'echo "fallback home: $MADP_FALLBACK_HOME" >&2',
      agentLog("$MADP_FEATURE_REPORT_DIR", `===== agent call [dev s1] (0.3s, rc=1) =====\nclaude -p\n${WEEKLY_STREAM}`),
      'echo "dev: 2 agent(s) in parallel, failed: [\'s1\'] (0.5s)" >&2',
      'echo "✗ agent_failed: step(s) [\'s1\'] failed" >&2',
      "exit 4",
    ].join("\n"));
    const r = await runLane(fakeRun() as never, ["feature"], { projectDir: project, label: "feature", timeoutMs: 20_000 });
    expect(r.code).toBe(4);
    expect(r.tail).toContain("fallback home: /srv/fallback-test-home");
    const f = laneFailure("Milestone 1", r);
    expect(f.code).toBe(CAPACITY_CODE);
    expect(f.message).toMatch(/^The engine's AI capacity is used up until \w{3} \d{1,2} \w{3}, \d{2}:\d{2} \S+\. Nothing was lost; start it again then\.$/);
  });

  it("keeps the lane's own failure when the fallback key carried the agent through", async () => {
    const project = fakeEngine([
      agentLog("$MADP_QUICK_REPORT_DIR", `===== agent call (0.3s, rc=1) =====\nclaude -p\n${SESSION_JSON}\n===== agent call (9.1s, rc=0, auth: fallback API key) =====\nclaude -p\n${OK_JSON}`),
      'echo "verify: FAIL (2.0s)" >&2',
      "exit 5",
    ].join("\n"));
    const r = await runLane(fakeRun() as never, ["quick"], { projectDir: project, label: "quick", timeoutMs: 20_000 });
    expect(r.capacity).toBeNull();
    expect(laneFailure("CR-1", r).code).toBe("madp.verify");
  });

  it("reads the quick lane's own words when it printed the agent's answer", async () => {
    const project = fakeEngine(`echo "✗ agent_failed: agent exited 1: You've hit your session limit · resets 7:10pm" >&2\nexit 4`);
    const r = await runLane(fakeRun() as never, ["quick"], { projectDir: project, label: "quick", timeoutMs: 20_000 });
    expect(laneFailure("CR-2", r).message).toBe("The engine's AI capacity is used up until 7:10pm. Nothing was lost; start it again then.");
  });
});

describe("a job stopped out of capacity keeps its tries", () => {
  let w: World;
  let fail = true;
  const WRITER: KindWriter = async (run) => {
    await run.step(20, "Reading the records.");
    if (fail) throw new JobFailure(capacityMessage(null), CAPACITY_CODE);
    return { outputs: [], message: "Done." };
  };
  beforeAll(async () => {
    w = await makeWorld({ writers: async (_k: EngineJobKind) => WRITER });
  });
  afterAll(() => w?.close());

  it("can be started again any number of times, also as a retry claimed for its host", async () => {
    const id = await w.queue({ project: "Supplier Quality Portal", kind: "wiki.generate", input: {}, key: "capacity" });
    for (let round = 0; round < 4; round++) {
      await w.settle();
      const failed = w.get("EngineJob", id);
      expect(failed.Status).toBe("failed");
      expect(failed.ErrorCode).toBe(CAPACITY_CODE);
      expect(failed.Message).toBe(capacityMessage(null));
      expect(failed.Attempts).toBe(0);
      expect(canApplyJobEvent({ status: "failed", progress: 0, attempts: Number(failed.Attempts), message: null }, "retry", "user")).toBe(true);
      if (round < 3) await w.gw.update("EngineJob", id, { Status: "queued", Progress: 0, Message: "", ActiveKey: "wiki.generate:project" });
    }
    // the capacity is back; a retry claimed straight for this host (jobs.ts retryHostClaim) is resumed and finishes
    fail = false;
    await w.gw.update("EngineJob", id, { Status: "claimed", Attempts: 1, ClaimedBy: "madp-engine-zrh-01", ClaimedAt: w.now().toISOString(), Progress: 0, Message: "", ActiveKey: "wiki.generate:project" });
    await w.settle();
    expect(w.get("EngineJob", id).Status).toBe("succeeded");
  });
});
