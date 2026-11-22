// The Blocks engine worker never shows invented engine results (server/blocks/engineWorker/realWorkOnly.ts): the
// board-only build is not claimed while the host's build mode is off, and the kinds without a real implementation fail
// with a plain sentence instead of a template analysis or a "documentation generated" that wrote nothing.
import { describe, expect, it } from "vitest";
import { NOT_AVAILABLE_CODE, NOT_AVAILABLE_MESSAGE, realWorkWriterOf, simulatedKinds } from "../../server/blocks/engineWorker/realWorkOnly";
import { acceptsWorkerJob, workerJobScope } from "../../server/blocks/engineWorker/jobScope";
import { JobFailure, type KindWriter } from "../../server/local/engine/run";
import { isTechnicalMessage } from "../../src/domain/jobMessage";

describe("builds on a host whose build mode is off", () => {
  it("are left for a host that builds for real", () => {
    expect(simulatedKinds({})).toEqual(["build.run", "change.build", "preview.deploy"]);
    expect(simulatedKinds({ MF_ENGINE_BUILD: "off" })).toHaveLength(3);
    expect(simulatedKinds({ MF_ENGINE_BUILD: "claude" })).toEqual([]);
    expect(simulatedKinds({ MF_ENGINE_BUILD: "codex" })).toEqual([]);
    const scope = { ...workerJobScope({}), excludedKinds: simulatedKinds({}) };
    expect(acceptsWorkerJob(scope, { Kind: "build.run", ProjectId: "p1" })).toBe(false);
    expect(acceptsWorkerJob(scope, { Kind: "preview.deploy", ProjectId: "p1" })).toBe(false);
    expect(acceptsWorkerJob(scope, { Kind: "requirements.draft", ProjectId: "p1" })).toBe(true);
  });
});

describe("kinds without a real implementation", () => {
  const base = async (): Promise<KindWriter> => async () => ({ outputs: ["X:1"], message: "done" });
  it("fail plainly with their own code", async () => {
    const writerOf = realWorkWriterOf(base);
    for (const kind of ["fix.analyse", "docs.generate"] as const) {
      const writer = await writerOf(kind);
      const failed = await writer({} as never).then(() => null, (e: unknown) => e);
      expect(failed).toBeInstanceOf(JobFailure);
      expect((failed as JobFailure).code).toBe(NOT_AVAILABLE_CODE);
      expect((failed as JobFailure).message).toBe(NOT_AVAILABLE_MESSAGE[kind]);
      // the line people see is kept as it is (plain, fits the 200 characters)
      expect(isTechnicalMessage(NOT_AVAILABLE_MESSAGE[kind]!)).toBe(false);
      expect(NOT_AVAILABLE_MESSAGE[kind]!.length).toBeLessThanOrEqual(200);
    }
  });
  it("every other kind keeps its own writer", async () => {
    const writer = await realWorkWriterOf(base)("requirements.draft");
    await expect(writer({} as never)).resolves.toEqual({ outputs: ["X:1"], message: "done" });
  });
});
