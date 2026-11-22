import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { brokerArgs, factoryBlocksEnv, withFactoryBlocks } from "../../server/blocks/sharedCliBroker.ts";
import type { JobRun } from "../../server/local/engine/run.ts";

const runCommand = vi.hoisted(() => vi.fn(async () => ({ stdout: '{"ok":true}', stderr: "" })));
vi.mock("../../server/blocks/sharedCliSession.ts", () => ({
  runSharedBlocksCommand: runCommand,
  sharedBlocksSession: () => ({ store: "/engine/private", account: "provisioner" }),
}));

const exec = promisify(execFile);
const tenant = `D${"a".repeat(32)}`;
const otherTenant = `D${"b".repeat(32)}`;
const projectId = "3bb4042b-24fd-4d49-af89-a5bf53329b87";
let dir: string;
let root: string;
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "madp-blocks-broker-")));
  root = path.join(dir, "projects", "workspace", projectId);
  fs.mkdirSync(root, { recursive: true });
  vi.stubEnv("MF_ENGINE_ROOT", dir);
  runCommand.mockClear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

function job(project: Record<string, unknown> = {}): JobRun {
  return {
    deps: {},
    workspaceId: "workspace",
    projectId,
    signal: new AbortController().signal,
    p: { project: { BlocksProjectRef: tenant, BlocksProvisioningName: `MADP Test ${projectId}`, BlocksProvisioningStatus: "ready", ...project } },
  } as unknown as JobRun;
}

describe("shared Blocks CLI broker", () => {
  it("pins the approved tenant and rejects account operations and outside file paths", () => {
    expect(brokerArgs(tenant, ["release", "repos", "list", "--project", tenant, "--json"], root, root))
      .toEqual(["release", "repos", "list", "--json"]);
    for (const argv of [
      ["release", "repos", "list", "--project", otherTenant],
      ["release", "repos", "list", "--api-url=https://somewhere.test"],
      ["release", "repos", "list", "--account", "provisioner"],
      ["projects", "get", otherTenant],
      ["projects", "create", "outside"],
      ["localization", "push", "--file", path.join(dir, "outside.json")],
    ]) expect(() => brokerArgs(tenant, argv, root, root)).toThrow();
  });

  it("runs the CLI client with a project capability and no provisioning store", async () => {
    await withFactoryBlocks(job(), async () => {
      const env = factoryBlocksEnv(tenant);
      expect(env.BLOCKS_CONFIG_DIR).toBe(path.join(root, ".blocks-cli-local"));
      expect(factoryBlocksEnv(otherTenant)).toEqual({});
      const call = (args: string[], cwd = root) => exec(env.MF_BLOCKS_BROKER_NODE!, [env.MF_BLOCKS_BROKER_CLIENT!, ...args], {
        cwd, env: { ...process.env, ...env },
      });
      const result = await call(["auth", "status", "--json"]);
      expect(JSON.parse(result.stdout)).toEqual({ ok: true });
      expect(runCommand).toHaveBeenCalledWith({ store: "/engine/private", account: "provisioner" },
        tenant, ["auth", "status", "--json"], expect.objectContaining({ cwd: root }));
      await expect(call(["release", "repos", "list"], dir)).rejects.toThrow();
      await expect(call(["projects", "get", otherTenant])).rejects.toThrow();
      const outside = path.join(dir, "outside.json");
      const linked = path.join(root, "linked.json");
      fs.writeFileSync(outside, "{}");
      fs.linkSync(outside, linked);
      await expect(call(["localization", "push", "--file", linked])).rejects.toThrow();
      const config = path.join(root, "blocks.json");
      fs.writeFileSync(config, JSON.stringify({ data: { schemas: dir, rules: "blocks/data/rules.json" } }));
      await expect(call(["data", "schema", "push", "--dry-run"])).rejects.toThrow();
      expect(runCommand).toHaveBeenCalledTimes(1);
      fs.writeFileSync(config, JSON.stringify({ data: { schemas: "blocks/data/schemas", rules: "blocks/data/rules.json" } }));
      await expect(call(["data", "schema", "push", "--dry-run"])).resolves.toHaveProperty("stdout", '{"ok":true}');
    });
    expect(factoryBlocksEnv()).toEqual({});
  });

  it("keeps attached and unprovisioned projects on their own CLI path", async () => {
    for (const project of [{ RepoMode: "existing" }, { BlocksProvisioningName: "" }]) {
      await withFactoryBlocks(job(project), async () => expect(factoryBlocksEnv()).toEqual({}));
    }
    expect(runCommand).not.toHaveBeenCalled();
  });
});
