// The EngineJob record as the web reads it: raw gateway row, normalised job, and small helpers.
import {
  isEngineJobKind, isEngineJobStatus, isTerminal, parseOutputRef,
  type EngineJobKind, type EngineJobStatus, type EngineOutputRef,
} from "@/domain/engineJob";
import { plainJobMessage } from "@/domain/jobMessage";
import { t } from "@/i18n";
import { laneLineStep, plainLaneLine } from "./laneLine";
import { lineFor } from "./platformOnly";

export const ENGINE_JOB_SCHEMA = "EngineJob";

/** One EngineJob row as the Data Gateway returns it (docs/ENGINE-CONTRACT.md section 2). */
export interface EngineJobRow {
  ItemId: string;
  WorkspaceId: string;
  ProjectId: string;
  Kind: string;
  Status: string;
  InputJson?: string | null;
  OutputRefs?: string[] | null;
  Progress?: number | null;
  Message?: string | null;
  ErrorCode?: string | null;
  Attempts?: number | null;
  ClaimedBy?: string | null;
  ClaimedAt?: string | null;
  FinishedAt?: string | null;
  RequestedByUserId?: string | null;
  CreatedDate?: string | null;
  LastUpdatedDate?: string | null;
}

/** Every field the web reads. */
export const ENGINE_JOB_FIELDS: readonly Extract<keyof EngineJobRow, string>[] = [
  "ItemId", "WorkspaceId", "ProjectId", "Kind", "Status", "InputJson", "OutputRefs", "Progress", "Message", "ErrorCode",
  "Attempts", "ClaimedBy", "ClaimedAt", "FinishedAt", "RequestedByUserId", "CreatedDate", "LastUpdatedDate",
];

/** A job, normalised for the UI. */
export interface EngineJob {
  id: string;
  workspaceId: string;
  projectId: string;
  kind: EngineJobKind;
  status: EngineJobStatus;
  inputJson: string | null;
  outputRefs: EngineOutputRef[];
  progress: number;
  message: string | null;
  /** While it runs: the lane step it is at, in plain words ("reading the code"), when its line is a lane step. */
  step?: string | null;
  errorCode: string | null;
  attempts: number;
  claimedBy: string | null;
  claimedAt: string | null;
  finishedAt: string | null;
  createdBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const date = (v: unknown): string | null => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? v : null);

/** The code of a job that stopped because the engine's AI gave no usable answer (server/local/engine/ai/index.ts): it
 *  wrote nothing in its place. */
export const AI_FAILED_CODE = "ai.failed";

/** The code of a job that stopped because the engine's AI capacity is used up (server/api/extraction/claudeCapacity.ts
 *  CAPACITY_CODE). It did no work and does not start again by itself: people start it again once the capacity is back. */
export const AI_CAPACITY_CODE = "ai.capacity";

/** The reset the engine named in its capacity line ("…used up until 2am (Europe/Stockholm). …", claudeCapacity.ts
 *  capacityMessage): only a reset Claude Code gave, never a guess. Null when the line names none. */
export function capacityResetOf(message: string | null | undefined): string | null {
  const m = /^The engine's AI capacity is used up until ([^.\n]{1,60})\./.exec(message ?? "");
  return m ? m[1]!.trim() || null : null;
}

/** The app's own words for a failed job whose code it knows (in the chosen language), else null (the job's own line).
 *  `message` is the job's own line, read only for what the words carry over (the capacity's reset). */
export function failedJobText(errorCode: string | null, message?: string | null): string | null {
  if (errorCode === AI_FAILED_CODE) return t("common.jobs.aiFailed", "The AI did not give a usable answer, so nothing was written. Start it again in a moment.");
  if (errorCode === AI_CAPACITY_CODE) {
    const when = capacityResetOf(message);
    return when
      ? t("common.jobs.aiCapacityUntil", "The engine's capacity is used up until {when}, so the work stopped. Nothing was lost; start it again then.", { when })
      : t("common.jobs.aiCapacity", "The engine's capacity is used up for now, so the work stopped. Nothing was lost; start it again once it is back.");
  }
  return null;
}

/** True for a failed job's code the app has its own words for (failedJobText): its message is those words. */
export function isKnownFailureCode(errorCode: string | null | undefined): boolean {
  return errorCode === AI_FAILED_CODE || errorCode === AI_CAPACITY_CODE;
}

/** A row as a job; null for anything unusable. Progress is never invented. */
export function toEngineJob(x: unknown): EngineJob | null {
  if (typeof x !== "object" || x === null) return null;
  const r = x as Record<string, unknown>;
  const id = text(r.ItemId);
  const projectId = text(r.ProjectId);
  if (!id || !projectId || !isEngineJobKind(r.Kind) || !isEngineJobStatus(r.Status)) return null;
  const progress = typeof r.Progress === "number" && Number.isFinite(r.Progress) ? Math.min(100, Math.max(0, r.Progress)) : 0;
  const attempts = typeof r.Attempts === "number" && Number.isFinite(r.Attempts) ? Math.max(0, Math.floor(r.Attempts)) : 0;
  // the engine writes plain lines only; a row written before it did (raw tool output) reads plainly too, and a build's
  // lane step ("Building CR-006: file-map 24986 chars for 2 repo(s)") reads in plain words (./laneLine.ts)
  const raw = text(r.Message);
  const plain = raw === null ? null : plainJobMessage(r.Kind, r.Status, raw) || null;
  const known = r.Status === "failed" ? failedJobText(text(r.ErrorCode), raw) : null;
  const message = known ?? (plain === null ? null : plainLaneLine(r.Status, plain));
  const step = plain !== null && !isTerminal(r.Status) ? laneLineStep(plain) : null;
  const refs = Array.isArray(r.OutputRefs) ? r.OutputRefs.map(parseOutputRef).filter((ref): ref is EngineOutputRef => ref !== null) : [];
  return {
    id,
    workspaceId: typeof r.WorkspaceId === "string" ? r.WorkspaceId : "",
    projectId,
    kind: r.Kind,
    status: r.Status,
    inputJson: text(r.InputJson),
    outputRefs: refs,
    progress,
    // the platform's own Blocks sign-in and Blocks account lines reach platform super admins only (./platformOnly.ts)
    message: lineFor(r.Status, message, text(r.ErrorCode)),
    ...(step ? { step } : {}),
    errorCode: text(r.ErrorCode),
    attempts,
    claimedBy: text(r.ClaimedBy),
    claimedAt: date(r.ClaimedAt),
    finishedAt: date(r.FinishedAt),
    createdBy: text(r.RequestedByUserId),
    createdAt: date(r.CreatedDate),
    updatedAt: date(r.LastUpdatedDate),
  };
}

/** True while the job is still queued, claimed or running. */
export function isActiveEngineJob(job: Pick<EngineJob, "status">): boolean {
  return !isTerminal(job.status);
}

/** The newest job (optionally of one kind); the first wins on a tie, jobs without a date rank last. */
export function latestEngineJob(jobs: readonly EngineJob[], kind?: EngineJobKind): EngineJob | null {
  let best: EngineJob | null = null;
  let bestAt = -Infinity;
  for (const j of jobs) {
    if (kind !== undefined && j.kind !== kind) continue;
    const at = j.createdAt === null ? -Infinity : Date.parse(j.createdAt);
    if (best === null || at > bestAt) {
      best = j;
      bestAt = at;
    }
  }
  return best;
}
