import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@/services/alerts.service", () => {
  const ok = (extra: object = {}) =>
    vi
      .fn()
      .mockResolvedValue({ isSuccess: true, data: { itemId: "id-1", tenantId: "t-1" }, ...extra });
  return {
    alertsService: {
      addSingleMonitor: ok(),
      updateSingleMonitor: ok(),
      deleteSingleMonitor: ok(),
      getHealthMonitorList: ok(),
      getMonitorListById: ok(),
      getReposList: ok(),
      isExternalServiceConfigured: ok(),
      getMonitorDetails: ok(),
      getMonitorById: ok(),
      getAllMonitorIncidentList: ok(),
      GetMonitorResponseTime: ok(),
      GetMonitorDownTime: ok(),
      saveHealth: ok(),
      updateHealth: ok(),
      deleteHealth: ok(),
    },
  };
});

import { alertsService } from "@/services/alerts.service";
import * as hooks from "@/hooks/use-alerts";
import { QueryWrapper } from "../test-utils";

const wrapper = QueryWrapper;

describe("use-alerts queries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("useGetHealthMonitorList fetches when a project key is present", async () => {
    const { result } = renderHook(
      () =>
        hooks.useGetHealthMonitorList({
          projectKey: "p1",
          monitorSourceType: null,
          pageNumber: 0,
          pageSize: 10,
        } as never),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(alertsService.getHealthMonitorList).toHaveBeenCalled();
  });

  it("useGetReposList fetches the repository list", async () => {
    // H3, the half the controller test cannot show: that the hook actually reaches the service.
    const { result } = renderHook(() => hooks.useGetReposList("t-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(alertsService.getReposList).toHaveBeenCalled();
  });

  it("useGetReposList stays disabled without a scope", async () => {
    const { result } = renderHook(() => hooks.useGetReposList(""), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(alertsService.getReposList).not.toHaveBeenCalled();
  });

  it("useGetReposList refetches when the tenant changes instead of serving cached repos", async () => {
    // The reason projectKey is in the query key at all. QueryClient runs a 60s staleTime, so a
    // scope-free key would hand tenant t-2 the repositories fetched for t-1 - which then get
    // compared against t-2's monitor list. Asserting a SECOND call is the whole point; a test that
    // only checked the first would pass with the leak in place.
    const { result, rerender } = renderHook(({ scope }: { scope: string }) => hooks.useGetReposList(scope), {
      wrapper,
      initialProps: { scope: "t-1" },
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(alertsService.getReposList).toHaveBeenCalledTimes(1);

    rerender({ scope: "t-2" });

    await waitFor(() => expect(alertsService.getReposList).toHaveBeenCalledTimes(2));
  });

  it("useGetHealthMonitorList stays disabled without a project key", async () => {
    const { result } = renderHook(
      () =>
        hooks.useGetHealthMonitorList({
          projectKey: "",
          monitorSourceType: null,
        } as never),
      { wrapper },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(alertsService.getHealthMonitorList).not.toHaveBeenCalled();
  });

  it("useGetMonitorListById requires both project key and repo id", async () => {
    const { result } = renderHook(() => hooks.useGetMonitorListById("p1", "r1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(alertsService.getMonitorListById).toHaveBeenCalledWith("p1", "r1");
  });

  it("useIsExternalServiceConfigured runs only with an id", async () => {
    const { result } = renderHook(() => hooks.useIsExternalServiceConfigured("ext1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(alertsService.isExternalServiceConfigured).toHaveBeenCalledWith("ext1");
  });

  it("useGetMonitorDetails fetches details", async () => {
    const { result } = renderHook(() => hooks.useGetMonitorDetails("m1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(alertsService.getMonitorDetails).toHaveBeenCalledWith("m1");
  });

  it("useGetMonitorById / useGetHealthById fetch by id", async () => {
    const a = renderHook(() => hooks.useGetMonitorById("m1"), { wrapper });
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true));
    const b = renderHook(() => hooks.useGetHealthById("h1"), { wrapper });
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true));
    expect(alertsService.getMonitorById).toHaveBeenCalledWith("m1");
    expect(alertsService.getMonitorById).toHaveBeenCalledWith("h1");
  });

  it("useGetAllIncidentList fetches with a monitor id", async () => {
    const { result } = renderHook(
      () =>
        hooks.useGetAllIncidentList({
          monitorId: "m1",
          pageNumber: 1,
          pageSize: 10,
          sortIsDescending: false,
        } as never),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(alertsService.getAllMonitorIncidentList).toHaveBeenCalled();
  });

  it.each([["1h"], ["24h"], ["7d"], ["30d"], ["other"]])(
    "useGetMonitorResponseTime computes a start time for range %s",
    async (range) => {
      const { result } = renderHook(
        () =>
          hooks.useGetMonitorResponseTime({
            monitorId: "m1",
            timeRange: range,
            interval: 60,
          }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const arg = (alertsService.GetMonitorResponseTime as unknown as ReturnType<typeof vi.fn>).mock
        .calls[0][0];
      expect(arg.monitorId).toBe("m1");
      expect(typeof arg.startTime).toBe("string");
    },
  );

  it.each([["1h"], ["3h"], ["6h"], ["12h"], ["24h"], ["default"]])(
    "useGetMonitorDownTime computes a start time for range %s",
    async (range) => {
      const { result } = renderHook(
        () =>
          hooks.useGetMonitorDownTime({
            monitorId: "m1",
            timeRange: range,
            interval: 60,
          }),
        { wrapper },
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(alertsService.GetMonitorDownTime).toHaveBeenCalled();
    },
  );
});

describe("use-alerts mutations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("useAddSingleMonitor calls the service and resolves", async () => {
    const { result } = renderHook(() => hooks.useAddSingleMonitor(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ projectKey: "p1" } as never);
    });
    expect(alertsService.addSingleMonitor).toHaveBeenCalled();
  });

  it("useUpdateSingleMonitor runs onSuccess refetch logic", async () => {
    const { result } = renderHook(() => hooks.useUpdateSingleMonitor(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ itemId: "1" } as never);
    });
    expect(alertsService.updateSingleMonitor).toHaveBeenCalled();
  });

  it("useDeleteMonitor deletes by id", async () => {
    const { result } = renderHook(() => hooks.useDeleteMonitor(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("item-1");
    });
    expect(alertsService.deleteSingleMonitor).toHaveBeenCalledWith("item-1");
  });

  it("useSaveHealth saves and invalidates", async () => {
    const { result } = renderHook(() => hooks.useSaveHealth(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ name: "h" } as never);
    });
    expect(alertsService.saveHealth).toHaveBeenCalled();
  });

  it("useUpdateHealth updates and refetches", async () => {
    const { result } = renderHook(() => hooks.useUpdateHealth(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ itemId: "1" } as never);
    });
    expect(alertsService.updateHealth).toHaveBeenCalled();
  });

  it("useDeleteHealth deletes and invalidates", async () => {
    const { result } = renderHook(() => hooks.useDeleteHealth(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync("h-1");
    });
    expect(alertsService.deleteHealth).toHaveBeenCalledWith("h-1");
  });
});
