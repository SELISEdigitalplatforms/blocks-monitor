import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";

const h = vi.hoisted(() => ({
  healthData: {
    data: { data: [{ itemId: "a1" }], totalCount: 25 },
    isLoading: false,
  },
}));

vi.mock("@seliseblocks/blocks-kit/store", () => ({
  useProjectStore: () => ({ selectedProject: { tenantId: "proj-1" } }),
}));
vi.mock("@/hooks/use-alerts", () => ({
  useGetHealthMonitorList: () => h.healthData,
}));
vi.mock("@/components/module/alert/alerts-list", () => ({
  AlertsList: (props: { data: unknown[]; isLoading: boolean }) => (
    <div
      data-testid="alerts-list"
      data-count={props.data.length}
      data-loading={String(props.isLoading)}
    />
  ),
}));
vi.mock("@/components/module/monitor/form/add-monitor-form", () => ({
  AddSingleMonitorForm: () => <div data-testid="add-monitor-form" />,
}));

import HealthPage from "@/pages/health";

const renderPage = () =>
  render(
    <NuqsTestingAdapter>
      <HealthPage />
    </NuqsTestingAdapter>,
  );

describe("HealthPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.healthData = {
      data: { data: [{ itemId: "a1" }], totalCount: 25 },
      isLoading: false,
    };
  });

  it("renders the heading, tabs, and API docs link", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Health" })).toBeInTheDocument();
    expect(screen.getAllByText("My monitors").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Blocks services").length).toBeGreaterThan(0);
    const docsLink = screen.getByRole("link", { name: /API Docs/ });
    expect(docsLink).toHaveAttribute("href", "/swagger/index.html");
  });

  it("passes fetched monitors down to the AlertsList", () => {
    renderPage();
    const list = screen.getByTestId("alerts-list");
    expect(list).toHaveAttribute("data-count", "1");
    expect(list).toHaveAttribute("data-loading", "false");
  });

  it("shows pagination derived from the total count", () => {
    renderPage();
    // 25 items / pageSize 10 -> 3 pages
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
  });

  it("opens the add-monitor modal when the button is clicked", async () => {
    renderPage();
    expect(screen.queryByTestId("add-monitor-form")).toBeNull();
    await userEvent.click(screen.getByTestId("add-monitor-button"));
    expect(await screen.findByTestId("add-monitor-form")).toBeInTheDocument();
  });

  it("reflects a loading state to the list", () => {
    h.healthData = { data: { data: [], totalCount: 0 }, isLoading: true };
    renderPage();
    expect(screen.getByTestId("alerts-list")).toHaveAttribute(
      "data-loading",
      "true",
    );
  });

  it("switches tabs via the desktop tab triggers", async () => {
    renderPage();
    const servicesTab = screen.getAllByText("Blocks services")[0];
    await userEvent.click(servicesTab);
    // AlertsList still rendered after the tab change
    expect(screen.getByTestId("alerts-list")).toBeInTheDocument();
  });
});
