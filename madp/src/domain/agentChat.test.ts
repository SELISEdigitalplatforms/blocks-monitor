// The agent chat's routing: only pure small talk is answered at once; every real question goes to the engine (Claude).
import { describe, expect, it } from "vitest";
import { classifyIntent, factsFrom, handoffReply, HUMAN_ROLE, smallTalkReply, topicOf, type ChatRecords } from "./agentChat";
import { statusLine } from "../components/office/chat/persona";

describe("agent chat routing", () => {
  it("sends real questions to the engine, whatever words they use", () => {
    for (const q of [
      "Which ticket should go first in milestone 1, and why?",
      "What does the reviewer check?",
      "What are you working on?",
      "Any blockers?",
      "Where are we with the release?",
      "Hi, which step is the project at?",
      "Thanks! What is the plan for next week?",
      "Can you show me the open tickets?",
      "Tell me about the payouts feature",
    ]) {
      expect(classifyIntent(q)).toBe("conversation");
      expect(topicOf(q)).toBeNull();
    }
  });

  it("answers only pure small talk at once", () => {
    expect(topicOf("Hi")).toBe("greeting");
    expect(topicOf("hello there!")).toBe("greeting");
    expect(topicOf("Good morning, Planner")).toBe("greeting");
    expect(topicOf("Thanks!")).toBe("thanks");
    expect(topicOf("ok, thank you very much")).toBe("thanks");
    expect(topicOf("I have a task for you")).toBe("task-hint");
    expect(smallTalkReply("greeting", { role: "planner", projectName: "Marketplace", n: 0 })).toMatch(/^Hi! I'm the business analyst on Marketplace\./);
    expect(smallTalkReply("greeting", { role: "dev", projectName: "Marketplace", n: 0 })).toMatch(/^Hi! I'm the tech lead on Marketplace\./);
    expect(smallTalkReply("greeting", { role: "qa", projectName: "Marketplace", n: 0 })).toMatch(/^Hi! I'm the QA engineer on Marketplace\./);
    expect(smallTalkReply("task-hint", { role: "dev", projectName: "Marketplace", n: 0 })).toMatch(/hand it to the business analyst/);
    expect(topicOf("Hi business analyst")).toBe("greeting");
    expect(topicOf("Thanks, tech lead!")).toBe("thanks");
    expect(HUMAN_ROLE.planner).toBe("Business analyst");
    expect(HUMAN_ROLE.dev).toBe("Tech lead");
    expect(handoffReply("reviewer")).toBe("That's a task: I'm handing it to the business analyst so it goes through MADP.");
  });

  it("still records requests as tasks", () => {
    expect(classifyIntent("Add a wishlist to the product page")).toBe("task");
    expect(classifyIntent("Can you add a dark mode?")).toBe("task");
  });

  it("takes a go-ahead or a request in other words as a task, but not a question about the work", () => {
    for (const t of [
      "wide header banner across the whole page with a soft scroll effect\nthis was my feedback, implement this",
      "i need the new header on the start page only, do this right now",
      "Do this right now",
      "please change the footer colour to blue",
      "Please, change the logo",
      "This was my feedback: a bigger logo",
      "ok, do it",
      "Go ahead and add the banner",
    ]) expect([t, classifyIntent(t)]).toEqual([t, "task"]);
    for (const t of [
      "i left a note on the header screen design, did you see it? I want that in the header",
      "I don't know how to do this",
      "Did you do this?",
      "Nobody can do it",
      "How do I do this",
      "Who will build it",
      "Why didn't you implement this",
      "That is what I want, thanks",
    ]) expect([t, classifyIntent(t)]).toEqual([t, "conversation"]);
  });
});

const records = (columns: string[], build: string | null): ChatRecords => ({
  project: { name: "Marketplace", stage: "board", resumeTo: null, scopeLockedAt: "x" },
  lockedVersion: { number: 1 },
  features: [],
  milestones: [{ id: "m1", title: "Upload and sell", status: "planned", order: 1 }],
  tickets: columns.map((c, i) => ({ number: i + 1, title: `Ticket ${i + 1}`, agentRole: c === "planned" ? "planner" : c === "dev" ? "dev" : "shipper", column: c, milestoneId: "m1", isDone: c === "done" })),
  changeRequests: [],
  releases: [],
  jobs: build ? [{ id: "j", kind: "build.run", status: build, progress: 40, targetId: "", createdAt: "2026-10-31T10:00:00Z" }] : [],
});

describe("agent status line", () => {
  it("never says an agent works on a ticket nobody started", () => {
    expect(statusLine(factsFrom(records(["planned", "planned", "planned"], null), "planner"))).toBe("3 tickets planned · not started yet");
    expect(statusLine(factsFrom(records(["planned", "planned"], null), "dev"))).toBe("Waiting for the first build");
  });

  it("names the ticket in work while a build runs", () => {
    const f = records(["done", "dev", "planned"], "running");
    expect(statusLine(factsFrom(f, "dev"))).toBe("Working on MF-2 · Ticket 2");
    expect(statusLine(factsFrom(f, "planner"))).toBe("Build running at 40 % · 1 of 3 tickets done");
    expect(statusLine(factsFrom(records(["done", "dev"], "failed"), "dev"))).toBe("MF-2 waits for the next build · Ticket 2");
  });
});
