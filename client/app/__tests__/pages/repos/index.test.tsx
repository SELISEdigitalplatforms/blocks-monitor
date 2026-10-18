import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { QueryWrapper } from "@/__tests__/test-utils";

const h = vi.hoisted(() => ({
  list: {
    data: { data: [] as unknown[] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  projectKey: "proj-1",
}));

vi.mock("@seliseblocks/genesis-os/store", () => ({
  useProjectStore: () => ({ selectedProject: { tenantId: h.projectKey } }),
}));
vi.mock("@seliseblocks/genesis-os/hooks", () => ({
  useScopedPath: () => (p: string) => `/scoped/${p}`,
}));
vi.mock("@seliseblocks/genesis-os/utils", () => ({
  formatDate: () => "Sep 29, 2026 15:30",
}));
vi.mock("@/hooks/use-alerts", () => ({
  useGetReposList: () => h.list,
}));

import ReposPage from "@/pages/repos";

function renderPage() {
  return render(
    <QueryWrapper>
      <MemoryRouter>
        <ReposPage />
      </MemoryRouter>
    </QueryWrapper>,
  );
}

describe("ReposPage", () => {
  beforeEach(() => {
    h.projectKey = "proj-1";
    h.list = { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
  });

  it("shows empty state (C7)", () => {
    renderPage();
    expect(screen.getByTestId("repos-empty")).toHaveTextContent("No repositories deployed yet");
  });

  it("shows loading skeleton (C6)", () => {
    h.list.isLoading = true;
    renderPage();
    expect(screen.getByTestId("repos-list-loading")).toBeInTheDocument();
  });

  it("shows error with retry (C6)", () => {
    h.list.isError = true;
    renderPage();
    expect(screen.getByTestId("page-error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("renders the list table for rows (H5)", () => {
    h.list.data = {
      data: [
        {
          itemId: "r1",
          repoName: "org/blocks-monitor",
          branch: "dev",
          lastDeploymentStatus: "Succeeded",
          lastDeploymentDate: "2026-09-29T09:30:00Z",
          customDeploymentUrl: "https://dev-monitor.example.com",
        },
      ],
    };
    renderPage();
    expect(screen.getByTestId("repos-list-table")).toBeInTheDocument();
    expect(screen.getByText("blocks-monitor")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /previous/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /next/i })).not.toBeInTheDocument();
  });

  it("issues no request messaging when no project (C10)", () => {
    h.projectKey = "";
    renderPage();
    expect(screen.getByText(/select a project/i)).toBeInTheDocument();
  });
});
