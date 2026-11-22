// The Project setup chips open what was entered at any stage: in setup with edit rights their own windows (guided
// questions, Code, Share material); afterwards, or without edit rights, the saved answers read-only with one plain line.
// Pure rules (mode, routing, values, shared items, the Code lock) and server renders of the chips and of each window.
// The setup asks About, Code and Material only: the goal and the end users are elicited in Business Analysis.
//   npx vitest run --config frontend/test/setup/vitest.config.ts
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import {
  CODE_STILL_OPEN, NOT_ANSWERED, READ_ONLY_MOVED_ON, READ_ONLY_NO_RIGHTS, SETUP_CHIP_IDS, briefIdOf, codeHomeDone, setupChipList, setupChipMode,
  setupChipTarget, setupPageItems, setupValues, sharedCount, sharedItems, type SetupChipId, type SetupFacts, type SetupValues, type SetupValuesInput,
} from "../../src/components/business/setupChips";
import { SetupAnswersBody, answersTitle } from "../../src/components/business/SetupAnswersWindow";
import { codeHomeStillOpen } from "../../src/components/business/NewRepositoryCard";
import { SCRATCH_ID } from "../../src/components/business/treeModel";
import { StepChips } from "../../src/components/step/StepFrame";
import { chipsStatus } from "../../src/components/step/stepModel";
import { EDIT_STEPS, EMPTY_ANSWERS, answersFromProject } from "../../src/domain/guidedStart";
import { briefMarkdown, setupChecklist } from "../../src/domain/projectBrief";

const IDS: SetupChipId[] = ["about", "where", "share"];

const project = (over: Partial<SetupValuesInput["project"] & { setupAnswers: string; goal: string; targetUsers: string }> = {}) => ({
  name: "Asset Market", type: "greenfield", goal: "", targetUsers: "", websiteUrl: "",
  repoOwner: "", repoName: "", repoBranch: "", repoVisibility: "", repoExisting: false,
  appUrl: "", testEnv: "", runInstructions: "", blocksProjectRef: "", setupAnswers: "",
  ...over,
});

const DESCRIPTION = "Creators sell icons, fonts and 3D models with clear licences; buyers keep a permanent download library.";
const GOAL = "Licences nobody can misunderstand. Goal: 500 creators and 10,000 assets in six months.";
const USERS = "Creators who sell assets, buyers who license them, and our small marketplace team.";

/** A project saved by the guided start (MADP Factory keeps the code). */
function assetMarket(over: Partial<SetupValuesInput> = {}): SetupValuesInput {
  const answers = { ...EMPTY_ANSWERS, kind: "new" as const, name: "Asset Market", description: DESCRIPTION, goal: GOAL, users: USERS, repoChoice: "factory" as const };
  const p = project({ goal: GOAL, targetUsers: USERS, setupAnswers: JSON.stringify({ v: 1, ...answers }) });
  return { project: p, answers: answersFromProject({ ...p, id: "x" } as never), briefBody: "", scratchText: "", ...over };
}

describe("how the chips open", () => {
  it("edits while in setup with edit rights", () => {
    expect(setupChipMode({ canEdit: true, step: "business", handedOverAt: null })).toEqual({ kind: "edit" });
  });
  it("is read-only once the project has moved on, with or without edit rights", () => {
    for (const canEdit of [true, false]) {
      expect(setupChipMode({ canEdit, step: "release", handedOverAt: "2026-10-31T04:37:00Z" })).toEqual({ kind: "read", note: READ_ONLY_MOVED_ON });
      expect(setupChipMode({ canEdit, step: "understanding", handedOverAt: "2026-10-31T04:37:00Z" })).toEqual({ kind: "read", note: READ_ONLY_MOVED_ON });
      expect(setupChipMode({ canEdit, step: "build", handedOverAt: null })).toEqual({ kind: "read", note: READ_ONLY_MOVED_ON });
    }
  });
  it("is read-only in setup without edit rights", () => {
    expect(setupChipMode({ canEdit: false, step: "business", handedOverAt: null })).toEqual({ kind: "read", note: READ_ONLY_NO_RIGHTS });
  });
  it("routes each chip: today's windows in edit mode, the saved answers in read mode", () => {
    const edit = { kind: "edit" } as const;
    expect(setupChipTarget("about", edit)).toEqual({ open: "guided", step: "about" });
    expect(setupChipTarget("where", edit)).toEqual({ open: "code" });
    expect(setupChipTarget("share", edit)).toEqual({ open: "share" });
    for (const id of IDS) expect(setupChipTarget(id, { kind: "read", note: READ_ONLY_MOVED_ON })).toEqual({ open: "answers", id });
  });
  it("the About chip's questions no longer ask the goal and users", () => {
    expect(EDIT_STEPS).not.toContain("goal");
    expect(EDIT_STEPS[0]).toBe("about");
  });
});

