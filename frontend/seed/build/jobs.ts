// Engine jobs as the MADP engine leaves them (functions/_lib/jobs.ts + docs/ENGINE-CONTRACT.md): queued jobs wait
// for the local engine; claimed / running jobs hold the active key `<kind>:<target|project>`; a finished job no longer
// holds it (the engine sets ActiveKey to the job's own id; the seed gives it a stable uuid, as it cannot know the id).
import { uuid5 } from "../../functions/_lib/ids";
import type { P } from "../model";
import { plus, row, u, type Ctx } from "./ctx";

export type JobKind =
  | "requirements.draft" | "sanitization.assist" | "design.generate" | "scope.grill" | "milestones.suggest" | "board.plan"
  | "build.run" | "change.build" | "fix.analyse" | "preview.deploy" | "wiki.generate" | "chat.reply";

export interface JobSpec {
  local: string;
  kind: JobKind;
  status: "queued" | "claimed" | "running" | "succeeded" | "failed" | "cancelled";
  by: P;
  /** CreatedDate. */
  at: string;
  /** Minutes from claim to finish (finished jobs) or claim to now (running jobs is up to now). */
  minutes?: number;
  target?: { type: string; id: string };
  input: Record<string, unknown>;
  outputs?: string[];
  progress?: number;
  message?: string;
  error?: string;
  requestKey?: string;
}

const ENGINES = ["madp-engine-zrh-01", "madp-engine-zrh-02", "madp-engine-fra-01"];

export async function job(c: Ctx, j: JobSpec): Promise<string> {
  const active = j.status === "queued" || j.status === "claimed" || j.status === "running";
  const engine = ENGINES[(c.plan.key.length + j.local.length) % ENGINES.length]!;
  const claimedAt = plus(c, j.at, 1);
  const finishedAt = plus(c, claimedAt, j.minutes ?? 6);
  const done = j.status === "succeeded" || j.status === "failed" || j.status === "cancelled";
  const activeKey = active ? `${j.kind}:${j.target?.id ?? "project"}` : uuid5(`job:${c.ws.id}:${c.plan.key}:${j.local}`);
  const fields: Record<string, unknown> = {
    Kind: j.kind,
    Status: j.status,
    ActiveKey: activeKey,
    TargetType: j.target?.type ?? "",
    TargetId: j.target?.id ?? "",
    InputJson: JSON.stringify(j.input),
    OutputRefs: j.outputs ?? [],
    Progress: j.status === "succeeded" ? 100 : j.progress ?? 0,
    Message: j.message ?? "",
    Attempts: j.status === "queued" ? 0 : 1,
    RequestedByUserId: u(c, j.by),
  };
  if (j.status !== "queued") {
    fields.ClaimedBy = engine;
    fields.ClaimedAt = claimedAt;
  }
  if (j.status === "running" || done) fields.StartedAt = plus(c, claimedAt, 0.5);
  if (done) fields.FinishedAt = finishedAt;
  if (j.status === "failed") fields.ErrorCode = j.error ?? "engine.failed";
  const updatedAt = done ? finishedAt : j.status === "queued" ? j.at : c.s.clock.at("-4m");
  return row(c, "EngineJob", `job-${j.local}`, fields, { by: j.by, at: j.at, updatedAt, requestKey: j.requestKey ?? `job:${j.kind}:${c.id}:${j.local}` });
}
