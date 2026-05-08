import { http } from "@/lib/http-client";
import type {
  IGetLiveLogsPayload,
  IGetLogsByDatePayload,
  IGetLogsPayload,
  ILog,
} from "../models/log.model";
import type { ApiPaginatedResponse } from "@/models/api-response.model";
import { LOG_ENDPOINTS } from "../constants/endpoint.constant";

export class LogService {
  async getLogs(payload: IGetLogsPayload): Promise<ApiPaginatedResponse<ILog>> {
    return http.post<ApiPaginatedResponse<ILog>>(
      LOG_ENDPOINTS.GET_LOGS,
      payload,
    );
  }

  async getLogsByDate(
    payload: IGetLogsByDatePayload,
  ): Promise<ApiPaginatedResponse<ILog>> {
    return http.post<ApiPaginatedResponse<ILog>>(
      LOG_ENDPOINTS.GET_LOGS_BY_DATE,
      payload,
    );
  }

  async getLiveLog(
    payload: IGetLiveLogsPayload,
  ): Promise<ApiPaginatedResponse<ILog>> {
    const url = `${LOG_ENDPOINTS.LIVE}?Name=${payload.serviceName}&LastDate=${payload.lastDate}&ProjectKey=${payload.projectKey}`;
    return http.get<ApiPaginatedResponse<ILog>>(url);
  }
}
