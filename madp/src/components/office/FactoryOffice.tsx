/** FactoryOffice: the live 3D factory (MADP Studio's 3D office, ported) driven by the pipeline state.
 *  API CONTRACT, keep it stable: the build screen and the management view import this component.
 *
 *  Stages map to agents (see fromPipeline.ts): 01 Business analyst, 02 Tech lead, 03 Reviewer, 04 Tester,
 *  05 SecOps, 06 Docs, 07 + deploy Release gate. planned = idle at its station, active = working with
 *  the caption bubble, done = finished, sent-back = walking back (a send-back puts the developer back
 *  at the desks), blocked = waiting. "full" is the build-screen stage (zoom, pan, orbit, labels, role
 *  legend, clickable agents); "compact" is a light card version (no controls, shadows or signs).
 *  `follow` keeps every busy agent in frame (both variants); `paused` holds the floor still. With `chat`, a click on an
 *  agent, its head label or its "Talk to" button in the Team strip opens its chat, docked on the stage's right.
 *  The 3D chunk is lazy-loaded when the stage scrolls into view; without WebGL the 2D floor plan shows instead.
 *  The office's own inspector panel is exported from ./StagePanels (Inspector) for hosts that want it. */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { StageState } from "@/data/pipeline";
import { cn } from "@/lib/cn";
import "./office.css";
import { teamFromStages } from "./fromPipeline";
import { Office } from "./index";
import type { AgentStatus, OfficeView } from "./model";
import { useOfficeStage } from "./officeStore";
import { stageStatusText } from "./roles";
import { useCulture, useT } from "@/i18n";
import { ChatLayer } from "./ChatLayer";
import { TeamStrip } from "./TeamStrip";

export interface FactoryOfficeProps {
  /** one entry per pipeline stage (every agent stage, then the deploy) */
  stages: StageState[];
  /** camera follows the active station */
  follow?: boolean;
  /** what the team is doing, e.g. "Build · 40%"; the host shows it beside the stage, and compact cards with one leave
   *  the agents' speech bubbles off */
  caption?: string;
  /** compact = small card view (home, management), full = the build screen canvas */
  variant?: "compact" | "full";
  /** the build is paused: the agents hold still, without bubbles */
  paused?: boolean;
  className?: string;
  /** upper bound for the device pixel ratio */
  maxDpr?: number;
  /** agent selection, the chat panel and the Team strip */
  chat?: boolean;
  /** a click on an agent opens the host's target (e.g. Build Studio from the home card) */
  onAgentOpen?: () => void;
  /** the Blocks project the agent chat talks about; without it the route or current project is used */
  projectId?: string | null;
  /** px at the top the host covers with its own header (compact cards frame the room below it) */
  reserveTop?: number;
}

export function FactoryOffice({ stages, follow = false, caption, variant = "full", paused = false, className, maxDpr, chat = false, onAgentOpen, projectId, reserveTop }: FactoryOfficeProps) {
  const t = useT();
  const culture = useCulture();
  const officeId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  // a narrow stage (phones) offers the Team button: its agents are too small to tap
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || !chat || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setNarrow(e.contentRect.width < 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, [chat]);
  const full = variant === "full";
  // the chat panel docks on the right: the Team strip keeps to the part left of it
  const docked = useOfficeStage((s) => s.docked === officeId);
  const key = stages.map((s) => `${s.id}:${s.status}:${s.caption ?? ""}`).join("|");
  // when each agent's status last changed: done agents hold a moment before they go for a coffee
  const stamps = useRef(new Map<string, { status: AgentStatus; since?: string }>());
  const view = useMemo<OfficeView>(() => {
    const team = teamFromStages(stages);
    const at = new Date().toISOString();
    const agents = team.agents.map((a) => {
      const prev = stamps.current.get(a.id);
      const since = !prev ? undefined : prev.status !== a.status ? at : prev.since;
      stamps.current.set(a.id, { status: a.status, since });
      return { ...a, since };
    });
    return { run: officeId, status: team.status, gate: team.gate, agents };
    // the key captures every stage field the office shows; the language changes the agents' names and captions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, officeId, culture]);

  const summary = view.agents.map((a) => `${a.label} ${a.stageStatus ? stageStatusText(a.stageStatus) : a.status}`).join(", ");

  return (
    <section ref={sectionRef} aria-label={t("studio.office.stage.label", "The factory: {summary}", { summary })}
      className={cn("factory-office fo-stage-env relative isolate overflow-hidden rounded-card text-white dark:ring-1 dark:ring-inset dark:ring-line", full ? "min-h-[320px]" : "min-h-[220px]", className)}>
      <div className="absolute inset-0">
        <Office view={view} variant={variant} follow={follow} paused={paused} bubbles={full || !caption} height="100%" maxDpr={maxDpr} chat={chat}
          onAgentOpen={onAgentOpen ? () => onAgentOpen() : undefined} reserveTop={reserveTop} />
      </div>
      {chat && (
        <div data-stage-bottom className={cn("pointer-events-none absolute z-20 flex flex-col items-start gap-2", full ? "bottom-5 left-5 right-5" : "bottom-3 left-3 right-3", docked && (full ? "sm:right-[392px]" : "sm:right-[364px]"))}>
          <TeamStrip officeId={officeId} agents={view.agents} narrow={narrow} shown={full} />
        </div>
      )}
      {chat && <ChatLayer officeId={view.run} agents={view.agents} stages={stages} stage={sectionRef} compact={!full} projectId={projectId} />}
    </section>
  );
}
