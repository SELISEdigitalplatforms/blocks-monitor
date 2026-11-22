// What people read on a job is plain: raw tool output (npm warnings, stack traces, tracebacks, JSON, host paths, exit
// codes) never reaches a job's line, the raw text goes to the engine log, the ErrorCode stays, and lines that are
// already plain pass unchanged. The rules (src/domain/jobMessage.ts), the engine's gateway (plainMessages.ts), the driver
// end to end, the web's reading of rows written before the rules, and every hand-written failure line in the engine.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RawGateway, Row } from "../../functions/_lib/gateway";
import type { EngineJobKind } from "../../src/domain/engineJob";
import {
  attemptsMessage, failedStepOf, failureSentence, fitMessage, isTechnicalMessage, plainFailureMessage, plainJobMessage, technicalSignal, timeLimitMessage,
} from "../../src/domain/jobMessage";
import { toEngineJob } from "../../src/blocks/engine/types";
import { plainJobWrites } from "../../server/local/engine/plainMessages.ts";
import { laneFailure } from "../../server/local/engine/official/madp.ts";
import { JobFailure, type KindWriter } from "../../server/local/engine/run.ts";
import { makeWorld, type World } from "./harness";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// The line the owner saw on the build page (the official engine's setup lane, before its own message was made plain).
const NPM =
  "Setting up the product: the official MADP engine stopped (exit 1). npm warn install-scripts esbuild@0.28.2 (postinstall: node install.js) npm warn install-scripts …";
const NODE_STACK = [
  "TypeError: Cannot read properties of undefined (reading 'Kind')",
  "    at JobRun.step (/srv/engine/frontend/server/local/engine/run.ts:217:19)",
  "    at async buildRun (/srv/engine/frontend/server/local/engine/kinds/delivery.ts:360:5)",
].join("\n");
const PY_TRACEBACK = [
  "Traceback (most recent call last):",
  '  File "/opt/madp/lanes/new_app.py", line 212, in <module>',
  "    main()",
  "subprocess.CalledProcessError: Command '['npm', 'install']' returned non-zero exit status 1.",
].join("\n");
const JSON_ERROR = '{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long"}}';
const JSON_IN_LINE = 'The planner did not answer: {"code":"invalid_argument","message":"schema mismatch"}';
const UNIX_PATH = "Could not write /tmp/madp-run-4821/lane.log";
const WINDOWS_PATH = "Could not write C:\\ProgramData\\madp\\runs\\lane.log";
const EXIT = "claude exited with code 1";
const LIBRARY = "Error: spawn git ENOENT";
const TRANSIENT = "FetchError: request to the Data Gateway failed, reason: socket hang up (ETIMEDOUT)";

