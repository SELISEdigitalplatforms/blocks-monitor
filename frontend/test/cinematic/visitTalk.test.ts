import { beforeEach, describe, expect, it, vi } from "vitest";
import { useChat } from "../../src/components/cinematic/visit/chat";
import { useVisit } from "../../src/components/cinematic/visit/store";
import { answerSetup, kindOf, setupPrompt, type SetupDeps, type SetupOps } from "../../src/components/cinematic/visit/setupTalk";
import {
  analysisIndicator, analysisItemOf, continuable, leaveUrl, nextForItem, phaseOfProject, resumeIdOf, setupAskOf, setupStates, type FlowProject,
} from "../../src/components/cinematic/visit/flow";
import { resetAcks } from "../../src/components/cinematic/visit/acks";
import { toCreateArgs } from "../../src/domain/guidedStart";
import type { ChecklistState } from "../../src/components/analysis/pm/pmModel";

function fakeOps(over: Partial<SetupOps> = {}) {
  let n = 0;
  const ops: SetupOps = {
    newRequestId: () => `req-${++n}`,
    message: (e) => (e instanceof Error ? e.message : String(e)),
    create: vi.fn(async () => "P1"),
    upload: vi.fn(async (_id: string, files: File[], onRow) => { files.forEach((_f, i) => onRow(i, { phase: "done" })); return { filed: files.length, failed: [] }; }),
    handOver: vi.fn(async () => undefined),
    pickFiles: vi.fn(),
    ...over,
  };
  return ops;
}

function deps(ops: SetupOps, githubLogin: string | null = null): SetupDeps {
  const v = useVisit.getState();
  return {
    ops,
    githubLogin,
    chat: { say: useChat.getState().say, you: useChat.getState().you, whileBusy: useChat.getState().whileBusy },
    visit: {
      get: () => useVisit.getState(),
      setDraft: v.setDraft, setProject: v.setProject, setCreateRequest: v.setCreateRequest, passMaterial: v.passMaterial,
      setUploads: v.setUploads, openWhere: v.openWhere,
    },
  };
}

/** answers the step the flow is at, as the conversation does */
async function answer(d: SetupDeps, input: { text?: string; reply?: string; files?: File[] }, project: FlowProject | null = null, shared = 0) {
  const s = useVisit.getState();
  const ask = setupAskOf(s.draft, project, shared, s.materialPassed)!;
  const prompt = setupPrompt(ask, { draft: s.draft, visitor: "Anna", projectName: "", handOverBlocked: null, resumed: false, existing: s.draft.answers.kind === "existing" });
  await answerSetup(ask, input, prompt, d);
  // lines said without waiting (an acknowledgement) are spoken before the next answer, as in the room
  await new Promise((r) => setTimeout(r, 0));
  return ask;
}

const said = () => useChat.getState().messages.map((m) => `${m.from}: ${m.text}`);
const lines = (who: "assistant" | "pm") => useChat.getState().messages.filter((m) => m.from === who).map((m) => m.text);
const ask = () => setupAskOf(useVisit.getState().draft, null);

beforeEach(() => {
  useChat.getState().reset();
  useChat.getState().setReduced(true);
  useVisit.getState().reset();
  resetAcks();
});

