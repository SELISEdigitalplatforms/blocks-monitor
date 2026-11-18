/** "Parallel streams" at the head of the Build step's Queue (src/domain/parallelStreams.ts): how many independent change
 *  requests the development team builds side by side (1..5), the tech lead's suggestion with its one-line reason (what
 *  the product's set-up allows: stable, whatever waits; the options above it disabled with a plain reason, never the
 *  person's own saved choice), and every change build that runs or is queued now with its state: building in its
 *  stream, starting, or waiting with what for ("Waits for CR-020: both change api: src/session.ts.", "Runs alone: its
 *  analysis names no code areas; …", "Waits for a free stream: …"). The builds still land on development one at a time.
 *  Only people who run builds or edit the business context choose; everyone else reads it. Reads only real records (the
 *  project's stream fields, its change requests and its own read of the build jobs); the plan and its lines are the
 *  engine's own (planStreams). */
import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { GitBranch } from "lucide-react";
import { queryById } from "@/madp/blocks/data/gql";
import { JOBS_PAGE_SIZE, buildJobsListOptions } from "@/madp/blocks/engine/jobs";
import type { DeliveryContext } from "@/madp/blocks/delivery/context";
import type { DeliveryChangeRequest, DeliveryTicket, DeliveryTicketEvent } from "@/madp/blocks/delivery/types";
import type { EngineJob } from "@/madp/blocks/engine/types";
import { changeBuildScope } from "@/madp/components/build/model";
import { changeDoing, changeRunName, changeRunOf, changeWords } from "@/madp/components/build/buildStep";
import { changeCode } from "@/madp/domain/delivery";
import { continueKey, streamsKey, useContinueIncrements, useParallelStreams } from "@/madp/blocks/delivery/actions";
import { continueOn } from "@/madp/domain/continueIncrements";
import {
  heldSuggestion, parseStreamsAdvice, parseStreamsChoice, planStreams, productFriendly, repoKeysOf, streamOptions, streamsInUse, suggestStreams,
  type StreamChange, type StreamOption, type StreamPlan, type StreamsSuggestion,
} from "@/madp/domain/parallelStreams";
import { cn } from "@/madp/lib/cn";
import { t, useT } from "@/madp/i18n";
import { aChange } from "@/madp/components/build/buildStep";
import { Card, Chip } from "@/madp/ui/kit";

const changeOf = (c: DeliveryChangeRequest): StreamChange => ({ id: c.id, lane: c.lane, number: c.number, title: c.title, status: c.status, analysis: c.analysis });

/** The project's "continue with the next increment" setting, read on its own: a tenant without the field answers off. */
function useContinueField(projectId: string): boolean {
  const q = useQuery({
    queryKey: continueKey(projectId),
    queryFn: () => queryById<{ ItemId: string; ContinueIncrements?: string | null }>("Project", projectId, ["ItemId", "ContinueIncrements"]),
    retry: false,
    staleTime: 30_000,
  });
  return continueOn(q.data?.ContinueIncrements ?? null);
}

/** The project's stream fields, read on their own: a tenant without them answers one stream. */
function useStreamFields(projectId: string) {
  const q = useQuery({
    queryKey: streamsKey(projectId),
    queryFn: () => queryById<{ ItemId: string; ParallelStreams?: string | null; StreamsAdvice?: string | null }>("Project", projectId, ["ItemId", "ParallelStreams", "StreamsAdvice"]),
    retry: false,
    staleTime: 30_000,
  });
  return { choice: parseStreamsChoice(q.data?.ParallelStreams ?? null), advice: parseStreamsAdvice(q.data?.StreamsAdvice ?? null) };
}

export interface ParallelStreamsViewProps {
  /** The stored choice (1 without one). */
  chosen: number;
  /** Streams in use now (the choice, never above what the product's set-up allows). */
  inUse: number;
  /** Why fewer run than chosen ("" when they are the same). */
  inUseWhy: string;
  suggestion: StreamsSuggestion;
  options: StreamOption[];
  plan: StreamPlan;
  /** The change request page of a code ("CR-003" -> link). */
  linkOf: (targetId: string) => string | null;
  /** The running build's own line (its job message). */
  lineOf: (jobId: string) => string;
  /** A queued fix round's, revert's or finish's name in the Build step's words ("Fix round 1 of CR-018 increment 1 of
   *  2"); null for a change's own build (its title is shown). */
  nameOf?: (jobId: string) => string | null;
  pending?: boolean;
  error?: string | null;
  success?: string | null;
  onChoose?: (n: number) => void;
  /** "Continue with the next increment when the checks pass" (Project.ContinueIncrements); absent: not shown. */
  continueIncrements?: { on: boolean; canChange: boolean; pending?: boolean; error?: string | null; success?: string | null; onChange?: (on: boolean) => void };
}

