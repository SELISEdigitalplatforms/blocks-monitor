/** The warning a sign-off dialog shows (the scope lock, the requirements approval) when comments are still under way:
 *  the items the team still works on, and the items the team updated that wait for the person. Plain names only. */
import { Clock, MessageSquareText } from "lucide-react";
import { type PendingFeedback } from "@/madp/domain/pendingFeedback";
import { useT } from "@/madp/i18n";

const MAX_SHOWN = 6;

function Names({ names }: { names: readonly string[] }) {
  const shown = names.slice(0, MAX_SHOWN);
  const more = names.length - shown.length;
  const t = useT();
  return (
    <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-ink2">
      {shown.map((n, i) => <li key={`${n}-${i}`} className="break-words">{n}</li>)}
      {more > 0 && <li>{more === 1 ? t("project.pending.oneMore", "1 more item") : t("project.pending.moreItems", "{count} more items", { count: more })}</li>}
    </ul>
  );
}

export function PendingFeedbackNote({ pending, workingNote, waitingNote }: {
  pending: PendingFeedback;
  /** what continuing means while the team still works on the comments */
  workingNote: string;
  /** what the person may want to do with the updates first */
  waitingNote: string;
}) {
  const t = useT();
  if (pending.working.length === 0 && pending.waiting.length === 0) return null;
  return (
    <div className="flex flex-col gap-3 text-[13px]">
      {pending.working.length > 0 && (
        <div role="note" className="rounded-block bg-warning-soft/60 px-4 py-3 text-ink">
          <p className="flex items-center gap-2 font-medium">
            <Clock size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-[rgb(var(--c-warning-text))]" />
            {t("project.pending.workingTitle", "Some comments are still being worked on")}
          </p>
          <Names names={pending.working} />
          <p className="mt-1.5 text-ink2">{workingNote}</p>
        </div>
      )}
      {pending.waiting.length > 0 && (
        <div role="note" className="rounded-block bg-surface2 px-4 py-3 text-ink">
          <p className="flex items-center gap-2 font-medium">
            <MessageSquareText size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-ink3" />
            {t("project.pending.waitingTitle", "Updates waiting for you")}
          </p>
          <Names names={pending.waiting} />
          <p className="mt-1.5 text-ink2">{waitingNote}</p>
        </div>
      )}
    </div>
  );
}
