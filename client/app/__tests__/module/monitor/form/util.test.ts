import { describe, it, expect } from "vitest";
import {
  toMonitorSourceType,
  toSourceType,
  toSliderStep,
  toSeconds,
  toFormValuesFromMonitorDetails,
  toCreateRequestPayload,
  toUpdateRequestPayload,
  toCreateCallbackPayload,
  toUpdateCallbackPayload,
} from "@/components/module/monitor/form/util";
import { MONITOR_SOURCE_TYPES } from "@/constants/alert.constant";
import { getMonitorFormDefaultValues } from "@/components/module/monitor/form/schema";
import type { IMonitorDetails } from "@/models/alerts.model";

const context = {
  itemId: "item-1",
  projectKey: "proj-1",
  repoName: "repo-1",
  externalServiceName: "svc-1",
};

describe("toMonitorSourceType", () => {
  it("maps deployed to DeployedServices", () => {
    expect(toMonitorSourceType("deployed")).toBe(MONITOR_SOURCE_TYPES.DeployedServices);
  });
  it("maps my-services to ExternalServices", () => {
    expect(toMonitorSourceType("my-services")).toBe(MONITOR_SOURCE_TYPES.ExternalServices);
  });
  it("maps none to OtherServices", () => {
    expect(toMonitorSourceType("none")).toBe(MONITOR_SOURCE_TYPES.OtherServices);
  });
});

describe("toSourceType", () => {
  it("maps numeric DeployedServices to deployed", () => {
    expect(toSourceType(1)).toBe("deployed");
  });
  it("maps numeric ExternalServices to my-services", () => {
    expect(toSourceType(3)).toBe("my-services");
  });
  it("falls back to none for anything else and for null", () => {
    expect(toSourceType(0)).toBe("none");
    expect(toSourceType(null)).toBe("none");
    expect(toSourceType(undefined)).toBe("none");
  });
});

describe("toSliderStep", () => {
  it("maps known interval seconds back to a step", () => {
    expect(toSliderStep(30)).toBe(1);
    expect(toSliderStep(60)).toBe(2);
    expect(toSliderStep(300)).toBe(3);
  });
  it("returns the fallback for unknown or missing seconds", () => {
    expect(toSliderStep(999)).toBe(2);
    expect(toSliderStep(null)).toBe(2);
    expect(toSliderStep(undefined, 5)).toBe(5);
    expect(toSliderStep(0, 7)).toBe(7);
  });
});

describe("toSeconds", () => {
  it("maps a step to interval seconds", () => {
    expect(toSeconds(1)).toBe(30);
    expect(toSeconds(3)).toBe(300);
  });
  it("falls back to the step-2 value for an unknown step", () => {
    expect(toSeconds(99)).toBe(60);
  });
});

