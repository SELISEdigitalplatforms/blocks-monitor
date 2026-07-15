import { describe, it, expect, afterEach, vi } from "vitest";
import {
  getDomain,
  isValidDomain,
  domainRegex,
  getProjectBlocksApiUrl,
} from "@/utils/domain.util";

describe("domain.util", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("isValidDomain", () => {
    it("accepts http/https URLs with a valid TLD", () => {
      expect(isValidDomain("https://example.com")).toBe(true);
      expect(isValidDomain("http://sub.example.co.uk")).toBe(true);
    });

    it("rejects URLs without a protocol", () => {
      expect(isValidDomain("example.com")).toBe(false);
    });

    it("rejects plainly invalid strings", () => {
      expect(isValidDomain("not a domain")).toBe(false);
      expect(isValidDomain("")).toBe(false);
    });

    it("trims surrounding whitespace before testing", () => {
      expect(isValidDomain("  https://example.com  ")).toBe(true);
    });
  });

  describe("domainRegex", () => {
    it("is exported and matches a valid URL", () => {
      expect(domainRegex.test("https://example.com")).toBe(true);
    });
  });

  describe("getDomain", () => {
    it("returns the last two hostname labels for a valid URL", () => {
      expect(getDomain("https://sub.example.com")).toBe("example.com");
    });

    it("returns the registrable domain for a bare host", () => {
      expect(getDomain("https://example.com")).toBe("example.com");
    });

    it("returns an empty string for an invalid domain", () => {
      expect(getDomain("nonsense")).toBe("");
    });

    it("defaults to an empty string when called with no args", () => {
      expect(getDomain()).toBe("");
    });
  });

  describe("getProjectBlocksApiUrl", () => {
    it("returns an empty string when the base URL env is unset", () => {
      vi.stubEnv("BLOCKS_MONITOR_BASE_URL", "");
      expect(
        getProjectBlocksApiUrl({ customDomain: "" } as never),
      ).toBe("");
    });

    it("returns the base URL when there is no custom domain", () => {
      vi.stubEnv("BLOCKS_MONITOR_BASE_URL", "https://api.base.com");
      expect(
        getProjectBlocksApiUrl({ customDomain: "" } as never),
      ).toBe("https://api.base.com");
    });

    it("prefixes blocksapi. onto the custom domain when present", () => {
      vi.stubEnv("BLOCKS_MONITOR_BASE_URL", "https://api.base.com");
      expect(
        getProjectBlocksApiUrl({
          customDomain: "https://sub.myapp.com",
        } as never),
      ).toBe("blocksapi.myapp.com");
    });
  });
});