describe("Project Setup in the office: a conversation, not a form", () => {
  it("asks the guided start's questions in the dialog's order, then creates the project with its arguments", async () => {
    const ops = fakeOps();
    const d = deps(ops);
    expect(await answer(d, { reply: "new" })).toBe("kind");
    expect(await answer(d, { text: "Link Shortener" })).toBe("name");
    expect(await answer(d, { text: "to shorten link fast" })).toBe("description");
    expect(await answer(d, { reply: "factory" })).toBe("where");
    expect(ask()).toBe("ready");
    expect(await answer(d, { text: "yes" })).toBe("ready");
    expect(ops.create).toHaveBeenCalledTimes(1);
    const [answers, login, requestId] = (ops.create as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(toCreateArgs(answers, login)).toMatchObject({ name: "Link Shortener", projectType: "greenfield", description: "to shorten link fast" });
    expect(requestId).toBe("req-1");
    expect(useVisit.getState().projectId).toBe("P1");
  });

  it("takes short answers as answers, and acknowledges what was said instead of a scripted thank-you", async () => {
    const d = deps(fakeOps());
    await answer(d, { text: "new one" });
    await answer(d, { text: "Linky" });
    await answer(d, { text: "short links" });
    expect(ask()).toBe("where");
    const words = lines("assistant").join(" | ");
    // a short answer is said back; a description gets a short word of its own (never parroted)
    expect(words).toContain("Linky");
    expect(words).toMatch(/clear|picture|what it's about/i);
    expect(words).not.toMatch(/thank you\./i);
    expect(words).not.toMatch(/say a little more|tell me a little more/i);
  });

  it("never refuses in a loop: a long name is kept short once, a bad address is left out once, and the visit moves on", async () => {
    const d = deps(fakeOps());
    await answer(d, { reply: "existing" });
    await answer(d, { text: "x".repeat(120) });
    expect(ask()).toBe("description");
    expect(useVisit.getState().draft.answers.name).toHaveLength(80);
    await answer(d, { text: "Our dealer shop." });
    expect(ask()).toBe("website");
    await answer(d, { text: "not a website" });
    expect(ask()).toBe("where");
    expect(useVisit.getState().draft.answers.website).toBe("");
    expect(useChat.getState().messages.filter((m) => m.tone === "error")).toHaveLength(0);
  });

  it("understands later, not sure, yes and no where they are said", async () => {
    const ops = fakeOps();
    const d = deps(ops);
    await answer(d, { text: "we already have it live" });
    expect(useVisit.getState().draft.answers.kind).toBe("existing");
    useVisit.getState().reset();
    await answer(d, { reply: "new" });
    await answer(d, { text: "don't know" });
    expect(useVisit.getState().draft.answers.name).toBe("New project");
    await answer(d, { text: "later" });
    expect(ask()).toBe("where");
    expect(useVisit.getState().draft.answers.description).toBe("");
    await answer(d, { text: "ok" });
    expect(ask()).toBe("ready");
    // something unclear at the confirmation: asked once, never the same line twice in a row
    await answer(d, { text: "hmm" });
    await answer(d, { text: "what?" });
    const asked = lines("assistant").filter((l) => /create it as it is/.test(l));
    expect(asked).toHaveLength(1);
    expect(ops.create).not.toHaveBeenCalled();
    await answer(d, { text: "ja" });
    expect(ops.create).toHaveBeenCalledTimes(1);
  });

  it("never creates a project twice: a retry keeps the request, a changed answer is a new one", async () => {
    let fail = true;
    const ops = fakeOps({ create: vi.fn(async () => { if (fail) throw new Error("No connection."); return "P2"; }) });
    const d = deps(ops);
    await answer(d, { reply: "new" });
    await answer(d, { text: "Bikes" });
    await answer(d, { text: "Customers book bike repairs online." });
    await answer(d, { reply: "factory" });
    await answer(d, { reply: "create" });
    expect(useVisit.getState().projectId).toBeNull();
    expect(said().at(-1)).toContain("No connection.");
    fail = false;
    await answer(d, { text: "yes" });
    const calls = (ops.create as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][2]).toBe(calls[1][2]);
    expect(useVisit.getState().projectId).toBe("P2");

    useVisit.getState().reset();
    fail = true;
    await answer(d, { reply: "new" });
    await answer(d, { text: "Bikes" });
    await answer(d, { text: "Customers book bike repairs online." });
    await answer(d, { reply: "factory" });
    await answer(d, { reply: "create" });
    expect(useVisit.getState().createRequest).not.toBeNull();
    await answer(d, { text: "change the name" });
    expect(useVisit.getState().createRequest).toBeNull();
    expect(ask()).toBe("name");
  });

  it("checks GitHub again before creating: a choice that needs it goes back to where the code lives", async () => {
    const ops = fakeOps();
    const d = deps(ops, null);
    await answer(d, { reply: "new" });
    await answer(d, { text: "Bikes" });
    await answer(d, { text: "Customers book bike repairs online." });
    useVisit.getState().setDraft({ repoChoice: "create" }, { whereDone: true });
    await answer(d, { reply: "create" });
    expect(ops.create).not.toHaveBeenCalled();
    expect(ask()).toBe("where");
  });

  it("files the material, then hands over on a plain yes", async () => {
    const ops = fakeOps();
    const d = deps(ops);
    useVisit.getState().setProject("P1");
    const project: FlowProject = { id: "P1", step: "business", handedOverAt: null };
    expect(await answer(d, { files: [new File(["x"], "brief.pdf")] }, project)).toBe("material");
    expect(ops.upload).toHaveBeenCalledWith("P1", expect.any(Array), expect.any(Function));
    expect(useVisit.getState().uploads).toEqual([{ name: "brief.pdf", phase: "done" }]);
    expect(said().at(-1)).toContain("brief.pdf is filed");
    expect(await answer(d, { text: "ok" }, project, 1)).toBe("handOver");
    expect(ops.handOver).toHaveBeenCalledWith("P1");
  });

  it("goes on without files on a no, opens the chooser on a yes, and says why a hand-over failed", async () => {
    const ops = fakeOps({ handOver: vi.fn(async () => { throw new Error("You need permission to edit the project setup."); }) });
    const d = deps(ops);
    useVisit.getState().setProject("P1");
    const project: FlowProject = { id: "P1", step: "business", handedOverAt: null };
    await answer(d, { text: "yes" }, project);
    expect(ops.pickFiles).toHaveBeenCalled();
    await answer(d, { text: "no" }, project);
    expect(useVisit.getState().materialPassed).toBe(true);
    await answer(d, { reply: "start" }, project);
    expect(useChat.getState().messages.at(-1)).toMatchObject({ tone: "error" });
    expect(said().at(-1)).toContain("permission");
  });

  it("shows the thinking state only while the work is in flight", async () => {
    let release = () => undefined as void;
    const ops = fakeOps({ handOver: vi.fn(() => new Promise<void>((r) => { release = r; })) });
    const d = deps(ops);
    useVisit.getState().setProject("P1");
    const p = answer(d, { reply: "start" }, { id: "P1", step: "business", handedOverAt: null }, 1);
    await Promise.resolve();
    expect(useChat.getState().busy?.who).toBe("assistant");
    release();
    await p;
    expect(useChat.getState().busy).toBeNull();
  });

  it("reads the kind of product from plain words", () => {
    expect(kindOf("a new idea")).toBe("new");
    expect(kindOf("we already have one running")).toBe("existing");
    expect(kindOf("ein bestehendes Produkt")).toBe("existing");
    expect(kindOf("hmm")).toBeNull();
  });
});

describe("the office's flow", () => {
  const states = (s: Partial<Record<"brief" | "understood" | "questions" | "requirements" | "scope", ChecklistState>>) =>
    ({ brief: "later", understood: "later", questions: "later", requirements: "later", scope: "later", ...s }) as Record<"brief" | "understood" | "questions" | "requirements" | "scope", ChecklistState>;

  it("takes the analyst's checklist in order, and an item set aside waits until the rest is done", () => {
    const s = states({ brief: "open", understood: "open", questions: "now" });
    expect(analysisItemOf(s)).toBe("brief");
    expect(analysisItemOf(s, null, new Set(["brief"]))).toBe("understood");
    expect(analysisItemOf(s, null, new Set(["brief", "understood"]))).toBe("questions");
    // everything left was set aside: the item the project is at
    expect(analysisItemOf(states({ brief: "open", questions: "now" }), null, new Set(["brief", "questions"]))).toBe("questions");
    expect(analysisItemOf(states({ brief: "done", understood: "done", questions: "done", requirements: "done", scope: "done" }))).toBe("scope");
    // an item the person opened wins, unless it is not reached yet
    expect(analysisItemOf(s, "questions")).toBe("questions");
    expect(analysisItemOf(s, "scope")).toBe("brief");
    expect(analysisIndicator(s, "brief")).toEqual({ brief: "now", understood: "open", questions: "open", requirements: "later", scope: "later" });
  });

  it("makes the step list and Next for you say the same thing", () => {
    const words = {
      brief: { title: "Tell me the objective and who will use it", detail: "Two short answers." },
      understood: { title: "Check what I understood", detail: "Takes a minute." },
      questions: { title: "A few questions", detail: "One at a time." },
      requirements: { title: "Approve the requirements", detail: "Read them through." },
      scope: { title: "Lock the scope", detail: "Check, then lock." },
    };
    const next = { item: "questions" as const, title: "Answer 6 questions", detail: "One at a time; you can leave any for later." };
    // the conversation asks the objective: Next for you says so, not "Answer 6 questions"
    expect(nextForItem("brief", next, words)).toEqual(words.brief);
    expect(nextForItem("questions", next, words)).toEqual({ title: "Answer 6 questions", detail: next.detail });
    expect(nextForItem("requirements", { item: null, title: "Nothing for you right now", detail: "I'm writing the requirements…", working: true }, words).detail).toBe("I'm writing the requirements…");
    expect(nextForItem("requirements", { item: "requirements", title: "Approve the requirements", detail: "x", blockedBecause: "Review the design." }, words).detail).toBe("Review the design.");
  });

  it("shows Project Setup's checklist the way the setup page counts it", () => {
    expect(setupStates({ ask: "name", created: false, codeDone: false, shared: 0, handedOver: false })).toEqual({ about: "now", where: "later", share: "later", handOver: "later" });
    expect(setupStates({ ask: "material", created: true, codeDone: true, shared: 0, handedOver: false })).toEqual({ about: "done", where: "done", share: "now", handOver: "later" });
    expect(setupStates({ ask: "handOver", created: true, codeDone: true, shared: 2, handedOver: false })).toEqual({ about: "done", where: "done", share: "done", handOver: "now" });
    // the visitor went past Material ("No files for now"): skipped, not still to do
    expect(setupStates({ ask: "handOver", created: true, codeDone: true, shared: 0, handedOver: false }).share).toBe("skipped");
    expect(setupStates({ ask: null, created: true, codeDone: true, shared: 0, handedOver: true }).share).toBe("skipped");
  });

  it("resumes where the records are, and leaving lands on the same step's page", () => {
    const draft = useVisit.getState().draft;
    const setup: FlowProject = { id: "P1", step: "business", handedOverAt: null };
    expect(setupAskOf(draft, setup, 0, false)).toBe("material");
    expect(setupAskOf(draft, setup, 3, false)).toBe("handOver");
    expect(setupAskOf(draft, { ...setup, step: "sanitization", handedOverAt: "2026-11-09" })).toBeNull();
    expect(phaseOfProject(null)).toBe("setup");
    expect(phaseOfProject({ ...setup, step: "requirements" })).toBe("analysis");
    expect(phaseOfProject({ ...setup, step: "board" })).toBe("engineering");
    expect(leaveUrl(null)).toBe("/new");
    expect(leaveUrl(setup)).toBe("/p/P1/business");
    expect(leaveUrl({ ...setup, step: "scope" })).toBe("/p/P1/analysis");
    expect(leaveUrl({ ...setup, step: "board" })).toBe("/p/P1/build");
    expect(resumeIdOf("?project=AB12-cd")).toBe("AB12-cd");
    expect(resumeIdOf("?project=../x")).toBeNull();
    const list = continuable([
      { id: "a", step: "business", handedOverAt: null, lastUpdatedDate: "2026-11-01" },
      { id: "b", step: "board", handedOverAt: "x", lastUpdatedDate: "2026-11-09" },
      { id: "c", step: "requirements", handedOverAt: "x", lastUpdatedDate: "2026-11-08" },
      { id: "d", step: "scope", handedOverAt: "x", lastUpdatedDate: "2026-11-07", status: "deleting" },
    ]);
    expect(list.map((p) => p.id)).toEqual(["c", "a"]);
  });
});
