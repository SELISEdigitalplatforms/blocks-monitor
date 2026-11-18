// The floating assistant's web data: reads straight from the Data Gateway, every write through the `collab` function
// (and, for a fix, L8's `delivery` ops). The browser keeps a text excerpt of a text file in the message, never bytes.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { callFunction, newRequestId, type createFunctionCaller } from "../fn";
import { queryClient } from "../queryClient";
import { blocksAllOptions } from "../data/hooks";
import { whereOf } from "../data/gql";
import { blocksKeys } from "../data/keys";
import type { BlocksDataError } from "../data/errors";
import { useEngineJobs } from "../engine/jobs";
import { isEngineJobQuery } from "../engine/actions";
import type { EngineJob } from "../engine/types";
import { isActiveEngineJob } from "../engine/types";
import { deliveryActionMessage } from "../delivery/actions";
import { useDeliveryContext } from "../delivery/context";
import { latestJobFor, useReleases } from "../delivery/hooks";
import type { EngineJobKind } from "../../domain/engineJob";
import { EXCERPT_CHARS, MAX_FILES, MAX_FILE_BYTES, isTextFile, type AttachmentNote } from "../../domain/assistant";
import { useCollabContext } from "./context";
import { collabErrorMessage } from "./messages";
import { ASSISTANT_FIELDS, COLLAB_SCHEMA, byAt, mapRows, toAssistantMessage, type AssistantMessageRecord } from "./records";

export type AssistantCaller = ReturnType<typeof createFunctionCaller>;
export type AssistantEnvironment = "dev" | "stage" | "production";

type Row = Record<string, unknown>;

const MAX_MESSAGES = 200;
export const ASSISTANT_JOB_KINDS: readonly EngineJobKind[] = ["fix.analyse", "chat.reply", "change.build"];

/** The draft L8's cr.saveDraft validates, built by the server and passed on unchanged. */
export interface FixDraft {
  lane: "fix";
  featureRef: string;
  title: string;
  description: string;
}

export type FixStep = "claim" | "saveDraft" | "startBuild" | "record";

export type StartFixResult =
  | { ok: true; changeRequestId: string }
  | { ok: false; step: FixStep; error: string; changeRequestId?: string; recorded?: boolean };

// ---------------------------------------------------------------- reads

const toMessages = (rows: Row[]): AssistantMessageRecord[] => mapRows(rows, toAssistantMessage).sort(byAt);

/** Query options for a project's assistant messages: one stream per project, At ascending, at most 200. */
export function assistantMessagesOptions(workspaceId: string | null | undefined, projectId: string | null | undefined) {
  const base = blocksAllOptions<Row>(COLLAB_SCHEMA.assistant, {
    workspaceId,
    fields: ASSISTANT_FIELDS as unknown as readonly string[],
    where: whereOf<Row>().eq("ProjectId", projectId ?? ""),
    sort: [{ field: "At", dir: "asc" }],
    maxItems: MAX_MESSAGES,
  });
  return { ...base, enabled: base.enabled && Boolean(projectId), select: toMessages };
}

export function useAssistantMessages(projectId: string | null | undefined): UseQueryResult<AssistantMessageRecord[], BlocksDataError> {
  const { workspaceId } = useCollabContext();
  return useQuery(assistantMessagesOptions(workspaceId, projectId));
}

/** The project's fix.analyse, chat.reply and change.build jobs. A reply or analysis job that finishes refetches the
 *  messages, because the engine wrote its answer as a new row. */
export function useAssistantJobs(projectId: string | null | undefined): EngineJob[] {
  const { workspaceId } = useCollabContext();
  const jobs = useEngineJobs(projectId, ASSISTANT_JOB_KINDS).data;
  const seen = useRef<Map<string, boolean>>(new Map());
  useEffect(() => {
    let finished = false;
    for (const j of jobs ?? []) {
      const wasActive = seen.current.get(j.id);
      const active = isActiveEngineJob(j);
      if (wasActive === true && !active && j.kind !== "change.build") finished = true;
      seen.current.set(j.id, active);
    }
    if (finished && workspaceId) void queryClient.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, COLLAB_SCHEMA.assistant) });
  }, [jobs, workspaceId]);
  return jobs ?? NO_JOBS;
}
const NO_JOBS: EngineJob[] = [];

/** The environments the window offers: dev, plus stage and production once the project has a release there. */
export function environmentsFrom(releases: readonly { environment: string }[]): AssistantEnvironment[] {
  const have = new Set(releases.map((r) => r.environment));
  return (["dev", "stage", "production"] as const).filter((e) => e === "dev" || have.has(e));
}

