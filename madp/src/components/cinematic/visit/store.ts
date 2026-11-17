/** The office visit's own state: only what has no record yet. Before the project exists, the guided start's answers
 *  (a draft, exactly as the New project dialog keeps one); then the project's id, and a few moments of the visit (the
 *  person went past Material, the item they opened, the files being uploaded, the sheets that are open). Everything
 *  else (the project's step, its material, the analysis) is read from the records with the app's own hooks. */
import { create } from "zustand";
import { EMPTY_ANSWERS, type StartAnswers } from "@/domain/guidedStart";
import type { AnalystItem, DocPart } from "@/components/analysis-next/model";
import type { UploadPhase } from "@/blocks/projects/upload";
import type { ItemState, OfficePhase, SetupDraft } from "./flow";

/** What the step indicator shows: the phase's checklist (ids; the labels are the app's own) and "Next for you". */
export interface Indicator {
  phase: OfficePhase;
  items: { id: string; state: ItemState }[];
  next: { title: string; detail: string } | null;
}

export interface UploadRow { name: string; phase: UploadPhase | "queued" | "done" | "failed"; message?: string }

export interface VisitState {
  /** past the welcome */
  started: boolean;
  projectId: string | null;
  draft: SetupDraft;
  /** project.create's request id: a retry of the same answers never makes a second project */
  createRequest: string | null;
  /** the person went past Material in this visit ("No files for now", or files filed) */
  materialPassed: boolean;
  /** the analyst's item the person opened from the step list (null: the one the checklist says) */
  picked: AnalystItem | null;
  /** analyst's items the person set aside in this visit ("later"): they wait until the rest is done */
  aside: AnalystItem[];
  uploads: UploadRow[];
  /** "Where should we keep the code?" (the guided start's own step) is open */
  whereOpen: boolean;
  /** the analysis, opened at a part */
  sheet: DocPart | null;
  /** the analysis opened to sign something off: the page's own approve card or lock card on top */
  sheetAction: "requirements" | "scope" | null;
  /** leaving for Software Engineering after the scope lock */
  toBuild: boolean;
  indicator: Indicator | null;

  start: () => void;
  setDraft: (patch: Partial<StartAnswers>, flags?: Partial<Omit<SetupDraft, "answers">>) => void;
  setProject: (id: string | null) => void;
  setCreateRequest: (id: string | null) => void;
  passMaterial: () => void;
  pick: (item: AnalystItem | null) => void;
  setAside: (item: AnalystItem) => void;
  setUploads: (rows: UploadRow[] | ((rows: UploadRow[]) => UploadRow[])) => void;
  openWhere: (open: boolean) => void;
  openSheet: (part: DocPart | null, action?: "requirements" | "scope" | null) => void;
  goBuild: () => void;
  setIndicator: (i: Indicator | null) => void;
  reset: () => void;
}

export const EMPTY_DRAFT: SetupDraft = { answers: EMPTY_ANSWERS, websiteDone: false, whereDone: false, aboutDone: false };

const initial = () => ({
  started: false,
  projectId: null,
  draft: EMPTY_DRAFT,
  createRequest: null,
  materialPassed: false,
  picked: null,
  aside: [] as AnalystItem[],
  uploads: [],
  whereOpen: false,
  sheet: null,
  sheetAction: null as "requirements" | "scope" | null,
  toBuild: false,
  indicator: null as Indicator | null,
});

export const useVisit = create<VisitState>()((set) => ({
  ...initial(),
  start: () => set({ started: true }),
  setDraft: (patch, flags) => set((s) => ({ draft: { ...s.draft, ...(flags ?? {}), answers: { ...s.draft.answers, ...patch } } })),
  setProject: (id) => set((s) => (s.projectId === id ? {} : { projectId: id, materialPassed: false, picked: null, aside: [], uploads: [], sheet: null, toBuild: false })),
  setCreateRequest: (id) => set({ createRequest: id }),
  passMaterial: () => set({ materialPassed: true }),
  pick: (item) => set({ picked: item }),
  setAside: (item) => set((s) => (s.aside.includes(item) ? { picked: s.picked === item ? null : s.picked } : { aside: [...s.aside, item], picked: s.picked === item ? null : s.picked })),
  setUploads: (rows) => set((s) => ({ uploads: typeof rows === "function" ? rows(s.uploads) : rows })),
  openWhere: (open) => set({ whereOpen: open }),
  openSheet: (part, action = null) => set({ sheet: part, sheetAction: part ? action : null }),
  goBuild: () => set({ toBuild: true }),
  setIndicator: (indicator) => set((s) => (JSON.stringify(s.indicator) === JSON.stringify(indicator) ? {} : { indicator })),
  reset: () => set(initial()),
}));
