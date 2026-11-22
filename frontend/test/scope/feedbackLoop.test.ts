// The feedback → work loop on the Scope page: a screen redesigned from a comment says so on its card and can be
// compared with its previous version; the lock (and the requirements approval) warns about comments still under way.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  NO_PENDING_FEEDBACK, PENDING_WAITING_TITLE, PENDING_WORKING_TITLE, UNNAMED_ITEM, hasPendingFeedback, pendingFeedback,
} from "../../src/domain/pendingFeedback";
import { SCREEN_UPDATED_TEXT, SCREEN_WORKING_TEXT, screenFeedbackState } from "../../src/components/scope/DesignCard";
import { selectPreviousScreens, selectScreenVersions, screenVersionFromRow } from "../../src/blocks/scope/hooks";
import { LOCK_WAITING_NOTE, LOCK_WORKING_NOTE, LockDialogBody, scopeItemName } from "../../src/components/scope/blocks/LockDialog";
import { PendingFeedbackNote } from "../../src/components/step/PendingFeedbackNote";

const thread = (targetType: string, targetId: string, status: string) => ({ targetType, targetId, status });

describe("pending feedback before a sign-off", () => {
  const names: Record<string, string> = { "feature:f1": "Online shop", "feature:f2": "Checkout", "story:s1": "  ", "screen:x1": "Home screen" };
  const nameOf = (type: string, id: string) => names[`${type}:${id}`] ?? null;

  it("lists open and working threads as still being worked on, updated ones as waiting, by kind then name", () => {
    const p = pendingFeedback([
      thread("screen", "x1", "working"),
      thread("feature", "f2", "open"),
      thread("feature", "f1", "working"),
      thread("feature", "f3", "open"), // not in this scope version any more
      thread("story", "s1", "updated"),
      thread("feature", "f1", "resolved"),
      thread("requirement", "r1", "open"), // another step
    ], ["feature", "story", "screen"], nameOf);
    expect(p.working).toEqual(["Checkout", "Online shop", "Home screen"]);
    expect(p.waiting).toEqual([UNNAMED_ITEM]);
    expect(hasPendingFeedback(p)).toBe(true);
  });

  it("is empty without threads or with closed ones only", () => {
    expect(pendingFeedback(undefined, ["feature"], nameOf)).toBe(NO_PENDING_FEEDBACK);
    expect(hasPendingFeedback(pendingFeedback([thread("feature", "f1", "resolved")], ["feature"], nameOf))).toBe(false);
  });

  it("the note shows plain names, never ids", () => {
    const html = renderToStaticMarkup(createElement(PendingFeedbackNote, {
      pending: { working: ["Online shop"], waiting: ["Home screen"] }, workingNote: "w-note", waitingNote: "u-note",
    }));
    expect(html).toContain(PENDING_WORKING_TITLE);
    expect(html).toContain(PENDING_WAITING_TITLE);
    expect(html).toContain("Online shop");
    expect(html).toContain("w-note");
    expect(renderToStaticMarkup(createElement(PendingFeedbackNote, { pending: NO_PENDING_FEEDBACK, workingNote: "", waitingNote: "" }))).toBe("");
  });

  it("the lock dialog shows the warning", () => {
    const props = { counts: { features: 1, stories: 0, screens: 0 }, milestones: [], advisories: [], error: null };
    expect(renderToStaticMarkup(createElement(LockDialogBody, props))).not.toContain(PENDING_WORKING_TITLE);
    const html = renderToStaticMarkup(createElement(LockDialogBody, { ...props, feedback: { working: ["Checkout"], waiting: ["Expected users"] } }));
    expect(html).toContain(PENDING_WORKING_TITLE);
    expect(html).toContain(LOCK_WORKING_NOTE);
    expect(html).toContain(LOCK_WAITING_NOTE);
    expect(html).toContain("Checkout");
  });

  it("names scope items from the page's data", () => {
    const items = {
      features: [{ id: "f1", name: "Online shop" }],
      stories: [{ id: "s1", actor: "a shopper", text: "Pay by card" }],
      milestones: [{ id: "m1", number: 2, name: "" }],
      screens: [{ id: "x1", name: "Home", viewport: "mobile" }],
    };
    expect(scopeItemName(items, "feature", "f1")).toBe("Online shop");
    expect(scopeItemName(items, "story", "s1")).toBe("As a shopper, I can pay by card");
    expect(scopeItemName(items, "milestone", "m1")).toBe("Milestone 2");
    expect(scopeItemName(items, "screen", "x1")).toBe("Home screen on mobile");
    expect(scopeItemName(items, "success", "users")).toBe("Expected users");
    expect(scopeItemName(items, "success", "nope")).toBeNull();
    expect(scopeItemName(items, "feature", "gone")).toBeNull();
  });
});

describe("a screen redesigned from a comment", () => {
  it("the card says \"Updated\" only for a new version waiting for the person, and \"working\" while the designer is on it", () => {
    expect(screenFeedbackState(2, "updated")).toBe("updated");
    expect(screenFeedbackState(1, "updated")).toBeNull();
    expect(screenFeedbackState(3, "resolved")).toBeNull();
    expect(screenFeedbackState(1, "working")).toBe("working");
    expect(screenFeedbackState(null, null)).toBeNull();
    expect(SCREEN_UPDATED_TEXT).toBe("Updated from your comment");
    expect(SCREEN_WORKING_TEXT).toMatch(/designer is working/);
  });

  it("reads each screen's Key and Version", () => {
    expect(screenVersionFromRow({ ItemId: "a", Key: "home-desktop", Version: 3 })).toEqual({ key: "home-desktop", version: 3 });
    expect(screenVersionFromRow({ ItemId: "a", Key: "home-desktop" })).toEqual({ key: "home-desktop", version: 1 });
    expect(screenVersionFromRow({ ItemId: "a" })).toBeNull();
    expect(selectScreenVersions([{ ItemId: "a", Key: "k", Version: 2 }, { ItemId: "b" }]).get("a")).toEqual({ key: "k", version: 2 });
  });

  it("finds the newest older version of the same screen", () => {
    const row = (id: string, key: string, version: number, status = "superseded") =>
      ({ ItemId: id, Key: key, Name: "Home", Version: version, Status: status, ImageFileId: `file-${id}`, Width: 1440, Height: 900 });
    const prev = selectPreviousScreens([row("v1", "home", 1), row("v2", "home", 2), row("o1", "other", 1), row("cur", "home", 3, "generated")]);
    expect(prev.of({ key: "home", version: 3 })?.id).toBe("v2");
    expect(prev.of({ key: "home", version: 2 })?.id).toBe("v1");
    expect(prev.of({ key: "home", version: 1 })).toBeNull();
    expect(prev.of({ key: "missing", version: 2 })).toBeNull();
    expect(prev.of(undefined)).toBeNull();
  });
});
