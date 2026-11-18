/** Glass panels docked on the office stage: a stat chip and the agent
 *  inspector (every agent, its station, status and current action; the agent picked on the stage is
 *  highlighted and scrolled into view inside the list). Ported from MADP Studio, fed by props. */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { STAGES } from "@/madp/data/pipeline";
import { cn } from "@/madp/lib/cn";
import { since } from "./format";
import type { AgentView } from "./model";
import { useOfficeStage } from "./officeStore";
import { ROLE_META, agentStatusText, roleStation } from "./roles";
import { useT } from "@/madp/i18n";

export function Stat({ icon, label, value, tone }: { icon: ReactNode; label: string; value: ReactNode; tone: string }) {
  return (
    <div className="glass-card flex items-center gap-3 rounded-[1.125rem] px-4 py-2.5">
      <span className={cn("inline-flex size-8 items-center justify-center rounded-[0.875rem] bg-white/15 [&_svg]:size-4", tone)}>{icon}</span>
      <div className="leading-tight">
        <div className="text-[0.625rem] font-semibold uppercase tracking-[0.16em] text-white/70">{label}</div>
        <div className="text-xl font-semibold tabular-nums">{value}</div>
      </div>
    </div>
  );
}

const STAGE_NAME = new Map(STAGES.map((s) => [s.id, s.name]));
const busy = (a: AgentView) => a.status === "working" || a.status === "waiting" || a.status === "returning";

/** The inspector: every agent in the office, its station, status and current action. */
export function Inspector({ officeId, agents, className }: { officeId: string; agents: AgentView[]; className?: string }) {
  const t = useT();
  const selected = useOfficeStage((s) => (s.selected?.office === officeId ? s.selected.agent : null));
  const listRef = useRef<HTMLUListElement>(null);
  const rows = useRef(new Map<string, HTMLLIElement>());
  const ticking = agents.some(busy);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);

  // scroll only the list (never the page) so the picked agent's row is visible
  useEffect(() => {
    const ul = listRef.current;
    const row = selected ? rows.current.get(selected) : undefined;
    if (!ul || !row) return;
    if (row.offsetTop >= ul.scrollTop && row.offsetTop + row.offsetHeight <= ul.scrollTop + ul.clientHeight) return;
    const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    ul.scrollTo({ top: row.offsetTop - (ul.clientHeight - row.offsetHeight) / 2, behavior });
  }, [selected]);

  const active = new Set(agents.filter((a) => a.status === "working" && a.stage).map((a) => a.stage)).size;
  return (
    <aside aria-label={t("studio.office.inspector.label", "Agents")} className={cn("glass-card absolute bottom-5 right-5 top-[5.25rem] z-20 flex w-[22rem] flex-col overflow-hidden rounded-3xl", className)}>
      <div className="px-5 pb-2 pt-5">
        <div className="text-[0.625rem] font-semibold uppercase tracking-[0.2em] text-white/70">{t("studio.office.inspector.title", "Inspector")}</div>
        <div className="mt-0.5 text-[0.9375rem] font-medium">
          {!agents.length ? t("studio.office.inspector.arriveFirstStage", "The agents arrive with the first stage")
            : !active ? t("studio.office.inspector.atWork", "MADP agents at work")
            : active === 1 ? t("studio.office.inspector.atWorkOneStage", "MADP agents at work · 1 stage running")
            : t("studio.office.inspector.atWorkStages", "MADP agents at work · {n} stages running", { n: active })}
        </div>
      </div>
      <ul ref={listRef} className="relative min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
        {agents.map((a) => {
          const meta = ROLE_META[a.role];
          const ring = a.status === "fail" ? "ring-[rgb(255_120_130)]" : a.status === "waiting" || a.status === "returning" ? "ring-[rgb(255_200_90)]" : a.status === "working" ? "ring-white" : a.status === "pass" ? "ring-[rgb(110_230_160)]" : "ring-white/30";
          const status = agentStatusText(a);
          const stage = a.stage ? `${a.stage === "deploy" ? t("studio.office.inspector.deploy", "Deploy") : `${a.stage} ${STAGE_NAME.get(a.stage) ?? ""}`}` : undefined;
          return (
            <li key={a.id}
              ref={(el) => { if (el) rows.current.set(a.id, el); else rows.current.delete(a.id); }}
              aria-current={selected === a.id ? "true" : undefined}
              className={cn("flex items-start gap-3 rounded-[1.125rem] px-3 py-2.5 transition-colors",
                selected === a.id ? "bg-white/15 ring-1 ring-inset ring-white/70" : "hover:bg-white/10")}>
              <span className={cn("relative mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full text-white ring-2 ring-offset-2 ring-offset-transparent [&_svg]:size-4", ring)}
                style={{ background: `rgb(var(${meta.color}))` }}>
                {meta.icon}
                {a.status === "working" && <span className="fo-animate-ping2 absolute inset-0 rounded-full bg-white/30" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[0.8125rem] font-semibold leading-[1.125rem]">{a.label}</span>
                  <span className="shrink-0 text-[0.6875rem] text-white/70">{status}{a.since && busy(a) ? ` · ${since(a.since, now)}` : ""}</span>
                </div>
                <div className={cn("mt-0.5 line-clamp-2 text-xs", a.status === "fail" ? "text-[rgb(255_170_180)]" : "text-white/80")}>
                  {busy(a) && a.detail ? a.detail : [stage, roleStation(a.role)].filter(Boolean).join(" · ")}
                </div>
              </div>
            </li>
          );
        })}
        {!agents.length && <li className="px-3 py-6 text-center text-[0.8125rem] text-white/75">{t("studio.office.inspector.noAgents", "No agents yet.")}</li>}
      </ul>
    </aside>
  );
}
