import { describe, expect, it } from "vitest";
import { isConnectedRepository, readMadpMessage } from "./protocol";

describe("MADP frame message boundary", () => {
  const origin = "https://blocks.example";
  const frame = {} as Window;
  const event = (data: unknown, overrides: Partial<MessageEvent> = {}) =>
    ({ data, origin, source: frame, ...overrides }) as MessageEvent;

  it("accepts ready and supported navigation from the mounted document", () => {
    expect(readMadpMessage(event({ type: "madp:ready", version: 1 }), frame, origin)).toEqual({
      type: "madp:ready",
      version: 1,
    });
    for (const destination of ["projects", "repositories"]) {
      expect(
        readMadpMessage(event({ type: "madp:navigate", version: 1, destination }), frame, origin),
      ).toEqual({ type: "madp:navigate", version: 1, destination });
    }
  });

  it("accepts bounded branch requests and only matches connected repository identities", () => {
    const request = {
      type: "madp:repo-branches",
      version: 1,
      requestId: "request-1",
      repository: "org/app",
    };
    expect(readMadpMessage(event(request), frame, origin)).toEqual(request);
    for (const invalid of ["../app", "org/..", "https://github.com/org/app", "org/app/other"]) {
      expect(readMadpMessage(event({ ...request, repository: invalid }), frame, origin)).toBeNull();
    }
    expect(readMadpMessage(event({ ...request, requestId: "" }), frame, origin)).toBeNull();
    expect(
      readMadpMessage(event({ ...request, requestId: "x".repeat(129) }), frame, origin),
    ).toBeNull();
    for (const repoUrl of [
      "https://github.com/Org/App",
      "https://github.com/org/app.git",
      "git@github.com:org/app.git",
    ]) {
      expect(isConnectedRepository("org/app", [{ itemId: "r", repoName: "app", repoUrl }])).toBe(
        true,
      );
    }
    expect(
      isConnectedRepository("other/app", [
        { itemId: "r", repoName: "app", repoUrl: "https://github.com/org/app" },
      ]),
    ).toBe(false);
    expect(
      isConnectedRepository("org/app", [
        { itemId: "r", repoName: "app", repoUrl: "https://github.com.attacker.example/org/app" },
      ]),
    ).toBe(false);
  });

  it("rejects sibling windows, other origins, and unrecognized protocol messages", () => {
    const ready = { type: "madp:ready", version: 1 };
    expect(readMadpMessage(event(ready, { source: {} as Window }), frame, origin)).toBeNull();
    expect(
      readMadpMessage(event(ready, { origin: "https://other.example" }), frame, origin),
    ).toBeNull();
    expect(readMadpMessage(event(ready), null, origin)).toBeNull();
    for (const data of [
      null,
      "madp:ready",
      { ...ready, version: 2 },
      { type: "madp:navigate", version: 1, destination: "https://other.example" },
    ]) {
      expect(readMadpMessage(event(data), frame, origin)).toBeNull();
    }
  });

  it("validates shared-session refresh request identity without accepting tokens", () => {
    const request = {
      type: "madp:session-refresh",
      version: 1,
      requestId: "refresh-1",
      tenantId: "tenant-1",
    };
    expect(
      readMadpMessage(event({ ...request, accessToken: "not-forwarded" }), frame, origin),
    ).toEqual(request);
    for (const invalid of [
      { ...request, tenantId: "" },
      { ...request, tenantId: "x".repeat(201) },
      { ...request, tenantId: null },
      { ...request, requestId: "" },
      { ...request, requestId: "x".repeat(129) },
      { ...request, version: 2 },
    ])
      expect(readMadpMessage(event(invalid), frame, origin)).toBeNull();
    expect(readMadpMessage(event(request, { source: {} as Window }), frame, origin)).toBeNull();
    expect(
      readMadpMessage(event(request, { origin: "https://other.example" }), frame, origin),
    ).toBeNull();
  });
});