describe("toFormValuesFromMonitorDetails", () => {
  it("returns defaults when no details are supplied", () => {
    expect(toFormValuesFromMonitorDetails(undefined)).toEqual(getMonitorFormDefaultValues());
  });

  it("maps monitor details into form values", () => {
    const details = {
      name: "svc",
      monitorConfigurationType: 0,
      monitorSourceTypes: 1,
      repoId: "repo-9",
      externalServiceId: "ext-9",
      url: "https://svc.example.com",
      intervalInSeconds: 60,
      timeoutInSeconds: 30,
      gracePeriodInSeconds: 300,
      httpMethodType: 2,
      customPayload: '{"a":1}',
      customHttpHeaders: '{"X-Token":"abc"}',
      checkSSLErrors: true,
      sslExpiryReminders: false,
      domainExpiryReminders: true,
    } as unknown as IMonitorDetails;

    const values = toFormValuesFromMonitorDetails(details);
    expect(values.name).toBe("svc");
    expect(values.monitorConfigurationType).toBe("request");
    expect(values.sourceType).toBe("deployed");
    expect(values.selectedRepoId).toBe("repo-9");
    expect(values.urlMonitor).toBe("https://svc.example.com");
    expect(values.monitorSettings.monitor_interval).toBe(2);
    expect(values.monitorSettings.grace_time).toBe(3);
    expect(values.monitorSettings.check_ssl_errors).toBe(true);
    expect(values.requestConfiguration.http_methods).toBe("2");
    expect(values.requestConfiguration.request_body).toBe('{"a":1}');
    expect(values.requestConfiguration.x_header_name).toBe("X-Token");
    expect(values.requestConfiguration.value).toBe("abc");
    expect(values.requestConfiguration.json_switcher).toBe(true);
  });

  it("treats configuration type 1 as callback", () => {
    const values = toFormValuesFromMonitorDetails({
      monitorConfigurationType: 1,
    } as unknown as IMonitorDetails);
    expect(values.monitorConfigurationType).toBe("callback");
  });

  it("uses the default request body when payload is missing/invalid", () => {
    const values = toFormValuesFromMonitorDetails({
      customPayload: "not-json",
    } as unknown as IMonitorDetails);
    expect(values.requestConfiguration.request_body).toBe('{"key":"value"}');
  });

  it("returns empty header info when headers are absent or non-object", () => {
    const values = toFormValuesFromMonitorDetails({
      customHttpHeaders: "[]",
    } as unknown as IMonitorDetails);
    expect(values.requestConfiguration.x_header_name).toBe("");
    expect(values.requestConfiguration.json_switcher).toBe(false);
  });
});

describe("payload builders", () => {
  const values = {
    ...getMonitorFormDefaultValues("request"),
    name: "  trimmed  ",
    urlMonitor: "https://svc.example.com",
    selectedRepoId: "repo-1",
    selectedServiceId: "ext-1",
    sourceType: "deployed" as const,
    monitorSettings: {
      monitor_interval: 1,
      request_timeout: 3,
      grace_time: 3,
      check_ssl_errors: false,
      ssl_expiry_reminders: false,
      domain_expiry_reminders: false,
    },
    requestConfiguration: {
      http_methods: "2",
      request_body: '{"payload":true}',
      json_switcher: true,
      x_header_name: "X-Token",
      value: "abc",
    },
  };

  it("toCreateRequestPayload trims name and includes POST body + headers", () => {
    const payload = toCreateRequestPayload(values, context);
    expect(payload.name).toBe("trimmed");
    expect(payload.repoId).toBe("repo-1");
    expect(payload.monitorConfigurationType).toBe(0);
    expect(payload.customPayload).toBe('{"payload":true}');
    expect(payload.intervalInSeconds).toBe(30);
    expect(payload.customHttpHeaders).toBe('{"X-Token":"abc"}');
    expect(payload.monitorSourceType).toBe(MONITOR_SOURCE_TYPES.DeployedServices);
  });

  it("omits the custom payload when method is not POST", () => {
    const payload = toCreateRequestPayload(
      {
        ...values,
        requestConfiguration: { ...values.requestConfiguration, http_methods: "1" },
      },
      context,
    );
    expect(payload.customPayload).toBe("");
  });

  it("toUpdateRequestPayload carries the itemId and nulls authorizationType", () => {
    const payload = toUpdateRequestPayload(values, context);
    expect(payload.itemId).toBe("item-1");
    expect(payload.authorizationType).toBeNull();
  });

  it("toUpdateRequestPayload defaults itemId to empty string when missing", () => {
    const payload = toUpdateRequestPayload(values, {
      ...context,
      itemId: undefined,
    });
    expect(payload.itemId).toBe("");
  });

  it("toCreateCallbackPayload sets config type 1 and grace period", () => {
    const payload = toCreateCallbackPayload(values, context);
    expect(payload.monitorConfigurationType).toBe(1);
    expect(payload.gracePeriodInSeconds).toBe(300);
    expect(payload.name).toBe("trimmed");
  });

  it("toUpdateCallbackPayload includes the itemId", () => {
    const payload = toUpdateCallbackPayload(values, context);
    expect(payload.itemId).toBe("item-1");
    expect(payload.monitorConfigurationType).toBe(1);
  });
});
