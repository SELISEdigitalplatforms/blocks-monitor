/** The Team panel: a slide-over from the right (full screen on phones) where the person talks to YOUR BUSINESS ANALYST
 *  and YOUR TECH LEAD of the project. Each thread is worded from real rows (teamMessages.ts); every action is an existing
 *  op with its own permission check (TeamActions.tsx, TeamComposers.tsx). Escape closes, Tab stays inside, focus goes
 *  back to what opened it. */
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { getCulture, useCulture, useT } from "@/i18n";
import { useBackdropDismiss } from "@/ui/kit";
import { EasedJobBar } from "@/components/engine/EasedJobBar";
import { EngineJobStatus } from "@/components/engine/EngineJobStatus";
import { engineErrorMessage, retryEngineJob } from "@/blocks/engine/actions";
import type { EngineJob } from "@/blocks/engine/types";
import {
  TEAM_CONTACT_IDS, teamContact, firstContact, isUnread, type TeamContactId, type TeamGroup, type TeamMessage, type TeamThread,
} from "./teamMessages";
import { markSeen, useSeen } from "./teamSeen";
import { useTeam, type TeamData } from "./useTeam";
import { TeamActionView } from "./TeamActions";
import { ChangeComposer, QuestionComposer } from "./TeamComposers";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The panel's dialog behaviour (the kit's Drawer does the same; its hook is private): focus in, Tab trapped, Escape
 *  closes unless something inside handled it (an open list), the page behind does not scroll, focus returns on close. */
function usePanelDialog(onClose: () => void) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const box = panel.current;
    box?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const body = document.body.style;
    const before = { overflow: body.overflow, paddingRight: body.paddingRight };
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    body.overflow = "hidden";
    if (gutter > 0) body.paddingRight = `${gutter}px`;
    const key = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!items.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      const inside = box.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      body.overflow = before.overflow;
      body.paddingRight = before.paddingRight;
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  return panel;
}

// ------------------------------------------------------------------------------------------- small parts

/** The BA / TL tile. */
export function TeamTile({ contact, size = 32, className }: { contact: TeamContactId; size?: number; className?: string }) {
  useT();
  return (
    <span aria-hidden style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className={cn("grid shrink-0 place-items-center rounded-[10px] font-semibold tracking-wide",
        contact === "analyst" ? "bg-accent-soft text-[rgb(var(--c-accent-text))]" : "bg-surface2 text-ink ring-1 ring-inset ring-line", className)}>
      {teamContact(contact).initials}
    </span>
  );
}

const FORMATS = new Map<string, { time: Intl.DateTimeFormat; dayTime: Intl.DateTimeFormat }>();
/** The time formats of the current language (English: en-GB; German: de-CH). */
function formats() {
  const locale = getCulture() === "de-CH" ? "de-CH" : "en-GB";
  let f = FORMATS.get(locale);
  if (!f) {
    f = {
      time: new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
      dayTime: new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    };
    FORMATS.set(locale, f);
  }
  return f;
}

/** "10:42" today, "8 Nov, 10:42" otherwise; "" without a time. */
export function teamTime(at: string | null, now = Date.now()): string {
  const ms = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const f = formats();
  return new Date(now).toDateString() === d.toDateString() ? f.time.format(d) : f.dayTime.format(d);
}

const TEAM_STUCK_MS = 60_000;