/** The control and the list, from plain values (rendered on its own in tests). */
/** "4", "4 and 5", "3, 4 and 5". */
const listed = (ns: number[]): string => (ns.length > 1 ? t("build.streams.listed", "{first} and {last}", { first: ns.slice(0, -1).join(", "), last: ns.at(-1) ?? "" }) : String(ns[0] ?? ""));

export function ParallelStreamsView(p: ParallelStreamsViewProps) {
  const t = useT();
  // the disabled options, one line per reason ("4 and 5: Above the tech lead's suggestion of 3.")
  const reasons = new Map<string, number[]>();
  for (const o of p.options) if (o.disabled && o.why) reasons.set(o.why, [...(reasons.get(o.why) ?? []), o.n]);
  const firstAbove = reasons.size > 0;
  const busy = p.plan.running.length + p.plan.starting.length + p.plan.waiting.length > 0;
  return (
    <Card title={t("build.streams.title", "Parallel streams")} icon={<GitBranch size={18} strokeWidth={1.75} aria-hidden />} bodyClassName="flex flex-col gap-4">
      <p className="max-w-[80ch] text-[14px] text-ink2">
        {t("build.streams.intro", "How many independent change requests the development team builds side by side. Each one still lands on development on its own, one after the other, with its checks.")}
      </p>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div role="radiogroup" aria-label={t("build.streams.title", "Parallel streams")} aria-describedby="streams-suggestion"
          className="inline-flex max-w-full flex-wrap rounded-full bg-surface2 p-1 ring-1 ring-inset ring-line">
          {p.options.map((o) => {
            const on = o.n === p.chosen;
            return (
              <button key={o.n} type="button" role="radio" aria-checked={on} disabled={o.disabled || p.pending}
                title={o.why || (o.suggested ? t("build.streams.suggestionTitle", "The tech lead's suggestion") : undefined)}
                aria-label={`${o.n === 1 ? t("build.streams.one", "1 stream") : t("build.streams.many", "{count} streams", { count: o.n })}${o.suggested ? t("build.streams.suggestedSuffix", ", suggested") : ""}${o.why ? `: ${o.why}` : ""}`}
                onClick={() => !on && p.onChoose?.(o.n)}
                className={cn("relative h-8 min-w-[2.5rem] whitespace-nowrap rounded-full px-3 text-[13px] font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed",
                  on ? "bg-accent-soft text-[rgb(var(--c-accent-text))]" : "text-ink2 hover:text-ink disabled:text-ink3 disabled:opacity-60 disabled:hover:text-ink3")}>
                <span className="num">{o.n}</span>
                {o.suggested && <span aria-hidden className="absolute right-1.5 top-1 h-1.5 w-1.5 rounded-full bg-accent" />}
              </button>
            );
          })}
        </div>
        <p id="streams-suggestion" className="min-w-0 flex-1 basis-[18rem] text-[13px] text-ink [overflow-wrap:anywhere]">
          <span className="font-medium">{t("build.streams.suggests", "Tech lead suggests {count}:", { count: p.suggestion.suggested })}</span> <span className="text-ink2">{p.suggestion.reason}</span>
        </p>
      </div>
      {(firstAbove || p.inUse < p.chosen) && (
        <div className="flex flex-col gap-1 text-[12px] text-ink3">
          {[...reasons].map(([why, ns]) => <p key={why}>{listed(ns)}: {why}</p>)}
          {p.inUse < p.chosen && <p>{p.inUse === 1 ? t("build.streams.oneRuns", "One runs for now: {why}", { why: p.inUseWhy || t("build.streams.noMore", "the product's set-up allows no more yet.") })
            : t("build.streams.manyRun", "{count} run for now: {why}", { count: p.inUse, why: p.inUseWhy || t("build.streams.noMore", "the product's set-up allows no more yet.") })}</p>}
        </div>
      )}
      {p.error && <p role="alert" className="text-[13px] text-danger">{p.error}</p>}
      {p.success && !p.error && <p role="status" className="text-[13px] text-[rgb(var(--c-success-text))]">{p.success}</p>}
      {p.continueIncrements && (
        <div className="flex flex-col gap-1">
          <label className={cn("flex min-w-0 items-start gap-2 text-[13px] text-ink", !p.continueIncrements.canChange && "text-ink2")}>
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--c-accent))]" checked={p.continueIncrements.on}
              disabled={!p.continueIncrements.canChange || p.continueIncrements.pending}
              onChange={(e) => p.continueIncrements?.onChange?.(e.target.checked)} />
            <span className="[overflow-wrap:anywhere]">{t("build.streams.continue", "Continue with the next increment when the checks pass")}</span>
          </label>
          <p className="pl-6 text-[12px] text-ink3">
            {p.continueIncrements.canChange
              ? t("build.streams.continueHint", "Only when its checks pass on development, never past the last increment. Cancel a next increment that started by itself to pause that change.")
              : t("build.streams.continueWho", "Only people who run builds or edit the business context change this.")}
          </p>
          {p.continueIncrements.error && <p role="alert" className="pl-6 text-[12px] text-danger">{p.continueIncrements.error}</p>}
          {p.continueIncrements.success && !p.continueIncrements.error && <p role="status" className="pl-6 text-[12px] text-[rgb(var(--c-success-text))]">{p.continueIncrements.success}</p>}
        </div>
      )}
      <div className="border-t border-line pt-4">
        <h4 className="mb-2 text-[12px] font-medium uppercase tracking-wider text-ink3">{t("build.streams.now", "Now")}</h4>
        {!busy ? <p className="text-[13px] text-ink2">{t("build.streams.idle", "No change request is being built right now.")}</p> : (
          <ul className="flex flex-col gap-2" aria-label={t("build.streams.nowLabel", "Streams now")}>
            {p.plan.running.map((r) => (
              <li key={r.jobId} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px]">
                <Chip tone="accent">{t("build.streams.stream", "Stream {n}", { n: r.stream })}</Chip>
                <Code code={r.code} href={p.linkOf(r.targetId)} />
                {r.title && <span className="min-w-0 text-ink [overflow-wrap:anywhere]">{r.title}</span>}
                <span className="min-w-0 basis-full text-[12px] text-ink3 [overflow-wrap:anywhere] sm:basis-auto">{p.lineOf(r.jobId)}</span>
                {r.note && <span className="min-w-0 basis-full text-[12px] text-ink3 [overflow-wrap:anywhere]">{r.note}</span>}
              </li>
            ))}
            {[...p.plan.starting, ...p.plan.waiting].map((q) => (
              <li key={q.jobId} className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 text-[13px]">
                <Chip tone={q.state === "starting" ? "success" : "neutral"}>{q.state === "starting" ? t("build.streams.starting", "Starting") : t("build.streams.waiting", "Waiting")}</Chip>
                <Code code={q.code} href={p.linkOf(q.targetId)} />
                {(p.nameOf?.(q.jobId) ?? q.title) && <span className="min-w-0 text-ink [overflow-wrap:anywhere]">{p.nameOf?.(q.jobId) ?? q.title}</span>}
                <span className="min-w-0 basis-full text-[12px] text-ink3 [overflow-wrap:anywhere] sm:basis-auto">{q.words}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function Code({ code, href }: { code: string; href: string | null }) {
  const cls = "num whitespace-nowrap font-mono text-[12px]";
  return href ? <Link to={href} className={cn(cls, "text-accent underline-offset-2 hover:underline")}>{code}</Link> : <span className={cn(cls, "text-ink2")}>{code}</span>;
}

/** A running build's line in the list: its own line, except a fix round's or a revert's, which says what it does to
 *  which increment in the Build step's words ("Fixing what the checks found in CR-018 increment 1 of 2 (round 1):
 *  reading the code"): the same as the header, never the increment after it (pure). */
export function streamLine(job: EngineJob | undefined, o: { jobs: readonly EngineJob[]; changes: readonly DeliveryChangeRequest[]; tickets?: readonly DeliveryTicket[]; events?: readonly DeliveryTicketEvent[] }): string {
  if (!job) return t("build.streams.building", "Building.");
  const run = changeRunOf(job);
  if (job.kind !== "change.build" || run.kind === "build") return job.message || t("build.streams.building", "Building.");
  const scope = changeBuildScope({ job, changes: o.changes, tickets: o.tickets ?? [], events: o.events ?? [], jobs: o.jobs });
  const cr = scope ? o.changes.find((c) => c.id === scope.change.id) : undefined;
  const what = scope ? changeWords(scope.change) : cr ? changeCode(cr) : aChange();
  const doing = changeDoing(what, run);
  return job.step ? `${doing}: ${job.step}` : `${doing}.`;
}

/** A queued run's name in the Build step's words: a fix round, a revert or the steps after a deploy of which
 *  increment ("Fix round 1 of CR-018 increment 1 of 2", changeRunName); null for a change's own build (pure). */
export function streamRunName(job: EngineJob | undefined, o: { jobs: readonly EngineJob[]; changes: readonly DeliveryChangeRequest[]; tickets?: readonly DeliveryTicket[]; events?: readonly DeliveryTicketEvent[] }): string | null {
  if (!job || job.kind !== "change.build") return null;
  const run = changeRunOf(job);
  if (run.kind === "build") return null;
  const scope = changeBuildScope({ job, changes: o.changes, tickets: o.tickets ?? [], events: o.events ?? [], jobs: o.jobs });
  const cr = scope ? o.changes.find((c) => c.id === scope.change.id) : undefined;
  return changeRunName(scope ? changeWords(scope.change) : cr ? changeCode(cr) : aChange(), run);
}

/** The page's job list may miss a build (pure): it is full (its newest 100 jobs of every kind), or a change being built
 *  has no build in it. Then the streams read the builds on their own. */
export function mayMissBuilds(jobs: readonly Pick<EngineJob, "kind" | "inputJson">[], changes: readonly Pick<DeliveryChangeRequest, "id" | "status">[]): boolean {
  return jobs.length >= JOBS_PAGE_SIZE
    || changes.some((c) => c.status === "building" && !jobs.some((j) => j.kind === "change.build" && (j.inputJson ?? "").includes(`"${c.id}"`)));
}

/** The control on the Build step's Queue, over the project's records. */
export function ParallelStreams({ ctx, projectId, jobs, changes, tickets, events }: {
  ctx: DeliveryContext;
  projectId: string;
  jobs: readonly EngineJob[];
  changes: readonly DeliveryChangeRequest[];
  /** The board's tickets and their moves: the increment a running fix round works on. */
  tickets?: readonly DeliveryTicket[];
  events?: readonly DeliveryTicketEvent[];
}) {
  const { choice, advice } = useStreamFields(projectId);
  const save = useParallelStreams(ctx);
  const continuing = useContinueField(projectId);
  const saveContinue = useContinueIncrements(ctx);
  const [continuePicked, setContinuePicked] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  // the project's builds read on their own when the page's job list may miss one (it is full, or a change being built
  // has no build in it): a long build never drops out behind newer jobs of other kinds
  const mayMiss = mayMissBuilds(jobs, changes);
  const builds = useQuery({ ...buildJobsListOptions(ctx.workspaceId, projectId), enabled: Boolean(ctx.workspaceId && projectId) && mayMiss }).data;
  // the page's list (on the fast clock) wins over the builds' own read for a job both hold
  const allJobs = useMemo(() => [...new Map([...(mayMiss ? builds ?? [] : []), ...jobs].map((j) => [j.id, j])).values()], [jobs, builds, mayMiss]);
  const streamChanges = useMemo(() => changes.map(changeOf), [changes]);
  // the tech lead's suggestion from the approved changes now; held steady while the page is open (it only rises, or
  // follows a new cap), so it never flaps while builds start and end
  const live = useMemo(() => suggestStreams({ changes: streamChanges, advice }), [streamChanges, advice]);
  const held = useRef<StreamsSuggestion | null>(null);
  held.current = heldSuggestion(held.current, live);
  const suggestion = held.current;
  const inUse = streamsInUse(choice, advice);
  const plan = useMemo(() => planStreams({
    jobs: allJobs.map((j) => ({ id: j.id, kind: j.kind, status: j.status, inputJson: j.inputJson, createdAt: j.createdAt, claimedAt: j.claimedAt, finishedAt: j.finishedAt })),
    changes: streamChanges, limit: inUse, repoKeys: repoKeysOf(advice), friendly: productFriendly(advice),
  }), [allJobs, streamChanges, inUse, advice]);
  const canChoose = ctx.can("business.edit") || ctx.can("build.run");
  const chosen = picked ?? choice?.chosen ?? 1;
  const byId = new Map(changes.map((c) => [c.id, c]));
  const byJob = new Map(allJobs.map((j) => [j.id, j]));
  return (
    <ParallelStreamsView chosen={chosen} inUse={Math.min(inUse, chosen)} inUseWhy={advice?.why ?? ""} suggestion={suggestion}
      options={streamOptions(suggestion, canChoose, chosen)} plan={plan}
      linkOf={(id) => { const c = byId.get(id); return c ? `/p/${projectId}/build?cr=${c.number}` : null; }}
      lineOf={(id) => streamLine(byJob.get(id), { jobs: allJobs, changes, tickets, events })}
      nameOf={(id) => streamRunName(byJob.get(id), { jobs: allJobs, changes, tickets, events })}
      pending={save.pending} error={save.error} success={save.success}
      onChoose={(n) => { setPicked(n); save.reset(); void save.run({ chosen: n }).then((ok) => { if (!ok) setPicked(null); }); }}
      continueIncrements={{
        on: continuePicked ?? continuing, canChange: canChoose, pending: saveContinue.pending, error: saveContinue.error, success: saveContinue.success,
        onChange: (on) => { setContinuePicked(on); saveContinue.reset(); void saveContinue.run({ on }).then((ok) => { if (!ok) setContinuePicked(null); }); },
      }} />
  );
}
