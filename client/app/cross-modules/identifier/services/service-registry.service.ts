import { serviceInstances } from "@/lib/http-client";
import { getRuntimeEnv } from "@/lib/runtime-env";
import { SERVICE_REGISTRY_ENDPOINTS } from "@blocks-identifier/constants/endpoint.constant";
import {
  IGetAllServicesPayload,
  IGetAllServicesResponse,
} from "../models/service.model";

export class ServiceRegistryService {
  private readonly httpClient = serviceInstances.logicService;
  getAllServices(
    payload: IGetAllServicesPayload,
  ): Promise<IGetAllServicesResponse> {
    return this.httpClient.post(
      `${getRuntimeEnv("BLOCKS_LOGIC_APP_URL")}/api/Service/GetAll`,
      payload,
      undefined,
      { absoluteUrl: true },
    );
  }
}

export const serviceRegistryService = new ServiceRegistryService();
