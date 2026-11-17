/** Home's records, read from SELISE Blocks: the workspace's projects and engine jobs in one parallel wave, and "my
 *  project" with its current step and its active engine job. Nothing here is simulated. */
import { useMemo } from "react";
import { useBlocksAllResult } from "@/blocks/data/hooks";
import { useBlocksContext } from "@/blocks/context";
import { useWorkspaces } from "@/blocks/workspaces/store";
import { toEngineJob, type EngineJob } from "@/blocks/engine/types";
import { effectiveStep, isDeletingProject } from "@/domain/projects";
import type { JourneyStep } from "@/domain/journey";
import { phaseIndex, phaseOf, stepPath } from "@/domain/phases";
import { phaseNameOf, phaseShortName } from "@/components/project/stepNames";
import type { ProjectStatus } from "@/data/types";
import { pickMyProject, type StatusChipCopy } from "./parts";
import { t } from "@/i18n";

/** The S1 fields Home reads, per schema. */
export const HOME_FIELDS = {
  Project: ["ItemId", "Name", "Stage", "ResumeTo", "AssigneeUserId", "CreatedByUserId", "LastUpdatedDate", "Status"],
  EngineJob: ["ItemId", "ProjectId", "Kind", "Status", "Progress", "CreatedDate"],
} as const;

export const HOME_MAX_ROWS = 200;

export interface HomeProjectRow {
  ItemId: string;
  Name?: string | null;
  Stage?: string | null;
  ResumeTo?: string | null;
  AssigneeUserId?: string | null;
  CreatedByUserId?: string | null;
  LastUpdatedDate?: string | null;
  Status?: string | null;
}

export interface HomeJobRow {
  ItemId: string;
  ProjectId: string;
  Kind?: string | null;
  Status?: string | null;
  Progress?: number | null;
  CreatedDate?: string | null;
}

export interface HomeProject {
  id: string;
  name: string;
  stage: string;
  step: JourneyStep;
  AssigneeUserId: string;
  CreatedByUserId: string;
  LastUpdatedDate: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

export function toHomeProject(r: HomeProjectRow): HomeProject {
  const stage = str(r.Stage);
  return {
    id: r.ItemId,
    name: str(r.Name) || t("shell.search.untitledProject", "Untitled project"),
    stage,
    step: effectiveStep(stage, str(r.ResumeTo)),
    AssigneeUserId: str(r.AssigneeUserId),
    CreatedByUserId: str(r.CreatedByUserId),
    LastUpdatedDate: str(r.LastUpdatedDate),
  };
}

/** The gateway row as an EngineJob (its creation time is the system field CreatedDate). */
export function toHomeJob(r: HomeJobRow): EngineJob | null {
  return toEngineJob(r);
}

/** Home's live records: a project being deleted is not listed, and no job of a project that is not listed counts. */
export function liveHomeRecords(projectRows: readonly HomeProjectRow[], jobRows: readonly HomeJobRow[]): { projects: HomeProject[]; jobs: EngineJob[] } {
  const projects = projectRows.filter((r) => !isDeletingProject(r)).map(toHomeProject);
  const ids = new Set(projects.map((p) => p.id));
  return { projects, jobs: jobRows.map(toHomeJob).filter((j): j is EngineJob => j !== null && ids.has(j.projectId)) };
}

/** Projects and jobs of the workspace, one parallel wave, newest first, capped. */
export function useHomeData() {
  const { workspaceId } = useBlocksContext();
  const projects = useBlocksAllResult<HomeProjectRow>("Project", {
    workspaceId, fields: HOME_FIELDS.Project, sort: [{ field: "LastUpdatedDate", dir: "desc" }], maxItems: HOME_MAX_ROWS,
  });
  const jobs = useBlocksAllResult<HomeJobRow>("EngineJob", {
    workspaceId, fields: HOME_FIELDS.EngineJob, sort: [{ field: "CreatedDate", dir: "desc" }], maxItems: HOME_MAX_ROWS,
  });
  const projectItems = projects.data?.items;
  const jobItems = jobs.data?.items;
  const projectsCapped = projects.data?.capped === true;
  return useMemo(() => ({
    ...liveHomeRecords(projectItems ?? [], jobItems ?? []),
    projectsCapped,
    isPending: projects.isPending || jobs.isPending,
    error: projects.error ?? jobs.error ?? null,
  }), [projectItems, jobItems, projectsCapped, projects.isPending, projects.error, jobs.isPending, jobs.error]);
}

const BUILD_KINDS: readonly string[] = ["build.run", "change.build"];

/** The job the card shows: an active build first, else any active job, else none. */
export function pickActiveJob(jobs: readonly EngineJob[], projectId: string): EngineJob | null {
  const active = jobs.filter((j) => j.projectId === projectId && (j.status === "queued" || j.status === "claimed" || j.status === "running"));
  return active.find((j) => BUILD_KINDS.includes(j.kind)) ?? active[0] ?? null;
}

export interface MyProjectView {
  project: HomeProject | null;
  step: JourneyStep | null;
  /** The step's name as the stepper shows it (one of the four: "Business Analysis" for scope). */
  stepLabel: string;
  /** Its page (an analysis step opens its section of the Business Analysis page). */
  stepHref: string;
  activeJob: EngineJob | null;
  /** True until the workspace is known and the project and job reads have answered. */
  isLoading: boolean;
}

/** My project: assigned to me (newest), else created by me (newest), else none. */
export function useMyProject(): MyProjectView {
  const { userId } = useBlocksContext();
  const { projects, jobs, isPending } = useHomeData();
  const ready = useWorkspaces((s) => s.ready);
  const isLoading = !ready || isPending;
  return useMemo(() => {
    const project = pickMyProject(projects, userId);
    if (!project) return { project: null, step: null, stepLabel: "", stepHref: "", activeJob: null, isLoading };
    return {
      isLoading,
      project,
      step: project.step,
      stepLabel: phaseNameOf(project.step),
      stepHref: stepPath(project.id, project.step),
      activeJob: pickActiveJob(jobs, project.id),
    };
  }, [projects, jobs, userId, isLoading]);
}

/** One project as the Wiki picker lists it. The Wiki's own conversion (collaboration lane) replaces this. */
export interface ProjectListItem {
  id: string;
  name: string;
  org: string;
  city: string;
  status: ProjectStatus;
  step: number;
  progress: number;
  chip: StatusChipCopy;
}

const STATUS_OF: Record<JourneyStep, ProjectStatus> = {
  business: "intake", understanding: "understanding", sanitization: "understanding", requirements: "objective", scope: "scope", board: "scope", build: "building", release: "live",
};

/** Every project of the workspace from Blocks, most recently updated first. */
export function useProjectList(): ProjectListItem[] {
  const { projects } = useHomeData();
  return useMemo(() => projects.map((p) => {
    const status = STATUS_OF[p.step];
    const step = phaseIndex(phaseOf(p.step));
    const chip: StatusChipCopy = status === "intake"
      ? { label: t("shell.home.draft", "Draft"), tone: "neutral", pulse: false }
      : status === "live" ? { label: t("shell.home.live", "Live"), tone: "success", pulse: false }
      : { label: phaseShortName(phaseOf(p.step)), tone: "accent", pulse: false };
    return { id: p.id, name: p.name, org: "", city: "", status, step, progress: 0, chip };
  }), [projects]);
}
