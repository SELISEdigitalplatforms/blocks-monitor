/** Floating MADP assistant window: its UI state (open, minimised, expanded, environment, unread dot, pending send) and the pure rules behind it. */
import { create } from "zustand";
import type { Environment } from "@/domain/promotion";
import { t } from "@/i18n";

export type EnvId = Environment;

export const ASSISTANT_LAUNCHER_ID = "madp-assistant-launcher";
export const ASSISTANT_WINDOW_ID = "madp-assistant-window";
export const ASSISTANT_COMPOSER_ID = "madp-assistant-composer";

export type AssistantView = "closed" | "open" | "minimised";
/** A message on its way to the server; shown as "Sending…" until the call answers. */
export type PendingSend = {
  text: string;
  attachments: { name: string; size: number }[];
  environment: EnvId;
  /** Set when the send failed: the plain reason, shown under the message instead of "Sending…". */
  failed?: string;
};

export type SuggestedPrompt = { id: "report" | "changes" | "stage"; label: string; text: string; send: boolean };
/** The prompt chips in the current language (read at render time). */
export function suggestedPrompts(): SuggestedPrompt[] {
  const changes = t("assistant.prompts.changes", "What changed in the latest release?");
  const stage = t("assistant.prompts.stage", "Is staging up to date with test?");
  return [
    { id: "report", label: t("assistant.prompts.report", "Report a problem"), text: t("assistant.prompts.reportText", "A customer reports: "), send: false },
    { id: "changes", label: changes, text: changes, send: true },
    { id: "stage", label: stage, text: stage, send: true },
  ];
}
/** The chips that fit the project's real releases: 'changes' needs a release, 'stage' needs one on dev; nothing is suggested before the releases are known. */
export function suggestedPromptsFor(s: { releasesKnown: boolean; anyReleased: boolean; devReleased: boolean }): SuggestedPrompt[] {
  return suggestedPrompts().filter(
    (p) => p.id === "report" || (p.id === "changes" && s.releasesKnown && s.anyReleased) || (p.id === "stage" && s.releasesKnown && s.devReleased),
  );
}
/** An environment's name in the current language (read at render time); an unknown id is shown as it is. */
export function envLabel(env: string): string {
  if (env === "dev") return t("assistant.env.dev", "Development");
  if (env === "stage") return t("assistant.env.stage", "Staging");
  if (env === "production") return t("assistant.env.production", "Production");
  return env;
}
export type ActivitySnapshot = { projectId: string | null; assistantCount: number; fixes: Record<string, string> };
export type UnreadState = { seen: ActivitySnapshot | null; unread: boolean };
export const NO_UNREAD: UnreadState = { seen: null, unread: false };

/** Escape closes the window when focus is inside it or on its launcher, unless another overlay (menu, listbox) is open or took the key. */
export function escapeClosesWindow(i: { key: string; defaultPrevented: boolean; focusInWindow: boolean; focusOnLauncher: boolean; overlayOpen: boolean }): boolean {
  return i.key === "Escape" && !i.defaultPrevented && (i.focusInWindow || i.focusOnLauncher) && !i.overlayOpen;
}

/** The project id of '/p/:id' and '/p/:id/...', otherwise null. */
export function routeProjectId(pathname: string): string | null {
  return /^\/p\/([^/]+)(?:\/|$)/.exec(pathname)?.[1] ?? null;
}

/** The environment shown on the overview page ('/p/:id/delivered'), null on any other page. */
export function overviewEnvOf(pathname: string, search: string, envFor: Record<string, EnvId>): EnvId | null {
  const m = /^\/p\/([^/]+)\/delivered\/?$/.exec(pathname);
  if (!m) return null;
  const q = new URLSearchParams(search).get("env");
  return q === "dev" || q === "stage" || q === "production" ? q : envFor[m[1]] ?? "dev";
}

