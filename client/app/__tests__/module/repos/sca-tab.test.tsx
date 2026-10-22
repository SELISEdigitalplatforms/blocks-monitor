import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
    expect(screen.getByTestId("sca-tile-low")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("sca-empty")).toHaveTextContent("No dependencies found");
    // Nothing to page through: the footer is left out rather than captioned "0 of 0".
    expect(screen.queryByTestId("sca-footer")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sca-prev")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("sca-tile-low"));
    expect(screen.getByTestId("sca-tile-low")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("sca-row-1")).toBeInTheDocument();
  });

  it("pages through more than five dependencies", async () => {
    const user = userEvent.setup();
    const report = h.report.data as {
      data: { vulnerabilities: Array<Record<string, unknown>> };
    };
    report.data.vulnerabilities = Array.from({ length: 7 }, (_, index) => ({
      id: `CVE-${index + 1}`,
      name: `pkg-${index + 1}`,
      group: "npm",
      version: "1.0.0",
      severity: "LOW",
      score: "1.0",
    }));
    render(
      <QueryWrapper>
        <ScaTab projectKey="t" buildId="b1" isActive />
      </QueryWrapper>,
    );
    expect(screen.getByTestId("sca-footer")).toHaveTextContent("Showing 1-5 of 7 entries");
    expect(screen.getByTestId("sca-prev")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByTestId("sca-next"));
    expect(screen.getByTestId("sca-footer")).toHaveTextContent("Showing 6-7 of 7 entries");
    expect(screen.getByTestId("sca-next")).toBeDisabled();
    await user.click(screen.getByTestId("sca-prev"));
    expect(screen.getByTestId("sca-footer")).toHaveTextContent("Showing 1-5 of 7 entries");
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

  it("opens the dialog from the keyboard on a focused row", () => {
    render(
      <QueryWrapper>
        <ScaTab projectKey="t" buildId="b1" isActive />
      </QueryWrapper>,
    );
    const row = screen.getByTestId("sca-row-1");
    expect(row).toHaveAttribute("role", "button");
    expect(row).toHaveAttribute("tabindex", "0");
    fireEvent.keyDown(row, { key: "Tab" });
    expect(screen.queryByTestId("sca-dialog")).not.toBeInTheDocument();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(screen.getByTestId("sca-dialog")).toHaveTextContent("left-pad");
  });

  it("does not open the dialog from the NVD link", () => {
    render(
      <QueryWrapper>
        <ScaTab projectKey="t" buildId="b1" isActive />
      </QueryWrapper>,
    );
    const link = screen.getByRole("link", { name: "CVE-1" });
    expect(link).toHaveAttribute("href", "https://nvd.nist.gov/vuln/detail/CVE-1");
    fireEvent.click(link);
    expect(screen.queryByTestId("sca-dialog")).not.toBeInTheDocument();
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
