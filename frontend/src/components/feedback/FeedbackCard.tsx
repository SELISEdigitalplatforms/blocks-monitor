import { Fragment, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, Factory, RotateCcw, Undo2, X } from "lucide-react";
import { Avatar, Button, Dot } from "@/ui/kit";
import { cn } from "@/lib/cn";
import { formatCommentTime, initialsOf, targetKey, teamLabelOf, type FeedbackTargetType } from "@/data/feedback";
import { useRouteBlocksProjectId, useCollabContext, useMemberName } from "@/blocks/collab/context";
import { useAttachments, useProjectThreads, useThreadComments } from "@/blocks/collab/feedback";
import { blocksKeys } from "@/blocks/data/keys";
import { queryClient } from "@/blocks/queryClient";
import { ENGINE_JOB_OUTPUTS } from "@/domain/engineJob";
import type { FeedbackAttachmentRecord, FeedbackCommentRecord } from "@/blocks/collab/records";
import { useItemVersionsMeta } from "@/blocks/requirements/hooks";
import { useRestoreVersion } from "@/blocks/requirements/mutations";
import { requirementsErrorMessage } from "@/components/requirements/messages";
import { JOURNEY_SLUG } from "../../domain/journey";
import { requirementItemKey } from "../../domain/requirements";
import {
  isPersonComment, isTeamComment, needsWork, openProposal, orderComments, parseProposal, threadKey, type ThreadStatus,
} from "../../domain/feedback";
import { AttachmentChips } from "./AttachmentChips";
import { FeedbackComposer } from "./FeedbackComposer";
import { noCommentMessage, isRequirementsTarget, useRequirementsLane, useScopeLane, type FeedbackLane } from "./feedbackLanes";
import {
  ApplyError, useExtraApply, useFeatureApply, useMilestoneApply, useNoApply, useRequirementApply, useStoryApply, useSuccessApply,
  type ApplyLane,
} from "./feedbackApply";
import { feedbackItemSelector, openFeedback, setNotice, useFeedbackUi, type FeedbackTarget } from "./feedbackUi";
import { t, useT } from "@/i18n";

const TEXT_BTN = "inline-flex items-center gap-1 rounded-full text-[12px] font-medium text-ink2 outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50";

/** The header chip: a short word per status. */
export function threadChipLabel(status: ThreadStatus): string {
  switch (status) {
    case "open": return t("settings.feedback.chip.open", "Open");
    case "working": return t("settings.feedback.chip.working", "Working on it");
    case "updated": return t("settings.feedback.chip.updated", "Updated");
    case "resolved": return t("settings.feedback.chip.resolved", "Closed");
  }
}

function Frame({ variant, title, titleId, onClose, chip, footer, children }: {
  variant: "float" | "sheet"; title: string; titleId: string; onClose: () => void; chip: ReactNode; footer: ReactNode; children: ReactNode;
}) {
  const t = useT();
  return (
    <div>
      {variant === "float" ? (
        <div className="flex items-start gap-3 rounded-t-card bg-accent px-5 py-4 text-white">
          <h3 id={titleId} className="line-clamp-2 min-w-0 flex-1 text-[15px] font-medium leading-snug">{title}</h3>
          {chip}
          <button type="button" aria-label={t("settings.feedback.card.close", "Close feedback")} onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white outline-none transition hover:bg-white/15 focus-visible:bg-white/15 focus-visible:ring-2 focus-visible:ring-white">
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      ) : chip ? <div className="-mx-6 -mt-5 mb-4 flex items-center gap-2 bg-accent px-6 py-3">{chip}</div> : null}
      <div className={variant === "float" ? "p-5" : undefined}>{children}</div>
      {footer && (
        <div className={cn("flex flex-wrap items-center gap-2 border-t border-line bg-surface2 py-4", variant === "float" ? "rounded-b-card px-5" : "-mx-6 -mb-5 mt-5 px-6")}>
          {footer}
        </div>
      )}
    </div>
  );
}

const CHANGE_REQUEST = /change request #(\d+)/gi;

