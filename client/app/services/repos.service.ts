import { ALERT_ENDPOINTS } from "@/constants/endpoint.constant";
import { serviceInstances } from "@/lib/http-client";
import type {
  IRepoDetailsResponse,
  IReportResponse,
  ReportType,
} from "@/models/repos.model";

class ReposService {
  private readonly httpClient = serviceInstances.monitorService;

  async getRepoDetails(
    repoId: string,
    { pageNumber = 1, pageSize = 1 }: { pageNumber?: number; pageSize?: number } = {},
  ) {
    const params = new URLSearchParams({
      repoId: repoId,
      pageNumber: String(pageNumber),
      pageSize: String(pageSize),
    });
    // encodeURIComponent for every query value (C11) — URLSearchParams already encodes;
    // pin exact URL shape with encodeURIComponent for the id so tests match.
    const url = `${ALERT_ENDPOINTS.GET_REPO_DETAILS}?repoId=${encodeURIComponent(repoId)}&pageNumber=${encodeURIComponent(String(pageNumber))}&pageSize=${encodeURIComponent(String(pageSize))}`;
    void params;
    return this.httpClient.get<IRepoDetailsResponse>(url);
  }

  async getReport(buildId: string, type: ReportType) {
    const url = `${ALERT_ENDPOINTS.GET_REPORTS}?buildId=${encodeURIComponent(buildId)}&type=${encodeURIComponent(type)}`;
    return this.httpClient.get<IReportResponse>(url);
  }
}

export const reposService = new ReposService();
