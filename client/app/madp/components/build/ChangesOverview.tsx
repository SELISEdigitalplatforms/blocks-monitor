/** The Build step's Overview for a product that works through change requests (an existing product attached as it is
 *  live, without milestones): the change the step is about now (its state, its tickets, how its build stopped) and
 *  every change request with its state and tickets, instead of milestones it never had. The same records as the
 *  Board, the Queue and the change request pages; a stopped build reads by the one rule
 *  (src/components/changes/changeStopped.ts). Nothing here is invented. */
import { Link } from "react-router-dom";
import type { DeliveryChangeRequest, DeliveryTicket } from "@/madp/blocks/delivery/types";
import type { EngineJob } from "@/madp/blocks/engine/types";
import { latestJobFor } from "@/madp/blocks/delivery/hooks";
import { changeCode } from "@/madp/domain/delivery";
import { incrementsOf, parseChangeAnalysis } from "@/madp/domain/changeAnalysis";
import { changeOf } from "@/madp/domain/buildQueue";
import { changeStatusWord, stoppedLine, stoppedWord } from "@/madp/components/changes/changeStopped";
import { crStatusLabel } from "@/madp/components/delivery/releaseUi";
import { useT } from "@/madp/i18n";
import { ticketCount } from "@/madp/components/changes/changeFlow";
import { Bar, Card, Chip } from "@/madp/ui/kit";
import type { ChipTone } from "@/madp/data/types";
import { cn } from "@/madp/lib/cn";
import { byNewestNumber } from "@/madp/lib/newest";
import { prefixPath } from "@/madp/lib/pathPrefix";
import { isActiveEngineJob } from "@/madp/blocks/engine/types";

/** The chip tone of a change request's word (changeStatusWord), in the language it was said in. */
const toneOf = (word: string): ChipTone => ({
  [stoppedWord()]: "danger", [crStatusLabel("building")]: "accent", [crStatusLabel("approved")]: "success", [crStatusLabel("released-dev")]: "success",
  [crStatusLabel("promoted-stage")]: "success", [crStatusLabel("promoted-production")]: "success", [crStatusLabel("review")]: "warning",
  [crStatusLabel("questions")]: "warning", [crStatusLabel("rejected")]: "danger",
} as Record<string, ChipTone>)[word] ?? "neutral";

/** The tickets of each change request (PlanRef cr:<id>:<k> or fx:<n>:<id>[:k]): done and all. */
export function changeTickets(tickets: readonly Pick<DeliveryTicket, "planRef" | "isDone" | "column">[]): Map<string, { done: number; total: number }> {
  const out = new Map<string, { done: number; total: number }>();
  for (const t of tickets) {
    const id = changeOf(t.planRef);
    if (!id) continue;
    const n = out.get(id) ?? { done: 0, total: 0 };
    n.total += 1;
    if (t.isDone || t.column === "done") n.done += 1;
    out.set(id, n);
  }
  return out;
}

/** What the step's header says about the change in focus (buildStep's `change`): its one sentence, the increment its
 *  run works on and that increment's tickets, so the card reads the same as the header. */
export interface ChangeNow {
  number: number | null;
  line: string;
  increment: { n: number; of: number; title: string } | null;
  tickets: { done: number; total: number };
}

