/** "What we understood": the project in a few plain lines, from the guided start (the about text, the problem it
 *  solves, who will use it, what is left out). A start question left unanswered says so, with the way to add it. */
import { useT } from "@/madp/i18n";
import { Link } from "react-router-dom";
import { Lightbulb, PencilLine } from "lucide-react";
import { Card } from "@/madp/ui/kit";
import { cn } from "@/madp/lib/cn";
import type { UnderstoodLine } from "./model";

export function UnderstoodCard({ lines, setupHref, canEdit }: { lines: readonly UnderstoodLine[]; setupHref: string; canEdit: boolean }) {
  const t = useT();
  const missing = lines.some((l) => l.missing);
  return (
    <Card title={t("analysis.understanding.understoodTitle", "What we understood")} icon={<Lightbulb size={18} strokeWidth={1.75} />}
      action={canEdit ? (
        <Link to={setupHref} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium text-ink2 outline-none transition hover:bg-surface2 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/50">
          <PencilLine size={14} aria-hidden />{missing ? t("analysis.understanding.addMissing", "Add the missing answers") : t("analysis.understanding.changeInSetup", "Something's off? Change it in Project setup")}
        </Link>
      ) : undefined}>
      <dl className="flex flex-col gap-2.5">
        {lines.map((l) => (
          <div key={l.key} className="grid min-w-0 gap-0.5 sm:grid-cols-[170px_minmax(0,1fr)] sm:gap-4">
            <dt className="text-[13px] font-medium text-ink3">{l.label}</dt>
            <dd className={cn("min-w-0 break-words text-[15px] leading-snug", l.missing ? "italic text-ink3" : "text-ink")}>
              {l.text}
              {l.missing && canEdit && (
                <Link to={setupHref} className="ml-2 not-italic font-medium text-[rgb(var(--c-accent-text))] hover:underline">{t("analysis.understanding.addIt", "Add it")}</Link>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
