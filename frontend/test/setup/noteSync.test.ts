// An open note shows a change made elsewhere (the guided start rewriting the Project brief, an added finding, a rename
// from the tree) unless the editor has edits of its own to keep.
import { describe, expect, it } from "vitest";
import { adoptStoredNote } from "../../src/components/business/noteSync";

const idle = { status: "saved" as const, unsaved: false };
const T1 = "2026-11-08T10:00:00.000Z";
const T2 = "2026-11-08T10:05:00.000Z";

describe("adoptStoredNote", () => {
  it("takes a newer stored version while nothing of the editor's own is waiting", () => {
    expect(adoptStoredNote({ editorUpdatedAt: T1, storedUpdatedAt: T2, autosave: idle })).toBe(true);
    expect(adoptStoredNote({ editorUpdatedAt: T1, storedUpdatedAt: T2, autosave: { status: "idle", unsaved: false } })).toBe(true);
  });

  it("does nothing when the stored version is the one the editor has (its own save included)", () => {
    expect(adoptStoredNote({ editorUpdatedAt: T2, storedUpdatedAt: T2, autosave: idle })).toBe(false);
    expect(adoptStoredNote({ editorUpdatedAt: T2, storedUpdatedAt: undefined, autosave: idle })).toBe(false);
  });

  it("never replaces unsaved, saving or failed edits (the stale-save banner handles those)", () => {
    expect(adoptStoredNote({ editorUpdatedAt: T1, storedUpdatedAt: T2, autosave: { status: "idle", unsaved: true } })).toBe(false);
    expect(adoptStoredNote({ editorUpdatedAt: T1, storedUpdatedAt: T2, autosave: { status: "saving", unsaved: false } })).toBe(false);
    expect(adoptStoredNote({ editorUpdatedAt: T1, storedUpdatedAt: T2, autosave: { status: "failed", unsaved: true } })).toBe(false);
  });

  it("never goes back to an older copy", () => {
    expect(adoptStoredNote({ editorUpdatedAt: T2, storedUpdatedAt: T1, autosave: idle })).toBe(false);
  });
});
