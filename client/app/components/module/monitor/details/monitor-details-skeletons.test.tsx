import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  LoadingListSkelton,
  MonitorCardSkeleton,
  ResponseSkeletonLoader,
} from "./monitor-details-skeletons";

// Skeleton renders a single div carrying the animate-pulse class, so counting
// those is the way to assert how many placeholder slots a loader draws.
const placeholders = (container: HTMLElement) =>
  container.querySelectorAll(".animate-pulse");

describe("LoadingListSkelton", () => {
  it("draws one placeholder per requested row", () => {
    const { container } = render(<LoadingListSkelton length={3} />);

    expect(placeholders(container)).toHaveLength(3);
  });

  it("draws nothing when no rows are requested", () => {
    const { container } = render(<LoadingListSkelton length={0} />);

    expect(placeholders(container)).toHaveLength(0);
  });
});

describe("MonitorCardSkeleton", () => {
  it("draws a placeholder for the title and every summary field", () => {
    const { container } = render(<MonitorCardSkeleton />);

    // title, then the deploys-from, url and monitor-type groups
    expect(placeholders(container)).toHaveLength(8);
  });
});

describe("ResponseSkeletonLoader", () => {
  it("draws placeholders for the header, the meta row and the chart", () => {
    const { container } = render(<ResponseSkeletonLoader />);

    expect(placeholders(container)).toHaveLength(5);
  });
});
