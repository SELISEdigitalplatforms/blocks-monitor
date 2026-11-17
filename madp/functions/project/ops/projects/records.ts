/**
 * The ONE server-side mapper between this lane's logical names and the S1 schemas
 * (blocks/data/schemas/*.json). The docs area imports it.
 */
import type { JourneyStep } from "../../../../src/domain/journey";
import { PROJECT_STATUSES, effectiveStep, type ProjectStatus } from "../../../../src/domain/projects";
import type { DocKind, FileLite, FolderLite, NoteLite } from "../../../../src/domain/docs";
import type { Row } from "./ports";

export const SCHEMA = {
  project: "Project",
  assignment: "ProjectAssignment",
  share: "Share",
  folder: "DocFolder",
  note: "DocNote",
  file: "DocFile",
  scopeVersion: "ScopeVersion",
  designScreen: "DesignScreen",
} as const;

/** The S1 field names, per logical record. */
export const F = {
  project: {
    name: "Name",
    clientName: "ClientName",
    clientContact: "ClientContact",
    clientIndustry: "ClientIndustry",
    clientRegion: "ClientRegion",
    stage: "Stage",
    resumeTo: "ResumeTo",
    assigneeUserId: "AssigneeUserId",
    handedOverAt: "BusinessHandedOverAt",
    handedOverByUserId: "BusinessHandedOverByUserId",
    status: "Status",
    // The project type lives in repoMode: "new" = greenfield, "existing" = brownfield (src/domain/projectType.ts).
    repoMode: "RepoMode",
    repoProvider: "RepoProvider",
    repoOwner: "RepoOwner",
    repoName: "RepoName",
    repoBranch: "RepoBranch",
    repoVisibility: "RepoVisibility",
    /** String: "owner/name" when the project starts in an existing repository, "" for the one MADP creates. */
    repoExisting: "RepoExisting",
    // The guided project start (project.create).
    goal: "Goal",
    targetUsers: "TargetUsers",
    appUrl: "AppUrl",
    /** The client's official website (optional http(s) address). */
    websiteUrl: "WebsiteUrl",
    /** The Landing page add-on (JSON, src/domain/landingPage.ts). */
    landingPageAddOn: "LandingPageAddOn",
    /** The add-on's Goals & requirements section (JSON, src/domain/landingPage.ts). */
    landingPageSection: "LandingPageSection",
    /** JSON string {"available":"yes"|"no"|"unsure","url"?,"accessHow"?}. */
    testEnv: "TestEnv",
    runInstructions: "RunInstructions",
    blocksProjectRef: "BlocksProjectRef",
    /** JSON object string: the guided start's raw answers. */
    setupAnswers: "SetupAnswers",
    /** "draft" | "complete". */
    setupStatus: "SetupStatus",
  },
  assignment: { projectId: "ProjectId", assigneeUserId: "AssigneeUserId", assignedByUserId: "AssignedByUserId", at: "At" },
  share: { projectId: "ProjectId", itemType: "ItemType", itemRef: "ItemRef", sharedByUserId: "SharedByUserId", sharedWithUserId: "SharedWithUserId" },
  folder: { projectId: "ProjectId", parentId: "ParentId", name: "Name", kind: "Kind", sortOrder: "SortOrder", status: "Status" },
  note: { projectId: "ProjectId", folderId: "FolderId", title: "Title", bodyMd: "BodyMd", sortOrder: "SortOrder", isScratch: "IsScratchPad", isProjectBrief: "IsProjectBrief" },
  file: {
    projectId: "ProjectId",
    folderId: "FolderId",
    name: "Name",
    storedName: "StoredName",
    mime: "Mime",
    sizeBytes: "SizeBytes",
    storageFileId: "StorageObjectId",
    status: "Status",
    sortOrder: "SortOrder",
  },
} as const;

/** Fields this lane writes that S1 lacks. Empty since LX added Project.Status, Project.BusinessHandedOverByUserId and DocFolder.Status. */
export const SCHEMA_GAP_FIELDS: Record<string, string[]> = {};

export function rowStr(row: Row, field: string): string {
  const v = row[field];
  return typeof v === "string" ? v : "";
}

export function rowInt(row: Row, field: string): number {
  const v = row[field];
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0;
}

export interface ProjectRec {
  id: string;
  workspaceId: string;
  name: string;
  stage: string;
  /** The journey step: a paused project stands where it resumes. */
  step: JourneyStep;
  /** A missing Status counts as "active". */
  status: ProjectStatus;
  assigneeUserId: string;
  handedOverAt: string | null;
  handedOverByUserId: string;
  repoMode: string;
  repoOwner: string;
  repoName: string;
  repoBranch: string;
  lastUpdatedDate: string;
}

export function projectRec(row: Row): ProjectRec {
  const stage = rowStr(row, F.project.stage);
  const status = rowStr(row, F.project.status);
  return {
    id: row.ItemId,
    workspaceId: rowStr(row, "WorkspaceId"),
    name: rowStr(row, F.project.name),
    stage,
    step: effectiveStep(stage, rowStr(row, F.project.resumeTo)),
    status: (PROJECT_STATUSES as readonly string[]).includes(status) ? (status as ProjectStatus) : "active",
    assigneeUserId: rowStr(row, F.project.assigneeUserId),
    handedOverAt: rowStr(row, F.project.handedOverAt) || null,
    handedOverByUserId: rowStr(row, F.project.handedOverByUserId),
    repoMode: rowStr(row, F.project.repoMode),
    repoOwner: rowStr(row, F.project.repoOwner),
    repoName: rowStr(row, F.project.repoName),
    repoBranch: rowStr(row, F.project.repoBranch),
    lastUpdatedDate: rowStr(row, "LastUpdatedDate"),
  };
}

export function folderLite(row: Row): FolderLite {
  return {
    id: row.ItemId,
    parentId: rowStr(row, F.folder.parentId),
    name: rowStr(row, F.folder.name),
    kind: rowStr(row, F.folder.kind) as DocKind,
    sortOrder: rowInt(row, F.folder.sortOrder),
    status: rowStr(row, F.folder.status) === "deleting" ? "deleting" : "active",
    createdDate: rowStr(row, "CreatedDate"),
  };
}

export function noteLite(row: Row): NoteLite {
  return {
    id: row.ItemId,
    folderId: rowStr(row, F.note.folderId),
    title: rowStr(row, F.note.title),
    sortOrder: rowInt(row, F.note.sortOrder),
    isScratch: row[F.note.isScratch] === true,
    createdDate: rowStr(row, "CreatedDate"),
  };
}

export function fileLite(row: Row): FileLite {
  return {
    id: row.ItemId,
    folderId: rowStr(row, F.file.folderId),
    name: rowStr(row, F.file.name),
    mime: rowStr(row, F.file.mime),
    sizeBytes: rowInt(row, F.file.sizeBytes),
    status: rowStr(row, F.file.status),
    sortOrder: rowInt(row, F.file.sortOrder),
    createdDate: rowStr(row, "CreatedDate"),
  };
}
