import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { RotateCcw, SendHorizontal, X } from "lucide-react";
import { Button } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";
import type { StageState } from "@/madp/data/pipeline";
import { MAX_SHOWN, MAX_TEXT } from "@/madp/domain/agentChat";
import { STEP_LABEL, useAgentChat, useChatDisplayFacts, useChatReplyJobs, useSendAgentMessage } from "@/madp/blocks/collab/chat";
import { isBlocksProjectId, useCollabContext, useCurrentBlocksProjectId, useRouteProjectId } from "@/madp/blocks/collab/context";
import type { AgentChatRecord } from "@/madp/blocks/collab/records";
import type { AgentView } from "../model";
import { promptMode } from "../chatSpace";
import { useOfficeStage } from "../officeStore";
import { NAME_IS_ROLE, ROLE_META, roleLabel } from "../roles";
import { useT } from "@/madp/i18n";
import { ChatJobBubble, ThinkingBubble } from "./ChatJobBubble";
import { TaskCreatedCard } from "./TaskCreatedCard";
import { ChatActionCard } from "./ChatActionCard";
import { greetingLine, HUMAN_ROLE, isChatRole, quickPrompts, statusLine } from "./persona";
import type { ChatRole } from "./types";
import { AttachButton, AttachChipList, AttachZone, SentFiles, attachHold, useAttachDraft } from "@/madp/components/feedback/AttachFiles";
import { useTalkAttachments } from "@/madp/blocks/collab/talkUpload";

/** the quick prompt (by index) that only fills the composer */
const TASK_PROMPT = 2;
const LINE_PX = 20;
const MAX_LINES = 5;

/** Unsent text per project and agent, so a layout flip (remount) keeps it. */
const drafts = new Map<string, string>();
/** When the last send started (ms), so the optimistic bubble is dropped only for the stored copy of that send. */
const sentAt = new Map<string, number>();
/** The last text sent per project and agent, shown until its stored copy is in the history. */
const lastSent = new Map<string, string>();
/** Clock differences between this browser and the server. */
const SKEW_MS = 120_000;

/** The sent text is already in the history when a message of mine has the same text and was written after the send began. */
export function isStored(history: readonly AgentChatRecord[], text: string, userId: string | null, startedAt: number | undefined): boolean {
  return history.some((m) => {
    if (m.role !== "user" || m.kind !== "text" || m.text !== text || userId === null || m.authorUserId !== userId) return false;
    if (startedAt === undefined) return true;
    const t = Date.parse(m.at);
    return Number.isNaN(t) || t >= startedAt - SKEW_MS;
  });
}

/** The project the chat talks about: an explicit id wins. A local (browser-only) project in the route has no chat;
 *  otherwise the current Blocks project does. */
export function chatProjectId(o: {
  explicit?: string | null; routeId: string | null; current: string | null; isBlocksId: (id: string) => boolean;
}): string | null {
  if (typeof o.explicit === "string" && o.explicit !== "") return o.explicit;
  const localRoute = o.routeId !== null && !o.isBlocksId(o.routeId);
  return localRoute ? null : o.current;
}

