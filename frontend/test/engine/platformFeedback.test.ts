import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isProjectless, type EngineJobKind } from "../../src/domain/engineJob";
import { JobFailure, type JobRun } from "../../server/local/engine/run.ts";
import { writerOf } from "../../server/local/engine/kinds/index.ts";
import { makePlatformFeedbackWriter } from "../../server/local/engine/kinds/platformFeedback.ts";
import { feedbackConfig, feedbackHostReady, feedbackToken, ghBinary, type Exec } from "../../server/local/engine/kinds/platformFeedback/config.ts";
import { markerOf, readFeedbackInput, ticketBody, ticketTitle } from "../../server/local/engine/kinds/platformFeedback/ticket.ts";
import type { FetchLike } from "../../server/local/engine/kinds/platformFeedback/github.ts";
import { acceptsWorkerJob, workerJobScope } from "../../server/blocks/engineWorker/jobScope";
import { makeWorld } from "./harness.ts";

const JOB = "0b5f3c1e-1111-4222-8333-444455556666";
const REPO = "SELISE-Products/madp-beta-feedback";
const BOARD = "https://github.com/orgs/SELISE-Products/projects/1";

const INPUT = {
  title: "Board does not scroll",
  description: "When I open the board the columns do not scroll. cc @someone",
  page: { path: "/projects/p1/board", title: "Board" },
  client: { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0", viewport: { width: 1440, height: 900 }, language: "en-GB" },
  files: [
    { fileId: "f-shot", fileName: "screen shot.png", mime: "image/png", sizeBytes: 4 },
    { fileId: "f-log", fileName: "console.txt", mime: "text/plain", sizeBytes: 5 },
  ],
  reporter: { userId: "u-1", name: "Jane Tester", email: "jane@example.com", workspaceName: "Acme" },
  submittedAt: "2026-11-16T21:30:00.000Z",
};

interface Call { method: string; url: string; body: Record<string, unknown> | null }

/** A GitHub stand-in: answers the contents API and the board's GraphQL; records every call. */
function fakeGithub(o: {
  boardItems?: { id: string; fullDatabaseId?: string; content?: { body: string } | null; fieldValueByName?: { optionId: string } | null }[];
  existingFiles?: Record<string, string>;
  putStatus?: number;
  graphqlStatus?: number;
  graphqlHeaders?: Record<string, string>;
} = {}) {
  const calls: Call[] = [];
  const res = (status: number, body: unknown, headers: Record<string, string> = {}) => ({
    status, ok: status >= 200 && status < 300,
    headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
    text: async () => (body === undefined ? "" : JSON.stringify(body)),
  });
  const fetch: FetchLike = async (url, init) => {
    const body = init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ method: init.method, url, body });
    expect(init.headers.Authorization).toBe("Bearer test-token-0123456789abcdef");
    if (url === "https://api.github.com/graphql") {
      if (o.graphqlStatus) return res(o.graphqlStatus, { message: "nope" }, o.graphqlHeaders);
      const q = String(body?.query ?? "");
      if (q.includes("items(last: 50)")) return res(200, { data: { node: { items: { nodes: o.boardItems ?? [] } } } });
      if (q.includes("addProjectV2DraftIssue")) return res(200, { data: { addProjectV2DraftIssue: { projectItem: { id: "PVTI_new", fullDatabaseId: "987654321" } } } });
      if (q.includes("updateProjectV2ItemFieldValue")) return res(200, { data: { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_new" } } } });
      return res(200, { errors: [{ type: "UNKNOWN", message: "unexpected query" }] });
    }
    const m = url.match(/^https:\/\/api\.github\.com\/repos\/SELISE-Products\/madp-beta-feedback\/contents\/([^?]+)/);
    if (m) {
      const p = decodeURIComponent(m[1]!);
      if (init.method === "GET") return o.existingFiles?.[p] ? res(200, { sha: o.existingFiles[p] }) : res(404, { message: "Not Found" });
      if (init.method === "PUT") return res(o.putStatus ?? 201, { content: { path: p } });
    }
    return res(404, { message: "Not Found" });
  };
  const graphql = () => calls.filter((c) => c.url.endsWith("/graphql")).map((c) => ({ query: String(c.body?.query), variables: c.body?.variables as Record<string, unknown> }));
  return { fetch, calls, graphql };
}

/** The part of a JobRun the writer uses. */
function fakeRun(o: { files?: Record<string, Uint8Array | null>; input?: Record<string, unknown> } = {}) {
  const steps: { p: number; m?: string }[] = [];
  const logs: string[] = [];
  const run = {
    id: JOB,
    kind: "platform.feedback",
    input: o.input ?? INPUT,
    signal: new AbortController().signal,
    now: () => new Date("2026-11-17T08:00:00.000Z"),
    check() {},
    async step(p: number, m?: string) { steps.push({ p, m }); },
    async readFile(id: string) { return o.files?.[id] ?? null; },
    log(l: string) { logs.push(l); },
  };
  return { run: run as unknown as JobRun, steps, logs };
}

const FILES = { "f-shot": new Uint8Array([137, 80, 78, 71]), "f-log": new TextEncoder().encode("oops!") };
const writerWith = (gh: ReturnType<typeof fakeGithub>, env: Record<string, string> = {}) =>
  makePlatformFeedbackWriter({ env, fetch: gh.fetch, token: async () => "test-token-0123456789abcdef" });

describe("platform.feedback ticket text", () => {
  it("prefixes and trims the title to 250 characters", () => {
    expect(ticketTitle(readFeedbackInput(INPUT))).toBe("[Beta feedback] Board does not scroll");
    const long = ticketTitle(readFeedbackInput({ ...INPUT, title: "x".repeat(400) }));
    expect(long.length).toBe(250);
    expect(long.startsWith("[Beta feedback] xxx")).toBe(true);
  });

  it("writes the Markdown sections, the attachments and the marker line", () => {
    const body = ticketBody(readFeedbackInput(INPUT), [
      { name: "screen shot.png", image: true, url: "https://github.com/r/blob/main/a.png?raw=true" },
      { name: "console.txt", image: false, url: "https://github.com/r/blob/main/b.txt?raw=true" },
      { name: "big.zip", failed: "the upload failed" },
    ], JOB);
    const order = ["## Description", "## Reported by", "## Page", "## Browser", "## Attachments"].map((h) => body.indexOf(h));
    expect(order.every((i, k) => i >= 0 && (k === 0 || i > order[k - 1]!))).toBe(true);
    expect(body).toContain("When I open the board the columns do not scroll. cc @​someone");
    expect(body).toContain("- Name: Jane Tester");
    expect(body).toContain("- E-mail: jane@example.com");
    expect(body).toContain("- Workspace: Acme");
    expect(body).toContain("- Title: Board");
    expect(body).toContain("- Path: `/projects/p1/board`");
    expect(body).toContain("- User agent: `Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0`");
    expect(body).toContain("- Viewport: 1440 × 900");
    expect(body).toContain("- Language: en-GB");
    expect(body).toContain("![screen shot.png](https://github.com/r/blob/main/a.png?raw=true)");
    expect(body).toContain("- [console.txt](https://github.com/r/blob/main/b.txt?raw=true)");
    expect(body).toContain("- big.zip: could not be attached (the upload failed)");
    expect(body.trimEnd().endsWith(`Sent from the MADP Factory feedback assistant · job ${JOB}`)).toBe(true);
    expect(markerOf(JOB)).toBe(`Sent from the MADP Factory feedback assistant · job ${JOB}`);
  });

  it("reads the defaults and the environment's board settings", () => {
    expect(feedbackConfig({})).toEqual({
      projectId: "PVT_kwDOFS0xws4BrI9x", statusFieldId: "PVTSSF_lADOFS0xws4BrI9xzhpc-9Y", statusOptionId: "f75ad846",
      assetsRepo: REPO, assetsBranch: "main", boardUrl: BOARD,
    });
    expect(feedbackConfig({ MF_FEEDBACK_GITHUB_PROJECT_ID: "PVT_x", MF_FEEDBACK_BOARD_URL: "https://b/" })).toMatchObject({ projectId: "PVT_x", boardUrl: "https://b" });
  });
});

describe("platform.feedback writer", () => {
  it("uploads the files, embeds the image, creates the draft issue and puts it in Backlog", async () => {
    const gh = fakeGithub();
    const { run, steps } = fakeRun({ files: FILES });
    const result = await writerWith(gh)(run);

    const puts = gh.calls.filter((c) => c.method === "PUT");
    expect(puts.map((c) => c.url)).toEqual([
      `https://api.github.com/repos/${REPO}/contents/feedback/2026-11-16/${JOB}/1-screen-shot.png`,
      `https://api.github.com/repos/${REPO}/contents/feedback/2026-11-16/${JOB}/2-console.txt`,
    ]);
    expect(puts[0]!.body).toEqual({ message: `Feedback ${JOB} attachment`, content: Buffer.from(FILES["f-shot"]).toString("base64"), branch: "main" });

    const q = gh.graphql();
    expect(q.map((c) => c.query.match(/addProjectV2DraftIssue|updateProjectV2ItemFieldValue|items\(last: 50\)/)?.[0])).toEqual([
      "items(last: 50)", "addProjectV2DraftIssue", "updateProjectV2ItemFieldValue",
    ]);
    const draft = (q[1]!.variables.input as Record<string, string>);
    expect(draft.projectId).toBe("PVT_kwDOFS0xws4BrI9x");
    expect(draft.title).toBe("[Beta feedback] Board does not scroll");
    expect(draft.body).toContain(`![screen shot.png](https://github.com/${REPO}/blob/main/feedback/2026-11-16/${JOB}/1-screen-shot.png?raw=true)`);
    expect(draft.body).toContain(`- [console.txt](https://github.com/${REPO}/blob/main/feedback/2026-11-16/${JOB}/2-console.txt?raw=true)`);
    expect(q[2]!.variables.input).toEqual({
      projectId: "PVT_kwDOFS0xws4BrI9x", itemId: "PVTI_new", fieldId: "PVTSSF_lADOFS0xws4BrI9xzhpc-9Y", value: { singleSelectOptionId: "f75ad846" },
    });
    expect(result).toEqual({ outputs: [], message: `Ticket created in Backlog: ${BOARD}?pane=issue&itemId=987654321` });
    expect(steps.length).toBeGreaterThan(3);
    expect(steps.map((s) => s.p)).toEqual([...steps.map((s) => s.p)].sort((a, b) => a - b));
  });

  it("replaces an attachment already uploaded by an earlier attempt using its sha", async () => {
    const gh = fakeGithub({ existingFiles: { [`feedback/2026-11-16/${JOB}/1-screen-shot.png`]: "abc123" } });
    const { run } = fakeRun({ files: FILES });
    await writerWith(gh)(run);
    const puts = gh.calls.filter((c) => c.method === "PUT");
    expect(puts[0]!.body?.sha).toBe("abc123");
    expect(puts[1]!.body?.sha).toBeUndefined();
  });

  it("a retry finds its own ticket by the marker and creates nothing new", async () => {
    const gh = fakeGithub({ boardItems: [
      { id: "PVTI_other", fullDatabaseId: "1", content: { body: "Someone wrote: job " + JOB + " in the text\nmore" } },
      { id: "PVTI_mine", fullDatabaseId: "555", content: { body: `## Description\n\nx\n\n---\n${markerOf(JOB)}\n` }, fieldValueByName: null },
    ] });
    const { run } = fakeRun({ files: FILES });
    const result = await writerWith(gh)(run);
    expect(gh.calls.some((c) => c.url.includes("/contents/"))).toBe(false);
    const q = gh.graphql();
    expect(q.some((c) => c.query.includes("addProjectV2DraftIssue"))).toBe(false);
    // its Status was never set (the earlier attempt stopped before): Backlog now
    expect((q.at(-1)!.variables.input as Record<string, string>).itemId).toBe("PVTI_mine");
    expect(result.message).toBe(`Ticket created in Backlog: ${BOARD}?pane=issue&itemId=555`);
  });

  it("a reused ticket that already has a Status keeps its column", async () => {
    const gh = fakeGithub({ boardItems: [{ id: "PVTI_mine", content: { body: markerOf(JOB) }, fieldValueByName: { optionId: "other" } }] });
    const { run } = fakeRun({ files: FILES });
    const result = await writerWith(gh)(run);
    expect(gh.graphql().map((c) => c.query.includes("updateProjectV2ItemFieldValue"))).toEqual([false]);
    expect(result.message).toBe(`Ticket created in Backlog: ${BOARD}`);
  });

  it("a failed upload or a missing file still sends the ticket and says what could not be attached", async () => {
    const gh = fakeGithub({ putStatus: 500 });
    const { run, logs } = fakeRun({ files: { "f-shot": FILES["f-shot"], "f-log": null } });
    const result = await writerWith(gh)(run);
    const body = (gh.graphql().find((c) => c.query.includes("addProjectV2DraftIssue"))!.variables.input as Record<string, string>).body;
    expect(body).toContain("- screen shot.png: could not be attached (the upload failed)");
    expect(body).toContain("- console.txt: could not be attached (the file was not found)");
    expect(result.message.startsWith("Ticket created in Backlog: ")).toBe(true);
    expect(logs.join("\n")).not.toContain("test-token");
  });

  it("a GitHub sign-in refusal fails the job with the auth code and a calm message", async () => {
    const gh = fakeGithub({ graphqlStatus: 401 });
    const { run, logs } = fakeRun({ files: FILES });
    const err = await writerWith(gh)(run).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(JobFailure);
    expect((err as JobFailure).code).toBe("engine.feedbackGithubAuth");
    expect((err as JobFailure).message).not.toMatch(/token|401|github\.com/i);
    expect(logs.join("\n")).not.toContain("test-token");
  });

  it("a rate limit and other refusals get their own codes; no sign-in at all says the host is not set up", async () => {
    const limited = await writerWith(fakeGithub({ graphqlStatus: 403, graphqlHeaders: { "x-ratelimit-remaining": "0" } }))(fakeRun().run).catch((e: JobFailure) => e);
    expect(limited.code).toBe("engine.feedbackGithubRateLimited");
    const broken = await writerWith(fakeGithub({ graphqlStatus: 422 }))(fakeRun().run).catch((e: JobFailure) => e);
    expect(broken.code).toBe("engine.feedbackGithubFailed");
    const none = await makePlatformFeedbackWriter({ env: {}, fetch: fakeGithub().fetch, token: async () => null })(fakeRun().run).catch((e: JobFailure) => e);
    expect(none.code).toBe("engine.feedbackNotConfigured");
  });

  it("is the registered writer of platform.feedback", async () => {
    expect(typeof (await writerOf("platform.feedback" as EngineJobKind))).toBe("function");
  });
});

describe("platform.feedback sign-in", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "pfb-gh-"));
  const fakeGh = () => {
    const dir = tmp();
    const bin = path.join(dir, "gh");
    fs.writeFileSync(bin, "#!/bin/sh\n", { mode: 0o755 });
    return bin;
  };

  it("takes MF_FEEDBACK_GITHUB_TOKEN first, without running gh", async () => {
    let ran = false;
    const exec: Exec = async () => { ran = true; return "x"; };
    expect(await feedbackToken({ MF_FEEDBACK_GITHUB_TOKEN: "ghp_direct_token_0123456789" }, exec)).toBe("ghp_direct_token_0123456789");
    expect(ran).toBe(false);
  });

  it("runs `gh auth token` with the feedback login's own config folder, never the default login or GH_TOKEN", async () => {
    const bin = fakeGh();
    const seen: { file: string; args: string[]; env: Record<string, string | undefined> }[] = [];
    const exec: Exec = async (file, args, o) => { seen.push({ file, args, env: o.env }); return "gho_feedbackTokenValue0123456789\n"; };
    const token = await feedbackToken({ MF_GH_BIN: bin, MF_FEEDBACK_GH_CONFIG_DIR: "/cfg/gh-feedback", GH_TOKEN: "other", PATH: "" }, exec);
    expect(token).toBe("gho_feedbackTokenValue0123456789");
    expect(seen[0]!.file).toBe(bin);
    expect(seen[0]!.args).toEqual(["auth", "token"]);
    expect(seen[0]!.env.GH_CONFIG_DIR).toBe("/cfg/gh-feedback");
    expect(seen[0]!.env.GH_TOKEN).toBeUndefined();
  });

  it("uses the host's gh-feedback folder when it exists, and never gh's default login", async () => {
    const bin = fakeGh();
    const envs: (string | undefined)[] = [];
    const exec: Exec = async (_f, _a, o) => { envs.push(o.env.GH_CONFIG_DIR); return "gho_feedbackTokenValue0123456789"; };
    expect(await feedbackToken({ MF_GH_BIN: bin }, exec, (p) => p === "/srv/madp-factory/home/.config/gh-feedback")).toBe("gho_feedbackTokenValue0123456789");
    expect(await feedbackToken({ MF_GH_BIN: bin }, exec, () => false)).toBeNull();
    expect(envs).toEqual(["/srv/madp-factory/home/.config/gh-feedback"]);
  });

  it("answers null when gh fails or prints no token", async () => {
    const bin = fakeGh();
    expect(await feedbackToken({ MF_GH_BIN: bin }, async () => { throw new Error("not logged in"); }, () => false)).toBeNull();
    expect(await feedbackToken({ MF_GH_BIN: bin }, async () => "", () => false)).toBeNull();
    expect(await feedbackToken({ MF_GH_BIN: "/nowhere/gh", PATH: "", HOME: "/nowhere" }, async () => "gho_x0123456789012345678901")).toBeNull();
  });

  it("finds gh by MF_GH_BIN, then PATH, then ~/.local/bin", () => {
    const bin = fakeGh();
    expect(ghBinary({ MF_GH_BIN: bin })).toBe(bin);
    expect(ghBinary({ PATH: path.dirname(bin), HOME: "/nowhere" })).toBe(bin);
    const home = tmp();
    fs.mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
    fs.writeFileSync(path.join(home, ".local", "bin", "gh"), "", { mode: 0o755 });
    expect(ghBinary({ PATH: "", HOME: home })).toBe(path.join(home, ".local", "bin", "gh"));
  });

  it("a host is ready with a token, or with gh and a login in the feedback config folder", () => {
    const bin = fakeGh();
    const cfg = tmp();
    expect(feedbackHostReady({ MF_FEEDBACK_GITHUB_TOKEN: "t" })).toBe(true);
    expect(feedbackHostReady({ MF_GH_BIN: bin, MF_FEEDBACK_GH_CONFIG_DIR: cfg })).toBe(false);
    fs.writeFileSync(path.join(cfg, "hosts.yml"), "github.com:\n  user: feedback\n");
    expect(feedbackHostReady({ MF_GH_BIN: bin, MF_FEEDBACK_GH_CONFIG_DIR: cfg })).toBe(true);
    expect(feedbackHostReady({ MF_GH_BIN: "/nowhere/gh", PATH: "", HOME: "/nowhere", MF_FEEDBACK_GH_CONFIG_DIR: cfg })).toBe(false);
  });
});

