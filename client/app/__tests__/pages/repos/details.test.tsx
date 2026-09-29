import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { QueryWrapper } from "@/__tests__/test-utils";

const h = vi.hoisted(() => ({
  details: {
    data: {
      data: {
        repo: {
          itemId: "r1",
          repoName: "org/blocks-monitor",
          repoUrl: "https://github.com/org/blocks-monitor",
          deployedNamespace: "ns",
          deploymentType: "Web app",
          customDeploymentUrl: null,
        },
        build: [] as unknown[],
        totalCount: 0,
      },
    },
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
}));

const sampleBuild = {
  itemId: "b1",
  repoId: "r1",
  repoName: "org/blocks-monitor",
  branch: "dev",
  status: "Succeeded",
  eventName: "push",
  createdDate: "2026-09-29T09:00:00Z",
  lastUpdatedDate: "2026-09-29T09:03:12Z",
  repoUrl: "https://github.com/org/blocks-monitor",
  commit: "a1b2c3d4e5",
  imageName: null,
  pipelineRunName: "run-1",
  html_url: "https://github.com/org/blocks-monitor/actions/1",
  defaultDeploymentUrl: "https://dev.example.com",
  customDeploymentUrl: null,
  dependencyTrackProjectId: null,
};

vi.mock("@seliseblocks/genesis-os/store", () => ({
  useProjectStore: () => ({ selectedProject: { tenantId: "proj-1" } }),
}));
vi.mock("@seliseblocks/genesis-os/hooks", () => ({
  useScopedPath: () => (p: string) => `/scoped/${p}`,
}));
vi.mock("@seliseblocks/genesis-os/utils", () => ({
  formatDate: () => "Sep 29, 2026 15:00",
}));
vi.mock("@/hooks/use-repos", () => ({
  getHttpStatus: (error: unknown) => {
    if (!error || typeof error !== "object") return undefined;
    const e = error as Record<string, unknown>;
    if (typeof e.status === "number") return e.status;
    const response = e.response as Record<string, unknown> | undefined;
    if (response && typeof response.status === "number") return response.status;
    return undefined;
  },
  useGetRepoDetails: () => h.details,
  useGetReport: () => ({ data: null, isLoading: false, isError: false, refetch: vi.fn() }),
}));

import RepoDetailsPage from "@/pages/repos/details";

function renderPage(search = "") {
  return render(
    <QueryWrapper>
      <NuqsTestingAdapter searchParams={search}>
        <MemoryRouter initialEntries={[`/repos/r1${search}`]}>
          <Routes>
            <Route path="/repos/:repoId" element={<RepoDetailsPage />} />
          </Routes>
        </MemoryRouter>
      </NuqsTestingAdapter>
    </QueryWrapper>,
  );
}

describe("RepoDetailsPage", () => {
  beforeEach(() => {
    h.details.isLoading = false;
    h.details.isError = false;
    h.details.error = null;
    h.details.data.data.build = [sampleBuild];
  });

  it("renders latest build and repository cards (H8)", () => {
    renderPage();
    expect(screen.getByTestId("latest-build-card")).toBeInTheDocument();
    expect(screen.getByTestId("repository-card")).toBeInTheDocument();
    expect(screen.getByTestId("repo-live")).toHaveTextContent("Yes");
  });

  it("shows no-build state and disables SAST/SCA (C8)", () => {
    h.details.data.data.build = [];
    renderPage("?tab=sast");
    expect(screen.getByTestId("no-build-card")).toHaveTextContent(
      "This repository has not been deployed yet",
    );
    expect(screen.getByRole("tab", { name: "SAST" })).toBeDisabled();
    expect(screen.getByRole("tab", { name: "SCA" })).toBeDisabled();
  });

  it("shows not-found without retry (C9)", () => {
    h.details.isError = true;
    h.details.error = { status: 404 };
    renderPage();
    expect(screen.getByTestId("repo-not-found")).toHaveTextContent("Repository not found");
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("shows error with retry for non-404 (C6)", () => {
    h.details.isError = true;
    h.details.error = { status: 500 };
    renderPage();
    expect(screen.getByTestId("page-error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("shows loading skeleton", () => {
    h.details.isLoading = true;
    renderPage();
    expect(screen.getByTestId("repo-details-loading")).toBeInTheDocument();
  });
});
