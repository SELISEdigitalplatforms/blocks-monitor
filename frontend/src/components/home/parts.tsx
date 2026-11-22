/** Small pieces shared by Home and Projects, built only from the UI kit and the design tokens. */
import type { ReactNode } from "react";
import { Briefcase, Check, ChevronRight, CircleSlash, FileSearch, FileText, Rocket, Workflow } from "lucide-react";
import type { ChipTone, ProjectStatus } from "@/data/types";
import { PHASES, PHASE_LABEL } from "@/domain/phases";
import { phaseName } from "@/components/project/stepNames";
import { Chip, ProgressRing } from "@/ui/kit";
import { cn } from "@/lib/cn";
import { t, useT } from "@/i18n";

/** The four steps a person sees, by name: Project Setup, Business Analysis, Software Engineering, Release (live and
 *  delivered are one step: Release). A project's `step` below is its index here (phaseIndex). */
export const STEPS = PHASES.map((p) => PHASE_LABEL[p]) as readonly string[];
/** The four steps' names in the chosen language, for the screen (STEPS stays the English reference). */
const stepNames = (): string[] => PHASES.map((p) => phaseName(p));
export const isLive = (s: ProjectStatus) => s === "live" || s === "delivered";
export const isStopped = (s: ProjectStatus) => s === "abandoned" || s === "rejected";

export interface StatusChipCopy { label: string; tone: ChipTone; pulse: boolean }
/** What the rings and step words need of a project. */
export interface MyProject { status: ProjectStatus; step: number; progress: number }

/** Status colour always comes with a word, never colour alone. The dot pulses only while the factory is at work. */
export function StatusChip({ chip }: { chip: StatusChipCopy }) {
  return (
    <Chip tone={chip.tone} icon={<span aria-hidden className={cn("h-1.5 w-1.5 rounded-full bg-current", chip.pulse && "animate-pulse-dot")} />}>
      {chip.label}
    </Chip>
  );
}

/** Where the project stands in words: the step before the build, the share built during it, then live (or stopped).
 *  `named` adds the step's name (leave it out next to a status chip, which already names it). */
export function stepWords(project: MyProject, named = true): string {
  if (isLive(project.status)) return named ? t("shell.home.live", "Live") : t("shell.home.allStepsDone", "All steps done");
  if (isStopped(project.status)) return named ? t("shell.home.stopped", "Stopped") : t("shell.home.notBuilt", "Not built");
  if (project.status === "building") return t("shell.home.percentBuilt", "{percent}% built", { percent: project.progress });
  return named
    ? t("shell.home.stepOfNamed", "Step {step} of {total}: {name}", { step: project.step + 1, total: STEPS.length, name: stepNames()[project.step] })
    : t("shell.home.stepOf", "Step {step} of {total}", { step: project.step + 1, total: STEPS.length });
}

/** The four lifecycle steps as one bar: done = solid, now = blue, ahead = hatched (a stopped project has no current step).
 *  `labels` names each step under its segment. */
export function StepBar({ step, status, labels = true, className }: { step: number; status: ProjectStatus; labels?: boolean; className?: string }) {
  useT();
  const live = isLive(status);
  const stopped = isStopped(status);
  const label = live ? t("shell.home.live", "Live") : stopped ? t("shell.home.stopped", "Stopped")
    : t("shell.home.stepOfNamed", "Step {step} of {total}: {name}", { step: step + 1, total: STEPS.length, name: stepNames()[step] });
  return (
    <ol aria-label={label} title={label} className={cn("grid grid-cols-4 gap-1", className)}>
      {stepNames().map((s, i) => {
        const done = live || i < step;
        const now = !live && !stopped && i === step;
        return (
          <li key={s} className="min-w-0" aria-current={now ? "step" : undefined}>
            <span className={cn("block h-1.5 rounded-full transition-colors duration-500",
              done && "bg-ink", now && "bg-accent", !done && !now && "hatched bg-surface2")} />
            {labels && <span className={cn("mt-2 hidden truncate text-[12px] sm:block", now ? "font-medium text-ink" : "text-ink3")}>{s}</span>}
          </li>
        );
      })}
    </ol>
  );
}

/** One icon per lifecycle step (PHASES): setup, business analysis, software engineering (the build), release. */
const STEP_ICON = [Briefcase, FileSearch, Workflow, Rocket];

/** The lifecycle every project runs through, as one compact row of named steps. Not numbered: the Business step numbers its own steps.
 *  It wraps onto more lines on a narrow screen. */
