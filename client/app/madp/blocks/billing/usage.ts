// How the usage figures stay live: tokens, credit used and left, agents working. Every surface of a workspace (the top
// bar's credit pill and its panel, the account menu line, Settings → Plan and usage, the usage pill in the Build header
// and on the 3D office, "This build") reads ONE query, billing.summary, under one key, plus the build in focus under a
// key below it; the platform's usage, overview and credit pages read the billing reports at the same pace.
//
//   - pace (the "usage" freshness tier): every 10 s while an engine job of the workspace runs, every 60 s when none
//     runs, nothing while the tab is hidden. A lane's usage is written when the lane ends (server/local/engine/usage.ts),
//     so 10 s shows it within one tick; the billing function keeps an answer at most 5 s (functions/billing/ops/readCache.ts).
//   - a job that starts or ends (any status change, or a new job in a job list already on screen) reads the usage at
//     once, without waiting for the pace: the job lists' cache events call jobsChanged → invalidateUsage.
//   - every sum is made on the server over every credit entry of its scope (all pages), never over one page here.
import type { QueryClient } from "@tanstack/react-query";
import { FRESHNESS_MS } from "../data/freshness";
import { isEngineJobStatus } from "@/madp/domain/engineJob";

export const USAGE_BUSY_MS = FRESHNESS_MS.usage.busy;
export const USAGE_IDLE_MS = FRESHNESS_MS.usage.idle;

/** The pace of a usage read: fast while an engine job runs, slow otherwise. */
export const usagePace = (busy: boolean): number => (busy ? USAGE_BUSY_MS : USAGE_IDLE_MS);

/** Half the fast pace: a surface mounted again within it shows the cached figures without a read. */
export const USAGE_STALE_MS = USAGE_BUSY_MS / 2;

export const usageKeys = {
  /** The workspace's summary; every usage read of the workspace sits under this key, so one invalidation reads them all. */
  summary: (workspaceId: string) => ["ws", workspaceId, "billing", "summary"] as const,
  /** What one job has cost so far (the build in focus). */
  job: (workspaceId: string, jobId: string) => ["ws", workspaceId, "billing", "summary", "job", jobId] as const,
};

/** Reads every usage figure of the workspace again now (an answer already on its way is used, not asked twice). */
export function invalidateUsage(client: Pick<QueryClient, "invalidateQueries">, workspaceId: string): Promise<void> {
  return client.invalidateQueries({ queryKey: usageKeys.summary(workspaceId) }, { cancelRefetch: false });
}

/** A job list row as far as its state goes. */
export interface JobStateRow {
  ItemId?: unknown;
  Status?: unknown;
}

/** The most job lists one tracker remembers (the oldest is forgotten first; a forgotten list starts over calmly). */
export const MAX_TRACKED_LISTS = 200;

export interface JobStateTracker {
  /** True when this list, read before, now shows a job whose status changed or a job it did not hold (a job that
   *  started, or one that came and went between two reads). The first read of a list only records it. */
  changed(listKey: string, rows: readonly JobStateRow[]): boolean;
}

export function createJobStateTracker(max = MAX_TRACKED_LISTS): JobStateTracker {
  const lists = new Map<string, Map<string, string>>();
  return {
    changed(listKey, rows) {
      const before = lists.get(listKey);
      const now = new Map<string, string>();
      let changed = false;
      for (const r of rows) {
        if (typeof r?.ItemId !== "string" || !r.ItemId || !isEngineJobStatus(r.Status)) continue;
        now.set(r.ItemId, r.Status);
        if (before && before.get(r.ItemId) !== r.Status) changed = true;
      }
      lists.delete(listKey);
      lists.set(listKey, now);
      while (lists.size > max) {
        const oldest = lists.keys().next().value;
        if (oldest === undefined) break;
        lists.delete(oldest);
      }
      return changed;
    },
  };
}