/** The team's words, with each "change request #N" linked to that change request. */
function TeamText({ text, projectId }: { text: string; projectId: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(CHANGE_REQUEST)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    parts.push(
      <Link key={at} to={`/p/${projectId}/${JOURNEY_SLUG.build}?cr=${Number(m[1])}`} className="font-medium text-accent hover:underline">{m[0]}</Link>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}

/** The team's avatar: the factory mark on the accent, the size of a person's avatar. */
function TeamAvatar() {
  return (
    <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-white">
      <Factory size={14} strokeWidth={1.75} />
    </span>
  );
}

/** What a suggested change can do in this card: decide it (Apply / Keep), or only read it. */
interface ProposalCtl {
  openId: string | null;
  busy: boolean;
  /** The person may decide (allowed to close the thread, and the step takes changes). */
  canDecide: boolean;
  apply: ApplyLane;
  onApply(c: FeedbackCommentRecord): void;
  onKeep(): void;
}

function ProposalBlock({ c, ctl }: { c: FeedbackCommentRecord; ctl: ProposalCtl }) {
  const t = useT();
  const p = parseProposal(c.text);
  const isOpen = ctl.openId === c.id;
  return (
    <div className="mt-1.5 rounded-block bg-accent/5 px-3 py-2.5 ring-1 ring-inset ring-accent/20">
      <p className="text-[12px] font-medium text-ink3">{t("settings.feedback.proposal.title", "Suggested change")}</p>
      {p ? (
        <>
          {p.title && <p className="mt-1 text-[13px] font-medium leading-snug [overflow-wrap:anywhere]">{p.title}</p>}
          {p.text && <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]">{p.text}</p>}
        </>
      ) : (
        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]">{c.text}</p>
      )}
      {isOpen && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {ctl.apply.apply && p && (
              <Button variant="primary" size="sm" disabled={!ctl.canDecide || ctl.busy}
                icon={<Check size={14} strokeWidth={1.75} aria-hidden="true" />} onClick={() => ctl.onApply(c)}>{t("settings.feedback.proposal.apply", "Apply change")}</Button>
            )}
            <Button variant="ghost" size="sm" disabled={!ctl.canDecide || ctl.busy} onClick={ctl.onKeep}>{t("settings.feedback.proposal.keep", "Keep as is")}</Button>
          </div>
          {ctl.canDecide && ctl.apply.blocked && <p className="mt-2 text-[12px] leading-snug text-ink3">{ctl.apply.blocked}</p>}
        </>
      )}
    </div>
  );
}

function CommentItem({ c, attachments, now, onError, openFile, targetType, projectId, proposal }: {
  c: FeedbackCommentRecord; attachments: FeedbackAttachmentRecord[]; now: Date; onError: (m: string) => void;
  openFile: (a: FeedbackAttachmentRecord) => Promise<void>; targetType: FeedbackTargetType; projectId: string; proposal: ProposalCtl;
}) {
  const name = useMemberName(c.authorUserId);
  if (c.kind === "system") {
    return (
      <li className="flex items-center gap-1.5 text-[12px] text-ink3">
        <Factory size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{c.text}</span>
        <time dateTime={c.at} className="shrink-0">· {formatCommentTime(c.at, now)}</time>
      </li>
    );
  }
  const team = isTeamComment(c.kind);
  return (
    <li className="flex gap-3">
      {team ? <TeamAvatar /> : <Avatar initials={initialsOf(name)} size={28} tone="soft" className="shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-[13px] font-medium">{team ? teamLabelOf(targetType) : name}</span>
          <time dateTime={c.at} className="text-[12px] text-ink3">{formatCommentTime(c.at, now)}</time>
        </div>
        {c.kind === "proposal" ? (
          <ProposalBlock c={c} ctl={proposal} />
        ) : c.text && (
          <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]">
            {team ? <TeamText text={c.text} projectId={projectId} /> : c.text}
          </p>
        )}
        <AttachmentChips attachments={attachments} open={openFile} onError={onError} />
      </div>
    </li>
  );
}

