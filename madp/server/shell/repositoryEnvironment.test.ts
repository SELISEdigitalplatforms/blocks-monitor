import { describe, expect, it, vi } from "vitest";
import type { JobRun } from "../local/engine/run.ts";
import { redactedOutput, repositoryCommand, repositoryEnvironment } from "../local/engine/official/repositoryEnvironment.ts";

function run(user: string, token: string): JobRun {
  return { p: { project: { BlocksProjectRef: "D0123456789abcdef0123456789abcdef" } }, job: { RequestedByUserId: user },
    deps: { repositoryEnvironment: vi.fn(async () => ({ env: { GH_TOKEN: token }, redact: (text: string) => text.split(token).join("[redacted]") })) } } as unknown as JobRun;
}

describe("worker repository credentials", () => {
  it("keeps concurrent job identities and credentials separate", async () => {
    const first = run("user-a", "token-a"), second = run("user-b", "token-b");
    const [a, b] = await Promise.all([repositoryEnvironment(first), repositoryEnvironment(second)]);
    expect(a.env.GH_TOKEN).toBe("token-a"); expect(b.env.GH_TOKEN).toBe("token-b");
    expect(first.deps.repositoryEnvironment).toHaveBeenCalledWith(first.p.project, first.job);
    expect(second.deps.repositoryEnvironment).toHaveBeenCalledWith(second.p.project, second.job);
  });
  it("passes credentials to git and gh without changing the process or npm environment", async () => {
    const job = run("user", "private-token");
    const command = vi.fn(async (_cmd: string, _args: string[], _options: unknown) => ({ code: 0, stdout: "private-token", stderr: "" }));
    const wrapped = repositoryCommand(job, command);
    const npm = await wrapped("npm", ["ci"], { timeoutMs: 1000 });
    expect(command.mock.calls[0][2]).not.toHaveProperty("env.GH_TOKEN");
    expect(npm.stdout).toBe("private-token");
    const git = await wrapped("git", ["fetch", "origin"], { timeoutMs: 1000 });
    expect(command.mock.calls[1][2]).toHaveProperty("env.GH_TOKEN", "private-token");
    expect(git.stdout).toBe("[redacted]");
  });
  it("never emits a credential split across child-output chunks", () => {
    const write = vi.fn();
    const output = redactedOutput(text => text.replaceAll("private-token", "[redacted]"), write);
    output.push("first\nprivate-");
    expect(write).toHaveBeenCalledExactlyOnceWith("first\n");
    output.push("token\nlast private-to");
    output.push("ken");
    output.flush();
    expect(write.mock.calls.map(([value]) => value).join("")).toBe("first\n[redacted]\nlast [redacted]");
  });
});
