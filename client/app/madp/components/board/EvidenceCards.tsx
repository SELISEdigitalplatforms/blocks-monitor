import { Link } from "react-router-dom";
import { FileCheck2 } from "lucide-react";
import type { DeliveryTicketEvent } from "@/madp/blocks/delivery/types";
import { fmtWhen } from "@/madp/components/intake/IntakeShared";
import { useT } from "@/madp/i18n";

/** The proof MADP agents recorded on a ticket: its stored "artifact" TicketEvents (a file, a check, a report), in the order given (the ticket drawer gives them newest first).
 *  Nothing is derived or invented; without recorded evidence it says so. */
export function EvidenceCards({ evidence, authorOf, projectId, done }: {
  evidence: DeliveryTicketEvent[]; authorOf: (e: DeliveryTicketEvent) => string; projectId: string; done: boolean;
}) {
  const t = useT();
  if (!evidence.length) {
    return (
      <p className="hatched rounded-block px-3 py-4 text-[13px] text-ink3">
        {done ? t("build.board.evidence.none", "No evidence was recorded for this ticket.") : t("build.board.evidence.later", "Evidence appears here when MADP agents record it.")}
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <ul className="grid gap-3 sm:grid-cols-2">
        {evidence.map((e) => (
          <li key={e.id} className="min-w-0 rounded-block bg-surface2 p-3">
            <div className="flex items-center gap-2 text-[12px] text-ink3">
              <FileCheck2 size={14} strokeWidth={1.75} aria-hidden className="shrink-0" />
              <span className="min-w-0 truncate">{authorOf(e)}</span>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-[13px] leading-snug [overflow-wrap:anywhere]">{e.text || t("build.board.evidence.recorded", "Artifact recorded")}</p>
            <time dateTime={e.at} className="mt-1 block text-[12px] text-ink3">{fmtWhen(e.at)}</time>
          </li>
        ))}
      </ul>
      <Link to={`/p/${projectId}/build?tab=studio`} className="inline-block text-[12px] font-medium text-[rgb(var(--c-accent-text))] hover:underline">{t("build.board.evidence.studio", "Open in the Studio")}</Link>
    </div>
  );
}
