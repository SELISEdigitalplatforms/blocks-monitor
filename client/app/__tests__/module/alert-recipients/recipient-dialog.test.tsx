import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  mutateAsync: vi.fn(),
  isPending: false,
  suggestionsEnabled: undefined as boolean | undefined,
  suggestions: {
    isSuccess: true,
    data: { memberEmails: ["nadia@x.com", "ops@x.com"] },
  } as { isSuccess: boolean; data?: { memberEmails: string[] } },
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/hooks/use-alert-recipients", () => ({
  useSaveAlertRecipient: () => ({ mutateAsync: h.mutateAsync, isPending: h.isPending }),
  useGetAlertRecipientSuggestions: (_projectKey: string, enabled: boolean) => {
    h.suggestionsEnabled = enabled;
    return h.suggestions;
  },
}));
vi.mock("@/hooks/use-toast", () => ({
  showSuccessToast: (o: unknown) => h.success(o),
  showErrorToast: (o: unknown) => h.error(o),
}));

import RecipientDialog from "@/components/module/alert-recipients/recipient-dialog";
import type { IAlertRecipient } from "@/models/alert-recipients.model";
import { MONITORS, monitor, recipient } from "./fixtures";

const RECIPIENTS = [recipient("ops@x.com", ["m1", "m2"])];

const renderDialog = (props: Partial<React.ComponentProps<typeof RecipientDialog>> = {}) => {
  const onClose = vi.fn();
  render(
    <RecipientDialog
      mode="add"
      projectKey="p1"
      monitors={MONITORS}
      recipients={RECIPIENTS}
      maxEmailsPerMonitor={10}
      onClose={onClose}
      {...props}
    />,
  );
  return { onClose };
};

const emailInput = () => screen.getByLabelText("Email");
const saveButton = (name: RegExp | string) => screen.getByRole("button", { name });
const chooseSelected = () =>
  userEvent.click(screen.getByRole("radio", { name: /Selected monitors/ }));
const monitorBox = (name: string) =>
  screen.getByRole("checkbox", { name: (accessibleName) => accessibleName.startsWith(name) });

