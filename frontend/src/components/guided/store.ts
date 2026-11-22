/** The guided project start's state: open or not, the step, and the answers so far. The draft is kept per person in
 *  this browser (it survives a reload; a project is created only by the last step's button). Browser storage is a
 *  convenience here: without it the draft lives for this page only. */
import { create } from "zustand";
import { useSession } from "@/blocks/session";
import { EMPTY_ANSWERS, currentStepId, resumeStep, sanitiseAnswers, type StartAnswers, type StepId } from "@/domain/guidedStart";

interface Draft { v: 1; open: boolean; step: StepId; answers: StartAnswers; savedAt: string }

export interface GuidedState {
  /** Whose draft is loaded (the signed-in person's id), null before the first load. */
  owner: string | null;
  open: boolean;
  step: StepId;
  /** 1 = moving forward, -1 = going back (the direction of the step transition). */
  dir: 1 | -1;
  answers: StartAnswers;
  /** "create" = a new project (the draft is kept); "edit" = the answers of an existing project (Project setup page). */
  mode: "create" | "edit";
  /** Edit mode: the project whose answers are changed. */
  projectId: string | null;
}

const KEY = "madp.guided-start.v1:";

export const useGuidedStart = create<GuidedState>(() => ({ owner: null, open: false, step: "kind", dir: 1, answers: EMPTY_ANSWERS, mode: "create", projectId: null }));

function me(): string | null {
  try {
    return useSession.getState().profile?.userId || null;
  } catch {
    return null;
  }
}

function read(owner: string): Draft | null {
  try {
    const raw = localStorage.getItem(KEY + owner);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (d?.v !== 1) return null;
    const answers = sanitiseAnswers(d.answers);
    return { v: 1, open: d.open === true, step: currentStepId(d.step) ? resumeStep(currentStepId(d.step)!, answers) : "kind", answers, savedAt: String(d.savedAt ?? "") };
  } catch {
    return null;
  }
}

function write(s: GuidedState): void {
  if (!s.owner || s.mode === "edit") return;
  try {
    const draft: Draft = { v: 1, open: s.open, step: s.step, answers: s.answers, savedAt: new Date().toISOString() };
    localStorage.setItem(KEY + s.owner, JSON.stringify(draft));
  } catch {
    // storage blocked: the draft lives for this page only
  }
}

function clear(owner: string | null): void {
  if (!owner) return;
  try {
    localStorage.removeItem(KEY + owner);
  } catch {
    // nothing stored
  }
}

/** Loads the signed-in person's draft once (the host calls it): a draft left open reopens where it was. */
export function loadGuidedDraft(): void {
  const owner = me();
  if (!owner || useGuidedStart.getState().owner === owner) return;
  const d = read(owner);
  useGuidedStart.setState(d ? { owner, open: d.open, step: d.step, dir: 1, answers: d.answers, mode: "create", projectId: null }
    : { owner, open: false, step: "kind", dir: 1, answers: EMPTY_ANSWERS, mode: "create", projectId: null });
}

/** True when there are answers worth keeping (anything typed or chosen). */
export function hasAnswers(a: StartAnswers): boolean {
  return JSON.stringify(a) !== JSON.stringify(EMPTY_ANSWERS);
}

/** Opens the guided start: a saved draft continues where it was; `description` (Home's box) becomes the description. */
export function openGuidedStart(opts: { description?: string } = {}): void {
  if (useGuidedStart.getState().mode === "edit") reloadDraft();
  loadGuidedDraft();
  const s = useGuidedStart.getState();
  const text = opts.description?.trim() ?? "";
  const answers = text ? { ...s.answers, description: text } : s.answers;
  const next = { ...s, open: true, dir: 1 as const, answers };
  useGuidedStart.setState(next);
  write(next);
}

export function setAnswers(patch: Partial<StartAnswers>): void {
  const s = useGuidedStart.getState();
  // only an existing product has a website: switching to a new idea drops it
  const next = { ...s, answers: { ...s.answers, ...patch, ...(patch.kind === "new" ? { website: "" } : {}) } };
  useGuidedStart.setState(next);
  write(next);
}

export function goToStep(step: StepId, dir: 1 | -1): void {
  const s = useGuidedStart.getState();
  const next = { ...s, step, dir };
  useGuidedStart.setState(next);
  write(next);
}

/** Closes the guided start: `keep` saves the answers for next time, otherwise they are thrown away. */
export function closeGuidedStart(keep: boolean): void {
  const s = useGuidedStart.getState();
  if (s.mode === "edit") { reloadDraft(); return; }
  if (keep) {
    const next = { ...s, open: false };
    useGuidedStart.setState(next);
    write(next);
  } else {
    useGuidedStart.setState({ open: false, step: "kind", dir: 1, answers: EMPTY_ANSWERS });
    clear(s.owner);
  }
}

/** The project exists: the draft is done. */
export function finishGuidedStart(): void {
  closeGuidedStart(false);
}

/** Back to the person's new-project draft (closed), after editing an existing project's answers. */
function reloadDraft(): void {
  useGuidedStart.setState({ owner: null, open: false, mode: "create", projectId: null });
  loadGuidedDraft();
  useGuidedStart.setState({ open: false });
}

/** Opens the dialog over the Project setup page to change an existing project's answers, at one step. */
export function openGuidedEdit(projectId: string, answers: StartAnswers, step: StepId): void {
  loadGuidedDraft();
  useGuidedStart.setState({ open: true, mode: "edit", projectId, step, dir: 1, answers });
}
