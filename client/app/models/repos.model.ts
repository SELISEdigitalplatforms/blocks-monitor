import type { IRepoListItem } from "@/models/alerts.model";

export interface IRepo extends IRepoListItem {
  branch?: string | null;
  commit?: string | null;
  lastDeploymentDate?: string | null;
  lastDeploymentStatus?: string | null;
  deployedNamespace?: string | null;
  deploymentType?: string | null;
  dependencyTrackProjectUuid?: string | null;
  createdDate?: string | null;
}

export interface IBuild {
  itemId: string;
  repoId: string;
  repoName: string;
  branch: string;
  status: string;
  eventName: string;
  createdDate: string;
  lastUpdatedDate: string;
  repoUrl: string | null;
  commit: string | null;
  imageName: string | null;
  pipelineRunName: string | null;
  html_url: string | null;
  defaultDeploymentUrl: string | null;
  customDeploymentUrl: string | null;
  dependencyTrackProjectId: string | null;
  events?: IBuildEvent[] | null;
}

export interface IBuildEvent {
  id?: string | null;
  buildId?: string | null;
  eventType?: string | null;
  message?: string | null;
  eventGroup?: string | null;
  createdAt?: string | null;
  createdDate?: string | null;
  lastUpdateDate?: string | null;
}

export interface IRepoDetailsResponse {
  isSuccess: boolean;
  statusCode?: number;
  message?: string | null;
  data: { repo: IRepo | null; build: IBuild[]; totalCount: number } | null;
}

export type ReportType = "sast" | "sca-libraries";

export interface IScaVulnerability {
  id?: string;
  name?: string;
  group?: string;
  version?: string;
  latestVersion?: string;
  severity?: string;
  cweName?: string;
  description?: string;
  score?: string | number | null;
  epssPercentile?: number | null;
  epssScore?: number | null;
}

export interface IReportResponse {
  isSuccess: boolean;
  statusCode?: number;
  message?: string | null;
  data: {
    type: string;
    details: Record<string, string> | null;
    vulnerabilities: IScaVulnerability[] | null;
  } | null;
}
