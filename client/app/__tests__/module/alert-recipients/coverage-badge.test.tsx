import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import CoverageBadge from "@/components/module/alert-recipients/coverage-badge";

describe("CoverageBadge (H13, Q11)", () => {
  it("shows the OK state with success border and icon but foreground text", () => {
    render(<CoverageBadge total={3} withoutRecipients={0} />);
    const badge = screen.getByTestId("coverage-badge");
    expect(badge).toHaveTextContent("All 3 monitors email someone");
    expect(badge).toHaveAttribute("data-state", "ok");
    expect(badge).toHaveClass("border-success", "text-foreground");
    expect(badge).not.toHaveClass("text-success");
    expect(badge.querySelector("svg")).toHaveClass("text-success");
    expect(badge.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the warning state with the warning token set", () => {
    render(<CoverageBadge total={3} withoutRecipients={1} />);
    const badge = screen.getByTestId("coverage-badge");
    expect(badge).toHaveTextContent("1 of 3 monitors emails no one");
    expect(badge).toHaveAttribute("data-state", "warning");
    expect(badge).toHaveClass("bg-warning-50", "text-warning-800", "border-warning-200");
  });
});
