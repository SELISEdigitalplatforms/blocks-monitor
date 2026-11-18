// Read hooks of the requirements & objective step. Reads go from the browser to the Blocks Data Gateway through
// src/blocks/data (always workspace-scoped AND ProjectId-scoped), under the row policy: Read = UserId IN ReaderIds,
// OR super admin, OR mf-service. Every hook is an independent parallel query (no waterfalls). The raw cache holds ROWS,
// so a function answer can be written straight into it; `select` maps rows to records. Writes are never done here:
// every write is a Logic Function operation (see mutations.ts).
import { OPEN_QUESTION_STATUSES } from "@/madp/domain/openQuestions";
import { byNewest } from "@/madp/lib/newest";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { blocksAllOptions } from "../data/hooks";
import { whereOf } from "../data/gql";
import { blocksKeys } from "../data/keys";
import { callFunction } from "../fn";
import type { BlocksDataError } from "../data/errors";
import { REMOVED_STATUS, REQUIREMENT_STATUSES } from "../../domain/requirements";
import { useActiveWorkspaceId } from "./context";
import {
  ATTACHMENT_FIELDS, CLARIFICATION_FIELDS, DESIGN_BRIEF_FIELDS, OBJECTIVE_FIELDS, REQUIREMENT_FIELDS, SCHEMA, SUGGESTION_FIELDS,
  TECH_DECISION_FIELDS, VERSION_META_FIELDS, VERSION_TEXT_FIELDS,
  toClarificationRecord, toDesignBriefRecord, toObjectiveRecord, toRequirementRecord, toSampleRecord, toSuggestionRecord,
  toTechDecisionRecord, toVersionMeta, toVersionRecord,
  type AttachmentRow, type ClarificationRecord, type ClarificationRow, type DesignBriefRecord, type DesignBriefRow, type ItemVersionMeta,
  type ItemVersionRecord, type ItemVersionRow, type ObjectiveRecord, type ObjectiveRow, type RequirementRecord, type RequirementRow,
  type SampleRecord, type SuggestionRecord, type SuggestionRow, type TechDecisionRecord, type TechDecisionRow,
} from "./records";

type Ws = string | null | undefined;
type Pid = string | null | undefined;

/** Disables a query that has no workspace or project (the ProjectId clause is still always in the filter). */
const scoped = <O extends { enabled: boolean }>(o: O, ws: Ws, projectId: Pid): O => ({ ...o, enabled: o.enabled && Boolean(ws && projectId) });

const ACTIVE_REQUIREMENT_STATUSES = REQUIREMENT_STATUSES.filter((s) => s !== REMOVED_STATUS);

/** Active requirements only (draft, confirmed, assumed): dropped rows are never purged, so they are not read and cannot fill the row cap. */
export function requirementsQueryOptions(ws: Ws, projectId: Pid) {
  const w = whereOf<RequirementRow>();
  return scoped(
    blocksAllOptions<RequirementRow>(SCHEMA.requirement, {
      workspaceId: ws, fields: REQUIREMENT_FIELDS, where: w.and(w.eq("ProjectId", projectId ?? ""), w.in("Status", ACTIVE_REQUIREMENT_STATUSES)),
      sort: [{ field: "SortOrder", dir: "asc" }], maxItems: 500,
    }), ws, projectId);
}

export function objectiveQueryOptions(ws: Ws, projectId: Pid) {
  const w = whereOf<ObjectiveRow>();
  return scoped(
    blocksAllOptions<ObjectiveRow>(SCHEMA.objective, { workspaceId: ws, fields: OBJECTIVE_FIELDS, where: w.eq("ProjectId", projectId ?? ""), maxItems: 1 }),
    ws, projectId);
}

export function itemVersionsMetaQueryOptions(ws: Ws, projectId: Pid) {
  const w = whereOf<ItemVersionRow>();
  return scoped(
    blocksAllOptions<ItemVersionRow>(SCHEMA.itemVersion, { workspaceId: ws, fields: VERSION_META_FIELDS, where: w.eq("ProjectId", projectId ?? ""), maxItems: 5000 }),
    ws, projectId);
}

