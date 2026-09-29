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

import { SastTab } from "@/components/module/repos/sast-tab";

describe("SastTab", () => {
  beforeEach(() => {
    h.report = { data: null, isLoading: false, isError: false, refetch: vi.fn() };
  });

  it("shows loading (C6)", () => {
    h.report.isLoading = true;
    render(
      <QueryWrapper>
        <SastTab projectKey="t" buildId="b1" isActive />
      </QueryWrapper>,
    );
    expect(screen.getByTestId("report-loading")).toBeInTheDocument();
  });

  it("shows no-report for null/empty details (C12)", () => {
    h.report.data = { data: null };
    const { rerender } = render(
      <QueryWrapper>
        <SastTab projectKey="t" buildId="b1" isActive />
      </QueryWrapper>,
    );
    expect(screen.getByTestId("report-no-data")).toHaveTextContent(
      "No report available for this build",
    );
    h.report.data = { data: { type: "sast", details: {}, vulnerabilities: null } };
    rerender(
      <QueryWrapper>
        <SastTab projectKey="t" buildId="b1" isActive />
      </QueryWrapper>,
    );
    expect(screen.getByTestId("report-no-data")).toBeInTheDocument();
  });

  it("renders mapped BR-style new-code metrics and can switch to overall code (H11, C13)", async () => {
    const user = userEvent.setup();
    h.report.data = {
      data: {
        type: "sast",
        details: {
          alert_status: "OK",
          ncloc: "1200",
          security_rating: "1.0",
          bugs: "3",
          reliability_rating: "2.0",
          code_smells: "10",
          sqale_rating: "3.0",
          security_hotspots: "2",
          accepted_issues: "1",
          coverage: "80.5",
          lines_to_cover: "100",
          duplicated_lines_density: "4.0",
          duplicated_lines: "40",
          new_technical_debt: "12",
        },
        vulnerabilities: null,
      },
    };
    render(
      <QueryWrapper>
        <SastTab projectKey="t" buildId="b1" isActive />
      </QueryWrapper>,
    );
    expect(screen.getByTestId("sast-quality-gate")).toHaveTextContent("Passed");
    expect(screen.getByTestId("sast-ncloc")).toHaveTextContent("1,200");
    expect(screen.getByTestId("sast-reliability")).toHaveTextContent("3");
    expect(screen.getByTestId("grade-A")).toBeInTheDocument();
    expect(screen.getByText("New Code")).toBeInTheDocument();

    await user.click(screen.getByText("Overall Code"));
    expect(screen.getByTestId("grade-B")).toBeInTheDocument();
    expect(screen.getByTestId("sast-new-debt")).toHaveTextContent("12 min");
    expect(screen.queryByText(/view in sonarqube/i)).not.toBeInTheDocument();
  });

  it("shows placeholders for absent rating keys (C13)", async () => {
    const user = userEvent.setup();
    h.report.data = {
      data: {
        type: "sast",
        details: { alert_status: "ERROR", ncloc: "10" },
        vulnerabilities: null,
      },
    };
    render(
      <QueryWrapper>
        <SastTab projectKey="t" buildId="b1" isActive />
      </QueryWrapper>,
    );
    expect(screen.getByTestId("sast-quality-gate")).toHaveTextContent("Failed");
    expect(screen.queryByTestId("grade-A")).not.toBeInTheDocument();

    await user.click(screen.getByText("Overall Code"));
    expect(screen.getByTestId("sast-security")).toHaveTextContent("-");
  });

  it("shows error card on failure (C16 SPA path)", () => {
    h.report.isError = true;
    render(
      <QueryWrapper>
        <SastTab projectKey="t" buildId="b1" isActive />
      </QueryWrapper>,
    );
    expect(screen.getByTestId("report-error")).toBeInTheDocument();
  });
});
