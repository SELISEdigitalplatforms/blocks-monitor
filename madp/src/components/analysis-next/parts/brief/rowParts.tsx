/** The small pieces every compact row of the Business Analysis lists shares: the read-only priority tag, the source
 *  hint (an icon with its words as a tooltip), the comment count, the item's link to the one feedback card, the quiet
 *  "Add" and "Expand all" buttons and the Undo line after a delete. */
import { useT } from "@/i18n";
import { useEffect, useMemo, type ReactNode, type Ref } from "react";
import {
  ChevronsDownUp, ChevronsUpDown, ClipboardList, Inbox, Lightbulb, MessageSquare, NotebookPen, Plus, Scale, ScanSearch, Undo2, UserRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { VIEWER_TIP } from "@/domain/rbac";
import type { RequirementPriority } from "@/domain/requirements";
import { targetKey, type FeedbackTargetType } from "@/data/feedback";
import { useCollabContext } from "@/blocks/collab/context";
import { useThreadBadge } from "@/components/feedback/feedbackData";
import {
  closeFeedback, feedbackItemSelector, openFeedback, toggleFeedback, useFeedbackUi, useIsFeedbackOpen, type FeedbackTarget,
} from "@/components/feedback/feedbackUi";
import { PRIORITY_HINT, PRIORITY_WORD } from "@/components/requirements/priority";
import { commentMode, type SourceKind } from "./compactList";

// ------------------------------------------------------------------------------------------------ priority and source

const TAG: Record<RequirementPriority, string> = {
  must: "bg-accent-soft text-[rgb(var(--c-accent-text))]",
  nice: "bg-surface2 text-ink2 ring-1 ring-inset ring-line",
  later: "bg-warning-soft text-[rgb(var(--c-warning-text))]",
};

/** Must / Should / Could as a small read-only tag (changing it is a deliberate action in the ⋯ menu). */
export function PriorityTag({ value, busy, className }: { value: RequirementPriority; busy?: boolean; className?: string }) {
  const t = useT();
  return (
    <span title={`${PRIORITY_WORD[value]}: ${PRIORITY_HINT[value]}`}
      className={cn("inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-medium leading-none", TAG[value], busy && "animate-pulse motion-reduce:animate-none", className)}>
      <span className="sr-only">{t("analysis.brief.priorityPrefix", "Priority: ")}</span>{PRIORITY_WORD[value]}
    </span>
  );
}

const SOURCE_ICON: Record<SourceKind, LucideIcon> = {
  analysis: ScanSearch,
  suggestion: Lightbulb,
  "second-opinion": Scale,
  feedback: Inbox,
  person: UserRound,
  setup: ClipboardList,
  draft: NotebookPen,
};

/** Where the item came from, as a quiet icon; the words are its tooltip and its accessible name. */
export function SourceHint({ kind, label, className }: { kind: SourceKind; label: string; className?: string }) {
  const Icon = SOURCE_ICON[kind];
  return (
    <span role="img" aria-label={label} title={label} className={cn("grid h-6 w-6 shrink-0 place-items-center text-ink3", className)}>
      <Icon size={14} strokeWidth={1.75} aria-hidden />
    </span>
  );
}

/** The source in full, in an opened row. */
export function SourceLine({ kind, label, children }: { kind: SourceKind; label: string; children?: ReactNode }) {
  const Icon = SOURCE_ICON[kind];
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12.5px] text-ink3">
      <span className="inline-flex items-center gap-1.5"><Icon size={13} strokeWidth={1.75} aria-hidden />{label}</span>
      {children}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ comments


export interface ItemComments {
  key: string;
  target: FeedbackTarget;
  count: number;
  resolved: boolean;
  working: boolean;
  updated: boolean;
  isOpen: boolean;
  /** "comment" (may add one), "view" (may only read the thread) or null (no menu entry). */
  mode: "comment" | "view" | null;
  open: () => void;
  toggle: () => void;
  /** Closes another item's card (a menu opened on this row). */
  closeOthers: () => void;
}

/** An item's link to the one feedback card (FeedbackLayer): the same target, thread, count and lock as the item's
 *  FeedbackButton on the Requirements page, opened from the ⋯ menu or the row's count. `commentable` false: the item
 *  takes no comments (shown from the setup answers, it has no row yet). */
export function useItemComments({ type, id, title, editable, viewOnly, stepOpen, commentable = true }: {
  type: Extract<FeedbackTargetType, "requirement" | "extra">; id: string; title: string; editable: boolean; viewOnly: boolean;
  stepOpen: boolean; commentable?: boolean;
}): ItemComments {
  const t = useT();
  const key = targetKey(type, id);
  const closedNote = t("analysis.brief.closedNote", "The requirements are confirmed, so this item stays as it is.");
  const target = useMemo<FeedbackTarget>(() => ({
    type, id, title, base: title, locked: !editable, lockedNote: viewOnly ? VIEWER_TIP : closedNote,
  }), [type, id, title, editable, viewOnly, closedNote]);
  const badge = useThreadBadge(type, id);
  const isOpen = useIsFeedbackOpen(type, id);
  const { permissions } = useCollabContext();
  const canComment = permissions.includes("comment");
  // the open card follows the item's current title and lock state (as FeedbackButton does), while the row is shown
  const stale = useFeedbackUi((s) => {
    const o = s.open;
    return !!o && targetKey(o.type, o.id) === key
      && (o.title !== target.title || o.base !== target.base || o.locked !== target.locked || o.lockedNote !== target.lockedNote);
  });
  useEffect(() => {
    if (!stale || !commentable) return;
    const row = document.querySelector(feedbackItemSelector(key));
    if (row && row.getClientRects().length > 0) openFeedback(target);
  }, [stale, target, key, commentable]);
  return {
    key, target, ...badge, isOpen,
    mode: commentMode({ commentable, canComment, stepOpen, count: badge.count }),
    open: () => openFeedback(target),
    toggle: () => toggleFeedback(target),
    closeOthers: () => {
      const o = useFeedbackUi.getState().open;
      if (o && targetKey(o.type, o.id) !== key) closeFeedback({ refocus: false });
    },
  };
}

/** The row's comment count (shown when there is at least one); opens and closes the item's card. */
export function CommentCount({ c, name }: { c: ItemComments; name: string }) {
  const t = useT();
  if (c.count <= 0 || !c.mode) return null;
  const label = c.working ? t("analysis.brief.commentsOnWorking", "Comments on {name}: {count}, the team is working on it", { name, count: c.count })
    : c.updated ? t("analysis.brief.commentsOnUpdated", "Comments on {name}: {count}, updated by the team", { name, count: c.count })
    : c.resolved ? t("analysis.brief.commentsOnResolved", "Comments on {name}: {count}, resolved", { name, count: c.count })
    : t("analysis.brief.commentsOn", "Comments on {name}: {count}", { name, count: c.count });
  return (
    <button type="button" data-feedback-button={c.key} aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={c.isOpen}
      onClick={c.toggle}
      className={cn("relative inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[12px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50",
        c.resolved ? "text-ink3 hover:bg-line hover:text-ink2" : "text-[rgb(var(--c-accent-text))] hover:bg-accent-soft",
        c.isOpen && "bg-accent-soft text-[rgb(var(--c-accent-text))]")}>
      <MessageSquare size={14} strokeWidth={1.75} aria-hidden />
      <span className="num">{c.count}</span>
      {(c.working || c.updated) && (
        <span aria-hidden className={cn("absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full", c.working ? "bg-ai animate-pulse-dot" : "bg-accent")} />
      )}
    </button>
  );
}

/** The place of the comment count: kept on every row from sm up, so the counts and tags line up down the list. */
export function CommentSlot({ children }: { children: ReactNode }) {
  return <span className="flex shrink-0 justify-end sm:w-11">{children}</span>;
}

// ------------------------------------------------------------------------------------------------ list chrome

const QUIET = "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium text-ink2 outline-none transition hover:bg-surface2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-45";

/** The one quiet "Add …" of a list. */
export function AddButton({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={QUIET} onClick={onClick} disabled={disabled}>
      <Plus size={15} strokeWidth={1.75} aria-hidden />{children}
    </button>
  );
}

/** Expand all / Collapse all. */
export function ExpandAllButton({ all, onClick, className }: { all: boolean; onClick: () => void; className?: string }) {
  const t = useT();
  const Icon = all ? ChevronsDownUp : ChevronsUpDown;
  return (
    <button type="button" className={cn(QUIET, className)} onClick={onClick} aria-pressed={all}>
      <Icon size={15} strokeWidth={1.75} aria-hidden />{all ? t("analysis.brief.collapseAll", "Collapse all") : t("analysis.brief.expandAll", "Expand all")}
    </button>
  );
}

/** "Deleted: …  Undo" for the ten seconds the delete can be taken back (a polite live region). */
export function UndoLine({ text, canUndo, busy, onUndo, undoRef }: {
  text: string | null; canUndo: boolean; busy: boolean; onUndo: () => void; undoRef?: Ref<HTMLButtonElement>;
}) {
  const t = useT();
  return (
    <div role="status" aria-live="polite" className="text-[13px] text-ink2 empty:hidden">
      {text !== null && (
        <span className="flex flex-wrap items-center gap-2 rounded-block bg-surface2 px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate">{text}</span>
          {canUndo && (
            <button ref={undoRef} type="button" className={QUIET} disabled={busy} onClick={onUndo}>
              <Undo2 size={14} strokeWidth={1.75} aria-hidden />{t("analysis.brief.undo", "Undo")}
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** The rows of one group: a ruled list on the card. */
export const ROWS_BOX = "divide-y divide-line overflow-hidden rounded-block ring-1 ring-line";
/** The row's own toggle (title side): full height, inset focus ring. */
const ROW_LINE = "flex min-h-[44px] min-w-0 flex-1 items-center gap-2 py-2 pl-2.5 pr-1";
export const ROW_TOGGLE = `${ROW_LINE} text-left outline-none transition-colors hover:bg-surface2/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50`;
/** A row with nothing to open (a constraint, an exclusion): the same spacing. */
export const ROW_STATIC = ROW_LINE;
