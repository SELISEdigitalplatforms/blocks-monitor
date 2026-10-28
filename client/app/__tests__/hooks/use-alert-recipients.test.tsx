import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/services/alert-recipients.service", () => ({
  alertRecipientsService: {
    getAlertRecipients: vi.fn(),
    getAlertRecipientSuggestions: vi.fn(),
    saveAlertRecipient: vi.fn(),
    deleteAlertRecipient: vi.fn(),
  },
}));

import { alertRecipientsService } from "@/services/alert-recipients.service";
import {
  useDeleteAlertRecipient,
  useGetAlertRecipientSuggestions,
  useGetAlertRecipients,
  useSaveAlertRecipient,
} from "@/hooks/use-alert-recipients";

const service = vi.mocked(alertRecipientsService);

const makeWrapper = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate, client };
};

const data = {
  maxEmailsPerMonitor: 10,
  monitors: [],
  recipients: [],
  monitorsWithoutRecipients: [],
};

describe("use-alert-recipients", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the recipients data for the project", async () => {
    service.getAlertRecipients.mockResolvedValue({ isSuccess: true, data } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useGetAlertRecipients("p1"), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(service.getAlertRecipients).toHaveBeenCalledWith("p1");
    expect(result.current.data).toEqual(data);
  });

  it("turns a refused GET into an error carrying the API message, not an empty list (C17)", async () => {
    service.getAlertRecipients.mockResolvedValue({
      isSuccess: false,
      message: "Project not found.",
      data: null,
    } as never);
    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useGetAlertRecipients("p1"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as Error).message).toBe("Project not found.");
    expect(result.current.data).toBeUndefined();
  });

  it("does not fetch without a project key", () => {
    const { wrapper } = makeWrapper();
    renderHook(() => useGetAlertRecipients(""), { wrapper });
    expect(service.getAlertRecipients).not.toHaveBeenCalled();
  });

  it("fetches suggestions only when enabled, and fails without retrying (Q13)", async () => {
    service.getAlertRecipientSuggestions.mockRejectedValue(new Error("403"));
    const { wrapper } = makeWrapper();
    const disabled = renderHook(() => useGetAlertRecipientSuggestions("p1", false), { wrapper });
    expect(disabled.result.current.fetchStatus).toBe("idle");
    expect(service.getAlertRecipientSuggestions).not.toHaveBeenCalled();

    const { result } = renderHook(() => useGetAlertRecipientSuggestions("p1", true), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(service.getAlertRecipientSuggestions).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["save", true],
    ["save", false],
    ["delete", true],
  ])(
    "refreshes recipients, suggestions and monitor details after a %s (success %s)",
    async (kind, ok) => {
      service.saveAlertRecipient.mockResolvedValue({
        isSuccess: ok,
        message: "m",
        data: null,
      } as never);
      service.deleteAlertRecipient.mockResolvedValue({
        isSuccess: ok,
        message: "m",
        data: null,
      } as never);
      const { wrapper, invalidate } = makeWrapper();
      const { result } = renderHook(
        () => (kind === "save" ? useSaveAlertRecipient() : useDeleteAlertRecipient()),
        { wrapper },
      );
      await act(async () => {
        await result.current.mutateAsync({
          projectKey: "p1",
          email: "ops@x.com",
          allMonitors: true,
          monitorIds: [],
        } as never);
      });
      const keys = invalidate.mock.calls.map(([filters]) => filters?.queryKey?.[0]);
      expect(keys).toEqual(
        expect.arrayContaining([
          "alert-recipients",
          "alert-recipient-suggestions",
          "get-monitor-by-id",
        ]),
      );
    },
  );

  it("drops the removed person from the cached list once the API confirms (H7)", async () => {
    service.deleteAlertRecipient.mockResolvedValue({
      isSuccess: true,
      data: { removed: 1 },
    } as never);
    const { wrapper, client } = makeWrapper();
    const cached = {
      ...data,
      recipients: [
        { email: "ali@x.com", allMonitors: false, monitorIds: ["m1"] },
        { email: "ops@x.com", allMonitors: false, monitorIds: ["m1"] },
      ],
    };
    client.setQueryData(["alert-recipients", "p1"], cached);
    vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    const { result } = renderHook(() => useDeleteAlertRecipient(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ projectKey: "p1", email: "ops@x.com" });
    });
    const after = client.getQueryData<typeof cached>(["alert-recipients", "p1"]);
    expect(after?.recipients.map((r) => r.email)).toEqual(["ali@x.com"]);
  });

  it("leaves the cached list alone when the API refuses the removal", async () => {
    service.deleteAlertRecipient.mockResolvedValue({ isSuccess: false, message: "No" } as never);
    const { wrapper, client } = makeWrapper();
    const cached = {
      ...data,
      recipients: [{ email: "ops@x.com", allMonitors: false, monitorIds: [] }],
    };
    client.setQueryData(["alert-recipients", "p1"], cached);
    vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    const { result } = renderHook(() => useDeleteAlertRecipient(), { wrapper });
    await act(async () => {
      await result.current.mutateAsync({ projectKey: "p1", email: "ops@x.com" });
    });
    expect(client.getQueryData(["alert-recipients", "p1"])).toEqual(cached);
  });
});
