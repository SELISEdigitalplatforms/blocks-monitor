import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { authenticateWithGithub, verifyOAuthState } from "@/services/providers.service";

describe("providers.service", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("authenticateWithGithub", () => {
    it("opens a GitHub OAuth URL with scopes and a random state", () => {
      const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
      vi.stubEnv("BLOCKS_GITHUB_CLIENT_ID", "client-123");

      authenticateWithGithub(undefined, "proj-1");

      expect(openSpy).toHaveBeenCalledTimes(1);
      const url = new URL(openSpy.mock.calls[0][0] as string);
      expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
      expect(url.searchParams.get("client_id")).toBe("client-123");
      expect(url.searchParams.get("scope")).toContain("repo");
      expect(url.searchParams.get("state")).toMatch(/^[0-9a-f]{64}$/);
    });

    it("persists auth state, destination, and project key to localStorage", () => {
      vi.spyOn(window, "open").mockReturnValue(null);
      localStorage.setItem("destination", "/somewhere");

      authenticateWithGithub(undefined, "proj-7");

      expect(localStorage.getItem("github_auth_destination")).toBe("/somewhere");
      expect(localStorage.getItem("github_auth_state")).toMatch(/^[0-9a-f]{64}$/);
      expect(localStorage.getItem("github_auth_project_key")).toBe("proj-7");
    });

    it("defaults the destination to / and skips project key when absent", () => {
      vi.spyOn(window, "open").mockReturnValue(null);

      authenticateWithGithub();

      expect(localStorage.getItem("github_auth_destination")).toBe("/");
      expect(localStorage.getItem("github_auth_project_key")).toBeNull();
    });
  });

  describe("verifyOAuthState", () => {
    it("returns true when the received state matches the stored state", () => {
      localStorage.setItem("github_auth_state", "abc");
      expect(verifyOAuthState("abc")).toBe(true);
    });

    it("returns false on a mismatch", () => {
      localStorage.setItem("github_auth_state", "abc");
      expect(verifyOAuthState("xyz")).toBe(false);
    });

    it("returns false when a value is received but nothing is stored", () => {
      localStorage.clear();
      expect(verifyOAuthState("anything")).toBe(false);
    });

    it("treats null-vs-null (no stored, no received) as a match", () => {
      localStorage.clear();
      expect(verifyOAuthState(null)).toBe(true);
    });
  });
});
