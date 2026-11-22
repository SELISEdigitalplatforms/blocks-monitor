/** The 3D office's stage states, built from ONE real engine job's Progress and Status. Pure display: nothing here is simulated. */
import { STAGES, type StageState } from "@/data/pipeline";
import { JOB_STATUS_TEXT as JOB_STATUS_LABEL } from "@/components/engine/jobWords";
import { jobLabel, type DashJob } from "@/domain/dashboard";

export interface OfficeView {
  stages: StageState[];
  /** a computed one-line caption, e.g. "Build · 40%" */
  caption: string;
  /** the floor holds still: no running job */
  held: boolean;
}

/** Index of the stage a progress value falls in (0-100 spread across the pipeline). */
export function activeStageIndex(progress: number): number {
  const p = Math.min(100, Math.max(0, progress));
  return Math.min(STAGES.length - 1, Math.floor((p / 100) * STAGES.length));
}

export function officeView(job: DashJob | null): OfficeView {
  const planned = STAGES.map((s): StageState => ({ id: s.id, status: "planned" }));
  if (!job) return { stages: planned, caption: "", held: true };
  const label = jobLabel(job);
  if (job.status === "succeeded") {
    return { stages: STAGES.map((s): StageState => ({ id: s.id, status: "done" })), caption: `${label} · ${JOB_STATUS_LABEL.succeeded}`, held: true };
  }
  if (job.status === "queued" || job.status === "cancelled") {
    return { stages: planned, caption: `${label} · ${JOB_STATUS_LABEL[job.status]}`, held: true };
  }
  const at = activeStageIndex(job.progress);
  const failed = job.status === "failed";
  const stages = STAGES.map((s, i): StageState => ({
    id: s.id,
    status: i < at ? "done" : i === at ? (failed ? "blocked" : "active") : "planned",
    ...(i === at ? { progress: Math.round(job.progress) } : {}),
  }));
  const caption = failed ? `${label} · ${JOB_STATUS_LABEL.failed}` : `${label} · ${Math.floor(job.progress)}%`;
  return { stages, caption, held: failed };
}
