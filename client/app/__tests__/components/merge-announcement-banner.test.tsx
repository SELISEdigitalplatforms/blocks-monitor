import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MergeAnnouncementBanner } from "@/components/common/merge-announcement/merge-announcement-banner";
import {
  FORWARDING_ENDS_AT,
  MERGE_AT,
  dismissStorageKey,
  getMergePhase,
  msUntilNextPhaseChange,
} from "@/components/common/merge-announcement/merge-announcement.schedule";

const auth = vi.hoisted(() => ({ isAuthenticated: true }));
vi.mock("@seliseblocks/genesis-os/store", () => ({
  useAuthStore: (selector: (state: { isAuthenticated: boolean }) => unknown) => selector(auth),
}));

const HOUR = 60 * 60 * 1000;

describe("merge announcement schedule", () => {
  it("switches phase at the UTC cut-offs", () => {
    expect(MERGE_AT).toBe(Date.parse("2026-11-28T18:00:00Z"));
    expect(FORWARDING_ENDS_AT).toBe(Date.parse("2026-12-20T18:00:00Z"));
    expect(getMergePhase(MERGE_AT - 1)).toBe("before");
    expect(getMergePhase(MERGE_AT)).toBe("after");
    expect(getMergePhase(FORWARDING_ENDS_AT - 1)).toBe("after");
    expect(getMergePhase(FORWARDING_ENDS_AT)).toBeNull();
  });

  it("waits for the next boundary, capped to a safe timeout", () => {
    expect(msUntilNextPhaseChange(MERGE_AT - HOUR)).toBe(HOUR);
    expect(msUntilNextPhaseChange(MERGE_AT)).toBe(FORWARDING_ENDS_AT - MERGE_AT);
    expect(msUntilNextPhaseChange(MERGE_AT - 30 * 24 * HOUR)).toBe(2_147_483_647);
    expect(msUntilNextPhaseChange(FORWARDING_ENDS_AT - HOUR)).toBe(HOUR);
    expect(msUntilNextPhaseChange(FORWARDING_ENDS_AT)).toBeNull();
  });
});

describe("MergeAnnouncementBanner", () => {
  beforeEach(() => {
    auth.isAuthenticated = true;
    localStorage.clear();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the before text and marks the page while visible", () => {
    vi.setSystemTime(MERGE_AT - 2 * HOUR);
    const { unmount } = render(<MergeAnnouncementBanner />);
    expect(screen.getByText("Blocks is getting simpler.")).toBeInTheDocument();
    expect(screen.getByText(/Downtime 18:00–19:00 UTC/)).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute("data-merge-banner");
    unmount();
    expect(document.documentElement).not.toHaveAttribute("data-merge-banner");
  });

  it("renders nothing before login", () => {
    auth.isAuthenticated = false;
    vi.setSystemTime(MERGE_AT - 2 * HOUR);
    render(<MergeAnnouncementBanner />);
    expect(screen.queryByTestId("merge-announcement-banner")).not.toBeInTheDocument();
  });

  it("shows the after text between the switch and the forwarding cut-off", () => {
    vi.setSystemTime(MERGE_AT + HOUR);
    render(<MergeAnnouncementBanner />);
    expect(
      screen.getByText(
        "Logic, Data, Localization and Monitor are now part of Blocks OS (os.seliseblocks.com).",
      ),
    ).toBeInTheDocument();
  });

  it("renders nothing after the forwarding cut-off", () => {
    vi.setSystemTime(FORWARDING_ENDS_AT + HOUR);
    render(<MergeAnnouncementBanner />);
    expect(screen.queryByTestId("merge-announcement-banner")).not.toBeInTheDocument();
  });

  it("moves from before to after on its own at the switch", () => {
    vi.setSystemTime(MERGE_AT - 1000);
    render(<MergeAnnouncementBanner />);
    expect(screen.getByText("Blocks is getting simpler.")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.queryByText("Blocks is getting simpler.")).not.toBeInTheDocument();
    expect(screen.getByText(/are now in Blocks OS/)).toBeInTheDocument();
  });

  it("remembers a dismissal per phase", () => {
    vi.setSystemTime(MERGE_AT - 2 * HOUR);
    const { unmount } = render(<MergeAnnouncementBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss announcement" }));
    expect(screen.queryByTestId("merge-announcement-banner")).not.toBeInTheDocument();
    expect(localStorage.getItem(dismissStorageKey("before"))).toBe("1");
    unmount();

    render(<MergeAnnouncementBanner />);
    expect(screen.queryByTestId("merge-announcement-banner")).not.toBeInTheDocument();

    vi.setSystemTime(MERGE_AT + HOUR);
    render(<MergeAnnouncementBanner />);
    expect(screen.getByTestId("merge-announcement-banner")).toBeInTheDocument();
  });

  it("opens the details dialog from Learn more", () => {
    vi.setSystemTime(MERGE_AT - 2 * HOUR);
    render(<MergeAnnouncementBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Learn more" }));
    expect(
      screen.getByText("We're bringing more of Blocks together in Blocks OS"),
    ).toBeInTheDocument();
    expect(screen.getByText(/It will show five apps/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(
      screen.queryByText("We're bringing more of Blocks together in Blocks OS"),
    ).not.toBeInTheDocument();
  });
});
