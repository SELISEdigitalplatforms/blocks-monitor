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
vi.mock("react-router", async (o) => {
  const actual = await o<typeof import("react-router")>();
  return { ...actual, useNavigate: () => h.navigate };
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

// Pause/resume must leave both the table and the details page showing the new state, using the
// invalidation that already exists rather than any new refetch logic (issue #197, H5).
describe("AlertAction refreshes the views after pause and resume", () => {
  beforeEach(() => {
    // The suite above ends with `mockRejectedValue` (not `...Once`), which persists across
    // describes, and clearAllMocks does not reset implementations. Without this the "nominal"
    // pause and resume cases below would silently run the failure path and pass only because
    // the invalidation sits in a `finally`.
    h.updateReq.mockReset().mockResolvedValue({ isSuccess: true });
    h.updateHealth.mockReset().mockResolvedValue({ isSuccess: true });
    h.toast.mockReset();
  });

  const renderWithSpy = (props: Partial<React.ComponentProps<typeof AlertAction>> = {}) => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidate = vi.spyOn(client, "invalidateQueries").mockResolvedValue(undefined);
    render(
      <QueryClientProvider client={client}>
        <AlertAction monitorId="m1" isActive name="Monitor" request projectKey="p1" {...props}>
          <button>Actions</button>
        </AlertAction>
      </QueryClientProvider>
    );
    return invalidate;
  };

  const keysFrom = (invalidate: ReturnType<typeof renderWithSpy>) =>
    invalidate.mock.calls.map(([arg]) => JSON.stringify((arg as { queryKey: unknown }).queryKey));

  it.each([
    ["Pause", true],
    ["Resume", false],
  ])("invalidates both list and detail queries after %s", async (label, isActive) => {
    const invalidate = renderWithSpy({ isActive });
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    await userEvent.click(await screen.findByText(label));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    // Prove this really is the success path, so the assertions below cannot be satisfied by a
    // failed toggle that invalidated from its `finally`.
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "success" }));
    const keys = keysFrom(invalidate);
    // The table reads the first two; the details page reads the third. Missing any one of them
    // leaves one view showing the old paused/active state.
    expect(keys).toContain(JSON.stringify(["health-monitor-list"]));
    expect(keys).toContain(JSON.stringify(["monitor-list-by-id"]));
    expect(keys).toContain(JSON.stringify(["get-monitor-by-id", "m1"]));
  });

  it("invalidates the same queries for a callback monitor", async () => {
    // Both cases above use a request monitor, so moving the invalidation into that branch would
    // leave callback monitors stale in every view and still pass the suite.
    const invalidate = renderWithSpy({ isActive: true, request: false });
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    await userEvent.click(await screen.findByText("Pause"));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(h.updateHealth).toHaveBeenCalled());
    const keys = keysFrom(invalidate);
    expect(keys).toContain(JSON.stringify(["health-monitor-list"]));
    expect(keys).toContain(JSON.stringify(["monitor-list-by-id"]));
    expect(keys).toContain(JSON.stringify(["get-monitor-by-id", "m1"]));
  });

  it("still refreshes the views when the mutation fails", async () => {
    // The invalidation sits in a `finally`, so a failed toggle also refetches. Asserted so the
    // success-path tests above cannot be read as proving more than they do.
    h.updateReq.mockReset().mockRejectedValue(new Error("boom"));
    const invalidate = renderWithSpy({ isActive: true });
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    await userEvent.click(await screen.findByText("Pause"));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(invalidate).toHaveBeenCalled());
    expect(keysFrom(invalidate)).toContain(JSON.stringify(["get-monitor-by-id", "m1"]));
  });
});
