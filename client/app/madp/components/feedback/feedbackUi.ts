/** UI state of the feedback layer: which item's card is open, drafts and write notices. */
import { create } from "zustand";
import { targetKey, type FeedbackTargetType } from "@/madp/data/feedback";

export interface FeedbackTarget { type: FeedbackTargetType; id: string; title: string; base: string; locked: boolean; lockedNote: string }
export interface FeedbackNotice { tone: "ok" | "error"; text: string }

interface FeedbackUiState {
  open: FeedbackTarget | null;
  drafts: Record<string, string>;
  notices: Record<string, FeedbackNotice | undefined>;
}

export const useFeedbackUi = create<FeedbackUiState>(() => ({ open: null, drafts: {}, notices: {} }));

export const FEEDBACK_ITEM = "group/fb";
export const FEEDBACK_OPEN = "rounded-block !bg-accent/5 ring-2 ring-inset ring-accent/35";

export const feedbackButtonSelector = (key: string) => `[data-feedback-button='${CSS.escape(key)}']`;
export const feedbackItemSelector = (key: string) => `[data-feedback-item='${CSS.escape(key)}']`;

const keyOf = (t: Pick<FeedbackTarget, "type" | "id">) => targetKey(t.type, t.id);

export function openFeedback(t: FeedbackTarget) {
  const key = keyOf(t);
  useFeedbackUi.setState((s) => {
    const notices: Record<string, FeedbackNotice | undefined> = {};
    if (s.notices[key]) notices[key] = s.notices[key];
    return { open: t, notices };
  });
}

export function closeFeedback(opts?: { refocus?: boolean }) {
  const open = useFeedbackUi.getState().open;
  if (!open) return;
  useFeedbackUi.setState({ open: null });
  if (opts?.refocus === false) return;
  const key = keyOf(open);
  requestAnimationFrame(() => document.querySelector<HTMLElement>(feedbackButtonSelector(key))?.focus());
}

export function toggleFeedback(t: FeedbackTarget) {
  const open = useFeedbackUi.getState().open;
  if (open && keyOf(open) === keyOf(t)) closeFeedback();
  else openFeedback(t);
}

export function setDraft(key: string, text: string) {
  useFeedbackUi.setState((s) => ({ drafts: { ...s.drafts, [key]: text } }));
}

export function setNotice(key: string, notice: FeedbackNotice | null) {
  useFeedbackUi.setState((s) => ({ notices: { ...s.notices, [key]: notice ?? undefined } }));
}

export function useIsFeedbackOpen(type: FeedbackTargetType, id: string): boolean {
  const key = targetKey(type, id);
  return useFeedbackUi((s) => (s.open ? keyOf(s.open) === key : false));
}
