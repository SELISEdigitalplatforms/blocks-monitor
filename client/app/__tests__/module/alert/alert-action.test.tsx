import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  updateReq: vi.fn(),
  updateHealth: vi.fn(),
  deleteMonitor: vi.fn(),
  deleteHealth: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("@/hooks/use-alerts", () => ({
  useUpdateSingleMonitor: () => ({ mutateAsync: h.updateReq, isPending: false }),
  useUpdateHealth: () => ({ mutateAsync: h.updateHealth, isPending: false }),
  useDeleteMonitor: () => ({ mutateAsync: h.deleteMonitor, isPending: false }),
  useDeleteHealth: () => ({ mutateAsync: h.deleteHealth, isPending: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ toast: (...a: unknown[]) => h.toast(...a) }));
vi.mock("react-router-dom", async (o) => {
  const actual = await o<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => h.navigate };
});

import AlertAction from "@/components/module/alert/alert-action";
import { QueryWrapper } from "../../test-utils";

const renderAction = (props: Partial<React.ComponentProps<typeof AlertAction>> = {}) =>
  render(
    <QueryWrapper>
      <AlertAction monitorId="m1" isActive={true} name="Monitor" request projectKey="p1" {...props}>
        <button>Actions</button>
      </AlertAction>
    </QueryWrapper>,
  );

describe("AlertAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.updateReq.mockResolvedValue({ isSuccess: true });
    h.updateHealth.mockResolvedValue({ isSuccess: true });
    h.deleteMonitor.mockResolvedValue({ isSuccess: true });
    h.deleteHealth.mockResolvedValue({ isSuccess: true });
  });

  it("labels the toggle Pause when active", async () => {
    renderAction({ isActive: true });
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(await screen.findByText("Pause")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("confirms a pause via the request update mutation", async () => {
    renderAction({ isActive: true, request: true });
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    await userEvent.click(await screen.findByText("Pause"));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(h.updateReq).toHaveBeenCalledWith({ itemId: "m1", isActive: false }),
    );
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
  });

  it("uses the health mutation for callback monitors", async () => {
    renderAction({ isActive: false, request: false });
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    await userEvent.click(await screen.findByText("Resume"));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(h.updateHealth).toHaveBeenCalledWith(
        expect.objectContaining({ itemId: "m1", isActive: true, projectKey: "p1" }),
      ),
    );
  });

  it("deletes a monitor and navigates back", async () => {
    renderAction({ request: true, goBack: true });
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    await userEvent.click(await screen.findByText("Delete"));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(h.deleteMonitor).toHaveBeenCalledWith("m1"));
    expect(h.navigate).toHaveBeenCalledWith(-1);
  });

  it("deletes a callback monitor without navigating when goBack is false", async () => {
    renderAction({ request: false, goBack: false });
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    await userEvent.click(await screen.findByText("Delete"));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(h.deleteHealth).toHaveBeenCalledWith("m1"));
    expect(h.navigate).not.toHaveBeenCalled();
  });

  it("shows an error toast when update fails", async () => {
    h.updateReq.mockRejectedValue(new Error("fail"));
    renderAction({ isActive: true, request: true });
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    await userEvent.click(await screen.findByText("Pause"));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })),
    );
  });
});
