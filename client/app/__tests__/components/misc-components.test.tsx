import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/hooks/use-theme", () => ({
  useTheme: () => ({ resolvedTheme: "light" }),
}));

import { TablePagination } from "@/components/common/filter-toolbar/table-pagination/table-pagination";
import { DropdownSearchInput } from "@/components/common/filter-toolbar/dropdown-search-input/dropdown-search-input";
import { Logo } from "@/components/common/logo";
import {
  LoadingListSkelton,
  MonitorCardSkeleton,
  ResponseSkeletonLoader,
} from "@/components/module/monitor/details/monitor-details-skeletons";
import QueryProvider, { getQueryClient } from "@/providers/query-provider";

describe("TablePagination", () => {
  const base = {
    pageIndex: 1,
    pageCount: 5,
    pageSize: 10,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
  };

  it("renders the current page summary", () => {
    render(<TablePagination {...base} summary="12 items" />);
    expect(screen.getByText("Page 2 of 5")).toBeInTheDocument();
    expect(screen.getByText("12 items")).toBeInTheDocument();
  });

  it("navigates with the paging buttons", async () => {
    const onPageChange = vi.fn();
    render(<TablePagination {...base} onPageChange={onPageChange} />);
    await userEvent.click(screen.getByLabelText("Go to first page"));
    expect(onPageChange).toHaveBeenCalledWith(0);
    await userEvent.click(screen.getByLabelText("Go to previous page"));
    expect(onPageChange).toHaveBeenCalledWith(0);
    await userEvent.click(screen.getByLabelText("Go to next page"));
    expect(onPageChange).toHaveBeenCalledWith(2);
    await userEvent.click(screen.getByLabelText("Go to last page"));
    expect(onPageChange).toHaveBeenCalledWith(4);
  });

  it("disables prev buttons on the first page and next on the last", () => {
    const { rerender } = render(<TablePagination {...base} pageIndex={0} />);
    expect(screen.getByLabelText("Go to previous page")).toBeDisabled();
    rerender(<TablePagination {...base} pageIndex={4} />);
    expect(screen.getByLabelText("Go to next page")).toBeDisabled();
  });
});

describe("DropdownSearchInput", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const options = [
    { label: "Name", value: "name" },
    { label: "URL", value: "url" },
  ];

  it("debounces text changes", () => {
    const onChange = vi.fn();
    render(
      <DropdownSearchInput
        onChange={onChange}
        value={{ selected: "name", value: "" }}
        options={options}
      />,
    );
    const input = screen.getByPlaceholderText("Search...");
    fireEvent.change(input, { target: { value: "abc" } });
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith({ selected: "name", value: "abc" });
  });

  it("clears the text immediately", () => {
    const onChange = vi.fn();
    render(
      <DropdownSearchInput
        onChange={onChange}
        value={{ selected: "name", value: "abc" }}
        options={options}
      />,
    );
    const clearBtn = screen.getAllByRole("button")[screen.getAllByRole("button").length - 1];
    fireEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith({ selected: "name", value: "" });
  });
});

describe("Logo", () => {
  it("renders a provided src", () => {
    render(<Logo src="/custom.svg" alt="Custom" />);
    expect(screen.getByAltText("Custom")).toHaveAttribute("src", "/custom.svg");
  });

  it("falls back to the light logo based on theme", () => {
    render(<Logo />);
    expect(screen.getByAltText("SELISE Logo")).toHaveAttribute(
      "src",
      "/Logo_Light.svg",
    );
  });
});

describe("monitor detail skeletons", () => {
  it("LoadingListSkelton renders the requested number of rows", () => {
    const { container } = render(<LoadingListSkelton length={3} />);
    expect(container.querySelectorAll(".grid > *").length).toBe(3);
  });

  it("MonitorCardSkeleton and ResponseSkeletonLoader render", () => {
    const a = render(<MonitorCardSkeleton />);
    expect(a.container.firstChild).toBeTruthy();
    const b = render(<ResponseSkeletonLoader />);
    expect(b.container.firstChild).toBeTruthy();
  });
});

describe("QueryProvider", () => {
  it("returns a stable singleton query client", () => {
    expect(getQueryClient()).toBe(getQueryClient());
  });

  it("renders children within the provider", () => {
    render(
      <QueryProvider>
        <span>child</span>
      </QueryProvider>,
    );
    expect(screen.getByText("child")).toBeInTheDocument();
  });
});
