import { API_BASES } from "@/constants/endpoint.constant";

export const CLOUD_BUILD_ENDPOINTS = {
  // Authentication & Authorization
  ACCESS_TOKEN:
    "https://dev-logic.blocksdevelopers.com/api/auth/accessToken",
  IS_AUTHORIZED:
    "https://dev-logic.blocksdevelopers.com/api/auth/isAuthorized",
  REMOVE_AUTHORIZATION:
    "https://dev-logic.blocksdevelopers.com/api/auth/removeAuthorization",
  REMOVE_ACCESS_TOKEN:
    "https://dev-logic.blocksdevelopers.com/api/auth/removeAccessToken",

  // GitHub Repositories
  GITHUB_REPOS: "https://dev-logic.blocksdevelopers.com/api/github/repos",
  GITHUB_USER: "https://dev-logic.blocksdevelopers.com/api/github/user",
  GITHUB_BRANCHES:
    "https://dev-logic.blocksdevelopers.com/api/github/branches",
  GITHUB_BRANCH_EXISTS:
    "https://dev-logic.blocksdevelopers.com/api/github/branchExists",

  // Build & Deployment
  BUILD_BUILD: "https://dev-logic.blocksdevelopers.com/api/build/clone",
  RUN_BUILD: "https://dev-logic.blocksdevelopers.com/api/build/run",
  MANUAL: "https://dev-logic.blocksdevelopers.com/api/build/manual",
  BUILD: "https://dev-logic.blocksdevelopers.com/api/build",

  // Repository Management
  REPOS: "https://dev-logic.blocksdevelopers.com/api/repos",
  REPOS_LIST: "https://dev-logic.blocksdevelopers.com/api/repos/list",
  REPO_DETAILS: "https://dev-logic.blocksdevelopers.com/api/repos/details",

  // Build Settings
  SETTINGS: "https://dev-logic.blocksdevelopers.com/api/settings",
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
