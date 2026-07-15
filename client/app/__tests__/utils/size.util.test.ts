import { describe, it, expect } from "vitest";
import { formatSize } from "@/utils/size.util";

describe("formatSize", () => {
  it("keeps small byte values in B", () => {
    expect(formatSize(512)).toBe("512 B");
  });

  it("scales bytes up to KB/MB/GB", () => {
    expect(formatSize(1024)).toBe("1 KB");
    expect(formatSize(1024 ** 2)).toBe("1 MB");
    expect(formatSize(1024 ** 3)).toBe("1 GB");
  });

  it("honours the input unit", () => {
    expect(formatSize(1, "KB")).toBe("1 KB");
    expect(formatSize(1024, "KB")).toBe("1 MB");
    expect(formatSize(1, "GB")).toBe("1 GB");
  });

  it("respects the decimals argument", () => {
    expect(formatSize(1536, "B", 1)).toBe("1.5 KB");
    expect(formatSize(1536, "B", 0)).toBe("2 KB");
  });

  it("caps scaling at TB", () => {
    expect(formatSize(5, "TB")).toBe("5 TB");
    expect(formatSize(2048, "TB")).toBe("2048 TB");
  });

  it("trims trailing zeros via parseFloat", () => {
    expect(formatSize(1024 * 2)).toBe("2 KB");
  });
});