describe("RecipientDialog — add", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isPending = false;
    h.suggestions = { isSuccess: true, data: { memberEmails: ["nadia@x.com", "ops@x.com"] } };
    h.mutateAsync.mockResolvedValue({ isSuccess: true, message: "Added to 3 monitors." });
  });

  it("matches the design's copy and defaults to All monitors", () => {
    renderDialog();
    expect(screen.getByRole("dialog", { name: "Add recipient" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "This person gets an email when a chosen monitor goes down or comes back up.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Send alerts for" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /All monitors \(3\)/ })).toBeChecked();
    expect(screen.getByText("Also added to monitors you create later.")).toBeInTheDocument();
    expect(screen.getByText("Choose which ones.")).toBeInTheDocument();
    expect(saveButton("Add to all 3 monitors")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("shows the email error on blur and keeps Save disabled (C1)", async () => {
    renderDialog();
    await userEvent.type(emailInput(), "rina@");
    expect(screen.queryByText("Enter a valid email address.")).toBeNull();
    await userEvent.tab();
    expect(screen.getByText("Enter a valid email address.")).toBeInTheDocument();
    expect(emailInput()).toHaveAttribute("aria-invalid", "true");
    expect(emailInput()).toHaveAccessibleDescription("Enter a valid email address.");
    expect(saveButton("Add to all 3 monitors")).toBeDisabled();
    expect(h.mutateAsync).not.toHaveBeenCalled();
  });

  it("refuses an existing recipient with the Edit hint (C18)", async () => {
    renderDialog();
    await userEvent.type(emailInput(), " OPS@x.com");
    expect(
      screen.getByText("This person already gets alerts. Use Edit to change their monitors."),
    ).toBeInTheDocument();
    expect(saveButton("Add to all 3 monitors")).toBeDisabled();
  });

  it("lists member suggestions that are not yet recipients, and a pick fills the email (H14)", async () => {
    renderDialog();
    expect(h.suggestionsEnabled).toBe(true);
    expect(screen.getByText("Project members:")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ops@x.com" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "nadia@x.com" }));
    expect(emailInput()).toHaveValue("nadia@x.com");
    expect(saveButton("Add to all 3 monitors")).toBeEnabled();
  });

  it("hides the suggestions when that call fails (Q13)", () => {
    h.suggestions = { isSuccess: false };
    renderDialog();
    expect(screen.queryByText("Project members:")).toBeNull();
  });

  it("saves a non-member email for all monitors, normalized (H4, H14, H16)", async () => {
    const { onClose } = renderDialog();
    await userEvent.type(emailInput(), "  Alerts@Partner.example ");
    await userEvent.click(saveButton("Add to all 3 monitors"));
    expect(h.mutateAsync).toHaveBeenCalledWith({
      projectKey: "p1",
      email: "alerts@partner.example",
      allMonitors: true,
      monitorIds: [],
    });
    expect(h.success).toHaveBeenCalledWith({ description: "Added to 3 monitors." });
    expect(onClose).toHaveBeenCalled();
  });

  it("keeps Save disabled in Selected mode until a monitor is ticked (C2)", async () => {
    renderDialog();
    await userEvent.type(emailInput(), "rina@x.com");
    await chooseSelected();
    expect(saveButton("Add to 0 monitors")).toBeDisabled();
  });

  it("adds only the ticked monitors (H5)", async () => {
    renderDialog();
    await userEvent.type(emailInput(), "rina@x.com");
    await chooseSelected();
    await userEvent.click(monitorBox("web"));
    await userEvent.click(monitorBox("worker"));
    expect(screen.getByText("Heartbeat · 0 recipients")).toBeInTheDocument();
    await userEvent.click(saveButton("Add to 2 monitors"));
    expect(h.mutateAsync).toHaveBeenCalledWith({
      projectKey: "p1",
      email: "rina@x.com",
      allMonitors: false,
      monitorIds: ["m2", "h1"],
    });
  });

  it("disables a full monitor as Full (10 of 10) and warns that All skips it (C6)", async () => {
    const monitors = [...MONITORS, monitor("m9", "busy", { emailCount: 10 })];
    renderDialog({ monitors });
    await userEvent.type(emailInput(), "rina@x.com");
    expect(
      screen.getByText("1 monitor already has 10 recipients and will be skipped."),
    ).toBeInTheDocument();
    await chooseSelected();
    expect(monitorBox("busy")).toBeDisabled();
    expect(screen.getByText("Full (10 of 10)")).toBeInTheDocument();
  });

  it("filters the Selected checklist by name (Q6)", async () => {
    renderDialog();
    await chooseSelected();
    const list = screen.getByRole("list", { name: "Monitors" });
    await userEvent.type(screen.getByRole("searchbox", { name: "Filter monitors" }), "WOR");
    expect(within(list).getAllByRole("checkbox")).toHaveLength(1);
    expect(monitorBox("worker")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("searchbox", { name: "Filter monitors" }), "zzz");
    expect(within(list).getByText("No monitors match.")).toBeInTheDocument();
  });

  it("keeps the dialog open and shows the API message when the save is refused (C17)", async () => {
    h.mutateAsync.mockResolvedValue({
      isSuccess: false,
      message: "At most 10 people can get alerts for all monitors.",
    });
    const { onClose } = renderDialog();
    await userEvent.type(emailInput(), "rina@x.com");
    await userEvent.click(saveButton("Add to all 3 monitors"));
    expect(h.error).toHaveBeenCalledWith({
      errors: "At most 10 people can get alerts for all monitors.",
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(emailInput()).toHaveValue("rina@x.com");
  });

  it("shows an error toast when the request throws", async () => {
    h.mutateAsync.mockRejectedValue(new Error("Network down"));
    const { onClose } = renderDialog();
    await userEvent.type(emailInput(), "rina@x.com");
    await userEvent.click(saveButton("Add to all 3 monitors"));
    expect(h.error).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows a spinner and disables Save while saving", () => {
    h.isPending = true;
    renderDialog();
    expect(saveButton("Add to all 3 monitors")).toBeDisabled();
  });

  it("closes on Escape and on Cancel (C21)", async () => {
    const { onClose } = renderDialog();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("starts focus inside the dialog and reaches the controls by keyboard (C21)", async () => {
    renderDialog();
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
    for (let i = 0; i < 8; i += 1) {
      await userEvent.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});

describe("RecipientDialog — edit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isPending = false;
    h.mutateAsync.mockResolvedValue({ isSuccess: true, message: "Removed from 2 monitors." });
  });

  const allPerson: IAlertRecipient = recipient("ops@x.com", ["m1", "m2", "h1"], {
    allMonitors: true,
    allMonitorsChoice: true,
  });

  it("shows a read-only email, no suggestions, and a Save button", () => {
    renderDialog({ mode: "edit", recipient: allPerson, recipients: [allPerson] });
    expect(screen.getByRole("dialog", { name: "Edit recipient" })).toBeInTheDocument();
    expect(emailInput()).toHaveValue("ops@x.com");
    expect(emailInput()).toHaveAttribute("readonly");
    expect(h.suggestionsEnabled).toBe(false);
    expect(screen.queryByText("Project members:")).toBeNull();
    expect(saveButton("Save")).toBeEnabled();
  });

  it("narrows an All person to a subset of monitors (H6)", async () => {
    renderDialog({ mode: "edit", recipient: allPerson, recipients: [allPerson] });
    expect(screen.getByRole("radio", { name: /All monitors/ })).toBeChecked();
    await chooseSelected();
    // Starts from the monitors the person is on.
    expect(monitorBox("api")).toBeChecked();
    await userEvent.click(monitorBox("web"));
    await userEvent.click(monitorBox("worker"));
    await userEvent.click(saveButton("Save"));
    expect(h.mutateAsync).toHaveBeenCalledWith({
      projectKey: "p1",
      email: "ops@x.com",
      allMonitors: false,
      monitorIds: ["m1"],
    });
  });

  it("preselects All from the stored choice even when a full monitor skipped the person (Q4)", () => {
    const skipped = recipient("ops@x.com", ["m1"], { allMonitors: false, allMonitorsChoice: true });
    renderDialog({ mode: "edit", recipient: skipped, recipients: [skipped] });
    expect(screen.getByRole("radio", { name: /All monitors/ })).toBeChecked();
  });

  it("never marks a monitor the person is already on as full", async () => {
    const person = recipient("ops@x.com", ["m9"]);
    const monitors = [...MONITORS, monitor("m9", "busy", { emailCount: 10 })];
    renderDialog({ mode: "edit", recipient: person, recipients: [person], monitors });
    expect(monitorBox("busy")).toBeEnabled();
    expect(monitorBox("busy")).toBeChecked();
    expect(screen.queryByText(/^Full/)).toBeNull();
  });
});
