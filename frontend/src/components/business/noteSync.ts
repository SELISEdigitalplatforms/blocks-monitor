/** When an open note takes the stored version again (pure). The editor reads the note once when it opens; a later
 *  change by someone or something else (the guided start's answers rewriting the Project brief, an added finding, the
 *  business agent, a rename from the tree) must show in the open editor too, or the next autosave is refused as stale
 *  ("Someone else changed this note") for a change the person made themselves. It is taken only while the editor has
 *  nothing of its own to keep: no unsaved edits and no save on the way. */
import type { AutosaveSnapshot } from "./useAutosave";

export function adoptStoredNote(o: {
  /** The LastUpdatedDate the editor's text is based on (its last load or save). */
  editorUpdatedAt: string | undefined;
  /** The stored note's LastUpdatedDate as the cache has it now. */
  storedUpdatedAt: string | undefined;
  autosave: Pick<AutosaveSnapshot, "status" | "unsaved">;
}): boolean {
  if (!o.storedUpdatedAt || o.storedUpdatedAt === o.editorUpdatedAt) return false;
  if (o.autosave.unsaved || o.autosave.status === "saving" || o.autosave.status === "failed") return false;
  // an older copy (a read that started before the editor's own save landed) never replaces newer text
  if (o.editorUpdatedAt) {
    const mine = Date.parse(o.editorUpdatedAt);
    const stored = Date.parse(o.storedUpdatedAt);
    if (!Number.isNaN(mine) && !Number.isNaN(stored) && stored < mine) return false;
  }
  return true;
}
