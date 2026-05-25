import { API_BASE } from "@/constants/endpoint.constant";

const IAM_SUBPATH = "/Iam";

export const ACCOUNT_ENDPOINTS = {
  RECOVER: `${API_BASE}${IAM_SUBPATH}/Recover`,
} as const;

export const USER_ENDPOINTS = {
  GET_USER: `${API_BASE}${IAM_SUBPATH}/user`,
} as const;
