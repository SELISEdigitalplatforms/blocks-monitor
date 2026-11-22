// Feedback on requirements: reads go from the browser to the Data Gateway (workspace AND ProjectId scoped, under the row
// policies); every write is a `collab` function op. Answers carry the written rows, which go straight into the cache.
import { useMemo } from "react";
import { useMutation, useQuery, type QueryClient, type UseMutationResult, type UseQueryResult } from "@tanstack/react-query";
import { blocksAllOptions } from "../data/hooks";
import { whereOf } from "../data/gql";
import type { BlocksDataError } from "../data/errors";
import { callFunction, newRequestId } from "../fn";
import { queryClient } from "../queryClient";
import { opensInline, orderComments, threadCounts, threadKey } from "../../domain/feedback";
import {
  ATTACHMENT_FIELDS, COLLAB_SCHEMA, COMMENT_FIELDS, THREAD_FIELDS, mapRows, toAttachment, toComment, toThread,
  type FeedbackAttachmentRecord, type FeedbackCommentRecord, type FeedbackThreadRecord,
} from "./records";
import { invalidateCollab } from "./cache";
import { useCollabContext } from "./context";

type Row = { ItemId: string } & Record<string, unknown>;
type Ws = string | null | undefined;

export const MAX_THREADS = 500;
export const MAX_COMMENTS = 500;
const MAX_STATS = 5000;
const FEEDBACK_ATTACHMENT_OWNER = "feedback-comment";
const STAT_FIELDS = ["ItemId", "ThreadId", "Kind", "AttachmentIds"] as const;

const w = whereOf<Row>();
const scoped = <O extends { enabled: boolean }>(o: O, ws: Ws, ...ids: (string | null | undefined)[]): O => ({
  ...o,
  enabled: o.enabled && Boolean(ws) && ids.every(Boolean),
});

/** One read of the project's FeedbackThread rows. */
export function threadsQueryOptions(ws: Ws, projectId: string | null | undefined) {
  return scoped(
    blocksAllOptions<Row>(COLLAB_SCHEMA.thread, {
      workspaceId: ws, fields: THREAD_FIELDS, where: w.eq("ProjectId", projectId ?? ""), maxItems: MAX_THREADS,
    }), ws, projectId);
}

/** The slim comment rows the buttons count from (no text). */
export function commentStatsQueryOptions(ws: Ws, projectId: string | null | undefined) {
  return scoped(
    blocksAllOptions<Row>(COLLAB_SCHEMA.comment, {
      workspaceId: ws, fields: STAT_FIELDS, where: w.eq("ProjectId", projectId ?? ""), maxItems: MAX_STATS,
    }), ws, projectId);
}

export function commentsQueryOptions(ws: Ws, projectId: string | null | undefined, threadId: string | null | undefined) {
  return scoped(
    blocksAllOptions<Row>(COLLAB_SCHEMA.comment, {
      workspaceId: ws, fields: COMMENT_FIELDS,
      where: w.and(w.eq("ProjectId", projectId ?? ""), w.eq("ThreadId", threadId ?? "")),
      sort: [{ field: "At", dir: "asc" }], maxItems: MAX_COMMENTS,
    }), ws, projectId, threadId);
}

export function attachmentsQueryOptions(ws: Ws, projectId: string | null | undefined, ids: readonly string[]) {
  return scoped(
    blocksAllOptions<Row>(COLLAB_SCHEMA.attachment, {
      workspaceId: ws, fields: ATTACHMENT_FIELDS,
      where: w.and(w.eq("ProjectId", projectId ?? ""), w.eq("OwnerType", FEEDBACK_ATTACHMENT_OWNER), w.in("ItemId", ids)),
      maxItems: Math.max(1, ids.length),
    }), ws, projectId, ids.length > 0 ? "x" : "");
}

// ---------------------------------------------------------------- selects (pure)

export function selectThreads(rows: readonly Row[]): Map<string, FeedbackThreadRecord> {
  const out = new Map<string, FeedbackThreadRecord>();
  for (const t of mapRows(rows, toThread)) out.set(threadKey(t.targetType, t.targetId), t);
  return out;
}

export interface ThreadStat { comments: number; attachments: number }