function Waiting({ job, canRetry }: { job: EngineJob | null; canRetry: boolean }) {
  const t = useT();
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // a question nobody picked up within a minute shows its real waiting state (as in the office chat, ChatJobBubble)
  const age = job?.createdAt ? Date.now() - Date.parse(job.createdAt) : 0;
  const stuck = job?.status === "queued" && Number.isFinite(age) && age > TEAM_STUCK_MS;
  const active = !job || job.status === "queued" || job.status === "claimed" || job.status === "running" || job.status === "succeeded";
  if (active && !stuck && !error) {
    return (
      <p role="status" className="flex items-center gap-2 text-[12px] text-ink3">
        <span aria-hidden className="flex items-center gap-1">
          {[0, 1, 2].map((i) => <span key={i} className="block h-1.5 w-1.5 rounded-full bg-ink3 animate-pulse-dot motion-reduce:animate-none" style={{ animationDelay: `${i * 160}ms` }} />)}
        </span>
        {t("team.panel.leadLooking", "Your tech lead is looking into it…")}
      </p>
    );
  }
  const retry = async () => {
    if (!job) return;
    setRetrying(true); setError(null);
    try { await retryEngineJob(job.id); } catch (e) { setError(engineErrorMessage(e)); } finally { setRetrying(false); }
  };
  return <EngineJobStatus job={job} variant="compact" canRetry={canRetry} onRetry={() => void retry()} retrying={retrying} requestError={error} />;
}

function Bubble({ m, first, showTime, data, onNavigate }: {
  m: TeamMessage; first: boolean; showTime: boolean; data: TeamData; onNavigate: () => void;
}) {
  const t = useT();
  const time = teamTime(m.at);
  const action = m.action ? <div className="mt-2"><TeamActionView action={m.action} ctx={data.ctx} changes={data.changes} onNavigate={onNavigate} /></div> : null;
  if (m.author === "note") {
    return (
      <li className="flex flex-col items-center gap-1.5 py-1 text-center">
        <p className="max-w-[90%] text-[12px] leading-snug text-ink3">{m.text}{time && <span className="sr-only">{`, ${time}`}</span>}</p>
        {action}
      </li>
    );
  }
  if (m.author === "person") {
    const job = m.waitingJobId ? data.replyJobs.find((j) => j.id === m.waitingJobId) ?? null : null;
    return (
      <li className="flex flex-col items-end gap-1">
        {(first || showTime) && <p className="text-[11px] text-ink3">{[m.name ?? t("team.thread.you", "You"), time].filter(Boolean).join(" · ")}</p>}
        <div className="max-w-[85%] whitespace-pre-wrap rounded-block rounded-tr-md bg-accent px-3 py-2 text-[13px] leading-snug text-white [overflow-wrap:anywhere]">{m.text}</div>
        {m.waitingJobId && <div className="mt-1 max-w-[92%] self-start"><Waiting job={job} canRetry={m.mine === true} /></div>}
      </li>
    );
  }
  const contact: TeamContactId = m.author;
  return (
    <li className="flex min-w-0 gap-2.5">
      <span className="w-8 shrink-0">{first && <TeamTile contact={contact} />}</span>
      <div className="min-w-0 flex-1">
        {(first || showTime) && (
          <p className="mb-1 text-[11px] text-ink3">{[first ? teamContact(contact).short : "", time].filter(Boolean).join(" · ")}</p>
        )}
        <div className={cn("w-fit max-w-full whitespace-pre-wrap rounded-block rounded-tl-md bg-surface2 px-3 py-2 text-[13px] leading-snug text-ink [overflow-wrap:anywhere]",
          m.tone === "attention" && "ring-1 ring-inset ring-accent/30",
          m.tone === "problem" && "ring-1 ring-inset ring-danger/30",
          m.tone === "done" && "ring-1 ring-inset ring-success/30")}>
          {m.text}
          {m.needsYou && <span className="sr-only">{` (${t("team.panel.waitingForYouSr", "waiting for you")})`}</span>}
        </div>
        {m.job && (
          <div className="mt-2 max-w-[260px]">
            <EasedJobBar progress={m.job.progress} working={m.job.working} resetKey={m.job.id} ticks={false} active size="sm" label={t("team.panel.progress", "Progress")} />
          </div>
        )}
        {action}
      </div>
    </li>
  );
}

const minutes = (at: string | null) => { const t = at ? Date.parse(at) : NaN; return Number.isFinite(t) ? t / 60_000 : null; };