export function useAssistantEnvironments(projectId: string | null | undefined): AssistantEnvironment[] {
  const ctx = useDeliveryContext(projectId ?? "");
  const releases = useReleases(ctx).data;
  return useMemo(() => environmentsFrom(releases), [releases]);
}

/** The change.build job of a fix's change request. */
export function fixJobOf(jobs: readonly EngineJob[], changeRequestId: string): EngineJob | null {
  return changeRequestId ? latestJobFor(jobs, "change.build", { changeRequestId }) : null;
}

/** The fix.analyse job of a bug report message (the user message carries its EngineJobId). */
export function jobById(jobs: readonly EngineJob[], id: string): EngineJob | null {
  return id ? (jobs.find((j) => j.id === id) ?? null) : null;
}

// ---------------------------------------------------------------- files

export interface PickedFile {
  name: string;
  type: string;
  size: number;
  text?: () => Promise<string>;
}

/** The notes of the attached files: a text excerpt for text files, nothing else. No bytes are kept or uploaded. */
export async function readAttachmentNotes(files: readonly PickedFile[]): Promise<AttachmentNote[]> {
  const notes: AttachmentNote[] = [];
  for (const f of files) {
    const mime = f.type || "application/octet-stream";
    let excerpt = "";
    if (isTextFile(f.name, mime) && f.text) {
      try {
        excerpt = (await f.text()).slice(0, EXCERPT_CHARS);
      } catch {
        excerpt = "";
      }
    }
    notes.push({ name: f.name.slice(0, 255), mime: mime.slice(0, 100), size: f.size, excerpt });
  }
  return notes;
}

/** A message about the files, or "" when they are fine. UX only; the server checks again. */
export function checkFiles(current: number, next: readonly { name: string; size: number }[]): { accepted: number; error: string } {
  let accepted = 0;
  let error = "";
  for (const f of next) {
    if (current + accepted >= MAX_FILES) {
      error = `Attach up to ${MAX_FILES} files to one message.`;
      break;
    }
    if (f.size > MAX_FILE_BYTES) {
      error = `${f.name} is larger than ${MAX_FILE_BYTES / (1024 * 1024)} MB.`;
      continue;
    }
    accepted += 1;
  }
  return { accepted, error };
}

// ---------------------------------------------------------------- actions

function rowsOf(data: unknown, key: string): Row[] {
  const v = data && typeof data === "object" ? (data as Record<string, unknown>)[key] : null;
  return Array.isArray(v) ? v.filter((r): r is Row => !!r && typeof r === "object") : [];
}

function oneRow(data: unknown, key: string): Row | null {
  const v = data && typeof data === "object" ? (data as Record<string, unknown>)[key] : null;
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : null;
}

const stringOf = (v: unknown): string => (typeof v === "string" ? v : "");

/** Writes the returned rows into the cached message lists (read-your-write), then asks for a refetch. */
function cacheRows(client: QueryClient, workspaceId: string | null, projectId: string, rows: readonly Row[]): void {
  if (!workspaceId) return;
  const key = blocksKeys.schema(workspaceId, COLLAB_SCHEMA.assistant);
  const mine = rows.filter((r) => typeof r.ItemId === "string" && (r.ProjectId === undefined || r.ProjectId === projectId));
  if (mine.length > 0) {
    client.setQueriesData({ queryKey: key }, (old: unknown) => {
      if (!Array.isArray(old)) return old;
      const byId = new Map<string, Row>();
      for (const r of old as Row[]) byId.set(stringOf(r.ItemId), r);
      for (const r of mine) byId.set(stringOf(r.ItemId), { ...byId.get(stringOf(r.ItemId)), ...r });
      return [...byId.values()].sort((a, b) => (stringOf(a.At) < stringOf(b.At) ? -1 : stringOf(a.At) > stringOf(b.At) ? 1 : 0));
    });
  }
  void client.invalidateQueries({ queryKey: key });
}

export interface SendResult {
  messages: Row[];
  jobId: string | null;
}

/** The state of one start-the-fix run, kept between a failure and its Retry so finished steps are not repeated. */
export interface StartFixState {
  ids: { claim: string; save: string; build: string; release: string };
  claimed: boolean;
  draft: FixDraft | null;
  changeRequestId: string;
  built: boolean;
}

export function newStartFixState(): StartFixState {
  return {
    ids: { claim: newRequestId(), save: newRequestId(), build: newRequestId(), release: newRequestId() },
    claimed: false,
    draft: null,
    changeRequestId: "",
    built: false,
  };
}

