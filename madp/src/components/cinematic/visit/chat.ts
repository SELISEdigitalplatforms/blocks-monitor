/** The office conversation: what the MADP Assistant and the business analyst say (each line is "thought" for a moment,
 *  then spoken: it streams into a speech bubble beside their head), what you said (shown for a moment as your own
 *  line), and the thinking state for as long as the other side is really working (an op in flight: `busy`; an engine
 *  job the records show running: `working`). A speaker's lines of one turn share one bubble (`bubble`, up to a few
 *  sentences); your answer closes it. The same words are never said twice in a row by the same person. The whole
 *  thread stays for the transcript. The input reads what the current step wants from it (`composer`).
 *  No React here (zustand only): the steps' talk and the 3D scene read the same store.
 *  Speed: a line is thought for 0.25-0.8 s and streams at 70 characters a second; reduced motion shows it at once. */
import { create } from "zustand";

export type Who = "assistant" | "pm";
export type From = Who | "you";

export interface ChatMessage {
  id: number;
  from: From;
  text: string;
  /** when the words started to stream (performance.now()) and how long they take; 0: shown at once */
  startedAt: number;
  ms: number;
  /** "error": something did not work (friendly words, said by the guide) */
  tone?: "error";
}

/** A quick reply under the thread: an answer to pick, or the step's action. */
export interface Reply {
  id: string;
  label: string;
  /** the step's main action (one at a time) */
  primary?: boolean;
  /** a short line under the label */
  hint?: string;
  disabled?: boolean;
  /** a secondary way out ("Later", "Not sure"): shown quietly after the answers */
  quiet?: boolean;
}

/** What the current step wants from the composer. */
export interface ComposerSpec {
  /** "text": the field takes the answer; "none": the answers are the quick replies (the field stays closed) */
  mode: "text" | "none";
  label: string;
  placeholder?: string;
  multiline?: boolean;
  maxLength?: number;
  replies?: Reply[];
  /** quick replies that add to the typed answer (several can be picked; Send answers) instead of answering */
  repliesAdd?: boolean;
  /** a quick reply was picked (`typed`: what is in the field at that moment, e.g. words for "Not sure") */
  onReply?: (id: string, typed: string) => void;
  onSend?: (text: string) => void;
  /** files can be attached (the paperclip, and dropping them anywhere on the office) */
  onFiles?: (files: File[]) => void;
  /** the field is closed: why, in plain words */
  closedBecause?: string;
}

export interface ChatState {
  messages: ChatMessage[];
  /** the speech bubble now: the current speaker's lines of this turn (ids into `messages`) */
  bubble: { who: Who; ids: number[] } | null;
  /** your last line, shown for a moment where you typed it */
  youLine: { id: number; text: string } | null;
  /** about to say something (a line is being typed) */
  typing: Who | null;
  /** working on what you asked (an op in flight): the typing indicator stays until it answers */
  busy: { who: Who; label: string | null } | null;
  /** working on their own for a while (an engine job the records show running: reading files, writing questions) */
  working: { who: Who; label: string } | null;
  /** the line streaming right now */
  streaming: { id: number; who: Who; until: number } | null;
  composer: ComposerSpec | null;
  /** you are typing an answer (the guide turns to listen) */
  youTyping: boolean;
  reduced: boolean;

  say: (who: Who, text: string, opts?: { key?: string; tone?: "error" }) => Promise<void>;
  you: (text: string) => void;
  whileBusy: <T>(who: Who, label: string | null, work: () => Promise<T>) => Promise<T>;
  setComposer: (spec: ComposerSpec | null) => void;
  setWorking: (w: { who: Who; label: string } | null) => void;
  setYouTyping: (on: boolean) => void;
  setReduced: (on: boolean) => void;
  /** a new visit (or another project): nothing of the last thread carries over, pending lines are dropped */
  reset: () => void;
  /** the line's key was said in this visit (a step that comes back does not repeat itself) */
  saidKey: (key: string) => boolean;
  /** An acknowledgement for an answer being saved ("Thank you."): the next turn says it before its own words (the
   *  saved records can bring the next question before the save's promise returns); `takeAck` hands it out once. */
  expectAck: (who: Who, text: string) => void;
  takeAck: () => { who: Who; text: string } | null;
}

/** characters a second while a line streams */
export const STREAM_CPS = 70;
export const typingMs = (text: string) => Math.min(800, Math.max(250, 180 + text.length * 5));
export const streamMs = (text: string) => Math.max(350, Math.round((text.length / STREAM_CPS) * 1000));

