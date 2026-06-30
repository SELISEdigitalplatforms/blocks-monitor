const API_BASE = "/api";

const AUTH_SUBPATH = "/auth";
const GITHUB_SUBPATH = "/github";
const BUILD_SUBPATH = "/build";
const REPOS_SUBPATH = "/repos";
const MONITOR_SUBPATH = "/Monitor";
const HEALTH_SUBPATH = "/Health";
const MIGRATION_SUBPATH = "/migration";

export const DEPLOYMENT_ENDPOINTS = {
  // Authentication & Authorization
  ACCESS_TOKEN: `${API_BASE}${AUTH_SUBPATH}/accessToken`,
  IS_AUTHORIZED: `${API_BASE}${AUTH_SUBPATH}/isAuthorized`,
  REMOVE_AUTHORIZATION: `${API_BASE}${AUTH_SUBPATH}/removeAuthorization`,
  REMOVE_ACCESS_TOKEN: `${API_BASE}${AUTH_SUBPATH}/removeAccessToken`,

  // GitHub Repositories
  GITHUB_REPOS: `${API_BASE}${GITHUB_SUBPATH}/repos`,
  GITHUB_USER: `${API_BASE}${GITHUB_SUBPATH}/user`,
  GITHUB_BRANCHES: `${API_BASE}${GITHUB_SUBPATH}/branches`,
  GITHUB_BRANCH_EXISTS: `${API_BASE}${GITHUB_SUBPATH}/branchExists`,

  // Build & Deployment
  BUILD_BUILD: `${API_BASE}${BUILD_SUBPATH}/clone`,
  RUN_BUILD: `${API_BASE}${BUILD_SUBPATH}/run`,
  MANUAL: `${API_BASE}${BUILD_SUBPATH}/manual`,
  BUILD: `${API_BASE}${BUILD_SUBPATH}`,

  // Repository Management
  REPOS: `${API_BASE}${REPOS_SUBPATH}`,
  REPOS_LIST: `${API_BASE}${REPOS_SUBPATH}/list`,
  REPO_DETAILS: `${API_BASE}${REPOS_SUBPATH}/details`,

  // Build Settings
  SETTINGS: `${API_BASE}/settings`,
} as const;

export const ALERT_ENDPOINTS = {
  SAVE_MONITOR: `${API_BASE}${MONITOR_SUBPATH}/SaveMonitor`,
  UPDATE_MONITOR: `${API_BASE}${MONITOR_SUBPATH}/UpdateMonitor`,
  DELETE_MONITOR: `${API_BASE}${MONITOR_SUBPATH}/DeleteMonitor`,
  GET_MONITOR_LIST: `${API_BASE}${MONITOR_SUBPATH}/GetMonitorList`,
  GET_MONITOR_LIST_BY_REPO_ID: `${API_BASE}${MONITOR_SUBPATH}/GetMonitorListByRepoId`,
  GET_MONITOR_DETAILS: `${API_BASE}${MONITOR_SUBPATH}/GetMonitorDetails`,
  IS_EXTERNAL_SERVICE_CONFIGURED: `${API_BASE}${MONITOR_SUBPATH}/IsExternalServiceConfigured`,
  GET_INCIDENT_LIST: `${API_BASE}${MONITOR_SUBPATH}/GetIncidentList`,
  GET_MONITOR_BY_ID: `${API_BASE}${MONITOR_SUBPATH}/GetMonitorById`,
  GET_MONITOR_RESPONSE_TIME: `${API_BASE}${MONITOR_SUBPATH}/GetMonitorResponseTime`,
  GET_MONITOR_DOWN_TIME: `${API_BASE}${MONITOR_SUBPATH}/GetMonitorDownTime`,
  SAVE_HEALTH: `${API_BASE}${HEALTH_SUBPATH}/SaveHealth`,
  UPDATE_HEALTH: `${API_BASE}${HEALTH_SUBPATH}/UpdateHealth`,
  DELETE_HEALTH: `${API_BASE}${HEALTH_SUBPATH}/DeleteHealth`,
} as const;

export const MIGRATION_ENDPOINTS = {
  GET_STATUS: `${API_BASE}${MIGRATION_SUBPATH}/status`,
  START_MIGRATION: `${API_BASE}${MIGRATION_SUBPATH}/start`,
} as const;
