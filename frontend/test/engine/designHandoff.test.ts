// The approved design and the attached files reach the official lanes: placed in every repository of the product at
// the paths the official dev agent's spec reads (.madp/design/handoff.json, …), kept out of git (the lanes' preflight
// sees no dirty file, their commits never include them), named in the work description's "Design" section and taken
// out again after the lane. A product without an approved design is left exactly as it was.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Row } from "../../functions/_lib/gateway";
import { ProjectView } from "../../server/local/engine/context.ts";
import type { RowStore } from "../../server/local/rowStore.ts";
import type { JobRun } from "../../server/local/engine/run.ts";
import type { BuildTicket } from "../../server/local/engine/build/prompt.ts";
import { describeWork, runOfficialWork, type WorkAsk } from "../../server/local/engine/official/build.ts";
import type { OfficialApp } from "../../server/local/engine/official/app.ts";
import { handoffBlock, placeHandoff, removeHandoff, safeFileName } from "../../server/local/engine/official/handoff.ts";
import { automaticDesignDirection, designSource, rawDesignRequirements } from "../../src/domain/figmaMake";
import { designIntent, designIntentOf, factoryDesignSource } from "../../src/domain/factoryDesign";
import { briefQuestions } from "../../src/domain/projectBrief";
import { screenPreviewPath } from "../../src/domain/figmaScreens";

const lane = vi.hoisted(() => ({ calls: [] as { args: string[]; seen: Record<string, unknown> }[], code: 0, probe: (_args: string[]) => ({}) as Record<string, unknown> }));
vi.mock("../../server/local/engine/official/madp.ts", async (orig) => ({
  ...(await orig<typeof import("../../server/local/engine/official/madp.ts")>()),
  runLane: vi.fn(async (_run: unknown, args: string[]) => {
    lane.calls.push({ args, seen: lane.probe(args) });
    return { code: lane.code, steps: [], stdout: "", tail: [] };
  }),
}));

const P = "p1";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6VwAAAABJRU5ErkJggg==";
const GIT = ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null"];
const g = (cwd: string, ...args: string[]) => execFileSync("git", [...GIT, ...args], { cwd, encoding: "utf8" });

