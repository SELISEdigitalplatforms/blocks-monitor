// The 3D-office agent chat on SELISE Blocks: reads straight from the Data Gateway (row policies), writes only through
// the `collab` and `delivery` Logic Functions. A change-request task is three server steps with their own requestIds:
// agentChat.send -> delivery cr.saveDraft -> agentChat.recordTask. A failure is shown at the step where it happened and
// Retry repeats that step with the SAME requestId, so nothing is stored twice.
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { callFunction, FunctionError, newRequestId, type FunctionResult } from "../fn";
import { blocksListOptions } from "../data/hooks";
import { blocksKeys } from "../data/keys";
import { whereOf } from "../data/gql";
import { mergeRows } from "../scope/cache";
import { engineJobsListOptions } from "../engine/jobs";
import { isActiveEngineJob, type EngineJob } from "../engine/types";
import { useDeliveryContext } from "../delivery/context";
import { useChangeRequests, useMilestones, useReleases, useTickets } from "../delivery/hooks";
import { AGENT_CHAT_FIELDS, COLLAB_SCHEMA, byAt, toAgentChat, type AgentChatRecord } from "./records";
import { collabErrorMessage } from "./messages";
import { factsFrom, MAX_SHOWN, type ChatFacts, type ChatRecords, type ChatRole } from "../../domain/agentChat";
import { t } from "@/i18n";

type AgentChatRow = Record<string, unknown> & { ItemId: string };

const EMPTY: never[] = [];

const isRowWithItemId = (v: unknown): v is AgentChatRow =>
  typeof v === "object" && v !== null && typeof (v as { ItemId?: unknown }).ItemId === "string";

// ------------------------------------------------------------------------------------------------- reads

/** Puts the raw rows a chat step returned into the cached history lists (read-your-write). */
export function mergeChatRows(client: QueryClient, workspaceId: string, rows: readonly unknown[]): void {
  mergeRows(client, workspaceId, COLLAB_SCHEMA.agentChat, rows.filter(isRowWithItemId));
}

/** How often an open thread is read again while a question waits for its answer (the answer shows the moment the
 *  engine writes it, not only when the job list notices the job finished). */
export const REPLY_POLL_MS = 1500;
/** A question older than this no longer keeps the thread polling (its job failed or stopped; the job list shows why). */
export const REPLY_POLL_FOR_MS = 3 * 60_000;

/** True while a question of the thread (a user message with an engine job) has no answer yet and is recent. */
export function awaitingReply(rows: readonly Record<string, unknown>[], now: number): boolean {
  const answered = new Set(rows.filter((r) => r.Role === "agent" && typeof r.EngineJobId === "string" && r.EngineJobId).map((r) => r.EngineJobId));
  return rows.some((r) => {
    if (r.Role !== "user" || typeof r.EngineJobId !== "string" || !r.EngineJobId || answered.has(r.EngineJobId)) return false;
    const at = Date.parse(String(r.At ?? ""));
    return Number.isFinite(at) && now - at < REPLY_POLL_FOR_MS;
  });
}

/** The newest MAX_SHOWN messages of one agent's thread (At), shown oldest first. */
export function useAgentChat(projectId: string | null, role: ChatRole): { messages: AgentChatRecord[]; isLoading: boolean; error: string | null } {
  const ctx = useDeliveryContext(projectId ?? "");
  const w = whereOf<AgentChatRow>();
  const options = blocksListOptions<AgentChatRow>(COLLAB_SCHEMA.agentChat, {
    workspaceId: ctx.workspaceId,
    fields: AGENT_CHAT_FIELDS as never,
    where: w.and(w.eq("ProjectId", projectId ?? ""), w.eq("AgentRole", role)),
    sort: [{ field: "At", dir: "desc" }],
    pageSize: MAX_SHOWN,
  });
  const q = useQuery({
    ...options,
    enabled: options.enabled && Boolean(projectId),
    refetchInterval: (query: { state: { data: { items?: readonly AgentChatRow[] } | undefined } }) =>
      awaitingReply(query.state.data?.items ?? EMPTY, Date.now()) ? REPLY_POLL_MS : false,
  });
  const messages = useMemo(() => {
    const out: AgentChatRecord[] = [];
    for (const row of q.data?.items ?? EMPTY) {
      const m = toAgentChat(row);
      if (m) out.push(m);
    }
    return out.sort(byAt).slice(-MAX_SHOWN);
  }, [q.data]);
  return { messages, isLoading: q.isLoading, error: q.error ? collabErrorMessage(q.error) : null };
}

