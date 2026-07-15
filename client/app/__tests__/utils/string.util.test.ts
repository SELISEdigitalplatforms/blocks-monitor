import { describe, it, expect } from "vitest";
import { parseMongoDBString } from "@/utils/string.util";

describe("parseMongoDBString", () => {
  it("unwraps ObjectId(...) into a plain quoted string", () => {
    expect(parseMongoDBString('{ "_id": ObjectId("abc123") }')).toBe(
      '{ "_id": "abc123" }',
    );
  });

  it("unwraps ISODate(...) into a plain quoted string", () => {
    expect(parseMongoDBString('ISODate("2023-01-01T00:00:00Z")')).toBe(
      '"2023-01-01T00:00:00Z"',
    );
  });

  it("unwraps the { $date: ... } extended-JSON form", () => {
    expect(parseMongoDBString('{ "$date": "2023-01-01" }')).toBe(
      '"2023-01-01"',
    );
  });

  it("unwraps NumberLong(...) into a bare number", () => {
    expect(parseMongoDBString("NumberLong(42)")).toBe("42");
  });

  it("handles multiple occurrences and mixed forms together", () => {
    const input =
      '{ "_id": ObjectId("x"), "n": NumberLong(7), "d": ISODate("2020") }';
    expect(parseMongoDBString(input)).toBe(
      '{ "_id": "x", "n": 7, "d": "2020" }',
    );
  });

  it("leaves plain strings untouched", () => {
    expect(parseMongoDBString('{ "a": 1 }')).toBe('{ "a": 1 }');
  });
});
