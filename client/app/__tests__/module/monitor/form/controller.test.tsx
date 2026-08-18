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
  envRepos: { data: [] as unknown[], isLoading: false, isError: false },
  reposListSpy: vi.fn(),
  monitorListByIdSpy: vi.fn(),
  legacyEnvReposSpy: vi.fn(),
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
  // controller destructures { data } then reads `.data` again → double-nested.
  // Arguments are recorded: without that, the duplication test cannot tell a correctly scoped call
  // from one made with the wrong tenant or repo, since the fixture comes back either way.
  useGetMonitorListById: (projectKey: string, repoId: string) => {
    h.monitorListByIdSpy(projectKey, repoId);
    return { data: h.repoMonitorList };
  },
  useIsExternalServiceConfigured: () => ({ data: h.externalConfig }),
  // The repository list now comes from our own API. Fed from the same h.envRepos fixture the
  // legacy mock used, so every pre-existing test in this file exercises the new path unchanged.
  useGetReposList: (projectKey: string) => {
    h.reposListSpy(projectKey);
    return {
      data: { data: h.envRepos.data },
      isLoading: h.envRepos.isLoading,
      isError: h.envRepos.isError,
    };
  },
}));

vi.mock("@seliseblocks/genesis-os/hooks", () => ({
  // Deliberately still mocked, and deliberately spied: the point of this ticket is that the
  // controller NEVER reaches blocks-logic for repositories. If the import came back, this records it.
  useGetEnvRepositories: () => {
    h.legacyEnvReposSpy();
    return { data: { data: h.envRepos.data }, isLoading: h.envRepos.isLoading };
  },
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

describe("useMonitorFormController — repository source (#201)", () => {
  const repo = (over: Record<string, unknown> = {}) => ({
    itemId: "repo-123",
    repoName: "my-app",
    customDeploymentUrl: "https://custom.dev",
    defaultDeploymentUrl: "https://default.internal",
    repoUrl: "https://github.com/org/my-app",
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    h.monitorById.data = undefined;
    h.repoMonitorList.data = [];
    h.externalConfig.data = null;
    h.envRepos.data = [];
    h.envRepos.isLoading = false;
    h.envRepos.isError = false;
    h.services.data = [];
    h.services.isLoading = false;
  });

  it("reads repositories from our own API and never from blocks-logic", async () => {
    // H3. The negative assertion is the ticket: it is entirely possible to add the new hook and
    // leave the old one in place, and every other test here would still pass.
    h.envRepos.data = [repo()];

    const { result } = render({ mode: "add", projectKey: "t-1" });

    expect(h.reposListSpy).toHaveBeenCalledWith("t-1");
    expect(h.legacyEnvReposSpy).not.toHaveBeenCalled();
    expect(result.current.deployedRepos).toHaveLength(1);
  });

  it.each([
    ["customDeploymentUrl first", {}, "https://custom.dev"],
    ["defaultDeploymentUrl when custom is absent", { customDeploymentUrl: null }, "https://default.internal"],
    [
      "repoUrl when both deployment urls are absent",
      { customDeploymentUrl: null, defaultDeploymentUrl: null },
      "https://github.com/org/my-app",
    ],
    [
      "empty string when the repo carries no url at all",
      { customDeploymentUrl: null, defaultDeploymentUrl: null, repoUrl: null },
      "",
    ],
  ])("prefills urlMonitor with %s", async (_label, over, expected) => {
    // H4, walked one rung at a time. A single happy-path fixture passes even if the fallback order
    // is reversed, which is the mistake worth catching here.
    h.envRepos.data = [repo(over)];

    const { result } = render({ mode: "add", projectKey: "t-1" });
    act(() => result.current.setSelectedRepoId("repo-123"));

    await waitFor(() => expect(result.current.form.getValues("urlMonitor")).toBe(expected));
  });

  it("still flags a duplicate monitor for a repo sourced from the new endpoint", async () => {
    // H5. The duplication check reads a separate, still-tenant-scoped query; this proves the swap
    // did not sever it.
    h.envRepos.data = [repo()];
    h.repoMonitorList.data = [{ itemId: "other-monitor" }];

    const { result } = render({ mode: "add", projectKey: "t-1" });
    act(() => result.current.setSourceType("deployed"));
    act(() => result.current.setSelectedRepoId("repo-123"));

    // Asserted through the user-visible message: repoDuplicate is internal and not returned.
    await waitFor(() =>
      expect(result.current.sourceError).toBe("A monitor already exists for this deployed repo."),
    );
    // And that the check was actually scoped to this tenant and this repo - the mock returns its
    // fixture regardless of arguments, so without this the wiring could be wrong and still pass.
    expect(h.monitorListByIdSpy).toHaveBeenLastCalledWith("t-1", "repo-123");
  });

  it("reports the loading state from the new hook", async () => {
    // C3. These strings already existed; what is new is that they must be driven by the NEW hook's
    // isLoading. If the swap dropped it, this is what fails.
    h.envRepos.isLoading = true;

    const { result } = render({ mode: "add", projectKey: "t-1" });
    act(() => result.current.setSourceType("deployed"));

    await waitFor(() => expect(result.current.sourceError).toBe("Loading repos..."));
  });

  it("prompts for a selection once an empty list has loaded", async () => {
    // C4 and ticket example 2: empty is a loaded state, not a stuck loading one.
    h.envRepos.data = [];
    h.envRepos.isLoading = false;

    const { result } = render({ mode: "add", projectKey: "t-1" });
    act(() => result.current.setSourceType("deployed"));

    await waitFor(() => expect(result.current.sourceError).toBe("Select a deployed repo."));
  });

  it("says the fetch failed rather than pretending there are no repos", async () => {
    // C5, client half. Before this the 400/500 the endpoint returns was indistinguishable from an
    // empty project: the user saw "Select a deployed repo." and was invited to choose from a list
    // that never loaded. This is the assertion that makes the error path real rather than assumed.
    h.envRepos.data = [];
    h.envRepos.isLoading = false;
    h.envRepos.isError = true;

    const { result } = render({ mode: "add", projectKey: "t-1" });
    act(() => result.current.setSourceType("deployed"));

    await waitFor(() => expect(result.current.sourceError).toBe("Failed to get repos."));
  });

  it("surfaces a failure that arrives after the form is already open", async () => {
    // The case the memo's dependency array actually governs. The test above sets isError before the
    // first render, so it passed even while isReposError was missing from the deps and the message
    // could never appear once the form was live. Lint caught that; this pins it.
    h.envRepos.isError = false;

    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) =>
        useMonitorFormController({ mode: "add", projectKey: scope }),
      { initialProps: { scope: "t-1" } },
    );
    act(() => result.current.setSourceType("deployed"));
    await waitFor(() => expect(result.current.sourceError).toBe("Select a deployed repo."));

    h.envRepos.isError = true;
    rerender({ scope: "t-1" });

    await waitFor(() => expect(result.current.sourceError).toBe("Failed to get repos."));
  });

  it("leaves the my-services path on its own data source", async () => {
    // Must-not-break: my-services is out of scope and must keep using useGetAllServices.
    h.services.isLoading = true;

    const { result } = render({ mode: "add", projectKey: "t-1" });
    act(() => result.current.setSourceType("my-services"));

    await waitFor(() => expect(result.current.sourceError).toBe("Loading services..."));
  });

  it("leaves external-URL monitors unblocked by the repository source", async () => {
    // Must-not-break: an external URL depends on neither repos nor services, so no repo state
    // should gate it.
    const { result } = render({ mode: "add", projectKey: "t-1" });
    act(() => result.current.setSourceType("none"));

    await waitFor(() => expect(result.current.sourceError).toBeFalsy());
    expect(result.current.isSourceBlocked).toBe(false);
  });

  it("KNOWN PRE-EXISTING DEFECT: a tenant switch leaves the repo selection in place", async () => {
    // Documents current behaviour, not desired behaviour.
    //
    // The add form's `values` memo (use-monitor-form-controller.ts:70) depends only on
    // [isEditMode, monitorDetails?.data], so nothing reseeds the form when projectKey changes:
    // selectedRepoId and the prefilled urlMonitor survive, sourceError only checks that an id is
    // present, and submission then pairs the NEW tenant with the OLD repo.
    //
    // This predates #201 and is independent of it - the same thing happens with the legacy
    // useGetEnvRepositories(projectKey), because the stale value is form state rather than cache.
    // #201 deliberately did not change form-seeding semantics under a data-source ticket. Asserted
    // so that a future fix has to flip this deliberately instead of silently.
    h.envRepos.data = [repo()];

    const { result, rerender } = renderHook(
      ({ scope }: { scope: string }) =>
        useMonitorFormController({ mode: "add", projectKey: scope }),
      { initialProps: { scope: "t-1" } },
    );

    act(() => result.current.setSelectedRepoId("repo-123"));
    await waitFor(() => expect(result.current.form.getValues("urlMonitor")).toBe("https://custom.dev"));

    // Tenant B: its repositories are fetched correctly...
    h.envRepos.data = [repo({ itemId: "repo-999", repoName: "other-tenant-app" })];
    rerender({ scope: "t-2" });

    await waitFor(() => expect(h.reposListSpy).toHaveBeenCalledWith("t-2"));
    // ...but tenant A's selection and URL are still sitting in the form.
    expect(result.current.form.getValues("selectedRepoId")).toBe("repo-123");
    expect(result.current.form.getValues("urlMonitor")).toBe("https://custom.dev");
  });
});