/** Display only: what the agent can say about the project, from L8's published delivery hooks through the domain facts. */
export function useChatDisplayFacts(projectId: string | null, role: ChatRole): ChatFacts | null {
  const ctx = useDeliveryContext(projectId ?? "");
  const milestones = useMilestones(ctx);
  const tickets = useTickets(ctx);
  const requests = useChangeRequests(ctx);
  const releases = useReleases(ctx);
  const jobs = useQuery({
    ...engineJobsListOptions(ctx.workspaceId, projectId, ["build.run", "change.build"]),
    enabled: Boolean(ctx.workspaceId && projectId),
  });
  const project = ctx.project;
  const jobList = jobs.data;
  return useMemo(() => {
    if (!projectId || !project) return null;
    const records: ChatRecords = {
      project: { name: project.name, stage: project.stage, resumeTo: null, scopeLockedAt: project.scopeLocked ? "locked" : null },
      lockedVersion: project.currentScopeVersion !== null ? { number: project.currentScopeVersion } : null,
      features: [],
      milestones: milestones.data.map((m) => ({ id: m.id, title: m.name, status: m.status, order: m.sortOrder })),
      tickets: tickets.data.map((t) => ({
        number: t.number, title: t.title, agentRole: t.agent, column: t.column, milestoneId: t.milestoneId ?? "", isDone: t.isDone,
      })),
      changeRequests: requests.data.map((c) => ({
        id: c.id, number: c.number, lane: c.lane, title: c.title, status: c.status, version: c.version ?? "",
      })),
      releases: releases.data.map((r) => ({ environment: r.environment, version: r.version, releasedAt: r.releasedAt ?? "" })),
      jobs: (jobList ?? EMPTY).map((j) => ({
        id: j.id, kind: j.kind, status: j.status, progress: j.progress, targetId: "", createdAt: j.createdAt ?? "",
      })),
    };
    return factsFrom(records, role);
  }, [projectId, project, role, milestones.data, tickets.data, requests.data, releases.data, jobList]);
}

/** Which jobs were active before and are not any more (finished, failed or gone): their reply may have been written. */
export function jobsLeftActive(previous: ReadonlySet<string>, jobs: readonly EngineJob[]): { active: Set<string>; finished: boolean } {
  const active = new Set(jobs.filter(isActiveEngineJob).map((j) => j.id));
  return { active, finished: [...previous].some((id) => !active.has(id)) };
}

/** The project's chat.reply jobs. When one leaves the active states the messages are read again (the engine wrote its reply). */
export function useChatReplyJobs(projectId: string | null): EngineJob[] {
  const ctx = useDeliveryContext(projectId ?? "");
  const client = useQueryClient();
  const q = useQuery({
    ...engineJobsListOptions(ctx.workspaceId, projectId, ["chat.reply"]),
    enabled: Boolean(ctx.workspaceId && projectId),
  });
  const jobs = q.data ?? EMPTY;
  const active = useRef<Set<string>>(new Set());
  const workspaceId = ctx.workspaceId;
  useEffect(() => {
    const { active: now, finished } = jobsLeftActive(active.current, jobs);
    active.current = now;
    if (finished && workspaceId) void client.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, COLLAB_SCHEMA.agentChat) });
  }, [jobs, workspaceId, client]);
  return jobs;
}

// ------------------------------------------------------------------------------------------------- send flow

export type ChatStep = "send" | "draft" | "record";

export type ChatSendState =
  | { phase: "idle" }
  | { phase: "sending"; text: string }
  | { phase: "creating" }
  | { phase: "recording" }
  | { phase: "done"; created: boolean }
  | { phase: "failed"; step: ChatStep; message: string; text: string; pending: boolean };

