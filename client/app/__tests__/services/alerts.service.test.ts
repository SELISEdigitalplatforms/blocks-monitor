import { describe, it, expect, beforeEach, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const del = vi.fn();

vi.mock("@/lib/http-client", () => ({
  serviceInstances: {
    monitorService: {
      get: (...a: unknown[]) => get(...a),
      post: (...a: unknown[]) => post(...a),
      delete: (...a: unknown[]) => del(...a),
    },
    logicService: {},
    idpService: {},
  },
}));

import { alertsService } from "@/services/alerts.service";

describe("alertsService", () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue({ ok: true });
    post.mockReset().mockResolvedValue({ ok: true });
    del.mockReset().mockResolvedValue({ ok: true });
  });

  it("addSingleMonitor POSTs to SaveMonitor with the payload", async () => {
    await alertsService.addSingleMonitor({ name: "x" });
    expect(post).toHaveBeenCalledWith("/api/Monitor/SaveMonitor", { name: "x" });
  });

  it("updateSingleMonitor POSTs to UpdateMonitor", async () => {
    await alertsService.updateSingleMonitor({ itemId: "1" } as never);
    expect(post).toHaveBeenCalledWith("/api/Monitor/UpdateMonitor", {
      itemId: "1",
    });
  });

  it("deleteSingleMonitor encodes the itemId in the query", async () => {
    await alertsService.deleteSingleMonitor("a b/c");
    expect(del).toHaveBeenCalledWith(
      "/api/Monitor/DeleteMonitor?itemId=a%20b%2Fc",
    );
  });

  it("getMonitorList encodes the project key", async () => {
    await alertsService.getMonitorList("proj key");
    expect(get).toHaveBeenCalledWith(
      "/api/Monitor/GetMonitorList?projectKey=proj%20key",
    );
  });

  it("getMonitorListById includes project key and repo id", async () => {
    await alertsService.getMonitorListById("proj", "repo1");
    expect(get).toHaveBeenCalledWith(
      "/api/Monitor/GetMonitorListByRepoId?projectKey=proj&repoId=repo1",
    );
  });

  it("getMonitorDetails encodes the monitor id", async () => {
    await alertsService.getMonitorDetails("m1");
    expect(get).toHaveBeenCalledWith(
      "/api/Monitor/GetMonitorDetails?monitorId=m1",
    );
  });

  it("isExternalServiceConfigured builds the right query", async () => {
    await alertsService.isExternalServiceConfigured("ext1");
    expect(get).toHaveBeenCalledWith(
      "/api/Monitor/IsExternalServiceConfigured?externalServiceId=ext1",
    );
  });

  it("getHealthMonitorList includes sort + source type params when present", async () => {
    await alertsService.getHealthMonitorList({
      projectKey: "p",
      pageNumber: 1,
      pageSize: 10,
      monitorSourceType: 2 as never,
      sortProperty: "name",
      sortIsDescending: true,
    });
    const url = get.mock.calls[0][0] as string;
    expect(url).toContain("projectKey=p");
    expect(url).toContain("pageNumber=1");
    expect(url).toContain("pageSize=10");
    expect(url).toContain("monitorSourceType=2");
    expect(url).toContain("sortProperty=name");
    expect(url).toContain("sortIsDescending=true");
  });

  it("getHealthMonitorList omits source type when null and sort when absent", async () => {
    await alertsService.getHealthMonitorList({
      projectKey: "p",
      pageNumber: 2,
      pageSize: 5,
      monitorSourceType: null,
    });
    const url = get.mock.calls[0][0] as string;
    expect(url).not.toContain("monitorSourceType");
    expect(url).not.toContain("sortProperty");
  });

  it("getAllMonitorIncidentList serializes pagination and sort flags", async () => {
    await alertsService.getAllMonitorIncidentList({
      monitorId: "m1",
      pageNumber: 1,
      pageSize: 20,
      sortIsDescending: false,
    } as never);
    const url = get.mock.calls[0][0] as string;
    expect(url).toContain("monitorId=m1");
    expect(url).toContain("pageNumber=1");
    expect(url).toContain("sortIsDescending=false");
  });

  it("getMonitorById builds the id query", async () => {
    await alertsService.getMonitorById("m2");
    expect(get).toHaveBeenCalledWith("/api/Monitor/GetMonitorById?monitorId=m2");
  });

  it("GetMonitorResponseTime encodes all three params", async () => {
    await alertsService.GetMonitorResponseTime({
      monitorId: "m1",
      startTime: "2023-01-01T00:00:00Z",
      endTime: "2023-01-02T00:00:00Z",
    });
    const url = get.mock.calls[0][0] as string;
    expect(url).toContain("/api/Monitor/GetMonitorResponseTime?");
    expect(url).toContain("monitorId=m1");
    expect(url).toContain("startTime=2023-01-01T00%3A00%3A00Z");
  });

  it("GetMonitorDownTime builds the downtime query", async () => {
    await alertsService.GetMonitorDownTime({
      monitorId: "m1",
      startTime: "s",
      endTime: "e",
    });
    const url = get.mock.calls[0][0] as string;
    expect(url).toContain("/api/Monitor/GetMonitorDownTime?monitorId=m1");
    expect(url).toContain("startDate=s");
    expect(url).toContain("endDate=e");
  });

  it("saveHealth / updateHealth POST to the health endpoints", async () => {
    await alertsService.saveHealth({ name: "h" } as never);
    expect(post).toHaveBeenCalledWith("/api/Health/SaveHealth", { name: "h" });
    await alertsService.updateHealth({ name: "h2" } as never);
    expect(post).toHaveBeenCalledWith("/api/Health/UpdateHealth", {
      name: "h2",
    });
  });

  it("deleteHealth encodes the itemId", async () => {
    await alertsService.deleteHealth("id 1");
    expect(del).toHaveBeenCalledWith("/api/Health/DeleteHealth?itemId=id%201");
  });
});
