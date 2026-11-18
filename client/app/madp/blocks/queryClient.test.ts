import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({
  blocks: { auth: { logout: vi.fn(async () => ({})) }, iam: {}, },
  bindTokenSource: vi.fn(),
}));

import { FOCUS_FRESH_MS, queryClient, retryQuery } from "./queryClient";
import { endSession, signOut } from "./session";

describe("queryClient defaults", () => {
  it("uses the gateway-safe defaults", () => {
    const d = queryClient.getDefaultOptions();
    expect(d.queries?.staleTime).toBe(30_000);
    expect(d.queries?.gcTime).toBe(5 * 60_000);
    const focus = d.queries?.refetchOnWindowFocus as (q: { state: { dataUpdatedAt: number } }) => boolean;
    expect(focus({ state: { dataUpdatedAt: Date.now() - 1_000 } })).toBe(false);
    expect(focus({ state: { dataUpdatedAt: Date.now() - FOCUS_FRESH_MS - 1_000 } })).toBe(true);
    expect(d.mutations?.retry).toBe(0);
  });

  it("retries a query once, never on 401/403", () => {
    expect(retryQuery(0, new Error("network"))).toBe(true);
    expect(retryQuery(1, new Error("network"))).toBe(false);
    expect(retryQuery(0, { status: 401 })).toBe(false);
    expect(retryQuery(0, { response: { status: 403 } })).toBe(false);
    expect(retryQuery(0, { status: 500 })).toBe(true);
  });
});

describe("cache on sign-out", () => {
  it("is cleared by endSession", () => {
    queryClient.setQueryData(["me"], { name: "A" });
    endSession(null);
    expect(queryClient.getQueryData(["me"])).toBeUndefined();
  });

  it("is cleared by signOut", async () => {
    queryClient.setQueryData(["me"], { name: "A" });
    await signOut();
    expect(queryClient.getQueryData(["me"])).toBeUndefined();
  });
});