export function itemVersionTextQueryOptions(ws: Ws, projectId: Pid, itemKey: string | null | undefined) {
  const w = whereOf<ItemVersionRow>();
  const o = blocksAllOptions<ItemVersionRow>(SCHEMA.itemVersion, {
    workspaceId: ws, fields: VERSION_TEXT_FIELDS,
    where: w.and(w.eq("ProjectId", projectId ?? ""), w.eq("ItemKey", itemKey ?? "")),
    sort: [{ field: "N", dir: "desc" }], maxItems: 100,
  });
  return { ...o, enabled: o.enabled && Boolean(projectId && itemKey) };
}

export function suggestionsQueryOptions(ws: Ws, projectId: Pid) {
  const w = whereOf<SuggestionRow>();
  return scoped(
    blocksAllOptions<SuggestionRow>(SCHEMA.suggestion, { workspaceId: ws, fields: SUGGESTION_FIELDS, where: w.eq("ProjectId", projectId ?? ""), sort: [{ field: "CreatedDate", dir: "desc" }], maxItems: 500 }),
    ws, projectId);
}

export function clarificationsQueryOptions(ws: Ws, projectId: Pid) {
  const w = whereOf<ClarificationRow>();
  return scoped(
    blocksAllOptions<ClarificationRow>(SCHEMA.clarification, {
      workspaceId: ws, fields: CLARIFICATION_FIELDS,
      where: w.and(w.eq("ProjectId", projectId ?? ""), w.in("Status", [...OPEN_QUESTION_STATUSES])), maxItems: 500,
    }), ws, projectId);
}

export function techDecisionsQueryOptions(ws: Ws, projectId: Pid) {
  const w = whereOf<TechDecisionRow>();
  return scoped(
    blocksAllOptions<TechDecisionRow>(SCHEMA.techDecision, { workspaceId: ws, fields: TECH_DECISION_FIELDS, where: w.eq("ProjectId", projectId ?? ""), maxItems: 500 }),
    ws, projectId);
}

export function designBriefQueryOptions(ws: Ws, projectId: Pid) {
  const w = whereOf<DesignBriefRow>();
  return scoped(
    blocksAllOptions<DesignBriefRow>(SCHEMA.designBrief, { workspaceId: ws, fields: DESIGN_BRIEF_FIELDS, where: w.eq("ProjectId", projectId ?? ""), maxItems: 1 }),
    ws, projectId);
}

export function designSamplesQueryOptions(ws: Ws, projectId: Pid) {
  const w = whereOf<AttachmentRow>();
  return scoped(
    blocksAllOptions<AttachmentRow>(SCHEMA.attachment, {
      workspaceId: ws, fields: ATTACHMENT_FIELDS,
      where: w.and(w.eq("ProjectId", projectId ?? ""), w.eq("OwnerType", "design-brief")), maxItems: 100,
    }), ws, projectId);
}

// ---- selects (pure, exported for tests)

const byN = (a: ItemVersionMeta, b: ItemVersionMeta) => b.n - a.n;

export function selectRequirements(rows: readonly RequirementRow[]): RequirementRecord[] {
  return rows.map(toRequirementRecord).filter((r) => r.active).sort((a, b) => a.sortOrder - b.sortOrder || (a.number ?? 0) - (b.number ?? 0));
}

export interface VersionsMeta { latest: Map<string, number>; byKey: Map<string, ItemVersionMeta[]> }

export function selectVersionsMeta(rows: readonly ItemVersionRow[]): VersionsMeta {
  const byKey = new Map<string, ItemVersionMeta[]>();
  const latest = new Map<string, number>();
  for (const m of rows.map(toVersionMeta)) {
    if (!m.itemKey) continue;
    byKey.set(m.itemKey, [...(byKey.get(m.itemKey) ?? []), m]);
    if (m.n > (latest.get(m.itemKey) ?? 0)) latest.set(m.itemKey, m.n);
  }
  for (const list of byKey.values()) list.sort(byN);
  return { latest, byKey };
}

/** The open suggestions first, each group newest first (the same time by title). */
export function selectSuggestions(rows: readonly SuggestionRow[]): SuggestionRecord[] {
  const rank = (s: SuggestionRecord) => (s.status === "open" ? 0 : 1);
  const byTitle = rows.map(toSuggestionRecord).sort((a, b) => a.title.localeCompare(b.title));
  return byNewest(byTitle, (s) => s.createdAt).sort((a, b) => rank(a) - rank(b));
}

