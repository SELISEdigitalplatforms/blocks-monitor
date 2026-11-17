// The ONE web-side mapper from S1 rows (Project, ProjectAssignment, Share, Doc*) to typed records.
// Reads and function answers carry the same raw rows, so the same mappers serve both.
import type { JourneyStep } from "../../domain/journey";
import { effectiveStep, type ProjectStatus, type ShareItemType } from "../../domain/projects";
import { projectTypeOf, type ChoosableType } from "../../domain/projectType";
import type { FileLite, FolderLite, NoteLite } from "../../domain/docs";

export const SCHEMA = {
  project: "Project",
  assignment: "ProjectAssignment",
  share: "Share",
  folder: "DocFolder",
  note: "DocNote",
  file: "DocFile",
} as const;

/** Raw rows: S1 field names, every field optional because a read selects only some. */
export type RawRow = Record<string, unknown>;

export interface ProjectRecord {
  id: string;
  workspaceId: string;
  name: string;
  clientName: string;
  clientContact: string;
  clientIndustry: string;
  clientRegion: string;
  stage: string;
  step: JourneyStep;
  status: ProjectStatus;
  assigneeUserId: string;
  handedOverAt: string | null;
  handedOverByUserId: string;
  /** greenfield or brownfield, from RepoMode. */
  type: ChoosableType;
  /** The GitHub repository ("" until it is named): brownfield, the existing product's; greenfield, the new one MADP creates. */
  repoOwner: string;
  repoName: string;
  repoBranch: string;
  /** Greenfield: private or internal ("" until it is chosen). */
  repoVisibility: string;
  /** True when the project works in an existing repository (brownfield, or greenfield into a prepared repo). */
  repoExisting: boolean;
  // The guided project start ("" when not given).
  goal: string;
  targetUsers: string;
  appUrl: string;
  /** The client's official website (http(s)), or "". */
  websiteUrl: string;
  /** JSON string {"available":"yes"|"no"|"unsure","url"?,"accessHow"?}, or "". */
  testEnv: string;
  runInstructions: string;
  blocksProjectRef: string;
  /** Server-owned product tenant provisioning metadata (absent on historical/local rows). */
  blocksProjectDomain?: string;
  blocksProvisioningStatus?: string;
  blocksProvisioningError?: string;
  /** "draft", "complete", or "" (a project created without the guided start). */
  setupStatus: string;
  /** JSON object string of the guided start's answers, or "". */
  setupAnswers: string;
  createdByUserId: string;
  createdDate: string;
  lastUpdatedDate: string;
}

export interface AssignmentRecord {
  id: string;
  projectId: string;
  assigneeUserId: string;
  assignedByUserId: string;
  at: string;
}

export interface ShareRecord {
  id: string;
  projectId: string;
  itemType: ShareItemType;
  itemRef: string;
  sharedByUserId: string;
  sharedWithUserId: string;
  createdDate: string;
}

export interface DocFolderRecord extends FolderLite {
  projectId: string;
  lastUpdatedDate: string;
}

export interface DocNoteRecord extends NoteLite {
  projectId: string;
  /** null = not loaded (tree queries leave the body out). */
  bodyMd: string | null;
  lastUpdatedDate: string;
  updatedByUserId: string;
  /** The "Project brief" note the guided start writes (pinned at the top of the material). */
  isProjectBrief?: boolean;
}

export interface DocFileRecord extends FileLite {
  projectId: string;
  storedName: string;
  createdByUserId: string;
  lastUpdatedDate: string;
}

// Project.Status and Project.BusinessHandedOverByUserId are in S1 and in PROJECT_FIELDS, so reads carry them as well as function answers.
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const timeOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export function projectFromRow(r: RawRow): ProjectRecord {
  const stage = str(r.Stage);
  return {
    id: str(r.ItemId),
    workspaceId: str(r.WorkspaceId),
    name: str(r.Name),
    clientName: str(r.ClientName),
    clientContact: str(r.ClientContact),
    clientIndustry: str(r.ClientIndustry),
    clientRegion: str(r.ClientRegion),
    stage,
    step: effectiveStep(stage, str(r.ResumeTo)),
    status: r.Status === "deleting" ? "deleting" : "active",
    assigneeUserId: str(r.AssigneeUserId),
    handedOverAt: timeOrNull(r.BusinessHandedOverAt),
    handedOverByUserId: str(r.BusinessHandedOverByUserId),
    type: projectTypeOf(str(r.RepoMode)),
    repoOwner: str(r.RepoOwner),
    repoName: str(r.RepoName),
    repoBranch: str(r.RepoBranch),
    repoVisibility: str(r.RepoVisibility),
    // S1's RepoExisting is a String ("owner/name"); a boolean true is read the same way.
    repoExisting: r.RepoExisting === true || str(r.RepoExisting) !== "",
    goal: str(r.Goal),
    targetUsers: str(r.TargetUsers),
    appUrl: str(r.AppUrl),
    websiteUrl: str(r.WebsiteUrl),
    testEnv: str(r.TestEnv),
    runInstructions: str(r.RunInstructions),
    blocksProjectRef: str(r.BlocksProjectRef),
    blocksProjectDomain: str(r.BlocksProjectDomain),
    blocksProvisioningStatus: str(r.BlocksProvisioningStatus),
    blocksProvisioningError: str(r.BlocksProvisioningError),
    setupStatus: str(r.SetupStatus),
    setupAnswers: str(r.SetupAnswers),
    createdByUserId: str(r.CreatedByUserId),
    createdDate: str(r.CreatedDate),
    lastUpdatedDate: str(r.LastUpdatedDate),
  };
}

