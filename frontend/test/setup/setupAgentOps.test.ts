// The business agent's ops through the real router: project.setup.agent.wake queues one reading of what nobody has
// read (none after the hand-over, none twice), project.setup.suggestion.decide marks findings, and the review's Add
// saves through project.setup.save (addToDetails) so the checklist ticks and the "Project brief" follows.
import { describe, expect, it } from "vitest";
import { fakeCtx, memoryGateway, runOp, seedProject, seedRow, seedWorkspace } from "../../functions/_lib/testing";
import { PROJECT_OPS } from "../../functions/project/ops/projects/bind";
import { SETUP_AGENT_KIND, addToDetails, doneLine, foundText, suggestionKey, workingLine } from "../../src/domain/setupAgent";
import { EMPTY_DETAILS, detailsFromRow } from "../../src/domain/setupDetails";
import { setupChecklist } from "../../src/domain/projectBrief";

const ME = { userId: "member-1", email: "sandra.keller@selisegroup.com", displayName: "Sandra Keller" };
const VIEWER = { userId: "viewer-1", email: "jonas.meier@alpine-fresh.ch" };

function setup(o: { handedOver?: boolean } = {}) {
  const gateway = memoryGateway();
  const { workspaceId } = seedWorkspace(gateway, { members: [{ ...ME, roleKey: "member" }, { ...VIEWER, roleKey: "viewer" }] });
  const { projectId } = seedProject(gateway, { workspaceId, CreatedByUserId: ME.userId, RepoMode: "new", ...(o.handedOver ? { BusinessHandedOverAt: "2026-10-25T10:00:00.000Z", Stage: "sanitization" } : {}) });
  const readers = [ME.userId, VIEWER.userId];
  const stamp = { WorkspaceId: workspaceId, ReaderIds: readers, ProjectId: projectId, CreatedByUserId: ME.userId, UpdatedByUserId: ME.userId };
  seedRow(gateway, "DocNote", { ...stamp, FolderId: "", Title: "Project brief", BodyMd: "## Goal\n\nFaster returns.\n", SortOrder: 0, IsScratchPad: false, IsProjectBrief: true });
  const file = (name: string, n: number) => seedRow(gateway, "DocFile", {
    ...stamp, FolderId: "", Name: name, StoredName: `${n}.pdf`, Mime: "application/pdf", SizeBytes: 100, StorageObjectId: `obj-${n}`, Status: "ready", SortOrder: 1024 * n,
  });
  const suggestion = (text: string, kind = "mustHave", extra: Record<string, unknown> = {}) => seedRow(gateway, "SetupSuggestion", {
    ...stamp, Kind: kind, Text: text, Priority: "must", ConstraintKind: "other", SourceName: "PRD v2.pdf", SourceRef: "DocFile:x", Status: "open",
    EngineJobId: "job-1", Key: suggestionKey(kind as never, text), SortOrder: 1, ...extra,
  });
  const call = (op: string, args: Record<string, unknown>, who: { userId: string; email: string } = ME) =>
    runOp("project", PROJECT_OPS, { ctx: fakeCtx(who), gateway, request: { op, args: { projectId, ...args } } });
  const jobs = () => gateway.rows("EngineJob").filter((j) => j.ProjectId === projectId && j.Kind === SETUP_AGENT_KIND);
  const project = () => gateway.rows("Project").find((r) => r.ItemId === projectId)!;
  const brief = () => gateway.rows("DocNote").find((r) => r.ProjectId === projectId && r.Title === "Project brief")!;
  return { gateway, projectId, workspaceId, file, suggestion, call, jobs, project, brief };
}

