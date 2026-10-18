import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { NuqsTestingAdapter, type UrlUpdateEvent } from "nuqs/adapters/testing";
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

vi.mock("@seliseblocks/app-kit/store", () => ({
  useProjectStore: () => ({ selectedProject: { tenantId: h.projectKey } }),
}));
vi.mock("@seliseblocks/app-kit/hooks", () => ({
  useScopedPath: () => (p: string) => `/scoped/${p}`,
}));
vi.mock("@seliseblocks/app-kit/utils", () => ({
  formatDate: (date: Date) => `formatted:${date.toISOString().slice(0, 10)}`,
}));
vi.mock("@/hooks/use-alerts", () => ({
  useGetReposList: () => h.list,
}));

import ReposPage from "@/pages/repos";

const ROWS = [
  {
    itemId: "r1",
    repoName: "org/blocks-monitor",
    branch: "dev",
    lastDeploymentStatus: "Succeeded",
    lastDeploymentDate: "2026-09-29T09:30:00Z",
    customDeploymentUrl: "https://dev-monitor.example.com",
  },
  {
    itemId: "r2",
    repoName: "org/blocks-console",
    branch: "main",
    lastDeploymentStatus: "Failed",
    lastDeploymentDate: "2026-10-01T09:30:00Z",
    defaultDeploymentUrl: "https://console.example.com",
  },
  {
    itemId: "r3",
    repoName: "org/never-built",
  },
];

function renderPage(search = "", onUrlUpdate?: (event: UrlUpdateEvent) => void) {
  return render(
    <QueryWrapper>
      <NuqsTestingAdapter searchParams={search} onUrlUpdate={onUrlUpdate} hasMemory>
        <MemoryRouter initialEntries={["/repos"]}>
          <Routes>
            <Route path="/repos" element={<ReposPage />} />
            <Route path="/scoped/repo/:repoId" element={<p data-testid="details-route" />} />
          </Routes>
        </MemoryRouter>
      </NuqsTestingAdapter>
    </QueryWrapper>,
  );
}

function rowIds() {
  return screen.getAllByTestId(/^repo-row-/).map((row) => row.dataset.testid);
}

