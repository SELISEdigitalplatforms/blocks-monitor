/** The road to the first dev release, on the dark stage: the real build.run job of the milestone that releases to dev.
 *  Everything shown is the job row: its status, its progress (0-100, set by the MADP engine), its message, who claimed
 *  it and when. Nothing is timed or simulated; the release row itself ends the console (the page then shows the live
 *  card). Every part keeps its size while the job runs, so the panel never jumps. */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, LoaderCircle, Rocket } from "lucide-react";
import type { EngineJob } from "@/blocks/engine/types";
import { JOB_STATUS_TEXT as JOB_STATUS_LABEL } from "@/components/engine/jobWords";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { elapsedSince, formatElapsed } from "@/components/engine/engineUi";
import { useReducedMotion } from "./shared";
import { t, useT } from "@/i18n";

/** the stage is dark in both themes: hatching uses light lines here */
export const STAGE_HATCH = { "--hatch": "rgb(255 255 255 / 0.13)" } as CSSProperties;

type StepState = "done" | "active" | "planned";
interface Step { id: string; label: string; detail: string; state: StepState }

/** The job's lifecycle as steps: queued, picked up by the engine, building, released to development. */
export function consoleSteps(job: EngineJob, milestone: { number: number; name: string }): Step[] {
  const s = job.status;
  const picked = s === "claimed" || s === "running" || s === "succeeded";
  const built = s === "succeeded";
  return [
    {
      id: "queued", label: t("build.release.console.queued", "Queued for the development team"),
      detail: formatDateTime(job.createdAt) || t("build.release.console.requested", "Requested"), state: s === "queued" ? "active" : "done",
    },
    {
      id: "claimed", label: JOB_STATUS_LABEL.claimed,
      detail: formatDateTime(job.claimedAt) || (picked ? t("build.release.console.started", "Started") : t("build.release.page.notYet", "Not yet")),
      state: s === "claimed" ? "active" : picked ? "done" : "planned",
    },
    {
      id: "build", label: t("build.release.console.building", "Building milestone {number}: {name}", { number: milestone.number, name: milestone.name }),
      detail: job.message ?? (s === "running" ? JOB_STATUS_LABEL.running : t("build.release.console.notStarted", "Not started")),
      state: s === "running" ? "active" : built ? "done" : "planned",
    },
    {
      id: "release", label: t("build.release.console.release", "Release to development"),
      detail: built ? t("build.release.console.goingOn", "Going on the development environment now") : t("build.release.console.whenPasses", "When the build passes"),
      state: built ? "active" : "planned",
    },
  ];
}

function useClock(live: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [live]);
  return now;
}

export function GoLiveConsole({ job, milestone, eyebrow }: {
  job: EngineJob;
  milestone: { number: number; name: string };
  eyebrow?: string;
}) {
  const t = useT();
  const box = useRef<HTMLElement>(null);
  const reduced = useReducedMotion();
  const steps = consoleSteps(job, milestone);
  const working = job.status === "claimed" || job.status === "running";
  const now = useClock(working);
  const elapsed = working ? elapsedSince(job.claimedAt, now) : null;
  const pct = Math.max(0, Math.min(100, Math.round(job.progress)));
  const caption = job.message ?? JOB_STATUS_LABEL[job.status];

  // bring the moment into view once (the page may have been scrolled down)
  useEffect(() => { box.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" }); }, [reduced]);

  return (
    <section ref={box} aria-labelledby="golive-title"
      className="relative scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)] overflow-hidden rounded-card bg-stage text-white shadow-float animate-rise dark:border dark:border-line" style={STAGE_HATCH}>
      <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-accent/25 blur-3xl" />
      <div className="relative p-6 md:p-8">
        {/* on a phone the status sits beside the rocket and the title takes the full width below them */}
        <header className="flex flex-wrap items-center gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/10"><Rocket size={20} strokeWidth={1.75} aria-hidden /></span>
          <div className="order-last min-w-0 basis-full sm:order-none sm:basis-0 sm:flex-1">
            {eyebrow && <div className="truncate text-[13px] text-white/60">{eyebrow}</div>}
            <h2 id="golive-title" className="text-[26px] font-medium leading-tight tracking-[-0.02em] sm:text-[30px]">{t("build.release.console.title", "Building the first release to development")}</h2>
          </div>
          <span className="ml-auto inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-[12px] font-medium">
            <span className="h-2 w-2 rounded-full bg-accent animate-pulse-dot" />
            {t("build.release.env.dev", "Development")}
          </span>
        </header>
        <p className="mt-3 text-[13px] text-white/60 [text-wrap:balance]">
          {t("build.release.console.intro", "The development team builds milestone {number}. The release to the development environment appears here as soon as it is ready.", { number: milestone.number })}
        </p>

        <div className="mt-7 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          <div className="flex min-w-0 flex-col">
            <div className="num text-[72px] font-medium leading-[0.85] tracking-[-0.05em] sm:text-[88px]">{pct}<span className="text-[36px] text-white/60 sm:text-[44px]">%</span></div>
            <div role="status" aria-live="polite" className="mt-4 truncate text-[15px] font-medium">{caption}</div>
            <div role="progressbar" aria-label={t("build.release.console.progress", "Build progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/10 hatched">
              <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
            </div>
            <dl className="mt-6 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-block bg-white/[0.04] p-4 text-[12.5px] ring-1 ring-inset ring-white/10">
              <dt className="text-white/60">{t("build.release.console.status", "Status")}</dt><dd className="min-w-0 break-words">{JOB_STATUS_LABEL[job.status]}</dd>
              <dt className="text-white/60">{t("build.release.console.requested", "Requested")}</dt><dd className="num min-w-0">{formatDateTime(job.createdAt) || "—"}</dd>
              {job.claimedAt && <><dt className="text-white/60">{t("build.release.console.pickedUp", "Picked up")}</dt><dd className="num min-w-0">{formatDateTime(job.claimedAt)}</dd></>}
              {elapsed !== null && <><dt className="text-white/60">{t("build.release.console.runningFor", "Running for")}</dt><dd className="num min-w-0">{formatElapsed(elapsed)}</dd></>}
              {job.attempts > 1 && <><dt className="text-white/60">{t("build.release.console.attempt", "Attempt")}</dt><dd className="num min-w-0">{job.attempts}</dd></>}
            </dl>
          </div>

          <ol className="flex flex-col gap-2.5">
            {steps.map((s, i) => (
              <li key={s.id} className={cn("rounded-block px-4 py-3 transition-colors duration-300", s.state === "active" ? "bg-white/[0.09]" : "bg-white/[0.04]")}>
                <div className="flex items-center gap-3">
                  <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-medium",
                    s.state === "done" && "bg-success text-stage", s.state === "active" && "bg-accent text-white",
                    s.state === "planned" && "bg-white/5 text-white/60 ring-1 ring-inset ring-white/15")}>
                    {s.state === "done" ? <Check size={14} strokeWidth={2.75} aria-hidden />
                      : s.state === "active" ? <LoaderCircle size={14} strokeWidth={2.5} className="animate-spin motion-reduce:animate-none" aria-hidden />
                      : <span className="num">{i + 1}</span>}
                  </span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className={cn("truncate text-[14px] font-medium", s.state === "planned" && "text-white/60")}>{s.label}</div>
                    <div className="truncate text-[12px] text-white/60">{s.detail}</div>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