export function LifecycleRow({ className }: { className?: string }) {
  useT();
  return (
    <ol aria-label={t("shell.home.fourSteps", "The four steps, from setup to release")} className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-2", className)}>
      {stepNames().map((s, i) => {
        const Icon = STEP_ICON[i];
        return (
          <li key={s} className="flex items-center gap-1.5">
            <span className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full bg-surface2 px-3 text-[13px] font-medium text-ink2 dark:ring-1 dark:ring-inset dark:ring-line">
              <Icon size={14} strokeWidth={1.75} aria-hidden />{s}
            </span>
            {i < STEPS.length - 1 && <ChevronRight size={14} strokeWidth={1.75} className="text-ink3" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

/** How much is built; before the build it shows the step's icon instead of an empty 0 %, a tick once live and a
 *  struck circle once stopped. */
export function ProjectRing({ project, size = 56 }: { project: MyProject; size?: number }) {
  useT();
  const icon = Math.round(size * 0.32);
  let label: ReactNode | undefined;
  if (isLive(project.status)) label = <Check size={icon} strokeWidth={1.75} aria-hidden />;
  else if (isStopped(project.status)) label = <CircleSlash size={icon} strokeWidth={1.75} className="text-ink2" aria-hidden />;
  else if (project.status !== "building") {
    const Icon = STEP_ICON[project.step] ?? FileText;
    label = <Icon size={icon} strokeWidth={1.75} className="text-ink2" aria-hidden />;
  }
  return (
    <span role="img" aria-label={stepWords(project)} className="shrink-0">
      <ProgressRing value={project.progress} size={size} stroke={size >= 52 ? 6 : 4} label={label} />
    </span>
  );
}

/** "Good morning", "Good afternoon" or "Good evening"; with a first name, "Good morning, Mina". `hour` is 0-23. */
export function greetingFor(firstName: string, hour: number): string {
  const name = firstName.trim();
  if (hour < 12) return name ? t("shell.dashboard.goodMorningName", "Good morning, {name}", { name }) : t("shell.dashboard.goodMorning", "Good morning");
  if (hour < 18) return name ? t("shell.dashboard.goodAfternoonName", "Good afternoon, {name}", { name }) : t("shell.dashboard.goodAfternoon", "Good afternoon");
  return name ? t("shell.dashboard.goodEveningName", "Good evening, {name}", { name }) : t("shell.dashboard.goodEvening", "Good evening");
}


/** The line under the greeting, from the caller's own records (assigned to, started by or approved by them): what waits
 *  for them first, then how many of their projects are in progress. When none of theirs is in progress but the workspace
 *  has some, it says so: "no project in progress" above a list of projects reads as wrong. */
export function homeSummary({ inProgress, waiting = 0, workspaceInProgress = 0 }: { inProgress: number; waiting?: number; workspaceInProgress?: number }): string {
  const first = waiting === 1 ? t("shell.home.summary.waitingOne", "1 thing is waiting for you")
    : waiting > 1 ? t("shell.home.summary.waitingMany", "{count} things are waiting for you", { count: waiting })
    : t("shell.home.summary.nothingWaiting", "Nothing is waiting for you");
  if (inProgress > 0) {
    const mine = inProgress === 1 ? t("shell.home.summary.mineOne", "1 of your projects is in progress")
      : t("shell.home.summary.mineMany", "{count} of your projects are in progress", { count: inProgress });
    return `${first} · ${mine}`;
  }
  if (workspaceInProgress > 0) {
    const theirs = workspaceInProgress === 1 ? t("shell.home.summary.workspaceOne", "1 project in progress in this workspace")
      : t("shell.home.summary.workspaceMany", "{count} projects in progress in this workspace", { count: workspaceInProgress });
    return `${first} · ${theirs}`;
  }
  if (waiting > 0) return first;
  return t("shell.home.summary.start", "Describe your idea below. Your team takes it from the first brief to the release, and you approve each step.");
}

export interface PickableProject { id: string; AssigneeUserId?: string | null; CreatedByUserId?: string | null; LastUpdatedDate?: string | null }

const at = (p: PickableProject) => { const t = Date.parse(p.LastUpdatedDate ?? ""); return Number.isFinite(t) ? t : -Infinity; };

/** My project: the most recently updated one assigned to me, else the most recently updated one I created, else null. */
export function pickMyProject<T extends PickableProject>(projects: readonly T[], userId: string | null | undefined): T | null {
  if (!userId) return null;
  const newest = (list: T[]) => list.reduce<T | null>((best, p) => (best === null || at(p) > at(best) ? p : best), null);
  return newest(projects.filter((p) => p.AssigneeUserId === userId)) ?? newest(projects.filter((p) => p.CreatedByUserId === userId));
}
