import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  addAsync: vi.fn(),
  saveHealthAsync: vi.fn(),
  updateReqAsync: vi.fn(),
  updateHealthAsync: vi.fn(),
  monitorById: { data: undefined as unknown },
  repoMonitorList: { data: [] as unknown[] },
  externalConfig: { data: null as unknown },
  envRepos: { data: [] as unknown[], isLoading: false },
  services: { data: [] as unknown[], isLoading: false },
  navigate: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock("@/hooks/use-alerts", () => ({
  useAddSingleMonitor: () => ({ mutateAsync: h.addAsync, isPending: false }),
  useSaveHealth: () => ({ mutateAsync: h.saveHealthAsync, isPending: false }),
  useUpdateSingleMonitor: () => ({
    mutateAsync: h.updateReqAsync,
    isPending: false,
  }),
  useUpdateHealth: () => ({ mutateAsync: h.updateHealthAsync, isPending: false }),
  useGetMonitorById: () => h.monitorById,
  // controller destructures { data } then reads `.data` again → double-nested
  useGetMonitorListById: () => ({ data: h.repoMonitorList }),
  useIsExternalServiceConfigured: () => ({ data: h.externalConfig }),
}));

vi.mock("@seliseblocks/genesis-os/hooks", () => ({
  useGetEnvRepositories: () => ({
    data: { data: h.envRepos.data },
    isLoading: h.envRepos.isLoading,
  }),
  useGetAllServices: () => ({
    data: { data: h.services.data },
    isLoading: h.services.isLoading,
  }),
  useScopedPath: () => (p: string) => `/scoped/${p}`,
}));

vi.mock("@/hooks/use-toast", () => ({
  showErrorToast: (...a: unknown[]) => h.showError(...a),
  showSuccessToast: (...a: unknown[]) => h.showSuccess(...a),
}));

vi.mock("react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router")>();
  return { ...actual, useNavigate: () => h.navigate };
});

import { useMonitorFormController } from "@/components/module/monitor/form/use-monitor-form-controller";
import { getMonitorFormDefaultValues } from "@/components/module/monitor/form/schema";

const render = (params: Parameters<typeof useMonitorFormController>[0]) =>
  renderHook(() => useMonitorFormController(params));

