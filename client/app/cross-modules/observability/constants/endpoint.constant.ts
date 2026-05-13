import { API_BASE } from "@/constants/endpoint.constant";

export const CLOUD_BUILD_ENDPOINTS = {
  // Authentication & Authorization
  ACCESS_TOKEN: `${API_BASE}/auth/accessToken`,
  IS_AUTHORIZED: `${API_BASE}/auth/isAuthorized`,
  REMOVE_AUTHORIZATION: `${API_BASE}/auth/removeAuthorization`,
  REMOVE_ACCESS_TOKEN: `${API_BASE}/auth/removeAccessToken`,

  // GitHub Repositories
  GITHUB_REPOS: `${API_BASE}/github/repos`,
  GITHUB_USER: `${API_BASE}/github/user`,
  GITHUB_BRANCHES: `${API_BASE}/github/branches`,
  GITHUB_BRANCH_EXISTS: `${API_BASE}/github/branchExists`,

  // Build & Deployment
  BUILD_BUILD: `${API_BASE}/build/clone`,
  RUN_BUILD: `${API_BASE}/build/run`,
  MANUAL: `${API_BASE}/build/manual`,
  BUILD: `${API_BASE}/build`,

  // Repository Management
  REPOS: `${API_BASE}/repos`,
  REPOS_LIST: `${API_BASE}/repos/list`,
  REPO_DETAILS: `${API_BASE}/repos/details`,

  // Build Settings
  SETTINGS: `${API_BASE}/settings`,
};

export const ALERT_ENDPOINTS = {
  SAVE_MONITOR: `${API_BASE}/Monitor/SaveMonitor`,
  UPDATE_MONITOR: `${API_BASE}/Monitor/UpdateMonitor`,
  DELETE_MONITOR: `${API_BASE}/Monitor/DeleteMonitor`,
  GET_MONITOR_LIST: `${API_BASE}/Monitor/GetMonitorList`,
  GET_MONITOR_LIST_BY_REPO_ID: `${API_BASE}/Monitor/GetMonitorListByRepoId`,
  GET_MONITOR_DETAILS: `${API_BASE}/Monitor/GetMonitorDetails`,
  IS_EXTERNAL_SERVICE_CONFIGURED: `${API_BASE}/Monitor/IsExternalServiceConfigured`,
  GET_INCIDENT_LIST: `${API_BASE}/Monitor/GetIncidentList`,
  GET_MONITOR_BY_ID: `${API_BASE}/Monitor/GetMonitorById`,
  GET_MONITOR_RESPONSE_TIME: `${API_BASE}/Monitor/GetMonitorResponseTime`,
  GET_MONITOR_DOWN_TIME: `${API_BASE}/Monitor/GetMonitorDownTime`,
  SAVE_HEALTH: `${API_BASE}/Health/SaveHealth`,
  UPDATE_HEALTH: `${API_BASE}/Health/UpdateHealth`,
  DELETE_HEALTH: `${API_BASE}/Health/DeleteHealth`,
} as const;

export const MIGRATION_ENDPOINTS = {
  GET_STATUS: `${API_BASE}/migration/status`,
  START_MIGRATION: `${API_BASE}/migration/start`,
};
