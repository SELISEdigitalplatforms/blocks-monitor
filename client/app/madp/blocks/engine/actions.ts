// The EngineJob write side: people's ops on the Logic Function "project", never a direct write.
import type { QueryClient } from "@tanstack/react-query";
import { callFunction, FunctionError, functionErrorMessage, type CallOptions, type createFunctionCaller } from "../fn";
import { t } from "@/madp/i18n";
import { FunctionNotConfiguredError } from "../functions";
import { BlocksDataError } from "../data/errors";
import { queryClient } from "../queryClient";
import { ENGINE_JOB_USER_OPS, isEngineJobKind, type EngineJobKind } from "@/madp/domain/engineJob";
import { ENGINE_JOB_SCHEMA } from "./types";

export type FunctionCaller = ReturnType<typeof createFunctionCaller>;

/** What job.create answers: the job, and whether an active job of the same kind and target already existed. */
export interface RequestedEngineJob {
  jobId: string;
  existing: boolean;
}

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** True for any cached query of the EngineJob schema (keys are ["ws", workspaceId, schema, params]). */
export function isEngineJobQuery(q: { queryKey: readonly unknown[] }): boolean {
  return q.queryKey[0] === "ws" && q.queryKey[2] === ENGINE_JOB_SCHEMA;
}

/** True when the project function has no SELISE Blocks id yet. */
export function isEngineNotConfigured(e: unknown): boolean {
  return e instanceof FunctionNotConfiguredError;
}

/** A plain message for any failure of an engine job action. */
export function engineErrorMessage(e: unknown): string {
  if (e instanceof FunctionError && e.messageKey === "job.useStepAction") return t("build.errors.useStepAction", "Start this from its step page.");
  if (e instanceof FunctionNotConfiguredError || e instanceof FunctionError || e instanceof BlocksDataError) return e.message;
  if (e instanceof TypeError) return functionErrorMessage("invalid_input");
  return functionErrorMessage("unknown");
}

function checkId(id: unknown): string {
  if (typeof id !== "string" || !SAFE_ID.test(id)) throw new TypeError("Invalid id.");
  return id;
}

/** The three actions on a function caller and a query client (the tests inject fakes). */
export function createEngineJobActions(call: FunctionCaller, client: QueryClient) {
  const refresh = () => client.invalidateQueries({ predicate: isEngineJobQuery });

  return {
    async requestEngineJob(
      kind: EngineJobKind,
      projectId: string,
      input: Record<string, unknown> = {},
      opts?: CallOptions,
    ): Promise<RequestedEngineJob> {
      if (!isEngineJobKind(kind)) throw new TypeError("Unknown engine job kind.");
      checkId(projectId);
      if (typeof input !== "object" || input === null || Array.isArray(input)) throw new TypeError("Invalid input.");
      const res = await call<{ jobId?: unknown; existing?: unknown }>("project", ENGINE_JOB_USER_OPS.create, { kind, projectId, input }, opts);
      const jobId = res.data?.jobId;
      if (typeof jobId !== "string" || jobId === "") throw new FunctionError("unknown", functionErrorMessage("unknown"), res.requestId);
      await refresh();
      return { jobId, existing: res.data.existing === true };
    },

    async cancelEngineJob(jobId: string, opts?: CallOptions): Promise<void> {
      checkId(jobId);
      await call("project", ENGINE_JOB_USER_OPS.cancel, { jobId }, opts);
      await refresh();
    },

    async retryEngineJob(jobId: string, opts?: CallOptions): Promise<void> {
      checkId(jobId);
      await call("project", ENGINE_JOB_USER_OPS.retry, { jobId }, opts);
      await refresh();
    },
  };
}

const actions = createEngineJobActions(callFunction, queryClient);

export const requestEngineJob = actions.requestEngineJob;
export const cancelEngineJob = actions.cancelEngineJob;
export const retryEngineJob = actions.retryEngineJob;
