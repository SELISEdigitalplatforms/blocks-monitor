// /api/fn's token check (server/fnHost/middleware.ts): a Blocks IAM that does not answer (5xx, 504 "upstream request
// timeout", a timeout, a network error) says nothing about the token, so the caller gets 503 with retry-after and the
// session stays; only a refusal (IamRejected, status 401/403, the local verifier's "token") ends the session with 401.
// Live 15.11 every transient IAM failure ended the session and threw people to the sign-in page.
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { BlocksApiError } from "@seliseblocks/client";
import { createFnMiddleware, transientVerifyError } from "../../server/fnHost/middleware";
import { IamRejected } from "../../server/fnHost/iamAuth";
import type { FnContext } from "../../server/fnHost/verifyToken";

const ORIGIN = "https://factory.test";
const CONTEXT = { tenantId: "t", userId: "u1", email: "u1@example.org", roles: ["mf-user"], permissions: [], organizationId: "default", isAuthenticated: true, impersonated: false, applicationDomain: "factory.test" } as unknown as FnContext;

function request(): IncomingMessage {
  const req = Readable.from([Buffer.from(JSON.stringify({ op: "plans.list", requestId: "r1", args: {} }))]) as unknown as IncomingMessage;
  Object.assign(req, {
    method: "POST", url: "/billing", httpVersion: "2.0", socket: { remoteAddress: "10.0.0.1" },
    headers: { origin: ORIGIN, "content-type": "application/json", "sec-fetch-site": "same-origin" },
  });
  return req;
}

function response() {
  const headers: Record<string, string> = {};
  let body = "";
  const res = {
    statusCode: 200,
    setHeader: (k: string, v: string) => { headers[k.toLowerCase()] = String(v); },
    end: (b?: string) => { body = b ?? ""; },
  };
  return { res: res as unknown as ServerResponse, headers, json: () => JSON.parse(body) as { ok: boolean; error?: { code: string } }, get status() { return res.statusCode; } };
}

function host(verify: (token: string) => Promise<FnContext>) {
  const onRefused = vi.fn();
  const dispatch = vi.fn(async () => ({ statusCode: 200, body: { ok: true, data: { plans: [] } } }));
  const fn = createFnMiddleware({
    env: { MF_SVC_CLIENT_ID: "id", MF_SVC_CLIENT_SECRET: "secret", MF_BLOCKS_TENANT: "t" },
    origin: ORIGIN,
    loadRouter: async () => ({ default: { dispatch } }),
    verify,
    session: async () => ({ state: "ok", accessToken: "access-token", userId: "u1" }),
    onRefused,
    bootstrapCache: false,
  });
  const call = async () => {
    const r = response();
    await fn(request(), r.res);
    return r;
  };
  return { call, onRefused, dispatch };
}

const fetchFailed = () => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) });
const abort = () => Object.assign(new Error("This operation was aborted"), { name: "AbortError" });

describe("a Blocks IAM that does not answer keeps the session", () => {
  it.each([
    ["a 504 upstream request timeout", () => new BlocksApiError(504, "Gateway Timeout", "upstream request timeout")],
    ["a 503", () => new BlocksApiError(503, "Service Unavailable", null)],
    ["a 429", () => new BlocksApiError(429, "Too Many Requests", null)],
    ["the 12 s abort", abort],
    ["a network error", fetchFailed],
  ])("%s: 503 with retry-after, the session stays, no failure is counted", async (_, error) => {
    const h = host(async () => { throw error(); });
    for (let i = 0; i < 40; i++) {
      const r = await h.call();
      expect(r.status).toBe(503);
      expect(r.headers["retry-after"]).toBe("2");
      expect(r.json().error?.code).toBe("unavailable");
    }
    expect(h.onRefused).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
  });

  it("answers once IAM is back, with the same session (the failures were not counted against it)", async () => {
    let down = true;
    const h = host(async () => { if (down) throw new BlocksApiError(504, "Gateway Timeout", null); return CONTEXT; });
    for (let i = 0; i < 40; i++) expect((await h.call()).status).toBe(503);
    down = false;
    const r = await h.call();
    expect(r.status).toBe(200);
    expect(r.json().ok).toBe(true);
    expect(h.onRefused).not.toHaveBeenCalled();
  });
});

describe("a refusal still ends the session", () => {
  it("Blocks IAM refused the token (IamRejected 401): 401 and the session ends", async () => {
    const h = host(async () => { throw new IamRejected(401); });
    const r = await h.call();
    expect(r.status).toBe(401);
    expect(r.json().error?.code).toBe("unauthenticated");
    expect(h.onRefused).toHaveBeenCalledTimes(1);
  });

  it("a 403 from IAM: 401 and the session ends", async () => {
    const h = host(async () => { throw new BlocksApiError(403, "Forbidden", null); });
    expect((await h.call()).status).toBe(401);
    expect(h.onRefused).toHaveBeenCalledTimes(1);
  });

  it("the local host's verifier refused the token (Error(\"token\")): 401 and the session ends", async () => {
    const h = host(async () => { throw new Error("token"); });
    const r = await h.call();
    expect(r.status).toBe(401);
    expect(h.onRefused).toHaveBeenCalledTimes(1);
  });
});

describe("transientVerifyError", () => {
  it("tells a service that did not answer from a refusal", () => {
    expect(transientVerifyError(new BlocksApiError(500, "", null))).toBe(true);
    expect(transientVerifyError(new BlocksApiError(408, "", null))).toBe(true);
    expect(transientVerifyError(Object.assign(new Error("The operation timed out."), { name: "TimeoutError" }))).toBe(true);
    expect(transientVerifyError(new TypeError("Failed to fetch"))).toBe(true);
    expect(transientVerifyError(fetchFailed())).toBe(true);
    expect(transientVerifyError(new Error("busy"))).toBe(true);
    expect(transientVerifyError(new IamRejected(401))).toBe(false);
    expect(transientVerifyError(new BlocksApiError(401, "", null))).toBe(false);
    expect(transientVerifyError(new BlocksApiError(400, "", null))).toBe(false);
    expect(transientVerifyError(new Error("token"))).toBe(false);
    expect(transientVerifyError(new TypeError("Cannot read properties of undefined (reading 'itemId')"))).toBe(false);
    expect(transientVerifyError(null)).toBe(false);
  });
});
