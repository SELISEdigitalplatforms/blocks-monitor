import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const paths = vi.hoisted(() => ({ projectsDir: "", artifactsDir: "" }));
vi.mock("../../server/api/engineBridge.ts", () => ({ paths }));
import { writeRegistry } from "../../server/api/registryWriter";

let root = "";
afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });
it("writes the actual Blocks tenant into the generated DEV registry", () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "madp-registry-target-"));
  paths.projectsDir = path.join(root, "projects");
  paths.artifactsDir = path.join(root, "artifacts");
  const data = { id: "factory-record", name: "Product", description: "", kind: "new" as const, repoUrl: "https://github.com/org/product", repoBranch: "dev", gitAuthorName: "Factory", gitAuthorEmail: "factory@example.org", blocksProjectRef: `D${"1".repeat(32)}` };
  const yaml = fs.readFileSync(writeRegistry(data), "utf8");
  expect(yaml).toContain(`tenant_id: "${data.blocksProjectRef}"`);
  expect(yaml).not.toContain("tenant_id: factory-record");
  expect(() => writeRegistry({ ...data, blocksProjectRef: "factory-record" })).toThrow("invalid_blocks_project_id");
});