function StatusLine({ noticeKey }: { noticeKey: string }) {
  const notice = useFeedbackUi((s) => s.notices[noticeKey]);
  return (
    <>
      <p role="status" aria-live="polite" className={cn("mt-3 flex items-center gap-1.5 text-[13px] text-ink2", notice?.tone !== "ok" && "hidden")}>
        {notice?.tone === "ok" ? notice.text : null}
      </p>
      {notice?.tone === "error" && <p role="alert" className="mt-3 text-[13px] text-danger">{notice.text}</p>}
    </>
  );
}

/** Where the thread stands, live: the team picks it up, works on it, and answers. */
function WorkLine({ status, waiting, role }: { status: ThreadStatus | null; waiting: boolean; role: string }) {
  const t = useT();
  const text = status === "working" ? t("settings.feedback.work.working", "{role} is working on this…", { role })
    : status === "open" && waiting ? t("settings.feedback.work.waiting", "Waiting for the team to pick this up…")
    : status === "updated" ? t("settings.feedback.work.updated", "Updated — have a look")
    : null;
  return (
    <p role="status" aria-live="polite" className={cn("mt-3 flex items-center gap-2 text-[12px] text-ink2", !text && "hidden")}>
      {status === "working" ? <Dot tone="ai" pulse /> : status === "updated" ? <Dot tone="accent" /> : <Dot tone="neutral" pulse />}
      <span>{text}</span>
    </p>
  );
}

/** What one step adds to the card's footer (Goals & requirements: back to the previous version). */
type FooterExtra = (ctl: { busy: boolean; open: boolean; run: (fn: () => Promise<string>, errorMessage?: (e: unknown) => string) => void }) => ReactNode;

/** The one feedback card of an item: its thread (collapsed to the first comment when it has replies), the team's replies
 *  and suggested changes, the composer, the live status, Accept and close / Reopen. The lane says what the step allows
 *  and where the writes go; `apply` saves a suggested change through the item's own edit. */
