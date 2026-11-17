import { describe, expect, it, vi } from "vitest";
import { createShellFetch } from "./sessionBridge";

const origin = "https://shell.example.test";
describe("shared session request recovery", () => {
  it("refreshes and retries a POST exactly once with its body and headers preserved", async () => {
    const seen: { url: string; body: string; tenant: string | null; credentials: string }[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const request = input as Request;
      seen.push({ url: request.url, body: await request.text(), tenant: request.headers.get("X-Madp-Expected-Tenant"), credentials: request.credentials });
      return new Response("{}", { status: seen.length === 1 ? 401 : 200 });
    });
    const refresh = vi.fn(async () => true);
    const fetch = createShellFetch({ fetch: fetcher as typeof globalThis.fetch, origin, tenant: () => "tenant-a", refresh });
    const response = await fetch(new Request(`${origin}/api/fn/project`, { method: "POST", headers: { "content-type": "application/json" }, body: '{"op":"business.save","args":{"text":"héllo"}}' }));
    expect(response.status).toBe(200); expect(refresh).toHaveBeenCalledOnce();
    expect(seen).toHaveLength(2); expect(seen[1]).toEqual(seen[0]);
    expect(seen[0].url).toBe(`${origin}/madp-api/api/fn/project`); expect(seen[0].tenant).toBe("tenant-a");
  });
  it("returns a second 401 without looping and never refreshes external storage", async () => {
    const fetcher = vi.fn(async () => new Response("", { status: 401 })); const refresh = vi.fn(async () => true);
    const fetch = createShellFetch({ fetch: fetcher as typeof globalThis.fetch, origin, tenant: () => "tenant-a", refresh });
    expect((await fetch("/api/data", { method: "POST", body: "{}" })).status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(refresh).toHaveBeenCalledOnce();
    await fetch("https://storage.example.test/object"); expect(fetcher).toHaveBeenCalledTimes(3); expect(refresh).toHaveBeenCalledOnce();
  });
  it("does not replay after a project switch or failed parent refresh", async () => {
    let tenant = "tenant-a"; const fetcher = vi.fn(async () => new Response("", { status: 401 }));
    const refresh = vi.fn(async () => { tenant = "tenant-b"; return true; });
    const fetch = createShellFetch({ fetch: fetcher as typeof globalThis.fetch, origin, tenant: () => tenant, refresh });
    await fetch("/api/data", { method: "POST", body: "{}" }); expect(fetcher).toHaveBeenCalledOnce();
    const refused = createShellFetch({ fetch: fetcher as typeof globalThis.fetch, origin, tenant: () => tenant, refresh: async () => false });
    await refused("/api/data", { method: "POST", body: "{}" }); expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
