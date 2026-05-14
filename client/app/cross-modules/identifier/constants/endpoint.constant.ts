import { API_BASE } from "@/constants/endpoint.constant";

const PROJECT_SUBPATH = "/Project";
const SERVICE_SUBPATH = "/Service";
const BUILD_SUBPATH = "/build";

export const PROJECT_ENDPOINTS = {
  GETS: `${API_BASE}${PROJECT_SUBPATH}/Gets`,
  GET: `${API_BASE}${PROJECT_SUBPATH}/Get`,
  ADD_ASSET: `${API_BASE}${PROJECT_SUBPATH}/AddAsset`,
} as const;

export const SERVICE_REGISTRY_ENDPOINTS = {
  GET_ALL: `${API_BASE}${SERVICE_SUBPATH}/GetAll`,
} as const;

export const CLOUD_BUILD_ENDPOINTS = {
  REPOS_LIST: `${API_BASE}${BUILD_SUBPATH}/repos-list`,
} as const;