describe("project.setup.agent.wake", () => {
  it("queues one reading of the files nobody has read, then answers it while it runs", async () => {
    const t = setup();
    const a = t.file("PRD v2.pdf", 1);
    const b = t.file("Minutes 12 October.pdf", 2);
    const res = await t.call("project.setup.agent.wake", {});
    expect(res.status).toBe(200);
    expect(res.body.data.queued).toBe(true);
    expect(t.jobs()).toHaveLength(1);
    const input = JSON.parse(String(t.jobs()[0]!.InputJson));
    expect(input.fileIds.sort()).toEqual([a, b].sort());
    expect(input.noteIds).toEqual([]); // the Project brief is the setup's own summary
    const again = await t.call("project.setup.agent.wake", {});
    expect(again.body.data).toMatchObject({ jobId: t.jobs()[0]!.ItemId, queued: false });
    expect(t.jobs()).toHaveLength(1);
  });

  it("queues nothing when everything is read, and nothing after the hand-over", async () => {
    const t = setup();
    t.file("PRD v2.pdf", 1);
    await t.call("project.setup.agent.wake", {});
    const job = t.jobs()[0]!;
    t.gateway.rows("EngineJob").find((j) => j.ItemId === job.ItemId)!.Status = "succeeded";
    expect((await t.call("project.setup.agent.wake", {})).body.data.queued).toBe(false);
    expect(t.jobs()).toHaveLength(1);

    const h = setup({ handedOver: true });
    h.file("PRD v2.pdf", 1);
    expect((await h.call("project.setup.agent.wake", {})).body.data).toEqual({ jobId: null, queued: false });
    expect(h.jobs()).toHaveLength(0);
  });

  it("queues a new reading when the last one failed or was stopped (Try again), not the finished job again", async () => {
    const t = setup();
    t.file("PRD v2.pdf", 1);
    await t.call("project.setup.agent.wake", {});
    const first = t.jobs()[0]!;
    // a finished job frees its kind's active key (it becomes the job's own id), as the engine's finish does
    const finish = (id: unknown, status: string) => t.gateway.update("EngineJob", String(id), { Status: status, ActiveKey: String(id), FinishedAt: "2026-11-08T10:00:00.000Z" });
    await finish(first.ItemId, "failed");
    const again = await t.call("project.setup.agent.wake", {});
    expect(again.body.data.queued).toBe(true);
    expect(t.jobs()).toHaveLength(2);
    const second = t.jobs().find((j) => j.ItemId !== first.ItemId)!;
    expect(again.body.data.jobId).toBe(second.ItemId);
    await finish(second.ItemId, "cancelled");
    expect((await t.call("project.setup.agent.wake", {})).body.data.queued).toBe(true);
    expect(t.jobs()).toHaveLength(3);
  });

  it("a viewer cannot wake the agent", async () => {
    const t = setup();
    t.file("PRD v2.pdf", 1);
    expect((await t.call("project.setup.agent.wake", {}, VIEWER)).status).toBe(403);
  });
});

describe("project.setup.suggestion.decide", () => {
  it("marks findings added, ignored or open again", async () => {
    const t = setup();
    const a = t.suggestion("Record each return once");
    const b = t.suggestion("Show the minutes lost per site at a glance");
    const res = await t.call("project.setup.suggestion.decide", { suggestionIds: [a, b], decision: "ignored" });
    expect(res.status).toBe(200);
    expect(res.body.data.suggestions.map((s: { Status: string }) => s.Status)).toEqual(["ignored", "ignored"]);
    const row = t.gateway.rows("SetupSuggestion").find((r) => r.ItemId === a)!;
    expect(row).toMatchObject({ Status: "ignored", DecidedByUserId: ME.userId });
    await t.call("project.setup.suggestion.decide", { suggestionIds: [a], decision: "open" });
    expect(t.gateway.rows("SetupSuggestion").find((r) => r.ItemId === a)!.Status).toBe("open");
  });

  it("refuses unknown decisions, other projects' findings and viewers", async () => {
    const t = setup();
    const a = t.suggestion("Record each return once");
    expect((await t.call("project.setup.suggestion.decide", { suggestionIds: [a], decision: "accepted" })).status).toBe(400);
    expect((await t.call("project.setup.suggestion.decide", { suggestionIds: ["nope"], decision: "added" })).status).toBe(404);
    const { projectId: otherId } = seedProject(t.gateway, { workspaceId: t.workspaceId, CreatedByUserId: ME.userId, Name: "Another project" });
    const theirs = t.suggestion("Something else entirely", "mustHave", { ProjectId: otherId });
    expect((await t.call("project.setup.suggestion.decide", { suggestionIds: [theirs], decision: "added" })).status).toBe(404);
    expect((await t.call("project.setup.suggestion.decide", { suggestionIds: [a], decision: "added" }, VIEWER)).status).toBe(403);
  });
});