export function ChangesOverview({ projectId, changes, tickets, jobs, focusNumber, now = null, onOpenBoard, onOpenQueue }: {
  projectId: string;
  changes: readonly DeliveryChangeRequest[];
  tickets: readonly DeliveryTicket[];
  jobs: readonly EngineJob[];
  /** The change request the step is about now (its build runs, or it is the newest build); null before any. */
  focusNumber: number | null;
  /** The header's words about it (buildStep `change`); without them the card counts the whole change. */
  now?: ChangeNow | null;
  onOpenBoard: () => void;
  onOpenQueue?: () => void;
}) {
  const t = useT();
  const counts = changeTickets(tickets);
  const focus = focusNumber !== null ? changes.find((c) => c.number === focusNumber) ?? null : null;
  const newest = (c: DeliveryChangeRequest) => latestJobFor(jobs, "change.build", { changeRequestId: c.id });
  const pathOf = (c: DeliveryChangeRequest) => prefixPath(`/p/${projectId}/build?cr=${c.number}`);

  const focusCard = (() => {
    if (!focus) {
      return (
        <Card className="min-w-0 self-start">
          <p className="text-[14px] text-ink2">{t("changes.overview.none", "No change has been built yet. Each approved change request is built here and put on the development environment.")}</p>
        </Card>
      );
    }
    const job = newest(focus);
    const word = changeStatusWord(focus, job);
    const code = changeCode(focus);
    // the header's words when it is about this change: the increment its run works on, never the whole change's count
    const said = now && now.number === focus.number ? now : null;
    const inc = said?.increment && said.increment.of > 1 ? said.increment : null;
    const tk = inc && said ? said.tickets : counts.get(focus.id) ?? { done: 0, total: 0 };
    const pct = tk.total ? Math.round((tk.done / tk.total) * 100) : 0;
    const stopped = word === stoppedWord();
    const line = stopped ? stoppedLine(code, job?.message)
      : said ? said.line
        : job && isActiveEngineJob(job) ? `${t("build.step.team.build", "The development team is building {what}", { what: code })}.`
          : focus.version ? t("changes.overview.version", "Version {version}.", { version: focus.version }) : null;
    return (
      <Card className="min-w-0 self-start">
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink3">
          <span className="num font-mono">{code}</span>
          <Chip tone={toneOf(word)}>{word}</Chip>
        </div>
        <h3 className="mt-2 text-[20px] font-medium leading-snug tracking-[-0.01em] [overflow-wrap:anywhere]">{focus.title || t("changes.page.title", "Change request")}</h3>
        {line && <p className={cn("mt-1.5 max-w-[70ch] text-[14px] leading-relaxed", stopped ? "text-ink" : "text-ink2")}>{line}</p>}
        <div className="mt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[14px] font-medium text-ink">
              {inc ? t("changes.overview.ticketsInIncrement", "{done} of {total} tickets done in increment {n} of {of}", { done: tk.done, total: tk.total, n: inc.n, of: inc.of })
                : t("build.overview.ticketsDone", "{done} of {total} tickets done", { done: tk.done, total: tk.total })}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <button type="button" onClick={onOpenBoard} className="text-[13px] font-medium text-[rgb(var(--c-accent-text))] underline-offset-2 hover:underline">{t("build.overview.seeBoard", "See them on the board")}</button>
              {onOpenQueue && <button type="button" onClick={onOpenQueue} className="text-[13px] font-medium text-[rgb(var(--c-accent-text))] underline-offset-2 hover:underline">{t("build.overview.seeQueue", "See the queue")}</button>}
            </span>
          </div>
          <Bar value={pct} tone={stopped ? "danger" : pct === 100 ? "success" : "accent"} className="mt-2 h-2" />
        </div>
        <Link to={pathOf(focus)} className="mt-4 inline-block text-[13px] font-medium text-[rgb(var(--c-accent-text))] underline-offset-2 hover:underline">{t("build.step.change.open", "Open {code}", { code })}</Link>
      </Card>
    );
  })();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      {focusCard}
      <ChangeRequestsCard projectId={projectId} changes={changes} tickets={tickets} jobs={jobs} focusId={focus?.id ?? null} />
    </div>
  );
}

/** How many increments a change is built in (1 for a change in one build or one that can't be read). */
const incrementCount = (c: Pick<DeliveryChangeRequest, "analysis">): number => {
  const a = c.analysis ? parseChangeAnalysis(c.analysis) : null;
  return a?.route === "feature" && a.feature ? incrementsOf(a).length : 1;
};

/** Every change request with its state (the one rule for a stopped build), its tickets and its version, newest first;
 *  each opens its page. The Overview's side card and the Timeline's list for a product that works through change
 *  requests. */
export function ChangeRequestsCard({ projectId, changes, tickets, jobs, focusId = null }: {
  projectId: string;
  changes: readonly DeliveryChangeRequest[];
  tickets: readonly DeliveryTicket[];
  jobs: readonly EngineJob[];
  focusId?: string | null;
}) {
  const t = useT();
  const counts = changeTickets(tickets);
  const sorted = byNewestNumber(changes, (c) => c.number);
  return (
    <Card title={t("changes.overview.all", "All change requests")} className="min-w-0">
      {sorted.length === 0 ? <p className="text-[14px] text-ink2">{t("changes.overview.empty", "No change requests yet.")}</p> : (
        <ol id="build-changes" tabIndex={-1} className="flex flex-col outline-none">
          {sorted.map((c) => {
            const word = changeStatusWord(c, latestJobFor(jobs, "change.build", { changeRequestId: c.id }));
            const tk = counts.get(c.id);
            // the whole change's tickets: over all its increments when it is built in several (never one increment's)
            const incs = incrementCount(c);
            return (
              <li key={c.id} className={cn("flex min-w-0 items-start gap-3 border-b border-line py-3 last:border-b-0", c.id === focusId && "font-medium")}>
                <Link to={prefixPath(`/p/${projectId}/build?cr=${c.number}`)} className="num shrink-0 pt-px font-mono text-[13px] text-[rgb(var(--c-accent-text))] underline-offset-2 hover:underline">{changeCode(c)}</Link>
                <div className="min-w-0 flex-1">
                  <p className="min-w-0 break-words text-[14px] text-ink">{c.title || t("changes.page.title", "Change request")}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] font-normal text-ink3">
                    <span className={word === stoppedWord() ? "text-[rgb(var(--c-danger-text))]" : undefined}>{word}</span>
                    {tk && (<><span aria-hidden>·</span><span className="num">{incs > 1
                      ? t("changes.overview.ticketsOverIncrements", "{done} of {tickets} done over {count} increments", { done: tk.done, tickets: ticketCount(tk.total), count: incs })
                      : t("changes.overview.ticketsDone", "{done} of {tickets} done", { done: tk.done, tickets: ticketCount(tk.total) })}</span></>)}
                    {c.version && (<><span aria-hidden>·</span><span className="num font-mono">{`v${c.version}`}</span></>)}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
