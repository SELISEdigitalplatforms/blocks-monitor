import { describe, expect, it } from "vitest";
import { promptMode } from "./chatSpace";

describe("promptMode", () => {
  it("wraps or hides by the available height", () => {
    expect(promptMode(600)).toBe("wrap");
    expect(promptMode(420)).toBe("wrap");
    expect(promptMode(416)).toBe("wrap");
    expect(promptMode(337)).toBe("wrap");
    expect(promptMode(300)).toBe("wrap");
    expect(promptMode(299)).toBe("hidden");
    expect(promptMode(0)).toBe("hidden");
  });
});
