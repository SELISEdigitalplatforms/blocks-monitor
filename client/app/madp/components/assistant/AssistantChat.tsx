import { useEffect, useRef, useState } from "react";
import { ArrowDown, Bot, Paperclip } from "lucide-react";
import { Button, Chip } from "@/madp/ui/kit";
import { classifyMessage } from "@/madp/domain/assistant";
import { EngineJobStatus } from "@/madp/components/engine/EngineJobStatus";
import { engineErrorMessage, retryEngineJob } from "@/madp/blocks/engine/actions";
import type { EngineJob } from "@/madp/blocks/engine/types";
import { jobById, useAnalyseReport, useAssistantJobs, useAssistantMessages } from "@/madp/blocks/collab/assistant";
import { useCan, useCollabContext } from "@/madp/blocks/collab/context";
import type { AssistantMessageRecord } from "@/madp/blocks/collab/records";
import { AnalysisCard } from "./AnalysisCard";
import { CodeRefChip } from "./CodeRefChip";
import { envLabel, useAssistantWindow, type EnvId, type PendingSend } from "./assistantWindowState";
import { t, useCulture, useT, type Culture } from "@/madp/i18n";

const WRAP = "[overflow-wrap:anywhere]";
const BUBBLE_FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-accent/50";
const TIME_CLS = "text-[11px] text-ink3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100";

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

const FMT = new Map<Culture, { time: Intl.DateTimeFormat; day: Intl.DateTimeFormat }>();
function formats(c: Culture) {
  let f = FMT.get(c);
  if (!f) {
    const locale = c === "de-CH" ? "de-CH" : "en-GB";
    f = {
      time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }),
      day: new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short" }),
    };
    FMT.set(c, f);
  }
  return f;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function dayLabel(iso: string, culture: Culture): string {
  const d = new Date(iso);
  const now = new Date();
  if (dayKey(d) === dayKey(now)) return t("assistant.chat.today", "Today");
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (dayKey(d) === dayKey(yesterday)) return t("assistant.chat.yesterday", "Yesterday");
  return formats(culture).day.format(d).replace(",", "");
}