let nextId = 1;
let epoch = 0;
let queue: Promise<void> = Promise.resolve();
let busyCount = 0;
let ack: { who: Who; text: string } | null = null;
/** the bubble on screen: when it appeared and its words (a new bubble waits until it could be read) */
let shownBubble: { at: number; text: string } | null = null;
const said = new Set<string>();
/** each speaker's last words (never the same twice in a row) */
const lastWords: Partial<Record<Who, string>> = {};
/** a bubble holds a few sentences; a longer turn starts a new one */
export const BUBBLE_MAX = 170;
/** how long a bubble needs to be read (from when it appeared): a short line about 2 s, a long one up to 6 s */
export const readMs = (text: string) => Math.min(6000, 700 + text.trim().split(/\s+/).length * 230);
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const useChat = create<ChatState>()((set, get) => ({
  messages: [],
  bubble: null,
  youLine: null,
  typing: null,
  busy: null,
  working: null,
  streaming: null,
  composer: null,
  youTyping: false,
  reduced: false,

  say: (who, text, opts) => {
    const line = text.trim();
    if (!line) return Promise.resolve();
    if (opts?.key) {
      if (said.has(opts.key)) return Promise.resolve();
      said.add(opts.key);
    }
    // never the same words twice in a row (no loop of one canned line)
    if (lastWords[who] === line) return Promise.resolve();
    lastWords[who] = line;
    const e = epoch;
    const p = queue.then(async () => {
      if (e !== epoch) return;
      const reduced = get().reduced;
      // a new bubble replaces the one on screen only once that one could be read (your answer closes it at once)
      const st = get();
      const prev = st.messages[st.messages.length - 1];
      const joins = st.bubble?.who === who && prev?.from === who;
      if (!reduced && shownBubble && st.bubble && !joins) {
        const left = shownBubble.at + readMs(shownBubble.text) - now();
        if (left > 0) await wait(left);
        if (e !== epoch) return;
      }
      if (!reduced) {
        set({ typing: who });
        await wait(typingMs(line));
        if (e !== epoch) return;
      }
      const ms = reduced ? 0 : streamMs(line);
      const m: ChatMessage = { id: nextId++, from: who, text: line, startedAt: now(), ms, ...(opts?.tone ? { tone: opts.tone } : {}) };
      set((s) => {
        // the same speaker goes on in the same bubble while it has room and nobody else spoke
        const prev = s.messages[s.messages.length - 1];
        const room = s.bubble && s.bubble.who === who && prev?.from === who
          && s.messages.filter((x) => s.bubble!.ids.includes(x.id)).reduce((n, x) => n + x.text.length, 0) + line.length <= BUBBLE_MAX;
        shownBubble = room && shownBubble ? { at: shownBubble.at, text: `${shownBubble.text} ${line}` } : { at: m.startedAt, text: line };
        return {
          typing: null,
          messages: [...s.messages, m],
          bubble: room ? { who, ids: [...s.bubble!.ids, m.id] } : { who, ids: [m.id] },
          streaming: ms ? { id: m.id, who, until: m.startedAt + ms } : s.streaming,
        };
      });
      if (!ms) return;
      await wait(ms);
      if (e !== epoch) return;
      set((s) => (s.streaming?.id === m.id ? { streaming: null } : {}));
    });
    queue = p.catch(() => undefined);
    return p;
  },

  you: (text) => {
    const t = text.trim();
    if (!t) return;
    const id = nextId++;
    // your answer closes the speaker's bubble; your own line shows for a moment
    shownBubble = null;
    set((s) => ({ messages: [...s.messages, { id, from: "you", text: t, startedAt: now(), ms: 0 }], youTyping: false, bubble: null, youLine: { id, text: t } }));
  },

  whileBusy: async (who, label, work) => {
    const e = epoch;
    busyCount++;
    set({ busy: { who, label } });
    try {
      return await work();
    } finally {
      busyCount = Math.max(0, busyCount - 1);
      if (e === epoch && busyCount === 0) set({ busy: null });
    }
  },

  setComposer: (spec) => set({ composer: spec }),
  setWorking: (w) => {
    const cur = get().working;
    if (cur?.who === w?.who && cur?.label === w?.label) return;
    set({ working: w });
  },
  setYouTyping: (on) => { if (get().youTyping !== on) set({ youTyping: on }); },
  setReduced: (on) => { if (get().reduced !== on) set({ reduced: on }); },

  reset: () => {
    epoch++;
    busyCount = 0;
    queue = Promise.resolve();
    said.clear();
    ack = null;
    shownBubble = null;
    delete lastWords.assistant;
    delete lastWords.pm;
    set({ messages: [], bubble: null, youLine: null, typing: null, busy: null, working: null, streaming: null, composer: null, youTyping: false });
  },

  saidKey: (key) => said.has(key),
  expectAck: (who, text) => { ack = { who, text }; },
  takeAck: () => { const a = ack; ack = null; return a; },
}));

/** After a save: the acknowledgement, unless the next turn already said it (`ok` false: the save failed, drop it). */
export function settleAck(ok: boolean): void {
  const a = useChat.getState().takeAck();
  if (a && ok) void useChat.getState().say(a.who, a.text);
}

/** Who the typing indicator shows (a line being typed wins over work in flight, which wins over work of their own),
 *  or null, and what they are doing in plain words (null: just typing). */
export function typingOf(s: Pick<ChatState, "typing" | "busy" | "working">): { who: Who; label: string | null } | null {
  if (s.typing) return { who: s.typing, label: null };
  if (s.busy) return s.busy;
  return s.working;
}

/** The words of a message shown `t` ms after it started streaming (word by word; all of it once done). */
export function shownWords(m: Pick<ChatMessage, "text" | "ms">, t: number): string {
  if (m.ms <= 0 || t >= m.ms) return m.text;
  const n = Math.floor((Math.max(0, t) / m.ms) * m.text.length);
  const cut = m.text.slice(0, n);
  const sp = cut.lastIndexOf(" ");
  return sp > 0 ? cut.slice(0, sp) : "";
}