export function assignmentFromRow(r: RawRow): AssignmentRecord {
  return {
    id: str(r.ItemId),
    projectId: str(r.ProjectId),
    assigneeUserId: str(r.AssigneeUserId),
    assignedByUserId: str(r.AssignedByUserId),
    at: str(r.At),
  };
}

export function shareFromRow(r: RawRow): ShareRecord {
  return {
    id: str(r.ItemId),
    projectId: str(r.ProjectId),
    itemType: str(r.ItemType) as ShareItemType,
    itemRef: str(r.ItemRef),
    sharedByUserId: str(r.SharedByUserId),
    sharedWithUserId: str(r.SharedWithUserId),
    createdDate: str(r.CreatedDate),
  };
}

export function folderFromRow(r: RawRow): DocFolderRecord {
  return {
    id: str(r.ItemId),
    projectId: str(r.ProjectId),
    parentId: str(r.ParentId),
    name: str(r.Name),
    kind: (str(r.Kind) || "other") as FolderLite["kind"],
    sortOrder: num(r.SortOrder),
    status: r.Status === "deleting" ? "deleting" : "active",
    createdDate: str(r.CreatedDate),
    lastUpdatedDate: str(r.LastUpdatedDate),
  };
}

export function noteFromRow(r: RawRow): DocNoteRecord {
  return {
    id: str(r.ItemId),
    projectId: str(r.ProjectId),
    folderId: str(r.FolderId),
    title: str(r.Title),
    bodyMd: typeof r.BodyMd === "string" ? r.BodyMd : null,
    sortOrder: num(r.SortOrder),
    isScratch: r.IsScratchPad === true,
    isProjectBrief: r.IsProjectBrief === true,
    createdDate: str(r.CreatedDate),
    lastUpdatedDate: str(r.LastUpdatedDate),
    updatedByUserId: str(r.UpdatedByUserId),
  };
}

export function fileFromRow(r: RawRow): DocFileRecord {
  const status = str(r.Status);
  return {
    id: str(r.ItemId),
    projectId: str(r.ProjectId),
    folderId: str(r.FolderId),
    name: str(r.Name),
    storedName: str(r.StoredName),
    mime: str(r.Mime),
    sizeBytes: num(r.SizeBytes),
    status: (status || "pending") as FileLite["status"],
    sortOrder: num(r.SortOrder),
    createdByUserId: str(r.CreatedByUserId),
    createdDate: str(r.CreatedDate),
    lastUpdatedDate: str(r.LastUpdatedDate),
  };
}

// The Project item key is shared by the projects, sanitization and requirements readers, so the three lists must stay identical (test/blocks-project-item-fields.test.ts).
export const PROJECT_FIELDS = [
  "ItemId", "WorkspaceId", "Name", "ClientName", "ClientContact", "ClientIndustry", "ClientRegion",
  "Stage", "ResumeTo", "Status", "AssigneeUserId", "BusinessHandedOverAt", "BusinessHandedOverByUserId", "CreatedByUserId", "CreatedDate", "LastUpdatedDate", "RequirementsConfirmedAt", "RequirementsConfirmedByUserId",
  "RepoMode", "RepoOwner", "RepoName", "RepoBranch", "RepoVisibility",
  "Goal", "TargetUsers", "AppUrl", "WebsiteUrl", "LandingPageAddOn", "LandingPageSection", "TestEnv", "RunInstructions", "BlocksProjectRef", "SetupStatus", "SetupAnswers", "RepoExisting",
  "BlocksProjectDomain", "BlocksProvisioningStatus", "BlocksProvisioningError",
] as const;
export const ASSIGNMENT_FIELDS = ["ItemId", "ProjectId", "AssigneeUserId", "AssignedByUserId", "At"] as const;
export const SHARE_FIELDS = ["ItemId", "ProjectId", "ItemType", "ItemRef", "SharedByUserId", "SharedWithUserId", "CreatedDate"] as const;
export const FOLDER_FIELDS = ["ItemId", "ProjectId", "ParentId", "Name", "Kind", "SortOrder", "CreatedDate", "LastUpdatedDate"] as const;
export const NOTE_TREE_FIELDS = [
  "ItemId", "ProjectId", "FolderId", "Title", "SortOrder", "IsScratchPad", "IsProjectBrief", "UpdatedByUserId", "CreatedDate", "LastUpdatedDate",
] as const;
export const NOTE_BODY_FIELDS = [...NOTE_TREE_FIELDS, "BodyMd"] as const;
/** Never includes StorageObjectId: the browser asks the function for a short-lived URL instead. */
export const FILE_FIELDS = [
  "ItemId", "ProjectId", "FolderId", "Name", "StoredName", "Mime", "SizeBytes", "Status", "SortOrder", "CreatedByUserId", "CreatedDate", "LastUpdatedDate",
] as const;