function Group({ g, data, onNavigate }: { g: TeamGroup; data: TeamData; onNavigate: () => void }) {
  const t = useT();
  return (
    <section aria-label={g.title} className="flex min-w-0 flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2 pt-2">
        <span aria-hidden className="h-px flex-1 bg-line" />
        <h3 className="min-w-0 max-w-[75%] truncate text-[12px] font-medium text-ink2" title={g.title}>{g.title}</h3>
        <span aria-hidden className="h-px flex-1 bg-line" />
      </div>
      <ul className="flex min-w-0 flex-col gap-2.5">
        {g.messages.map((m, i) => {
          const prev = g.messages[i - 1];
          const first = !prev || prev.author !== m.author || prev.name !== m.name;
          const a = minutes(m.at), b = minutes(prev?.at ?? null);
          const showTime = a !== null && (b === null || Math.abs(a - b) > 5);
          return <Bubble key={m.id} m={m} first={first} showTime={showTime} data={data} onNavigate={onNavigate} />;
        })}
      </ul>
      {g.href && (
        <Link to={g.href} onClick={onNavigate}
          className="self-end rounded text-[12px] font-medium text-accent underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/50">
          {g.id.startsWith("ms:") ? t("team.panel.openBuild", "Open the build") : t("team.thread.openChange", "Open the change request")}
        </Link>
      )}
    </section>
  );
}