/** The assistant's write operations on a function caller and a query client (the tests inject fakes). */
export function createAssistantActions(call: AssistantCaller, client: QueryClient, workspaceId: string | null) {
  const refreshJobs = () => client.invalidateQueries({ predicate: isEngineJobQuery });

  return {
    async send(
      args: { projectId: string; environment: AssistantEnvironment; text: string; attachments: AttachmentNote[] },
      requestId: string,
    ): Promise<SendResult> {
      const res = await call<Record<string, unknown>>("collab", "assistant.send", args, { requestId });
      const messages = rowsOf(res.data, "messages");
      cacheRows(client, workspaceId, args.projectId, messages);
      const job = oneRow(res.data, "job");
      if (job) await refreshJobs();
      return { messages, jobId: job ? stringOf(job.ItemId) || stringOf(job.jobId) || stringOf(job.id) || null : null };
    },

    async analyse(args: { projectId: string; messageId: string }, requestId: string): Promise<void> {
      const res = await call<Record<string, unknown>>("collab", "assistant.analyse", args, { requestId });
      const message = oneRow(res.data, "message");
      if (message) cacheRows(client, workspaceId, args.projectId, [message]);
      else cacheRows(client, workspaceId, args.projectId, []);
      await refreshJobs();
    },

    async decline(args: { projectId: string; messageId: string }, requestId: string): Promise<void> {
      const res = await call<Record<string, unknown>>("collab", "assistant.fix.decline", args, { requestId });
      const rows = [oneRow(res.data, "message"), oneRow(res.data, "note")].filter((r): r is Row => r !== null);
      cacheRows(client, workspaceId, args.projectId, rows);
    },

    /** claim → cr.saveDraft → cr.startBuild → record. A failed saveDraft releases the claim; a failed startBuild still
     *  records the draft, so the message says "saved as a draft". */
    async startFix(args: { projectId: string; messageId: string }, state: StartFixState): Promise<StartFixResult> {
      const { projectId } = args;
      const finish = () => {
        cacheRows(client, workspaceId, projectId, []);
        void client.invalidateQueries({ queryKey: workspaceId ? blocksKeys.schema(workspaceId, "ChangeRequest") : ["ws"] });
        void refreshJobs();
      };

      if (!state.claimed) {
        try {
          const res = await call<Record<string, unknown>>("collab", "assistant.fix.claim", args, { requestId: state.ids.claim });
          const draft = oneRow(res.data, "draft");
          if (!draft || draft.lane !== "fix") throw new TypeError("Missing draft.");
          state.draft = {
            lane: "fix",
            featureRef: stringOf(draft.featureRef),
            title: stringOf(draft.title),
            description: stringOf(draft.description),
          };
          state.claimed = true;
          const message = oneRow(res.data, "message");
          if (message) cacheRows(client, workspaceId, projectId, [message]);
        } catch (e) {
          return { ok: false, step: "claim", error: collabErrorMessage(e) };
        }
      }

      if (!state.changeRequestId) {
        try {
          const res = await call<Record<string, unknown>>(
            "delivery", "cr.saveDraft", { projectId, ...state.draft }, { requestId: state.ids.save },
          );
          const id = stringOf((res.data as Row | null)?.changeRequestId);
          if (!id) throw new TypeError("Missing change request.");
          state.changeRequestId = id;
        } catch (e) {
          try {
            await call("collab", "assistant.fix.release", args, { requestId: state.ids.release });
          } catch {
            // the claim stays with this person, who can start again
          }
          const error = deliveryActionMessage(e);
          Object.assign(state, newStartFixState());
          finish();
          return { ok: false, step: "saveDraft", error };
        }
      }

      let buildError: string | null = null;
      if (!state.built) {
        try {
          // a fix goes through the change process too: analysis, approval, then the build (cr.submit, not cr.startBuild)
          await call("delivery", "cr.submit", { projectId, changeRequestId: state.changeRequestId }, { requestId: state.ids.build });
          state.built = true;
        } catch (e) {
          buildError = deliveryActionMessage(e);
          state.ids.build = newRequestId();
        }
      }

      try {
        const res = await call<Record<string, unknown>>(
          "collab", "assistant.fix.record", { ...args, changeRequestId: state.changeRequestId }, { requestId: newRequestId() },
        );
        const rows = [oneRow(res.data, "message"), oneRow(res.data, "followUp")].filter((r): r is Row => r !== null);
        cacheRows(client, workspaceId, projectId, rows);
      } catch (e) {
        finish();
        return { ok: false, step: "record", error: buildError ?? collabErrorMessage(e), changeRequestId: state.changeRequestId };
      }
      finish();
      if (buildError !== null) {
        return { ok: false, step: "startBuild", error: buildError, changeRequestId: state.changeRequestId, recorded: true };
      }
      return { ok: true, changeRequestId: state.changeRequestId };
    },
  };
}

