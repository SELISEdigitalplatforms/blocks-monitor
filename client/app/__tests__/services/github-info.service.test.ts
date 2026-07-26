import { describe, it, expect, beforeEach, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();

vi.mock("@/lib/http-client", () => ({
  serviceInstances: {
    observabilityService: {},
    logicService: {
      get: (...a: unknown[]) => get(...a),
      post: (...a: unknown[]) => post(...a),
      put: (...a: unknown[]) => put(...a),
    },
    idpService: {},
  },
}));

import { githubInfoService } from "@/services/github-info.service";

describe("githubInfoService", () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue({ isSuccess: true });
    post.mockReset().mockResolvedValue({ isSuccess: true });
    put.mockReset().mockResolvedValue({ isSuccess: true });
  });

  it("verifyAuthorization encodes code and projectKey", async () => {
    await githubInfoService.verifyAuthorization("co de", "pro/j");
    expect(get).toHaveBeenCalledWith("/api/auth/accessToken?code=co%20de&ProjectKey=pro%2Fj");
  });

  it("checkAlreadyAuthorization GETs isAuthorized", async () => {
    await githubInfoService.checkAlreadyAuthorization();
    expect(get).toHaveBeenCalledWith("/api/auth/isAuthorized");
  });

  it("revokeAccess POSTs removeAuthorization with empty body", async () => {
    await githubInfoService.revokeAccess();
    expect(post).toHaveBeenCalledWith("/api/auth/removeAuthorization", {});
  });

  it("removeAuthorization POSTs removeAccessToken", async () => {
    await githubInfoService.removeAuthorization();
    expect(post).toHaveBeenCalledWith("/api/auth/removeAccessToken", {});
  });

  it("getGithubRepos appends optional search/page params only when set", async () => {
    await githubInfoService.getGithubRepos("p");
    expect(get.mock.calls[0][0]).toBe("/api/github/repos?ProjectKey=p");

    get.mockReset().mockResolvedValue({});
    await githubInfoService.getGithubRepos("p", "term", 2, 50);
    const url = get.mock.calls[0][0] as string;
    expect(url).toContain("search=term");
    expect(url).toContain("pageNumber=2");
    expect(url).toContain("pageSize=50");
  });

  it("getRepositoryUser builds the user query", async () => {
    await githubInfoService.getRepositoryUser("p");
    expect(get).toHaveBeenCalledWith("/api/github/user?ProjectKey=p");
  });

  it("getGithubBranches encodes repo and project", async () => {
    await githubInfoService.getGithubBranches("r/1", "p");
    expect(get).toHaveBeenCalledWith("/api/github/branches?repo=r%2F1&ProjectKey=p");
  });

  it("getRepoAndGitBranchMatch builds the branchExists query", async () => {
    await githubInfoService.getRepoAndGitBranchMatch("rid", "p");
    expect(get).toHaveBeenCalledWith("/api/github/branchExists?repoId=rid&ProjectKey=p");
  });

  it("cloneGithubRepo POSTs to build/clone", async () => {
    const payload = { projectKey: "p" } as never;
    await githubInfoService.cloneGithubRepo(payload);
    expect(post).toHaveBeenCalledWith("/api/build/clone", payload);
  });

  it("repoInitialDeploy POSTs to build/run", async () => {
    const payload = { projectKey: "p", repoId: "r" } as never;
    await githubInfoService.repoInitialDeploy(payload);
    expect(post).toHaveBeenCalledWith("/api/build/run", payload);
  });

  it("manualDeploy POSTs to build/manual", async () => {
    const payload = { projectKey: "p", repoId: "r" } as never;
    await githubInfoService.manualDeploy(payload);
    expect(post).toHaveBeenCalledWith("/api/build/manual", payload);
  });

  it("getSpecs GETs settings", async () => {
    await githubInfoService.getSpecs();
    expect(get).toHaveBeenCalledWith("/api/settings");
  });

  it("getAllRepos / getAllRepoBuilds hit repos", async () => {
    await githubInfoService.getAllRepos("p");
    expect(get).toHaveBeenCalledWith("/api/repos?ProjectKey=p");
    get.mockReset().mockResolvedValue({});
    await githubInfoService.getAllRepoBuilds("p");
    expect(get).toHaveBeenCalledWith("/api/repos?ProjectKey=p");
  });

  it("getAllProjects hits repos/list", async () => {
    await githubInfoService.getAllProjects("p");
    expect(get).toHaveBeenCalledWith("/api/repos/list?ProjectKey=p");
  });

  it("getRepoDetails encodes project and repo id", async () => {
    await githubInfoService.getRepoDetails("p", "r 1");
    expect(get).toHaveBeenCalledWith("/api/repos/details?ProjectKey=p&RepoId=r%201");
  });

  it("getCardRepoAndBranches builds the build query", async () => {
    await githubInfoService.getCardRepoAndBranches("b1", "p");
    expect(get).toHaveBeenCalledWith("/api/build?buildId=b1&ProjectKey=p");
  });

  it("changeBuildSpecs PUTs to build", async () => {
    const payload = { buildId: "b" } as never;
    await githubInfoService.changeBuildSpecs(payload);
    expect(put).toHaveBeenCalledWith("/api/build", payload);
  });

  it("changeRepoSpecs POSTs to settings", async () => {
    const payload = { repoId: "r" } as never;
    await githubInfoService.changeRepoSpecs(payload);
    expect(post).toHaveBeenCalledWith("/api/settings", payload);
  });

  it("changeRepoSettings PUTs to settings", async () => {
    const payload = { repoId: "r" } as never;
    await githubInfoService.changeRepoSettings(payload);
    expect(put).toHaveBeenCalledWith("/api/settings", payload);
  });

  it("getBuildLogs builds the run query", async () => {
    await githubInfoService.getBuildLogs("rid", "p");
    expect(get).toHaveBeenCalledWith("/api/build/run?repoId=rid&ProjectKey=p");
  });

  it("getRepoCardsAndBranches hits github/repos", async () => {
    await githubInfoService.getRepoCardsAndBranches("p");
    expect(get).toHaveBeenCalledWith("/api/github/repos?ProjectKey=p");
  });
});