function DaySeparator({ iso }: { iso: string }) {
  useT();
  const label = dayLabel(iso, useCulture());
  return (
    <div role="separator" aria-label={label} className="flex items-center gap-3 text-[12px] text-ink3">
      <span className="h-px flex-1 bg-line" />
      <span>{label}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}

function Time({ iso }: { iso: string }) {
  const culture = useCulture();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return <time dateTime={iso} className={TIME_CLS}>{formats(culture).time.format(d)}</time>;
}

function EnvTag({ message, environment }: { message: AssistantMessageRecord; environment: EnvId }) {
  useT();
  if (message.environment === environment) return null;
  return <Chip className="mb-1">{envLabel(message.environment)}</Chip>;
}

function Avatar() {
  return (
    <span className="mb-5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-[rgb(var(--c-accent-text))]">
      <Bot size={14} strokeWidth={1.75} aria-hidden="true" />
    </span>
  );
}

function Attachments({ items }: { items: { name: string; size: number }[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5">
      {items.map((a, i) => (
        <li key={`${a.name}-${i}`} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-[12px] text-white">
          <Paperclip size={12} strokeWidth={1.75} aria-hidden="true" className="shrink-0" />
          <span className="max-w-[160px] truncate">{a.name}</span>
          <span className="num">{sizeLabel(a.size)}</span>
        </li>
      ))}
    </ul>
  );
}

function UserBubble({ text, attachments }: { text: string; attachments: { name: string; size: number }[] }) {
  const t = useT();
  return (
    <div tabIndex={0} className={`max-w-[85%] rounded-card rounded-br-md bg-accent px-4 py-3 text-[14px] text-white ${WRAP} ${BUBBLE_FOCUS}`}>
      <span className="sr-only">{t("assistant.chat.you", "You:")} </span>
      {text && <p className="whitespace-pre-wrap">{text}</p>}
      <Attachments items={attachments} />
    </div>
  );
}

/** The engine job behind a user message (a reply or a bug analysis), with Retry for people who may retry it. */
function JobLine({ job, canRetry }: { job: EngineJob; canRetry: boolean }) {
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (job.status === "succeeded") return null;
  const retry = async () => {
    setRetrying(true);
    setError(null);
    try {
      await retryEngineJob(job.id);
    } catch (e) {
      setError(engineErrorMessage(e));
    } finally {
      setRetrying(false);
    }
  };
  return (
    <div className="mt-1.5 flex max-w-full justify-end">
      <EngineJobStatus job={job} variant="compact" canRetry={canRetry} onRetry={() => void retry()} retrying={retrying} requestError={error} />
    </div>
  );
}

function Bubble({
  message, environment, projectId, jobs,
}: { message: AssistantMessageRecord; environment: EnvId; projectId: string; jobs: readonly EngineJob[] }) {
  const t = useT();
  const { userId, isSuperAdmin } = useCollabContext();
  const canRun = useCan("build.run");
  const analyse = useAnalyseReport(projectId);
  if (message.role === "user") {
    const job = jobById(jobs, message.engineJobId);
    const isBug = classifyMessage(message.text, message.attachments) === "bug";
    const mine = isSuperAdmin || canRun || (userId !== null && message.updatedByUserId === userId);
    return (
      <div className="group flex flex-col items-end">
        <EnvTag message={message} environment={environment} />
        <UserBubble text={message.text} attachments={message.attachments} />
        <Time iso={message.at} />
        {job && <JobLine job={job} canRetry={mine} />}
        {!job && isBug && canRun && (
          <div className="mt-1.5 flex flex-col items-end gap-1">
            <Button size="sm" variant="secondary" disabled={analyse.pending} aria-busy={analyse.pending}
              onClick={() => void analyse.run({ messageId: message.id })}>
              {analyse.pending ? t("assistant.chat.starting", "Starting…") : t("assistant.chat.lookIntoProblem", "Look into this problem")}
            </Button>
            {analyse.error && <p role="alert" className="text-[12px] text-danger">{analyse.error}</p>}
          </div>
        )}
      </div>
    );
  }
  if (message.kind === "analysis") {
    return (
      <div className="group flex items-end gap-2">
        <Avatar />
        <div className="min-w-0 flex-1">
          <EnvTag message={message} environment={environment} />
          <div className="min-w-0 flex-1 rounded-card rounded-bl-md bg-surface2 p-1.5">
            <span className="sr-only">{t("assistant.chat.assistantSaid", "MADP assistant:")} </span>
            <AnalysisCard message={message} projectId={projectId} jobs={jobs} />
          </div>
          <Time iso={message.at} />
        </div>
      </div>
    );
  }
  return (
    <div className="group flex items-end gap-2">
      <Avatar />
      <div className="flex min-w-0 flex-col items-start">
        <EnvTag message={message} environment={environment} />
        <div tabIndex={0} className={`max-w-full rounded-card rounded-bl-md bg-surface2 px-4 py-3 text-[14px] text-ink ${WRAP} ${BUBBLE_FOCUS}`}>
          <span className="sr-only">{t("assistant.chat.assistantSaid", "MADP assistant:")} </span>
          <p className="whitespace-pre-wrap">{message.text}</p>
          {message.points.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-ink2">
              {message.points.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          )}
          {message.refs.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {message.refs.map((r, i) => <CodeRefChip key={`${r.path}:${r.line}:${i}`} source={r} />)}
            </div>
          )}
        </div>
        <Time iso={message.at} />
      </div>
    </div>
  );
}

function Welcome() {
  const t = useT();
  return (
    <div className="flex items-end gap-2">
      <Avatar />
      <div className={`max-w-[85%] rounded-card rounded-bl-md bg-surface2 px-4 py-3 text-[14px] text-ink ${WRAP}`}>
        <span className="sr-only">{t("assistant.chat.assistantSaid", "MADP assistant:")} </span>
        <p>{t("assistant.chat.welcome", "Hi! Ask me anything about this project: what is planned, what is being built, what is released. If a customer reports a problem, describe it and I will look into it.")}</p>
      </div>
    </div>
  );
}

export function Pending({ pending }: { pending: PendingSend }) {
  const t = useT();
  return (
    <div className="flex flex-col items-end">
      <UserBubble text={pending.text} attachments={pending.attachments} />
      {pending.failed
        ? <p role="alert" className="mt-1 text-[12px] text-danger">{t("assistant.chat.notSent", "Not sent. {reason}", { reason: pending.failed })}</p>
        : <p role="status" className="mt-1 text-[12px] text-ink3">{t("assistant.chat.sending", "Sending…")}</p>}
    </div>
  );
}

const NO_MESSAGES: AssistantMessageRecord[] = [];

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function AssistantChat({ projectId, environment }: { projectId: string; environment: EnvId }) {
  const t = useT();
  const messages = useAssistantMessages(projectId).data ?? NO_MESSAGES;
  const jobs = useAssistantJobs(projectId);
  const pending = useAssistantWindow((s) => s.pending);
  const view = useAssistantWindow((s) => s.view);
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prevCount = useRef(messages.length);
  const prevPending = useRef<PendingSend | null>(pending);
  const [unseen, setUnseen] = useState(false);

  const toEnd = (behavior: ScrollBehavior) => end.current?.scrollIntoView?.({ block: "end", behavior });

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    if (atBottom.current) setUnseen(false);
  };

  useEffect(() => {
    const grew = messages.length > prevCount.current;
    const justSet = pending !== null && prevPending.current === null;
    const changed = grew || pending !== prevPending.current;
    prevCount.current = messages.length;
    prevPending.current = pending;
    if (!changed) return;
    if (atBottom.current || justSet) {
      toEnd(reducedMotion() ? "auto" : "smooth");
      atBottom.current = true;
      setUnseen(false);
    } else if (grew) setUnseen(true);
  }, [messages.length, pending]);

  useEffect(() => {
    if (view !== "open") return;
    toEnd("auto");
    atBottom.current = true;
    setUnseen(false);
  }, [view]);

  let prevDay = "";
  const rows = messages.map((m) => {
    const k = dayKey(new Date(m.at));
    const sep = k !== prevDay;
    prevDay = k;
    return (
      <div key={m.id} className="grid gap-3">
        {sep && <DaySeparator iso={m.at} />}
        <Bubble message={m} environment={environment} projectId={projectId} jobs={jobs} />
      </div>
    );
  });

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={scroller} onScroll={onScroll} className="scroll-thin h-full overflow-y-auto overflow-x-hidden px-4 py-4">
        <div role="log" aria-live="polite" aria-relevant="additions" aria-label={t("assistant.chat.logLabel", "Conversation with the MADP assistant")} className="grid gap-3">
          {messages.length === 0 && !pending && <Welcome />}
          {rows}
          {pending && <Pending pending={pending} />}
        </div>
        <div ref={end} />
      </div>
      {unseen && (
        <button type="button" onClick={() => toEnd(reducedMotion() ? "auto" : "smooth")}
          className="absolute bottom-3 left-1/2 inline-flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-ink px-3.5 text-[13px] font-medium text-canvas shadow-float focus-visible:ring-2 focus-visible:ring-accent/50">
          {t("assistant.chat.newMessages", "New messages")}
          <ArrowDown size={14} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