let root = "";
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mf-design-handoff-"));
});
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** A product repository on its dev branch with one commit. */
function repo(name: string, files: Record<string, string> = {}): string {
  const dir = path.join(root, `${name}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  g(dir, "init", "-q", "-b", "dev");
  for (const [rel, body] of Object.entries({ "README.md": "# App\n", "src/App.tsx": "export default function App() { return null; }\n", ...files })) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  g(dir, "add", "-A");
  g(dir, "commit", "-q", "-m", "init");
  return dir;
}

const status = (dir: string) => g(dir, "status", "--porcelain=v1", "--untracked-files=all");
const exclude = (dir: string) => {
  try {
    return fs.readFileSync(path.join(dir, ".git", "info", "exclude"), "utf8");
  } catch {
    return "";
  }
};

function storeOf(data: Record<string, Row[]>): RowStore {
  return {
    rows: (schema: string) => data[schema] ?? [],
    get: (schema: string, id: string) => (data[schema] ?? []).find((r) => r.ItemId === id),
  } as unknown as RowStore;
}

const requirements = (): Row[] => [{ ItemId: "r1", ProjectId: P, Key: "R1", Title: "Submit a request", Text: "Staff submit requests.", AcceptanceCriteria: ["A receipt is shown"] }];
const project = (): Row => ({ ItemId: P, Name: "Requests" });
const tickets: BuildTicket[] = [
  { id: "t1", number: 12, title: "The cart total is wrong", description: "", acceptance: ["The total adds up"], feature: "", done: false },
  { id: "t2", number: 13, title: "Bigger buttons", description: "", acceptance: [], feature: "", done: false },
];
const ask = (extra: Partial<WorkAsk> = {}): WorkAsk => ({ product: "Requests", label: "Milestone 1: Requests", goal: "Staff submit requests.", tickets, built: [], later: [], ...extra });

interface Fixture {
  run: JobRun;
  data: Record<string, Row[]>;
  brief: Row;
  artifact: Record<string, unknown>;
  readFile: ReturnType<typeof vi.fn>;
  logs: string[];
  jobFiles: Record<string, unknown>;
}

/** A project in one of the design modes: "figma-design" (native Figma screens), "figma-make", or "none" (no Figma). */
function fixture(mode: "figma-design" | "figma-make" | "none", o: { id?: string; tokens?: unknown; attachments?: Row[]; bytes?: Record<string, Uint8Array> } = {}): Fixture {
  const data: Record<string, Row[]> = { Project: [project()], Requirement: requirements(), RequirementExtra: [], Ticket: [], ChangeRequest: [], Attachment: o.attachments ?? [] };
  let brief: Row = { ItemId: "brief-1", ProjectId: P, Mode: "describe", Status: "confirmed" };
  let artifact: Record<string, unknown> = {};
  if (mode === "figma-make") {
    const normalized = rawDesignRequirements(data.Requirement!);
    const proto = { provider: "figma-make", projectUrl: "https://www.figma.com/make/request-app/", previewUrl: null, revision: "rev-1", source: designSource(automaticDesignDirection(normalized), normalized), jobId: "design-1", artifactFileId: "artifact-1" };
    brief = { ItemId: "brief-1", ProjectId: P, Mode: "figma", Status: "confirmed", ConfirmedAt: "2026-11-02T10:00:00Z", PrototypeJson: JSON.stringify(proto) };
    artifact = { ...proto, designMaster: "# Screens and tokens", uxPlan: "# Requirement-mapped journeys" };
  }
  if (mode === "figma-design") {
    const source = factoryDesignSource(designIntent(project(), null, data.Requirement!, []));
    const revision = "a".repeat(64);
    const screens = [{ name: "Requests", nodeId: "1:2", requirementKeys: ["R1"] }];
    const proto = { provider: "figma-design", projectId: P, projectUrl: "https://www.figma.com/design/file1/Requests", previewUrl: screenPreviewPath(P, revision), revision, source, jobId: "design-1", artifactFileId: "artifact-1", screens };
    brief = { ItemId: "brief-1", ProjectId: P, Mode: "figma", Status: "confirmed", ConfirmedAt: "2026-11-02T10:00:00Z", PrototypeJson: JSON.stringify(proto) };
    artifact = { ...proto, designMaster: "# Screens and tokens", uxPlan: "# Requirement-mapped journeys", screens: [{ ...screens[0], png: PNG }], tokens: o.tokens };
  }
  data.DesignBrief = [brief];
  const logs: string[] = [];
  const jobFiles: Record<string, unknown> = {};
  const readFile = vi.fn(async (id: string) => (id === "artifact-1" ? Buffer.from(JSON.stringify(artifact)) : (o.bytes?.[id] ?? null)));
  const run = {
    id: o.id ?? "job-1",
    projectId: P,
    p: new ProjectView(storeOf(data), P),
    readFile,
    folder: () => {
      throw new Error("no project folder in this test");
    },
    log: (l: string) => logs.push(l),
    writeJobFile: (name: string, body: unknown) => {
      jobFiles[name] = body;
      return name;
    },
  } as unknown as JobRun;
  return { run, data, brief, artifact, readFile, logs, jobFiles };
}

describe("the approved design handed to the official lanes", () => {
  it("places a native Figma handoff where the dev agent reads it, in every repo, ignored by git, never committed, and removes it after", async () => {
    const tokens = { version: 1, colors: { primary: "#123456" }, fontFamily: { body: "Inter" }, fontSize: { body: "1rem" }, spacing: { control: "8px" }, borderRadius: { control: "4px" } };
    const t = fixture("figma-design", { tokens });
    const api = repo("api");
    const web = repo("web");
    const h = await placeHandoff(t.run, [api, web], tickets);
    expect(t.readFile).toHaveBeenCalledWith("artifact-1");
    expect(h.design?.entry).toBe("handoff.json");
    for (const dir of [api, web]) {
      const design = path.join(dir, ".madp", "design");
      const handoff = JSON.parse(fs.readFileSync(path.join(design, "handoff.json"), "utf8"));
      expect(handoff).toMatchObject({ provider: "figma-design", revision: "a".repeat(64), artifactFileId: "artifact-1", approvedAt: "2026-11-02T10:00:00Z",
        designMaster: "design-master.md", uxPlan: "ux-plan.md", tokens: "design-tokens.json", screens: [{ name: "Requests", nodeId: "1:2", requirementKeys: ["R1"], file: "screen-1.png" }] });
      expect(fs.readFileSync(path.join(design, "design-master.md"), "utf8")).toBe("# Screens and tokens");
      expect(fs.readFileSync(path.join(design, "ux-plan.md"), "utf8")).toBe("# Requirement-mapped journeys");
      expect(JSON.parse(fs.readFileSync(path.join(design, "screens.json"), "utf8"))[0].file).toBe("screen-1.png");
      expect(fs.readFileSync(path.join(design, "screen-1.png")).toString("base64")).toBe(PNG);
      expect(JSON.parse(fs.readFileSync(path.join(design, "design-tokens.json"), "utf8"))).toEqual(tokens);
      // the lanes' preflight (git status --porcelain --untracked-files=all) sees a clean tree
      expect(exclude(dir)).toContain(".madp/\n");
      expect(status(dir)).toBe("");
      // what the agents changed is committed; the handoff is not, even by `git add -A`
      fs.writeFileSync(path.join(dir, "src", "Requests.tsx"), "export const Requests = () => null;\n");
      g(dir, "add", "-A");
      g(dir, "commit", "-q", "-m", "Implement the approved screens");
      const tracked = g(dir, "ls-files");
      expect(tracked).toContain("src/Requests.tsx");
      expect(tracked).not.toContain(".madp");
    }

    // the description names the handoff for the planner and the dev agents, in its own "Design" section
    const plain = describeWork(ask());
    const md = describeWork(ask({ handoff: h }));
    expect(md).toContain("## Design\n### Approved screen design (native Figma, revision");
    expect(md).toContain(".madp/design/handoff.json");
    expect(md).toContain(".madp/design/design-master.md");
    expect(md).toContain(".madp/design/screens.json");
    expect(md).toContain(".madp/design/screen-1.png: Requests (Figma frame 1:2; requirements R1)");
    expect(md).toContain(".madp/design/design-tokens.json");
    expect(md.indexOf("## Design")).toBeGreaterThan(md.indexOf("### #13 Bigger buttons"));
    expect(md.replace(`\n\n${handoffBlock(h)}`, "")).toBe(plain);

    removeHandoff(h);
    for (const dir of [api, web]) {
      expect(fs.existsSync(path.join(dir, ".madp"))).toBe(false);
      expect(status(dir)).toBe("");
    }
  });

  it("places a Figma Make handoff as figma-make.md", async () => {
    const t = fixture("figma-make");
    const app = repo("app");
    const h = await placeHandoff(t.run, [app], tickets);
    const body = fs.readFileSync(path.join(app, ".madp", "design", "figma-make.md"), "utf8");
    expect(body).toContain("2026-11-02T10:00:00Z");
    expect(body).toContain("# Screens and tokens");
    expect(body).toContain("# Requirement-mapped journeys");
    expect(fs.existsSync(path.join(app, ".madp", "design", "handoff.json"))).toBe(false);
    expect(status(app)).toBe("");
    expect(handoffBlock(h)).toContain("at .madp/design/figma-make.md");
    removeHandoff(h);
    expect(fs.existsSync(path.join(app, ".madp"))).toBe(false);
  });

  it("leaves a product without an approved Figma design exactly as it was", async () => {
    for (const t of [fixture("none"), (() => {
      const f = fixture("none");
      f.data.DesignBrief = [];
      return f;
    })()]) {
      const app = repo("plain");
      const before = exclude(app);
      const h = await placeHandoff(t.run, [app], tickets);
      expect(h).toMatchObject({ repos: [], design: null, attachments: [] });
      expect(t.readFile).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(app, ".madp"))).toBe(false);
      expect(exclude(app)).toBe(before);
      expect(describeWork(ask({ handoff: h }))).toBe(describeWork(ask()));
      removeHandoff(h);
      expect(status(app)).toBe("");
    }
  });

  it.each(["draft", "stale", "incomplete", "invalid"])("stops a build whose Figma design is %s before reading Storage or touching a repo", async (reason) => {
    const t = fixture("figma-design");
    const proto = JSON.parse(String(t.brief.PrototypeJson));
    if (reason === "draft") t.brief.Status = "draft";
    if (reason === "stale") t.data.Requirement![0]!.Title = "Changed requirement";
    if (reason === "incomplete") t.brief.PrototypeJson = JSON.stringify({ ...proto, reviewComplete: false });
    if (reason === "invalid") t.brief.PrototypeJson = "{}";
    const app = repo("blocked");
    await expect(placeHandoff(t.run, [app], tickets)).rejects.toMatchObject({ code: "design.figmaApprovalRequired" });
    expect(t.readFile).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(app, ".madp"))).toBe(false);
  });

  it("hands over a design approved before the intent read the Project brief note and the answers, until what it was made from changes", async () => {
    // the fixture's design source is the intent of the project's own fields; since 08.11 the intent also reads these
    const t = fixture("figma-design");
    t.data.DocNote = [{ ItemId: "n1", ProjectId: P, Title: "Project brief", IsProjectBrief: true, BodyMd: "## About the project\n\nStaff send requests to the office and follow them up.\n" }];
    t.data.Clarification = [{ ItemId: "c1", ProjectId: P, Number: 1, Question: briefQuestions("Requests").goal, Answer: "Every staff request is answered within one working day", Status: "answered" }];
    expect(factoryDesignSource(designIntentOf(t.run.p))).not.toBe(JSON.parse(String(t.brief.PrototypeJson)).source);
    const app = repo("approved-before");
    const h = await placeHandoff(t.run, [app], tickets);
    expect(h.design?.entry).toBe("handoff.json");
    removeHandoff(h);
    t.data.Requirement![0]!.Title = "Changed requirement";
    await expect(placeHandoff(t.run, [repo("changed-since")], tickets)).rejects.toMatchObject({ code: "design.figmaApprovalRequired" });
  });

  it.each(["revision", "missing", "png"])("fails closed on a %s artifact and leaves nothing behind", async (reason) => {
    const t = fixture("figma-design");
    if (reason === "revision") t.artifact.revision = "b".repeat(64);
    if (reason === "missing") t.readFile.mockResolvedValue(null);
    if (reason === "png") t.artifact.screens = [{ nodeId: "1:2", png: "bm90IGEgcG5n" }];
    const app = repo("mismatch");
    await expect(placeHandoff(t.run, [app], tickets)).rejects.toMatchObject({ code: "design.figmaHandoffRequired" });
    expect(t.jobFiles["design-handoff-error.json"]).toMatchObject({ stage: expect.any(String) });
    expect(fs.existsSync(path.join(app, ".madp"))).toBe(false);
  });

  it("refuses to place the design in a repo whose .gitignore re-includes .madp/ (it could be committed)", async () => {
    const t = fixture("figma-design");
    const app = repo("unsafe", { ".gitignore": "!.madp/\n" });
    await expect(placeHandoff(t.run, [app], tickets)).rejects.toMatchObject({ code: "design.figmaHandoffRequired" });
    expect(t.jobFiles["design-handoff-error.json"]).toMatchObject({ stage: "keep-out-of-commits" });
    expect(fs.existsSync(path.join(app, ".madp"))).toBe(false);
    expect(status(app)).toBe("");
  });

  it("never overwrites or removes a repo's own tracked files where the handoff goes, and keeps its other .madp files", async () => {
    const t = fixture("figma-design");
    const own = repo("own", { ".madp/design/handoff.json": "{\"theirs\":true}\n" });
    const other = repo("other", { ".madp/notes.md": "the repo's own\n" });
    await expect(placeHandoff(t.run, [own], tickets)).rejects.toMatchObject({ code: "design.figmaHandoffRequired" });
    expect(fs.readFileSync(path.join(own, ".madp", "design", "handoff.json"), "utf8")).toBe("{\"theirs\":true}\n");
    expect(status(own)).toBe("");
    const h = await placeHandoff(t.run, [other], tickets);
    expect(fs.existsSync(path.join(other, ".madp", "design", "handoff.json"))).toBe(true);
    expect(status(other)).toBe("");
    removeHandoff(h);
    expect(fs.readdirSync(path.join(other, ".madp"))).toEqual(["notes.md"]);
    expect(status(other)).toBe("");
  });
});

const att = (id: string, ownerType: string, ownerId: string, name: string, mime: string, extra: Row = {}): Row => ({
  ItemId: id, ProjectId: P, OwnerType: ownerType, OwnerId: ownerId, FileId: `f-${id}`, FileName: name, Mime: mime, Status: "ready", CreatedDate: `2026-10-31T10:00:0${id.length % 10}Z`, ...extra,
});

describe("the files people attached, handed to the official lanes", () => {
  it("names safe file names", () => {
    expect(safeFileName("Checkout design (v2).PNG")).toBe("Checkout-design-v2.png");
    expect(safeFileName("../../etc/passwd")).toBe("etcpasswd");
    expect(safeFileName(".env")).toBe("file.env");
    expect(safeFileName("")).toBe("file");
  });

  it("copies the ticket's and the change request's files into .madp/feedback, keeps them out of git and names them", async () => {
    const png = new Uint8Array(Buffer.from(PNG, "base64"));
    const t = fixture("none", {
      attachments: [
        att("a1", "ticket", "t1", "cart design.png", "image/png"),
        att("a2", "change-request", "cr1", "notes.md", "text/markdown", { Meta: JSON.stringify({ questionId: "q2" }) }),
        att("a3", "ticket", "t1", "draft.png", "image/png", { Status: "pending" }),
        att("a4", "ticket", "t9", "other.png", "image/png"),
        att("a5", "ticket", "t2", "fix.test.ts", "text/plain"),
      ],
      bytes: { "f-a1": png, "f-a2": new TextEncoder().encode("# Notes\nThe buttons must be 48 px high.\n"), "f-a5": new TextEncoder().encode("it('works', () => {});\n") },
    });
    t.data.Ticket = [
      { ItemId: "t1", ProjectId: P, Number: 12, Title: "The cart total is wrong", Source: "feedback" },
      { ItemId: "t2", ProjectId: P, Number: 13, Title: "Bigger buttons", ChangeRequestId: "cr1" },
    ];
    t.data.ChangeRequest = [{
      ItemId: "cr1", ProjectId: P, Number: 3, Lane: "change", Title: "Bigger buttons",
      Analysis: JSON.stringify({ kind: "change", route: "fast", summary: "Bigger buttons on the checkout.", questions: [{ id: "q2", text: "Which screens?", options: [], answer: "Checkout", answeredBy: null, answeredAt: null }] }),
    }];
    const app = repo("feedback");
    const h = await placeHandoff(t.run, [app], tickets);
    expect(h.design).toBeNull();
    expect(h.attachments.map((f) => f.path)).toEqual([".madp/feedback/job-1/t1/cart-design.png", ".madp/feedback/job-1/t2/fix.test.ts.txt", ".madp/feedback/job-1/cr-cr1/notes.md"]);
    expect(new Uint8Array(fs.readFileSync(path.join(app, ".madp", "feedback", "job-1", "t1", "cart-design.png")))).toEqual(png);
    expect(fs.readFileSync(path.join(app, ".madp", "feedback", "job-1", "cr-cr1", "notes.md"), "utf8")).toContain("48 px");
    expect(h.attachments[2]).toMatchObject({ question: "Which screens?", owner: "the change request CR-003 (Bigger buttons)" });
    expect(status(app)).toBe("");

    const md = describeWork(ask({ handoff: h }));
    expect(md).toContain("## Design\n### Files people attached");
    expect(md).toContain("- For their feedback on ticket #12 (The cart total is wrong):");
    expect(md).toContain(".madp/feedback/job-1/t1/cart-design.png: a picture. Open it with the Read tool");
    expect(md).toContain(".madp/feedback/job-1/cr-cr1/notes.md (attached to their answer to the question: Which screens?): a document");
    expect(md).toContain("The buttons must be 48 px high.");
    expect(md).not.toContain("### Approved");

    removeHandoff(h);
    expect(fs.existsSync(path.join(app, ".madp"))).toBe(false);
  });

  it("keeps a second run's copies while the first one is cleaned up", async () => {
    const a = fixture("figma-design", { id: "job-a", attachments: [att("a1", "ticket", "t1", "a.png", "image/png")], bytes: { "f-a1": new Uint8Array(Buffer.from(PNG, "base64")) } });
    const b = fixture("figma-design", { id: "job-b", attachments: [att("a1", "ticket", "t1", "b.png", "image/png")], bytes: { "f-a1": new Uint8Array(Buffer.from(PNG, "base64")) } });
    const app = repo("shared");
    const ha = await placeHandoff(a.run, [app], tickets);
    const hb = await placeHandoff(b.run, [app], tickets);
    removeHandoff(ha);
    expect(fs.existsSync(path.join(app, ".madp", "feedback", "job-a"))).toBe(false);
    expect(fs.existsSync(path.join(app, ".madp", "feedback", "job-b", "t1", "b.png"))).toBe(true);
    expect(fs.existsSync(path.join(app, ".madp", "design", "handoff.json"))).toBe(true);
    removeHandoff(hb);
    expect(fs.existsSync(path.join(app, ".madp"))).toBe(false);
  });
});

describe("a lane run with the handoff", () => {
  function product(repos: Record<string, string>): OfficialApp {
    const dir = fs.mkdtempSync(path.join(root, "madp-"));
    const registry = path.join(dir, "requests-abc123.yml");
    fs.writeFileSync(registry, `project: requests-abc123\nenvironments:\n  dev:\n    cli_config_dir: ${path.join(dir, "store")}\nrepos:\n${Object.entries(repos).map(([k, p]) => `  ${k}:\n    path: ${p}\n    repo: org/${k}\n    branch: dev\n`).join("")}`);
    return { name: "requests-abc123", dir, registry, org: "org", repos, tenant: "", url: "https://dev.example.invalid" };
  }

  it("has the handoff in every repo and the description while the lane runs, and none after it, also when the lane fails", async () => {
    for (const code of [0, 5]) {
      const t = fixture("figma-design", { id: `job-lane-${code}` });
      const repos = { api: repo("api"), web: repo("web") };
      const app = product(repos);
      lane.calls.length = 0;
      lane.code = code;
      lane.probe = (args) => ({
        handoff: Object.values(repos).every((d) => fs.existsSync(path.join(d, ".madp", "design", "handoff.json"))),
        clean: Object.values(repos).every((d) => status(d) === ""),
        description: fs.readFileSync(args[args.indexOf("--description-file") + 1]!, "utf8"),
      });
      const run = runOfficialWork(t.run, app, ask(), { kind: "milestone", onStep: async () => {} });
      if (code === 0) await expect(run).resolves.toMatchObject({ lane: "feature" });
      else await expect(run).rejects.toBeTruthy();
      expect(lane.calls).toHaveLength(1);
      expect(lane.calls[0]!.seen).toMatchObject({ handoff: true, clean: true });
      expect(lane.calls[0]!.seen.description).toContain(".madp/design/handoff.json");
      for (const d of Object.values(repos)) expect(fs.existsSync(path.join(d, ".madp"))).toBe(false);
    }
  });

  it("does not start the lane when the Figma design is not approved", async () => {
    const t = fixture("figma-design", { id: "job-draft" });
    t.brief.Status = "draft";
    const app = product({ app: repo("app") });
    lane.calls.length = 0;
    await expect(runOfficialWork(t.run, app, ask(), { kind: "milestone", onStep: async () => {} })).rejects.toMatchObject({ code: "design.figmaApprovalRequired" });
    expect(lane.calls).toHaveLength(0);
  });
});
