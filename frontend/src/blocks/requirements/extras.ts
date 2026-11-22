// Reads of the Goals & requirements extras: key workflows, what is not included and the constraints (RequirementExtra
// rows; rules in src/domain/requirementsExtras.ts). A project without rows shows its setup answers until the first
// edit imports them. Writes are project function ops (mutations in ./extrasMutations.ts).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { blocksAllOptions } from "../data/hooks";
import { whereOf } from "../data/gql";
import { EXTRA_SCHEMA, extraFromRow, groupExtras, setupRecords, type ExtraKind, type ExtraRecord } from "../../domain/requirementsExtras";
import type { SetupDetails } from "../../domain/setupDetails";
import { useActiveWorkspaceId } from "./context";

export const EXTRA_FIELDS = [
  "ItemId", "ProjectId", "Kind", "Title", "Who", "Steps", "ConstraintKind", "SortOrder", "Status", "Origin", "CreatedByUserId",
] as const;

export interface ExtraRow { ItemId: string; [k: string]: unknown }

export function extrasQueryOptions(ws: string | null | undefined, projectId: string | null | undefined) {
  const w = whereOf<ExtraRow>();
  const o = blocksAllOptions<ExtraRow>(EXTRA_SCHEMA, {
    workspaceId: ws, fields: EXTRA_FIELDS, where: w.eq("ProjectId", projectId ?? ""),
    sort: [{ field: "SortOrder", dir: "asc" }], maxItems: 500,
  });
  return { ...o, enabled: o.enabled && Boolean(ws && projectId) };
}

/** Active rows as records (removed ones and unknown kinds left out). */
export function selectExtras(rows: readonly ExtraRow[]): ExtraRecord[] {
  return rows.map((r) => extraFromRow(r)).filter((e): e is ExtraRecord => e !== null);
}

export interface ExtrasView {
  byKind: Record<ExtraKind, ExtraRecord[]>;
  /** True while the lists come from the setup answers (no row written yet). */
  fromSetup: boolean;
  /** True once the project has any row (removed ones too): the setup answers were imported or replaced. */
  hasRows: boolean;
  loading: boolean;
  error: boolean;
  refetch: () => void;
}

/** The three lists of the step. `setup` is the project's setup answers (the fallback before the first edit). */
export function useRequirementsExtras(projectId: string | null | undefined, setup: SetupDetails | null | undefined): ExtrasView {
  const q = useQuery(extrasQueryOptions(useActiveWorkspaceId(), projectId));
  const rows = q.data;
  return useMemo<ExtrasView>(() => {
    const hasRows = (rows?.length ?? 0) > 0;
    const list = hasRows ? selectExtras(rows!) : setup ? setupRecords(setup) : [];
    return {
      byKind: groupExtras(list), fromSetup: !hasRows && list.length > 0, hasRows,
      loading: q.isLoading, error: q.isError, refetch: () => void q.refetch(),
    };
  }, [rows, setup, q.isLoading, q.isError]); // eslint-disable-line react-hooks/exhaustive-deps
}