describe("the chips", () => {
  const facts: SetupFacts = { existing: false, repoSaved: false, repoName: "", sharedCount: 1 };
  const items = setupChecklist({
    existing: false, name: "Asset Market", description: DESCRIPTION, goal: "", targetUsers: "",
    repoSaved: false, repoText: "", repoWillBeCreated: false, keptInFactory: true, sharedCount: 1,
  });

  for (const mode of [{ kind: "edit" } as const, { kind: "read", note: READ_ONLY_MOVED_ON } as const]) {
    it(`always open, also after the sign-off (${mode.kind})`, () => {
      const open = vi.fn();
      const chips = setupChipList(items, facts, mode, open);
      expect(chips.map((c) => c.id)).toEqual(IDS);
      expect(chips.every((c) => typeof c.onClick === "function" && c.editableAfterSignOff === true)).toBe(true);
      chips.forEach((c) => c.onClick!());
      expect(open.mock.calls.map((c) => c[0])).toEqual(IDS);
      // the step frame renders every chip as a button even when the step is signed off
      const html = renderToString(createElement(StepChips, { chips, readOnly: true, label: "Project setup checklist" }));
      expect(html.match(/<button/g)?.length).toBe(3);
      for (const id of IDS) expect(html).toContain(`data-chip="${id}"`);
    });
  }
  it("invites with “view”, never “add”, in read mode", () => {
    // nothing shared yet: the Material chip is still open
    const none: SetupFacts = { ...facts, sharedCount: 0 };
    const open = setupChecklist({
      existing: false, name: "Asset Market", description: DESCRIPTION, goal: "", targetUsers: "",
      repoSaved: false, repoText: "", repoWillBeCreated: false, keptInFactory: true, sharedCount: 0,
    });
    const read = renderToString(createElement(StepChips, { chips: setupChipList(open, none, { kind: "read", note: READ_ONLY_MOVED_ON }, () => {}), readOnly: true }));
    expect(read).toContain("view");
    expect(read).not.toMatch(/>add</);
    const edit = renderToString(createElement(StepChips, { chips: setupChipList(open, none, { kind: "edit" }, () => {}) }));
    expect(edit).toMatch(/>add</);
    expect(setupChipList(items, facts, { kind: "read", note: READ_ONLY_MOVED_ON }, () => {})[1]!.title).toContain("see what was saved");
  });
  it("leaves the goal and users out: no chip, not counted, setup ready without them", () => {
    expect(SETUP_CHIP_IDS).toEqual(IDS);
    expect(items.find((i) => i.id === "goal")?.done).toBe(false);
    expect(setupPageItems(items).map((i) => i.id)).toEqual(IDS);
    const chips = setupChipList(items, facts, { kind: "edit" }, () => {});
    expect(chips.some((c) => c.id === "goal")).toBe(false);
    expect(chipsStatus(chips, "Ready for analysis")).toEqual({ tone: "done", text: "Ready for analysis" });
    const html = renderToString(createElement(StepChips, { chips }));
    expect(html).not.toContain("Goal");
  });
});

