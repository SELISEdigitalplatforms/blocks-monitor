// Chat agents act through real, visible actions instead of promises (src/domain/chatActions.ts): what may be offered,
// the conversation a change request carries, the check of the agent's answer (no promised work, the system's own tap
// line, a known target), and the offer and confirmation messages as the chat reads them.
//   npx vitest run --config test/changes/vitest.config.ts test/changes/chatActions.test.ts
import { describe, expect, it } from "vitest";
import {
  ACTION_BUTTON,
  actionDoneLine,
  availableActions,
  changeDescription,
  isBareTrigger,
  offerKindOf,
  offerTarget,
  promisesIn,
  requestMessages,
  requestTitle,
  tapLine,
  type ActionState,
  type ThreadMessage,
} from "../../src/domain/chatActions";
import { acceptAgentAnswer, actionPrompt, offerRow, replySchema } from "../../server/local/engine/kinds/collab/actions.ts";
import { toAgentChat } from "../../src/blocks/collab/records";

const ME = "u-owner";
const at = (min: number) => new Date(Date.UTC(2026, 9, 31, 10, min)).toISOString();
const msg = (id: string, role: "user" | "agent", text: string, min: number, kind = "text", author = role === "user" ? ME : ""): ThreadMessage =>
  ({ id, role, kind, text, at: at(min), authorUserId: author });

// a conversation where the request is spread over several messages
const THREAD: ThreadMessage[] = [
  msg("m0", "user", "Hi", 0),
  msg("m1", "user", "i left a note on the header screen design, did you see it? I want that in the header", 1),
  msg("a1", "agent", "I can see the hero section of the landing page.", 2),
  msg("m2", "user", "wide header banner across the whole page with a soft scroll effect\nthis was my feedback, implement this", 3),
  msg("a2", "agent", "Understood.", 4),
  msg("m3", "user", "i need the new header on the start page only, do this right now", 5),
];

const STATE: ActionState = {
  released: true,
  scopeOpen: false,
  screens: [{ id: "s-hero", name: "Landing page" }],
  scopeItems: [],
  previews: [{ id: "ms-1", name: "Landing page live" }],
};

describe("what an agent may offer", () => {
  it("follows the project: change requests after a dev release, preview feedback on a ready preview, comments while the scope is open", () => {
    expect(availableActions(STATE)).toEqual(["change-request", "preview-fix"]);
    expect(availableActions({ ...STATE, released: false, previews: [], scopeOpen: true, scopeItems: [{ id: "f1", name: "Hero", type: "feature" }] })).toEqual(["update-design", "add-to-scope"]);
    expect(availableActions({ released: false, scopeOpen: false, screens: [], scopeItems: [], previews: [] })).toEqual([]);
  });

  it("an offer is a TaskTarget of its own, never mistaken for a created task", () => {
    expect(offerTarget("change-request")).toBe("offer:change-request");
    expect(offerKindOf("offer:update-design")).toBe("update-design");
    expect(offerKindOf("change-request")).toBeNull();
    expect(offerKindOf("offer:delete-everything")).toBeNull();
  });
});

