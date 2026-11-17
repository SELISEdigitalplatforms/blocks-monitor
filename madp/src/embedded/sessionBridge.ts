import { embeddedApiUrl } from "./protocol";

const pending = new Map<string, Promise<boolean>>();
/** Asks the parent to refresh its HttpOnly session. Credentials never enter the iframe message contract. */
export function refreshParentSession(tenantId: string): Promise<boolean> {
  const existing = pending.get(tenantId);
  if (existing) return existing;
  if (window.parent === window) return Promise.resolve(false);
  const promise = new Promise<boolean>((resolve) => {
    const requestId = crypto.randomUUID();
    const finish = (ok: boolean) => {
      clearTimeout(timer); window.removeEventListener("message", receive);
      resolve(ok && document.documentElement.dataset.blocksTenant === tenantId);
    };
    const receive = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== window.location.origin) return;
      const message = event.data;
      if (!message || message.type !== "blocks:session-refresh" || message.version !== 1 || message.requestId !== requestId) return;
      finish(message.ok === true);
    };
    const timer = setTimeout(() => finish(false), 15_000);
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "madp:session-refresh", version: 1, requestId, tenantId }, window.location.origin);
  });
  pending.set(tenantId, promise);
  void promise.finally(() => { if (pending.get(tenantId) === promise) pending.delete(tenantId); });
  return promise;
}

export function createShellFetch(options: { fetch: typeof fetch; origin: string; tenant: () => string | undefined; refresh: (tenantId: string) => Promise<boolean> }): typeof fetch {
  return async (input, init) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const target = new URL(embeddedApiUrl(raw, options.origin), options.origin);
    if (target.origin !== options.origin || !target.pathname.startsWith("/madp-api/")) return options.fetch(input, init);
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    if (!headers.has("X-Madp-Expected-Tenant") && options.tenant()) headers.set("X-Madp-Expected-Tenant", options.tenant()!);
    const tenant = headers.get("X-Madp-Expected-Tenant");
    const base = input instanceof Request ? new Request(target.href, input) : target.href;
    const request = new Request(base, { ...init, headers, credentials: "same-origin" });
    // Clone before the first fetch consumes a POST/upload stream. The retry is byte-for-byte the same request.
    const retry = request.clone();
    const response = await options.fetch(request);
    if (response.status !== 401 || !tenant || request.signal.aborted || options.tenant() !== tenant) return response;
    let refreshed = false;
    try { refreshed = await options.refresh(tenant); } catch { /* A failed refresh returns the original refusal. */ }
    if (!refreshed || request.signal.aborted || options.tenant() !== tenant) return response;
    // Directly use the original fetch: a second 401 cannot recursively refresh or retry.
    return options.fetch(retry);
  };
}