describe("useMonitorFormController", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.monitorById.data = undefined;
    h.repoMonitorList.data = [];
    h.externalConfig.data = null;
    h.envRepos = { data: [], isLoading: false };
    h.services = { data: [], isLoading: false };
  });

  it("initializes an add form with defaults", () => {
    const { result } = render({ mode: "add", projectKey: "p1" });
    expect(result.current.isEditMode).toBe(false);
    expect(result.current.form.getValues("monitorConfigurationType")).toBe("request");
    expect(result.current.isSubmitting).toBe(false);
  });

  it("hydrates an edit form from monitor details", () => {
    h.monitorById.data = {
      data: {
        name: "existing",
        monitorConfigurationType: 0,
        url: "https://svc.example.com",
        monitorSourceTypes: 1,
        repoId: "r1",
      },
    };
    const { result } = render({ mode: "edit", itemId: "m1", projectKey: "p1" });
    expect(result.current.isEditMode).toBe(true);
    expect(result.current.form.getValues("name")).toBe("existing");
  });

  it("setSourceType clears the opposing selection", () => {
    const { result } = render({ mode: "add", projectKey: "p1" });
    act(() => result.current.setSourceType("deployed"));
    expect(result.current.form.getValues("sourceType")).toBe("deployed");
    act(() => result.current.setSourceType("my-services"));
    expect(result.current.form.getValues("selectedRepoId")).toBe("");
    act(() => result.current.setSourceType("none"));
    expect(result.current.form.getValues("selectedServiceId")).toBe("");
  });

  it("setSelectedRepoId prefills the URL from the repo in add mode", () => {
    h.envRepos.data = [
      {
        itemId: "r1",
        repoName: "R1",
        customDeploymentUrl: "https://custom.example.com",
      },
    ];
    const { result } = render({ mode: "add", projectKey: "p1" });
    act(() => result.current.setSelectedRepoId("r1"));
    expect(result.current.form.getValues("selectedRepoId")).toBe("r1");
    expect(result.current.form.getValues("urlMonitor")).toBe("https://custom.example.com");
  });

  it("setSelectedServiceId prefills the URL from the service in add mode", () => {
    h.services.data = [{ serviceId: "s1", name: "S1", url: "https://s1.com" }];
    const { result } = render({ mode: "add", projectKey: "p1" });
    act(() => result.current.setSelectedServiceId("s1"));
    expect(result.current.form.getValues("urlMonitor")).toBe("https://s1.com");
  });

  it("reports a source error when deployed is chosen without a repo", () => {
    const { result } = render({ mode: "add", projectKey: "p1" });
    act(() => result.current.setSourceType("deployed"));
    expect(result.current.sourceError).toBe("Select a deployed repo.");
    expect(result.current.isSourceBlocked).toBe(true);
  });

  it("shows a loading message while repos load", () => {
    h.envRepos = { data: [], isLoading: true };
    const { result } = render({ mode: "add", projectKey: "p1" });
    act(() => result.current.setSourceType("deployed"));
    expect(result.current.sourceError).toBe("Loading repos...");
  });

  it("flags a duplicate deployed repo monitor", () => {
    h.envRepos.data = [{ itemId: "r1", repoName: "R1" }];
    h.repoMonitorList.data = [{ itemId: "other" }];
    const { result } = render({ mode: "add", projectKey: "p1" });
    act(() => result.current.setSourceType("deployed"));
    act(() => result.current.setSelectedRepoId("r1"));
    expect(result.current.sourceError).toBe("A monitor already exists for this deployed repo.");
  });

  it("submits a new request monitor and navigates on success", async () => {
    h.addAsync.mockResolvedValue({ isSuccess: true, data: { itemId: "new-1" } });
    const onSuccess = vi.fn();
    const { result } = render({ mode: "add", projectKey: "p1", onSuccess });

    const values = {
      ...getMonitorFormDefaultValues("request"),
      name: "New monitor",
      urlMonitor: "https://svc.example.com",
    };
    await act(async () => {
      await result.current.submit(values);
    });

    expect(h.addAsync).toHaveBeenCalled();
    expect(h.navigate).toHaveBeenCalledWith("/scoped/monitor/new-1");
    expect(h.showSuccess).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
  });

  it("shows an error toast when the request mutation reports failure", async () => {
    h.addAsync.mockResolvedValue({ isSuccess: false, message: "nope" });
    const { result } = render({ mode: "add", projectKey: "p1" });
    await act(async () => {
      await result.current.submit({
        ...getMonitorFormDefaultValues("request"),
        name: "m",
        urlMonitor: "https://svc.example.com",
      });
    });
    expect(h.showError).toHaveBeenCalledWith({ errors: "nope" });
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("submits a callback monitor via saveHealth in add mode", async () => {
    h.saveHealthAsync.mockResolvedValue({
      isSuccess: true,
      data: { itemId: "h-1" },
    });
    const { result } = render({ mode: "add", projectKey: "p1" });
    await act(async () => {
      await result.current.submit({
        ...getMonitorFormDefaultValues("callback"),
        name: "cb",
      });
    });
    expect(h.saveHealthAsync).toHaveBeenCalled();
    expect(h.showSuccess).toHaveBeenCalled();
  });

  it("updates an existing request monitor in edit mode", async () => {
    h.updateReqAsync.mockResolvedValue({ isSuccess: true, data: { itemId: "m1" } });
    const { result } = render({ mode: "edit", itemId: "m1", projectKey: "p1" });
    await act(async () => {
      await result.current.submit({
        ...getMonitorFormDefaultValues("request"),
        name: "edited",
        urlMonitor: "https://svc.example.com",
      });
    });
    expect(h.updateReqAsync).toHaveBeenCalled();
    // no navigation on edit
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("converts a thrown error via ErrorTransformer", async () => {
    h.addAsync.mockRejectedValue({ errors: { detail: "boom" } });
    const { result } = render({ mode: "add", projectKey: "p1" });
    await act(async () => {
      await result.current.submit({
        ...getMonitorFormDefaultValues("request"),
        name: "m",
        urlMonitor: "https://svc.example.com",
      });
    });
    await waitFor(() => expect(h.showError).toHaveBeenCalled());
  });

  it("does not submit when the source is blocked", async () => {
    const { result } = render({ mode: "add", projectKey: "p1" });
    act(() => result.current.setSourceType("deployed"));
    await act(async () => {
      await result.current.submit(getMonitorFormDefaultValues("request"));
    });
    expect(h.addAsync).not.toHaveBeenCalled();
  });
});
