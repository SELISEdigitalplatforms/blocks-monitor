/** useLiveDoc: where the documentation of a live product stands (LiveDocFacts, ./liveDoc.ts), and the action that
 *  starts it. Read only for an existing product attached as it is live, past the analysis (null for every other
 *  project, and every query stays off). The reads: the snapshot on the project (Project.LiveProductJson, read on its
 *  own so a Data Gateway without the field never breaks the page), the project's job list (product.document), the
 *  right to start it (business.edit, the op's own permission) and one released Release row (the op's own "is it
 *  live" rule, documentRefusal). */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCan } from "@/madp/blocks/projects/context";
import { useProjectsContext } from "@/madp/blocks/projects/context";
import { useProject } from "@/madp/blocks/projects/reads";
import { messageFor } from "@/madp/blocks/projects/messages";
import { useDocumentExisting } from "@/madp/blocks/projects/liveProduct";
import { useEngineJobs } from "@/madp/blocks/engine/jobs";
import { blocksListOptions } from "@/madp/blocks/data/hooks";
import { whereOf } from "@/madp/blocks/data/gql";
import { useLiveProductSnapshotRead } from "@/madp/blocks/delivery/environments";
import { DOCUMENT_JOB_KIND, documentRefusal } from "@/madp/domain/liveProduct";
import { livePastAnalysis } from "@/madp/components/analysis/pm/pmModel";
import { attachedLive } from "../model";
import { jobFacts, type DocumentRefusal, type LiveDocFacts } from "./liveDoc";

const DOC_JOBS = [DOCUMENT_JOB_KIND] as const;
type ReleaseRow = { ItemId: string; ProjectId?: string; Status?: string | null };

export interface LiveDoc {
  facts: LiveDocFacts;
  /** Starts (or refreshes) the documentation; the job list shows its progress. */
  start: () => void;
  /** The ask is on its way. */
  starting: boolean;
  /** The last ask failed, in plain words. */
  error: string | null;
}

/** The live product's documentation; null for any project that is not a live product past the analysis. */
export function useLiveDoc(projectId: string): LiveDoc | null {
  const project = useProject(projectId).data ?? null;
  const live = livePastAnalysis(attachedLive(project), project?.step ?? null);
  const { workspaceId } = useProjectsContext();
  const snap = useLiveProductSnapshotRead(projectId, live);
  const jobs = useEngineJobs(live ? projectId : null, DOC_JOBS);
  const canEdit = useCan("business.edit");
  const relBase = blocksListOptions<ReleaseRow>("Release", {
    workspaceId,
    fields: ["ItemId", "Status"],
    where: whereOf<ReleaseRow>().and(whereOf<ReleaseRow>().eq("ProjectId", projectId), whereOf<ReleaseRow>().eq("Status", "released")),
    pageSize: 1,
  });
  const released = useQuery({ ...relBase, enabled: relBase.enabled && live, select: (p: { items: ReleaseRow[] }) => p.items });
  const mutation = useDocumentExisting(projectId);

  const documentedAt = snap.snapshot?.documentedAt ?? null;
  const jobList = jobs.data;
  const releaseRows = released.data;
  const facts = useMemo<LiveDocFacts | null>(() => {
    if (!live || !project) return null;
    const refusal = documentRefusal(
      { Status: project.status, RepoMode: project.type === "brownfield" ? "existing" : "new", Stage: project.stage },
      // an unreadable release list never hides the action: the op answers for itself
      released.isError ? [{ Status: "released" }] : (releaseRows ?? []) as Record<string, unknown>[],
    ) as DocumentRefusal | null;
    return {
      documentedAt,
      ...jobFacts(jobList ?? [], documentedAt),
      canDocument: canEdit,
      refusal,
      leftEmpty: snap.snapshot?.leftEmpty ?? [],
      loading: snap.loading || jobs.isLoading || (released.isLoading && !released.isError),
    };
  }, [live, project, documentedAt, jobList, canEdit, releaseRows, released.isError, released.isLoading, snap.snapshot, snap.loading, jobs.isLoading]);

  if (!facts) return null;
  // the ask is on its way, or answered and the job list not read again yet: already "running"
  const pending = mutation.isPending && !facts.running;
  return {
    facts: pending ? { ...facts, running: { progress: 0, message: null }, stopped: false } : facts,
    start: () => { if (!mutation.isPending) mutation.mutate(); },
    starting: mutation.isPending,
    error: mutation.isError ? messageFor(mutation.error) : null,
  };
}