/** Shown when the send timed out or is still pending: the message may already be stored. */
export const PENDING_MESSAGE = "MADP Factory is taking longer than usual. Your message may still be saved; check again in a moment.";

const isPendingError = (e: unknown): boolean => e instanceof FunctionError && (e.code === "timeout" || e.code === "pending");

export const STEP_LABEL: Record<ChatStep, string> = {
  get send() { return t("build.chat.step.send", "Sending your message…"); },
  get draft() { return t("build.chat.step.draft", "Creating the change request…"); },
  get record() { return t("build.chat.step.record", "Saving the change request in the chat…"); },
};

interface Draft { lane: string; featureRef: string; title: string; description: string }

interface SendAnswer {
  messages?: unknown[];
  route?: string;
  userMessageId?: string;
  job?: { jobId?: string } | null;
  draft?: Draft | null;
  suggestion?: unknown;
}

type Caller = <T>(fn: "collab" | "delivery", op: string, args: Record<string, unknown>, opts?: { requestId?: string }) => Promise<FunctionResult<T>>;

export interface ChatFlowDeps {
  call: Caller;
  newId: () => string;
  onState: (s: ChatSendState) => void;
  /** Called with the rows a step returned, so the screen can show them before the next read. */
  onRows?: (messages: unknown[]) => void;
  /** Called after any step that changed stored data. */
  onChanged?: () => void;
}

/** `attachmentIds` + `draftKey`: the files sent with the message (ready uploads of the composer, talkUpload.ts). */
export interface ChatFlowInput { projectId: string; agentRole: ChatRole; text: string; attachmentIds?: string[]; draftKey?: string }

/** The three-step orchestration. Each step keeps its own requestId for its Retry. */
export function createChatFlow(deps: ChatFlowDeps) {
  let input: ChatFlowInput | null = null;
  const ids: Record<ChatStep, string> = { send: "", draft: "", record: "" };
  let sent: SendAnswer | null = null;
  let changeRequestId: string | null = null;
  let finished = false;
  let running = false;

  const fail = (step: ChatStep, e: unknown) => {
    const pending = isPendingError(e);
    deps.onState({ phase: "failed", step, message: pending ? t("build.chat.pending", "MADP Factory is taking longer than usual. Your message may still be saved; check again in a moment.") : collabErrorMessage(e), text: input?.text ?? "", pending });
    // A message that did land (timeout, lost answer) must show up in the history.
    if (step === "send") deps.onChanged?.();
  };

  async function run(): Promise<boolean> {
    if (!input || running || finished) return false;
    running = true;
    try {
      if (!sent) {
        deps.onState({ phase: "sending", text: input.text });
        try {
          const files = input.attachmentIds?.length ? { attachmentIds: input.attachmentIds, draftKey: input.draftKey } : {};
          const r = await deps.call<SendAnswer>("collab", "agentChat.send", { projectId: input.projectId, agentRole: input.agentRole, text: input.text, ...files }, { requestId: ids.send });
          sent = r.data;
          deps.onRows?.(Array.isArray(r.data.messages) ? r.data.messages : []);
          deps.onChanged?.();
        } catch (e) {
          fail("send", e);
          return false;
        }
      }
      if (sent.route !== "change-request" || !sent.draft || !sent.userMessageId) {
        finished = true;
        deps.onState({ phase: "done", created: sent.route === "suggestion" });
        return true;
      }
      if (!changeRequestId) {
        deps.onState({ phase: "creating" });
        try {
          const r = await deps.call<{ changeRequestId?: string }>("delivery", "cr.saveDraft", { projectId: input.projectId, ...sent.draft }, { requestId: ids.draft });
          if (typeof r.data.changeRequestId !== "string" || !r.data.changeRequestId) throw new Error("unknown");
          changeRequestId = r.data.changeRequestId;
        } catch (e) {
          fail("draft", e);
          return false;
        }
      }
      deps.onState({ phase: "recording" });
      try {
        const r = await deps.call<{ message?: unknown }>("collab", "agentChat.recordTask", {
          projectId: input.projectId, agentRole: input.agentRole, userMessageId: sent.userMessageId, changeRequestId,
        }, { requestId: ids.record });
        deps.onRows?.(r.data.message ? [r.data.message] : []);
        deps.onChanged?.();
      } catch (e) {
        fail("record", e);
        return false;
      }
      finished = true;
      deps.onState({ phase: "done", created: true });
      return true;
    } finally {
      running = false;
    }
  }

  return {
    /** Starts a new message with fresh requestIds. */
    start(next: ChatFlowInput): Promise<boolean> {
      if (running) return Promise.resolve(false);
      input = next;
      ids.send = deps.newId();
      ids.draft = deps.newId();
      ids.record = deps.newId();
      sent = null;
      changeRequestId = null;
      finished = false;
      return run();
    },
    /** Repeats the step that failed, with the requestId it used before. */
    retry: run,
  };
}

