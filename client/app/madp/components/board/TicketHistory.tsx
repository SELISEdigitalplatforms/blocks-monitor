import { Dot } from "@/madp/ui/kit";
import { COLUMNS } from "@/madp/data/board";
import type { DeliveryTicketEvent } from "@/madp/blocks/delivery/types";
import { fmtWhen } from "@/madp/components/intake/IntakeShared";
import { t, useT } from "@/madp/i18n";

/** A column id's name ("In development"); the id itself when unknown, "" for none. */
export function columnName(id: string | null): string {
  if (!id) return "";
  switch (id) {
    case "planned": return t("build.board.column.planned", "Planned");
    case "dev": return t("build.queue.stage.dev", "In development");
    case "review": return t("build.queue.stage.review", "In review");
    case "test": return t("build.board.column.test", "In test");
    case "security": return t("build.gates.security", "Security");
    case "docs": return t("build.pipeline.docs.name", "Docs");
    case "gate": return t("build.pipeline.gate.name", "Release gate");
    case "done": return t("build.queue.status.done", "Done");
  }
  return COLUMNS.find((c) => c.id === id)?.name ?? id;
}

/** The ticket's stored moves as a timeline, in the order given (the drawer gives them newest first). A move from
 *  Security back to development is a send-back. */
export function TicketHistory({ moves, authorOf }: { moves: DeliveryTicketEvent[]; authorOf: (e: DeliveryTicketEvent) => string }) {
  const t = useT();
  if (!moves.length) return <p className="text-[13px] text-ink3">{t("build.board.history.none", "No moves yet.")}</p>;
  return (
    <ol className="space-y-3">
      {moves.map((m) => {
        const sentBack = m.fromColumn === "security" && m.toColumn === "dev";
        const label = m.fromColumn ? `${columnName(m.fromColumn)} → ${columnName(m.toColumn)}` : m.toColumn ? t("build.board.history.createdIn", "Created in {column}", { column: columnName(m.toColumn) }) : t("build.board.history.created", "Created");
        return (
          <li key={m.id} className="flex items-start gap-3">
            <span className="mt-1.5 shrink-0"><Dot tone={sentBack ? "danger" : "accent"} /></span>
            <div className="min-w-0 flex-1">
              <p className={sentBack ? "text-[13px] font-medium text-danger" : "text-[13px] font-medium"}>{label}</p>
              <p className="text-[12px] text-ink3 [overflow-wrap:anywhere]">
                {authorOf(m)} · <time dateTime={m.at}>{fmtWhen(m.at)}</time>
              </p>
              {m.text && <p className="mt-0.5 text-[13px] text-ink2 [overflow-wrap:anywhere]">{m.text}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
