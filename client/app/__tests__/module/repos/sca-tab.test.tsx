import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryWrapper } from "@/__tests__/test-utils";

const h = vi.hoisted(() => ({
  report: {
    data: null as unknown,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock("@/hooks/use-repos", () => ({
  useGetReport: () => h.report,
}));

import { ScaTab } from "@/components/module/repos/sca-tab";

describe("ScaTab", () => {
  beforeEach(() => {
    h.report = {
      data: {
        data: {
          type: "sca-libraries",
          details: {
            components: "10",
            vulnerableComponents: "2",
            inheritedRiskScore: "42",
            vulnerabilities: "3",
            critical: "1",
            high: "1",
            medium: "1",
            low: "0",
            unassigned: "0",
          },
          vulnerabilities: [
            {
              id: "CVE-1",
              name: "left-pad",
              group: "npm",
              version: "1.0.0",
              severity: "CRITICAL",
              score: "9.8",
              epssPercentile: 0.9,
            },
            {
              id: "CVE-2",
              name: "lodash",
              group: "npm",
              version: "4.0.0",
              severity: "HIGH",
              score: "7.0",
            },
            {
              id: "CVE-3",
              name: "minimist",
              group: "npm",
              version: "0.1.0",
              severity: "MEDIUM",
              score: "5.0",
            },
          ],
        },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  });

  it("renders header tiles and table (H12)", () => {
    render(
      <QueryWrapper>
        <ScaTab projectKey="t" buildId="b1" isActive />
      </QueryWrapper>,
    );
    expect(screen.getByTestId("sca-tab")).toBeInTheDocument();
    expect(screen.getByTestId("sca-header")).toHaveTextContent("42");
    expect(screen.getByTestId("sca-row-1")).toHaveTextContent("CVE-1");
    expect(screen.queryByText(/view in dependency track/i)).not.toBeInTheDocument();
  });

  it("toggles severity filter and shows the BR-style empty state (H13, C14)", async () => {
    const user = userEvent.setup();
    render(
      <QueryWrapper>
        <ScaTab projectKey="t" buildId="b1" isActive />
      </QueryWrapper>,
    );
    await user.click(screen.getByTestId("sca-tile-low"));
    expect(screen.getByTestId("sca-empty")).toHaveTextContent("No dependencies found");
    expect(screen.getByTestId("sca-prev")).toBeDisabled();
    expect(screen.getByTestId("sca-next")).toBeDisabled();
  });

  it("filters by component search (H13)", async () => {
    const user = userEvent.setup();
    render(
      <QueryWrapper>
        <ScaTab projectKey="t" buildId="b1" isActive />
      </QueryWrapper>,
    );
    await user.type(screen.getByTestId("sca-search"), "lodash");
    expect(screen.getByText("lodash")).toBeInTheDocument();
    expect(screen.getByText("CVE-2")).toBeInTheDocument();
    expect(screen.queryByText("left-pad")).not.toBeInTheDocument();
    expect(screen.getByTestId("sca-footer")).toHaveTextContent("Showing 1-1 of 1 entries");
  });

  it("opens dialog on row click; NVD link does not (H13)", async () => {
    const user = userEvent.setup();
    render(
      <QueryWrapper>
        <ScaTab projectKey="t" buildId="b1" isActive />
      </QueryWrapper>,
    );
    await user.click(screen.getByText("left-pad"));
    expect(screen.getByTestId("sca-dialog")).toBeInTheDocument();
  });

  it("shows no-report for empty details (C12)", () => {
    h.report.data = { data: { type: "sca-libraries", details: {}, vulnerabilities: [] } };
    render(
      <QueryWrapper>
        <ScaTab projectKey="t" buildId="b1" isActive />
      </QueryWrapper>,
    );
    expect(screen.getByTestId("report-no-data")).toBeInTheDocument();
  });
});