interface FlowEntry {
  flow: ReturnType<typeof createChatFlow>;
  state: ChatSendState;
  listeners: Set<() => void>;
  /** Overridable: the latest mounted screen sets it; tests replace `call`. */
  call: Caller;
  invalidate: () => void;
  /** Puts the rows a step answered into the cached history, so they show before the refetch lands. */
  merge: (rows: unknown[]) => void;
}

const IDLE: ChatSendState = { phase: "idle" };

/** One flow and its last state per project and agent, so a remount can never reset an in-flight send. */
const flows = new Map<string, FlowEntry>();

export function chatFlowEntry(key: string): FlowEntry {
  let entry = flows.get(key);
  if (entry) return entry;
  const e: FlowEntry = {
    state: IDLE,
    listeners: new Set(),
    call: callFunction as unknown as Caller,
    invalidate: () => {},
    merge: () => {},
    flow: undefined as unknown as FlowEntry["flow"],
  };
  const set = (s: ChatSendState) => { e.state = s; e.listeners.forEach((l) => l()); };
  e.flow = createChatFlow({
    call: (fn, op, args, opts) => e.call(fn, op, args, opts),
    newId: newRequestId,
    onState: set,
    onRows: (rows) => e.merge(rows),
    onChanged: () => e.invalidate(),
  });
  flows.set(key, e);
  entry = e;
  return entry;
}

/** Sends a message to an agent; exposes the step state and Retry. */
export function useSendAgentMessage(projectId: string | null, role: ChatRole) {
  const client = useQueryClient();
  const ctx = useDeliveryContext(projectId ?? "");
  const workspaceId = ctx.workspaceId;
  const entry = chatFlowEntry(`${projectId ?? ""}:${role}`);

  useEffect(() => {
    entry.invalidate = () => {
      if (!workspaceId) return;
      for (const schema of [COLLAB_SCHEMA.agentChat, "ChangeRequest", "Suggestion", "EngineJob", COLLAB_SCHEMA.attachment]) {
        void client.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, schema) });
      }
    };
    entry.merge = (rows) => { if (workspaceId) mergeChatRows(client, workspaceId, rows); };
  }, [entry, client, workspaceId]);

  const subscribe = useCallback((l: () => void) => { entry.listeners.add(l); return () => { entry.listeners.delete(l); }; }, [entry]);
  const state = useSyncExternalStore(subscribe, () => entry.state, () => IDLE);

  const send = useCallback(
    (text: string, files?: { attachmentIds: string[]; draftKey: string }) =>
      (projectId ? entry.flow.start({ projectId, agentRole: role, text, ...(files ?? {}) }) : Promise.resolve(false)),
    [entry, projectId, role],
  );
  const retry = useCallback(() => entry.flow.retry(), [entry]);
  /** Called once the screen has handled a finished send, so a remount does not handle it again. */
  const settle = useCallback(() => {
    if (entry.state.phase === "done") { entry.state = IDLE; entry.listeners.forEach((l) => l()); }
  }, [entry]);
  const busy = state.phase === "sending" || state.phase === "creating" || state.phase === "recording";
  return { state, busy, send, retry, settle };
}