function ThreadCard({ target, projectId, variant, onClose, titleId, lane, apply, footerExtra }: {
  target: FeedbackTarget; projectId: string; variant: "float" | "sheet"; onClose: () => void; titleId: string;
  lane: FeedbackLane; apply: ApplyLane; footerExtra?: FooterExtra;
}) {
  const t = useT();
  const key = targetKey(target.type, target.id);
  // the open card re-reads its thread while the team still has to answer (the engine writes the reply and the status)
  const [live, setLive] = useState(false);
  const threads = useProjectThreads(projectId, { live }).data;
  const thread = threads?.get(threadKey(target.type, target.id)) ?? null;
  const commentsQ = useThreadComments(projectId, thread?.id, { live });
  const comments = commentsQ.data;
  const list = useMemo(() => orderComments(comments ?? []), [comments]);
  const attachmentIds = useMemo(() => list.flatMap((c) => c.attachmentIds), [list]);
  const files = useAttachments(projectId, attachmentIds).data;
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const listId = useId();
  const status: ThreadStatus | null = thread?.status ?? null;

  useEffect(() => { setExpanded(false); }, [key]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { setLive(!!status && needsWork(status)); }, [status]);
  // the status moved on (the team answered, or someone decided): read the comments once more, so the last entry the
  // team wrote before the new status is never missed
  const lastStamp = useRef<string | null>(null);
  const stamp = thread ? `${thread.status}|${thread.updatedAt}` : null;
  const refetchComments = commentsQ.refetch;
  useEffect(() => {
    if (lastStamp.current !== null && stamp !== null && stamp !== lastStamp.current) void refetchComments();
    lastStamp.current = stamp;
  }, [stamp, refetchComments]);
  // the team finished (working -> updated): what it wrote besides the thread (a new screen version, a change request)
  // is read again, so the page shows it next to the reply
  const { workspaceId } = useCollabContext();
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    const before = lastStatus.current;
    lastStatus.current = status;
    if (!workspaceId || status !== "updated" || before === null || !needsWork(before)) return;
    for (const schema of ENGINE_JOB_OUTPUTS["feedback.apply"]) {
      if (schema === "FeedbackComment" || schema === "FeedbackThread") continue;
      void Promise.resolve(queryClient.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, schema) })).catch(() => undefined);
    }
  }, [status, workspaceId]);

  const fileById = useMemo(() => new Map((files ?? []).map((f) => [f.id, f])), [files]);
  const { open, closedReason, canComment, canResolve } = lane;
  const composerOff = !open || !canComment;
  const composerReason = closedReason ?? (!canComment ? noCommentMessage() : null);
  const resolved = status === "resolved";

  const people = list.filter((c) => isPersonComment(c.kind));
  const first = people[0] ?? null;
  const firstName = useMemberName(first?.authorUserId ?? "");
  const entries = list.filter((c) => c.kind !== "system").length;
  const replies = Math.max(0, entries - 1);
  // a thread the team is on, or that waits for the person, always shows in full
  const showCollapsed = !!first && !expanded && replies > 0 && (status === "open" || status === "resolved");
  const lastPerson = list.reduce((n, c, i) => (isPersonComment(c.kind) ? i : n), -1);
  const lastTeam = list.reduce((n, c, i) => (isTeamComment(c.kind) ? i : n), -1);
  /** A person's comment the team has not answered yet. */
  const waiting = lastPerson >= 0 && lastPerson > lastTeam;
  const proposal = openProposal(status ?? "", list);

  const onError = (m: string) => setNotice(key, { tone: "error", text: m });
  const run = async (fn: () => Promise<string>, errorMessage: (e: unknown) => string = lane.errorMessage) => {
    if (busy) return;
    setBusy(true);
    try { setNotice(key, { tone: "ok", text: await fn() }); } catch (e) { onError(errorMessage(e)); } finally { setBusy(false); }
  };
  const plainOr = (e: unknown) => (e instanceof ApplyError ? e.message : lane.errorMessage(e));
  const toggleStatus = () => {
    if (!thread) return;
    void run(async () => {
      await lane.setStatus(thread.id, resolved ? "open" : "resolved");
      return resolved ? t("settings.feedback.notice.reopened", "Reopened.") : t("settings.feedback.notice.closed", "Accepted and closed.");
    });
  };
  const ctl: ProposalCtl = {
    openId: proposal?.id ?? null,
    busy,
    canDecide: !!thread && canResolve && open,
    apply,
    onApply: (c) => {
      const p = parseProposal(c.text);
      if (!thread || !p || !apply.apply) return;
      const save = apply.apply;
      void run(async () => {
        await save(p);
        await lane.setStatus(thread.id, "resolved", "applied");
        return t("settings.feedback.notice.applied", "Change applied. Saved.");
      }, plainOr);
    },
    onKeep: () => {
      if (!thread) return;
      void run(async () => {
        await lane.setStatus(thread.id, "resolved", "kept");
        return t("settings.feedback.notice.kept", "Kept as it was.");
      });
    },
  };

  const chip = thread && status && (
    <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-white/15 px-2.5 text-[12px] font-medium text-white">
      {resolved && <Check size={12} strokeWidth={1.75} aria-hidden="true" />}{threadChipLabel(status)}
    </span>
  );
  const resolveReason = !canResolve ? lane.noResolveMessage : closedReason;
  // Accept and close: when the team has answered, or when nothing waits for it; never while it works
  const teamBusy = status === "working" || (status === "open" && waiting);
  const footer = (
    <>
      {resolved ? (
        <Button variant="ghost" size="sm" disabled={!thread || !canResolve || !open || busy} title={resolveReason ?? undefined}
          icon={<RotateCcw size={14} strokeWidth={1.75} aria-hidden="true" />} onClick={toggleStatus}>{t("settings.feedback.card.reopen", "Reopen")}</Button>
      ) : !proposal && (
        <Button variant="ghost" size="sm" disabled={!thread || !canResolve || !open || busy || teamBusy}
          title={resolveReason ?? (teamBusy ? t("settings.feedback.card.stillWorking", "The team is still working on this.") : undefined)}
          icon={<Check size={14} strokeWidth={1.75} aria-hidden="true" />} onClick={toggleStatus}>{t("settings.feedback.card.acceptClose", "Accept and close")}</Button>
      )}
      {footerExtra?.({ busy, open, run: (fn, errorMessage) => void run(fn, errorMessage) })}
      {resolveReason && thread && <p className="w-full text-[12px] leading-snug text-ink3">{resolveReason}</p>}
    </>
  );

  const renderList = (
    <ol id={listId} className={cn("space-y-4", variant === "float" && "scroll-thin max-h-[min(360px,45dvh)] overflow-y-auto pr-1")}>
      {list.map((c) => (
        <CommentItem key={c.id} c={c} now={now} onError={onError} openFile={lane.openFile} targetType={target.type} projectId={projectId}
          proposal={ctl} attachments={c.attachmentIds.map((id) => fileById.get(id)).filter((f): f is FeedbackAttachmentRecord => !!f)} />
      ))}
    </ol>
  );

  return (
    <Frame variant={variant} title={target.title} titleId={titleId} onClose={onClose} chip={chip} footer={footer}>
      <div>
        {!first ? (
          <>
            <p className="text-[13px] leading-snug text-ink2">{t("settings.feedback.card.empty", "No feedback yet. Say what should change.")}</p>
            {list.length > 0 && <div className="mt-3">{renderList}</div>}
          </>
        ) : showCollapsed ? (
          <div className="flex gap-3">
            <Avatar initials={initialsOf(firstName)} size={28} tone="soft" className="shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-[13px] font-medium">{firstName}</span>
                <time dateTime={first.at} className="text-[12px] text-ink3">{formatCommentTime(first.at, now)}</time>
              </div>
              <p className="mt-0.5 line-clamp-2 whitespace-pre-wrap text-[13px] leading-snug text-ink2 [overflow-wrap:anywhere]">{first.text}</p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <span className="text-[12px] text-ink3">{replies === 0 ? t("settings.feedback.card.noReplies", "No replies yet") : replies === 1 ? t("settings.feedback.card.oneReply", "1 reply") : t("settings.feedback.card.replies", "{n} replies", { n: replies })}</span>
                <button type="button" aria-expanded={false} aria-controls={listId} onClick={() => setExpanded(true)} className={TEXT_BTN}>
                  {t("settings.feedback.card.showThread", "Show thread")}<ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {renderList}
            {replies > 0 && expanded && (
              <button type="button" aria-expanded={true} aria-controls={listId} onClick={() => setExpanded(false)} className={cn(TEXT_BTN, "mt-3")}>
                {t("settings.feedback.card.hideThread", "Hide thread")}<ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" className="rotate-180" />
              </button>
            )}
          </>
        )}
        {showCollapsed && <div id={listId} hidden />}
        <WorkLine status={status} waiting={waiting} role={teamLabelOf(target.type)} />
      </div>
      <div className="mt-4">
        <FeedbackComposer target={target} lane={lane.composer} disabled={composerOff} disabledReason={composerReason} onSent={() => setExpanded(true)} />
        {!composerOff && lane.note && <p className="mt-2 text-[12px] leading-snug text-ink3">{lane.note}</p>}
      </div>
      <StatusLine noticeKey={key} />
    </Frame>
  );
}

