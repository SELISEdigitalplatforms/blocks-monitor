/** The inspector beside the timeline: the selected stage in plain words, how far the milestone's tickets are through it,
 *  what it checked, its send-backs, its proof (the artifacts and notes the agent recorded) and its work items. Raw
 *  detail sits behind "Technical details". Every number is counted from the real tickets, events and engine job. */
import { useState, type ReactNode } from "react";
import { byNewest } from "@/lib/newest";
import { ArrowUpRight, Check, ChevronDown, FileText, LocateFixed, TriangleAlert } from "lucide-react";
import { stageDef, type StageStatus } from "@/data/pipeline";
import type { StageId } from "@/data/types";
import type { DeliveryTicket } from "@/blocks/delivery/types";
import { AGENT_NAME } from "@/lib/factoryLabels";
import { cn } from "@/lib/cn";
import { Bar, Card, Chip, Dot, Label } from "@/ui/kit";
import { fmtElapsed, STAGE_COLUMN, stagePassed, type BuildFocus, type BuildWindow, type ProofEntry, type SendBack, type StageCounts, type WorkItem } from "./model";
import { StageMarker, STATUS_TONE, STATUS_WORD } from "./stageUi";
import { t, useT } from "@/i18n";

/** The build's state in plain words (Technical details). */
const buildWord = (status: NonNullable<BuildFocus["job"]>["status"]): string => ({
  queued: t("build.jobs.status.queued", "Waiting to start"), claimed: t("build.inspector.job.claimed", "Starting"), running: t("build.inspector.job.running", "Running"),
  succeeded: t("build.timeline.finished", "Finished"), failed: t("build.step.milestone.stopped", "Stopped"), cancelled: t("build.step.milestone.stopped", "Stopped"),
} as Partial<Record<NonNullable<BuildFocus["job"]>["status"], string>>)[status] ?? t("build.jobs.status.running", "In progress");

export interface InspectorProps {
  stageId: StageId;
  status: StageStatus;
  counts: StageCounts;
  focus: BuildFocus;
  window: BuildWindow | null;
  items: WorkItem[];
  proof: ProofEntry[];
  backs: SendBack[];
  ticketCode: (t: DeliveryTicket) => string;
  columnName: (c: string) => string;
  following: boolean;
  onFollow: () => void;
  onOpenProof: (id: StageId) => void;
  className?: string;
}