describe("platform.feedback claiming", () => {
  const job = { Kind: "platform.feedback" as never, ProjectId: "system" };

  it("the unscoped engine host claims it only with the board's sign-in", () => {
    const scope = workerJobScope({});
    expect(acceptsWorkerJob(scope, job, true, true)).toBe(true);
    expect(acceptsWorkerJob(scope, job, true, false)).toBe(false);
  });

  it("project- or kind-scoped workers and an excluded kind never claim it", () => {
    expect(acceptsWorkerJob(workerJobScope({ MF_ENGINE_PROJECT_IDS: "p1" }), job)).toBe(false);
    expect(acceptsWorkerJob(workerJobScope({ MF_ENGINE_JOB_KINDS: "design.generate" }), job)).toBe(false);
    expect(acceptsWorkerJob(workerJobScope({ MF_ENGINE_EXCLUDED_JOB_KINDS: "platform.feedback" }), job)).toBe(false);
  });

  it("the dev planners exclude it like the skills sync", () => {
    const dir = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "server", "blocks", "engineWorker");
    for (const f of ["local.mjs", "screens.mjs"]) {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      const line = text.split("\n").find((l) => l.includes("MF_ENGINE_EXCLUDED_JOB_KINDS") && l.includes("engine.skills-sync"));
      expect(line, f).toMatch(/["']platform\.feedback["']/);
    }
  });

  it("is projectless and runs through the engine although no project row exists behind it", async () => {
    expect(isProjectless("platform.feedback")).toBe(true);
    expect(isProjectless("engine.skills-sync")).toBe(true);
    expect(isProjectless("design.generate")).toBe(false);
    const gh = fakeGithub();
    const world = await makeWorld({
      writers: async (kind) => (kind === "platform.feedback" ? writerWith(gh) : writerOf(kind)),
    });
    try {
      fs.writeFileSync(path.join(world.dir, "files", "f-shot"), FILES["f-shot"]);
      const res = await world.gw.insert("EngineJob", {
        ProjectId: "system", WorkspaceId: "system", Kind: "platform.feedback", Status: "queued",
        Progress: 0, Attempts: 0, Message: "", ActiveKey: "platform.feedback:test", InputJson: JSON.stringify({ ...INPUT, files: [INPUT.files[0]] }),
        RequestKey: "platform.feedback:test",
      });
      if (!res.itemId) throw new Error("job not queued");
      await world.settle();
      const row = world.get("EngineJob", String(res.itemId));
      expect(row.Status).toBe("succeeded");
      expect(String(row.Message)).toContain("Ticket created in Backlog");
      expect(gh.calls.filter((c) => c.method === "PUT")).toHaveLength(1);
    } finally {
      await world.close();
    }
  });
});
