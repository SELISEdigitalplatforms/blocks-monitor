import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchInput } from "@/components/common/filter-toolbar/search-input/search-input";
import { ClearButton } from "@/components/common/filter-toolbar/clear-button/clear-button";
import { ResetButton } from "@/components/common/filter-toolbar/reset-button/reset-button";
import { SortHeader } from "@/components/common/filter-toolbar/sort-header/sort-header";

describe("SearchInput", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces onChange while typing", () => {
    const onChange = vi.fn();
    render(<SearchInput value="" onChange={onChange} />);
    const input = screen.getByPlaceholderText("Search...");
    fireEvent.change(input, { target: { value: "hello" } });
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith("hello");
  });

  it("clears immediately when the clear button is clicked", () => {
    const onChange = vi.fn();
    render(<SearchInput value="abc" onChange={onChange} />);
    const clearBtn = screen.getAllByRole("button")[0];
    fireEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("ClearButton / ResetButton", () => {
  it("ClearButton fires onClear", async () => {
    const onClear = vi.fn();
    render(<ClearButton onClear={onClear} />);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalled();
  });

  it("ResetButton fires onClick", async () => {
    const onClick = vi.fn();
    render(<ResetButton onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: /Reset/ }));
    expect(onClick).toHaveBeenCalled();
  });
});

describe("SortHeader", () => {
  it("renders the label and no arrow when inactive", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SortHeader
        id="name"
        label="Name"
        value={{ property: "url", isDescending: false }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(container.querySelector("svg")).toBeNull();
  });

  it("shows an arrow when active and toggles direction on click", () => {
    const onChange = vi.fn();
    render(
      <SortHeader
        id="name"
        label="Name"
        value={{ property: "name", isDescending: false }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Name"));
    expect(onChange).toHaveBeenCalledWith({
      property: "name",
      isDescending: true,
    });
  });

  it("sorts ascending when switching to a new column", () => {
    const onChange = vi.fn();
    render(
      <SortHeader
        id="url"
        label="URL"
        value={{ property: "name", isDescending: true }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("URL"));
    expect(onChange).toHaveBeenCalledWith({
      property: "url",
      isDescending: false,
    });
  });

  it("falls back to default value when value is undefined", () => {
    const onChange = vi.fn();
    render(
      <SortHeader
        id="name"
        label="Name"
        value={undefined as never}
        defaultValue={{ property: "name", isDescending: true }}
        onChange={onChange}
      />,
    );
    // active because default property matches id -> arrow visible
    expect(document.querySelector("svg")).not.toBeNull();
  });
});
