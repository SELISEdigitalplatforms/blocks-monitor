import { describe, it, expect } from "vitest";
import {
  monitorFormSchema,
  getMonitorFormDefaultValues,
} from "@/components/module/monitor/form/schema";

const base = () => getMonitorFormDefaultValues("request");

describe("getMonitorFormDefaultValues", () => {
  it("defaults to request configuration", () => {
    const v = getMonitorFormDefaultValues();
    expect(v.monitorConfigurationType).toBe("request");
    expect(v.sourceType).toBe("none");
    expect(v.monitorSettings.monitor_interval).toBe(2);
    expect(v.requestConfiguration.http_methods).toBe("0");
  });

  it("respects an explicit configuration type", () => {
    expect(getMonitorFormDefaultValues("callback").monitorConfigurationType).toBe(
      "callback",
    );
  });
});

describe("monitorFormSchema", () => {
  it("accepts a valid request monitor", () => {
    const result = monitorFormSchema.safeParse({
      ...base(),
      name: "My monitor",
      urlMonitor: "https://example.com",
    });
    expect(result.success).toBe(true);
  });

  it("requires a name", () => {
    const result = monitorFormSchema.safeParse({
      ...base(),
      name: "",
      urlMonitor: "https://example.com",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === "Name is required")).toBe(
        true,
      );
    }
  });

  it("rejects a whitespace-only name", () => {
    const result = monitorFormSchema.safeParse({
      ...base(),
      name: "   ",
      urlMonitor: "https://example.com",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) => i.message === "Name cannot contain only spaces",
        ),
      ).toBe(true);
    }
  });

  it("rejects a name over 100 characters", () => {
    const result = monitorFormSchema.safeParse({
      ...base(),
      name: "a".repeat(101),
      urlMonitor: "https://example.com",
    });
    expect(result.success).toBe(false);
  });

  it("requires a URL for request monitors", () => {
    const result = monitorFormSchema.safeParse({
      ...base(),
      name: "m",
      urlMonitor: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.message === "URL is required")).toBe(
        true,
      );
    }
  });

  it("rejects a malformed URL for request monitors", () => {
    const result = monitorFormSchema.safeParse({
      ...base(),
      name: "m",
      urlMonitor: "ftp://bad",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message.includes("valid URL")),
      ).toBe(true);
    }
  });

  it("requires a repo when sourceType is deployed", () => {
    const result = monitorFormSchema.safeParse({
      ...base(),
      name: "m",
      urlMonitor: "https://example.com",
      sourceType: "deployed",
      selectedRepoId: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message === "Select a deployed repo."),
      ).toBe(true);
    }
  });

  it("requires a service when sourceType is my-services", () => {
    const result = monitorFormSchema.safeParse({
      ...base(),
      name: "m",
      urlMonitor: "https://example.com",
      sourceType: "my-services",
      selectedServiceId: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message === "Select a service."),
      ).toBe(true);
    }
  });

  it("does not require a URL for callback monitors", () => {
    const result = monitorFormSchema.safeParse({
      ...getMonitorFormDefaultValues("callback"),
      name: "callback monitor",
      urlMonitor: "",
    });
    expect(result.success).toBe(true);
  });

  it("requires grace_time for callback monitors", () => {
    const values = getMonitorFormDefaultValues("callback");
    const result = monitorFormSchema.safeParse({
      ...values,
      name: "callback",
      monitorSettings: { ...values.monitorSettings, grace_time: 0 },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((i) => i.message === "Grace time is required"),
      ).toBe(true);
    }
  });
});

describe("requestConfiguration nested rules", () => {
  it("requires a request body for POST (http_methods '2')", () => {
    const values = base();
    const result = monitorFormSchema.safeParse({
      ...values,
      name: "m",
      urlMonitor: "https://example.com",
      requestConfiguration: {
        ...values.requestConfiguration,
        http_methods: "2",
        request_body: "",
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (i) => i.message === "Request body is required for POST requests",
        ),
      ).toBe(true);
    }
  });

  it("requires header name and value when json_switcher is on", () => {
    const values = base();
    const result = monitorFormSchema.safeParse({
      ...values,
      name: "m",
      urlMonitor: "https://example.com",
      requestConfiguration: {
        ...values.requestConfiguration,
        json_switcher: true,
        x_header_name: "",
        value: "",
      },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message);
      expect(messages).toContain("Header name is required when sending JSON");
      expect(messages).toContain("Header value is required when sending JSON");
    }
  });
});
