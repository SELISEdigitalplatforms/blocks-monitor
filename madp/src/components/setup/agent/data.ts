/** The business agent's state on the Project setup page: its latest reading (an EngineJob of kind setup.assist), what
 *  it found (SetupSuggestion rows) and the two calls (wake: read what nobody has read yet; decide: added / ignored /
 *  open). Adding what it found goes through project.setup.save (src/components/setup/data.ts saveSetup), and a goal or
 *  users through project.setup (the guided start's answers), so the checklist and the "Project brief" follow. */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { blocksAllOptions } from "@/blocks/data/hooks";
import { whereOf, type FieldOf } from "@/blocks/data/gql";
import { blocksKeys } from "@/blocks/data/keys";
import { queryClient } from "@/blocks/queryClient";
import { useProjectsContext } from "@/blocks/projects/context";
import { callProjectOp, putRows } from "@/blocks/projects/mutations";
import { engineJobsListOptions } from "@/blocks/engine/jobs";
import { ENGINE_JOB_SCHEMA, type EngineJob } from "@/blocks/engine/types";
import type { RawRow } from "@/blocks/projects/records";
import { isTerminal } from "@/domain/engineJob";
import {
  SETUP_AGENT_KIND, SETUP_SUGGESTION_SCHEMA, toSetupSuggestion, type AgentRunFacts, type SetupSuggestion, type SuggestionStatus,
} from "@/domain/setupAgent";

const SUGGESTION_FIELDS = [
  "ItemId", "WorkspaceId", "ProjectId", "Kind", "Text", "Priority", "ConstraintKind", "SourceName", "SourceRef", "Status", "EngineJobId", "SortOrder",
] as const;
const rows = whereOf<RawRow>();

export interface AgentInput { fileIds: string[]; noteIds: string[] }

export function inputOf(job: EngineJob | null): AgentInput {
  try {
    const v = JSON.parse(job?.inputJson ?? "{}") as Partial<AgentInput>;
    return { fileIds: Array.isArray(v.fileIds) ? v.fileIds : [], noteIds: Array.isArray(v.noteIds) ? v.noteIds : [] };
  } catch {
    return { fileIds: [], noteIds: [] };
  }
}

/** What a finished reading did (from the rows it names). */
export function factsOf(job: EngineJob | null): AgentRunFacts | null {
  if (!job || job.status !== "succeeded") return null;
  return {
    filed: job.outputRefs.filter((r) => r.schema === "DocFile").length,
    folders: job.outputRefs.filter((r) => r.schema === "DocFolder").length,
  };
}

export interface SetupAgentState {
  /** The latest reading, if any. */
  job: EngineJob | null;
  /** The latest finished reading (its filing is what the line tells about). */
  lastDone: EngineJob | null;
  working: boolean;
  suggestions: SetupSuggestion[];
  open: SetupSuggestion[];
  isLoading: boolean;
}

/** While the step is open and nothing runs, the job list is read this often, so a reading queued by new material shows
 *  up on its own; while a reading runs the live clock reads it (5 s, src/blocks/data/livePoll.ts). It was 2 s while a
 *  reading ran and 5 s otherwise, for as long as the step was open (days for a project being set up). */
export const SETUP_IDLE_POLL_MS = 20_000;

/** The agent's state for a project. The job list is looked at while the project is being set up, so a reading queued
 *  by new material shows up on its own. */
export function useSetupAgent(projectId: string, opts: { live: boolean }): SetupAgentState {
  const { workspaceId } = useProjectsContext();
  const base = engineJobsListOptions(workspaceId, projectId, [SETUP_AGENT_KIND]);
  const jobs = useQuery({
    ...base,
    refetchInterval: (q: { state: { data: { items: { Status?: unknown }[] } | undefined } }) => {
      if (!opts.live) return false;
      const active = q.state.data?.items.some((r) => r.Status === "queued" || r.Status === "claimed" || r.Status === "running");
      return active ? false : SETUP_IDLE_POLL_MS;
    },
  });
  const sugg = useQuery(blocksAllOptions<RawRow>(SETUP_SUGGESTION_SCHEMA, {
    workspaceId,
    where: rows.eq("ProjectId", projectId),
    fields: SUGGESTION_FIELDS as unknown as readonly FieldOf<RawRow>[],
    maxItems: 500,
  }));
  const list = jobs.data ?? [];
  const job = list[0] ?? null;
  const lastDone = list.find((j) => j.status === "succeeded") ?? null;
  const working = Boolean(job && !isTerminal(job.status));

  // a reading that just finished: what it wrote is read again at once
  const was = useRef(working);
  useEffect(() => {
    if (was.current && !working && workspaceId) {
      for (const s of [SETUP_SUGGESTION_SCHEMA, "DocFile", "DocFolder", "DocNote", "Project"]) {
        void queryClient.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, s) });
      }
    }
    was.current = working;
  }, [working, workspaceId]);

  const suggestions = useMemo(
    () => (sugg.data ?? []).map(toSetupSuggestion).filter((s): s is SetupSuggestion => s !== null).sort((a, b) => a.sortOrder - b.sortOrder),
    [sugg.data],
  );
  return { job, lastDone, working, suggestions, open: suggestions.filter((s) => s.status === "open"), isLoading: jobs.isLoading || sugg.isLoading };
}

/** Asks the agent to read what nobody has read yet (answers at once; the reading itself runs in the background). */
export async function wakeSetupAgent(workspaceId: string, projectId: string): Promise<void> {
  await callProjectOp<{ jobId: string | null; queued: boolean }>("project.setup.agent.wake", { projectId });
  void queryClient.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, ENGINE_JOB_SCHEMA) });
}

export async function decideSuggestions(workspaceId: string, projectId: string, ids: readonly string[], decision: SuggestionStatus): Promise<void> {
  if (ids.length === 0) return;
  const data = await callProjectOp<{ suggestions: RawRow[] }>("project.setup.suggestion.decide", { projectId, suggestionIds: [...ids], decision });
  putRows(workspaceId, SETUP_SUGGESTION_SCHEMA, data.suggestions);
}

/** Wakes the agent once per project per page visit (only for people who may edit the setup). */
export function useWakeOnOpen(projectId: string, enabled: boolean): () => void {
  const { workspaceId } = useProjectsContext();
  const done = useRef<string | null>(null);
  const wake = useCallback(() => {
    if (!workspaceId) return;
    wakeSetupAgent(workspaceId, projectId).catch(() => undefined);
  }, [workspaceId, projectId]);
  useEffect(() => {
    if (!enabled || !workspaceId || done.current === projectId) return;
    done.current = projectId;
    wake();
  }, [enabled, workspaceId, projectId, wake]);
  return wake;
}
