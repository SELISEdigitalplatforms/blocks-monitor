import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProgressBar from "@/components/module/alert/progress-bar";
import MonitorCard from "@/components/module/monitor/details/monitor-card";

describe("ProgressBar", () => {
  it("shows 100% when there are no incidents and status is up", () => {
    const { container } = render(<ProgressBar incidents={[]} status={true} />);
    expect(screen.getByText("100%")).toBeInTheDocument();
    // 24 hourly bars are rendered
    expect(container.querySelectorAll(".h-6").length).toBe(24);
  });

  it("shows 0% when there are no incidents and status is down", () => {
    render(<ProgressBar incidents={[]} status={false} />);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("reflects downtime from an ongoing incident (null endTime)", () => {
    const now = Date.now();
    const incidents = [
      {
        startTime: new Date(now - 60 * 60 * 1000).toISOString(),
        endTime: null as unknown as string,
      },
    ];
    render(<ProgressBar incidents={incidents} status={false} />);
    // progress is < 100 because some slots have downtime
    const pct = Number(screen.getByText(/%$/).textContent!.replace("%", ""));
    expect(pct).toBeLessThan(100);
  });

  it("reveals a tooltip on hover", () => {
    const { container } = render(
      <ProgressBar incidents={[]} status={true} />,
    );
    const bar = container.querySelector(".h-6")!;
    fireEvent.mouseEnter(bar);
    expect(screen.getByText(/Up/)).toBeInTheDocument();
    fireEvent.mouseLeave(bar);
  });
});

describe("MonitorCard", () => {
  const baseProps = {
    onOpenChange: vi.fn(),
    url: "https://svc.example.com",
    request: true,
    emails: ["a@x.com", "b@x.com"],
    monitorSourceType: 1,
  };

  it("renders the deployed repo name when provided", () => {
    render(<MonitorCard {...baseProps} repoName="my-repo" />);
    expect(screen.getByText("my-repo")).toBeInTheDocument();
    expect(screen.getByText("URL to monitor")).toBeInTheDocument();
    expect(screen.getByText("HTTP Check")).toBeInTheDocument();
  });

  it("renders the external service name branch", () => {
    render(<MonitorCard {...baseProps} externalServiceName="ext-svc" />);
    expect(screen.getByText("ext-svc")).toBeInTheDocument();
  });

  it("shows None and Callback labels for a callback with no tags", () => {
    render(
      <MonitorCard {...baseProps} request={false} monitorSourceType={1} />,
    );
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByText("Heartbeat URL")).toBeInTheDocument();
    expect(screen.getByText("Heartbeat")).toBeInTheDocument();
  });

  it("shows a '+N more' recipients hint and fires onOpenChange on edit", async () => {
    const onOpenChange = vi.fn();
    render(<MonitorCard {...baseProps} onOpenChange={onOpenChange} />);
    expect(screen.getByText("+ 1 more")).toBeInTheDocument();
    fireEvent.click(screen.getByText("+ 1 more").parentElement!.querySelector("svg")!.closest("span")!);
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("hides recipients for BlocksServices (monitorSourceType 2)", () => {
    render(<MonitorCard {...baseProps} monitorSourceType={2} />);
    expect(screen.queryByText("Notification recipients")).toBeNull();
  });
});