function Thread({ contact, thread, data, onNavigate, bottomKey }: { contact: TeamContactId; thread: TeamThread; data: TeamData; onNavigate: () => void; bottomKey: string }) {
  const t = useT();
  const log = useRef<HTMLDivElement>(null);
  const count = thread.groups.reduce((n, g) => n + g.messages.length, 0);
  useLayoutEffect(() => {
    const el = log.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, contact, bottomKey]);
  return (
    <div ref={log} role="log" aria-live="polite" aria-label={contact === "analyst" ? t("team.panel.conversationAnalyst", "Conversation with your business analyst") : t("team.panel.conversationLead", "Conversation with your tech lead")}
      className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
      <div className="mt-auto flex min-w-0 flex-col gap-4">
        {data.error && <p role="alert" className="px-2 text-center text-[13px] leading-relaxed text-danger">{data.error}</p>}
        {thread.groups.length === 0 && data.loading && !data.error && <p role="status" className="px-2 text-center text-[13px] text-ink3">{t("team.panel.loading", "Loading the conversation…")}</p>}
        {thread.groups.length === 0 && !data.loading && !data.error && (
          <p className="px-2 text-center text-[13px] leading-relaxed text-ink3">
            {contact === "analyst"
              ? t("team.panel.emptyAnalyst", "No change requests yet. When you ask for a change or a new feature, your business analyst analyses it against the product and comes back here with questions or a plan.")
              : t("team.panel.emptyLead", "No builds yet. When a build starts, your tech lead posts its progress here, and you can ask technical questions below.")}
          </p>
        )}
        {thread.groups.map((g) => <Group key={g.id} g={g} data={data} onNavigate={onNavigate} />)}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------- the panel

export function TeamPanel({ projectId, initial, onClose }: { projectId: string; initial?: TeamContactId | null; onClose: () => void }) {
  const t = useT();
  useCulture();
  const data = useTeam(projectId);
  const seen = useSeen(projectId);
  const unread = { analyst: isUnread(data.analyst, seen.analyst), lead: isUnread(data.lead, seen.lead) };
  const needs = { analyst: data.analyst.needsYou, lead: data.lead.needsYou };
  const [contact, setContact] = useState<TeamContactId>(() => initial ?? firstContact(unread, needs));
  const [bottom, setBottom] = useState(0);
  const panel = usePanelDialog(onClose);
  const scrim = useBackdropDismiss(onClose);
  const titleId = useId();
  const tabsId = useId();
  const thread = contact === "analyst" ? data.analyst : data.lead;

  // the open thread is read: its newest message from the team member counts as seen
  useEffect(() => {
    markSeen(projectId, contact, Math.max(thread.latestFromContact, 0));
  }, [projectId, contact, thread.latestFromContact]);

  const tabs = useMemo(() => TEAM_CONTACT_IDS, []);
  const onTabKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const k = e.key;
    if (k !== "ArrowRight" && k !== "ArrowLeft" && k !== "Home" && k !== "End") return;
    e.preventDefault();
    const i = tabs.indexOf(contact);
    const n = k === "Home" ? 0 : k === "End" ? tabs.length - 1 : (i + (k === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    setContact(tabs[n]!);
    (e.currentTarget.children[n] as HTMLElement | undefined)?.focus();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgb(var(--c-scrim)/0.28)] backdrop-blur-[2px] dark:bg-[rgb(var(--c-scrim)/0.6)]" {...scrim}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}
        className="flex w-full flex-col overflow-hidden bg-surface shadow-float animate-rise sm:m-3 sm:w-[420px] sm:max-w-[calc(100vw-24px)] sm:rounded-card dark:ring-1 dark:ring-line">
        <header className="flex flex-none items-center gap-3 border-b border-line px-5 pb-3 pt-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-[17px] font-medium text-ink">{t("team.panel.title", "Your team")}</h2>
            <p className="truncate text-[12px] text-ink3">{data.ctx.project?.name
              ? t("team.panel.subtitleProject", "{project} · the people building it with you", { project: data.ctx.project.name })
              : t("team.panel.subtitle", "The people building your product with you")}</p>
          </div>
          <button type="button" aria-label={t("team.panel.close", "Close your team")} data-autofocus onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface2 text-ink2 outline-none transition hover:bg-line hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
            <X size={16} aria-hidden />
          </button>
        </header>

        <div role="tablist" aria-label={t("team.panel.title", "Your team")} onKeyDown={onTabKey} className="grid flex-none grid-cols-2 gap-2 border-b border-line px-4 py-3">
          {tabs.map((c) => {
            const on = c === contact;
            const c0 = teamContact(c);
            return (
              <button key={c} type="button" role="tab" id={`${tabsId}-tab-${c}`} aria-selected={on} aria-controls={`${tabsId}-panel`} tabIndex={on ? 0 : -1}
                onClick={() => setContact(c)}
                className={cn("flex min-w-0 items-center gap-2.5 rounded-block px-2.5 py-2 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-accent/50",
                  on ? "bg-surface2 ring-1 ring-inset ring-line" : "hover:bg-surface2")}>
                <span className="relative">
                  <TeamTile contact={c} size={30} />
                  {unread[c] && <span aria-hidden className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface" />}
                </span>
                <span className="min-w-0">
                  <span className={cn("block truncate text-[13px]", on ? "font-semibold text-ink" : "font-medium text-ink2")}>{c0.short}</span>
                  <span className="block truncate text-[11px] text-ink3">
                    {needs[c] > 0 ? t("team.panel.waitingCount", "{count} waiting for you", { count: needs[c] })
                      : unread[c] ? t("team.panel.newMessage", "New message")
                      : c === "analyst" ? t("team.panel.analystArea", "What to build") : t("team.panel.leadArea", "Engineering")}
                  </span>
                  {unread[c] && <span className="sr-only">{`, ${t("team.panel.newMessageSr", "new message")}`}</span>}
                </span>
              </button>
            );
          })}
        </div>

        <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-tab-${contact}`} className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-none items-start gap-2.5 px-5 pt-3">
            <p className="min-w-0 text-[12px] leading-snug text-ink2"><span className="font-medium text-ink">{teamContact(contact).name}.</span> {teamContact(contact).role}</p>
          </div>
          <Thread contact={contact} thread={thread} data={data} onNavigate={onClose} bottomKey={String(bottom)} />
          <div className="scroll-thin max-h-[55%] flex-none overflow-y-auto border-t border-line px-4 py-3">
            {contact === "analyst"
              ? <ChangeComposer projectId={projectId} onSent={() => setBottom((n) => n + 1)} />
              : <QuestionComposer projectId={projectId} canAsk={data.canAsk} onSent={() => setBottom((n) => n + 1)} />}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
