import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { getMonitorIncidentActivity } from "@/services/incident-activity.service";
import { useMonitorIncidentActivity } from "@/hooks/use-monitor-incident-activity";

const state = vi.hoisted(() => ({ project: "project-a" }));
vi.mock("@seliseblocks/app-kit/store", () => ({
  useProjectStore: () => ({ selectedProject: { tenantId: state.project } }),
}));
vi.mock("@/services/incident-activity.service", () => ({
  getMonitorIncidentActivity: vi.fn(),
}));

describe("useMonitorIncidentActivity", () => {
  it("scopes the cache to project and monitor, and refreshes with the details invalidation", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const load = vi.mocked(getMonitorIncidentActivity);
    load.mockReset();
    load.mockImplementation(async () => ({
      days: [{ date: "2026-10-11", count: load.mock.calls.length }],
      incidents: [],
      unit: "minute",
    }));
    state.project = "project-a";
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result, rerender, unmount } = renderHook(
      ({ monitorId }) => useMonitorIncidentActivity(monitorId, "2026-10-11"),
      { wrapper, initialProps: { monitorId: "m1" } },
    );
    await waitFor(() => expect(result.current.data?.days[0].count).toBe(1));
    expect(load).toHaveBeenCalledWith("m1", "2026-10-11", { signal: expect.any(AbortSignal) });

    state.project = "project-b";
    rerender({ monitorId: "m1" });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data?.days[0].count).toBe(2));

    rerender({ monitorId: "m2" });
    await waitFor(() => expect(result.current.data?.days[0].count).toBe(3));

    await client.invalidateQueries({ queryKey: ["get-monitor-details"] });
    await waitFor(() => expect(result.current.data?.days[0].count).toBe(4));
    expect(
      client.getQueryData([
        "get-monitor-details",
        "m1",
        "incident-activity",
        "project-a",
        "2026-10-11",
      ]),
    ).toMatchObject({ days: [{ date: "2026-10-11", count: 1 }] });
    unmount();
    client.clear();
  });

  it("waits for a monitor before loading", () => {
    const client = new QueryClient();
    const load = vi.mocked(getMonitorIncidentActivity);
    load.mockReset();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useMonitorIncidentActivity("", "2026-10-11"), {
      wrapper,
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(load).not.toHaveBeenCalled();
    client.clear();
  });
});
