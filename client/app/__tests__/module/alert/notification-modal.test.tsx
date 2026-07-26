import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  updateReq: vi.fn(),
  updateHealth: vi.fn(),
  showError: vi.fn(),
  showSuccess: vi.fn(),
}));

vi.mock("@/hooks/use-alerts", () => ({
  useUpdateSingleMonitor: () => ({ mutateAsync: h.updateReq, isPending: false }),
  useUpdateHealth: () => ({ mutateAsync: h.updateHealth, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({
  showErrorToast: (...a: unknown[]) => h.showError(...a),
  showSuccessToast: (...a: unknown[]) => h.showSuccess(...a),
}));

import NotificationModal from "@/components/module/alert/notification-modal";

const baseData = {
  itemId: "m1",
  isActive: true,
  projectKey: "p1",
  name: "Monitor",
  emails: ["a@x.com"],
};

const renderModal = (overrides: Partial<React.ComponentProps<typeof NotificationModal>> = {}) => {
  const onOpenChange = vi.fn();
  render(
    <NotificationModal open onOpenChange={onOpenChange} request data={baseData} {...overrides} />,
  );
  return { onOpenChange };
};

describe("NotificationModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.updateReq.mockResolvedValue({ isSuccess: true });
    h.updateHealth.mockResolvedValue({ isSuccess: true });
  });

  it("renders the initial recipient list", () => {
    renderModal();
    expect(screen.getByText("Notification settings")).toBeInTheDocument();
    expect(screen.getByDisplayValue("a@x.com")).toBeInTheDocument();
  });

  it("adds an empty email input when 'Add email' is clicked", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /Add email/ }));
    const inputs = screen.getAllByPlaceholderText("Enter email address");
    expect(inputs).toHaveLength(2);
  });

  it("shows a validation error for an invalid email and clears it when fixed", () => {
    renderModal({ data: { ...baseData, emails: ["bad"] } });
    const input = screen.getByPlaceholderText("Enter email address");
    fireEvent.change(input, { target: { value: "still-bad" } });
    expect(screen.getByText("Please enter a valid email address")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "good@x.com" } });
    expect(screen.queryByText("Please enter a valid email address")).toBeNull();
  });

  it("shows 'Email is required' when cleared", () => {
    renderModal();
    const input = screen.getByDisplayValue("a@x.com");
    fireEvent.change(input, { target: { value: "" } });
    expect(screen.getByText("Email is required")).toBeInTheDocument();
  });

  it("removes an email row", () => {
    renderModal({ data: { ...baseData, emails: ["a@x.com", "b@x.com"] } });
    const trashButtons = screen
      .getAllByRole("button")
      .filter((b) => b.querySelector("svg.lucide-trash"));
    fireEvent.click(trashButtons[0]);
    expect(screen.queryByDisplayValue("a@x.com")).toBeNull();
    expect(screen.getByDisplayValue("b@x.com")).toBeInTheDocument();
  });

  it("flags duplicate emails on save", () => {
    renderModal({ data: { ...baseData, emails: ["dup@x.com", "dup@x.com"] } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getAllByText("This email is already added").length).toBe(2);
    expect(h.updateReq).not.toHaveBeenCalled();
  });

  it("saves valid recipients through the request mutation", async () => {
    const { onOpenChange } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.updateReq).toHaveBeenCalled());
    expect(h.updateReq).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "m1", emails: ["a@x.com"] }),
    );
    await waitFor(() => expect(h.showSuccess).toHaveBeenCalled());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("saves through the health mutation for callback monitors", async () => {
    renderModal({ request: false });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.updateHealth).toHaveBeenCalled());
    expect(h.updateHealth).toHaveBeenCalledWith(
      expect.objectContaining({ projectKey: "p1", name: "Monitor" }),
    );
  });

  it("shows an error toast when the mutation reports failure", async () => {
    h.updateReq.mockResolvedValue({ isSuccess: false, message: "server said no" });
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.showError).toHaveBeenCalledWith({ errors: "server said no" }));
  });

  it("cancel resets and closes", () => {
    const { onOpenChange } = renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Enter on a valid email adds a new row", () => {
    renderModal();
    const input = screen.getByDisplayValue("a@x.com");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getAllByPlaceholderText("Enter email address")).toHaveLength(2);
  });
});