describe("the saved values", () => {
  it("reads the guided start's answers and the Project record", () => {
    const v = setupValues(assetMarket());
    expect(v.name).toBe("Asset Market");
    expect(v.description).toEqual({ text: DESCRIPTION, source: "answers" });
    expect(v).not.toHaveProperty("goal");
    expect(v).not.toHaveProperty("users");
    expect(v.code).toEqual({ home: "factory" });
    expect(codeHomeDone(v.code)).toBe(true);
  });
  it("falls back to the Project brief, then the Scratch pad, for the description", () => {
    const brief = briefMarkdown({ name: "Asset Market", existing: false, description: DESCRIPTION, goal: GOAL, targetUsers: USERS });
    const base = assetMarket();
    const noDesc = { ...base, answers: { ...base.answers, description: "" } };
    expect(setupValues({ ...noDesc, briefBody: brief }).description).toEqual({ text: DESCRIPTION, source: "brief" });
    expect(setupValues({ ...noDesc, scratchText: "Typed at the start" }).description).toEqual({ text: "Typed at the start", source: "scratch" });
    expect(setupValues(noDesc).description).toEqual({ text: "", source: null });
  });
  it("knows every code home, and ticks Code exactly when the window shows one", () => {
    const run = (p: ReturnType<typeof project>, repoChoice: "factory" | "create" | "existing" | null) =>
      setupValues({ project: p, answers: { ...EMPTY_ANSWERS, repoChoice }, briefBody: "", scratchText: "" });
    const saved = project({ repoOwner: "acme", repoName: "asset-market", repoBranch: "main", repoVisibility: "private" });
    expect(run(saved, "create").code).toEqual({ home: "github", owner: "acme", name: "asset-market", branch: "main", visibility: "private", existingRepo: false });
    expect(run(project(), "create").code).toEqual({ home: "create" });
    expect(run(project(), "existing").code).toEqual({ home: "pick" });
    expect(run(project(), null).code).toEqual({ home: "factory" });
    expect(run(project({ type: "brownfield" }), null).code).toEqual({ home: "none" });
    for (const [p, choice] of [[saved, "create"], [project(), "create"], [project(), "existing"], [project(), "factory"]] as const) {
      const c = run(p, choice).code;
      const where = setupChecklist({
        existing: false, name: "x", description: "", goal: "", targetUsers: "", repoSaved: c.home === "github", repoText: "",
        repoWillBeCreated: c.home === "create", keptInFactory: c.home === "factory", sharedCount: 0,
      }).find((i) => i.id === "where")!;
      expect(where.done).toBe(codeHomeDone(c));
    }
  });
  it("reads an existing product's code, webpage, test version and how it is started", () => {
    const p = project({
      type: "brownfield", websiteUrl: "https://www.alpinefresh.ch", repoOwner: "alpine", repoName: "shop", repoBranch: "develop", repoExisting: true,
      appUrl: "https://shop.alpinefresh.ch", testEnv: JSON.stringify({ available: "yes", url: "https://test.alpinefresh.ch", accessHow: "Anna from IT" }),
      runInstructions: "npm start",
    });
    const v = setupValues({ project: p, answers: EMPTY_ANSWERS, briefBody: "", scratchText: "" });
    expect(v.existing).toBe(true);
    expect(v.website).toBe("https://www.alpinefresh.ch");
    expect(v.code).toMatchObject({ home: "github", owner: "alpine", name: "shop", branch: "develop", existingRepo: true });
    expect(v.appUrl).toBe("https://shop.alpinefresh.ch");
    expect(v.testEnv).toContain("https://test.alpinefresh.ch");
    expect(v.runInstructions).toBe("npm start");
  });
});

describe("shared material and the brief", () => {
  const data = {
    folders: [{ id: "f1", name: "Client documents" }],
    notes: [
      { id: "brief", title: "Project brief", folderId: "", isScratch: false, isProjectBrief: true },
      { id: "scratch", title: "Scratch pad", folderId: "", isScratch: true },
      { id: "n1", title: "Kick-off call", folderId: "f1", isScratch: false },
    ],
    files: [
      { id: "file1", name: "licences.pdf", folderId: "f1", status: "ready", sizeBytes: 840_000, mime: "application/pdf" },
      { id: "file2", name: "draft.docx", folderId: "f1", status: "pending", sizeBytes: 1000, mime: "" },
    ],
    scratch: { id: "scratch" },
  };
  it("lists the same items the Material chip counts", () => {
    for (const scratchHasText of [true, false]) expect(sharedItems(data, scratchHasText).length).toBe(sharedCount(data, scratchHasText));
    expect(sharedItems(data, true).map((i) => i.title)).toEqual(["Scratch pad", "Kick-off call", "licences.pdf"]);
    expect(sharedItems(data, true)[2]).toMatchObject({ kind: "file", folderName: "Client documents" });
    expect(sharedItems(undefined, true)).toEqual([]);
  });
  it("finds the Project brief note", () => {
    expect(briefIdOf(data)).toBe("brief");
    expect(briefIdOf({ notes: [{ id: "b2", title: "Project brief", folderId: "", isScratch: false }] })).toBe("b2");
    expect(briefIdOf(undefined)).toBeNull();
  });
});

describe("the Code window's lock after the setup", () => {
  const base = { type: "greenfield" as const, step: "understanding" as const, handedOverAt: "2026-10-31T04:37:00Z", repoOwner: "", repoName: "", repoBranch: "", repoExisting: false, setupAnswers: "" };
  it("a new product can still connect GitHub until the build starts", () => {
    expect(codeHomeStillOpen(base)).toBe(true);
    expect(codeHomeStillOpen({ ...base, step: "build" })).toBe(false);
    expect(codeHomeStillOpen({ ...base, step: "release" })).toBe(false);
  });
  it("a repository the team already had, and an existing product's, are fixed from the hand-over", () => {
    expect(codeHomeStillOpen({ ...base, repoOwner: "a", repoName: "b", repoBranch: "main", repoExisting: true })).toBe(false);
    expect(codeHomeStillOpen({ ...base, type: "brownfield" })).toBe(false);
    expect(codeHomeStillOpen({ ...base, type: "brownfield", step: "business", handedOverAt: null })).toBe(true);
  });
});