export function selectSamples(rows: readonly AttachmentRow[], order: readonly string[] = []): SampleRecord[] {
  const pos = new Map(order.map((id, i) => [id, i]));
  return rows
    .map(toSampleRecord)
    .filter((s) => s.status !== "deleted")
    .sort((a, b) => {
      const pa = pos.get(a.id);
      const pb = pos.get(b.id);
      if (pa !== undefined && pb !== undefined) return pa - pb;
      if (pa !== undefined) return -1;
      if (pb !== undefined) return 1;
      return (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
    });
}

// ---- hooks

type Q<T> = UseQueryResult<T, BlocksDataError>;

export function useRequirements(projectId: Pid): Q<RequirementRecord[]> {
  return useQuery({ ...requirementsQueryOptions(useActiveWorkspaceId(), projectId), select: selectRequirements });
}

export function useObjective(projectId: Pid): Q<ObjectiveRecord | null> {
  return useQuery({ ...objectiveQueryOptions(useActiveWorkspaceId(), projectId), select: (rows) => (rows[0] ? toObjectiveRecord(rows[0]) : null) });
}

export function useItemVersionsMeta(projectId: Pid): Q<VersionsMeta> {
  return useQuery({ ...itemVersionsMetaQueryOptions(useActiveWorkspaceId(), projectId), select: selectVersionsMeta });
}

/** Lazy: only the history drawer asks for the version texts. */
export function useItemVersionText(projectId: Pid, itemKey: string | null | undefined, enabled: boolean): Q<ItemVersionRecord[]> {
  const o = itemVersionTextQueryOptions(useActiveWorkspaceId(), projectId, itemKey);
  return useQuery({ ...o, enabled: o.enabled && enabled, select: (rows) => rows.map(toVersionRecord).sort(byN) });
}

export function useSuggestions(projectId: Pid): Q<SuggestionRecord[]> {
  return useQuery({ ...suggestionsQueryOptions(useActiveWorkspaceId(), projectId), select: selectSuggestions });
}

/** Read only: answered in Product sanitization. */
export function useOpenClarifications(projectId: Pid): Q<ClarificationRecord[]> {
  return useQuery({ ...clarificationsQueryOptions(useActiveWorkspaceId(), projectId), select: (rows) => rows.map(toClarificationRecord) });
}

/** Read only. */
export function useTechDecisions(projectId: Pid): Q<TechDecisionRecord[]> {
  return useQuery({ ...techDecisionsQueryOptions(useActiveWorkspaceId(), projectId), select: (rows) => rows.map(toTechDecisionRecord) });
}

/** Lane L7 may import this read only. */
export function useDesignBrief(projectId: Pid): Q<DesignBriefRecord | null> {
  return useQuery({ ...designBriefQueryOptions(useActiveWorkspaceId(), projectId), select: (rows) => (rows[0] ? toDesignBriefRecord(rows[0]) : null) });
}

export function useDesignSamples(projectId: Pid, order?: readonly string[]): Q<SampleRecord[]> {
  return useQuery({ ...designSamplesQueryOptions(useActiveWorkspaceId(), projectId), select: (rows) => selectSamples(rows, order) });
}

// ---- short-lived sample URL (a function answer: the browser never holds a storage secret)

export interface SampleUrl { url: string; expiresAt: string }
type Caller = typeof callFunction;

export function sampleUrlQueryOptions(ws: Ws, projectId: Pid, attachmentId: string | null | undefined, call: Caller = callFunction) {
  return {
    queryKey: [...blocksKeys.schema(ws ?? "", SCHEMA.attachment), { kind: "url", id: attachmentId ?? "" }] as const,
    queryFn: async (): Promise<SampleUrl> => (await call<SampleUrl>("project", "sample.url", { projectId: projectId ?? "", attachmentId: attachmentId ?? "" })).data,
    staleTime: 240_000, // stale after 4 minutes; the URL lives longer
    gcTime: 300_000,
    enabled: Boolean(ws && projectId && attachmentId),
  };
}

/** Consumers call refetch() when an image fails to load. */
export function useSampleUrl(projectId: Pid, attachmentId: string | null | undefined): Q<SampleUrl> {
  return useQuery(sampleUrlQueryOptions(useActiveWorkspaceId(), projectId, attachmentId));
}
