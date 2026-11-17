import { useEffect, useMemo, useState } from "react";
import { Bot } from "lucide-react";
import { cn } from "@/lib/cn";
import { useT } from "@/i18n";
import { useAssistantJobs, useAssistantMessages } from "@/blocks/collab/assistant";
import { jobInput } from "@/blocks/delivery/hooks";
import { ASSISTANT_LAUNCHER_ID, ASSISTANT_WINDOW_ID, activityOf, useAssistantWindow } from "./assistantWindowState";
import { AssistantWindow, useAssistantTarget } from "./AssistantWindow";

const NO_MESSAGES: never[] = [];

/** Bottom space a page keeps clear of the launcher: its offset (bottom-6 = 24) + its height (h-14 = 56) + 16. */
export const LAUNCHER_RESERVE_PX = 24 + 56 + 16;

/** Bottom space the floating controls take: the launcher's reserve while it is shown. */
export function floatingReservePx({ launcherShown }: { launcherShown: boolean }): number {
  return launcherShown ? LAUNCHER_RESERVE_PX : 0;
}

/** Set `scroll-padding-bottom` so focus and scrollIntoView stop above the floating controls; returns the cleanup. */
export function applyScrollPaddingBottom(el: { style: { scrollPaddingBottom: string } }, px: number): () => void {
  el.style.scrollPaddingBottom = px > 0 ? `${px}px` : "";
  return () => { el.style.scrollPaddingBottom = ""; };
}

const SEEN_KEY = "madp-assistant-launcher-seen";
const isFirstVisit = () => { try { return localStorage.getItem(SEEN_KEY) === null; } catch { return false; } };

export function AssistantLauncher() {
  const t = useT();
  const { projectId } = useAssistantTarget();
  const mounted = useAssistantWindow((s) => s.view !== "closed" || s.session > 0);
  // the reads start once the assistant has been opened in this session
  const messages = useAssistantMessages(mounted ? projectId : null).data ?? NO_MESSAGES;
  const jobs = useAssistantJobs(mounted ? projectId : null);
  const view = useAssistantWindow((s) => s.view);
  const unread = useAssistantWindow((s) => s.unread.unread);
  const activity = useMemo(() => {
    // the unread dot follows the build of each fix started here, and the analysis jobs of bug reports
    const fixes = new Set(messages.map((m) => m.fixChangeRequestId).filter((id) => id !== ""));
    const watched = jobs.filter(
      (j) => j.kind === "fix.analyse" || (j.kind === "change.build" && fixes.has(jobInput(j)?.changeRequestId ?? "")),
    );
    return activityOf(projectId, messages, watched);
  }, [projectId, messages, jobs]);
  const [pulse, setPulse] = useState(isFirstVisit);

  useEffect(() => { useAssistantWindow.getState().noteActivity(activity); }, [activity, view]);

  useEffect(() => {
    if (!pulse) return;
    try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* storage blocked: the pulse replays next visit */ }
    const timer = window.setTimeout(() => setPulse(false), 4000);
    return () => window.clearTimeout(timer);
  }, [pulse]);

  useEffect(() => { if (view === "open") setPulse(false); }, [view]);

  return (
    <>
      <button id={ASSISTANT_LAUNCHER_ID} type="button" aria-haspopup="dialog" aria-expanded={view === "open"} aria-controls={ASSISTANT_WINDOW_ID}
        aria-label={unread ? t("assistant.launcher.askUnread", "Ask the MADP assistant, new message") : t("assistant.launcher.ask", "Ask the MADP assistant")}
        onClick={() => useAssistantWindow.getState().toggle()}
        className={cn(
          "group fixed bottom-6 right-6 z-[48] grid h-14 w-14 place-items-center rounded-full bg-accent text-white shadow-float transition hover:bg-accent-hover outline-none focus-visible:ring-4 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          view === "open" && "max-sm:hidden",
        )}>
        {pulse && (
          <span aria-hidden className="pointer-events-none absolute inset-0 rounded-full bg-accent/35 motion-safe:animate-ping [animation-iteration-count:3] motion-reduce:hidden" />
        )}
        <Bot size={24} strokeWidth={1.75} aria-hidden className="relative" />
        {view !== "open" && (
          <span aria-hidden className="pointer-events-none absolute bottom-full right-0 mb-3 hidden whitespace-nowrap rounded-full bg-ink px-3 py-1.5 text-[12px] font-medium text-canvas opacity-0 shadow-float transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 sm:block">
            {t("assistant.launcher.ask", "Ask the MADP assistant")}
          </span>
        )}
        {unread && <span aria-hidden className="absolute right-0.5 top-0.5 h-3.5 w-3.5 rounded-full bg-danger ring-2 ring-canvas" />}
      </button>
      {mounted && <AssistantWindow />}
    </>
  );
}
