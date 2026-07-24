import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";

const h = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@seliseblocks/blocks-kit", () => ({
  useProjectStore: () => ({ selectedProject: { tenantId: "proj-1" } }),
}));
vi.mock("@seliseblocks/blocks-kit/hooks", () => ({
  useScopedPath: () => (p: string) => `/scoped/${p}`,
}));
vi.mock("react-router-dom", async (o) => {
  const actual = await o<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => h.navigate };
});
vi.mock("@/components/module/alert/alert-action", () => ({
  default: (props: { monitorSourceType?: number }) => (
    <button data-testid="alert-action" data-src={props.monitorSourceType} />
  ),
}));
vi.mock("@/components/module/alert/progress-bar", () => ({
  default: ({ status }: { status: boolean }) => (
    <div data-testid="progress" data-status={String(status)} />
  ),
}));

import { AlertsList } from "@/components/module/alert/alerts-list";
import type { AlertTree } from "@/models/alerts.model";

const wrapper =
  (search = "") =>
  ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={search}>{children}</NuqsTestingAdapter>
  );

const alert = (over: Partial<AlertTree> = {}): AlertTree =>
  ({
    itemId: "a1",
    name: "My Monitor",
    operationName: "op",
    monitorConfigurationType: 0,
    url: "https://svc.example.com",
    repoName: "repo-1",
    externalServiceName: "",
    lastIncidentAt: new Date("2023-01-01T00:00:00Z"),
    createdDate: "2023-01-01T00:00:00Z",
    currentStatus: true,
    isActive: true,
    incidentSummaries: [],
    monitorSourceType: 1,
    request: { url: "https://req.example.com" },
    ...over,
  }) as unknown as AlertTree;

const sort = { property: "name", isDescending: false };

describe("AlertsList", () => {
  it("renders a loading skeleton", () => {
    render(<AlertsList data={[]} isLoading sortQueryParams={sort} onSortChange={vi.fn()} />, {
      wrapper: wrapper(),
    });
    // While loading, the component swaps the table body for the skeleton and
    // never falls through to the empty state.
    expect(screen.getByTestId("table-loading-skeleton")).toBeInTheDocument();
    expect(screen.queryByText("No results.")).toBeNull();
  });

  it("renders an empty state", () => {
    render(
      <AlertsList data={[]} isLoading={false} sortQueryParams={sort} onSortChange={vi.fn()} />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText("No results.")).toBeInTheDocument();
  });

  it("renders monitor rows with type, url, and tagged service", () => {
    render(
      <AlertsList
        data={[alert()]}
        isLoading={false}
        sortQueryParams={sort}
        onSortChange={vi.fn()}
      />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText("My Monitor")).toBeInTheDocument();
    expect(screen.getByText("HTTP Check")).toBeInTheDocument();
    expect(screen.getByText("https://svc.example.com")).toBeInTheDocument();
    expect(screen.getByText("repo-1")).toBeInTheDocument();
    expect(screen.getByTestId("progress")).toHaveAttribute("data-status", "true");
  });

  it("shows 'Callback' for configuration type 1 and hides actions for BlocksServices", () => {
    render(
      <AlertsList
        data={[alert({ monitorConfigurationType: 1, monitorSourceType: 2 })]}
        isLoading={false}
        sortQueryParams={sort}
        onSortChange={vi.fn()}
      />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText("Heartbeat")).toBeInTheDocument();
    expect(screen.queryByTestId("alert-action")).toBeNull();
  });

  it("navigates to the monitor detail when a row is clicked", async () => {
    render(
      <AlertsList
        data={[alert({ itemId: "row-1" })]}
        isLoading={false}
        sortQueryParams={sort}
        onSortChange={vi.fn()}
      />,
      { wrapper: wrapper() },
    );
    await userEvent.click(screen.getByText("My Monitor"));
    expect(h.navigate).toHaveBeenCalledWith("/scoped/monitor/row-1");
  });

  it("hides the tagged-service column when the tab is not 'all'", () => {
    render(
      <AlertsList
        data={[alert()]}
        isLoading={false}
        sortQueryParams={sort}
        onSortChange={vi.fn()}
      />,
      { wrapper: wrapper("?tab=services") },
    );
    expect(screen.queryByText("Tagged Service")).toBeNull();
  });

  it("fires onSortChange when a header is clicked", async () => {
    const onSortChange = vi.fn();
    render(
      <AlertsList
        data={[alert()]}
        isLoading={false}
        sortQueryParams={sort}
        onSortChange={onSortChange}
      />,
      { wrapper: wrapper() },
    );
    await userEvent.click(screen.getByText("URL"));
    expect(onSortChange).toHaveBeenCalled();
  });

  it("falls back to operationName and request.url when primary fields are empty", () => {
    render(
      <AlertsList
        data={[alert({ name: "", url: "", repoName: "", externalServiceName: "ext-svc" })]}
        isLoading={false}
        sortQueryParams={sort}
        onSortChange={vi.fn()}
      />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText("op")).toBeInTheDocument();
    expect(screen.getByText("https://req.example.com")).toBeInTheDocument();
    expect(screen.getByText("ext-svc")).toBeInTheDocument();
  });

  it("renders a down arrow when the current status is false", () => {
    const { container } = render(
      <AlertsList
        data={[alert({ currentStatus: false })]}
        isLoading={false}
        sortQueryParams={sort}
        onSortChange={vi.fn()}
      />,
      { wrapper: wrapper() },
    );
    expect(container.querySelector("svg.lucide-arrow-down")).toBeTruthy();
  });
});
