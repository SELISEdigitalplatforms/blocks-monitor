import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import IncidentList from "@/components/module/incident/incident-list";
import type { IncidentTree } from "@/models/alerts.model";

const wrapper =
  (search = "") =>
  ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={search}>{children}</NuqsTestingAdapter>
  );

const incident = (over: Partial<IncidentTree> = {}): IncidentTree =>
  ({
    monitorId: "m1",
    monitorName: "M",
    monitorUrl: "u",
    projectKey: "p",
    startTime: "2023-01-01T00:00:00Z",
    endTime: "2023-01-01T00:30:00Z",
    lastStatusCode: 500,
    isResolved: true,
    failureReason: null,
    responseBody: null,
    downtimeDurationSeconds: 3661,
    itemId: "i1",
    createdDate: "",
    lastUpdatedDate: "",
    createdBy: null,
    language: null,
    lastUpdatedBy: null,
    organizationIds: [],
    tags: [],
    ...over,
  }) as IncidentTree;

describe("IncidentList", () => {
  it("renders a loading skeleton while loading", () => {
    const { container } = render(<IncidentList isLoading data={[]} />, {
      wrapper: wrapper(),
    });
    expect(container.querySelectorAll("tbody tr").length).toBe(5);
  });

  it("shows an empty state when there are no incidents", () => {
    render(<IncidentList isLoading={false} data={[]} />, { wrapper: wrapper() });
    expect(screen.getByText("No results.")).toBeInTheDocument();
  });

  it("renders resolved and unresolved statuses", () => {
    render(
      <IncidentList
        isLoading={false}
        data={[incident({ isResolved: true }), incident({ isResolved: false, itemId: "i2" })]}
      />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText("Resolved")).toBeInTheDocument();
    expect(screen.getByText("Unresolved")).toBeInTheDocument();
  });

  it("parses a JSON failure reason into its error field", () => {
    render(
      <IncidentList
        isLoading={false}
        data={[incident({ failureReason: '{"error":"Timeout occurred"}' })]}
      />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText("Timeout occurred")).toBeInTheDocument();
  });

  it("falls back to the raw failure reason when it is not JSON", () => {
    render(
      <IncidentList
        isLoading={false}
        data={[incident({ failureReason: "Connection refused" })]}
      />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText("Connection refused")).toBeInTheDocument();
  });

  it("labels ongoing incidents when there is no end time", () => {
    render(
      <IncidentList
        isLoading={false}
        data={[incident({ endTime: null as unknown as string })]}
      />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText("Ongoing")).toBeInTheDocument();
  });

  it("formats the downtime duration", () => {
    render(
      <IncidentList
        isLoading={false}
        data={[incident({ downtimeDurationSeconds: 3661 })]}
      />,
      { wrapper: wrapper() },
    );
    // 3661s -> 1h 1m (first two non-zero units)
    expect(screen.getByText("1h 1m")).toBeInTheDocument();
  });

  it("renders the status code column when showLastStatus is set", () => {
    render(
      <IncidentList isLoading={false} showLastStatus data={[incident()]} />,
      { wrapper: wrapper() },
    );
    expect(screen.getByText("Status Code")).toBeInTheDocument();
    expect(screen.getByText("500")).toBeInTheDocument();
  });

  it("shows pagination and calls onPageChange", async () => {
    const onPageChange = vi.fn();
    render(
      <IncidentList
        isLoading={false}
        data={[incident()]}
        totalCount={30}
        pageSize={10}
        pageNumber={0}
        onPageChange={onPageChange}
      />,
      { wrapper: wrapper() },
    );
    await userEvent.click(screen.getByLabelText("Go to next page"));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("invokes onSortChange when a sort header is clicked", async () => {
    const onSortChange = vi.fn();
    render(
      <IncidentList
        isLoading={false}
        data={[incident()]}
        sortQueryParams={{ property: "status", isDescending: false }}
        onSortChange={onSortChange}
      />,
      { wrapper: wrapper() },
    );
    await userEvent.click(screen.getByText("Start time"));
    expect(onSortChange).toHaveBeenCalled();
  });
});
