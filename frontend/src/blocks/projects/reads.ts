// Project reads: browser → Data Gateway through the src/blocks/data options only (the workspace clause is always AND-ed).
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { LIST_STALE_MS, blocksAllOptions, blocksItemOptions, useBlocksCount } from "../data/hooks";
import { queryClient } from "../queryClient";
import { liveEvery } from "../data/livePoll";
import { whereOf } from "../data/gql";
import type { BlocksDataError } from "../data/errors";
import { blocksKeys } from "../data/keys";
import { isBlocksProjectId } from "../../domain/projects";
import { useProjectsContext } from "./context";
import { PENDING_DELETE } from "./mutations";
import {
  ASSIGNMENT_FIELDS,
  PROJECT_FIELDS,
  SCHEMA,
  SHARE_FIELDS,
  assignmentFromRow,
  projectFromRow,
  shareFromRow,
  type AssignmentRecord,
  type ProjectRecord,
  type RawRow,
  type ShareRecord,
} from "./records";

const w = whereOf<RawRow>();
export const MAX_PROJECTS = 500;

/** A row being deleted is hidden, unless it is the optimistic copy of a delete in flight (client marker). */
const visible = (r: RawRow): boolean => r.Status !== "deleting" || r[PENDING_DELETE] === true;
const mapProjects = (rows: RawRow[]): ProjectRecord[] => rows.filter(visible).map(projectFromRow);
const mapProject = (row: RawRow | null): ProjectRecord | null => (row ? projectFromRow(row) : null);

/** The query options of the workspace's project list (shared by useProjectList and the single-project read). */
export function projectListOptions(workspaceId: string | null | undefined) {
  return blocksAllOptions<RawRow>(SCHEMA.project, {
    workspaceId,
    fields: PROJECT_FIELDS,
    sort: [{ field: "LastUpdatedDate", dir: "desc" }],
    maxItems: MAX_PROJECTS,
  });
}

/**
 * One project by id. On a full load with no cached item, it waits one macrotask so a list read started in the same commit
 * registers, then takes its row from that list instead of a second read. Otherwise (no list, row missing, refresh) it reads by id.
 */
export function projectItemOptions(workspaceId: string | null | undefined, id: string | null | undefined) {
  const base = blocksItemOptions<RawRow>(SCHEMA.project, id, { workspaceId, fields: PROJECT_FIELDS });
  return {
    ...base,
    enabled: base.enabled && isBlocksProjectId(id ?? ""),
    queryFn: async (): Promise<RawRow | null> => {
      if (queryClient.getQueryData(base.queryKey) === undefined) {
        await new Promise((r) => setTimeout(r, 0));
        const listOptions = projectListOptions(workspaceId);
        const list = queryClient.getQueryCache().find({ queryKey: listOptions.queryKey, exact: true });
        const fresh = list?.state.data !== undefined && Date.now() - list.state.dataUpdatedAt < LIST_STALE_MS;
        if (list && (list.state.fetchStatus === "fetching" || fresh)) {
          try {
            const rows = await queryClient.fetchQuery({ ...listOptions, staleTime: LIST_STALE_MS });
            const row = rows.find((r) => r.ItemId === id);
            if (row) return row;
          } catch {
            // The list failed: fall back to the single-id read.
          }
        }
      }
      return base.queryFn();
    },
  };
}

/** Every Project of the workspace that is not being deleted (a pending local delete stays visible as "deleting"), the most recently updated first. */
export function useProjectList(): UseQueryResult<ProjectRecord[], BlocksDataError> {
  const { workspaceId } = useProjectsContext();
  return useQuery({ ...projectListOptions(workspaceId), select: mapProjects });
}

/** Whether the workspace has more projects than useProjectList reads (it keeps the newest MAX_PROJECTS). */
export function useProjectListCap(): { capped: boolean; totalCount: number; limit: number } {
  const { workspaceId } = useProjectsContext();
  const count = useBlocksCount<RawRow>(SCHEMA.project, { workspaceId });
  return { capped: (count.data ?? 0) > MAX_PROJECTS, totalCount: count.data ?? 0, limit: MAX_PROJECTS };
}

/** How often a project whose Blocks project is being set up is read again. */
export const PROVISIONING_POLL_MS = 5_000;

/** One project by id; disabled for local ids ("p-…"). */
export function useProject(id: string | null | undefined): UseQueryResult<ProjectRecord | null, BlocksDataError> {
  const { workspaceId } = useProjectsContext();
  const options = projectItemOptions(workspaceId, id);
  // while its Blocks project is being set up, read again every 5 s on the live clock (one read for every place that
  // shows the project: the route, the navigation and the step); the row is the cached one, so this follows each read
  const raw = queryClient.getQueryData(options.queryKey) as RawRow | null | undefined;
  const settingUp = raw?.BlocksProvisioningStatus === "pending" || raw?.BlocksProvisioningStatus === "creating";
  return useQuery({ ...options, select: mapProject, meta: liveEvery(settingUp ? PROVISIONING_POLL_MS : false) });
}

export interface RouteProject {
  id: string;
  isBlocks: boolean;
  project: ProjectRecord | null;
  isLoading: boolean;
  error: BlocksDataError | null;
  refetch: () => void;
}

/** The project of the current /p/:id route. */
export function useRouteProject(): RouteProject {
  const id = useParams().id ?? "";
  const isBlocks = isBlocksProjectId(id);
  const q = useProject(isBlocks ? id : null);
  return {
    id,
    isBlocks,
    project: isBlocks ? (q.data ?? null) : null,
    isLoading: isBlocks && q.isLoading,
    error: isBlocks ? q.error : null,
    refetch: () => void q.refetch(),
  };
}

