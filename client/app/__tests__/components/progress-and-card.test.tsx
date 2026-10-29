import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ProgressBar from "@/components/module/alert/progress-bar";
import MonitorCard from "@/components/module/monitor/details/monitor-card";
import { MemoryRouter } from "react-router";

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
    const pct = Number(screen.getByText(/%$/).textContent!.replace(/%/g, ""));
    expect(pct).toBeLessThan(100);
  });

  it("reveals a tooltip on hover", () => {
    const { container } = render(<ProgressBar incidents={[]} status={true} />);
    const bar = container.querySelector(".h-6")!;
    fireEvent.mouseEnter(bar);
    expect(screen.getByText(/Up/)).toBeInTheDocument();
    fireEvent.mouseLeave(bar);
  });
});

describe("MonitorCard", () => {
  const baseProps = {
    url: "https://svc.example.com",
    request: true,
    emails: ["a@x.com", "b@x.com"],
    monitorSourceType: 1,
    alertRecipientsPath: "/app/p1/alert-recipients",
  };
  type Props = React.ComponentProps<typeof MonitorCard>;
  // The card links to the Alert recipients page, so it needs a router.
  const renderCard = (props: Partial<Props> = {}) =>
    render(
      <MemoryRouter>
        <MonitorCard {...baseProps} {...props} />
      </MemoryRouter>,
    );

  it("renders the deployed repo name when provided", () => {
    renderCard({ repoName: "my-repo" });
    expect(screen.getByText("my-repo")).toBeInTheDocument();
    expect(screen.getByText("URL to monitor")).toBeInTheDocument();
    expect(screen.getByText("HTTP Check")).toBeInTheDocument();
  });

  it("renders the external service name branch", () => {
    renderCard({ externalServiceName: "ext-svc" });
    expect(screen.getByText("ext-svc")).toBeInTheDocument();
  });

  it("shows None and Callback labels for a callback with no tags", () => {
    renderCard({ request: false, monitorSourceType: 1 });
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByText("Heartbeat URL")).toBeInTheDocument();
    expect(screen.getByText("Heartbeat")).toBeInTheDocument();
  });

  it("lists every recipient as a read-only chip with a link to Alert recipients (H12)", () => {
    renderCard();
    const list = screen.getByRole("list", { name: "Notification recipients" });
    expect(Array.from(list.querySelectorAll("li")).map((li) => li.textContent)).toEqual([
      "a@x.com",
      "b@x.com",
    ]);
    // Read-only: no edit control of any kind is left on the card.
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/more$/)).toBeNull();
    expect(screen.getByRole("link", { name: "Open Alert recipients" })).toHaveAttribute(
      "href",
      "/app/p1/alert-recipients",
    );
  });

  it("says No recipients when the monitor has none, and still links to the page", () => {
    renderCard({ emails: [] });
    expect(screen.getByText("No recipients")).toBeInTheDocument();
    expect(screen.queryByText("Add recipient")).toBeNull();
    expect(screen.getByRole("link", { name: "Open Alert recipients" })).toBeInTheDocument();
  });

  it.each([
    ["Blocks services", 2],
    ["Infrastructure", 0],
  ])("hides recipients and the link for %s monitors (Q10)", (_name, sourceType) => {
    renderCard({ monitorSourceType: sourceType });
    expect(screen.queryByText("Notification recipients")).toBeNull();
    expect(screen.queryByRole("link", { name: "Open Alert recipients" })).toBeNull();
  });

  it.each([
    ["Deployed services", 1],
    ["External services", 3],
    ["Other services", 4],
    ["an unknown source", undefined],
  ])("shows recipients for %s", (_name, sourceType) => {
    renderCard({ monitorSourceType: sourceType });
    expect(screen.getByText("Notification recipients")).toBeInTheDocument();
  });
});
