import { describe, it, expect } from "vitest";
import { ErrorTransformer } from "@/utils/error-transform";

describe("ErrorTransformer", () => {
  const fallback = { non_field_error: "Something went wrong" };

  it("returns fallback for null / non-object input", () => {
    expect(ErrorTransformer(null)).toEqual(fallback);
    expect(ErrorTransformer("oops")).toEqual(fallback);
    expect(ErrorTransformer(42)).toEqual(fallback);
  });

  it("returns fallback when there is no errors object", () => {
    expect(ErrorTransformer({})).toEqual(fallback);
    expect(ErrorTransformer({ errors: "string" })).toEqual(fallback);
  });

  it("uses a string detail directly as non_field_error", () => {
    expect(ErrorTransformer({ errors: { detail: "Bad request" } })).toEqual({
      non_field_error: "Bad request",
    });
  });

  it("returns the errors object as-is when detail is not an array", () => {
    const errors = { name: "Name is required" };
    expect(ErrorTransformer({ errors })).toEqual(errors);
  });

  it("collects string entries from a detail array into non_field_error", () => {
    const result = ErrorTransformer({
      errors: { detail: ["first problem", "second problem"] },
    });
    expect(result.non_field_error).toEqual(["first problem", "second problem"]);
  });

  it("maps loc/msg entries to field names and strips body/query/path", () => {
    const result = ErrorTransformer({
      errors: {
        detail: [{ loc: ["body", "email"], msg: "invalid email" }],
      },
    });
    expect(result.email).toBe("invalid email");
  });

  it("normalizes 'field required' into a friendly capitalized message", () => {
    const result = ErrorTransformer({
      errors: {
        detail: [{ loc: ["body", "user_name"], msg: "field required" }],
      },
    });
    expect(result.user_name).toBe("User name is required");
  });

  it("accumulates multiple messages for the same field into an array", () => {
    const result = ErrorTransformer({
      errors: {
        detail: [
          { loc: ["body", "email"], msg: "too short" },
          { loc: ["body", "email"], msg: "invalid format" },
        ],
      },
    });
    expect(result.email).toEqual(["too short", "invalid format"]);
  });

  it("skips malformed entries and falls back when nothing maps", () => {
    const result = ErrorTransformer({
      errors: {
        detail: [{ loc: "not-array", msg: 5 }, null, { loc: ["body"] }],
      },
    });
    expect(result).toEqual(fallback);
  });

  it("appends to an existing string non_field_error, producing an array", () => {
    const result = ErrorTransformer({
      errors: { detail: ["one", "two", "three"] },
    });
    expect(result.non_field_error).toEqual(["one", "two", "three"]);
  });
});
