/** "Things that don't agree": where your files contradict each other. Nothing is decided silently: you hand each one
 *  to the business analyst, who settles it with you on the next step. */
import { useT } from "@/madp/i18n";
import { MessagesSquare, TriangleAlert } from "lucide-react";
import { Button, Card, Chip } from "@/madp/ui/kit";
import type { BriefConflict } from "./briefApi";

export function ConflictsCard({ conflicts, actions, pendingKey, onSettle }: {
  conflicts: readonly BriefConflict[];
  actions: boolean;
  pendingKey: string | null;
  onSettle: (key: string, toProductManager: boolean) => void;
}) {
  const t = useT();
  if (!conflicts.length) return null;
  const open = conflicts.filter((c) => !c.resolution).length;
  return (
    <div id="understanding-conflicts" className="scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)]">
      <Card title={t("analysis.understanding.conflictsTitle", "Things that don't agree")} icon={<TriangleAlert size={18} strokeWidth={1.75} className="text-[rgb(var(--c-warning-text))]" />}
        action={open ? <Chip tone="warning">{t("analysis.understanding.toSettleCount", "{count} to settle", { count: open })}</Chip> : <Chip tone="success">{t("analysis.understanding.allSettled", "All settled")}</Chip>}>
        <ul className="flex flex-col gap-2">
          {conflicts.map((c) => (
            <li key={c.key} className="flex min-w-0 flex-wrap items-start gap-x-3 gap-y-2 rounded-block bg-surface2 px-4 py-3">
              <div className="min-w-0 flex-1 basis-56">
                <p className="break-words text-[15px] leading-snug text-ink">{c.description}</p>
                {c.sources.length > 0 && <p className="mt-0.5 text-[12px] text-ink3">{t("analysis.understanding.foundIn", "Found in {sources}", { sources: c.sources.join(", ") })}</p>}
                {c.resolution && (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-[rgb(var(--c-success-text))]">
                    <MessagesSquare size={14} aria-hidden className="mt-0.5 shrink-0" />{c.resolution}
                  </p>
                )}
              </div>
              {actions && (
                c.resolution
                  ? <Button size="sm" variant="ghost" disabled={pendingKey === c.key} onClick={() => onSettle(c.key, false)}>{t("analysis.understanding.undo", "Undo")}</Button>
                  : <Button size="sm" variant="secondary" disabled={pendingKey === c.key} onClick={() => onSettle(c.key, true)}>{t("analysis.understanding.letAnalystSettle", "Let the business analyst settle it")}</Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
