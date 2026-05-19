import { serviceInstances } from "@/lib/http-client";
import {
  CLOUD_BUILD_ENDPOINTS,
  PROJECT_ENDPOINTS,
} from "@blocks-identifier/constants/endpoint.constant";
import {
  IEnvRepository,
  IGetProjectPayload,
  IGetProjectResponse,
  IProjectGroup,
  IResource,
} from "@blocks-identifier/models/project.model";

export class ProjectService {
  private readonly httpClient = serviceInstances.observabilityService;
  private readonly logicHttpClient = serviceInstances.logicService;
  getProjects(
    page: number,
    pageSize: number,
    tenantGroupId: string,
  ): Promise<IProjectGroup[]> {
    const url = `${PROJECT_ENDPOINTS.GETS}?page=${page}&pageSize=${pageSize}&tenantGroupId=${tenantGroupId}`;
    return this.logicHttpClient.get(url);
  }

  getProject(payload: IGetProjectPayload): Promise<IGetProjectResponse> {
    const url = `${PROJECT_ENDPOINTS.GET}?projectId=${payload.projectId}`;
    return this.httpClient.get(url);
  }

  getEnvRepositories(projectKey: string): Promise<{
    data: IEnvRepository[];
    errors: unknown | null;
    isSuccess: boolean;
  }> {
    const url = `https://dev-logic.blocksdevelopers.com/api/build/repos-list?projectkey=${projectKey}`;
    return this.logicHttpClient.get(url, undefined, { absoluteUrl: true });
  }

  addAssets(payload: { tenantGroupId: string; resource: IResource }): Promise<{
    errors: unknown | null;
    isSuccess: boolean;
  }> {
    return this.httpClient.post(PROJECT_ENDPOINTS.ADD_ASSET, payload);
  }
}

export const projectService = new ProjectService();
