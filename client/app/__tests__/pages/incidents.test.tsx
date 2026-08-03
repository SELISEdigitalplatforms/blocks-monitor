import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { MemoryRouter, Routes, Route } from "react-router";

const h = vi.hoisted(() => ({
  navigate: vi.fn(),
  incidentData: {
    data: {
      data: [] as unknown[],
      totalCount: 0,
    },
    isLoading: false,
  },
}));

vi.mock("@/hooks/use-alerts", () => ({
  useGetAllIncidentList: () => h.incidentData,
}));
vi.mock("react-router", async (o) => {
  const actual = await o<typeof import("react-router")>();
  return { ...actual, useNavigate: () => h.navigate };
});

import IncidentPage from "@/pages/incidents";

const renderPage = () =>
  render(
    <NuqsTestingAdapter>
      <MemoryRouter initialEntries={["/app/monitor/incidents/m1"]}>
        <Routes>
          <Route path="/app/monitor/incidents/:id" element={<IncidentPage />} />
        </Routes>
      </MemoryRouter>
    </NuqsTestingAdapter>,
  );

describe("IncidentPage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the incidents heading and an empty list", () => {
    renderPage();
    expect(screen.getByText("Incidents")).toBeInTheDocument();
    expect(screen.getByText("No results.")).toBeInTheDocument();
  });

  it("navigates back when the back button is clicked", async () => {
    renderPage();
    const backBtn = screen.getAllByRole("button")[0];
    await userEvent.click(backBtn);
    expect(h.navigate).toHaveBeenCalledWith(-1);
  });

  it("renders incident rows when data is present", () => {
    h.incidentData = {
      data: {
        data: [
          {
            monitorId: "m1",
            startTime: "2023-01-01T00:00:00Z",
            endTime: "2023-01-01T00:10:00Z",
            isResolved: false,
            failureReason: "boom",
            downtimeDurationSeconds: 600,
            itemId: "i1",
          },
        ],
        totalCount: 1,
      },
      isLoading: false,
    };
    renderPage();
    expect(screen.getByText("Unresolved")).toBeInTheDocument();
  });
});
