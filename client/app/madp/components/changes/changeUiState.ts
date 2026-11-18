import { create } from "zustand";
import type { Lane, TargetType } from "@/madp/data/changes";

export interface ChangeTarget { type: TargetType; id: string; title: string; text: string }

export type ChangeOpen = { lane: Lane; target: ChangeTarget | null; origin: ChangeTarget | null; draftId: string | null };

interface ChangeUiState {
  open: ChangeOpen | null;
  /** The change number the person closed while ?change=<number> was still in the URL; it must not reopen. */
  dismissed: number | null;
}

/** The open panel and the dismissed change number. Pure UI state: no local store, so the Blocks panel can use it. */
export const useChangeUi = create<ChangeUiState>(() => ({ open: null, dismissed: null }));

export function parseChangeParam(param: string | null): number | null {
  if (param === null || !/^\d+$/.test(param)) return null;
  return Number(param);
}

export function closeChangeRequest() {
  useChangeUi.setState({ open: null });
}

/** The person's close: closes the panel and remembers the URL's change number in one update, so it does not reopen. */
export function dismissChangeRequest(number: number | null) {
  useChangeUi.setState({ open: null, dismissed: number });
}
