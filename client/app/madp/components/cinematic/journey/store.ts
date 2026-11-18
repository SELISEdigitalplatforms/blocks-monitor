/** The visit's state machine. One script runner walks the nodes: it walks to a node's place when it changes (lines
 *  said on the way become captions), lets the business analyst join when a node asks for it, speaks each line
 *  (thinking → streaming words → done), then waits for the answer. Restart, Skip and a new story bump `run`, so every
 *  pending timer of an older run is ignored.
 *
 *  Two modes:
 *  - "real" (the default): the person's own answers, saved as they are given to a real project through the ops the
 *    guided start and Project setup use (real.ts): the project is created once it has a name and an idea, the website
 *    becomes a note of its material, who it is for and the goal are saved as the guided start's answers, files are
 *    really uploaded into "Client documents" and the business agent is woken to read them. Every line about it says
 *    only what has really happened. At launch the visit opens the project's Project setup.
 *  - "story": the promo film's scripted story (stories.ts), only when asked for explicitly; front-end state only. */
import { create } from "zustand";
import { newRequestId } from "@/madp/blocks/fn";
import { isNotConfigured, messageFor, NOT_CONFIGURED_MESSAGE } from "@/madp/blocks/projects/messages";
import type { UploadPhase } from "@/madp/blocks/projects/upload";
import { PHASE_STEPS, phaseStep } from "@/madp/components/setup/shareModel";
import { t } from "@/madp/i18n";
import { walkMs, type StageId } from "./places";
import { buildRealScript, buildScript, codeAnswerText, GITHUB_ANSWER, isNotYet, notYet, type Answers, type Ask, type CardKind, type Node, type Speaker } from "./script";
import { countWord, DRIVER, filesReadLine, type Requirement, type Story } from "./stories";
import * as real from "./real";

export type { Requirement };

export type Phase = "intro" | "journey" | "handoff";
export type Mode = "real" | "story";

export interface ChatMsg { id: number; from: Speaker | "user"; text: string }
export interface Line { id: number; who: Speaker; text: string; startedAt: number; ms: number }
/** One file: progress 0…1 (story mode: a timed bar; real mode: the upload pipeline's honest steps) and, in real mode,
 *  the phase and why it failed. */
export interface UploadFile { name: string; progress: number; phase?: UploadPhase | "queued"; message?: string }
export type SaveState = "idle" | "saving" | "saved" | "failed";
/** The project the real visit creates: its id once project.create answered. */
export interface ProjectState { id: string | null; status: "none" | "creating" | "created" | "failed"; error: string | null }
/** The business agent's reading of the shared files (an EngineJob of kind setup.assist), as its rows say. */
export interface AgentState { state: "idle" | "reading" | "read" | "failed"; found: number }

/** speech pace: a steady 40 characters a second, revealed word by word; the mouth moves on the same clock */
export const CPS = 40;
export const lineMs = (text: string) => Math.max(700, Math.round((text.length / CPS) * 1000));

export interface JourneyState {
  phase: Phase;
  mode: Mode;
  stage: StageId;
  /** a walk in progress (camera and guides follow WALKS[to]); n changes per walk */
  walk: { to: StageId; n: number } | null;
  /** the business analyst ("pm"): n bumps when they walk in */
  pm: { present: boolean; joinN: number };
  /** the line being spoken (bubble or caption), kept up while its question waits */
  line: Line | null;
  thinking: Speaker | null;
  speaking: Speaker | null;
  messages: ChatMsg[];
  ask: Ask | null;
  askId: string | null;
  card: CardKind | null;
  answers: Answers;
  uploads: UploadFile[];
  reading: boolean;
  /** the visitor's real GitHub connection while they choose where the code lives (never simulated): set by the code
   *  card from the /api/github routes; "connected" carries the real login */
  github: "idle" | "connecting" | "connected";
  githubLogin: string | null;
  requirements: Requirement[];
  recording: boolean;
  transcript: boolean;
  /** the story this visit tells in story mode (its scripted answers, chips, files, repositories, questions, requirements) */
  story: Story;
  /** real mode: the project, the saves and the business agent */
  project: ProjectState;
  websiteSave: SaveState;
  answersSave: SaveState;
  agent: AgentState;
  /** real mode: saves that failed after their retries (shown before the hand-over) */
  problems: string[];
  /** remounts the guides on restart (their position snaps back) */
  resetN: number;
  /** story mode: a scripted text answer typed into the composer like a fast human (the composer runs it, off React state) */
  autotype: { text: string; n: number } | null;
  done: Partial<Record<StageId, boolean>>;