// ---------------------------------------------------------------- hooks

export interface AssistantAction<A, R> {
  run(args: A): Promise<R | null>;
  pending: boolean;
  error: string | null;
  reset(): void;
}

function useAction<A, R>(exec: (args: A, requestId: string) => Promise<R>, key: (args: A) => string, messageOf: (e: unknown) => string = collabErrorMessage): AssistantAction<A, R> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useRef(new Map<string, string>());
  const run = useCallback(
    async (args: A): Promise<R | null> => {
      const k = key(args);
      const requestId = ids.current.get(k) ?? newRequestId();
      ids.current.set(k, requestId);
      setPending(true);
      setError(null);
      try {
        const out = await exec(args, requestId);
        ids.current.delete(k);
        return out;
      } catch (e) {
        setError(messageOf(e));
        return null;
      } finally {
        setPending(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exec],
  );
  const reset = useCallback(() => setError(null), []);
  return { run, pending, error, reset };
}

export interface SendInput {
  environment: AssistantEnvironment;
  text: string;
  files: readonly PickedFile[];
}

/** Sends a message. The same text and files after a failure reuse the request id, so a retry duplicates nothing. */
export function useSendAssistant(projectId: string | null): AssistantAction<SendInput, SendResult> {
  const { workspaceId } = useCollabContext();
  const actions = useMemo(() => createAssistantActions(callFunction, queryClient, workspaceId), [workspaceId]);
  const exec = useCallback(
    async (args: SendInput, requestId: string): Promise<SendResult> => {
      if (!projectId) throw new TypeError("No project.");
      const attachments = await readAttachmentNotes(args.files);
      return actions.send({ projectId, environment: args.environment, text: args.text, attachments }, requestId);
    },
    [actions, projectId],
  );
  return useAction(exec, (a) => JSON.stringify([a.environment, a.text, a.files.map((f) => [f.name, f.size])]));
}

export function useAnalyseReport(projectId: string | null): AssistantAction<{ messageId: string }, true> {
  const { workspaceId } = useCollabContext();
  const actions = useMemo(() => createAssistantActions(callFunction, queryClient, workspaceId), [workspaceId]);
  const exec = useCallback(
    async (args: { messageId: string }, requestId: string) => {
      if (!projectId) throw new TypeError("No project.");
      await actions.analyse({ projectId, messageId: args.messageId }, requestId);
      return true as const;
    },
    [actions, projectId],
  );
  return useAction(exec, (a) => a.messageId);
}

export function useDeclineFix(projectId: string | null): AssistantAction<{ messageId: string }, true> {
  const { workspaceId } = useCollabContext();
  const actions = useMemo(() => createAssistantActions(callFunction, queryClient, workspaceId), [workspaceId]);
  const exec = useCallback(
    async (args: { messageId: string }, requestId: string) => {
      if (!projectId) throw new TypeError("No project.");
      await actions.decline({ projectId, messageId: args.messageId }, requestId);
      return true as const;
    },
    [actions, projectId],
  );
  return useAction(exec, (a) => a.messageId);
}

export interface StartFix {
  start(): Promise<StartFixResult | null>;
  pending: boolean;
  /** The step that failed, with its plain message; null while fine. */
  failure: { step: FixStep; error: string; recorded: boolean } | null;
  reset(): void;
}

/** Start the fix of an analysis message. Retry continues at the step that failed. */
export function useStartFix(projectId: string | null, messageId: string): StartFix {
  const { workspaceId } = useCollabContext();
  const actions = useMemo(() => createAssistantActions(callFunction, queryClient, workspaceId), [workspaceId]);
  const state = useRef<StartFixState>(newStartFixState());
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<StartFix["failure"]>(null);
  const start = useCallback(async (): Promise<StartFixResult | null> => {
    if (!projectId) return null;
    setPending(true);
    setFailure(null);
    try {
      const res = await actions.startFix({ projectId, messageId }, state.current);
      if (res.ok) state.current = newStartFixState();
      else setFailure({ step: res.step, error: res.error, recorded: res.recorded === true });
      return res;
    } finally {
      setPending(false);
    }
  }, [actions, projectId, messageId]);
  const reset = useCallback(() => setFailure(null), []);
  return { start, pending, failure, reset };
}
