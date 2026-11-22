/** What the records know about a project's environments besides the Factory's own releases (src/components/delivery/
 *  liveRelease.ts whereItRuns reads them). For an existing product attached as it is live: the snapshot the engine job
 *  "product.document" stored on the project (Project.LiveProductJson, src/domain/liveProduct.ts: every environment with
 *  its branch, address and version, and the release history with each release's commit, "" when it was not recorded),
 *  and, before it was documented, the branch the Factory builds development from (the project's code branch). */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useProject } from "@/blocks/projects/reads";
import { useProjectsContext } from "@/blocks/projects/context";
import { blocksListOptions } from "@/blocks/data/hooks";
import { whereOf } from "@/blocks/data/gql";
import { parseLiveProductSnapshot, type LiveProductSnapshot } from "@/domain/liveProduct";
import { releaseKey, type EnvironmentFact } from "@/components/delivery/liveRelease";

/** What the Release page knows about a project's environments beyond its release rows. */
export interface LiveFacts {
  facts: EnvironmentFact[];
  /** The releases the job documented from the live product (releaseKey "stage@1.4.0"): not the Factory's releases. */
  documented: ReadonlySet<string>;
  /** Each documented release's commit, by releaseKey (only the recorded ones). */
  commits: ReadonlyMap<string, string>;
  /** When the product was last documented; null when it never was. */
  documentedAt: string | null;
}

/** The facts of one project (pure, for tests). The snapshot names every environment it found; without one, the code
 *  branch of an attached product is development's (the Factory builds and releases development from it). Nothing is
 *  assumed for staging or production. */
export function liveFacts(
  project: { type: string; repoBranch: string } | null | undefined,
  snapshot: LiveProductSnapshot | null,
): LiveFacts {
  const attached = project?.type === "brownfield";
  const facts: EnvironmentFact[] = [];
  if (snapshot) {
    for (const e of snapshot.environments) {
      if (facts.some((f) => f.environment === e.environment)) continue;
      facts.push({ environment: e.environment, url: e.url || null, branch: e.branch || null, version: e.version || null, documentedAt: snapshot.documentedAt });
    }
  }
  const codeBranch = attached ? (project?.repoBranch ?? "").trim() : "";
  const dev = facts.find((f) => f.environment === "dev");
  if (codeBranch && !dev) facts.push({ environment: "dev", url: null, branch: codeBranch, documentedAt: null });
  else if (codeBranch && dev && !dev.branch) dev.branch = codeBranch;
  const documented = new Set<string>();
  const commits = new Map<string, string>();
  for (const r of snapshot?.releases ?? []) {
    if (r.documented) documented.add(releaseKey(r));
    if (r.commit) commits.set(releaseKey(r), r.commit);
  }
  return { facts, documented, commits, documentedAt: snapshot?.documentedAt ?? null };
}

type SnapshotRow = { ItemId: string; LiveProductJson?: string | null };
type SnapshotPage = { items: SnapshotRow[] };
/** One stable selector (structural sharing keeps the parsed snapshot while the row is unchanged). */
const selectSnapshot = (page: SnapshotPage): LiveProductSnapshot | null => parseLiveProductSnapshot(page.items[0]?.LiveProductJson ?? null);

/** The project's live-product snapshot (Project.LiveProductJson), read on its own so that a Data Gateway without the
 *  field yet, or a project without a snapshot, never breaks the project's own read: either is simply "not documented".
 *  Only for an existing product (brownfield); null otherwise and while it loads. */
export function useLiveProductSnapshot(projectId: string | null | undefined, enabled = true): LiveProductSnapshot | null {
  return useLiveProductSnapshotRead(projectId, enabled).snapshot;
}

/** The same read with its state: `loading` only while it is on its way (an unreadable field or row is "not documented",
 *  never loading forever). */
export function useLiveProductSnapshotRead(projectId: string | null | undefined, enabled = true): { snapshot: LiveProductSnapshot | null; loading: boolean } {
  const { workspaceId } = useProjectsContext();
  const base = blocksListOptions<SnapshotRow>("Project", {
    workspaceId, fields: ["ItemId", "LiveProductJson"], where: whereOf<SnapshotRow>().eq("ItemId", projectId ?? ""), pageSize: 1,
  });
  const on = base.enabled && Boolean(projectId) && enabled;
  const q = useQuery({
    ...base,
    enabled: on,
    retry: false,
    select: selectSnapshot,
  });
  return { snapshot: q.data ?? null, loading: on && q.isLoading };
}

export function useLiveFacts(projectId: string): LiveFacts {
  const p = useProject(projectId).data ?? null;
  const type = p?.type ?? "", branch = p?.repoBranch ?? "";
  const snapshot = useLiveProductSnapshot(projectId, type === "brownfield");
  return useMemo(() => liveFacts({ type, repoBranch: branch }, snapshot), [type, branch, snapshot]);
}
