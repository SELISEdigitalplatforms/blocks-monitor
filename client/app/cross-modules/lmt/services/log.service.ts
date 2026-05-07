import { http } from "@/lib/http-client";
import {
  IGetLiveLogsPayload,
  IGetLogsByDatePayload,
  IGetLogsPayload,
  ILog,
} from "../models/log.model";
import { APIListResponse } from "@/models/api-response.model";
import { LOG_ENDPOINTS } from "../constants/endpoint.constant";

export class LogService {
  async getLogs(payload: IGetLogsPayload): Promise<APIListResponse<ILog[]>> {
    return http.post<APIListResponse<ILog[]>>(LOG_ENDPOINTS.GET_LOGS, payload);
  }

  async getLogsByDate(payload: IGetLogsByDatePayload): Promise<APIListResponse<ILog[]>> {
    return http.post<APIListResponse<ILog[]>>(LOG_ENDPOINTS.GET_LOGS_BY_DATE, payload);
  }

  async getLiveLog(paylaod: IGetLiveLogsPayload): Promise<APIListResponse<ILog[]>> {
    const url = `${LOG_ENDPOINTS.LIVE}?Name=${paylaod.serviceName}&LastDate=${paylaod.lastDate}&ProjectKey=${paylaod.projectKey}`;
    return http.get<APIListResponse<ILog[]>>(url);
  }
}
