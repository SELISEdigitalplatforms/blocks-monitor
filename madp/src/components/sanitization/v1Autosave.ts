// The Requirements v1 editor's autosave as seen from outside it: pure, no React. "Complete sanitization" makes it send
// what is waiting and waits for the answer. An editor that unmounts sends its pending autosave at once and stays
// registered, with its text, until the save settled or a new editor adopts it.
import { hasUnsaved, unsavedItems, type Draft, type UnsavedItem } from "./requirementsDraft";

export interface V1EditorHandle {
  /** Sends what is waiting now (no 800 ms delay) and resolves once nothing of this editor is on the wire. */
  flushNow(): Promise<void>;
  /** The editor's draft as it stands, or null while it loads. */
  draft(): Draft | null;
  /** Saved requirement ids removed in the editor whose removal the server has not confirmed yet. */
  removed(): readonly string[];
  /** True while a save (or the re-read after it) of this editor is on the wire. */
  busy(): boolean;
}

interface Entry { handle: V1EditorHandle; retired: boolean }

const editors = new Map<string, Entry>();

export function registerV1Editor(projectId: string, handle: V1EditorHandle): void {
  editors.set(projectId, { handle, retired: false });
}

export function retireV1Editor(projectId: string, handle: V1EditorHandle): void {
  const entry = editors.get(projectId);
  if (!entry || entry.handle !== handle) return;
  entry.retired = true;
  const drop = () => {
    if (editors.get(projectId) !== entry || handle.busy()) return;
    const draft = handle.draft();
    if (draft === null || !hasUnsaved(draft, handle.removed())) editors.delete(projectId);
  };
  let flush: Promise<void>;
  try { flush = Promise.resolve(handle.flushNow()); } catch { flush = Promise.resolve(); }
  flush.catch(() => undefined).then(drop);
  drop();
}

export function hasV1Leftover(projectId: string): boolean {
  return editors.get(projectId)?.retired === true;
}

export async function takeV1Leftover(projectId: string): Promise<V1EditorHandle | null> {
  const entry = editors.get(projectId);
  if (!entry || !entry.retired) return null;
  try { await entry.handle.flushNow(); } catch { /* the leftover is handed over as it is */ }
  if (editors.get(projectId) === entry) editors.delete(projectId);
  return entry.handle;
}

/** Sends what is waiting and waits; never rejects. Returns what is still unsaved afterwards. */
export async function settleV1Autosave(projectId: string): Promise<UnsavedItem[]> {
  const entry = editors.get(projectId);
  if (!entry) return [];
  try { await entry.handle.flushNow(); } catch { /* what is left shows in the result */ }
  const handle = editors.get(projectId)?.handle ?? entry.handle;
  const draft = handle.draft();
  return draft ? unsavedItems(draft, handle.removed()) : [];
}

/** The id of the field to link to for an unsaved item, or null when there is none. */
export function v1FieldId(item: UnsavedItem): string | null {
  if (item.kind === "objective") return "v1-objective";
  if (item.kind === "requirement") return "v1-req-" + item.localKey;
  return null;
}

export function resetV1Autosave(): void {
  editors.clear();
}