  start: () => void;
  answer: (value: string | string[]) => void;
  /** files given (chosen or dropped): uploaded for real in real mode, by name in story mode */
  answerFiles: (files: File[]) => void;
  setGithub: (state: JourneyState["github"], login?: string | null) => void;
  /** story mode: answers the open question with the story's scripted answer (the real office never answers for the person) */
  answerFromStory: () => void;
  /** a click on the 3D place that answers the open question (story mode: the scripted answer; real mode: only what is the
   *  person's own choice: open the file chooser, keep the code in MADP Factory, go on at launch) */
  hotspot: () => void;
  skip: () => void;
  restart: () => void;
  setRecording: (on: boolean) => void;
  setTranscript: (on: boolean) => void;
  setVisitorDefault: (name: string) => void;
  /** the workspace the real visit creates its project in */
  setWorkspace: (workspaceId: string) => void;
  /** the business agent's reading, as its EngineJob rows say (set by the page's watcher) */
  setAgent: (agent: AgentState) => void;
  /** project.create again after a failure (the same requestId: a create that did land is not made twice) */
  retryCreate: () => void;
  /** the real project's id once it exists and every save of the visit has settled */
  settled: () => Promise<string>;
  /** a story starts the visit over in story mode; null = the real office */
  setStory: (story: Story | null) => void;
}

const EMPTY: Answers = { visitor: "", name: "", about: "", website: "", audience: "", goal: "", files: [], code: "", repo: "", env: "", followups: [] };
/** "1 file" / "3 files", in the language shown. */
const filesCount = (n: number) => (n === 1 ? t("studio.cinematic.count.oneFile", "1 file") : t("studio.cinematic.count.files", "{count} files", { count: n }));

let run = 0;
let nodeIdx = 0;
let msgId = 1;
let walkN = 0;
let visitorDefault = "";
let workspaceId = "";
const realScript = () => buildRealScript({
  checkName: real.nameProblem,
  checkWebsite: (v) => (real.websiteOf(v) === null
    ? t("studio.cinematic.journey.notAWebsite", "That doesn't look like a web address. Try it like www.example.com, or choose “{notYet}”.", { notYet: notYet() })
    : null),
});
/** the default visit is the real office */
let script: Node[] = realScript();

/* real mode: the project of this visit and the saves that wait for it (generation changes on restart) */
let generation = 0;
let projectId: string | null = null;
let createRequest: string | null = null;
let waiters: ((id: string) => void)[] = [];
let chain: Promise<void> = Promise.resolve();
let folderId: Promise<string> | null = null;

const sleep = (ms: number, token: number) => new Promise<boolean>((r) => setTimeout(() => r(token === run), ms));
const whenProject = (): Promise<string> => (projectId ? Promise.resolve(projectId) : new Promise<string>((r) => waiters.push(r)));

