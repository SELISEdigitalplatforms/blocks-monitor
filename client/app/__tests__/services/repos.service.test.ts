import { describe, it, expect, beforeEach, vi } from "vitest";

const get = vi.fn();

vi.mock("@/lib/http-client", () => ({
  serviceInstances: {
    monitorService: {
      get: (...a: unknown[]) => get(...a),
    },
  },
}));

import { reposService } from "@/services/repos.service";

describe("reposService", () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue({ ok: true });
  });

  it("getRepoDetails encodes repoId and defaults page size 1", async () => {
    await reposService.getRepoDetails("a b/c");
    expect(get).toHaveBeenCalledWith(
      "/api/Monitor/repo-details?repoId=a%20b%2Fc&pageNumber=1&pageSize=1",
    );
  });

  it("getRepoDetails passes pagination", async () => {
    await reposService.getRepoDetails("r1", { pageNumber: 2, pageSize: 5 });
    expect(get).toHaveBeenCalledWith(
      "/api/Monitor/repo-details?repoId=r1&pageNumber=2&pageSize=5",
    );
  });

  it("getReport encodes buildId and type", async () => {
    await reposService.getReport("b 1", "sast");
    expect(get).toHaveBeenCalledWith("/api/Monitor/reports?buildId=b%201&type=sast");
    await reposService.getReport("b1", "sca-libraries");
    expect(get).toHaveBeenCalledWith(
      "/api/Monitor/reports?buildId=b1&type=sca-libraries",
    );
  });
});
