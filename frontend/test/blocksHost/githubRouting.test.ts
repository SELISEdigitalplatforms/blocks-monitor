import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";

const legacy = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("../../server/api/github.ts", () => ({
  githubRoutes: [
    { method: "POST", pattern: /^\/api\/github\/connect$/, handler: legacy.handler },
    { method: "GET", pattern: /^\/api\/github\/callback$/, handler: legacy.handler },
  ],
}));
vi.mock("../../server/api/brief/routes.ts", () => ({ briefRoutes: [], createBriefRoutes: () => [] }));
vi.mock("../../server/api/engineBridge.ts", () => ({}));
vi.mock("../../server/api/registryWriter.ts", () => ({}));
vi.mock("../../server/api/prdBuilder.ts", () => ({}));

import { createApiMiddleware } from "../../server/api/middleware.ts";

function request(url: string, method: string, legacyGithub?: boolean) {
  legacy.handler.mockClear();
  const next = vi.fn();
  const res = { writeHead: vi.fn(), end: vi.fn() };
  createApiMiddleware({ legacyGithub })(
    { url, method } as IncomingMessage, res as unknown as ServerResponse, next,
  );
  return { next, res };
}

describe("engine API GitHub route ownership", () => {
  it.each([
    ["/api/github/connect", "POST"],
    ["/api/github/callback?code=test&state=test", "GET"],
    ["/api/github/status/user-1", "GET"],
    ["/api/github/connect", "OPTIONS"],
  ])("leaves %s (%s) to the Blocks host", (url, method) => {
    const { next, res } = request(url, method, false);
    expect(next).toHaveBeenCalledOnce();
    expect(legacy.handler).not.toHaveBeenCalled();
    expect(res.writeHead).not.toHaveBeenCalled();
    expect(res.end).not.toHaveBeenCalled();
  });

  it("preserves the legacy connect route for local mode by default", () => {
    const { next } = request("/api/github/connect", "POST");
    expect(legacy.handler).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
  });

  it("continues serving engine API routes in Blocks mode", () => {
    const { next, res } = request("/api/health", "GET", false);
    expect(next).not.toHaveBeenCalled();
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({ ok: true });
  });
});
