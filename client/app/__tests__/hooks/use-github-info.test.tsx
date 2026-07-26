import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("@seliseblocks/blocks-kit", () => ({
  useProjectStore: () => ({ selectedProject: { tenantId: "proj-1" } }),
}));

vi.mock("@/services/github-info.service", () => {
  const ok = () => vi.fn().mockResolvedValue({ isSuccess: true });
  return {
    githubInfoService: {
      verifyAuthorization: ok(),
      checkAlreadyAuthorization: ok(),
      revokeAccess: ok(),
      removeAuthorization: ok(),
      getGithubRepos: ok(),
      getRepositoryUser: ok(),
      getGithubBranches: ok(),
      getRepoAndGitBranchMatch: ok(),
      cloneGithubRepo: ok(),
      repoInitialDeploy: ok(),
      manualDeploy: ok(),
      getSpecs: ok(),
      getAllRepos: ok(),
      getAllRepoBuilds: ok(),
      getAllProjects: ok(),
      getRepoDetails: ok(),
      getCardRepoAndBranches: ok(),
      changeBuildSpecs: ok(),
      changeRepoSpecs: ok(),
      changeRepoSettings: ok(),
      getBuildLogs: ok(),
      getRepoCardsAndBranches: ok(),
    },
  };
});

import { githubInfoService } from "@/services/github-info.service";
import * as hooks from "@/hooks/use-github-info";
import { QueryWrapper } from "../test-utils";

const wrapper = QueryWrapper;

describe("use-github-info queries", () => {
  beforeEach(() => vi.clearAllMocks());

  it("useGithubVerification runs with code + project key", async () => {
    const { result } = renderHook(() => hooks.useGithubVerification("code-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(githubInfoService.verifyAuthorization).toHaveBeenCalledWith("code-1", "proj-1");
  });

  it("useGithubVerification is disabled without a code", () => {
    const { result } = renderHook(() => hooks.useGithubVerification(""), {
      wrapper,
    });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("useValidateAuthorization checks authorization", async () => {
    const { result } = renderHook(() => hooks.useValidateAuthorization(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(githubInfoService.checkAlreadyAuthorization).toHaveBeenCalled();
  });

  it("useRevokeAccess is disabled by default", () => {
    const { result } = renderHook(() => hooks.useRevokeAccess(), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("useGetGithubRepos runs when verification succeeded", async () => {
    const { result } = renderHook(() => hooks.useGetGithubRepos(true, "term", 1, 10), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(githubInfoService.getGithubRepos).toHaveBeenCalledWith("proj-1", "term", 1, 10);
  });

  it("useGetGithubRepos stays idle when not verified", () => {
    const { result } = renderHook(() => hooks.useGetGithubRepos(false), {
      wrapper,
    });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("useGetRepositoryUser fetches the user", async () => {
    const { result } = renderHook(() => hooks.useGetRepositoryUser(true), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(githubInfoService.getRepositoryUser).toHaveBeenCalledWith("proj-1");
  });

  it("useGithubBranches fetches branches for a repo", async () => {
    const { result } = renderHook(() => hooks.useGithubBranches("repo-1"), {
      wrapper,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(githubInfoService.getGithubBranches).toHaveBeenCalledWith("repo-1", "proj-1");
  });

  it("useRepoAndGitBranchMatch respects the enabled flag", async () => {
    const off = renderHook(() => hooks.useRepoAndGitBranchMatch("r1", false), { wrapper });
    expect(off.result.current.fetchStatus).toBe("idle");

    const on = renderHook(() => hooks.useRepoAndGitBranchMatch("r1", true), {
      wrapper,
    });
    await waitFor(() => expect(on.result.current.isSuccess).toBe(true));
    expect(githubInfoService.getRepoAndGitBranchMatch).toHaveBeenCalled();
  });

  it("useGetAllProjects fetches with an id and stays idle without one", async () => {
    const idle = renderHook(() => hooks.useGetAllProjects(""), { wrapper });
    expect(idle.result.current.fetchStatus).toBe("idle");

    const { result } = renderHook(
      () =>
        hooks.useGetAllProjects("proj-1", {
          refetchOnMount: true,
          refetchOnWindowFocus: false,
          forceRefresh: true,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(githubInfoService.getAllProjects).toHaveBeenCalledWith("proj-1");
  });

  it("useGetAllRepoBuilds fetches builds", async () => {
    const { result } = renderHook(
      () =>
        hooks.useGetAllRepoBuilds("proj-1", {
          refetchOnMount: false,
          refetchOnWindowFocus: true,
        }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(githubInfoService.getAllRepoBuilds).toHaveBeenCalledWith("proj-1");
  });

  it("useGetRepoDetails fetches details", async () => {
    const { result } = renderHook(() => hooks.useGetRepoDetails("proj-1", "repo-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(githubInfoService.getRepoDetails).toHaveBeenCalledWith("proj-1", "repo-1");
  });

  it("useGetSpecs fetches specs", async () => {
    const { result } = renderHook(() => hooks.useGetSpecs(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(githubInfoService.getSpecs).toHaveBeenCalled();
  });

  it("useGetCardProjectAndBranch fetches with a build id", async () => {
    const { result } = renderHook(() => hooks.useGetCardProjectAndBranch("build-1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(githubInfoService.getCardRepoAndBranches).toHaveBeenCalledWith("build-1", "proj-1");
  });
});

describe("use-github-info mutations", () => {
  beforeEach(() => vi.clearAllMocks());

  it("useRemoveAuthorization runs the mutation", async () => {
    const { result } = renderHook(() => hooks.useRemoveAuthorization(), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync();
    });
    expect(githubInfoService.removeAuthorization).toHaveBeenCalled();
  });

  it("useInitialRepoDeployment runs and hits onSuccess", async () => {
    const { result } = renderHook(() => hooks.useInitialRepoDeployment(), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({ projectKey: "p", repoId: "r" } as never);
    });
    expect(githubInfoService.repoInitialDeploy).toHaveBeenCalled();
  });

  it("useManualDeployment runs and hits onSuccess", async () => {
    const { result } = renderHook(() => hooks.useManualDeployment(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ projectKey: "p", repoId: "r" } as never);
    });
    expect(githubInfoService.manualDeploy).toHaveBeenCalled();
  });

  it("useChangeBuildSpecs runs and hits onSuccess", async () => {
    const { result } = renderHook(() => hooks.useChangeBuildSpecs(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ buildId: "b" } as never);
    });
    expect(githubInfoService.changeBuildSpecs).toHaveBeenCalled();
  });

  it("useChangeRepoSpecs runs and hits onSuccess", async () => {
    const { result } = renderHook(() => hooks.useChangeRepoSpecs(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ repoId: "r" } as never);
    });
    expect(githubInfoService.changeRepoSpecs).toHaveBeenCalled();
  });

  it("mutations surface service errors via onError", async () => {
    (
      githubInfoService.repoInitialDeploy as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => hooks.useInitialRepoDeployment(), {
      wrapper,
    });
    await act(async () => {
      await expect(
        result.current.mutateAsync({ projectKey: "p", repoId: "r" } as never),
      ).rejects.toThrow("boom");
    });
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
