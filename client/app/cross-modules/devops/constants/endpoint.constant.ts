import { API_BASES } from "@/constants/endpoint.constant";
import { getRuntimeEnv } from "@/lib/runtime-env";

const CLOUD_BUILD_API_BASE =
  getRuntimeEnv("BLOCKS_DEPLOYMENT_APP_URL");

export const CLOUD_BUILD_ENDPOINTS = {
  // Authentication & Authorization
  ACCESS_TOKEN: `${CLOUD_BUILD_API_BASE}/api/auth/accessToken`,
  IS_AUTHORIZED: `${CLOUD_BUILD_API_BASE}/api/auth/isAuthorized`,
  REMOVE_AUTHORIZATION: `${CLOUD_BUILD_API_BASE}/api/auth/removeAuthorization`,
  REMOVE_ACCESS_TOKEN: `${CLOUD_BUILD_API_BASE}/api/auth/removeAccessToken`,

  // GitHub Repositories
  GITHUB_REPOS: `${CLOUD_BUILD_API_BASE}/api/github/repos`,
  GITHUB_USER: `${CLOUD_BUILD_API_BASE}/api/github/user`,
  GITHUB_BRANCHES: `${CLOUD_BUILD_API_BASE}/api/github/branches`,
  GITHUB_BRANCH_EXISTS: `${CLOUD_BUILD_API_BASE}/api/github/branchExists`,

  // Build & Deployment
  BUILD_BUILD: `${CLOUD_BUILD_API_BASE}/api/build/clone`,
  RUN_BUILD: `${CLOUD_BUILD_API_BASE}/api/build/run`,
  MANUAL: `${CLOUD_BUILD_API_BASE}/api/build/manual`,
  BUILD: `${CLOUD_BUILD_API_BASE}/api/build`,

  // Repository Management
  REPOS: `${CLOUD_BUILD_API_BASE}/api/repos`,
  REPOS_LIST: `${CLOUD_BUILD_API_BASE}/api/repos/list`,
  REPO_DETAILS: `${CLOUD_BUILD_API_BASE}/api/repos/details`,

  // Build Settings
  SETTINGS: `${CLOUD_BUILD_API_BASE}/api/settings`,
};

export const ALERT_ENDPOINTS = {
  SAVE_MONITOR: `${API_BASES.ALERT}/Monitor/SaveMonitor`,
  UPDATE_MONITOR: `${API_BASES.ALERT}/Monitor/UpdateMonitor`,
  DELETE_MONITOR: `${API_BASES.ALERT}/Monitor/DeleteMonitor`,
  GET_MONITOR_LIST: `${API_BASES.ALERT}/Monitor/GetMonitorList`,
  GET_MONITOR_LIST_BY_REPO_ID: `${API_BASES.ALERT}/Monitor/GetMonitorListByRepoId`,
  GET_MONITOR_DETAILS: `${API_BASES.ALERT}/Monitor/GetMonitorDetails`,
  IS_EXTERNAL_SERVICE_CONFIGURED: `${API_BASES.ALERT}/Monitor/IsExternalServiceConfigured`,
  GET_INCIDENT_LIST: `${API_BASES.ALERT}/Monitor/GetIncidentList`,
  GET_MONITOR_BY_ID: `${API_BASES.ALERT}/Monitor/GetMonitorById`,
  GET_MONITOR_RESPONSE_TIME: `${API_BASES.ALERT}/Monitor/GetMonitorResponseTime`,
  GET_MONITOR_DOWN_TIME: `${API_BASES.ALERT}/Monitor/GetMonitorDownTime`,
  SAVE_HEALTH: `${API_BASES.ALERT}/Health/SaveHealth`,
  UPDATE_HEALTH: `${API_BASES.ALERT}/Health/UpdateHealth`,
  DELETE_HEALTH: `${API_BASES.ALERT}/Health/DeleteHealth`,
} as const;

export const MIGRATION_ENDPOINTS = {
  GET_STATUS: `${API_BASES.IDENTIFIER}/migration/status`,
  START_MIGRATION: `${API_BASES.IDENTIFIER}/migration/start`,
};
