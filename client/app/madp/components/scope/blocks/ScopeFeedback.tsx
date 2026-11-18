/** Feedback on Scope & success items (features, stories, screens, milestones, success & performance targets), the same
 *  way as on Goals & requirements: each item carries the shared FeedbackButton, which opens the one feedback card
 *  (FeedbackLayer) beside the item, with the same thread, states, counts and Resolve / Reopen. The writes go through the
 *  scope feedback ops (components/feedback/feedbackLanes.ts). The provider tells the items whether the scope is locked
 *  and mounts the card once for the page. */
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { FeedbackButton } from "@/madp/components/feedback/FeedbackButton";
import { FeedbackLayer } from "@/madp/components/feedback/FeedbackLayer";
import { scopeLockedMessage } from "@/madp/components/feedback/feedbackLanes";
import { feedbackItemSelector, openFeedback, type FeedbackTarget as CardTarget } from "@/madp/components/feedback/feedbackUi";
import { targetKey } from "@/madp/data/feedback";
import type { FeedbackTargetType } from "@/madp/domain/scopeFeedback";

export interface FeedbackTarget {
  type: FeedbackTargetType;
  id: string;
}

/** The card's target for a scope item. `locked`: the scope is locked, so the item takes no more feedback. */
export function scopeFeedbackTarget(t: FeedbackTarget, label: string, locked: boolean): CardTarget {
  return { type: t.type, id: t.id, title: label, base: label, locked, lockedNote: locked ? scopeLockedMessage() : "" };
}

const ScopeLocked = createContext<boolean | null>(null);

export function ScopeFeedbackProvider({ locked, children }: { locked: boolean; children: ReactNode }) {
  return (
    <ScopeLocked.Provider value={locked}>
      {children}
      <FeedbackLayer />
    </ScopeLocked.Provider>
  );
}

/** Opens an item's card from elsewhere (the "Comments" chip, the screen preview): the item comes into view and its card
 *  opens beside it. False when the item is not on the page. */
export function openScopeFeedback(target: CardTarget): boolean {
  const el = document.querySelector<HTMLElement>(feedbackItemSelector(targetKey(target.type, target.id)));
  if (!el || el.getClientRects().length === 0) return false;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  openFeedback(target);
  return true;
}

/** Opens an item's card after the current window (a preview) has closed. */
export function useOpenScopeFeedback(): (target: FeedbackTarget, label: string) => void {
  const locked = useContext(ScopeLocked) ?? false;
  return useCallback((t: FeedbackTarget, label: string) => {
    requestAnimationFrame(() => requestAnimationFrame(() => { openScopeFeedback(scopeFeedbackTarget(t, label, locked)); }));
  }, [locked]);
}

/** The item's feedback button (the Goals & requirements one); the item's row is a FeedbackItem. */
export function ScopeFeedbackButton({ target, label, className }: { target: FeedbackTarget; label: string; className?: string }) {
  const locked = useContext(ScopeLocked);
  const t = useMemo(() => scopeFeedbackTarget({ type: target.type, id: target.id }, label, locked ?? false), [target.type, target.id, label, locked]);
  if (locked === null) return null;
  return <FeedbackButton target={t} className={className} />;
}