/** Project and environment the window starts on: the project page on screen, otherwise the latest project. */
export function defaultAssistantTarget(input: {
  routeProjectId: string | null;
  projects: { id: string }[];
  overviewEnv: EnvId | null;
}): { projectId: string | null; environment: EnvId } {
  const onProject = input.routeProjectId !== null;
  return {
    projectId: input.routeProjectId ?? input.projects[0]?.id ?? null,
    environment: onProject && input.overviewEnv !== null ? input.overviewEnv : "dev",
  };
}

/** What the unread dot watches: assistant message count and the state of each fix job passed in. */
export function activityOf(
  projectId: string | null,
  messages: readonly { role: string }[],
  fixJobs: readonly { id: string; status: string }[],
): ActivitySnapshot {
  const fixes: Record<string, string> = {};
  for (const j of fixJobs) fixes[j.id] = j.status;
  return { projectId, assistantCount: messages.filter((m) => m.role === "assistant").length, fixes };
}

/** The unread dot: news while the window is not open sets it, opening clears it, a first load or project switch is not news. */
export function nextUnread(prev: UnreadState, now: { open: boolean; activity: ActivitySnapshot }): UnreadState {
  const { activity } = now;
  if (now.open) return { seen: activity, unread: false };
  if (prev.seen === null || prev.seen.projectId !== activity.projectId) return { seen: activity, unread: prev.unread };
  const before = prev.seen;
  const news =
    activity.assistantCount > before.assistantCount ||
    Object.keys(activity.fixes).some((id) => id in before.fixes && before.fixes[id] !== activity.fixes[id]);
  return { seen: activity, unread: prev.unread || news };
}

/** Prompt chips show on an empty conversation, hide while typing, and return once the composer was edited back to empty. */
export function suggestedPromptsVisible(input: { messageCount: number; text: string; fileCount: number; editedSinceSend: boolean }): boolean {
  return input.text.trim() === "" && input.fileCount === 0 && (input.messageCount === 0 || input.editedSinceSend);
}

type AssistantWindowState = {
  view: AssistantView;
  expanded: boolean;
  environment: EnvId;
  needsDefaults: boolean;
  chosenProjectId: string | null;
  session: number;
  unread: UnreadState;
  pending: PendingSend | null;
  openWindow: (target?: { environment?: EnvId }) => void;
  applyDefaults: (t: { environment: EnvId }) => void;
  minimise: () => void;
  close: () => void;
  toggle: () => void;
  toggleExpanded: () => void;
  setEnvironment: (env: EnvId) => void;
  noteActivity: (activity: ActivitySnapshot) => void;
  setPending: (p: PendingSend | null) => void;
  chooseProject: (id: string | null) => void;
};

export const useAssistantWindow = create<AssistantWindowState>((set, get) => ({
  view: "closed",
  expanded: false,
  environment: "dev",
  needsDefaults: false,
  chosenProjectId: null,
  session: 0,
  unread: NO_UNREAD,
  pending: null,
  openWindow: (target) =>
    set((s) => {
      const base = { view: "open" as const, unread: { ...s.unread, unread: false } };
      if (target?.environment) return { ...base, environment: target.environment, needsDefaults: false };
      return s.view === "closed" ? { ...base, needsDefaults: true } : base;
    }),
  applyDefaults: (t) => set({ environment: t.environment, needsDefaults: false }),
  minimise: () => set((s) => (s.view === "open" ? { view: "minimised" } : {})),
  close: () => set((s) => ({ view: "closed", expanded: false, needsDefaults: false, pending: null, session: s.session + 1 })),
  toggle: () => {
    if (get().view === "open") get().minimise();
    else get().openWindow();
  },
  toggleExpanded: () => set((s) => ({ expanded: !s.expanded })),
  setEnvironment: (env) => set({ environment: env }),
  noteActivity: (activity) => set((s) => ({ unread: nextUnread(s.unread, { open: s.view === "open", activity }) })),
  setPending: (p) => set({ pending: p }),
  chooseProject: (id) => set({ chosenProjectId: id, pending: null }),
}));