export const useJourney = create<JourneyState>()((set, get) => {
  const push = (from: ChatMsg["from"], text: string) => set((s) => ({ messages: [...s.messages, { id: msgId++, from, text }] }));
  const real$ = () => get().mode === "real";
  const realAnswers = (): real.RealAnswers => {
    const a = get().answers;
    return { name: a.name, about: a.about, audience: a.audience, goal: a.goal };
  };

  async function say(who: Speaker, text: string, token: number, hold = 700): Promise<boolean> {
    set({ thinking: who });
    if (!(await sleep(Math.min(900, 380 + text.length * 5), token))) return false;
    const ms = lineMs(text);
    set({ thinking: null, speaking: who, line: { id: msgId, who, text, startedAt: performance.now(), ms } });
    push(who, text);
    if (!(await sleep(ms, token))) return false;
    if (get().speaking === who) set({ speaking: null });
    return sleep(hold, token);
  }

  async function walkTo(to: StageId, talk: string[], token: number): Promise<boolean> {
    const from = get().stage;
    if (from === to) return true;
    walkN++;
    set((s) => ({ stage: to, walk: { to, n: walkN }, card: null, line: null, done: { ...s.done, [from]: true } }));
    const total = walkMs(to);
    const t0 = performance.now();
    if (!(await sleep(600, token))) return false;
    for (const l of talk) if (!(await say("assistant", l, token, 500))) return false;
    const left = total - (performance.now() - t0);
    if (left > 0 && !(await sleep(left, token))) return false;
    set({ walk: null });
    return true;
  }

  async function pmJoin(token: number): Promise<boolean> {
    set((s) => ({ pm: { present: true, joinN: s.pm.joinN + 1 }, line: null }));
    if (!(await say("assistant", t("studio.cinematic.journey.analystJoins", "Ah, and here's our business analyst."), token, 400))) return false;
    return sleep(4200, token);
  }

  /* ── real mode: the project and its saves ─────────────────────────────── */

  function startCreate() {
    // the scripted story never creates a project: only the real office does, from the person's own answers
    if (!real$()) return;
    if (projectId || get().project.status === "creating") return;
    const gen = generation;
    createRequest ??= newRequestId();
    set({ project: { id: null, status: "creating", error: null } });
    real.createProject(workspaceId, realAnswers(), createRequest).then(
      (id) => {
        if (gen !== generation) return;
        projectId = id;
        set({ project: { id, status: "created", error: null } });
        const w = waiters;
        waiters = [];
        for (const f of w) f(id);
      },
      (e: unknown) => {
        if (gen !== generation) return;
        set({ project: { id: null, status: "failed", error: isNotConfigured(e) ? NOT_CONFIGURED_MESSAGE : messageFor(e) } });
      },
    );
  }

  /** A save that needs the project: one after the other, each tried three times (each op is keyed or overwrites). */
  function queueSave(label: string, task: (id: string) => Promise<void>, onState: (st: SaveState) => void): void {
    const gen = generation;
    onState("saving");
    const p = chain.then(() => whenProject()).then(async (id) => {
      if (gen !== generation) return;
      let last: unknown = null;
      for (let i = 0; i < 3; i++) {
        try {
          await task(id);
          if (gen === generation) onState("saved");
          return;
        } catch (e) {
          last = e;
          await new Promise((r) => setTimeout(r, 900 * (i + 1)));
        }
      }
      if (gen !== generation) return;
      onState("failed");
      set((s) => ({ problems: [...s.problems, `${label}: ${messageFor(last)}`] }));
    });
    chain = p.catch(() => undefined);
  }

  function saveAnswers() {
    queueSave(t("studio.cinematic.journey.saveAnswers", "Who it is for and the goal"), (id) => real.saveAnswers(workspaceId, id, realAnswers()), (st) => set({ answersSave: st }));
  }

  /** Files given in the meeting room: uploaded one after the other into "Client documents", then the business agent
   *  is woken to read them. The guide says only what really happened. */
  async function uploadFiles(files: File[], i: number, token: number) {
    const gen = generation;
    set({ uploads: files.map((f) => ({ name: f.name, progress: 0, phase: "queued" })), reading: false, card: "files" });
    if (!projectId && !(await say("assistant", t("studio.cinematic.journey.openingProject", "One moment, I'm opening the project for them."), token, 200))) return;
    const id = await whenProject();
    if (gen !== generation) return;
    const patch = (k: number, change: Partial<UploadFile>) => set((s) => ({ uploads: s.uploads.map((u, j) => (j === k ? { ...u, ...change } : u)) }));
    let folder: string | null = null;
    try {
      folderId ??= real.clientDocsFolder(workspaceId, id, newRequestId());
      folder = await folderId;
    } catch (e) {
      folderId = null;
      const message = messageFor(e);
      set((s) => ({ uploads: s.uploads.map((u) => ({ ...u, phase: "failed", message })) }));
    }
    let filed = 0;
    if (folder) {
      for (let k = 0; k < files.length; k++) {
        if (gen !== generation) return;
        const problem = await real.uploadFile(
          workspaceId,
          { projectId: id, folderId: folder, file: files[k], usedBytes: 0, fileCount: filed },
          (phase) => patch(k, { phase, progress: phaseStep(phase) / PHASE_STEPS }),
        );
        if (problem === null) {
          filed++;
          patch(k, { phase: "done", progress: 1 });
        } else patch(k, { phase: "failed", message: problem });
      }
    }
    if (gen !== generation) return;
    const failed = get().uploads.filter((u) => u.phase === "failed");
    let reading = false;
    if (filed > 0) {
      reading = await real.wakeAgent(workspaceId, id);
      if (gen !== generation) return;
      if (reading) set({ agent: { state: "reading", found: 0 } });
    }
    const one = files.length === 1;
    let line: string;
    const why = failed[0]?.message ?? "";
    if (filed === 0) {
      line = (one
        ? t("studio.cinematic.journey.fileNotUploaded", "That file didn't upload. {why} Try again, or go on without files for now.", { why })
        : t("studio.cinematic.journey.filesNotUploaded", "Those files didn't upload. {why} Try again, or go on without files for now.", { why })).replace(/\s+/g, " ");
    } else if (failed.length === 0) {
      line = one
        ? reading
          ? t("studio.cinematic.journey.fileFiledReading", "Got it. {name} is filed in your project, and our business agent starts reading it now.", { name: files[0].name })
          : t("studio.cinematic.journey.fileFiled", "Got it. {name} is filed in your project.", { name: files[0].name })
        : reading
          ? t("studio.cinematic.journey.filesFiledReading", "Got them. All {count} are filed in your project, and our business agent starts reading them now.", { count: countWord(filed) })
          : t("studio.cinematic.journey.filesFiled", "Got them. All {count} are filed in your project.", { count: countWord(filed) });
    } else {
      const names = failed.map((f) => f.name).join(", ");
      const params = { filed, total: files.length, names, why };
      line = failed.length === 1
        ? reading
          ? t("studio.cinematic.journey.someFiledReadingOne", "{filed} of {total} are filed and our business agent starts reading them. {names} couldn't be uploaded: {why} You can add it again in Project setup.", params)
          : t("studio.cinematic.journey.someFiledOne", "{filed} of {total} are filed. {names} couldn't be uploaded: {why} You can add it again in Project setup.", params)
        : reading
          ? t("studio.cinematic.journey.someFiledReading", "{filed} of {total} are filed and our business agent starts reading them. {names} couldn't be uploaded: {why} You can add them again in Project setup.", params)
          : t("studio.cinematic.journey.someFiled", "{filed} of {total} are filed. {names} couldn't be uploaded: {why} You can add them again in Project setup.", params);
    }
    if (!(await say("assistant", line, token))) return;
    if (filed === 0) {
      // the question stays open: try again, or no files for now
      set({ ask: script[i].ask ?? null, askId: script[i].id, card: "files" });
      return;
    }
    await runFrom(i + 1, token);
  }

  /** The business analyst's honest closing line: what the business agent has really done so far, and what comes next. */
  function pmNextLine(): string {
    const ag = get().agent;
    const filed = get().uploads.filter((u) => u.phase === "done").length;
    const later = t("studio.cinematic.journey.analysisLater", "When you start the analysis in Project setup, I'll go through all of it and come back with my first questions.");
    const one = filed === 1;
    if (ag.state === "read") {
      if (ag.found > 0) {
        const points = ag.found === 1 ? t("studio.cinematic.count.onePoint", "1 point") : t("studio.cinematic.count.points", "{count} points", { count: ag.found });
        return one
          ? t("studio.cinematic.journey.agentReadFileNoted", "Our business agent has read your file and noted {points} for you to look at. {later}", { points, later })
          : t("studio.cinematic.journey.agentReadFilesNoted", "Our business agent has read your files and noted {points} for you to look at. {later}", { points, later });
      }
      return one
        ? t("studio.cinematic.journey.agentReadFile", "Our business agent has read your file. {later}", { later })
        : t("studio.cinematic.journey.agentReadFiles", "Our business agent has read your files. {later}", { later });
    }
    if (ag.state === "reading") {
      return one
        ? t("studio.cinematic.journey.agentReadingFile", "Our business agent is still reading your file; what it finds will be waiting in Project setup. {later}", { later })
        : t("studio.cinematic.journey.agentReadingFiles", "Our business agent is still reading your files; what it finds will be waiting in Project setup. {later}", { later });
    }
    return later;
  }

  async function runFrom(i: number, token: number) {
    nodeIdx = i;
    const node = script[i];
    if (!node) return;
    if (!(await walkTo(node.stage, node.walkTalk?.(get().answers) ?? [], token))) return;
    if (node.pmJoins && !get().pm.present && !(await pmJoin(token))) return;
    if (!(await sleep(200, token))) return;
    const lines = node.say(get().answers);
    for (let k = 0; k < lines.length; k++) if (!(await say(node.speaker, lines[k], token, k === lines.length - 1 ? 200 : 600))) return;
    if (node.card === "summary") {
      set({ card: "summary" });
      if (!(await sleep(4200, token))) return;
      if (real$() && !(await say("pm", pmNextLine(), token, 600))) return;
      return runFrom(i + 1, token);
    }
    if (node.ask) set({ ask: node.ask, askId: node.id, card: node.card ?? get().card });
  }

  async function afterAnswer(i: number, value: string | string[], token: number) {
    const node = script[i];
    if (real$()) {
      if (node.id === "about") startCreate();
      if (node.id === "website" && get().answers.website) {
        const url = get().answers.website;
        const requestId = newRequestId();
        set({ card: "website" });
        queueSave(t("studio.cinematic.journey.saveWebsite", "The website"), (id) => real.saveWebsite(workspaceId, id, url, requestId), (st) => set({ websiteSave: st }));
      }
      if (node.id === "goal") saveAnswers();
      if (node.id === "files") {
        set({ card: null });
        if (!(await say("assistant", t("studio.cinematic.journey.noFilesReal", "No problem. You can add files any time in Project setup."), token))) return;
      }
      if (node.id === "github") {
        const a = get().answers;
        if (a.code === "github" && a.repo) {
          const login = a.repo.split("/")[0];
          let line: string;
          try {
            const id = await whenProject();
            const repo = await real.connectNewRepo(workspaceId, id, login, a.name);
            line = t("studio.cinematic.journey.repoConnected", "Connected. The private repository {repo} is created for you when the build starts.", { repo });
          } catch (e) {
            set((s) => ({ answers: { ...s.answers, code: "factory", repo: "" } }));
            line = t("studio.cinematic.journey.repoFailed", "GitHub couldn't be set for this project. {why} MADP Factory keeps the code for now; you can connect GitHub later in Project setup.", { why: messageFor(e) });
          }
          if (!(await say("assistant", line, token))) return;
        } else if (!(await say("assistant", t("studio.cinematic.script.factoryKeeps", "Done. MADP Factory keeps the code of {name} safe, and you can connect GitHub any time later.", { name: a.name.trim() || t("studio.cinematic.script.yourProject", "your project") }), token))) return;
      }
      if (node.id === "launch") {
        set((s) => ({ phase: "handoff", card: null, done: { ...s.done, buildfloor: true } }));
        return;
      }
      await runFrom(i + 1, token);
      return;
    }

    if (node.id === "website" && get().answers.website) set({ card: "website" });
    if (node.id === "files") {
      const names = Array.isArray(value) ? value : [];
      if (names.length) {
        set({ uploads: names.map((name) => ({ name, progress: 0 })), reading: true, card: "files" });
        for (let p = 1; p <= 24; p++) {
          if (!(await sleep(100, token))) return;
          set((s) => ({ uploads: s.uploads.map((f, k) => ({ ...f, progress: Math.min(1, (p / 24) * (1.3 - k * 0.12)) })) }));
        }
        set((s) => ({ reading: false, uploads: s.uploads.map((f) => ({ ...f, progress: 1 })) }));
        if (!(await say("assistant", filesReadLine(get().story, names), token))) return;
      } else {
        set({ card: null });
        if (!(await say("assistant", t("studio.cinematic.journey.noFilesStory", "No problem, we can add files any time."), token))) return;
      }
    }
    if (node.id === "f2") {
      if (!(await say("pm", t("studio.cinematic.journey.firstRequirements", "Perfect. These are your first requirements, up on the screen."), token, 200))) return;
      // they appear once: on the wall screen, one by one
      for (const r of get().story.requirements(get().answers.followups)) {
        if (!(await sleep(450, token))) return;
        set((s) => ({ requirements: [...s.requirements, r] }));
      }
      if (!(await sleep(1800, token))) return;
    }
    if (node.id === "launch") {
      set((s) => ({ phase: "handoff", card: null, done: { ...s.done, buildfloor: true } }));
      return;
    }
    await runFrom(i + 1, token);
  }

  const initial = () => ({
    phase: "intro" as Phase,
    stage: "reception" as StageId,
    walk: null,
    pm: { present: false, joinN: 0 },
    line: null,
    thinking: null,
    speaking: null,
    messages: [],
    ask: null,
    askId: null,
    card: null,
    answers: EMPTY,
    uploads: [],
    reading: false,
    github: "idle" as const,
    githubLogin: null,
    requirements: [],
    transcript: false,
    autotype: null,
    done: {},
    project: { id: null, status: "none" as const, error: null },
    websiteSave: "idle" as SaveState,
    answersSave: "idle" as SaveState,
    agent: { state: "idle" as const, found: 0 },
    problems: [],
  });

  /** a new visit: nothing of the last one's project carries over */
  const forgetProject = () => {
    generation++;
    projectId = null;
    createRequest = null;
    waiters = [];
    chain = Promise.resolve();
    folderId = null;
  };

  return {
    ...initial(),
    mode: "real",
    recording: false,
    story: DRIVER,
    resetN: 0,

    start: () => {
      if (get().phase !== "intro") return;
      set((s) => ({ phase: "journey", answers: s.mode === "real" ? { ...s.answers, visitor: visitorDefault } : s.answers }));
      void runFrom(0, run);
    },

    answer: (value) => {
      const node = script[nodeIdx];
      const s0 = get();
      if (!s0.ask || !node) return;
      // a typed answer the project can't keep: the guide says why and the question stays open
      const problem = typeof value === "string" ? node.check?.(value) ?? null : null;
      if (problem) {
        push("user", String(value));
        const token = run;
        const ask = s0.ask;
        const askId = s0.askId;
        set({ ask: null, askId: null, autotype: null });
        void say("assistant", problem, token, 200).then((ok) => { if (ok) set({ ask, askId }); });
        return;
      }
      const shown = Array.isArray(value) ? (value.length ? filesCount(value.length) : t("studio.cinematic.composer.noFiles", "No files for now"))
        : node.ask?.kind === "github" ? codeAnswerText(value) : value;
      const extra: Partial<Answers> = s0.mode === "real" && node.id === "website"
        ? { website: isNotYet(value) ? "" : real.websiteOf(String(value)) ?? "" }
        : {};
      set((s) => ({ ask: null, askId: null, line: null, autotype: null, answers: { ...s.answers, ...(node.apply?.(s.answers, value) ?? {}), ...extra } }));
      push("user", shown);
      void afterAnswer(nodeIdx, value, run);
    },

    answerFiles: (files) => {
      const s = get();
      const node = script[nodeIdx];
      if (!files.length || !s.ask || s.askId !== "files" || !node) return;
      if (s.mode === "story") { s.answer(files.map((f) => f.name)); return; }
      set((st) => ({ ask: null, askId: null, line: null, autotype: null, answers: { ...st.answers, files: files.map((f) => f.name) } }));
      push("user", files.length === 1 ? files[0].name : `${filesCount(files.length)}: ${files.map((f) => f.name).join(", ")}`);
      void uploadFiles(files, nodeIdx, run);
    },

    setGithub: (state, login = null) => set({ github: state, githubLogin: state === "connected" ? login : null }),

    answerFromStory: () => {
      const s = get();
      if (s.mode !== "story") return;
      if (s.phase === "intro") return s.start();
      const node = script[nodeIdx];
      if (!s.ask || !node) return;
      const value = node.id === "visitor" && visitorDefault ? visitorDefault : node.scripted;
      // a typed answer is typed into the composer; choices are picked at once
      if (typeof value === "string" && (node.ask?.kind === "text" || (node.ask?.freeText && !node.ask.chips?.includes(value)))) {
        set((st) => ({ autotype: { text: value as string, n: (st.autotype?.n ?? 0) + 1 } }));
        return;
      }
      s.answer(value);
    },

    hotspot: () => {
      const s = get();
      if (s.mode === "story") { s.answerFromStory(); return; }
      if (!s.ask) return;
      if (s.askId === "files") window.dispatchEvent(new Event("cine:pick-files"));
      else if (s.askId === "github") s.answer("factory");
      else if (s.askId === "launch") s.answer(s.ask.chips?.[0] ?? t("studio.cinematic.script.letsGo", "Let's go"));
    },

    /** Skip (story mode): answer the rest of this place with the story's answers and go on to the next place. The real office
     *  never answers for the person. */
    skip: () => {
      const s = get();
      if (s.phase === "intro") return s.start();
      if (s.phase !== "journey" || s.mode === "real") return;
      const cur = script[nodeIdx];
      if (!cur) return;
      run++;
      const token = run;
      let answers = s.answers;
      let i = nodeIdx;
      let reqs = s.requirements;
      let pmPresent = s.pm.present;
      while (script[i] && script[i].stage === cur.stage) {
        const n = script[i];
        const auto = n.id === "visitor" && visitorDefault ? visitorDefault : n.scripted;
        if (n.apply) answers = { ...answers, ...n.apply(answers, auto) };
        if (n.id === "f2") reqs = s.story.requirements(answers.followups);
        if (n.pmJoins) pmPresent = true;
        i++;
      }
      set((st) => ({
        ask: null, askId: null, line: null, thinking: null, speaking: null, card: null, walk: null,
        answers,
        requirements: reqs,
        pm: pmPresent && !st.pm.present ? { present: true, joinN: st.pm.joinN + 1 } : st.pm,
        uploads: cur.stage === "meeting" ? s.story.files.map((name) => ({ name, progress: 1 })) : st.uploads,
        reading: false,
      }));
      if (!script[i]) {
        set((st) => ({ phase: "handoff", done: { ...st.done, buildfloor: true } }));
        return;
      }
      void runFrom(i, token);
    },

    restart: () => {
      run++;
      nodeIdx = 0;
      forgetProject();
      set((s) => ({ ...initial(), resetN: s.resetN + 1 }));
    },

    setRecording: (on) => set({ recording: on }),
    setTranscript: (on) => set({ transcript: on }),
    setVisitorDefault: (name) => {
      visitorDefault = name;
      // the greeting is said once the visit starts; a name that arrives later still fills the wall screen's notes
      const s = get();
      if (s.mode === "real" && s.phase !== "intro" && !s.answers.visitor && name) set({ answers: { ...s.answers, visitor: name } });
    },
    setWorkspace: (ws) => { workspaceId = ws; },
    setAgent: (agent) => {
      const cur = get().agent;
      if (cur.state !== agent.state || cur.found !== agent.found) set({ agent });
    },
    retryCreate: () => {
      if (get().project.status === "failed") startCreate();
    },
    settled: async () => {
      const id = await whenProject();
      await chain;
      return id;
    },
    setStory: (story) => {
      const mode: Mode = story ? "story" : "real";
      const s = get();
      if (s.mode === mode && (!story || s.story === story)) return;
      run++;
      nodeIdx = 0;
      forgetProject();
      script = story ? buildScript(story) : realScript();
      set((st) => ({ ...initial(), mode, story: story ?? DRIVER, resetN: st.resetN + 1 }));
    },
  };
});

/** The answer a GitHub choice carries ("github:<login>"), re-exported for the code card. */
export { GITHUB_ANSWER };
