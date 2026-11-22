import { describe, expect, it } from "vitest";
import { buildMode } from "../../server/local/engine/build/paths.ts";

describe("buildMode parameterization", () => {
  it("defaults to 'off' when no environment variable is set", () => {
    expect(buildMode({})).toBe("off");
    expect(buildMode({ MF_ENGINE_BUILD: "" })).toBe("off");
    expect(buildMode({ MF_ENGINE_BUILD: "off" })).toBe("off");
  });

  it("recognizes claude mode", () => {
    expect(buildMode({ MF_ENGINE_BUILD: "claude" })).toBe("claude");
    expect(buildMode({ MF_ENGINE_BUILD: "Claude" })).toBe("claude");
    expect(buildMode({ MF_ENGINE_BUILD_RUNNER: "claude" })).toBe("claude");
  });

  it("recognizes codex mode for local test execution", () => {
    expect(buildMode({ MF_ENGINE_BUILD: "codex" })).toBe("codex");
    expect(buildMode({ MF_ENGINE_BUILD: "CODEX" })).toBe("codex");
    expect(buildMode({ MF_ENGINE_BUILD_RUNNER: "codex" })).toBe("codex");
  });
});
