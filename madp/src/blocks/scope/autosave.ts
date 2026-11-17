// Autosave for the scope editor and the milestone arrangement. Edits save 800 ms after the last change, on blur
// (the UI calls flush), on tab hide and when leaving the page. One save is in flight at a time; the newest pending
// change runs after it. Each flush is one call to the server, so one requestId. Nothing is kept in localStorage.
import { useEffect, useMemo, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { FunctionError } from "../fn";
import { queryClient } from "../queryClient";
import { blocksKeys } from "../data/keys";
import { validateMilestonePlan, type PlanMilestone } from "../../domain/milestones";
import type { ScopeContext } from "./context";
import { milestoneIssueText, staleRowText } from "./messages";
import {
  failureText,
  SCOPE_SCHEMAS,
  useMilestonesSave,
  useScopeSave,
  type FeatureInput,
  type MilestonesSaveAnswer,
  type MilestonesSaveArgs,
  type PlanInput,
  type ScopeSaveAnswer,
  type ScopeSaveArgs,
  type StoryInput,
} from "./mutations";

export const AUTOSAVE_DELAY_MS = 800;

export interface AutosaveStatus {
  state: "idle" | "saving" | "saved" | "error";
  savedAt: string | null;
  error: string | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 'Saving…', 'Saved hh:mm' (24 h, local time), 'Not saved: <reason>'; empty while idle. */
export function saveStatusText(s: AutosaveStatus): string {
  if (s.state === "saving") return "Saving…";
  if (s.state === "error") return `Not saved: ${s.error ?? "something went wrong"}`;
  if (s.state === "saved" && s.savedAt) {
    const d = new Date(s.savedAt);
    return `Saved ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return "";
}

export interface AutosaverConfig<T> {
  delayMs?: number;
  merge(pending: T | null, next: T): T;
  save(change: T): Promise<void>;
  onStatus(s: AutosaveStatus): void;
  now(): Date;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface Autosaver<T> {
  push(change: T): void;
  /** Saves now (and waits for the save in flight). Never rejects: a failure shows in the status and keeps the change. */
  flush(): Promise<void>;
  /** Drops the pending change and the timer (a reload after a conflict). */
  discard(): void;
  dispose(): void;
  hasPending(): boolean;
}

export function createAutosaver<T>(cfg: AutosaverConfig<T>): Autosaver<T> {
  const delay = cfg.delayMs ?? AUTOSAVE_DELAY_MS;
  let pending: T | null = null;
  let timer: unknown = null;
  let running: Promise<void> | null = null;
  let savedAt: string | null = null;

  const clear = () => {
    if (timer !== null) cfg.clearTimer(timer);
    timer = null;
  };

  const drain = (): Promise<void> => {
    if (running) return running;
    if (pending === null) return Promise.resolve();
    // The loop starts synchronously (so 'saving' is set at once); the latch clears in .finally, which always runs
    // after this assignment, never before it.
    const run = (async () => {
      while (pending !== null) {
        const take: T = pending;
        pending = null;
        cfg.onStatus({ state: "saving", savedAt, error: null });
        try {
          await cfg.save(take);
        } catch (e) {
          // Keep the change (newer edits win) so Retry sends it again.
          pending = pending === null ? take : cfg.merge(take, pending);
          cfg.onStatus({ state: "error", savedAt, error: e instanceof Error ? e.message : String(e) });
          return;
        }
        savedAt = cfg.now().toISOString();
        if (pending === null) cfg.onStatus({ state: "saved", savedAt, error: null });
      }
    })();
    running = run.finally(() => {
      running = null;
    });
    return running;
  };

  return {
    push(change) {
      pending = cfg.merge(pending, change);
      clear();
      timer = cfg.setTimer(() => {
        timer = null;
        void drain();
      }, delay);
    },
    flush() {
      clear();
      return drain();
    },
    discard() {
      clear();
      pending = null;
    },
    dispose: clear,
    hasPending: () => pending !== null,
  };
}

// ---------------------------------------------------------------- features and stories

/** One batch of scope edits: the same shape as the scope.save arguments, without the project. */
export type ScopeChangeInput = Omit<ScopeSaveArgs, "projectId">;

const keyOf = (r: { id?: string; clientKey?: string }): string => r.id ?? r.clientKey ?? "";

/** Last edit wins per row key; a removal cancels the pending upserts of that key (and of a removed feature's stories). */
export function mergeScopeChange(pending: ScopeChangeInput | null, next: ScopeChangeInput): ScopeChangeInput {
  const features = new Map<string, FeatureInput>();
  const stories = new Map<string, StoryInput>();
  const removeFeatures = new Set<string>();
  const removeStories = new Set<string>();
  const take = (c: ScopeChangeInput) => {
    for (const f of c.upsertFeatures ?? []) {
      features.set(keyOf(f), f);
      removeFeatures.delete(keyOf(f));
    }
    for (const s of c.upsertStories ?? []) {
      stories.set(keyOf(s), s);
      removeStories.delete(keyOf(s));
    }
    for (const id of c.removeStoryIds ?? []) {
      const was = stories.get(id);
      stories.delete(id);
      // A row that was never saved (clientKey only) has nothing to remove on the server.
      if (!was || was.id) removeStories.add(id);
    }
    for (const id of c.removeFeatureIds ?? []) {
      const was = features.get(id);
      features.delete(id);
      for (const [k, s] of stories) if (s.featureId === id) stories.delete(k);
      if (!was || was.id) removeFeatures.add(id);
    }
  };
  if (pending) take(pending);
  take(next);
  const out: ScopeChangeInput = {};
  if (features.size) out.upsertFeatures = [...features.values()];
  if (removeFeatures.size) out.removeFeatureIds = [...removeFeatures];
  if (stories.size) out.upsertStories = [...stories.values()];
  if (removeStories.size) out.removeStoryIds = [...removeStories];
  return out;
}

function rowsIn(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null);
  const items = (data as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? rowsIn(items) : [];
}

/** The LastUpdatedDate of a row as the cache last saw it (lists or the item key). */
export function cachedUpdatedAt(client: QueryClient, workspaceId: string, schema: string, id: string): string | undefined {
  for (const [, data] of client.getQueriesData({ queryKey: blocksKeys.schema(workspaceId, schema) })) {
    const hit = rowsIn(data).find((r) => r.ItemId === id) ?? (data && (data as { ItemId?: unknown }).ItemId === id ? (data as Record<string, unknown>) : undefined);
    if (hit && typeof hit.LastUpdatedDate === "string") return hit.LastUpdatedDate;
  }
  return undefined;
}

export interface ScopeAutosave {
  status: AutosaveStatus;
  /** Ids of rows the server refused because someone else changed them. */
  conflicts: ReadonlySet<string>;
  queue(change: ScopeChangeInput): void;
  flush(): Promise<void>;
  retry(): Promise<void>;
  /** Refetch the row and drop the local edits of it (all conflicts when no id is given). */
  reload(id?: string): Promise<void>;
  /** The server id a scope.save answer gave for a clientKey; undefined until then. */
  idFor(clientKey: string): string | undefined;
}

const IDLE: AutosaveStatus = { state: "idle", savedAt: null, error: null };

export interface Timers {
  now(): Date;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

export const realTimers: Timers = {
  now: () => new Date(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface ScopeCoreDeps extends Timers {
  projectId: string;
  workspaceId: string;
  client: QueryClient;
  mutate(args: ScopeSaveArgs): Promise<ScopeSaveAnswer>;
  onStatus(s: AutosaveStatus): void;
  onConflicts(ids: ReadonlySet<string>): void;
}

/** The scope autosave without React: the hook below only holds its status and conflicts in state. */
export function createScopeAutosave(deps: ScopeCoreDeps) {
  const { projectId, workspaceId, client } = deps;
  const seen = new Map<string, string>();
  const ids = new Map<string, string>();
  const dropped = new Set<string>();
  let conflicts = new Set<string>();

  const live = (r: { id?: string; clientKey?: string }): boolean => !dropped.has(keyOf(r));
  const resolve = <R extends { id?: string; clientKey?: string; expectedUpdatedAt?: string }>(r: R, schema: string): R => {
    const id = r.id ?? (r.clientKey ? ids.get(r.clientKey) : undefined);
    if (!id) return r;
    const { clientKey: _clientKey, ...rest } = r;
    const expectedUpdatedAt = r.expectedUpdatedAt ?? cachedUpdatedAt(client, workspaceId, schema, id) ?? seen.get(id);
    return { ...rest, id, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) } as R;
  };
  const toId = (v: string) => ids.get(v) ?? v;

  function prepare(change: ScopeChangeInput): ScopeSaveArgs | null {
    const upsertFeatures = (change.upsertFeatures ?? []).filter(live).map((f) => resolve(f, SCOPE_SCHEMAS.feature));
    const upsertStories = (change.upsertStories ?? [])
      .filter(live)
      .map((s) => resolve({ ...s, featureId: toId(s.featureId) }, SCOPE_SCHEMAS.story));
    const removeFeatureIds = (change.removeFeatureIds ?? []).map(toId).filter((id) => !dropped.has(id));
    const removeStoryIds = (change.removeStoryIds ?? []).map(toId).filter((id) => !dropped.has(id));
    if (!upsertFeatures.length && !upsertStories.length && !removeFeatureIds.length && !removeStoryIds.length) return null;
    const args: ScopeSaveArgs = { projectId };
    if (upsertFeatures.length) args.upsertFeatures = upsertFeatures;
    if (removeFeatureIds.length) args.removeFeatureIds = removeFeatureIds;
    if (upsertStories.length) args.upsertStories = upsertStories;
    if (removeStoryIds.length) args.removeStoryIds = removeStoryIds;
    return args;
  }

  const saver = createAutosaver<ScopeChangeInput>({
    now: deps.now,
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
    merge: mergeScopeChange,
    onStatus: deps.onStatus,
    async save(change) {
      const args = prepare(change);
      if (!args) return;
      let answer: ScopeSaveAnswer;
      try {
        answer = await deps.mutate(args);
      } catch (e) {
        throw new Error(failureText(e));
      }
      for (const [k, v] of Object.entries(answer.idsByClientKey ?? {})) ids.set(k, v);
      for (const r of [...(answer.features ?? []), ...(answer.stories ?? [])]) {
        if (typeof r.ItemId === "string" && typeof r.LastUpdatedDate === "string") seen.set(r.ItemId, r.LastUpdatedDate);
      }
      if (answer.conflicts?.length) {
        conflicts = new Set([...conflicts, ...answer.conflicts.map((c) => c.id)]);
        deps.onConflicts(conflicts);
      }
    },
  });

  return {
    queue(change: ScopeChangeInput) {
      for (const r of [...(change.upsertFeatures ?? []), ...(change.upsertStories ?? [])]) dropped.delete(keyOf(r));
      saver.push(change);
    },
    flush: saver.flush,
    dispose: saver.dispose,
    idFor: (clientKey: string): string | undefined => ids.get(clientKey),
    async reload(id?: string) {
      for (const t of id ? [id] : [...conflicts]) {
        dropped.add(t);
        seen.delete(t);
      }
      if (id) conflicts.delete(id);
      else conflicts.clear();
      conflicts = new Set(conflicts);
      deps.onConflicts(conflicts);
      await Promise.all(
        [SCOPE_SCHEMAS.feature, SCOPE_SCHEMAS.story].map((s) => client.refetchQueries({ queryKey: blocksKeys.schema(workspaceId, s) })),
      );
    },
  };
}

/** Flush when the tab hides, on pagehide and on unmount. */
function useFlushTriggers(flush: () => Promise<void>, dispose: () => void): void {
  useEffect(() => {
    const hide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const page = () => void flush();
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", page);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", page);
      void flush();
      dispose();
    };
  }, [flush, dispose]);
}

export function useScopeAutosave(ctx: Pick<ScopeContext, "projectId" | "workspaceId">, _version?: unknown): ScopeAutosave {
  const mutation = useScopeSave(ctx);
  const mutateRef = useRef(mutation.mutateAsync);
  mutateRef.current = mutation.mutateAsync;
  const [status, setStatus] = useState<AutosaveStatus>(IDLE);
  const [conflicts, setConflicts] = useState<ReadonlySet<string>>(new Set());
  const { projectId } = ctx;
  const workspaceId = ctx.workspaceId ?? "";
  const core = useMemo(
    () =>
      createScopeAutosave({
        ...realTimers,
        projectId,
        workspaceId,
        client: queryClient,
        mutate: async (args) => (await mutateRef.current(args)).data,
        onStatus: setStatus,
        onConflicts: setConflicts,
      }),
    [projectId, workspaceId],
  );
  useFlushTriggers(core.flush, core.dispose);
  return { status, conflicts, queue: core.queue, flush: core.flush, retry: core.flush, reload: core.reload, idFor: core.idFor };
}

// ---------------------------------------------------------------- milestones

export interface StoredMilestone {
  id: string;
  updatedAt?: string | null;
}

export interface MilestonesAutosave {
  status: AutosaveStatus;
  /** Someone else changed the arrangement: nothing more is sent until reload(). */
  stale: boolean;
  queue(plan: PlanMilestone[]): void;
  flush(): Promise<void>;
  retry(): Promise<void>;
  reload(): Promise<void>;
}

/** The first reason that stops a save, as one sentence; null when the plan is fine. */
function planIssue(plan: PlanMilestone[], included: readonly string[]): string | null {
  const first = validateMilestonePlan(plan, included, "save")[0];
  return first ? milestoneIssueText(first) : null;
}

function toPlanInput(m: PlanMilestone, fallbackKey: () => string): PlanInput {
  const out: PlanInput = { name: m.name, goal: m.goal, featureRefs: [...m.featureRefs] };
  if (m.id) out.id = m.id;
  else out.clientKey = m.clientKey ?? fallbackKey();
  return out;
}

export interface MilestonesCoreDeps extends Timers {
  projectId: string;
  workspaceId: string;
  scopeVersionId: string | undefined;
  client: QueryClient;
  mutate(args: MilestonesSaveArgs): Promise<MilestonesSaveAnswer>;
  onStatus(s: AutosaveStatus): void;
  onStale(stale: boolean): void;
  newKey?: () => string;
}

/** The arrangement autosave without React. `included` are the draft's included feature refs (server checks the rest). */
export function createMilestonesAutosave(deps: MilestonesCoreDeps, initial: readonly StoredMilestone[], included?: () => readonly string[] | undefined) {
  const toExpected = (list: readonly StoredMilestone[]) => list.map((m) => ({ id: m.id, updatedAt: m.updatedAt ?? "" }));
  let expected = toExpected(initial);
  let dirty = false;
  let stale = false;
  const generated = new Map<string, string>();
  const newKey = deps.newKey ?? (() => crypto.randomUUID());

  const saver = createAutosaver<PlanMilestone[]>({
    now: deps.now,
    setTimer: deps.setTimer,
    clearTimer: deps.clearTimer,
    merge: (_pending, next) => next,
    onStatus: deps.onStatus,
    async save(plan) {
      if (stale) throw new Error(staleRowText());
      if (!deps.scopeVersionId) throw new Error("the scope isn't loaded yet");
      const refs = included?.() ?? [...new Set(plan.flatMap((m) => m.featureRefs))];
      const issue = planIssue(plan, refs);
      if (issue) throw new Error(issue);
      const input = plan.map((m, i) =>
        toPlanInput(m, () => {
          const k = `${m.name}#${i}`;
          if (!generated.has(k)) generated.set(k, newKey());
          return generated.get(k) as string;
        }),
      );
      let answer: MilestonesSaveAnswer;
      try {
        answer = await deps.mutate({ projectId: deps.projectId, scopeVersionId: deps.scopeVersionId, plan: input, expected });
      } catch (e) {
        if (e instanceof FunctionError && e.code === "conflict" && e.messageKey === "milestones.stale") {
          stale = true;
          deps.onStale(true);
          throw new Error(staleRowText());
        }
        throw new Error(failureText(e));
      }
      expected = toExpected(
        (answer.milestones ?? []).map((r) => ({ id: String(r.ItemId), updatedAt: typeof r.LastUpdatedDate === "string" ? r.LastUpdatedDate : "" })),
      );
      dirty = false;
    },
  });

  return {
    queue(plan: PlanMilestone[]) {
      if (stale) return;
      dirty = true;
      saver.push(plan);
    },
    flush: saver.flush,
    dispose: saver.dispose,
    /** Follow the stored rows (a refetch) unless there are local changes or the arrangement is stale. */
    sync(stored: readonly StoredMilestone[]) {
      if (!dirty && !stale) expected = toExpected(stored);
    },
    expected: () => expected,
    async reload() {
      saver.discard();
      dirty = false;
      stale = false;
      generated.clear();
      deps.onStale(false);
      deps.onStatus(IDLE);
      await deps.client.refetchQueries({ queryKey: blocksKeys.schema(deps.workspaceId, SCOPE_SCHEMAS.milestone) });
    },
  };
}

