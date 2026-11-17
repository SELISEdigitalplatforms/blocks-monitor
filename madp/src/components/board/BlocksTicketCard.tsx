import { useEffect, useRef } from "react";
import { BookOpen, Clock, ListChecks, ListTodo, Wrench } from "lucide-react";
import { fmtWhen } from "@/components/intake/IntakeShared";
import type { DeliveryTicket } from "@/blocks/delivery/types";
import { Avatar, Chip, Dot } from "@/ui/kit";
import { agentInitialsOf, agentName, ticketCode, ticketStatusLine, typeLabel } from "./blocksBoard";
import { useT } from "@/i18n";
import { estimateTicket } from "@/domain/engineEstimate";
import { useEstimates } from "@/components/build/EstimatesContext";
import { ticketEstimateText, ticketEstimateTitle } from "@/components/build/estimateText";

const TYPE_ICON = { story: BookOpen, task: ListTodo, fix: Wrench } as const;

/** One ticket. The MADP agents move it, so it is a plain button that opens the detail drawer. Every value is the
 *  stored Ticket row; `live` (a build job is active) only makes the dot of a ticket in progress pulse. `agent` is the
 *  role the ticket is credited to (blocksBoard.ts creditedAgent; the stored role when not given); `change` the change
 *  request it belongs to ("CR-006"), shown in place of its lane, and `stopped` that its build stopped (the one rule:
 *  src/components/changes/changeStopped.ts). */
export function BlocksTicketCard({ ticket: tk, feature, milestone, agent, change = null, stopped = false, live = false, onOpen, highlighted = false }: {
  ticket: DeliveryTicket; feature: string; milestone?: string; agent?: string; change?: string | null; stopped?: boolean; live?: boolean;
  onOpen: (id: string) => void; highlighted?: boolean;
}) {
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  // a linked ticket scrolls into view once, when the card first renders highlighted
  useEffect(() => {
    if (!highlighted || typeof window === "undefined" || typeof ref.current?.scrollIntoView !== "function") return;
    const calm = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current.scrollIntoView({ block: "center", inline: "nearest", behavior: calm ? "auto" : "smooth" });
  }, [highlighted]);
  const Icon = TYPE_ICON[tk.type];
  const code = ticketCode(tk);
  const done = tk.isDone;
  const working = !done && tk.column !== "planned";
  // the real estimate: what the ticket adds to its build's time on MADP (src/domain/engineEstimate.ts), never the stored
  // person-hours; nothing without enough measured builds
  const estimate = estimateTicket(useEstimates(), tk.type);
  const role = agent ?? tk.agent;
  const halted = !done && stopped;
  const status = ticketStatusLine({ done, doneAt: tk.doneAt ? fmtWhen(tk.doneAt) : null, milestone, change, stopped });
  return (
    <li>
      <button ref={ref} type="button" data-ticket-id={tk.id} onClick={() => onOpen(tk.id)} aria-label={`${code}: ${tk.title}`}
        {...(highlighted ? { "data-highlighted": "", "aria-current": true } : {})}
        className={`flex w-full flex-col gap-2 rounded-card bg-surface p-4 text-left shadow-card outline-none focus-visible:ring-2 focus-visible:ring-accent/50${highlighted ? " ring-2 ring-accent" : ""}`}>
        <span className="flex items-center justify-between gap-2">
          <span className="num font-mono text-[12px] text-ink3">{code}</span>
          <Chip tone={tk.type === "fix" ? "warning" : "neutral"} icon={<Icon size={12} strokeWidth={1.75} aria-hidden />}>{typeLabel(tk.type)}</Chip>
        </span>
        <span className="line-clamp-2 text-[14px] font-medium [overflow-wrap:anywhere]">{tk.title}</span>
        <span className="text-[12px] text-ink2 [overflow-wrap:anywhere]">{feature}</span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink3">
          <span className="inline-flex items-center gap-1.5">
            <Avatar initials={agentInitialsOf(role)} size={24} tone="soft" />{agentName(role)}
          </span>
          {estimate && <span className="num inline-flex items-center gap-1" title={ticketEstimateTitle(estimate)}><Clock size={12} strokeWidth={1.75} aria-hidden />{ticketEstimateText(estimate)}</span>}
          <span className="inline-flex items-center gap-1"><ListChecks size={12} strokeWidth={1.75} aria-hidden />{tk.acceptance.length === 1 ? t("build.proofDrawer.criterion", "1 criterion") : t("build.proofDrawer.criteria", "{count} criteria", { count: tk.acceptance.length })}</span>
        </span>
        {status && (
          <span className="flex items-center gap-2 text-[12px] text-ink3">
            <Dot tone={done ? "success" : halted ? "danger" : "accent"} pulse={working && live && !halted} />
            <span className="min-w-0 [overflow-wrap:anywhere]">{status}</span>
          </span>
        )}
      </button>
    </li>
  );
}
