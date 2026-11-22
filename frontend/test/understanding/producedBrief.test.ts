// The "Project brief" under Produced (artifacts/brief/brief.md, written by the engine before every job through
// syncBrief): it reads the description, the goal and the users where they are recorded since 08.11 (the Project brief
// note, the answers to the business analyst's brief questions, the drafted objective), lists a question as open only
// while nothing records its answer, has no "Note" box over its version line, and is rebuilt once the answers arrive
// (before the next job, or within the worker's periodic refresh when no job follows).
//   npx vitest run --config test/understanding/vitest.config.ts test/understanding/producedBrief.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { syncBrief } from "../../server/engine-context/briefSync";
import { refreshProjectContext } from "../../server/engine-context/hooks";
import { ProjectView } from "../../server/local/engine/context";
import type { RowStore } from "../../server/local/rowStore";
import { knowledgeBaseDir } from "../../server/api/knowledgeBase";
import { BRIEF_SCHEMA } from "../../server/api/brief/builder";
import { parseMarkdown } from "../../src/data/wiki/markdown";

const WS = "3ab0d65c-8d49-4e44-9229-b5c93012b49f";
const PID = "bc59c5f8-0b69-49ed-a0fc-5b5096a443b1";
const ABOUT = "A small app for our office: an admin sets a weekly lunch menu, team members pick their lunch for each day.";
const OBJECTIVE = "A small app that lets about 25 team members pick their daily lunch from a weekly menu.";
const USERS = "About 25 team members and one admin (the office manager)";

type Row = Record<string, unknown>;
const project: Row = { ItemId: PID, WorkspaceId: WS, Name: "Team lunch orders", Goal: "", TargetUsers: "", Brief: "", RepoMode: "new" };
const notes: Row[] = [
  { ItemId: "n1", ProjectId: PID, Title: "Project brief", IsProjectBrief: true, BodyMd: `## About the project\n\n**Team lunch orders**\n\n${ABOUT}\n\n## Approval\n\nThe owner approves the result.` },
  // the person's own note: it feeds the business analyst's questions, not the brief
  { ItemId: "n2", ProjectId: PID, Title: "Lunch rules", BodyMd: "- Orders close at 10:00 each working day." },
];
/** The business analyst's clarifying questions, answered after the hand-over (none of them is a brief question). */
const domainAnswers: Row[] = [
  { ItemId: "c1", ProjectId: PID, Number: 1, Question: "Who pays for the lunches?", Answer: "The company pays in full", Status: "answered" },
  { ItemId: "c2", ProjectId: PID, Number: 2, Question: "Can team members change their choice before 10:00?", Answer: "Yes, any time until 10:00", Status: "answered" },
];

function sync(rows: Record<string, Row[]>, p: Row = project) {
  return syncBrief({ workspaceId: WS, projectId: PID, userId: "u1", project: p, rows: (s) => rows[s] ?? [] });
}
const kb = () => knowledgeBaseDir(WS, PID);
const md = () => readFileSync(join(kb(), "brief.md"), "utf8");
const json = () => JSON.parse(readFileSync(join(kb(), "brief.json"), "utf8")) as { version: number; schema: number; openQuestions: { question: string }[] };
const section = (text: string, heading: string) => {
  const blocks = parseMarkdown(text);
  const at = blocks.findIndex((b) => b.type === "heading" && b.text === heading);
  return at < 0 ? null : blocks[at + 1] ?? null;
};

