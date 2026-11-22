import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serializedBlocks } from "../../server/blocks/cliQueue.ts";
import { restoreSharedBlocksAccount, runSharedBlocksCommand, sharedBlocksSession, type SharedBlocksCommandOptions } from "../../server/blocks/sharedCliSession.ts";

const firstTenant = `D${"1".repeat(32)}`;
const secondTenant = `D${"2".repeat(32)}`;
const session = { account: "provisioning", store: "" };
let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "madp-shared-cli-"));
  session.store = path.join(tmp, "cli");
  fs.mkdirSync(session.store);
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function cliArgs(argv: string[]): string[] {
  const encoded = /FromBase64String\('([^']+)'\)/.exec(argv.at(-1) ?? "")?.[1];
  return encoded ? JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) : argv;
}

function fakeCli(onOperation: (tenant: string) => Promise<void> = async () => undefined, selected = "") {
  const calls: string[] = [];
  const run: NonNullable<SharedBlocksCommandOptions["run"]> = async (_file, argv, options) => {
    const args = cliArgs(argv);
    expect(options.env?.BLOCKS_CONFIG_DIR).toBe(session.store);
    expect(args.slice(-4)).toEqual(["--account", session.account, "--api-url", "https://api.seliseblocks.com"]);
    const success = (data: unknown = {}) => ({ stdout: JSON.stringify(data), stderr: "" });
    switch (args[0]) {
      case "auth": {
        const pin = args.indexOf("--project");
        const inProject = selected && (pin < 0 || args[pin + 1] === selected);
        return success({
          accountAccessToken: selected ? "missing" : "expired",
          accountRefreshToken: selected ? "missing" : "valid",
          projectAccessToken: inProject ? "valid" : "missing",
          projectRefreshToken: inProject ? "valid" : "missing",
        });
      }
      case "use":
        expect(selected).toBe("");
        selected = args[1]!;
        calls.push(`use ${selected}`);
        return success();
      case "deselect":
        expect(options.signal).toBeUndefined();
        if (args.includes("--project")) expect(args[args.indexOf("--project") + 1]).toBe(selected);
        calls.push(`deselect ${selected}`);
        selected = "";
        return success();
      default: {
        const target = args[args.indexOf("--project") + 1]!;
        expect(target).toBe(selected);
        calls.push(`run ${target}`);
        await onOperation(target);
        return success({ tenant: target });
      }
    }
  };
  return { calls, run, selected: () => selected };
}

describe("shared Blocks CLI session", () => {
  it("uses the provisioning account and store, with an operator opt-out", () => {
    const env = { MF_BLOCKS_PROVISIONING_ACCOUNT: "provisioning", BLOCKS_CONFIG_DIR: session.store };
    expect(sharedBlocksSession(env)).toMatchObject(session);
    expect(sharedBlocksSession({ ...env, MF_BLOCKS_SHARED_SESSION: "false" })).toBeUndefined();
    expect(sharedBlocksSession({})).toBeUndefined();
  });

  it("keeps concurrent tenant operations and provisioning in their proper account mode", async () => {
    let releaseFirst!: () => void;
    let enteredFirst!: () => void;
    const blocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const entered = new Promise<void>((resolve) => { enteredFirst = resolve; });
    const fake = fakeCli(async (tenant) => {
      if (tenant === firstTenant) {
        enteredFirst();
        await blocked;
      }
    });
    const cmd = ["release", "repos", "list", "--json"];
    const first = runSharedBlocksCommand(session, firstTenant, cmd, fake);
    await entered;
    const provisioning = serializedBlocks(async () => {
      expect(fake.selected()).toBe("");
      fake.calls.push("provision");
    });
    const second = runSharedBlocksCommand(session, secondTenant, cmd, fake);
    expect(fake.calls).toEqual([`use ${firstTenant}`, `run ${firstTenant}`]);
    releaseFirst();
    await expect(Promise.all([first, provisioning, second])).resolves.toHaveLength(3);
    expect(fake.calls).toEqual([
      `use ${firstTenant}`, `run ${firstTenant}`, `deselect ${firstTenant}`, "provision",
      `use ${secondTenant}`, `run ${secondTenant}`, `deselect ${secondTenant}`,
    ]);
  });

  it("recovers a stale tenant and restores account mode even when the operation fails", async () => {
    const fake = fakeCli(async () => { throw new Error("child output should stay private"); }, firstTenant);
    await expect(runSharedBlocksCommand(session, secondTenant, ["release", "repos", "list"], fake)).rejects.toMatchObject({ code: "command_failed" });
    expect(fake.calls).toEqual([`deselect ${firstTenant}`, `use ${secondTenant}`, `run ${secondTenant}`, `deselect ${secondTenant}`]);
    expect(fake.selected()).toBe("");
  });

  it("saves the tenant beside the CLI store if cleanup is interrupted", async () => {
    const fake = fakeCli();
    const interrupt: NonNullable<SharedBlocksCommandOptions["run"]> = async (file, argv, options) => {
      if (cliArgs(argv)[0] === "deselect") throw new Error("interrupted cleanup");
      return fake.run(file, argv, options);
    };
    await expect(runSharedBlocksCommand(session, firstTenant, ["release", "repos", "list"], { run: interrupt })).rejects.toMatchObject({ code: "restore_failed" });
    const markers = fs.readdirSync(tmp).filter((name) => name.endsWith(".tenant"));
    expect(markers).toHaveLength(1);
    expect(fs.readFileSync(path.join(tmp, markers[0]!), "utf8")).toBe(firstTenant);
    expect(fs.readdirSync(session.store)).toEqual([]);
    await serializedBlocks(() => restoreSharedBlocksAccount(session, fake.run));
    expect(fake.selected()).toBe("");
    expect(fs.readdirSync(tmp)).toEqual(["cli"]);
  });

  it("rejects caller-controlled session flags and cancelled work", async () => {
    const fake = fakeCli();
    await expect(runSharedBlocksCommand(session, firstTenant, ["release", "repos", "list", `--project=${secondTenant}`], fake)).rejects.toMatchObject({ code: "invalid_context" });
    await expect(runSharedBlocksCommand(session, firstTenant, ["release", "repos", "list"], { ...fake, signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "cancelled" });
    expect(fake.calls).toEqual([]);
  });
});