/**
 * Autosave of the whole arrangement (one unit). `includedFeatureRefs` are the draft's included features; without it
 * only the structure is checked here and the server checks the rest.
 */
export function useMilestonesAutosave(
  ctx: Pick<ScopeContext, "projectId" | "workspaceId">,
  version: { id: string } | null | undefined,
  stored: readonly StoredMilestone[],
  includedFeatureRefs?: readonly string[],
): MilestonesAutosave {
  const mutation = useMilestonesSave(ctx);
  const mutateRef = useRef(mutation.mutateAsync);
  mutateRef.current = mutation.mutateAsync;
  const [status, setStatus] = useState<AutosaveStatus>(IDLE);
  const [stale, setStale] = useState(false);
  const included = useRef(includedFeatureRefs);
  included.current = includedFeatureRefs;
  const storedRef = useRef(stored);
  storedRef.current = stored;
  const { projectId } = ctx;
  const workspaceId = ctx.workspaceId ?? "";
  const versionId = version?.id;
  const core = useMemo(
    () =>
      createMilestonesAutosave(
        {
          ...realTimers,
          projectId,
          workspaceId,
          scopeVersionId: versionId,
          client: queryClient,
          mutate: async (args) => (await mutateRef.current(args)).data,
          onStatus: setStatus,
          onStale: setStale,
        },
        storedRef.current,
        () => included.current,
      ),
    [projectId, workspaceId, versionId],
  );
  core.sync(stored);
  useFlushTriggers(core.flush, core.dispose);
  return { status, stale, queue: core.queue, flush: core.flush, retry: core.flush, reload: core.reload };
}