describe("the Project brief under Produced", () => {
  let root: string;
  beforeAll(() => { root = mkdtempSync(join(tmpdir(), "mf-produced-brief-")); process.env.MF_ENGINE_ROOT = root; });
  afterAll(() => { delete process.env.MF_ENGINE_ROOT; rmSync(root, { recursive: true, force: true }); });

  it("at setup: shows the Project brief note's description, no note box, and the goal and the users as open", async () => {
    await sync({ DocNote: notes });
    const text = md();
    expect(section(text, "Desired Outcome")).toEqual({ type: "paragraph", text: ABOUT });
    // the version line is a plain line: no "Note" box (a quote) and no empty label anywhere
    expect(parseMarkdown(text).filter((b) => b.type === "callout")).toEqual([]);
    expect(text).not.toMatch(/^>/m);
    expect(text).toMatch(/^_Version 1 — Generated .+_$/m);
    expect(section(text, "Open Questions")).toEqual({ type: "list", ordered: false, items: ["What problem should this project solve?", "Who will use it?"] });
    expect(text).not.toContain("Orders close at 10:00");
  });

  it("after the hand-over: the answers to other questions settle neither the goal nor the users", async () => {
    await sync({ DocNote: notes, Clarification: domainAnswers });
    // nothing that the brief reads changed: the saved brief stays as it is
    expect(json().version).toBe(1);
    expect(section(md(), "Open Questions")).toMatchObject({ items: ["What problem should this project solve?", "Who will use it?"] });
  });

  it("once the objective is drafted and the users are answered, the next job's sync rewrites it with them and no open questions", async () => {
    const asked = [...domainAnswers, { ItemId: "c7", ProjectId: PID, Number: 7, Question: "Who will use it day to day?", Answer: USERS, Status: "answered" }];
    await sync({ DocNote: notes, Clarification: asked, Objective: [{ ItemId: "o1", ProjectId: PID, Statement: OBJECTIVE }] });
    const text = md();
    expect(json().version).toBe(2);
    expect(text).toMatch(/^_Version 2 — Generated .+_$/m);
    expect(section(text, "Problem")).toEqual({ type: "paragraph", text: OBJECTIVE });
    expect(section(text, "Desired Outcome")).toEqual({ type: "paragraph", text: ABOUT });
    expect(section(text, "Target Users")).toEqual({ type: "list", ordered: false, items: [`**Primary users**: ${USERS}`] });
    expect(text).not.toContain("Open Questions");
    expect(json().openQuestions).toEqual([]);
    // the setup answers carry the client's answers, never the analyst's drafted objective
    const answers = JSON.parse(readFileSync(join(kb(), "form-answers.json"), "utf8")) as Record<string, unknown>;
    expect(answers).toMatchObject({ description: ABOUT, goal: "", targetUsers: USERS });
    // the same inputs again: not rebuilt
    await sync({ DocNote: notes, Clarification: asked, Objective: [{ ItemId: "o1", ProjectId: PID, Statement: OBJECTIVE }] });
    expect(json().version).toBe(2);
  });

  it("the project's own goal and users stay first", async () => {
    await sync({ DocNote: notes, Objective: [{ ItemId: "o1", ProjectId: PID, Statement: OBJECTIVE }] }, { ...project, Goal: "Order lunch without spreadsheets", TargetUsers: "The office team" });
    expect(section(md(), "Problem")).toEqual({ type: "paragraph", text: "Order lunch without spreadsheets" });
    expect(section(md(), "Target Users")).toMatchObject({ items: ["**Primary users**: The office team"] });
  });

  it("a brief saved in the older shape (a quoted version line) is rebuilt once at the next sync", async () => {
    const old = { ...json(), schema: 2, version: 9 };
    writeFileSync(join(kb(), "brief.json"), JSON.stringify(old));
    writeFileSync(join(kb(), "brief.md"), "# Team lunch orders\n\n> Version 9 — Generated 2026-11-08T20:24:12.746Z\n");
    await sync({ DocNote: notes, Objective: [{ ItemId: "o1", ProjectId: PID, Statement: OBJECTIVE }] }, { ...project, Goal: "Order lunch without spreadsheets", TargetUsers: "The office team" });
    expect(json()).toMatchObject({ schema: BRIEF_SCHEMA, version: 10 });
    expect(md()).not.toMatch(/^>/m);
  });
});

describe("between jobs: the worker's periodic refresh", () => {
  let root: string;
  beforeAll(() => { root = mkdtempSync(join(tmpdir(), "mf-produced-periodic-")); process.env.MF_ENGINE_ROOT = root; });
  afterAll(() => { delete process.env.MF_ENGINE_ROOT; rmSync(root, { recursive: true, force: true }); });

  it("rebuilds the brief once an answer arrives without a job, and lists it in the outputs with its new size", async () => {
    const data: Record<string, Row[]> = { Project: [project], DocNote: notes, Clarification: [...domainAnswers] };
    const store = { rows: (s: string) => data[s] ?? [], get: (s: string, id: string) => (data[s] ?? []).find((r) => r.ItemId === id) } as unknown as RowStore;
    const projectDir = join(root, "projects", WS, PID);
    mkdirSync(join(projectDir, "artifacts", "brief"), { recursive: true });
    writeFileSync(join(projectDir, "project.json"), JSON.stringify({ workspaceId: WS, projectId: PID, name: "Team lunch orders" }));
    writeFileSync(join(projectDir, "artifacts", "brief", "context.json"), "{}");
    await sync(data); // the last job's sync
    expect(json().version).toBe(1);
    const lines: string[] = [];
    const refresh = () => refreshProjectContext({ p: new ProjectView(store, PID), workspaceId: WS, projectId: PID, root, log: (l) => lines.push(l) });

    // the person answers the business analyst's question on the users meanwhile; no job follows
    data.Clarification!.push({ ItemId: "c7", ProjectId: PID, Number: 7, Question: "Who will use it day to day?", Answer: USERS, Status: "answered" });
    await refresh();
    expect(json().version).toBe(2);
    expect(section(md(), "Target Users")).toEqual({ type: "list", ordered: false, items: [`**Primary users**: ${USERS}`] });
    expect(section(md(), "Open Questions")).toMatchObject({ items: ["What problem should this project solve?"] });
    const listed = (JSON.parse(readFileSync(join(projectDir, "artifacts", "outputs.json"), "utf8")) as { sections: { items: { path: string; bytes: number }[] }[] })
      .sections.flatMap((x) => x.items).find((i) => i.path === "brief/brief.md");
    expect(listed?.bytes).toBe(Buffer.byteLength(md()));

    // nothing new: not rebuilt again
    await refresh();
    expect(json().version).toBe(2);
    expect(lines.filter((l) => /not brought up to date|not written/.test(l))).toEqual([]);
  });
});
