import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";

const h = vi.hoisted(() => ({
  healthData: {
    data: { data: [{ itemId: "a1" }], totalCount: 25 },
    isLoading: false,
  },
  isError: false,
  refetch: vi.fn(),
}));

vi.mock("@seliseblocks/app-kit/store", () => ({
  useProjectStore: () => ({ selectedProject: { tenantId: "proj-1" } }),
}));
// getRuntimeEnv falls through to `import.meta.env`, which is not injected into
// the externalized blocks-kit dependency under vitest (it throws). The page
// only uses it to prefix the API-docs URL, so resolve it to an empty string;
// the assertion below expects the bare "/swagger/index.html" path.
vi.mock("@seliseblocks/app-kit/lib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@seliseblocks/app-kit/lib")>();
  return { ...actual, getRuntimeEnv: () => "" };
});
vi.mock("@/hooks/use-alerts", () => ({
  useGetHealthMonitorList: () => ({ ...h.healthData, isError: h.isError, refetch: h.refetch }),
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

import MonitorPage from "@/pages/monitor";

const renderPage = () =>
  render(
    <NuqsTestingAdapter>
      <MonitorPage />
    </NuqsTestingAdapter>,
  );

describe("MonitorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.healthData = {
      data: { data: [{ itemId: "a1" }], totalCount: 25 },
      isLoading: false,
    };
    h.isError = false;
  });

  it("renders the heading, tabs, and API docs link", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Monitor" })).toBeInTheDocument();
    expect(screen.getAllByText("My monitors").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Blocks services").length).toBeGreaterThan(0);
    const docsLink = screen.getByRole("link", { name: /API Docs/ });
    expect(docsLink).toHaveAttribute("href", "/swagger/index.html");
  });

  it("renders the page description and both header actions", () => {
    renderPage();
    expect(
      screen.getByText("Track uptime and health checks across your services."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("add-monitor-button")).toHaveTextContent("Add Monitor");
  });

  it("shows an error with a retry in place of the list and pagination", async () => {
    h.isError = true;
    renderPage();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load monitors.");
    expect(screen.queryByTestId("alerts-list")).toBeNull();
    expect(screen.queryByText(/Page 1 of/)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
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
    expect(screen.getByTestId("alerts-list")).toHaveAttribute("data-loading", "true");
  });

  it("switches tabs via the desktop tab triggers", async () => {
    renderPage();
    const servicesTab = screen.getAllByText("Blocks services")[0];
    await userEvent.click(servicesTab);
    // AlertsList still rendered after the tab change
    expect(screen.getByTestId("alerts-list")).toBeInTheDocument();
  });
});
