/** TeamStrip: one "Talk to" button per agent over the stage (bottom-left), the plain way to open an agent's chat besides
 *  clicking the agent or its head label in 3D. Activating one selects it exactly like a click in 3D. On the full stage
 *  (`shown`) the strip is always visible and clickable above the canvas; elsewhere it stays out of sight and shows only
 *  while it holds the keyboard focus. On narrow stages (phones), where the agents are too small to tap, it is one "Team"
 *  button with a menu instead. */

import { useRef, useState, type KeyboardEvent } from "react";
import { Users } from "lucide-react";
import { cn } from "@/lib/cn";
import { MENU_ITEM, MENU_PANEL } from "@/ui/kit";
import { Popover } from "@/ui/popover";
import type { AgentStatus, AgentView } from "./model";
import { useOfficeStage } from "./officeStore";
import { ROLE_META, agentStatusText } from "./roles";
import { useT } from "@/i18n";

const STATUS_DOT: Record<AgentStatus, string> = {
  working: "bg-[rgb(var(--brand-500))]", waiting: "bg-[rgb(var(--warning))]", returning: "bg-[rgb(var(--warning))]",
  fail: "bg-[rgb(var(--danger))]", pass: "bg-[rgb(var(--success))]", done: "bg-[rgb(var(--ink-3))]",
  queued: "bg-[rgb(var(--ink-3))]", idle: "bg-[rgb(var(--ink-3))]",
};

const CHIP = "bg-[rgb(var(--surface)/0.85)] text-[rgb(var(--ink))] backdrop-blur rounded-full";
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--brand-500))]";

function Avatar({ agent }: { agent: AgentView }) {
  return (
    <span aria-hidden="true" className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-medium text-white"
      style={{ background: `rgb(var(${ROLE_META[agent.role].color}))` }}>
      {agent.label.charAt(0).toUpperCase()}
    </span>
  );
}

export function TeamStrip({ officeId, agents, narrow, shown = false }: { officeId: string; agents: AgentView[]; narrow: boolean; shown?: boolean }) {
  const t = useT();
  const talkTo = (a: AgentView) => t("studio.office.team.talkToStatus", "Talk to {name}, {status}", { name: a.label, status: agentStatusText(a) });
  const selected = useOfficeStage((s) => s.selected);
  const pick = (id: string) => useOfficeStage.getState().select({ office: officeId, agent: id });
  const current = selected && selected.office === officeId ? selected.agent : null;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  // the menu is portaled out of the stage: factory-office brings the role colours along
  if (narrow) {
    const items = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const onKeyDown = (e: KeyboardEvent) => {
      const list = items();
      const i = list.indexOf(document.activeElement as HTMLElement);
      if (e.key === "ArrowDown") list[(i + 1) % list.length]?.focus();
      else if (e.key === "ArrowUp") list[(i - 1 + list.length) % list.length]?.focus();
      else if (e.key === "Home") list[0]?.focus();
      else if (e.key === "End") list[list.length - 1]?.focus();
      else if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); }
      else if (e.key === "Tab") setOpen(false);
      else return;
      if (e.key !== "Tab") e.preventDefault();
    };
    return (
      <>
        <button ref={trigger} type="button" data-team-strip={officeId} aria-haspopup="menu" aria-expanded={open}
          onClick={() => { setOpen(!open); }}
          onKeyDown={(e) => { if (e.key === "ArrowDown" && !open) { e.preventDefault(); setOpen(true); } }}
          className={cn("pointer-events-auto inline-flex h-9 items-center gap-2 px-3.5 text-[13px] font-medium", CHIP, FOCUS)}>
          <Users size={16} strokeWidth={1.75} aria-hidden="true" /> {t("studio.office.team.button", "Team")}
        </button>
        {open && (
          <Popover anchorRef={trigger} panelRef={menu} onClose={() => setOpen(false)} role="menu" aria-label={t("studio.office.team.button", "Team")} onKeyDown={onKeyDown} className={cn(MENU_PANEL, "factory-office w-64")}>
            {agents.map((a, i) => (
              <button key={a.id} type="button" role="menuitem" autoFocus={i === 0} aria-label={talkTo(a)}
                onClick={() => { setOpen(false); trigger.current?.focus(); pick(a.id); }}
                className={cn(MENU_ITEM, "items-center gap-2.5", current === a.id && "font-medium")}>
                <Avatar agent={a} />
                <span className="min-w-0 flex-1 truncate text-left">{a.label}</span>
                <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[a.status])} />
              </button>
            ))}
          </Popover>
        )}
      </>
    );
  }

  return (
    <div role="group" aria-label={t("studio.office.team.button", "Team")} data-team-strip={officeId}
      className={cn("pointer-events-auto relative z-10 flex max-w-full flex-wrap items-center gap-1.5", !shown && "sr-only focus-within:not-sr-only")}>
      {shown && <span aria-hidden="true" className={cn("inline-flex h-8 items-center px-3 text-[12px] font-medium text-[rgb(var(--ink-2))]", CHIP)}>{t("studio.office.team.talkTo", "Talk to")}</span>}
      {agents.map((a) => (
        <button key={a.id} type="button" data-team-agent={a.id} aria-label={talkTo(a)} aria-pressed={current === a.id}
          title={t("studio.office.team.talkToName", "Talk to {name}", { name: a.label })}
          onClick={() => pick(a.id)}
          className={cn("inline-flex items-center gap-2 text-[13px] transition", shown ? "h-8 py-0.5 pl-0.5 pr-2.5" : "h-9 py-1 pl-1 pr-3", CHIP, FOCUS,
            current === a.id ? "ring-2 ring-[rgb(var(--brand-500))]" : "hover:bg-[rgb(var(--surface))]")}>
          <Avatar agent={a} />
          <span className="font-medium">{a.label}</span>
          <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", STATUS_DOT[a.status])} />
        </button>
      ))}
    </div>
  );
}