export function AgentChat({ officeId, agent, stages: _stages, titleId, onClose, projectId: explicitProjectId, room }: {
  officeId: string; agent: AgentView; stages: StageState[]; titleId: string; onClose: () => void;
  layout?: "anchored" | "docked" | "sheet"; projectId?: string | null;
  /** px the chat may grow to (a docked panel sized by its conversation); the quick prompts lay out by it. Without it,
   *  by the chat's own height. */
  room?: number;
}) {
  const t = useT();
  const routeId = useRouteProjectId();
  const current = useCurrentBlocksProjectId();
  const projectId = chatProjectId({ explicit: explicitProjectId, routeId, current, isBlocksId: isBlocksProjectId });
  const localRoute = routeId !== null && !isBlocksProjectId(routeId);
  const chatRole = isChatRole(agent.role);
  const role = (chatRole ? agent.role : "planner") as ChatRole;
  /** the role under the name, left out when it only repeats the name (the business analyst, the tech lead) */
  const subtitle = chatRole ? HUMAN_ROLE[role] : roleLabel(agent.role);
  const showSubtitle = chatRole ? !NAME_IS_ROLE.has(role) : subtitle.toLowerCase() !== agent.label.toLowerCase();
  const facts = useChatDisplayFacts(projectId, role);
  const { messages: history } = useAgentChat(projectId, role);
  const jobs = useChatReplyJobs(projectId);
  const { userId } = useCollabContext();
  const flow = useSendAgentMessage(projectId, role);
  const key = `${projectId ?? ""}:${agent.role}`;

  const [draft, setDraft] = useState(() => drafts.get(key) ?? "");
  const [error, setError] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const composing = useRef(false);

  const root = useRef<HTMLDivElement>(null);
  const [ownMode, setOwnMode] = useState<"wrap" | "hidden">("wrap");
  const sized = room !== undefined;
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || sized) return;
    const measure = () => setOwnMode(promptMode(el.clientHeight));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sized]);
  const mode = sized ? promptMode(room) : ownMode;

  const setText = (v: string) => { setDraft(v); drafts.set(key, v); };

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, LINE_PX * MAX_LINES + 16)}px`;
  }, [draft]);

  const { state } = flow;
  // A finished send is handled once; the flow outlives this screen, so a remount must not cue it again.
  const { settle } = flow;
  useEffect(() => {
    if (state.phase !== "done") return;
    if (state.created) useOfficeStage.getState().cueNewTask(officeId);
    settle();
  }, [state, officeId, settle]);

  const shown = useMemo(() => history.slice(-MAX_SHOWN), [history]);
  // The user's own message, shown at once while it is sent, and kept (with Retry) when the send failed.
  const sentText = state.phase === "sending" || state.phase === "failed" ? state.text : lastSent.get(key) ?? "";
  const optimistic = sentText && !isStored(shown, sentText, userId, sentAt.get(key)) ? sentText : "";
  const answered = useMemo(() => new Set(shown.filter((m) => m.role === "agent" && m.engineJobId).map((m) => m.engineJobId)), [shown]);
  // Once the stored copy is in the history the remembered text is dropped, so it can never stick.
  useEffect(() => {
    const text = lastSent.get(key);
    if (text && isStored(shown, text, userId, sentAt.get(key))) lastSent.delete(key);
  }, [shown, key, userId]);
  useEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, state.phase, optimistic]);

  const disabled = !facts || !projectId || !chatRole;
  const busy = flow.busy;
  // files sent with a message (a design, a screenshot, a document): the agent reads them with the message
  const files = useAttachDraft({ projectId: projectId ?? "", owner: { ownerType: "agent-chat" }, disabled: disabled || busy });
  const hold = attachHold(files);
  const sentFiles = useTalkAttachments(projectId, "agent-chat", shown.filter((m) => m.role === "user").map((m) => m.id)).data;

  // The composer takes the focus once it can (it waits for the agent's facts), without scrolling the page; until then
  // the chat itself holds it, so the Team strip that opened it steps back. A focus the person moved outside the stage
  // meanwhile (not just onto the stage or a container of it) stays where it is.
  const focused = useRef(false);
  useLayoutEffect(() => {
    if (focused.current) return;
    const el = root.current, at = document.activeElement;
    // the stage this chat belongs to: the one holding its Team strip (a bottom sheet is portaled out of it)
    const stage = document.querySelector(`[data-team-strip="${CSS.escape(officeId)}"]`)?.closest("section.factory-office") ?? null;
    const elsewhere = at !== null && at !== document.body && !el?.contains(at) && !(stage && (stage.contains(at) || at.contains(stage)));
    if (elsewhere) { focused.current = true; return; }
    if (disabled || busy) { el?.focus({ preventScroll: true }); return; }
    focused.current = true;
    area.current?.focus({ preventScroll: true });
  }, [disabled, busy, officeId]);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (disabled || !text || busy || hold) return;
    if (text.length > MAX_TEXT) { setError(t("studio.office.chat.tooLong", "Keep a message under {max} characters.", { max: MAX_TEXT })); return; }
    setError("");
    sentAt.set(key, Date.now());
    lastSent.set(key, text);
    drafts.delete(key);
    setDraft("");
    const attached = files.ids.length ? { attachmentIds: files.ids, draftKey: files.draftKey } : undefined;
    files.reset();
    await flow.send(text, attached);
  };

  // The task chip only fills the composer: nothing is sent and no reply is made up.
  const prefill = (text: string) => {
    setText(text);
    area.current?.focus();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || composing.current || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void send(draft);
  };

  const bubble = (m: AgentChatRecord) => {
    const mine = m.role === "user";
    if (m.kind === "task-created" && m.task && projectId) {
      // a confirmation of a tapped offer carries the answer's job and says itself what happened (sent for analysis or not)
      return <div key={m.id} className="max-w-[92%]"><TaskCreatedCard task={m.engineJobId ? { ...m.task, text: m.text } : m.task} projectId={projectId} /></div>;
    }
    // an action the agent offers: the card with the one button that does it (as the person, with their permission)
    if (m.offer && projectId) return <ChatActionCard key={m.id} projectId={projectId} role={role} offerId={m.id} offer={m.offer} />;
    const waiting = mine && m.engineJobId && !answered.has(m.engineJobId);
    return (
      <div key={m.id} className="flex flex-col gap-2">
        <div className={cn("max-w-[85%] whitespace-pre-wrap break-words rounded-block px-3 py-2 text-[14px] leading-snug", mine ? "ml-auto bg-accent text-white" : "bg-surface2 text-ink")}>
          {m.text}
        </div>
        {mine && projectId && <SentFiles projectId={projectId} files={sentFiles?.get(m.id)} className="-mt-1 ml-auto max-w-[85%]" />}
        {waiting && <ChatJobBubble name={agent.label} job={jobs.find((j) => j.id === m.engineJobId) ?? null} canRetry={userId !== null && m.authorUserId === userId} />}
      </div>
    );
  };

  const failed = state.phase === "failed" ? state : null;

  return (
    <div ref={root} tabIndex={-1} className="flex min-h-0 flex-1 flex-col text-ink outline-none">
      <header className="flex flex-none items-center gap-3 border-b border-line px-4 py-3">
        <span aria-hidden className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[15px] font-semibold text-white"
          style={{ background: `rgb(var(${ROLE_META[agent.role].color}))` }}>
          {agent.label.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="truncate text-[15px] font-semibold leading-tight">{agent.label}</h2>
          {showSubtitle && <p className="truncate text-[12px] text-ink2">{subtitle}</p>}
          {facts && <p className="line-clamp-2 text-[12px] text-ink3">{statusLine(facts)}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label={t("studio.office.chat.close", "Close the conversation")}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink2 outline-none transition hover:bg-surface2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
          <X size={18} strokeWidth={1.75} aria-hidden />
        </button>
      </header>

      <div ref={log} role="log" aria-live="polite" aria-label={t("studio.office.chat.conversationWith", "Conversation with {name}", { name: agent.label })}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
        {/* the messages sit on the prompts and the composer; free space stays above them */}
        <div className="mt-auto flex flex-col gap-2">
          {shown.length === 0 && facts && (
            <div className="max-w-[85%] rounded-block bg-surface2 px-3 py-2 text-[14px] leading-snug text-ink">{greetingLine(facts)}</div>
          )}
          {shown.map(bubble)}
          {optimistic && (
            <div className="flex flex-col gap-1">
              <div className="ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-block bg-accent px-3 py-2 text-[14px] leading-snug text-white">{optimistic}</div>
            </div>
          )}
          {state.phase === "sending" && <ThinkingBubble name={agent.label} />}
          {(state.phase === "creating" || state.phase === "recording") && (
            <div role="status" className="max-w-[85%] rounded-block bg-surface2 px-3 py-2 text-[14px] leading-snug text-ink2">
              {state.phase === "creating" ? STEP_LABEL.draft : STEP_LABEL.record}
            </div>
          )}
        </div>
      </div>

      {mode !== "hidden" && (
        <div className="flex flex-none flex-wrap gap-1.5 px-4 pb-2">
          {quickPrompts().map((p, i) => (
            <Button key={i} size="sm" variant="ghost" className="!h-7 !px-3 !text-[12px]" disabled={disabled || busy} onClick={() => (i === TASK_PROMPT ? prefill(p) : void send(p))}>{p}</Button>
          ))}
        </div>
      )}

      {(error || failed) && (
        <div role="alert" className="mx-4 mb-2 flex flex-none flex-wrap items-center justify-between gap-2 rounded-block bg-danger-soft px-3 py-2 text-[13px] text-danger">
          <span className="min-w-0 break-words">{error || (failed ? (failed.step === "send" ? failed.message : t("studio.office.chat.failedSaved", "{message} Your message is saved.", { message: failed.message })) : "")}</span>
          {failed && (
            <Button size="sm" variant="ghost" icon={<RotateCcw size={14} strokeWidth={1.75} aria-hidden />} onClick={() => void flow.retry()}>{t("studio.office.chat.retry", "Retry")}</Button>
          )}
        </div>
      )}

      <AttachZone draft={files} className="flex-none rounded-none">
      <div className="border-t border-line p-3">
        {disabled && (
          <p className="mb-2 text-[13px] text-ink2">
            {localRoute
              ? t("studio.office.chat.localProject", "Chat with the agents works on projects stored in the workspace.")
              : t("studio.office.chat.openProject", "Open a project to talk to the team.")}
          </p>
        )}
        <textarea ref={area} rows={1} value={draft} maxLength={MAX_TEXT} disabled={disabled || busy}
          aria-label={t("studio.office.chat.messageTo", "Message {name}", { name: agent.label })} placeholder={t("studio.office.chat.messageTo", "Message {name}", { name: agent.label })}
          onChange={(e) => setText(e.target.value)} onKeyDown={onKey}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          className="block w-full resize-none rounded-block bg-surface2 px-3 py-2 text-[14px] leading-5 text-ink outline-none ring-accent/40 placeholder:text-ink3 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60" />
        <AttachChipList draft={files} disabled={busy} />
        {hold && <p className="mt-1 text-[12px] text-ink3">{hold}</p>}
        <div className="mt-2 flex items-center justify-end gap-2">
          <AttachButton draft={files} disabled={disabled || busy} label={t("studio.office.chat.attachFor", "Attach files for {name}", { name: agent.label })} className="!h-8 !w-8" />
          <Button size="sm" variant="primary" disabled={disabled || busy || !draft.trim() || !!hold} aria-label={t("studio.office.chat.sendTo", "Send to {name}", { name: agent.label })}
            icon={<SendHorizontal size={16} strokeWidth={1.75} aria-hidden />} onClick={() => void send(draft)}>{t("studio.office.chat.send", "Send")}</Button>
        </div>
      </div>
      </AttachZone>
    </div>
  );
}
