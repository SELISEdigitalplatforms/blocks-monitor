import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RecipientsTable from "@/components/module/alert-recipients/recipients-table";
import { MONITORS, monitor, recipient } from "./fixtures";

const renderTable = (props: Partial<React.ComponentProps<typeof RecipientsTable>> = {}) => {
  const onEdit = vi.fn();
  const onRemove = vi.fn();
  const monitors = props.monitorsById ?? new Map(MONITORS.map((m) => [m.itemId, m]));
  render(
    <RecipientsTable
      recipients={[]}
      monitorsById={monitors}
      totalMonitors={monitors.size}
      removingEmail={null}
      onEdit={onEdit}
      onRemove={onRemove}
      {...props}
    />,
  );
  return { onEdit, onRemove };
};

describe("RecipientsTable", () => {
  it("has the Recipient, Gets alerts for and Actions columns (H2)", () => {
    renderTable();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Recipient",
      "Gets alerts for",
      "Actions",
    ]);
  });

  it("shows All monitors (N) and New monitors too for an All person (H3)", () => {
    renderTable({
      recipients: [recipient("ops@x.com", ["m1", "m2", "h1"], { allMonitors: true })],
    });
    expect(screen.getByText("All monitors (3)")).toBeInTheDocument();
    expect(screen.getByText("New monitors too")).toBeInTheDocument();
  });

  it("shows K monitors: and the names for anyone else (H3)", () => {
    renderTable({ recipients: [recipient("ali@x.com", ["m2", "m1"])] });
    const row = screen.getByText("ali@x.com").closest("tr")!;
    expect(within(row).getByText("2 monitors:")).toBeInTheDocument();
    expect(within(row).getByText("api")).toBeInTheDocument();
    expect(within(row).getByText("web")).toBeInTheDocument();
    expect(within(row).queryByText(/All monitors/)).toBeNull();
    expect(within(row).getByText("A")).toHaveAttribute("aria-hidden", "true");
  });

  it("says No monitors for a stored person on no monitor", () => {
    renderTable({ recipients: [recipient("idle@x.com", [])] });
    expect(screen.getByText("No monitors")).toBeInTheDocument();
  });

  it("shows at most 5 chips plus +K more, which expands in place (Q6)", async () => {
    const many = Array.from({ length: 8 }, (_, i) => monitor(`x${i}`, `svc-${i}`));
    const monitorsById = new Map(many.map((m) => [m.itemId, m]));
    renderTable({
      monitorsById,
      totalMonitors: 8,
      recipients: [
        recipient(
          "ali@x.com",
          many.map((m) => m.itemId),
        ),
      ],
    });
    expect(screen.getByText("8 monitors:")).toBeInTheDocument();
    expect(screen.getAllByText(/^svc-/)).toHaveLength(5);
    const more = screen.getByRole("button", { name: "+3 more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);
    expect(screen.getAllByText(/^svc-/)).toHaveLength(8);
    const less = screen.getByRole("button", { name: "Show less" });
    expect(less).toHaveAttribute("aria-expanded", "true");
    await userEvent.click(less);
    expect(screen.getAllByText(/^svc-/)).toHaveLength(5);
  });

  it("labels Edit and Remove with the email and calls back (H2, C21)", async () => {
    const person = recipient("ali@x.com", ["m1"]);
    const { onEdit, onRemove } = renderTable({ recipients: [person] });
    await userEvent.click(screen.getByRole("button", { name: "Edit ali@x.com" }));
    expect(onEdit).toHaveBeenCalledWith(person);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove ali@x.com from all monitors" }),
    );
    expect(onRemove).toHaveBeenCalledWith(person);
  });

  it("disables Remove on the row being removed", () => {
    renderTable({
      recipients: [recipient("ali@x.com", ["m1"]), recipient("ops@x.com", ["m1"])],
      removingEmail: "ali@x.com",
    });
    expect(
      screen.getByRole("button", { name: "Remove ali@x.com from all monitors" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Remove ops@x.com from all monitors" }),
    ).toBeEnabled();
  });

  it("keeps a 760 px minimum width so narrow screens scroll inside the card (C22)", () => {
    renderTable();
    expect(screen.getByRole("table")).toHaveClass("min-w-[760px]");
  });
});
