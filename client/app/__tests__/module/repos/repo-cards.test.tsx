import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@seliseblocks/app-kit/utils", () => ({
  formatDate: () => "Sep 29, 2026 15:00",
}));

import { getRepoStatusTone, RepoStatusBadge } from "@/components/module/repos/repo-status-badge";
import { LatestBuildCard, NoBuildCard } from "@/components/module/repos/latest-build-card";
import { RepositoryCard } from "@/components/module/repos/repository-card";
import { ScaSummaryHeader, ScaSummaryTiles } from "@/components/module/repos/sca-summary";
import type { IBuild } from "@/models/repos.model";

const build: IBuild = {
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

describe("RepoStatusBadge", () => {
  it.each([
    ["Succeeded", "success"],
    ["EventFinished", "success"],
    ["Failed", "error"],
    ["Running", "running"],
    ["Queued", "running"],
    ["Pending", "pending"],
    ["SomethingElse", "pending"],
    ["NoBuild", "neutral"],
    [null, "neutral"],
  ])("maps %j to the %s tone", (status, tone) => {
    expect(getRepoStatusTone(status)).toBe(tone);
  });

  it("renders the status, or an explicit label, as a soft pill", () => {
    const { rerender } = render(<RepoStatusBadge status="Failed" testId="pill" />);
    expect(screen.getByTestId("pill")).toHaveTextContent("Failed");
    expect(screen.getByTestId("pill")).toHaveClass("rounded-full", "bg-rose-soft", "text-rose-ink");
    rerender(<RepoStatusBadge status="NoBuild" label="No build" testId="pill" />);
    expect(screen.getByTestId("pill")).toHaveTextContent("No build");
    rerender(<RepoStatusBadge testId="pill" />);
    expect(screen.getByTestId("pill")).toHaveTextContent("Unknown");
  });
});

describe("LatestBuildCard", () => {
  it("lists the build's fields with links to commit, deployment and pipeline", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<LatestBuildCard build={build} />);
    expect(screen.getByTestId("latest-build-card")).toHaveTextContent("Latest build");
    expect(screen.getByText("Succeeded")).toHaveAttribute("data-tone", "success");
    expect(screen.getByRole("link", { name: /a1b2c3d/ })).toHaveAttribute(
      "href",
      "https://github.com/org/blocks-monitor/commit/a1b2c3d4e5",
    );
    expect(screen.getByRole("link", { name: /dev\.example\.com/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /run-1/ })).toBeInTheDocument();
    expect(screen.getByText("3m 12s")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Copy build id" }));
    expect(writeText).toHaveBeenCalledWith("b1");
  });

  it("falls back to plain values when links are missing and shows a running build", () => {
    render(
      <LatestBuildCard
        build={{
          ...build,
          status: "Running",
          repoUrl: null,
          html_url: null,
          defaultDeploymentUrl: null,
          createdDate: "",
        }}
      />,
    );
    expect(screen.getByText("Running…")).toBeInTheDocument();
    expect(screen.getByText("a1b2c3d")).toBeInTheDocument();
    expect(screen.getByText("run-1")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders the no-build card", () => {
    render(<NoBuildCard />);
    expect(screen.getByTestId("no-build-card")).toHaveTextContent(
      "This repository has not been deployed yet",
    );
  });
});

describe("RepositoryCard", () => {
  it("shows repository fields and whether it is live", () => {
    const { rerender } = render(
      <RepositoryCard
        repo={{
          itemId: "r1",
          repoName: "org/blocks-monitor",
          repoUrl: "https://github.com/org/blocks-monitor",
          customDeploymentUrl: "https://custom.example.com",
          deployedNamespace: "ns",
          deploymentType: "Web app",
        }}
      />,
    );
    expect(screen.getByText("Web app")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /custom\.example\.com/ })).toBeInTheDocument();
    expect(screen.getByTestId("repo-live")).toHaveTextContent("Yes");
    rerender(<RepositoryCard repo={{ itemId: "r1", repoName: "org/blocks-monitor" }} />);
    expect(screen.getByTestId("repo-live")).toHaveTextContent("No");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("ScaSummary", () => {
  it("renders the header stats and toggles a severity tile", async () => {
    const onToggle = vi.fn();
    render(
      <>
        <ScaSummaryHeader details={{ components: "10", inheritedRiskScore: "" }} />
        <ScaSummaryTiles
          details={{ vulnerabilities: "3", critical: "1" }}
          activeSeverity="Critical"
          onToggleSeverity={onToggle}
        />
      </>,
    );
    expect(screen.getByTestId("sca-header")).toHaveTextContent("Total components10");
    expect(screen.getByTestId("sca-tile-total")).toHaveTextContent("3");
    expect(screen.getByTestId("sca-tile-critical")).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByTestId("sca-tile-high"));
    expect(onToggle).toHaveBeenCalledWith("High");
  });
});