export function Inspector({ stageId, status: st, counts, focus, window: w, items, proof, backs, ticketCode, columnName, following, onFollow, onOpenProof, className }: InspectorProps) {
  const t = useT();
  const def = stageDef(stageId);
  const col = STAGE_COLUMN[stageId];
  // Plan is through every ticket once it is done (the plan's tickets exist), never "0 %" next to "Verified"
  const passed = stagePassed(counts, stageId, st);
  const pct = counts.total ? Math.round((passed / counts.total) * 100) : st === "done" ? 100 : 0;
  const at = (ms: number) => (w ? fmtElapsed(ms - w.start) : "");
  // newest first: the latest send-back on top
  const mine = byNewest(backs.filter((b) => b.from === col || b.to === col), (b) => b.at);
  const openBacks = mine.filter((b) => b.phase !== "closed").length;
  const proofState = proof.length === 0 ? "none" : st === "done" ? "final" : "draft";
  const byId = new Map(focus.tickets.map((x) => [x.id, x]));
  const previewJob = stageId === "deploy" ? focus.previewJobs[0] ?? null : null;

  return (
    <Card className={cn("flex flex-col", className)} bodyClassName="md:grid md:grid-cols-2 md:gap-x-10 2xl:grid-cols-1"
      title={
        <span className="flex items-center gap-3">
          <StageMarker status={st} id={stageId} size={32} />
          <span className="leading-tight">
            <span className="block">{def.name}</span>
            {/* the board column the stage works in; Plan's tickets wait in "Planned" for the Build stage, which is no state
                of Plan itself (Technical details names the column) */}
            <span className="block text-[12px] font-normal text-ink3">{stageId === "deploy" ? t("build.inspector.platformStep", "Platform step · SELISE Blocks") : `${AGENT_NAME[stageId] === def.name ? t("build.feed.agent", "MADP agent") : AGENT_NAME[stageId]}${col && stageId !== "01" ? ` · ${columnName(col)}` : ""}`}</span>
          </span>
        </span>
      }
      action={
        <div className="flex items-center gap-2">
          <Chip tone={STATUS_TONE[st]} icon={st === "active" || st === "sent-back" ? <Dot tone={STATUS_TONE[st]} pulse /> : undefined}>{STATUS_WORD[st]}</Chip>
          <button type="button" onClick={onFollow} aria-pressed={following} title={following ? t("build.inspector.following", "Following the live stage") : t("build.inspector.follow", "Follow the live stage")}
            aria-label={following ? t("build.inspector.following", "Following the live stage") : t("build.inspector.follow", "Follow the live stage")}
            className={cn("grid h-8 w-8 place-items-center rounded-full transition", following ? "bg-accent-soft text-accent" : "bg-surface2 text-ink3 hover:text-ink")}>
            <LocateFixed size={15} strokeWidth={1.75} />
          </button>
        </div>
      }>
      {/* two columns under the timeline (md to 2xl), one beside it: what the stage does and checks | its proof */}
      <div className="min-w-0">
        {/* a change request's build plans the approved change, not a scope */}
        <p className="text-[14px] leading-relaxed text-ink2">{stageId === "01" && focus.change ? t("build.inspector.planChange", "Turns the approved change request into tickets, step by step.") : def.plain}</p>

        <Section label={t("build.inspector.progress", "Progress")}>
          <div className="flex items-end gap-3">
            <span className="num text-[40px] font-medium leading-none tracking-[-0.03em]">{pct}<span className="text-[20px] text-ink3">%</span></span>
            <span className="mb-1 text-[13px] text-ink3">{st === "done" ? t("build.timeline.finished", "Finished") : st === "planned" ? t("build.inspector.notStarted", "Not started") : counts.here ? (counts.here === 1 ? t("build.inspector.hereOne", "1 ticket here now") : t("build.inspector.here", "{count} tickets here now", { count: counts.here })) : STATUS_WORD[st]}</span>
          </div>
          <Bar value={pct} tone={st === "sent-back" || st === "blocked" ? "warning" : st === "done" ? "neutral" : "accent"} className="mt-3" />
          {(st === "active" || st === "sent-back" || st === "blocked") && (
            <p className="mt-3 flex gap-2 text-[13px] text-ink2">
              <span className="mt-1.5"><Dot tone={st === "active" ? "accent" : "warning"} pulse={st !== "blocked"} /></span>
              <span>{st === "sent-back" ? t("build.inspector.sentBack", "A later stage sent work back. {agent} is fixing it; it is checked again before it passes.", { agent: AGENT_NAME[stageId] })
                : st === "blocked" ? (focus.job?.message ? t("build.inspector.notRunningWhy", "The build is not running: {why}", { why: focus.job.message }) : t("build.inspector.notRunning", "The build is not running, so the work holds here."))
                  : previewJob?.message ?? focus.job?.message ?? (focus.change ? t("build.inspector.workingChange", "{agent} is working on the change's tickets.", { agent: AGENT_NAME[stageId] }) : t("build.inspector.workingMilestone", "{agent} is working on the milestone's tickets.", { agent: AGENT_NAME[stageId] }))}</span>
            </p>
          )}
        </Section>

        <Section label={t("build.inspector.checks", "Checks")}>
          <div className="grid grid-cols-2 gap-2.5">
            <Tile value={<>{passed}<span className="text-ink3"> / {counts.total}</span></>} label={stageId === "deploy" ? t("build.inspector.ticketsDone", "tickets done") : stageId === "01" ? t("build.inspector.ticketsPlanned", "tickets planned") : t("build.inspector.ticketsThrough", "tickets through")} />
            <Tile value={openBacks} label={openBacks === 1 ? t("build.inspector.openBack", "open send-back") : t("build.inspector.openBacks", "open send-backs")} tone={openBacks ? "danger" : undefined} />
          </div>
          <p className="mt-2.5 text-[13px] text-ink3">{focus.change ? t("build.inspector.countedChange", "Counted from the change's tickets and their recorded moves.") : t("build.inspector.countedMilestone", "Counted from the milestone's tickets and their recorded moves.")}</p>
        </Section>

        {mine.length > 0 && (
          <Section label={t("build.inspector.sendBacks", "Send-backs")}>
            <ol className="space-y-2">
              {mine.map((b) => {
                const tk = byId.get(b.ticketId);
                return (
                  <li key={b.id} className={cn("p-3 text-[13px] rounded-block", b.phase === "open" ? "bg-danger-soft" : b.phase === "rechecking" ? "bg-warning-soft" : "bg-success-soft")}>
                    <span className="flex items-center gap-2">
                      <Chip tone={b.phase === "open" ? "danger" : b.phase === "rechecking" ? "warning" : "success"}
                        icon={b.phase === "open" ? <TriangleAlert size={12} strokeWidth={1.75} /> : <Check size={12} strokeWidth={2.25} />}>
                        {b.phase === "open" ? t("build.inspector.open", "Open") : b.phase === "rechecking" ? t("build.inspector.rechecking", "Re-checking") : t("build.inspector.closed", "Closed")}
                      </Chip>
                      <span className="num ml-auto text-[12px] text-ink3">{at(b.at)}</span>
                    </span>
                    <span className="mt-2 block font-medium text-ink">{tk ? `${ticketCode(tk)} ${tk.title}` : t("build.banner.aTicket", "A ticket")}</span>
                    <span className="block text-ink2">{t("build.inspector.sentItBack", "{from} sent it back to {to}.", { from: columnName(b.from), to: columnName(b.to) })}</span>
                  </li>
                );
              })}
            </ol>
          </Section>
        )}
      </div>

      <div className="min-w-0">
        <Section label={t("build.inspector.proof", "Proof")} className="md:mt-0 md:border-t-0 md:pt-0 2xl:mt-5 2xl:border-t 2xl:pt-4">
          <button type="button" onClick={() => onOpenProof(stageId)} disabled={proofState === "none"}
            aria-label={t("build.inspector.openProof", "Open the proof of {stage}", { stage: def.name })}
            className={cn("group flex w-full items-center gap-3 rounded-block p-3 text-left transition",
              proofState === "none" ? "hatched cursor-not-allowed bg-surface2 opacity-70" : "bg-surface2 hover:bg-accent-soft")}>
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface text-ink2 shadow-card group-hover:text-accent">
              <FileText size={18} strokeWidth={1.75} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-[13px] text-ink">{def.artifact}</span>
              <span className="mt-0.5 block text-[12px] text-ink3">
                {proofState === "none" ? t("build.inspector.nothingRecorded", "Nothing recorded for this stage yet")
                  : <>{proof.length === 1 ? t("build.inspector.recordOne", "1 record") : t("build.inspector.records", "{count} records", { count: proof.length })} · {proofState === "final" ? <span className="text-success">{t("build.proofDrawer.final", "Final")}</span> : <span className="text-accent">{t("build.proofDrawer.live", "Updated live")}</span>}</>}
              </span>
            </span>
            {proofState !== "none" && <ArrowUpRight size={16} strokeWidth={1.75} className="shrink-0 text-ink3 transition group-hover:text-accent" />}
          </button>
        </Section>

        <Section label={t("build.inspector.workItems", "Work items")}>
          {items.length === 0 ? <p className="text-[13px] text-ink3">{t("build.inspector.noTickets", "This build has no tickets yet.")}</p> : (
            <ol className="space-y-1">
              {items.map(({ ticket: tk, state, since }) => (
                <li key={tk.id} className="flex items-center gap-2.5 rounded-block px-2 py-1.5 text-[13px]">
                  <span className={cn("grid h-5 w-5 shrink-0 place-items-center rounded-full",
                    state === "done" && (tk.type === "fix" ? "bg-success text-white dark:text-stage" : "bg-ink text-canvas"),
                    state === "active" && (st === "blocked" ? "bg-warning text-stage" : "bg-accent text-white"),
                    state === "planned" && "hatched bg-surface2")}>
                    {state === "done" && <Check size={11} strokeWidth={2.25} />}
                    {state === "active" && <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-current" />}
                  </span>
                  <span className={cn("min-w-0 flex-1 truncate", state === "planned" ? "text-ink3" : "text-ink")}>
                    <span className="num text-ink3">{ticketCode(tk)}</span> {tk.title}
                  </span>
                  <span className="num shrink-0 text-[12px] text-ink3">{since !== null && w && since >= w.start ? at(since) : ""}</span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Disclosure label={t("build.inspector.technical", "Technical details")}>
          <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
            <dt className="text-ink3">{t("build.inspector.artifact", "Artifact")}</dt><dd className="font-mono text-ink">{def.artifact}</dd>
            {col && <><dt className="text-ink3">{t("build.inspector.column", "Board column")}</dt><dd className="text-ink">{columnName(col)}</dd></>}
            {/* the build in plain words: never its job id or the machine it runs on */}
            {focus.job && <><dt className="text-ink3">{t("build.step.chip.build", "Build")}</dt><dd className="text-ink">{buildWord(focus.job.status)}{focus.job.attempts > 1 ? t("build.inspector.try", " · try {n}", { n: focus.job.attempts }) : ""}</dd></>}
            {w && <><dt className="text-ink3">{t("build.inspector.window", "Window")}</dt><dd className="num text-ink">{t("build.timeline.ofBuildTime", "{total} of build time", { total: fmtElapsed(w.head - w.start) })}</dd></>}
          </dl>
        </Disclosure>
      </div>
    </Card>
  );
}

function Section({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <section className={cn("mt-5 border-t border-line pt-4", className)}><Label>{label}</Label>{children}</section>;
}

function Tile({ value, label, tone }: { value: ReactNode; label: string; tone?: "danger" }) {
  return (
    <div className={cn("rounded-block px-3.5 py-3 transition-colors duration-500", tone === "danger" ? "bg-danger-soft" : "bg-surface2")}>
      <div className={cn("num text-[22px] font-medium leading-none tracking-[-0.02em]", tone === "danger" && "text-danger")}>{value}</div>
      <div className={cn("mt-1.5 text-[12px]", tone === "danger" ? "text-danger" : "text-ink3")}>{label}</div>
    </div>
  );
}

export function Disclosure({ label, defaultOpen = false, children }: { label: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mt-5 border-t border-line pt-3">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-block py-1 text-left text-[12px] font-medium uppercase tracking-wider text-ink3 hover:text-ink">
        {label}
        <ChevronDown size={14} strokeWidth={1.75} className={cn("ml-auto transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="mt-3 animate-rise">{children}</div>}
    </section>
  );
}
