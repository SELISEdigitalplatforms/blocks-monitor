import { describe, expect, it } from "vitest";
import { buildCsp, DOC_CSP_INPUT } from "../../server/security/csp";

describe("published Make iframe policy", () => {
  it("allows only the published runtime, not the editor, arbitrary hosts or same-origin pages", () => {
    const policy = buildCsp(DOC_CSP_INPUT);
    expect(policy.header).toBe("Content-Security-Policy");
    expect(policy.value.split("; ").find((d) => d.startsWith("frame-src "))).toBe("frame-src 'self' https://*.figma.site");
    expect(policy.value).toContain("frame-ancestors 'none'");
    expect(policy.value).toContain("object-src 'none'");
  });
});