describe("the read-only windows", () => {
  const values: SetupValues = setupValues(assetMarket());
  const material = [
    { kind: "note" as const, id: "scratch", title: "Scratch pad", folderName: "", sizeBytes: 0, mime: "", scratch: true },
    { kind: "file" as const, id: "file1", title: "licences.pdf", folderName: "Client documents", sizeBytes: 840_000, mime: "application/pdf", scratch: false },
  ];
  const render = (section: SetupChipId, v: SetupValues = values, note = READ_ONLY_MOVED_ON, onOpenItem?: (id: string) => void) =>
    renderToString(createElement(SetupAnswersBody, { section, values: v, note, material, onOpenItem }));
  const noInputs = (html: string) => {
    expect(html).not.toMatch(/<(input|textarea|select)\b/);
    expect(html).not.toContain("disabled");
  };

  it("names each window", () => {
    expect(IDS.map((id) => answersTitle(id, false))).toEqual(["About the project", "Where the code lives", "Material you shared"]);
    expect(answersTitle("where", true)).toBe("The product's code");
  });
  for (const note of [READ_ONLY_MOVED_ON, READ_ONLY_NO_RIGHTS, CODE_STILL_OPEN]) {
    it(`says why in one line, without disabled inputs (${note.slice(0, 40)}…)`, () => {
      for (const id of IDS) {
        const html = render(id, values, note);
        expect(html).toContain(note.replace("&", "&amp;").replace(/'/g, "&#x27;"));
        noInputs(html);
      }
    });
  }
  it("About: the name, the idea in the user's words, new or existing, the website", () => {
    const html = render("about");
    expect(html).toContain("Asset Market");
    expect(html).toContain(DESCRIPTION);
    expect(html).toContain("A new product");
    expect(html).not.toContain("Website");
    const existing = render("about", { ...values, existing: true, website: "https://www.alpinefresh.ch", description: { text: "", source: null } });
    expect(existing).toContain("Website");
    expect(existing).toContain("www.alpinefresh.ch");
    expect(existing).toContain("(opens in a new tab)");
    expect(existing).toContain(NOT_ANSWERED);
  });
  it("Code: MADP Factory, a GitHub repository and branch, or not picked yet", () => {
    expect(render("where")).toContain("Kept safe in MADP Factory");
    const gh = render("where", { ...values, code: { home: "github", owner: "acme", name: "asset-market", branch: "main", visibility: "private", existingRepo: false } });
    expect(gh).toContain("acme/asset-market");
    expect(gh).toContain("https://github.com/acme/asset-market/tree/main");
    expect(gh).toContain("Branch");
    expect(gh).toContain("Private");
    expect(render("where", { ...values, code: { home: "pick" } })).toContain("Not picked yet");
    expect(render("where", { ...values, code: { home: "create" } })).toContain("Not created yet");
    const existing = render("where", { ...values, existing: true, code: { home: "none" } });
    expect(existing).toContain("Its code on GitHub");
    expect(existing).toContain(NOT_ANSWERED);
  });
  it("Material: the shared notes and files, each opening in “Your material”", () => {
    const html = render("share");
    expect(html).toContain("2 items");
    expect(html).toContain("Scratch pad");
    expect(html).toContain("licences.pdf");
    expect(html).toContain("Client documents");
    expect(html.match(/<button/g)?.length).toBe(2);
    expect(renderToString(createElement(SetupAnswersBody, { section: "share", values, note: READ_ONLY_MOVED_ON, material: [] }))).toContain("Nothing shared yet");
  });
  it("Material: opening an item selects it (the Scratch pad by its fixed id)", () => {
    const open = vi.fn();
    const el = SetupAnswersBody({ section: "share", values, note: READ_ONLY_MOVED_ON, material, onOpenItem: open });
    // walk the element tree to the item buttons and press them
    const buttons: { props: { onClick: () => void } }[] = [];
    const walk = (n: unknown): void => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      const e = n as { type?: unknown; props?: Record<string, unknown> };
      if (e.type === "button") buttons.push(e as never);
      if (typeof e.type === "function") { walk((e.type as (p: unknown) => unknown)(e.props)); return; }
      walk(e.props?.children);
    };
    walk(el);
    buttons.forEach((b) => b.props.onClick());
    expect(open.mock.calls.map((c) => c[0])).toEqual([SCRATCH_ID, "file1"]);
  });
});
