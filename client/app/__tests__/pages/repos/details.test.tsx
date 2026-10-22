import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  events: [
    {
      id: "e1",
      buildId: "b1",
      eventType: "EventStarted",
      eventGroup: "Clone",
      message: "",
      createdAt: "2026-09-29T09:00:00Z",
    },
    {
      id: "e2",
      buildId: "b1",
      eventType: "Log",
      eventGroup: "Clone",
      message: "Clone complete.",
      createdAt: "2026-09-29T09:00:01Z",
    },
    {
      id: "e3",
      buildId: "b1",
      eventType: "EventFinished",
      eventGroup: "Clone",
      message: "",
      createdAt: "2026-09-29T09:00:02Z",
    },
  ],
};

vi.mock("@seliseblocks/app-kit/store", () => ({
  useProjectStore: () => ({ selectedProject: { tenantId: "proj-1" } }),
}));
vi.mock("@seliseblocks/app-kit/hooks", () => ({
  useScopedPath: () => (p: string) => `/scoped/${p}`,
}));
vi.mock("@seliseblocks/app-kit/utils", () => ({
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
        <MemoryRouter initialEntries={[`/repo/r1${search}`]}>
          <Routes>
            <Route path="/repo/:repoId" element={<RepoDetailsPage />} />
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

  it("renders BR-style deployment logs and general information (H8)", () => {
    renderPage();
    expect(screen.getByLabelText("Back to Repos")).toBeInTheDocument();
    expect(screen.queryByText("Repos")).not.toBeInTheDocument();
    expect(screen.getByTestId("deployment-general-info")).toHaveTextContent("General information");
    expect(screen.getByTestId("deployment-logs-card")).toHaveTextContent("Deployment logs");
    expect(screen.getByText("Clone complete.")).toBeInTheDocument();
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
  it("renders the console-style header: back link, repo name link and branch chip", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "blocks-monitor" })).toBeInTheDocument();
    expect(screen.getByLabelText("Back to Repos")).toHaveAttribute("href", "/scoped/repos");
    expect(screen.getByRole("link", { name: "org/blocks-monitor" })).toHaveAttribute(
      "href",
      "https://github.com/org/blocks-monitor",
    );
    expect(screen.getByTestId("repo-branch")).toHaveTextContent("dev");
  });

  it("shows tabs as underline tabs plus a labelled select for small screens", () => {
    renderPage();
    expect(screen.getByRole("tab", { name: "Deployment Logs" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "SAST" })).toBeEnabled();
    expect(screen.getByRole("combobox", { name: "Repository section" })).toBeInTheDocument();
  });

  it("opens the tab named in the URL when a build exists", () => {
    renderPage("?tab=sca");
    expect(screen.getByRole("tab", { name: "SCA" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("report-no-data")).toBeInTheDocument();
  });

  it("lays out general information as a details field grid", () => {
    renderPage();
    const info = screen.getByTestId("deployment-general-info");
    expect(within(info).getByText("Repo URL")).toBeInTheDocument();
    expect(within(info).getByText("Succeeded")).toHaveAttribute("data-tone", "success");
    expect(within(info).getByRole("link", { name: "https://dev.example.com" })).toHaveAttribute(
      "href",
      "https://dev.example.com",
    );
    // No custom URL on this build.
    expect(within(info).getByText("N/A")).toBeInTheDocument();
  });

  it("copies a URL from the general information", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Copy repo URL" }));
    expect(writeText).toHaveBeenCalledWith("https://github.com/org/blocks-monitor");
  });

  it("expands and collapses a pipeline step's logs", async () => {
    renderPage();
    const step = screen.getByRole("button", { name: /clone/i });
    expect(step).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Clone complete.")).toBeInTheDocument();
    await userEvent.click(step);
    expect(step).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Clone complete.")).not.toBeInTheDocument();
    expect(screen.getByTestId("deployment-logs-summary")).toHaveTextContent("Successful at push");
  });

  it("shows the logs empty state when a build has no events", () => {
    h.details.data.data.build = [{ ...sampleBuild, events: [] }];
    renderPage();
    expect(screen.getByTestId("deployment-logs-card")).toHaveTextContent(
      "No deployment logs available for this build.",
    );
  });

  it("offers a way back from the not-found state", () => {
    h.details.isError = true;
    h.details.error = { status: 404 };
    renderPage();
    expect(screen.getByRole("link", { name: /back to repos/i })).toHaveAttribute(
      "href",
      "/scoped/repos",
    );
  });
});
