import { describe, it, expect } from "vitest";
import {
  getErrorMessage,
  isErrorWithErrors,
  handleErrorMessages,
} from "@seliseblocks/blocks-kit/utils";

describe("getErrorMessage", () => {
  it("returns the generic message for an empty error object", () => {
    expect(getErrorMessage({})).toBe("Something went wrong.");
  });

  it("returns the generic message for a null-ish error", () => {
    expect(getErrorMessage(null as never)).toBe("Something went wrong.");
  });

  it("collects string values", () => {
    expect(getErrorMessage({ name: "Name required" })).toEqual(["Name required"]);
  });

  it("joins array values with commas", () => {
    expect(getErrorMessage({ email: ["too short", "invalid"] })).toEqual(["too short, invalid"]);
  });

  it("prefers a mapped message when the key is in messageMap", () => {
    expect(getErrorMessage({ email: "raw" }, { email: "Friendly email error" })).toEqual([
      "Friendly email error",
    ]);
  });

  it("skips empty arrays", () => {
    expect(getErrorMessage({ a: [], b: "kept" })).toEqual(["kept"]);
  });
});

describe("isErrorWithErrors", () => {
  it("is true for an object with an errors object", () => {
    expect(isErrorWithErrors({ errors: { a: "b" } })).toBe(true);
  });

  it("is false for objects without an errors object", () => {
    expect(isErrorWithErrors({ message: "x" })).toBe(false);
    expect(isErrorWithErrors({ errors: "string" })).toBe(false);
  });

  it("is false for non-objects", () => {
    expect(isErrorWithErrors(null)).toBe(false);
    expect(isErrorWithErrors("err")).toBe(false);
  });
});

describe("handleErrorMessages", () => {
  it("returns a string error unchanged", () => {
    expect(handleErrorMessages("plain error")).toBe("plain error");
  });

  it("delegates to getErrorMessage for an object", () => {
    expect(handleErrorMessages({ name: "Name required" })).toEqual(["Name required"]);
  });

  it("passes custom messages through to getErrorMessage", () => {
    expect(handleErrorMessages({ name: "raw" }, { name: "Custom" })).toEqual(["Custom"]);
  });

  it("returns the unexpected message for arrays and non-objects", () => {
    expect(handleErrorMessages([1, 2])).toBe("An unexpected error occurred.");
    expect(handleErrorMessages(123)).toBe("An unexpected error occurred.");
  });
});