const BUILD_SENTENCE = "The build stopped while building the milestone. Start it again; if it stops the same way again, ask the engine team to look into it.";
const RAW_BITS = /npm|exit|esbuild|\/srv|\/opt|\/tmp|C:\\|Traceback|TypeError|ENOENT|\{|run\.ts|line \d/;

describe("the rules for a job's line", () => {
  it.each([
    ["the npm output", NPM, "exit code"],
    ["a Node stack trace", NODE_STACK, "stack frame"],
    ["a Python traceback", PY_TRACEBACK, "python traceback"],
    ["a JSON error", JSON_ERROR, "json"],
    ["JSON inside a line", JSON_IN_LINE, "json"],
    ["a host path", UNIX_PATH, "host path"],
    ["a Windows path", WINDOWS_PATH, "host path"],
    ["an exit code", EXIT, "exit code"],
    ["a library error", LIBRARY, "system error"],
    ["three lines of output", "first\nsecond\nthird", "dump"],
    ["a very long text", "word ".repeat(450), "dump"],
  ])("sees %s as raw output", (_name, raw, signal) => {
    expect(technicalSignal(raw)).toBe(signal);
    const shown = plainFailureMessage("build.run", raw);
    expect(shown).not.toMatch(RAW_BITS);
    expect(shown.length).toBeLessThanOrEqual(200);
    expect(shown).toMatch(/^The build stopped while [a-z' ]+[.:] /);
  });

  it("names the step a raw failure gives in plain words, and the kind's own work otherwise", () => {
    expect(plainFailureMessage("build.run", NPM)).toBe(
      "The build stopped while setting up the product. Start it again; if it stops the same way again, ask the engine team to look into it.",
    );
    expect(plainFailureMessage("build.run", NODE_STACK)).toBe(BUILD_SENTENCE);
    expect(plainFailureMessage("build.run", PY_TRACEBACK)).toBe(BUILD_SENTENCE);
    expect(plainFailureMessage("preview.deploy", "Releasing to production: git push rejected (exit 128)")).toBe(
      "The milestone preview stopped while releasing to production. Start it again; if it stops the same way again, ask the engine team to look into it.",
    );
    expect(failedStepOf("Building M1: exit 1")).toBe("");
    expect(failedStepOf("Warning: exit 1")).toBe("");
  });

  it("asks for a new start in a few minutes when a service did not answer", () => {
    expect(plainFailureMessage("chat.reply", TRANSIENT)).toBe(
      "The assistant stopped while writing the reply: a service it needs did not answer in time. Start it again in a few minutes.",
    );
  });

  it("an agent that changed nothing is named as such, not as one that did not finish", () => {
    const f = laneFailure("CR-004", { code: 4, tail: ["status   FAILED (no_changes)  (19s, exit 4)"], steps: [] });
    expect(f.message).toBe("CR-004 stopped: the development agent found nothing to change, so nothing was deployed. Describe the change more precisely and start it again.");
    expect(f.code).toBe("madp.no_changes");
    expect(laneFailure("CR-004", { code: 4, tail: ["status   FAILED (agent_timeout)"], steps: [] }).message).toMatch(/did not finish/);
  });

  it("a failure line says what happens next and who acts, and keeps it within a job's line", () => {
    // a fix round's developer that found nothing to change: a person decides on the change's page
    const fix = laneFailure("CR-007: SIA progress invoicing per partial service", { code: 4, tail: ["status   FAILED (no_changes)  (19s, exit 4)"], steps: [] }, { fix: true });
    expect(fix.message).toBe("CR-007: SIA progress invoicing per partial service stopped: the development agent found nothing to change, so nothing was deployed. Decide on the change's page how to go on.");
    // a long label and step: the step and then the cause give way, the next step never does
    const long = "CR-012: Progress invoicing per partial service with deductions on the final invoice";
    const f = laneFailure(long, { code: 5, tail: [], steps: [{ name: "verify[api]", outcome: "FAIL typecheck=2", seconds: 9 }] });
    expect(f.message.length).toBeLessThanOrEqual(200);
    expect(f.message).toMatch(/Start it again for another try, or describe the change more precisely\.$/);
    for (const code of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
      const line = laneFailure(long, { code, tail: [], steps: [{ name: "deploy[web]", outcome: "FAIL verdict failed", seconds: 9 }] }).message;
      expect(line.length).toBeLessThanOrEqual(200);
      expect(line).toMatch(/start it again|Decide on the change's page/i);
      expect(line).not.toMatch(/has the details/);
    }
    for (const kind of ["build.run", "change.build", "wiki.generate", "unknown.kind"]) {
      expect(failureSentence(kind)).toMatch(/Start it again; if it stops the same way again, ask the engine team to look into it\.$/);
    }
    expect(timeLimitMessage("build.run", 3 * 3_600_000)).not.toMatch(/has the details/);
    expect(attemptsMessage("build.run", 3)).toBe("The build was started 3 times and did not finish. Ask the engine team to look into it, then start it again.");
  });

  it("keeps plain lines exactly as they are", () => {
    const plain = [
      laneFailure("Setting up the product", { code: 1, tail: ["✗ step data-sync failed"], steps: [] }).message,
      laneFailure("Building M01", { code: 5, tail: [], steps: [{ name: "gate[web]", outcome: "FAIL", seconds: 3 }] }).message,
      laneFailure("CR-004", { code: 4, tail: ["status   FAILED (no_changes)  (19s, exit 4)"], steps: [] }).message,
      "This file is no longer in the project.",
      "This file is not a valid PDF. Export it as a PDF and try again.",
      "This is a new feature: add it through Scope & success.",
      "Figma Make needs available AI credits. Review the connected account's allowance before starting another iteration.",
      "needs.md: 1 finding.",
      "Release 1.0.0 is on dev.",
      "Building M1: Checkout flow.",
      "CR-004 released to dev as 1.2.0.",
      "Reading quality-plan.xlsx…",
    ];
    for (const line of plain) {
      expect(isTechnicalMessage(line), line).toBe(false);
      expect(plainFailureMessage("build.run", line)).toBe(line);
      expect(plainJobMessage("build.run", "running", line)).toBe(line);
    }
  });

  it("cuts a plain line longer than a job line at the end of a sentence", () => {
    const conflicts = "The goal says invoices go out by e-mail, but the design only prints them. ".repeat(6);
    const long = `This design change conflicts with the agreed requirements. ${conflicts}Update or clarify the requirements first.`;
    const shown = plainFailureMessage("design.generate", long);
    expect(shown).toBe("This design change conflicts with the agreed requirements. The goal says invoices go out by e-mail, but the design only prints them.");
    expect(fitMessage("short")).toBe("short");
  });

  it("gives every kind a sentence, and a raw line on a job at work or finished never shows", () => {
    expect(failureSentence("unknown.kind")).toBe("This work stopped. Start it again; if it stops the same way again, ask the engine team to look into it.");
    expect(plainFailureMessage("wiki.generate", "")).toMatch(/^The wiki stopped while writing the wiki pages\./);
    expect(plainJobMessage("build.run", "running", UNIX_PATH)).toBeNull();
    expect(plainJobMessage("build.run", "succeeded", NODE_STACK)).toBe("The build finished.");
  });
});

/** A gateway that records what reached it. */
function recorder(): { gw: RawGateway; writes: { schema: string; id: string; row: Row }[] } {
  const writes: { schema: string; id: string; row: Row }[] = [];
  const gw: RawGateway = {
    get: async () => null,
    find: async () => ({ items: [], totalCount: 0 }),
    findAll: async () => [],
    insert: async (schema, row) => (writes.push({ schema, id: "", row }), { created: true, itemId: "x" }),
    insertMany: async (schema, rows) => (rows.forEach((row) => writes.push({ schema, id: "", row })), { created: rows.length, existing: 0 }),
    update: async (schema, id, row) => void writes.push({ schema, id, row }),
    updateMany: async (schema, _where, row) => (writes.push({ schema, id: "", row }), { matched: 1 }),
    remove: async () => undefined,
  };
  return { gw, writes };
}

describe("the engine's gateway", () => {
  const job = { ItemId: "0f1e2d3c-4b5a-4968-8776-655443322110", Kind: "build.run", Status: "running" };

  it("writes the plain sentence for a raw failure, keeps the ErrorCode and logs the raw text", async () => {
    const { gw, writes } = recorder();
    const log: string[] = [];
    const safe = plainJobWrites(gw, { job: () => job, log: (l) => log.push(l) });
    await safe.update("EngineJob", job.ItemId, { Status: "failed", Message: NPM, ErrorCode: "madp.npm-install", FinishedAt: "2026-11-05T10:00:00.000Z" });
    expect(writes[0]!.row).toEqual({
      Status: "failed",
      Message: "The build stopped while setting up the product. Start it again; if it stops the same way again, ask the engine team to look into it.",
      ErrorCode: "madp.npm-install",
      FinishedAt: "2026-11-05T10:00:00.000Z",
    });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^\[engine\] build\.run 0f1e2d3c: the job's line was raw output \(exit code\)/);
    expect(log[0]).toContain("npm warn install-scripts esbuild@0.28.2");
  });

  it("leaves a raw progress line out (the job keeps its line) and passes plain lines and other schemas as they are", async () => {
    const { gw, writes } = recorder();
    const log: string[] = [];
    const safe = plainJobWrites(gw, { job: () => job, log: (l) => log.push(l) });
    await safe.update("EngineJob", job.ItemId, { Progress: 40, Message: NODE_STACK });
    await safe.update("EngineJob", job.ItemId, { Progress: 50, Message: "Building M1: Checkout flow." });
    await safe.update("Ticket", "t1", { Title: "/tmp/x exit 1" });
    expect(writes.map((w) => w.row)).toEqual([{ Progress: 40 }, { Progress: 50, Message: "Building M1: Checkout flow." }, { Title: "/tmp/x exit 1" }]);
    expect(log).toHaveLength(1);
    expect(plainJobWrites(safe, { job: () => job, log: () => undefined })).toBe(safe);
  });
});

describe("the driver", () => {
  let w: World;
  const raise: Record<string, () => never> = {};
  const writer: KindWriter = async (run) => {
    await run.step(10, "Reading the records.");
    await run.step(20, "Copying into /tmp/madp-run-4821/app");
    raise[run.kind]?.();
    return { outputs: [], message: "Done." };
  };
  beforeAll(async () => {
    w = await makeWorld({ writers: async (_k: EngineJobKind) => writer });
  });
  afterAll(() => w?.close());

  it("fails a job whose JobFailure holds tool output with the plain sentence and its own code; the raw text is in the log", async () => {
    raise["wiki.generate"] = () => {
      throw new JobFailure(NPM, "madp.npm-install");
    };
    const id = await w.queue({ project: "Supplier Quality Portal", kind: "wiki.generate", input: {}, key: "npm" });
    await w.settle();
    const job = w.get("EngineJob", id);
    expect(job.Status).toBe("failed");
    expect(job.ErrorCode).toBe("madp.npm-install");
    expect(job.Message).toBe("The wiki stopped while setting up the product. Start it again; if it stops the same way again, ask the engine team to look into it.");
    expect(w.log.join("\n")).toContain("npm warn install-scripts");
    // the raw progress line never reached the row, and the log has it
    expect(w.log.some((l) => l.includes(id.slice(0, 8)) && l.includes("raw output (host path)"))).toBe(true);
  });

  it("fails a job whose writer throws a library error with the kind's sentence; a timeout asks for a new start soon", async () => {
    raise["docs.generate"] = () => {
      throw new Error(NODE_STACK);
    };
    raise["chat.reply"] = () => {
      throw Object.assign(new Error("request to the Data Gateway timed out"), { code: "ETIMEDOUT" });
    };
    const docs = await w.queue({ project: "Supplier Quality Portal", kind: "docs.generate", input: {}, key: "stack" });
    const chat = await w.queue({ project: "Supplier Quality Portal", kind: "chat.reply", input: {}, key: "timeout" });
    await w.settle();
    expect(w.get("EngineJob", docs)).toMatchObject({
      Status: "failed",
      ErrorCode: "engine.failed",
      Message: "The project documentation stopped while writing the documents. Start it again; if it stops the same way again, ask the engine team to look into it.",
    });
    expect(w.get("EngineJob", chat)).toMatchObject({
      Status: "failed",
      ErrorCode: "engine.failed",
      Message: "The assistant stopped while writing the reply: a service it needs did not answer in time. Start it again in a few minutes.",
    });
  });
});

describe("the web", () => {
  const row = (Status: string, Message: string): Row => ({ ItemId: "j1", ProjectId: "p1", WorkspaceId: "w1", Kind: "build.run", Status, Message, ErrorCode: "madp.failed" });

  it("shows a raw line stored before the rules plainly, and plain lines as they are", () => {
    expect(toEngineJob(row("failed", NPM))?.message).toBe(
      "The build stopped while setting up the product. Start it again; if it stops the same way again, ask the engine team to look into it.",
    );
    expect(toEngineJob(row("failed", NPM))?.errorCode).toBe("madp.failed");
    expect(toEngineJob(row("running", NODE_STACK))?.message).toBeNull();
    expect(toEngineJob(row("failed", "This is a new feature: add it through Scope & success."))?.message).toBe("This is a new feature: add it through Scope & success.");
  });
});

describe("the hand-written failure lines", () => {
  it("are all plain, so the safety net never replaces one", () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const n of fs.readdirSync(dir)) {
        const p = path.join(dir, n);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|mjs)$/.test(n)) files.push(p);
      }
    };
    walk(path.join(ROOT, "server"));
    const literal = /(?:new JobFailure\(|failJob\([^,()]*,\s*(?:[^,()]*,\s*)?)(["'`])((?:\\.|(?!\1).)*)\1/g;
    const lines: string[] = [];
    for (const f of files) for (const m of fs.readFileSync(f, "utf8").matchAll(literal)) lines.push(m[2]!.replace(/\$\{[^}]*\}/g, "x"));
    expect(lines.length).toBeGreaterThan(40);
    expect(lines.filter((l) => isTechnicalMessage(l))).toEqual([]);
  });
});