/** Counts per thread id, from the slim comment rows. */
export function selectCommentStats(rows: readonly Row[]): Map<string, ThreadStat> {
  const byThread = new Map<string, { kind: string; attachmentIds: string[] }[]>();
  for (const r of rows) {
    const threadId = typeof r.ThreadId === "string" ? r.ThreadId : "";
    if (!threadId) continue;
    const ids = Array.isArray(r.AttachmentIds) ? r.AttachmentIds.filter((x): x is string => typeof x === "string") : [];
    byThread.set(threadId, [...(byThread.get(threadId) ?? []), { kind: typeof r.Kind === "string" ? r.Kind : "", attachmentIds: ids }]);
  }
  const out = new Map<string, ThreadStat>();
  for (const [id, list] of byThread) {
    const c = threadCounts({ status: "open" }, list);
    out.set(id, { comments: c.comments, attachments: c.attachments });
  }
  return out;
}

export function selectComments(rows: readonly Row[]): FeedbackCommentRecord[] {
  return orderComments(mapRows(rows, toComment));
}

export function selectAttachments(rows: readonly Row[]): FeedbackAttachmentRecord[] {
  return mapRows(rows, toAttachment).filter((a) => a.status !== "deleted");
}

// ---------------------------------------------------------------- read hooks

/** How often an open card re-reads its thread while the team works on it (the engine writes the reply and the new status). */
export const LIVE_THREAD_MS = 3000;

/** `live`: re-read every LIVE_THREAD_MS (only the open card asks for it, so the many item buttons never poll). */
export interface LiveRead { live?: boolean }

export function useProjectThreads(projectId: string | null | undefined, opts: LiveRead = {}): UseQueryResult<Map<string, FeedbackThreadRecord>, BlocksDataError> {
  const { workspaceId } = useCollabContext();
  return useQuery({
    ...threadsQueryOptions(workspaceId, projectId), select: selectThreads,
    ...(opts.live ? { refetchInterval: LIVE_THREAD_MS, refetchIntervalInBackground: false } : {}),
  });
}

export function useProjectCommentStats(projectId: string | null | undefined): UseQueryResult<Map<string, ThreadStat>, BlocksDataError> {
  const { workspaceId } = useCollabContext();
  return useQuery({ ...commentStatsQueryOptions(workspaceId, projectId), select: selectCommentStats });
}

export function useThreadComments(
  projectId: string | null | undefined, threadId: string | null | undefined, opts: LiveRead = {},
): UseQueryResult<FeedbackCommentRecord[], BlocksDataError> {
  const { workspaceId } = useCollabContext();
  return useQuery({
    ...commentsQueryOptions(workspaceId, projectId, threadId), select: selectComments,
    ...(opts.live ? { refetchInterval: LIVE_THREAD_MS, refetchIntervalInBackground: false } : {}),
  });
}

