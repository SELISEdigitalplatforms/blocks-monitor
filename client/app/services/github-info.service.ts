import { serviceInstances } from "@/lib/http-client";
import { DEPLOYMENT_ENDPOINTS } from "@/constants/endpoint.constant";
import { IBuildApiResponse } from "@/models/deployed-logs.model";
import {
  IRepository,
  IBranch,
  ICloneRepo,
  IRepositoryUser,
  IBranchMatchResponse,
} from "@/models/github-info.model";
import {
  CardRepoAndBranchesResponse,
  IChangeRepoSpecs,
  IChangeSettings,
  IManualDeploymentPayload,
} from "@/models/github-info.model";

export class GithubInfoService {
  private readonly httpClient = serviceInstances.logicService;
  async verifyAuthorization(code: string, projectKey: string): Promise<string> {
    const url = `${DEPLOYMENT_ENDPOINTS.ACCESS_TOKEN}?code=${encodeURIComponent(code)}&ProjectKey=${encodeURIComponent(projectKey)}`;
    return this.httpClient.get(url);
  }

  async checkAlreadyAuthorization(): Promise<{
    isSuccess: boolean;
  }> {
    const url = DEPLOYMENT_ENDPOINTS.IS_AUTHORIZED;
    return this.httpClient.get(url);
  }

  async revokeAccess(): Promise<{
    isSuccess: boolean;
  }> {
    const url = DEPLOYMENT_ENDPOINTS.REMOVE_AUTHORIZATION;
    return this.httpClient.post(url, {});
  }

  async removeAuthorization(): Promise<{
    isSuccess: boolean;
  }> {
    const url = DEPLOYMENT_ENDPOINTS.REMOVE_ACCESS_TOKEN;
    return this.httpClient.post(url, {});
  }

  async getGithubRepos(
    projectKey: string,
    search?: string,
    pageNumber?: number,
    pageSize?: number,
  ): Promise<{
    data: {
      items: IRepository[];
      total_count: number;
    };
    message: string | null;
    statusCode: number;
    errors: unknown;
    isSuccess: boolean;
  }> {
    const url = `${DEPLOYMENT_ENDPOINTS.GITHUB_REPOS}?ProjectKey=${encodeURIComponent(projectKey)}${
      search ? `&search=${encodeURIComponent(search)}` : ""
    }${pageNumber ? `&pageNumber=${pageNumber}` : ""}${pageSize ? `&pageSize=${pageSize}` : ""}`;
    return this.httpClient.get(url);
  }

  async getRepositoryUser(projectKey: string): Promise<IRepositoryUser> {
    const url = `${DEPLOYMENT_ENDPOINTS.GITHUB_USER}?ProjectKey=${encodeURIComponent(projectKey)}`;
    return this.httpClient.get(url);
  }

  async getGithubBranches(repo: string, projectKey: string): Promise<IBranch[]> {
    const url = `${DEPLOYMENT_ENDPOINTS.GITHUB_BRANCHES}?repo=${encodeURIComponent(repo)}&ProjectKey=${encodeURIComponent(projectKey)}`;
    return this.httpClient.get(url);
  }

  async getRepoAndGitBranchMatch(
    repoId: string,
    projectKey: string,
  ): Promise<IBranchMatchResponse> {
    const url = `${DEPLOYMENT_ENDPOINTS.GITHUB_BRANCH_EXISTS}?repoId=${encodeURIComponent(repoId)}&ProjectKey=${encodeURIComponent(projectKey)}`;
    return this.httpClient.get(url);
  }

  async cloneGithubRepo(payload: ICloneRepo) {
    const url = DEPLOYMENT_ENDPOINTS.BUILD_BUILD;
    return this.httpClient.post<{ message: string }>(url, payload);
  }

  async repoInitialDeploy(payload: IChangeRepoSpecs) {
    const url = DEPLOYMENT_ENDPOINTS.RUN_BUILD;
    return this.httpClient.post<{ message: string }>(url, payload);
  }

  async manualDeploy(payload: IManualDeploymentPayload) {
    const url = DEPLOYMENT_ENDPOINTS.MANUAL;
    return this.httpClient.post<{ message: string }>(url, payload);
  }

  async getSpecs() {
    const url = DEPLOYMENT_ENDPOINTS.SETTINGS;
    return this.httpClient.get(url);
  }

  async getAllRepos(projectKey: string): Promise<CardRepoAndBranchesResponse[]> {
    const url = `${DEPLOYMENT_ENDPOINTS.REPOS}?ProjectKey=${encodeURIComponent(projectKey)}`;
    return this.httpClient.get(url);
  }

  async getAllRepoBuilds(projectKey: string): Promise<{ message: string }> {
    const url = `${DEPLOYMENT_ENDPOINTS.REPOS}?ProjectKey=${encodeURIComponent(projectKey)}`;
    return this.httpClient.get(url);
  }

  async getAllProjects(projectKey: string): Promise<{ message: string }> {
    const url = `${DEPLOYMENT_ENDPOINTS.REPOS_LIST}?ProjectKey=${encodeURIComponent(projectKey)}`;
    return this.httpClient.get(url);
  }

  async getRepoDetails(projectKey: string, repoId: string): Promise<{ message: string }> {
    const url = `${DEPLOYMENT_ENDPOINTS.REPO_DETAILS}?ProjectKey=${encodeURIComponent(projectKey)}&RepoId=${encodeURIComponent(repoId)}`;
    return this.httpClient.get(url);
  }

  async getCardRepoAndBranches(buildId: string, projectKey: string): Promise<IBuildApiResponse> {
    const url = `${DEPLOYMENT_ENDPOINTS.BUILD}?buildId=${encodeURIComponent(buildId)}&ProjectKey=${encodeURIComponent(projectKey)}`;
    return this.httpClient.get(url);
  }

  async changeBuildSpecs(payload: IChangeSettings) {
    const url = DEPLOYMENT_ENDPOINTS.BUILD;
    return this.httpClient.put(url, payload);
  }

  async changeRepoSpecs(payload: IChangeRepoSpecs) {
    const url = DEPLOYMENT_ENDPOINTS.SETTINGS;
    return this.httpClient.post(url, payload);
  }

  async changeRepoSettings(payload: IChangeSettings) {
    const url = DEPLOYMENT_ENDPOINTS.SETTINGS;
    return this.httpClient.put(url, payload);
  }

  async getBuildLogs(repoId: string, projectKey: string): Promise<IBuildApiResponse> {
    const url = `${DEPLOYMENT_ENDPOINTS.RUN_BUILD}?repoId=${repoId}&ProjectKey=${encodeURIComponent(projectKey)}`;
    return this.httpClient.get(url);
  }

  async getRepoCardsAndBranches(projectKey: string): Promise<CardRepoAndBranchesResponse> {
    const url = `${DEPLOYMENT_ENDPOINTS.GITHUB_REPOS}?ProjectKey=${encodeURIComponent(projectKey)}`;
    return this.httpClient.get(url);
  }
}

export const githubInfoService = new GithubInfoService();
