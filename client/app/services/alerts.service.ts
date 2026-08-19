import type {
  GetMonitorByIdResponse,
  GetMonitorPingLogsResponse,
  IAddSingleMonitorPayload,
  IAddSingleMonitorResponse,
  IAlertResponse,
  IDeleteHealthResponse,
  IGetAllIncidentListPayload,
  IGetHealthMonitorListPayload,
  IGetMonitorList,
  IGetReposListResponse,
  IIncidentSummaryResponse,
  IMonitorIncidentListResponse,
  ISaveHealth,
  ISaveSingleHealthResponse,
  IUpdateHealth,
  IUpdateSingleMonitorPayload,
} from "@/models/alerts.model";
import { serviceInstances } from "@/lib/http-client";
import { ALERT_ENDPOINTS } from "@/constants/endpoint.constant";

class AlertsService {
  private readonly httpClient = serviceInstances.monitorService;
  async addSingleMonitor(payload: IAddSingleMonitorPayload) {
    const url = ALERT_ENDPOINTS.SAVE_MONITOR;
    return this.httpClient.post<IAlertResponse<IAddSingleMonitorResponse>>(url, payload);
  }
  async updateSingleMonitor(payload: Partial<IUpdateSingleMonitorPayload>) {
    const url = ALERT_ENDPOINTS.UPDATE_MONITOR;
    return this.httpClient.post<IAlertResponse<IAddSingleMonitorResponse>>(url, payload);
  }
  async deleteSingleMonitor(itemId: string) {
    const url = `${ALERT_ENDPOINTS.DELETE_MONITOR}?itemId=${encodeURIComponent(itemId)}`;
    return this.httpClient.delete<IAlertResponse<null>>(url);
  }

  /**
   * Deployed repositories, served by our own API via IReleaseDriverService. Takes no parameters:
   * the caller is identified by the auth token and the driver scopes the result server-side.
   */
  async getReposList() {
    const url = ALERT_ENDPOINTS.GET_REPOS_LIST;
    return this.httpClient.get<IGetReposListResponse>(url);
  }

  async getMonitorList(projectKey: string) {
    const url = `${ALERT_ENDPOINTS.GET_MONITOR_LIST}?projectKey=${encodeURIComponent(projectKey)}`;
    return this.httpClient.get<IGetMonitorList>(url);
  }
  async getMonitorListById(projectKey: string, repoId: string) {
    const url = `${ALERT_ENDPOINTS.GET_MONITOR_LIST_BY_REPO_ID}?projectKey=${encodeURIComponent(projectKey)}&repoId=${repoId}`;
    return this.httpClient.get<IGetMonitorList>(url);
  }
  async getMonitorDetails(monitorId: string) {
    const url = `${ALERT_ENDPOINTS.GET_MONITOR_DETAILS}?monitorId=${encodeURIComponent(monitorId)}`;
    return this.httpClient.get<IIncidentSummaryResponse>(url);
  }
  async isExternalServiceConfigured(externalServiceId: string) {
    const url = `${ALERT_ENDPOINTS.IS_EXTERNAL_SERVICE_CONFIGURED}?externalServiceId=${encodeURIComponent(externalServiceId)}`;
    return this.httpClient.get<IAlertResponse<IAddSingleMonitorResponse>>(url);
  }

  async getHealthMonitorList({
    projectKey,
    pageNumber,
    pageSize,
    monitorSourceType,
    sortProperty,
    sortIsDescending,
  }: IGetHealthMonitorListPayload) {
    const params = new URLSearchParams({
      projectKey,
      pageNumber: pageNumber.toString(),
      pageSize: pageSize.toString(),
      ...(monitorSourceType !== null && {
        monitorSourceType: monitorSourceType.toString(),
      }),
      ...(sortProperty && { sortProperty }),
      ...(sortProperty && {
        sortIsDescending: String(Boolean(sortIsDescending)),
      }),
    });

    const url = `${ALERT_ENDPOINTS.GET_MONITOR_LIST}?${params.toString()}`;
    return this.httpClient.get<IGetMonitorList>(url);
  }

  async getAllMonitorIncidentList(payload: IGetAllIncidentListPayload) {
    const params = new URLSearchParams({
      ...payload,
      pageNumber: payload.pageNumber.toString(),
      pageSize: payload.pageSize.toString(),
      sortIsDescending: String(payload.sortIsDescending),
    });

    const url = `${ALERT_ENDPOINTS.GET_INCIDENT_LIST}?${params.toString()}`;
    return this.httpClient.get<IMonitorIncidentListResponse>(url);
  }
  async getMonitorById(monitorId: string) {
    const url = `${ALERT_ENDPOINTS.GET_MONITOR_BY_ID}?monitorId=${encodeURIComponent(monitorId)}`;
    return this.httpClient.get<GetMonitorByIdResponse>(url);
  }

  async GetMonitorResponseTime(payload: { monitorId: string; startTime: string; endTime: string }) {
    const url = `${ALERT_ENDPOINTS.GET_MONITOR_RESPONSE_TIME}?monitorId=${encodeURIComponent(payload.monitorId)}&startTime=${encodeURIComponent(payload.startTime)}&endTime=${encodeURIComponent(payload.endTime)}`;
    return this.httpClient.get<GetMonitorPingLogsResponse>(url);
  }
  async GetMonitorDownTime(payload: { monitorId: string; startTime: string; endTime: string }) {
    const url = `${ALERT_ENDPOINTS.GET_MONITOR_DOWN_TIME}?monitorId=${encodeURIComponent(payload.monitorId)}&startDate=${payload.startTime}&endDate=${payload.endTime}`;
    return this.httpClient.get<GetMonitorPingLogsResponse>(url);
  }
  async saveHealth(payload: ISaveHealth) {
    const url = ALERT_ENDPOINTS.SAVE_HEALTH;
    return this.httpClient.post<ISaveSingleHealthResponse>(url, payload);
  }
  async updateHealth(payload: Partial<IUpdateHealth>) {
    const url = ALERT_ENDPOINTS.UPDATE_HEALTH;
    return this.httpClient.post<ISaveSingleHealthResponse>(url, payload);
  }
  async deleteHealth(itemId: string) {
    const url = `${ALERT_ENDPOINTS.DELETE_HEALTH}?itemId=${encodeURIComponent(itemId)}`;
    return this.httpClient.delete<IDeleteHealthResponse>(url);
  }
}
export const alertsService = new AlertsService();