export function useAttachments(projectId: string | null | undefined, ids: readonly string[]): UseQueryResult<FeedbackAttachmentRecord[], BlocksDataError> {
  const { workspaceId } = useCollabContext();
  const key = [...new Set(ids)].sort();
  const stable = useMemo(() => key, [key.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  return useQuery({ ...attachmentsQueryOptions(workspaceId, projectId, stable), select: selectAttachments });
}

// ---------------------------------------------------------------- cache writes

function upsertRows(client: QueryClient, key: readonly unknown[], rows: readonly Row[]): void {
  if (rows.length === 0) return;
  client.setQueryData<Row[]>(key, (old) => {
    if (!Array.isArray(old)) return old;
    const next = [...old];
    for (const row of rows) {
      const at = next.findIndex((r) => r.ItemId === row.ItemId);
      if (at >= 0) next[at] = { ...next[at], ...row };
      else next.push(row);
    }
    return next;
  });
}

const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && typeof (v as Row).ItemId === "string";
const rowsOf = (v: unknown): Row[] => (Array.isArray(v) ? v.filter(isRow) : isRow(v) ? [v] : []);

export interface CommentAnswer { thread: Row; comment: Row; attachments?: Row[] }

/** Write an add-comment answer into the lists it touches, then refresh in the background. */
export function applyCommentAnswer(client: QueryClient, ws: string, projectId: string, answer: CommentAnswer): void {
  const thread = rowsOf(answer.thread);
  const comment = rowsOf(answer.comment);
  const attachments = rowsOf(answer.attachments);
  upsertRows(client, threadsQueryOptions(ws, projectId).queryKey, thread);
  upsertRows(client, commentStatsQueryOptions(ws, projectId).queryKey, comment);
  const threadId = typeof comment[0]?.ThreadId === "string" ? comment[0].ThreadId : thread[0]?.ItemId;
  if (threadId) upsertRows(client, commentsQueryOptions(ws, projectId, threadId).queryKey, comment);
  invalidateCollab(client, ws, [COLLAB_SCHEMA.thread, COLLAB_SCHEMA.comment, ...(attachments.length ? [COLLAB_SCHEMA.attachment] : [])]);
}

export function applyThreadAnswer(client: QueryClient, ws: string, projectId: string, answer: { thread: Row }): void {
  upsertRows(client, threadsQueryOptions(ws, projectId).queryKey, rowsOf(answer.thread));
  invalidateCollab(client, ws, [COLLAB_SCHEMA.thread]);
}

// ---------------------------------------------------------------- mutations

export interface AddCommentArgs {
  targetType: "requirement" | "extra";
  targetId: string;
  text: string;
  draftKey?: string;
  attachmentIds?: string[];
}
/** A person reopens a thread or accepts and closes it; `decision` says what happened to a suggested change. */
export interface SetThreadStatusArgs { threadId: string; status: "open" | "resolved"; decision?: "applied" | "kept" }

export interface CollabMutationDeps { call?: typeof callFunction; client?: QueryClient }

export function addCommentOptions(projectId: string, ws: string | null, deps: CollabMutationDeps = {}) {
  const call = deps.call ?? callFunction;
  const client = deps.client ?? queryClient;
  return {
    mutationFn: async (args: AddCommentArgs): Promise<CommentAnswer> => {
      const res = await call<CommentAnswer>("collab", "feedback.comment.add", { projectId, ...args }, { requestId: newRequestId() });
      return res.data;
    },
    retry: 0,
    onSuccess: (data: CommentAnswer) => {
      if (ws) applyCommentAnswer(client, ws, projectId, data);
    },
  };
}

export function setThreadStatusOptions(projectId: string, ws: string | null, deps: CollabMutationDeps = {}) {
  const call = deps.call ?? callFunction;
  const client = deps.client ?? queryClient;
  return {
    mutationFn: async (args: SetThreadStatusArgs): Promise<{ thread: Row }> => {
      const res = await call<{ thread: Row }>("collab", "feedback.thread.setStatus", { projectId, ...args }, { requestId: newRequestId() });
      return res.data;
    },
    retry: 0,
    onSuccess: (data: { thread: Row }) => {
      if (ws) applyThreadAnswer(client, ws, projectId, data);
    },
  };
}

export function useAddComment(projectId: string): UseMutationResult<CommentAnswer, Error, AddCommentArgs> {
  const { workspaceId } = useCollabContext();
  return useMutation(addCommentOptions(projectId, workspaceId));
}

export function useSetThreadStatus(projectId: string): UseMutationResult<{ thread: Row }, Error, SetThreadStatusArgs> {
  const { workspaceId } = useCollabContext();
  return useMutation(setThreadStatusOptions(projectId, workspaceId));
}

// ---------------------------------------------------------------- open an attachment

export interface OpenDeps {
  call?: typeof callFunction;
  open?: (url: string) => void;
  download?: (url: string, name: string) => void;
  /** The url op of the file's lane (default: the comment boxes'). */
  urlOp?: string;
}

function defaultOpen(url: string): void {
  window.open(url, "_blank", "noopener,noreferrer");
}

function defaultDownload(url: string, name: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener noreferrer";
  a.download = name;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Ask for a short-lived URL on demand: passive types open in a new tab, everything else downloads. The URL is never kept. */
export async function openAttachment(
  projectId: string,
  attachment: { id: string; fileName?: string; mime?: string } | string,
  deps: OpenDeps = {},
): Promise<void> {
  const id = typeof attachment === "string" ? attachment : attachment.id;
  const name = typeof attachment === "string" ? "" : (attachment.fileName ?? "");
  const call = deps.call ?? callFunction;
  const res = await call<{ url: string; expiresAt?: string; opensInline?: boolean }>(
    "collab", deps.urlOp ?? "feedback.attachment.url", { projectId, attachmentId: id }, { requestId: newRequestId() });
  const url = res.data?.url;
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) throw new Error("no url");
  const inline = typeof res.data.opensInline === "boolean"
    ? res.data.opensInline
    : opensInline(typeof attachment === "string" ? "" : (attachment.mime ?? ""));
  if (inline) (deps.open ?? defaultOpen)(url);
  else (deps.download ?? defaultDownload)(url, name);
}
