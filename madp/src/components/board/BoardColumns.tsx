import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { reducedMotion } from "@/components/intake/IntakeShared";
import { agentLabel, COLUMNS, type ColumnId } from "@/data/board";
import type { DeliveryTicket } from "@/blocks/delivery/types";
import { Chip } from "@/ui/kit";
import { BlocksTicketCard } from "./BlocksTicketCard";
import { ticketCode } from "./blocksBoard";
import { columnName } from "./TicketHistory";
import { useFlip } from "./useFlip";
import { useT } from "@/i18n";

/** The eight columns of MADP's pipeline, filled from the stored Ticket rows. The only horizontal scroller on the page.
 *  A ticket whose stored column changed since the last read glides to its new place (useFlip) and the move is
 *  announced to screen readers. */
export function BoardColumns({ tickets, all, featureName, milestoneName, changeOf, agentOf, live, filterKey, onOpen, highlightTicketId }: {
  tickets: DeliveryTicket[]; all: DeliveryTicket[]; featureName: (ref: string) => string; milestoneName: (id: string | null) => string;
  /** The change request a ticket belongs to ("CR-006") and whether its build stopped; null for a milestone's ticket. */
  changeOf?: (t: DeliveryTicket) => { code: string; stopped: boolean } | null;
  /** The role a ticket is credited to (blocksBoard.ts creditedAgent). */
  agentOf?: (t: DeliveryTicket) => string;
  live: boolean; filterKey: string; onOpen: (id: string) => void; highlightTicketId?: string | null;
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const cols: Record<string, string> = {};
  for (const tk of all) cols[tk.id] = tk.column;
  useFlip(ref, cols, filterKey);

  // the board's top offset in the page, so its height is the rest of the viewport
  const [top, setTop] = useState(240);
  useLayoutEffect(() => {
    const fit = () => { const r = ref.current?.getBoundingClientRect(); if (r) setTop(Math.max(0, Math.round(r.top + window.scrollY))); };
    fit();
    window.addEventListener("resize", fit);
    // the Board tab can mount hidden (another Build tab open); measure again once it is shown
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(fit) : null;
    if (ro && ref.current) ro.observe(ref.current);
    return () => { window.removeEventListener("resize", fit); ro?.disconnect(); };
  }, []);

  // announce the latest move to screen readers
  const seen = useRef<Record<string, ColumnId> | null>(null);
  const [said, setSaid] = useState("");
  useEffect(() => {
    const prev = seen.current;
    const now: Record<string, ColumnId> = {};
    for (const tk of all) {
      now[tk.id] = tk.column;
      if (prev && prev[tk.id] && prev[tk.id] !== tk.column) setSaid(t("build.board.movedTo", "{code} moved to {column}", { code: ticketCode(tk), column: columnName(tk.column) }));
    }
    seen.current = now;
  }, [all]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    // fills the rest of the viewport, so its horizontal scrollbar is always on screen
    <div ref={ref} role="region" aria-label={t("build.board.region", "Task board")} tabIndex={0} style={{ height: `max(480px, calc(100dvh - ${top}px - 24px))` }}
      onFocus={(e) => { if (e.target !== e.currentTarget) e.target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: reducedMotion() ? "auto" : "smooth" }); }}
      className="scroll-thin min-w-0 max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
      <div className="flex h-full gap-4 snap-x snap-mandatory pb-3 md:snap-none">
        {COLUMNS.map((c) => {
          const items = tickets.filter((tk) => tk.column === c.id);
          return (
            <section key={c.id} aria-label={`${columnName(c.id)}, ${items.length}`} className="flex min-h-0 w-[85vw] max-w-[340px] shrink-0 snap-start flex-col rounded-card bg-surface2 p-3 md:w-80 md:min-w-[300px] 2xl:w-auto 2xl:max-w-none 2xl:flex-1">
              <header className="flex shrink-0 items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-[14px] font-medium">{columnName(c.id)}</h3>
                  {c.stage && <div className="text-[12px] text-ink3">{agentLabel(c.stage)}</div>}
                </div>
                <Chip className="num">{items.length}</Chip>
              </header>
              {items.length ? (
                <ol className="scroll-thin mt-3 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-0.5">
                  {items.map((tk) => {
                    const cr = changeOf?.(tk) ?? null;
                    return (
                      <BlocksTicketCard key={tk.id} ticket={tk} feature={featureName(tk.featureRef)} milestone={milestoneName(tk.milestoneId)}
                        agent={agentOf?.(tk)} change={cr?.code ?? null} stopped={cr?.stopped ?? false}
                        live={live} onOpen={onOpen} highlighted={tk.id === highlightTicketId} />
                    );
                  })}
                </ol>
              ) : (
                <div className="hatched mt-3 rounded-block px-3 py-6 text-center text-[12px] text-ink3">{t("build.board.noTickets", "No tickets")}</div>
              )}
            </section>
          );
        })}
      </div>
      <div aria-live="polite" className="sr-only">{said}</div>
    </div>
  );
}
