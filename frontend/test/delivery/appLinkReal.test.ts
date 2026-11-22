import { describe, expect, it } from "vitest";
import { appLink, isBlocksHosted } from "../../src/domain/appPreview";

describe("Open the app for a real deployment", () => {
  const origin = "https://factory.example.test";
  it("opens the deployed app itself on SELISE Blocks hosting", () => {
    expect(appLink({ projectId: "p1", version: "0.2.0", url: "https://dbibuw-eovkn.slsblx.com" }, origin)?.href).toBe("https://dbibuw-eovkn.slsblx.com/");
    expect(appLink({ projectId: "p1", version: "1.0.0", url: "https://app.seliseblocks.com/" }, origin)?.href).toBe("https://app.seliseblocks.com/");
  });
  it("opens it when the caller knows the deployment is real", () => {
    expect(appLink({ projectId: "p1", version: "1.0.0", url: "https://books.example.ch/", real: true }, origin)?.href).toBe("https://books.example.ch/");
  });
  it("keeps the app page for a simulated record's invented address", () => {
    expect(appLink({ projectId: "p1", version: "0.1.0", url: "https://shop.dev.client.ch" }, origin)?.href).toBe(`${origin}/preview/p1/0.1.0`);
  });
  it("recognises Blocks hosting only on its own domains", () => {
    expect(isBlocksHosted("dbibuw-eovkn.slsblx.com")).toBe(true);
    expect(isBlocksHosted("slsblx.com.evil.example")).toBe(false);
    expect(isBlocksHosted("notslsblx.com")).toBe(false);
  });
});