describe("the review's Add", () => {
  it("saves document findings through project.setup.save without restoring the removed checklist item", async () => {
    const t = setup();
    const found = [
      { kind: "mustHave" as const, text: "Record each return once", priority: "must" as const, constraintKind: "other" as const },
      { kind: "mustHave" as const, text: "Show the minutes lost per site at a glance", priority: "should" as const, constraintKind: "other" as const },
      { kind: "workflow" as const, text: "The store manager checks the returns every Friday", priority: "must" as const, constraintKind: "other" as const },
      { kind: "constraint" as const, text: "The first release must be ready by 4 January", priority: "must" as const, constraintKind: "deadline" as const },
    ];
    const args = addToDetails(detailsFromRow(t.project()), found);
    const res = await t.call("project.setup.save", args as Record<string, unknown>);
    expect(res.status).toBe(200);
    const d = detailsFromRow(t.project());
    expect(d.mustHaves).toEqual([{ text: "Record each return once", priority: "must" }, { text: "Show the minutes lost per site at a glance", priority: "should" }]);
    expect(d.workflows).toEqual(["The store manager checks the returns every Friday"]);
    expect(d.constraints).toEqual([{ kind: "deadline", text: "The first release must be ready by 4 January" }]);
    expect(String(t.brief().BodyMd)).toContain("- **Must:** Record each return once");
    const checklist = setupChecklist({ existing: false, name: "x", description: "", goal: "", targetUsers: "", repoSaved: false, repoText: "", repoWillBeCreated: true, sharedCount: 1 });
    expect(checklist.map((i) => i.id)).toEqual(["about", "goal", "where", "share"]);
    // a second deadline joins the first one (one constraint per kind); a repeat adds nothing
    const more = addToDetails(d, [{ kind: "constraint", text: "Five pilot stores live by 20 November", priority: "must", constraintKind: "deadline" }, { kind: "mustHave", text: "record each return once.", priority: "could", constraintKind: "other" }]);
    expect(more.constraints).toEqual([{ kind: "deadline", text: "The first release must be ready by 4 January; Five pilot stores live by 20 November" }]);
    expect(addToDetails(d, [{ kind: "constraint", text: "The pilot ends in May", priority: "must", constraintKind: "deadline" }]).constraints![0]!.text).toBe("The first release must be ready by 4 January; the pilot ends in May");
    expect(doneLine({ filed: 4, folders: 4 }, [], 9)).toBe("Filed 4 documents into 4 folders · you've reviewed everything it found");
    expect(more.mustHaves).toHaveLength(2);
  });
});

describe("the line", () => {
  it("says what the agent does in plain words", () => {
    expect(workingLine(3, 0)).toBe("Your business analyst is reading 3 new files…");
    expect(workingLine(1, 2)).toBe("Your business analyst is reading 1 new file and 2 notes…");
    expect(doneLine(null, [], 2)).toBe("You've reviewed everything your business analyst found");
    const open = [
      ...Array.from({ length: 4 }, () => ({ kind: "mustHave" as const, sourceName: "PRD v2.pdf" })),
      { kind: "workflow" as const, sourceName: "PRD v2.pdf" }, { kind: "workflow" as const, sourceName: "PRD v2.pdf" },
    ];
    expect(foundText(open)).toBe("4 must-haves and 2 workflows");
    expect(doneLine({ filed: 8, folders: 3 }, open)).toBe("Filed 8 documents into 3 folders · found 4 must-haves and 2 workflows in PRD v2.pdf");
    expect(doneLine({ filed: 1, folders: 1 }, [])).toBe("Filed 1 document into 1 folder · nothing new to add to your setup");
    expect(doneLine(null, [{ kind: "constraint", sourceName: "a.eml" }, { kind: "goal", sourceName: "b.md" }])).toBe("Found 1 constraint and a goal in 2 documents");
    expect(EMPTY_DETAILS.mustHaves).toEqual([]);
  });
});