type CardProps = { target: FeedbackTarget; projectId: string; variant: "float" | "sheet"; onClose: () => void; titleId: string };
type UseApply = (projectId: string, target: FeedbackTarget) => ApplyLane;

/** Goals & requirements: the requirements lane, plus "Back to version n" after a Regenerate. */
function RequirementsCard(props: CardProps) {
  // one card per kind of item, so each one reads only what its "Apply change" needs
  const useApply: UseApply = props.target.type === "extra" ? useExtraApply : useRequirementApply;
  return <RequirementsTypeCard key={props.target.type} {...props} useApply={useApply} />;
}

function RequirementsTypeCard({ useApply, ...props }: CardProps & { useApply: UseApply }) {
  const { target, projectId } = props;
  const lane = useRequirementsLane(projectId, target);
  const apply = useApply(projectId, target);
  const { permissions } = useCollabContext();
  const restore = useRestoreVersion(projectId);
  const versions = useItemVersionsMeta(projectId).data;
  let itemKey = "";
  try { itemKey = target.type === "requirement" ? requirementItemKey(target.id) : ""; } catch { itemKey = ""; }
  const current = itemKey ? versions?.latest.get(itemKey) ?? 0 : 0;
  const count = itemKey ? versions?.byKey.get(itemKey)?.length ?? 0 : 0;
  const canEdit = permissions.includes("requirements.edit");
  const t = useT();
  const footerExtra: FooterExtra = ({ busy, open, run }) => current >= 2 && count >= 2 && canEdit && open ? (
    <Button variant="ghost" size="sm" disabled={busy} icon={<Undo2 size={14} strokeWidth={1.75} aria-hidden="true" />}
      onClick={() => run(async () => {
        await restore.mutateAsync({ itemKey, restoreN: current - 1, baseVersion: current });
        return t("settings.feedback.version.restored", "Back to version {n}. Saved.", { n: current - 1 });
      }, requirementsErrorMessage)}>{t("settings.feedback.version.back", "Back to version {n}", { n: current - 1 })}</Button>
  ) : null;
  return <ThreadCard {...props} lane={lane} apply={apply} footerExtra={footerExtra} />;
}

