/** How far the step on screen has got, for the journey bar (owner 08.11.2026: the progress lives in the sticky stepper,
 *  not in a second card on the page). A page that knows its own progress publishes it (Business Analysis: parts
 *  ready out of all parts); the journey bar shows it on that step's segment. Front end only, nothing is saved. */
import { useEffect } from "react";
import { create } from "zustand";
import type { Phase } from "@/domain/phases";

export interface PhaseProgress {
  projectId: string;
  phase: Phase;
  /** Done out of total (e.g. 2 of 9 parts ready). */
  done: number;
  total: number;
  /** How many items wait on the person right now (shown as "2 need you"). */
  needsYou: number;
}

interface Store {
  progress: PhaseProgress | null;
}

export const usePhaseProgressStore = create<Store>(() => ({ progress: null }));

/** The progress of one project's phase, or null when no page published it. */
export function usePhaseProgress(projectId: string, phase: Phase): PhaseProgress | null {
  return usePhaseProgressStore((s) => (s.progress && s.progress.projectId === projectId && s.progress.phase === phase ? s.progress : null));
}

/** What the store holds once a page publishes `p`: the new progress, none (null: the page has no progress to show),
 *  or, while the page is still loading (undefined), what it last published. */
export function publishedAfter(current: PhaseProgress | null, p: PhaseProgress | null | undefined): PhaseProgress | null {
  return p === undefined ? current : p;
}

/** A page publishes its progress while it is open (undefined while it loads). The last value stays when the page
 *  closes, so the journey bar looks the same on every page of the project instead of the percentage showing only on
 *  that step's own page (owner 09.11.2026); the page refreshes it whenever it is open again. The bar shows it only for
 *  the same project and only on the step the project is on now (ProjectNav progressOfNow). */
export function usePublishPhaseProgress(p: PhaseProgress | null | undefined): void {
  const key = p === undefined ? "loading" : p ? `${p.projectId}:${p.phase}:${p.done}:${p.total}:${p.needsYou}` : "";
  useEffect(() => {
    usePhaseProgressStore.setState((s) => ({ progress: publishedAfter(s.progress, p) }));
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

/** "22%" from done/total (0 when nothing is known). */
export function percentOf(p: Pick<PhaseProgress, "done" | "total">): number {
  return p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
}

/** Done reached total: every part is ready and the step can be locked (the bar says "Ready", not "100%"). */
export function isReady(p: Pick<PhaseProgress, "done" | "total">): boolean {
  return p.total > 0 && p.done >= p.total;
}

/** The percentage of a step still in progress: 99 at most (199 of 200 rounds to 100), so "100%" never shows before it is ready. */
export function inProgressPercent(p: Pick<PhaseProgress, "done" | "total">): number {
  return Math.min(99, percentOf(p));
}
