import type { IMonitorDetails } from "@/cross-modules/devops/models/alerts.model";
import type { FormType, MonitorForm } from "./schema";

export const getMonitorFormDefaultValues = (
  monitorType: FormType = "request",
): MonitorForm => ({
  name: "",
  monitorConfigurationType: monitorType,
  sourceType: "none",
  selectedRepoId: "",
  selectedServiceId: "",
  urlMonitor: "",
  monitorSettings: {
    monitor_interval: 2,
    request_timeout: 3,
    grace_time: 3,
    check_ssl_errors: false,
    ssl_expiry_reminders: false,
    domain_expiry_reminders: false,
  },
  requestConfiguration: {
    http_methods: "0",
    request_body: '{"key": "value"}',
    json_switcher: false,
    x_header_name: "",
    value: "",
  },
});

export const setMonitorFormDefaultResponseValues = (
  monitorDetails: IMonitorDetails | undefined,
): MonitorForm => {
  if (!monitorDetails) {
    return getMonitorFormDefaultValues();
  }
  const headers = JSON.parse(monitorDetails.customHttpHeaders || "{}");
  const firstEntry = Object.entries(headers)[0];

  const headerName = String(firstEntry[0] || "");
  const headerValue = String(firstEntry[1] || "");
  const jsonSwitcher = !!(headerName && headerValue);

  return {
    name: monitorDetails.name,
    monitorConfigurationType:
      monitorDetails.monitorConfigurationType === 0 ? "request" : "callback",
    sourceType:
      monitorDetails.monitorSourceTypes === 1
        ? "deployed"
        : monitorDetails.monitorSourceTypes === 3
          ? "my-services"
          : "none",
    selectedRepoId: monitorDetails.repoId || "",
    selectedServiceId: monitorDetails.externalServiceId || "",
    urlMonitor: monitorDetails.url,
    monitorSettings: {
      monitor_interval: monitorDetails.intervalInSeconds,
      request_timeout: monitorDetails.timeoutInSeconds,
      grace_time: monitorDetails.gracePeriodInSeconds,
      check_ssl_errors: monitorDetails?.checkSSLErrors || false,
      ssl_expiry_reminders: monitorDetails?.sslExpiryReminders || false,
      domain_expiry_reminders: monitorDetails?.domainExpiryReminders || false,
    },
    requestConfiguration: {
      http_methods: monitorDetails.httpMethodType.toString(),
      request_body: JSON.stringify(
        JSON.parse(monitorDetails.customPayload || '{key: "value"}'),
        null,
        2,
      ),
      json_switcher: jsonSwitcher || false,
      x_header_name: headerName || "",
      value: headerValue || "",
    },
  };
};