describe("the conversation behind a request", () => {
  it("takes the person's recent messages, without small talk, up to the message that asks", () => {
    expect(requestMessages(THREAD, { upToId: "m3", authorUserId: ME }).map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(requestMessages(THREAD, { upToId: "m2", authorUserId: ME }).map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("stops at what the thread already recorded, and at another person's messages", () => {
    const t = [...THREAD.slice(0, 3), msg("t1", "agent", "CR-001 is saved: …", 2, "task-created"), ...THREAD.slice(3), msg("x1", "user", "Make the logo bigger", 6, "text", "u-other")];
    expect(requestMessages(t, { upToId: "m3", authorUserId: ME }).map((m) => m.id)).toEqual(["m2", "m3"]);
    expect(requestMessages(t, { upToId: "x1", authorUserId: ME }).map((m) => m.id)).toEqual(["m2", "m3"]);
  });

  it("titles the request from the message that says the most, not the bare 'do this right now'", () => {
    expect(isBareTrigger("do this right now")).toBe(true);
    expect(isBareTrigger("implement this")).toBe(true);
    expect(isBareTrigger("make the hero full width")).toBe(false);
    expect(requestTitle(["Make it full width", "do it now"])).toBe("Make it full width");
    expect(requestTitle(THREAD.filter((m) => m.role === "user" && m.id !== "m0").map((m) => m.text))).toBe("Wide header banner across the whole page with a soft scroll effect");
  });

  it("writes the description with the agent's words, the person's own messages, the item and the files", () => {
    const d = changeDescription({
      summary: "Make the landing page hero full width with a parallax background.",
      quotes: ["wide header banner across the whole page with a soft scroll effect\nthis was my feedback, implement this", "do this right now"],
      agent: "business analyst",
      about: "the “Landing page” screen",
      files: ["hero.png"],
    });
    expect(d).toBe([
      "Make the landing page hero full width with a parallax background.",
      "What was said in the chat with the business analyst:\n- “wide header banner across the whole page with a soft scroll effect this was my feedback, implement this”\n- “do this right now”",
      "About: the “Landing page” screen.",
      "Files from the chat: hero.png.",
    ].join("\n\n"));
    expect(changeDescription({ summary: "x".repeat(200), quotes: ["y".repeat(200)], agent: "business analyst", max: 120 }).length).toBeLessThanOrEqual(120);
  });
});

describe("the agent's answer", () => {
  const available = availableActions(STATE);

  it("never promises work: an answer that says it will add or did add something is refused (and retried)", () => {
    expect(promisesIn("So I'll add a new ticket for it: 'Make the hero full width with a parallax effect'.")).toHaveLength(1);
    expect(promisesIn("I've created a change request.")).toHaveLength(1);
    expect(promisesIn("Let me update the hero for you.")).toHaveLength(1);
    expect(promisesIn("I'll go into detail if you ask about a feature. The hero is in milestone 1.")).toHaveLength(0);
    expect(promisesIn(tapLine("change-request"))).toHaveLength(0);
    expect(() => acceptAgentAnswer({ answer: "Got it, I'll add a ticket to make the hero full width.", action: { kind: "none", title: "", details: "", target: "" } }, available, STATE))
      .toThrow(/promises work/);
  });

  it("with an action, ends with the system's own tap line and keeps the title and details", () => {
    const a = acceptAgentAnswer({
      answer: "Your comment asks for a full-width hero with a parallax effect. Tap the button below to go ahead.",
      action: { kind: "change-request", title: "Full-width hero with parallax", details: "Make the hero full width with a parallax background, as in the comment on the hero.", target: "" },
    }, available, STATE);
    expect(a.text).toBe(`Your comment asks for a full-width hero with a parallax effect. ${tapLine("change-request")}`);
    expect(a.text).toContain(`Tap “${ACTION_BUTTON["change-request"]}” and I'll save it as a change request and send it to the business analyst for analysis.`);
    expect(a.offer).toMatchObject({ kind: "change-request", title: "Full-width hero with parallax", target: null });
  });

  it("names a known target for preview feedback and comments, and offers only what is available", () => {
    const ok = acceptAgentAnswer({ answer: "The preview hero is boxed.", action: { kind: "preview-fix", title: "Full-width hero", details: "Make the hero full width.", target: "landing page live" } }, available, STATE);
    expect(ok.offer?.target).toEqual({ id: "ms-1", name: "Landing page live" });
    expect(() => acceptAgentAnswer({ answer: "The preview hero is boxed.", action: { kind: "preview-fix", title: "T", details: "D", target: "Nowhere" } }, available, STATE)).toThrow(/no known target/);
    // not available now: the answer stays, without an offer
    expect(acceptAgentAnswer({ answer: "The screen shows the hero.", action: { kind: "update-design", title: "T", details: "D", target: "Landing page" } }, available, STATE).offer).toBeNull();
  });

  it("the prompt carries the hard rule and only the available actions; the schema enumerates them", () => {
    const text = actionPrompt(available, STATE);
    expect(text).toMatch(/^Hard rules: you cannot add, create, change/);
    expect(text).toContain('"change-request"');
    expect(text).not.toContain('"update-design"');
    const schema = replySchema(available, STATE) as { properties: { action: { properties: { kind: { enum: string[] }; target: { enum: string[] } } } } };
    expect(schema.properties.action.properties.kind.enum).toEqual(["none", "change-request", "preview-fix"]);
    expect(schema.properties.action.properties.target.enum).toEqual(["", "Landing page live"]);
    expect(actionPrompt([], STATE)).toContain('set action.kind to "none"');
  });
});

describe("the messages the chat reads", () => {
  it("an offer row is read as an offer under the answer; its confirmation as a created task with the new targets", () => {
    const a = acceptAgentAnswer({ answer: "The preview hero is boxed.", action: { kind: "preview-fix", title: "Full-width hero", details: "Make the hero full width.", target: "Landing page live" } }, availableActions(STATE), STATE);
    const row = { ItemId: "o1", ProjectId: "p1", ...offerRow("planner", a.offer!, { jobId: "j1", at: at(9) }) };
    const r = toAgentChat(row)!;
    expect(r.kind).toBe("text");
    expect(r.task).toBeNull();
    expect(r.offer).toEqual({ kind: "preview-fix", title: "Full-width hero", details: "Make the hero full width.", targetId: "ms-1", targetType: "", takenId: "", takenCode: "" });
    const done = toAgentChat({ ItemId: "c1", ProjectId: "p1", AgentRole: "planner", Role: "agent", Kind: "task-created", TaskTarget: "preview-fix", TaskId: "t9", TaskCode: "MF-9", TaskTitle: "Full-width hero", Text: actionDoneLine("preview-fix", { code: "MF-9", title: "Full-width hero" }), EngineJobId: "j1", At: at(10) })!;
    expect(done.task).toMatchObject({ target: "preview-fix", code: "MF-9" });
    expect(done.offer).toBeNull();
    expect(actionDoneLine("change-request", { code: "CR-002", title: "Full-width hero", submitted: true })).toBe("CR-002 is saved and sent for analysis: Full-width hero.");
  });
});

// ------------------------------------------------------------------ "use 3 parallel streams" to the tech lead

describe("the parallel streams from the chat", () => {
  it("reads the number a message asks for, and nothing from other messages", async () => {
    const { streamsAsked } = await import("../../src/domain/chatActions");
    expect(streamsAsked("use 3 parallel streams")).toBe(3);
    expect(streamsAsked("Can we use two parallel streams please?")).toBe(2);
    expect(streamsAsked("set parallel streams to 4")).toBe(4);
    expect(streamsAsked("Parallel streams: 1")).toBe(1);
    expect(streamsAsked("build 3 change requests in parallel")).toBe(3);
    expect(streamsAsked("build two changes side by side")).toBe(2);
    expect(streamsAsked("use 7 parallel streams")).toBeNull();
    expect(streamsAsked("How long until milestone 2 is done?")).toBeNull();
    expect(streamsAsked("Why do 3 tests fail?")).toBeNull();
  });

  it("is offered once change requests are built; its targets are the numbers; its confirmation", async () => {
    const { STREAM_TARGETS, streamsActionMade, streamsResultId } = await import("../../src/domain/chatActions");
    expect(availableActions({ ...STATE, streams: true })).toEqual(["change-request", "preview-fix", "parallel-streams", "continue-increments"]);
    expect(availableActions(STATE)).not.toContain("parallel-streams");
    expect(STREAM_TARGETS.map((t) => t.name)).toEqual(["1", "2", "3", "4", "5"]);
    expect(ACTION_BUTTON["parallel-streams"]).toBe("Set the parallel streams");
    expect(tapLine("parallel-streams")).toBe("Tap “Set the parallel streams” and I'll set how many independent change requests the team builds side by side (each still lands on development on its own).");
    expect(actionDoneLine("parallel-streams", { code: "3 streams", title: "", where: "3" })).toBe("Parallel streams set to 3: up to 3 independent change requests are built side by side; each still lands on development on its own.");
    expect(actionDoneLine("parallel-streams", { code: "1 stream", title: "", where: "1" })).toBe("Parallel streams set to 1: one change request is built at a time.");
    // the record op checks that the tap stored what was offered, by this person
    const at = "2026-11-09T10:00:00.000Z";
    const id = streamsResultId(3, at);
    expect(id).toBe(`streams-3-${Date.parse(at)}`);
    expect(streamsActionMade({ chosen: 3, by: ME, at }, { caller: ME, target: "3", resultId: id })).toBe(true);
    expect(streamsActionMade({ chosen: 3, by: "u-other", at }, { caller: ME, target: "3", resultId: id })).toBe(false);
    expect(streamsActionMade({ chosen: 2, by: ME, at }, { caller: ME, target: "3", resultId: id })).toBe(false);
    expect(streamsActionMade(null, { caller: ME, target: "3", resultId: id })).toBe(false);
    // an agent's answer may offer it with a number as its target
    const answer = acceptAgentAnswer({ answer: "Three independent ones can build side by side here.", action: { kind: "parallel-streams", title: "Use 3 parallel streams", details: "Up to 3 at a time.", target: "3" } }, ["parallel-streams"], { ...STATE, streams: true });
    expect(answer.offer).toMatchObject({ kind: "parallel-streams", target: { id: "3", name: "3" }, targetType: "" });
    expect(offerRow("dev", answer.offer!, { jobId: "j1", at })).toMatchObject({ TaskTarget: "offer:parallel-streams", TaskFeatureRef: "3" });
    expect(() => acceptAgentAnswer({ answer: "Sure.", action: { kind: "parallel-streams", title: "Use 9", details: "Nine.", target: "9" } }, ["parallel-streams"], { ...STATE, streams: true })).toThrow(/no known target/);
  });

  it("the tap sets it as the person (cr.parallelStreams), then records it in the thread", async () => {
    const { createActionFlow } = await import("../../src/blocks/collab/chatActions");
    const calls: Array<[string, string, Record<string, unknown>]> = [];
    const at = "2026-11-09T10:00:00.000Z";
    const states: string[] = [];
    let n = 0;
    const flow = createActionFlow({
      newId: () => `req-${++n}`,
      onState: (s) => states.push(s.phase),
      call: (async (fn: string, op: string, args: Record<string, unknown>) => {
        calls.push([fn, op, args]);
        if (op === "cr.parallelStreams") return { data: { streams: { v: 1, chosen: 3, suggested: 3, reason: "", by: ME, at } } };
        return { data: { message: null } };
      }) as never,
    }, { projectId: "p-1", agentRole: "dev", offerId: "o-1", offer: { kind: "parallel-streams", title: "Use 3 parallel streams", details: "Up to 3.", targetId: "3", targetType: "", takenId: "", takenCode: "" } });
    expect(await flow.run()).toBe(true);
    expect(calls).toEqual([
      ["delivery", "cr.parallelStreams", { projectId: "p-1", chosen: 3 }],
      ["collab", "agentChat.recordAction", { projectId: "p-1", agentRole: "dev", offerId: "o-1", resultId: `streams-3-${Date.parse(at)}` }],
    ]);
    expect(states.at(-1)).toBe("done");
  });
});

describe("continue with the next increment, from the chat", () => {
  it("its targets, its confirmation and the check of what the tap stored", async () => {
    const { CONTINUE_TARGETS, continueActionMade, continueResultId } = await import("../../src/domain/chatActions");
    expect(CONTINUE_TARGETS.map((t) => t.name)).toEqual(["on", "off"]);
    expect(ACTION_BUTTON["continue-increments"]).toBe("Change the setting");
    expect(actionDoneLine("continue-increments", { code: "On", title: "", where: "on" })).toBe("From now on the next increment of a change starts by itself once its checks pass on development.");
    expect(actionDoneLine("continue-increments", { code: "Off", title: "", where: "off" })).toBe("Every next increment waits for someone to start it again.");
    const at = "2026-11-09T10:00:00.000Z";
    const id = continueResultId(true, at);
    expect(continueActionMade({ on: true, by: ME, at }, { caller: ME, target: "on", resultId: id })).toBe(true);
    expect(continueActionMade({ on: false, by: ME, at }, { caller: ME, target: "on", resultId: id })).toBe(false);
    expect(continueActionMade({ on: true, by: "u-other", at }, { caller: ME, target: "on", resultId: id })).toBe(false);
  });

  it("the tap sets it as the person (cr.continueIncrements), then records it in the thread", async () => {
    const { createActionFlow } = await import("../../src/blocks/collab/chatActions");
    const calls: Array<[string, string, Record<string, unknown>]> = [];
    const at = "2026-11-09T10:00:00.000Z";
    let n = 0;
    const flow = createActionFlow({
      newId: () => `req-${++n}`,
      onState: () => undefined,
      call: (async (fn: string, op: string, args: Record<string, unknown>) => {
        calls.push([fn, op, args]);
        if (op === "cr.continueIncrements") return { data: { continueIncrements: { v: 1, on: true, by: ME, at } } };
        return { data: { message: null } };
      }) as never,
    }, { projectId: "p-1", agentRole: "dev", offerId: "o-2", offer: { kind: "continue-increments", title: "Continue", details: "On.", targetId: "on", targetType: "", takenId: "", takenCode: "" } });
    expect(await flow.run()).toBe(true);
    expect(calls).toEqual([
      ["delivery", "cr.continueIncrements", { projectId: "p-1", on: true }],
      ["collab", "agentChat.recordAction", { projectId: "p-1", agentRole: "dev", offerId: "o-2", resultId: `continue-on-${Date.parse(at)}` }],
    ]);
  });
});
