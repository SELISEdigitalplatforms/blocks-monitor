/** A top-down office floor, the fallback view of the 3D office (ported from MADP Studio's
 *  components/run/AgentFloor.tsx). Each agent is a character at its station; planned → idle at its
 *  station, active → working there, blocked → waiting, sent back → walking back, done → finished.
 *  Characters move between stations with CSS transitions (reduced motion honoured by the app's CSS).
 *  The Factory adds the Security lab and the Docs desk; `dense` fits it into small cards. */

import { Check, Clock, FileText, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { since } from "./format";
import type { AgentView, OfficeView, Station } from "./model";
import { ROLE_META, agentStatusText } from "./roles";
import { t, useT } from "@/i18n";

interface Pt { x: number; y: number }

const STATIONS: Record<Station, Pt & { w: number; h: number; label: () => string }> = {
  whiteboard: { x: 4, y: 6, w: 22, h: 24, label: () => t("studio.office.floor.whiteboard", "Whiteboard · plan") },
  review: { x: 4, y: 36, w: 18, h: 20, label: () => t("studio.office.floor.review", "Review desk") },
  debug: { x: 4, y: 62, w: 20, h: 30, label: () => t("studio.office.floor.debug", "Debug booth") },
  supervisor: { x: 29, y: 6, w: 14, h: 16, label: () => t("studio.office.floor.supervisor", "Supervisor") },
  lobby: { x: 46, y: 6, w: 18, h: 16, label: () => t("studio.office.floor.lobby", "Lobby · queued") },
  desks: { x: 29, y: 27, w: 35, h: 52, label: () => t("studio.office.floor.desks", "Desk cluster · tech lead") },
  door: { x: 29, y: 84, w: 35, h: 11, label: () => t("studio.office.floor.door", "Repo-lock door") },
  bench: { x: 68, y: 5, w: 28, h: 20, label: () => t("studio.office.floor.bench", "Test bench · tester") },
  security: { x: 68, y: 27.5, w: 28, h: 20, label: () => t("studio.office.floor.security", "Security lab · SecOps") },
  docs: { x: 68, y: 50, w: 28, h: 20, label: () => t("studio.office.floor.docs", "Docs desk") },
  ship: { x: 68, y: 72.5, w: 28, h: 22, label: () => t("studio.office.floor.ship", "Release gate · deploy") },
};

/** the zones the Factory's floor plan draws (the Studio's debug booth, supervisor desk, lobby and repo-lock door
 *  have no agent in the Factory) */
const ZONES: Station[] = ["whiteboard", "review", "desks", "bench", "security", "docs", "ship"];

function deskSpot(i: number, n: number): Pt {
  const cols = n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const s = STATIONS.desks;
  const c = i % cols;
  const r = Math.floor(i / cols);
  return { x: s.x + (s.w * (c + 0.5)) / cols, y: s.y + 6 + ((s.h - 8) * (r + 0.5)) / Math.max(rows, 2) };
}

function spot(a: AgentView, all: AgentView[]): Pt {
  const center = (st: Station, dx = 0, dy = 0) => ({ x: STATIONS[st].x + STATIONS[st].w / 2 + dx, y: STATIONS[st].y + STATIONS[st].h / 2 + dy });
  const peers = all.filter((x) => x.role === a.role);
  const idx = peers.indexOf(a);
  switch (a.role) {
    case "dev": {
      if (a.status === "queued") return { x: STATIONS.lobby.x + 3 + (idx % 5) * 3.4, y: STATIONS.lobby.y + 10 };
      return deskSpot(idx, Math.max(peers.length, 3));
    }
    case "qa": return center("bench", (idx - (peers.length - 1) / 2) * 7, 2);
    case "shipper": return center("ship", (idx - (peers.length - 1) / 2) * 7, 2);
    case "integrator":
      // waiting: in line outside the door; holding the lock: through the door
      return a.status === "waiting" ? { x: STATIONS.door.x - 3, y: STATIONS.door.y + STATIONS.door.h / 2 + 2 } : center("door", 3, 2);
    default: return center(a.station, 0, 2);
  }
}

const RING: Record<AgentView["status"], string> = {
  idle: "ring-[rgb(var(--line-strong))]", queued: "ring-[rgb(var(--line-strong))]", working: "ring-[rgb(var(--brand-400))]",
  waiting: "ring-[rgb(var(--warning))]", returning: "ring-[rgb(var(--warning))]", pass: "ring-[rgb(var(--success))]",
  fail: "ring-[rgb(var(--danger))]", done: "ring-[rgb(var(--line-strong))]",
};

const BADGE = "absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full text-white ring-2 ring-[rgb(var(--surface))]";

function Character({ a, pos, now, dense }: { a: AgentView; pos: Pt; now: number; dense?: boolean }) {
  const meta = ROLE_META[a.role];
  const working = a.status === "working";
  const busy = working || a.status === "waiting" || a.status === "returning";
  const status = agentStatusText(a);
  return (
    <div className="absolute z-10 -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-[1400ms] ease-[cubic-bezier(.4,0,.2,1)]"
      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}>
      <div className={cn("group relative flex flex-col items-center", a.status === "queued" && "opacity-55", a.status === "done" && "opacity-70")}>
        {busy && a.detail && (
          <div className={cn("fo-shadow-pop pointer-events-none absolute bottom-full mb-2 flex items-center gap-1 rounded-lg px-2 py-1 font-medium",
            dense ? "max-w-[9rem] text-[10px]" : "max-w-[13rem] text-[0.6875rem] leading-[0.875rem]",
            a.status === "working" ? "bg-[rgb(var(--ink))] text-[rgb(var(--surface))]" : "bg-[rgb(var(--warning))] text-[rgb(40_30_0)]")}>
            <span className="truncate">{a.detail}</span>
          </div>
        )}
        <div className={cn("relative transition-transform duration-500", working && "fo-animate-bob", a.status === "fail" && "translate-y-1 rotate-[18deg]")}>
          {working && <span className="fo-animate-ping2 absolute inset-0 rounded-full" style={{ background: `rgb(var(${meta.color}) / 0.35)` }} />}
          <div className={cn("relative flex items-center justify-center rounded-full text-white ring-offset-2 ring-offset-[rgb(var(--floor))]",
            dense ? "size-7 ring-2 [&_svg]:size-3.5" : "size-11 ring-[3px] [&_svg]:size-5", RING[a.status])}
            style={{ background: `linear-gradient(140deg, rgb(var(${meta.color})), rgb(var(${meta.color}) / 0.72))`, boxShadow: `0 8px 18px -8px rgb(var(${meta.color}) / 0.8)` }}>
            {meta.icon}
          </div>
          {!dense && a.status === "pass" && <span className={cn(BADGE, "bg-[rgb(var(--success))]")}><Check className="size-3" strokeWidth={3.5} /></span>}
          {!dense && a.status === "fail" && <span className={cn(BADGE, "bg-[rgb(var(--danger))]")}><X className="size-3" strokeWidth={3.5} /></span>}
          {!dense && a.status === "waiting" && <span className={cn(BADGE, "bg-[rgb(var(--warning))]")}><Clock className="size-3" strokeWidth={3} /></span>}
          {!dense && a.status === "returning" && <span className={cn(BADGE, "bg-[rgb(var(--warning))]")}><RotateCcw className="size-3" strokeWidth={3} /></span>}
          {working && !dense && (
            <span className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 gap-0.5 rounded-full bg-[rgb(var(--surface))] px-1.5 py-0.5 shadow-sm ring-1 ring-[rgb(var(--line))]">
              {[0, 1, 2].map((i) => <span key={i} className="fo-animate-type h-1.5 w-[3px] origin-bottom rounded-full bg-[rgb(var(--brand-500))]" style={{ animationDelay: `${i * 120}ms` }} />)}
            </span>
          )}
        </div>
        {(!dense || busy) && (
          <div className={cn("mt-1.5 whitespace-nowrap rounded-md bg-[rgb(var(--surface)/0.9)] px-1.5 py-0.5 font-semibold text-[rgb(var(--ink))] shadow-sm ring-1 ring-[rgb(var(--line))]",
            dense ? "text-[10px]" : "text-[0.6875rem] leading-[0.875rem]")}>
            {a.label}
            {!dense && <span className="ml-1 font-medium text-[rgb(var(--ink-3))]">· {status}{busy && a.since ? ` ${since(a.since, now)}` : ""}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

/** `dense`: a small card (no station names, small characters); `fill`: take the parent's height (min 360 px) */
export function AgentFloor({ view, dense, fill, className }: { view: OfficeView; dense?: boolean; fill?: boolean; className?: string }) {
  const t = useT();
  const agents = view.agents;
  const ticking = agents.some((a) => a.status === "working" || a.status === "waiting" || a.status === "returning");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!ticking || dense) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking, dense]);
  const devCount = agents.filter((a) => a.role === "dev").length;

  return (
    <div className={cn("fo-floor-grid relative w-full overflow-hidden rounded-2xl ring-1 ring-[rgb(var(--line))]", dense ? "h-full" : fill ? "h-full min-h-[360px] min-w-[640px]" : "aspect-[16/10] min-w-[640px]", className)} role="img"
      aria-label={t("studio.office.floor.label", "Factory floor: {agents}", { agents: agents.map((a) => `${a.label} ${agentStatusText(a)}`).join(", ") || t("studio.office.floor.noAgents", "no agents yet") })}>
      {ZONES.map((k) => {
        const s = STATIONS[k];
        const busy = agents.some((a) => a.station === k && (a.status === "working" || a.status === "waiting" || a.status === "returning"));
        return (
          <div key={k} className={cn("absolute rounded-2xl border border-dashed transition-colors duration-500",
            busy ? "border-[rgb(var(--brand-300))] bg-[rgb(var(--brand-500)/0.07)]" : "border-[rgb(var(--line-strong)/0.7)] bg-[rgb(var(--surface)/0.3)]")}
            style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${s.w}%`, height: `${s.h}%` }}>
            {!dense && <span className="absolute left-2.5 top-2 text-[0.6875rem] font-bold uppercase leading-[0.875rem] tracking-[0.1em] text-[rgb(var(--ink-3))]">{s.label()}</span>}
            {k === "desks" && Array.from({ length: Math.max(devCount, 3) }, (_, i) => {
              const p = deskSpot(i, Math.max(devCount, 3));
              return <span key={i} className="absolute h-[14%] w-[24%] -translate-x-1/2 rounded-lg bg-[rgb(var(--surface-3))] ring-1 ring-[rgb(var(--line))]" style={{ left: `${((p.x - s.x) / s.w) * 100}%`, top: `${((p.y - s.y) / s.h) * 100 + 9}%` }} />;
            })}
            {k === "whiteboard" && <span className="absolute inset-x-[12%] bottom-[18%] top-[30%] rounded-md bg-[rgb(var(--surface))] ring-1 ring-[rgb(var(--line))]" />}
            {k === "door" && <span className="absolute -right-px top-[22%] h-[56%] w-2 rounded-l bg-gradient-to-b from-[rgb(var(--coral))] to-[rgb(var(--coral)/0.6)]" />}
            {k === "ship" && <span className="absolute -right-px top-[20%] h-[60%] w-2 rounded-l bg-gradient-to-b from-[rgb(var(--success))] to-[rgb(var(--success)/0.6)]" />}
            {k === "security" && <ShieldCheck aria-hidden className={cn("absolute right-2 text-[rgb(var(--role-secops))] opacity-70", dense ? "top-1 size-3" : "top-2 size-4")} />}
            {k === "docs" && <FileText aria-hidden className={cn("absolute right-2 text-[rgb(var(--role-docs))] opacity-80", dense ? "top-1 size-3" : "top-2 size-4")} />}
            {k === "docs" && !dense && (
              <span aria-hidden className="absolute bottom-[14%] left-[12%] h-[34%] w-[16%]">
                {[0, 1, 2].map((i) => <span key={i} className="absolute inset-0 rounded-sm bg-[rgb(var(--surface))] ring-1 ring-[rgb(var(--line-strong))]" style={{ transform: `translate(${i * 4}px, ${-i * 4}px)` }} />)}
              </span>
            )}
          </div>
        );
      })}
      {agents.map((a) => <Character key={a.id} a={a} pos={spot(a, agents)} now={now} dense={dense} />)}
      {agents.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="fo-shadow-card rounded-2xl bg-[rgb(var(--surface)/0.9)] px-4 py-3 text-[0.8125rem] text-[rgb(var(--ink-3))]">{t("studio.office.floor.empty", "The agents arrive when the build starts its first stage.")}</div>
        </div>
      )}
    </div>
  );
}
