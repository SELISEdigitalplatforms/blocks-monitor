import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { settleAck, shownWords, streamMs, typingMs, typingOf, useChat } from "../../src/components/cinematic/visit/chat";
import { ackFor, quotable, resetAcks } from "../../src/components/cinematic/visit/acks";
import { intentOf } from "../../src/components/cinematic/visit/intent";
import { thinkingGlance } from "../../src/components/characters/controller";

const chat = () => useChat.getState();
const said = () => chat().messages.map((m) => `${m.from}: ${m.text}`);
const bubbleText = () => chat().messages.filter((m) => chat().bubble?.ids.includes(m.id)).map((m) => m.text);

beforeEach(() => {
  vi.useFakeTimers();
  chat().reset();
  chat().setReduced(false);
  resetAcks();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the office conversation: speech, not a chat log", () => {
  it("thinks a moment, then speaks each line into the speaker's bubble, one after the other", async () => {
    const a = chat().say("assistant", "Welcome to SELISE.");
    const b = chat().say("assistant", "What should we call it?");
    await vi.advanceTimersByTimeAsync(0);
    expect(typingOf(chat())).toEqual({ who: "assistant", label: null });
    await vi.advanceTimersByTimeAsync(typingMs("Welcome to SELISE."));
    expect(bubbleText()).toEqual(["Welcome to SELISE."]);
    expect(chat().streaming?.who).toBe("assistant");
    await vi.advanceTimersByTimeAsync(streamMs("Welcome to SELISE.") + typingMs("What should we call it?") + streamMs("What should we call it?"));
    await Promise.all([a, b]);
    // one turn of one speaker: one bubble
    expect(bubbleText()).toEqual(["Welcome to SELISE.", "What should we call it?"]);
    expect(chat().streaming).toBeNull();
  });

  it("closes the bubble when you answer, shows your line, and starts a new bubble for the next speaker", async () => {
    chat().setReduced(true);
    await chat().say("assistant", "What should we call it?");
    chat().you("Linky");
    expect(chat().bubble).toBeNull();
    expect(chat().youLine?.text).toBe("Linky");
    await chat().say("pm", "Hello, I'm your business analyst.");
    expect(chat().bubble?.who).toBe("pm");
    expect(bubbleText()).toEqual(["Hello, I'm your business analyst."]);
  });

  it("never says the same words twice in a row", async () => {
    chat().setReduced(true);
    await chat().say("pm", "Could you say a little more?");
    chat().you("later");
    await chat().say("pm", "Could you say a little more?");
    chat().you("later");
    await chat().say("pm", "Could you say a little more?");
    expect(said().filter((l) => l.startsWith("pm:"))).toEqual(["pm: Could you say a little more?"]);
  });

  it("reveals the words of a streaming line as they are said, whole words only", () => {
    const m = { text: "Tell me about the project", ms: 1000 };
    expect(shownWords(m, 0)).toBe("");
    expect(shownWords(m, 500)).toBe("Tell me");
    expect(shownWords(m, 1000)).toBe(m.text);
  });

  it("thinks for exactly as long as the work is in flight", async () => {
    let done = () => undefined as void;
    const work = chat().whileBusy("pm", "Reading your files", () => new Promise<void>((r) => { done = r; }));
    expect(typingOf(chat())).toEqual({ who: "pm", label: "Reading your files" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(typingOf(chat())?.who).toBe("pm");
    done();
    await work;
    expect(typingOf(chat())).toBeNull();
  });

  it("acknowledges an answer before the next question, never after it", async () => {
    chat().setReduced(true);
    chat().expectAck("pm", "Global users, noted.");
    const ack = chat().takeAck();
    if (ack) void chat().say(ack.who, ack.text);
    await chat().say("pm", "How will you know it worked?");
    settleAck(true);
    await vi.runAllTimersAsync();
    expect(said()).toEqual(["pm: Global users, noted.", "pm: How will you know it worked?"]);
  });

  it("starts a new visit clean: lines still waiting are dropped", async () => {
    void chat().say("assistant", "This line never shows.");
    chat().reset();
    await vi.advanceTimersByTimeAsync(5000);
    expect(chat().messages).toEqual([]);
    expect(chat().bubble).toBeNull();
  });
});

describe("what a reply means", () => {
  it("reads later, not sure, yes and no in English and German, and only when that is all the reply says", () => {
    expect(intentOf("later")).toBe("later");
    expect(intentOf("Skip.")).toBe("later");
    expect(intentOf("später")).toBe("later");
    expect(intentOf("not sure")).toBe("notSure");
    expect(intentOf("I don't know")).toBe("notSure");
    expect(intentOf("keine Ahnung")).toBe("notSure");
    expect(intentOf("ok")).toBe("yes");
    expect(intentOf("Yes please")).toBe("yes");
    expect(intentOf("passt")).toBe("yes");
    expect(intentOf("nein")).toBe("no");
    // answers stay answers
    expect(intentOf("later this year we launch in Zurich")).toBeNull();
    expect(intentOf("global users")).toBeNull();
    expect(intentOf("to shorten link fast")).toBeNull();
  });

  it("acknowledges what was said, short and varied, never the same words twice in a row", () => {
    const a = ackFor("users", "global users");
    expect(a).toMatch(/global users/i);
    const b = ackFor("answer", "Twice a week");
    const c = ackFor("answer", "Twice a week");
    expect(b).toMatch(/twice a week/i);
    expect(b).not.toBe(c);
    expect(ackFor("later")).not.toBe(ackFor("later"));
    // a long answer is not quoted back
    expect(quotable("x ".repeat(60))).toBeNull();
    expect(ackFor("answer", "word ".repeat(30))).not.toMatch(/word word/);
  });
});

describe("thinking, as people do", () => {
  it("glances down and aside for a moment and is back on the visitor within about a second, never a held profile", () => {
    expect(thinkingGlance(0)).toBe(0);
    expect(thinkingGlance(0.4)).toBe(1);
    expect(thinkingGlance(0.8)).toBeGreaterThan(0);
    expect(thinkingGlance(0.8)).toBeLessThan(1);
    expect(thinkingGlance(1.1)).toBe(0);
    // thinking for a long time: still looking at the visitor
    expect(thinkingGlance(5)).toBe(0);
    expect(thinkingGlance(60)).toBe(0);
  });
});
