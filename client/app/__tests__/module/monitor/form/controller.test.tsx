import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, render as renderComponent, act, waitFor } from "@testing-library/react";

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

  /**
   * react-hook-form seeds its state from `defaultValues` and only reconciles the
   * `values` prop in an effect, so seeding with the add defaults makes edit mode's
   * FIRST render show 30s before settling on the real value. Neither getValues() after
   * renderHook nor formState.defaultValues can see that — both are post-reconciliation.
   * Recording the value on every render is what actually catches it: with the bug the
   * sequence is [1, 3], without it [3, 3].
   */
  const valuesPerRender = (params: Parameters<typeof useMonitorFormController>[0]) => {
    const seen: unknown[] = [];
    function Probe() {
      const controller = useMonitorFormController(params);
      seen.push(controller.form.getValues("monitorSettings.request_timeout"));
      return null;
    }
    renderComponent(<Probe />);
    return seen;
  };

  it("never shows the add default on the edit form's first render", () => {
    const seen = valuesPerRender({ mode: "edit", itemId: "m1", projectKey: "p1" });
    expect(seen[0]).toBe(3);
    expect(seen).not.toContain(getMonitorFormDefaultValues().monitorSettings.request_timeout);
  });

  // Edit's placeholder-then-saved-value sequence is unchanged from before this ticket:
  // the 5min fallback first, then the monitor's real 60s value. Asserted as first/last
  // rather than an exact array, so an extra render does not fail a correct sequence.
  it("keeps the edit form's placeholder-then-saved-value sequence", () => {
    h.monitorById.data = {
      data: { name: "existing", monitorConfigurationType: 0, timeoutInSeconds: 60 },
    };
    const seen = valuesPerRender({ mode: "edit", itemId: "m1", projectKey: "p1" });
    expect(seen[0]).toBe(3);
    // step 2 = 60s: neither the add default (1) nor the edit fallback (3)
    expect(seen.at(-1)).toBe(2);
    expect(seen).not.toContain(1);
  });

  it("never shows the edit fallback on the add form, first render or settled", () => {
    const seen = valuesPerRender({ mode: "add", projectKey: "p1" });
    expect(seen[0]).toBe(1);
    expect(new Set(seen)).toEqual(new Set([1]));
  });

  /**
   * H2/H3/H5 at the controller level. The field tests build their own form and the payload
   * tests call getMonitorFormDefaultValues directly, so without this nothing connects the
   * real controller's settled state to what a user submits: a controller that reconciled
   * add mode onto the 5min fallback would pass every other test in this change.
   */
  it("settles the add form on 30s and submits it (H2, H3, H5)", async () => {
    h.addAsync.mockResolvedValue({ isSuccess: true, data: { itemId: "new-1" } });
    const { result } = render({ mode: "add", projectKey: "p1" });

    expect(result.current.form.getValues("monitorSettings.request_timeout")).toBe(1);
    expect(result.current.form.getValues("monitorSettings.grace_time")).toBe(1);

    act(() => {
      result.current.form.setValue("name", "svc");
      result.current.form.setValue("urlMonitor", "https://svc.example.com");
    });
    await act(async () => {
      await result.current.submit(result.current.form.getValues());
    });

    expect(h.addAsync).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutInSeconds: 30, intervalInSeconds: 60 }),
    );
  });

  it("submits a 30s grace period for a callback monitor (H3, H5)", async () => {
    h.saveHealthAsync.mockResolvedValue({ isSuccess: true, data: { itemId: "new-2" } });
    const { result } = render({ mode: "add", projectKey: "p1" });

    act(() => {
      result.current.form.setValue("name", "svc");
      result.current.setMonitorType("callback");
    });
    await act(async () => {
      await result.current.submit(result.current.form.getValues());
    });

    expect(h.saveHealthAsync).toHaveBeenCalledWith(
      expect.objectContaining({ gracePeriodInSeconds: 30 }),
    );
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