describe("ReposPage", () => {
  beforeEach(() => {
    h.projectKey = "proj-1";
    h.list = { data: { data: [] }, isLoading: false, isError: false, refetch: vi.fn() };
  });

  it("renders the page header", () => {
    renderPage();
    expect(screen.getByRole("heading", { level: 1, name: "Repos" })).toBeInTheDocument();
  });

  it("shows the in-card empty state (C7)", () => {
    renderPage();
    const card = screen.getByTestId("repos-list-table");
    expect(within(card).getByTestId("repos-empty")).toHaveTextContent(
      "No repositories deployed yet",
    );
    expect(screen.queryByRole("textbox", { name: "Search repositories" })).not.toBeInTheDocument();
  });

  it("shows skeleton rows while loading (C6)", () => {
    h.list.isLoading = true;
    renderPage();
    expect(
      within(screen.getByTestId("repos-list-table")).getByTestId("repos-list-loading"),
    ).toBeInTheDocument();
  });

  it("shows error with retry (C6)", async () => {
    h.list.isError = true;
    renderPage();
    expect(screen.getByTestId("page-error")).toBeInTheDocument();
    expect(screen.queryByTestId("repos-list-table")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(h.list.refetch).toHaveBeenCalled();
  });

  it("renders the list table for rows (H5)", () => {
    h.list.data = { data: ROWS };
    renderPage();
    const card = screen.getByTestId("repos-list-table");
    expect(within(card).getByRole("table", { name: "Repositories" })).toBeInTheDocument();
    expect(screen.getByText("blocks-monitor")).toBeInTheDocument();
    expect(screen.getByText("org/blocks-monitor")).toBeInTheDocument();
    expect(screen.getByText("dev")).toBeInTheDocument();
    expect(screen.getByText("dev-monitor.example.com")).toBeInTheDocument();
    expect(screen.getByText("formatted:2026-09-29")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /previous/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /next/i })).not.toBeInTheDocument();
  });

  it("shows soft status pills, with 'No build' for a repo without a build", () => {
    h.list.data = { data: ROWS };
    renderPage();
    expect(within(screen.getByTestId("repo-row-r1")).getByText("Succeeded")).toHaveAttribute(
      "data-tone",
      "success",
    );
    expect(within(screen.getByTestId("repo-row-r2")).getByText("Failed")).toHaveAttribute(
      "data-tone",
      "error",
    );
    expect(within(screen.getByTestId("repo-row-r3")).getByText("No build")).toHaveAttribute(
      "data-tone",
      "neutral",
    );
  });

  it("puts the deployment link in the row actions column", () => {
    h.list.data = { data: ROWS };
    renderPage();
    const link = screen.getByRole("link", { name: "Open blocks-monitor deployment" });
    expect(link).toHaveAttribute("href", "https://dev-monitor.example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("title", "Open blocks-monitor deployment");
    expect(within(screen.getByTestId("repo-row-r3")).queryByRole("link")).not.toBeInTheDocument();
  });

  it("does not open the row when its action link is used", () => {
    h.list.data = { data: ROWS };
    renderPage();
    const link = screen.getByRole("link", { name: "Open blocks-monitor deployment" });
    fireEvent.click(link);
    fireEvent.keyDown(link, { key: "Enter" });
    expect(screen.queryByTestId("details-route")).not.toBeInTheDocument();
  });

  it("navigates to the scoped detail page on row click", async () => {
    h.list.data = { data: ROWS };
    renderPage();
    await userEvent.click(screen.getByText("blocks-monitor"));
    expect(screen.getByTestId("details-route")).toBeInTheDocument();
  });

  it.each(["Enter", " "])("rows are keyboard-reachable and open on %j", (key) => {
    h.list.data = { data: ROWS };
    renderPage();
    const row = screen.getByTestId("repo-row-r2");
    expect(row).toHaveAttribute("role", "button");
    expect(row).toHaveAttribute("tabindex", "0");
    row.focus();
    expect(row).toHaveFocus();
    fireEvent.keyDown(row, { key });
    expect(screen.getByTestId("details-route")).toBeInTheDocument();
  });

  it("ignores other keys on a row", () => {
    h.list.data = { data: ROWS };
    renderPage();
    fireEvent.keyDown(screen.getByTestId("repo-row-r2"), { key: "a" });
    expect(screen.queryByTestId("details-route")).not.toBeInTheDocument();
  });

  it("sorts by newest deployment by default and toggles via the URL", async () => {
    h.list.data = { data: ROWS };
    const onUrlUpdate = vi.fn();
    renderPage("", onUrlUpdate);
    expect(rowIds()).toEqual(["repo-row-r2", "repo-row-r1", "repo-row-r3"]);
    expect(screen.getByRole("columnheader", { name: /last deployment/i })).toHaveAttribute(
      "aria-sort",
      "descending",
    );

    await userEvent.click(screen.getByTestId("sort-last-deployment"));
    await waitFor(() => expect(rowIds()).toEqual(["repo-row-r3", "repo-row-r1", "repo-row-r2"]));
    expect(screen.getByRole("columnheader", { name: /last deployment/i })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    const lastUrl = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent;
    expect(lastUrl.searchParams.get("isDescending")).toBe("false");
  });

  it("reads the sort direction from the URL", () => {
    h.list.data = { data: ROWS };
    renderPage("?isDescending=false");
    expect(rowIds()).toEqual(["repo-row-r3", "repo-row-r1", "repo-row-r2"]);
    expect(screen.getByLabelText("Sort repositories by newest deployment")).toBeInTheDocument();
  });

  it("filters rows from the toolbar search and stores the query in the URL", async () => {
    h.list.data = { data: ROWS };
    const onUrlUpdate = vi.fn();
    renderPage("", onUrlUpdate);
    // The real SearchInput keeps its own draft and debounces; the stub reports straight through.
    fireEvent.change(screen.getByRole("textbox", { name: "Search repositories" }), {
      target: { value: "console" },
    });
    await waitFor(() => expect(rowIds()).toEqual(["repo-row-r2"]));
    const lastUrl = onUrlUpdate.mock.calls.at(-1)?.[0] as UrlUpdateEvent;
    expect(lastUrl.searchParams.get("search")).toBe("console");
  });

  it("shows the no-match state for a search from the URL", () => {
    h.list.data = { data: ROWS };
    renderPage("?search=nothing-like-this");
    expect(screen.getByTestId("repos-no-match")).toHaveTextContent(
      "No repositories match your search.",
    );
    expect(screen.getByRole("textbox", { name: "Search repositories" })).toHaveValue(
      "nothing-like-this",
    );
  });

  it("issues no request messaging when no project (C10)", () => {
    h.projectKey = "";
    renderPage();
    expect(screen.getByText(/select a project/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Search repositories" })).not.toBeInTheDocument();
  });
});
