/** How the Team panel is opened on every /p/:id/* page.
 *  - TeamButton: the trigger with its unread dot, styled like the journey bar's Wiki / Produced links (for ProjectNav).
 *  - TeamHost: renders the panel while it is open (mount once per project page).
 *  - TeamLauncher: a floating trigger plus the host, for pages where the journey bar does not carry the button yet. */
import { Users } from "lucide-react";
import { cn } from "@/madp/lib/cn";
import { useT } from "@/madp/i18n";
import { isUnread } from "./teamMessages";
import { closeTeamPanel, openTeamPanel, useSeen, useTeamPanel } from "./teamSeen";
import { useTeamSummary } from "./useTeam";
import { TeamPanel } from "./TeamPanel";

export const TEAM_PANEL_ID = "team-panel";

/** True when either thread has something new for the signed-in person. */
function useTeamUnread(projectId: string): boolean {
  const session = useTeamPanel((s) => s.session);
  const sum = useTeamSummary(projectId, session > 0);
  const seen = useSeen(projectId);
  return isUnread(sum.analyst, seen.analyst) || isUnread(sum.lead, seen.lead);
}

const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

export function TeamButton({ projectId, className }: { projectId: string; className?: string }) {
  const t = useT();
  const open = useTeamPanel((s) => s.open);
  const unread = useTeamUnread(projectId);
  return (
    <button type="button" aria-haspopup="dialog" aria-expanded={open} title={t("team.panel.title", "Your team")}
      aria-label={unread ? t("team.button.unread", "Your team, new message") : t("team.panel.title", "Your team")} onClick={() => openTeamPanel()}
      className={cn("relative inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-2.5 text-[13px] font-medium transition-colors lg:px-3", FOCUS,
        open ? "bg-accent-soft text-accent" : "text-ink2 hover:bg-surface2 hover:text-ink", className)}>
      <Users aria-hidden size={16} strokeWidth={1.75} />
      <span className="max-lg:sr-only">{t("team.button.label", "Team")}</span>
      {unread && <span aria-hidden className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent ring-2 ring-surface" />}
    </button>
  );
}

export function TeamHost({ projectId }: { projectId: string }) {
  const open = useTeamPanel((s) => s.open);
  const contact = useTeamPanel((s) => s.contact);
  return open ? <TeamPanel key={projectId} projectId={projectId} initial={contact} onClose={closeTeamPanel} /> : null;
}

/** The floating trigger: left of the assistant's launcher (bottom right), so neither covers the other. */
export function TeamLauncher({ projectId }: { projectId: string }) {
  const t = useT();
  const open = useTeamPanel((s) => s.open);
  const unread = useTeamUnread(projectId);
  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => openTeamPanel()}
        aria-label={unread ? t("team.button.unread", "Your team, new message") : t("team.button.launcher", "Your team: your business analyst and your tech lead")}
        className={cn("fixed bottom-[28px] right-[92px] z-[48] inline-flex h-12 items-center gap-2 rounded-full bg-surface pl-2 pr-4 text-[14px] font-medium text-ink shadow-float ring-1 ring-line transition hover:bg-surface2",
          "outline-none focus-visible:ring-4 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas")}>
        <span aria-hidden className="flex -space-x-1.5">
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-accent-soft text-[11px] font-semibold text-[rgb(var(--c-accent-text))] ring-2 ring-surface">{t("team.contacts.analyst.initials", "BA")}</span>
          <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-surface2 text-[11px] font-semibold text-ink ring-2 ring-surface">{t("team.contacts.lead.initials", "TL")}</span>
        </span>
        {t("team.button.label", "Team")}
        {unread && <span aria-hidden className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface" />}
      </button>
      <TeamHost projectId={projectId} />
    </>
  );
}