export interface AssignedItem {
  project: ProjectRecord;
  latest: AssignmentRecord | null;
}

/** Projects assigned to me, with the latest assignment of each (2 sequential reads). */
export function useAssignedToMe(): UseQueryResult<AssignedItem[], BlocksDataError> {
  const { workspaceId, userId } = useProjectsContext();
  const projects = blocksAllOptions<RawRow>(SCHEMA.project, {
    workspaceId,
    fields: PROJECT_FIELDS,
    where: w.eq("AssigneeUserId", userId ?? ""),
    sort: [{ field: "LastUpdatedDate", dir: "desc" }],
    maxItems: MAX_PROJECTS,
  });
  const ws = workspaceId ?? "";
  return useQuery({
    queryKey: blocksKeys.list(ws, SCHEMA.project, { mode: "assignedToMe", userId }),
    enabled: projects.enabled && Boolean(userId),
    queryFn: async (): Promise<AssignedItem[]> => {
      const rows = (await projects.queryFn()).filter(visible);
      if (rows.length === 0) return [];
      const ids = rows.map((r) => String(r.ItemId));
      const assignments = await blocksAllOptions<RawRow>(SCHEMA.assignment, {
        workspaceId,
        fields: ASSIGNMENT_FIELDS,
        where: w.in("ProjectId", ids),
        sort: [{ field: "At", dir: "desc" }],
        maxItems: MAX_PROJECTS,
      }).queryFn();
      const latest = new Map<string, AssignmentRecord>();
      for (const a of assignments.map(assignmentFromRow)) if (!latest.has(a.projectId)) latest.set(a.projectId, a);
      return rows.map((r) => ({ project: projectFromRow(r), latest: latest.get(String(r.ItemId)) ?? null }));
    },
  });
}

export interface SharedItem {
  share: ShareRecord;
  project: ProjectRecord | null;
}

/** Shares addressed to me, with their projects (2 sequential reads). */
export function useSharedWithMe(): UseQueryResult<SharedItem[], BlocksDataError> {
  const { workspaceId, userId } = useProjectsContext();
  const shares = blocksAllOptions<RawRow>(SCHEMA.share, {
    workspaceId,
    fields: SHARE_FIELDS,
    where: w.eq("SharedWithUserId", userId ?? ""),
    sort: [{ field: "CreatedDate", dir: "desc" }],
    maxItems: MAX_PROJECTS,
  });
  const ws = workspaceId ?? "";
  return useQuery({
    queryKey: blocksKeys.list(ws, SCHEMA.share, { mode: "sharedWithMe", userId }),
    enabled: shares.enabled && Boolean(userId),
    queryFn: async (): Promise<SharedItem[]> => {
      const rows = (await shares.queryFn()).map(shareFromRow);
      if (rows.length === 0) return [];
      const ids = [...new Set(rows.map((s) => s.projectId))];
      const projects = await blocksAllOptions<RawRow>(SCHEMA.project, {
        workspaceId,
        fields: PROJECT_FIELDS,
        where: w.in("ItemId", ids),
        maxItems: MAX_PROJECTS,
      }).queryFn();
      const byId = new Map(projects.filter(visible).map((p) => [String(p.ItemId), projectFromRow(p)]));
      const deleting = new Set(projects.filter((p) => !visible(p)).map((p) => String(p.ItemId)));
      return rows.filter((share) => !deleting.has(share.projectId)).map((share) => ({ share, project: byId.get(share.projectId) ?? null }));
    },
  });
}

export interface ProjectAssignee {
  assigneeUserId: string;
  history: AssignmentRecord[];
  isLoading: boolean;
  error: BlocksDataError | null;
}

/** The current assignee (Project.AssigneeUserId) and the latest three assignments. */
export function useProjectAssignee(projectId: string): ProjectAssignee {
  const { workspaceId } = useProjectsContext();
  const enabled = isBlocksProjectId(projectId);
  const project = useProject(enabled ? projectId : null);
  const base = blocksAllOptions<RawRow>(SCHEMA.assignment, {
    workspaceId,
    fields: ASSIGNMENT_FIELDS,
    where: w.eq("ProjectId", projectId),
    sort: [{ field: "At", dir: "desc" }],
    maxItems: 50,
  });
  const history = useQuery({
    ...base,
    enabled: base.enabled && enabled,
    select: (rows: RawRow[]) => rows.map(assignmentFromRow).slice(0, 3),
  });
  return {
    assigneeUserId: project.data?.assigneeUserId ?? "",
    history: history.data ?? [],
    isLoading: project.isLoading || history.isLoading,
    error: (project.error ?? history.error ?? null) as BlocksDataError | null,
  };
}

/** Who a given item of a project is shared with, the newest share first. */
export function useProjectShares(projectId: string, itemType: string, itemRef: string): UseQueryResult<ShareRecord[], BlocksDataError> {
  const { workspaceId } = useProjectsContext();
  const base = blocksAllOptions<RawRow>(SCHEMA.share, {
    workspaceId,
    fields: SHARE_FIELDS,
    where: w.and(w.eq("ProjectId", projectId), w.eq("ItemType", itemType), w.eq("ItemRef", itemRef)),
    sort: [{ field: "CreatedDate", dir: "desc" }],
    maxItems: 200,
  });
  return useQuery({
    ...base,
    enabled: base.enabled && isBlocksProjectId(projectId),
    select: (rows: RawRow[]) => rows.map(shareFromRow),
  });
}