const SCOPE_APPLY: Record<Exclude<FeedbackTargetType, "requirement" | "extra">, UseApply> = {
  feature: useFeatureApply,
  story: useStoryApply,
  milestone: useMilestoneApply,
  success: useSuccessApply,
  screen: useNoApply,
};

/** The card's item, following its thread: a redesigned screen is a new version (a new item id) and its thread moves to
 *  it, so the open card keeps showing that thread, writes to the new version, and moves beside it once it is on the page. */
function useFollowedTarget(projectId: string, target: FeedbackTarget): FeedbackTarget {
  const threads = useProjectThreads(projectId).data;
  const key = targetKey(target.type, target.id);
  const direct = threads?.get(threadKey(target.type, target.id)) ?? null;
  const seen = useRef<{ key: string; threadId: string } | null>(null);
  let moved: string | null = null;
  if (!direct && threads && seen.current?.key === key) {
    const id = seen.current.threadId;
    for (const t of threads.values()) if (t.id === id && t.targetType === target.type) { moved = t.targetId; break; }
  }
  useEffect(() => { if (direct) seen.current = { key, threadId: direct.id }; }, [key, direct]);
  const followed = useMemo(() => (moved && moved !== target.id ? { ...target, id: moved } : target), [target, moved]);
  useEffect(() => {
    if (followed === target) return;
    if (document.querySelector(feedbackItemSelector(targetKey(followed.type, followed.id)))) openFeedback(followed);
  }, [followed, target]);
  return followed;
}

/** Scope & success: the scope lane (features, stories, screens, milestones, success & performance targets). */
function ScopeCard(props: CardProps) {
  const target = useFollowedTarget(props.projectId, props.target);
  const type = target.type;
  const useApply = isRequirementsTarget(type) ? useNoApply : SCOPE_APPLY[type];
  return <ScopeTypeCard key={type} {...props} target={target} useApply={useApply} />;
}

function ScopeTypeCard({ useApply, ...props }: CardProps & { useApply: UseApply }) {
  const lane = useScopeLane(props.projectId, props.target);
  const apply = useApply(props.projectId, props.target);
  return <ThreadCard {...props} lane={lane} apply={apply} />;
}

/** The feedback card of one item. Blocks projects show the thread from SELISE Blocks; a local project has no threads. */
export function FeedbackCard({ target, variant, onClose, titleId }: { target: FeedbackTarget; variant: "float" | "sheet"; onClose: () => void; titleId: string }) {
  const t = useT();
  const projectId = useRouteBlocksProjectId();
  if (projectId) {
    const props = { target, projectId, variant, onClose, titleId };
    return isRequirementsTarget(target.type) ? <RequirementsCard {...props} /> : <ScopeCard {...props} />;
  }
  return (
    <Frame variant={variant} title={target.title} titleId={titleId} onClose={onClose} chip={null} footer={null}>
      <p className="text-[13px] leading-snug text-ink2">{t("settings.feedback.card.localProject", "Feedback works on projects saved in your workspace. This project is saved only in this browser.")}</p>
    </Frame>
  );
}
