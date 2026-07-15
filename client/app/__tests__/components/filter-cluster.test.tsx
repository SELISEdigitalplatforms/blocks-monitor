import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { AlertsFilterToolbar } from "@/components/module/alert/alerts-filter-toolbar";
import { Radio } from "@/components/common/filter-toolbar/radio/radio";
import { DateRange } from "@/components/common/filter-toolbar/date-range/date-range";

const adapter =
  (search = "") =>
  ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={search}>{children}</NuqsTestingAdapter>
  );

describe("AlertsFilterToolbar", () => {
  const repositories = [
    { value: "r1", label: "Repo One" },
    { value: "r2", label: "Repo Two" },
  ];

  it("renders the search box and the repositories multi-select", () => {
    render(<AlertsFilterToolbar repositories={repositories} />, {
      wrapper: adapter(),
    });
    expect(screen.getAllByPlaceholderText("Search...").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Repositories").length).toBeGreaterThan(0);
  });

  it("shows a reset button once a value differs from defaults", () => {
    render(<AlertsFilterToolbar repositories={repositories} />, {
      wrapper: adapter("?search=web"),
    });
    expect(screen.getAllByRole("button", { name: /Reset/ }).length).toBeGreaterThan(0);
  });
});

describe("Radio (multi-select)", () => {
  const options = [
    { value: "a", label: "Apple" },
    { value: "b", label: "Banana" },
  ];

  it("renders the label and the selected badge", () => {
    render(<Radio label="Fruit" options={options} value="a" onChange={vi.fn()} />);
    // label appears (desktop + mobile spans)
    expect(screen.getAllByText("Fruit").length).toBeGreaterThan(0);
    expect(screen.getByText("Apple")).toBeInTheDocument();
  });

  it("opens the popover, filters options, and selects one", async () => {
    const onChange = vi.fn();
    render(<Radio label="Fruit" options={options} value="" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button"));
    const search = await screen.findByPlaceholderText("Fruit");
    fireEvent.change(search, { target: { value: "ban" } });
    expect(screen.queryByText("Apple")).toBeNull();
    await userEvent.click(screen.getByText("Banana"));
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("shows an empty state when nothing matches", async () => {
    render(<Radio label="Fruit" options={options} value="" onChange={vi.fn()} />);
    await userEvent.click(screen.getByRole("button"));
    const search = await screen.findByPlaceholderText("Fruit");
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByText("No results found.")).toBeInTheDocument();
  });

  it("clears the selection via the clear button", async () => {
    const onChange = vi.fn();
    render(<Radio label="Fruit" options={options} value="a" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button"));
    await userEvent.click(await screen.findByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe("DateRange", () => {
  beforeEach(() => {
    window.innerWidth = 1200;
  });
  afterEach(() => vi.restoreAllMocks());

  it("shows the formatted selected range on the trigger", () => {
    const from = new Date(2023, 0, 1);
    const to = new Date(2023, 0, 5);
    render(<DateRange label="Period" value={{ from, to }} onChange={vi.fn()} />);
    expect(screen.getByText(/01\/01\/2023/)).toBeInTheDocument();
  });

  it("opens the calendar popover and applies the range", async () => {
    const onChange = vi.fn();
    render(
      <DateRange
        label="Period"
        value={{ from: new Date(2023, 0, 1) }}
        onChange={onChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Period/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalled();
  });

  it("reset clears the in-popover selection", async () => {
    render(
      <DateRange
        label="Period"
        value={{ from: new Date(2023, 0, 1) }}
        onChange={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Period/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Reset" }));
    // popover stays open after reset
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
  });
});
