import { describe, it, expect } from "vitest";
import { deepEqual } from "@/utils/equal.util";

describe("deepEqual", () => {
  it("returns true for identical primitives", () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual("a", "a")).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
  });

  it("returns false for different primitives", () => {
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual("a", "b")).toBe(false);
  });

  it("returns false when one side is null", () => {
    expect(deepEqual(null, {})).toBe(false);
    expect(deepEqual({}, null)).toBe(false);
  });

  it("returns true for the same reference", () => {
    const obj = { a: 1 };
    expect(deepEqual(obj, obj)).toBe(true);
  });

  it("compares nested objects structurally", () => {
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it("returns false when key counts differ", () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it("returns false when keys differ but count matches", () => {
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
  });

  it("compares arrays element-wise", () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it("returns false comparing an object with a non-object", () => {
    expect(deepEqual({ a: 1 }, 5)).toBe(false);
  });
});
