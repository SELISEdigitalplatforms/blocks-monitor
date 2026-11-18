/** The setup details of a project (its own small read, so the shared Project readers stay as they are) and the save
 *  through project.setup.save. The save puts the answered project row and the refreshed "Project brief" note into
 *  the caches, so every screen shows the new values at once. */
import { useQuery } from "@tanstack/react-query";
import { blocksListOptions } from "@/madp/blocks/data/hooks";
import { whereOf, type FieldOf } from "@/madp/blocks/data/gql";
import { useProjectsContext } from "@/madp/blocks/projects/context";
import { callProjectOp, putRows } from "@/madp/blocks/projects/mutations";
import { cacheRow } from "@/madp/blocks/projects/docMutations";
import { SCHEMA, type RawRow } from "@/madp/blocks/projects/records";
import {
  EMPTY_DETAILS, SETUP_FIELDS, detailsFromRow, type ConstraintItem, type MustHave, type SetupDetails,
} from "@/madp/domain/setupDetails";

const rows = whereOf<RawRow>();
const FIELDS = ["ItemId", "WorkspaceId", ...SETUP_FIELDS] as const;

export interface ProjectSetupDetails {
  details: SetupDetails;
  isLoading: boolean;
  error: unknown;
  /** The stored row was read: `details` are the project's own (not the empty defaults shown while loading or after a
   *  failed read). A save that adds to the lists must wait for this, or project.setup.save would replace them. */
  loaded: boolean;
}

/** The project's document findings and existing setup details, shared with the business agent review. */
export function useSetupDetails(projectId: string): ProjectSetupDetails {
  const { workspaceId } = useProjectsContext();
  const q = useQuery(blocksListOptions<RawRow>(SCHEMA.project, {
    workspaceId,
    where: rows.eq("ItemId", projectId),
    fields: FIELDS as unknown as readonly FieldOf<RawRow>[],
    page: 1,
    pageSize: 1,
  }));
  const row = q.data?.items[0] ?? null;
  return {
    details: row ? detailsFromRow(row) : EMPTY_DETAILS,
    isLoading: q.isLoading,
    error: q.error ?? null,
    loaded: row !== null,
  };
}

/** What project.setup.save takes: each sent key replaces that detail. */
export interface SetupSaveInput {
  projectId: string;
  mustHaves?: MustHave[];
  workflows?: string[];
  exclusions?: string[];
  constraints?: ConstraintItem[];
  intendedChanges?: string;
  changeTags?: string[];
}

export async function saveSetup(ws: string, args: SetupSaveInput, opts?: { requestId?: string }): Promise<{ project: RawRow; note?: RawRow }> {
  const data = await callProjectOp<{ project: RawRow; note?: RawRow }>("project.setup.save", { ...args }, opts);
  putRows(ws, SCHEMA.project, [data.project]);
  if (data.note) cacheRow(ws, args.projectId, SCHEMA.note, data.note);
  return data;
}
