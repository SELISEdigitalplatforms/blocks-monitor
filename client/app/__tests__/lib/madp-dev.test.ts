import { describe, expect, it } from "vitest";
import { madpApiProxy } from "../../../madp-dev";

describe("MADP development gateway", () => {
  it("keeps the gateway prefix and selected-tenant guard while removing forged assertions", () => {
    const options = madpApiProxy("http://localhost:5001");
    expect(options.target).toBe("http://localhost:5001");
    expect(options.rewrite).toBeUndefined();
    const headers = new Map([
      ["cookie", "shell-session=opaque"],
      ["x-madp-expected-tenant", "selected-tenant"],
      ["x-madp-context", "forged"],
      ["x-madp-signature", "forged"],
      ["x-madp-body-sha256", "forged"],
    ]);
    const upstream = { getHeaderNames: () => [...headers.keys()], removeHeader: (name: string) => headers.delete(name) };
    options.configure!({ on: (name: string, callback: (request: typeof upstream) => void) => {
      if (name === "proxyReq") callback(upstream);
    } } as never, options);
    expect([...headers.keys()]).toEqual(["cookie", "x-madp-expected-tenant"]);
  });
});
