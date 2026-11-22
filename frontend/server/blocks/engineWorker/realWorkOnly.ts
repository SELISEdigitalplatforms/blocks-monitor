// The Blocks engine worker runs the local engine's writers against the real Data Gateway (worker.ts). A few of those
// writers only simulate their work: on Blocks that would show people invented results as if the engine had done the
// work (frontend/CLAUDE.md: missing real engine work stays explicitly unavailable or waiting). This module keeps them off
// the Blocks worker:
//   - the builds (build.run, change.build, preview.deploy) while this host's build mode is off (build/paths.ts): the
//     board-only build writes "checks passed" and test reports nobody ran and a preview address nothing serves. They are
//     not claimed, so they wait for a host that builds for real;
//   - the bug analysis (fix.analyse) and the on-demand documentation (docs.generate), which have no real implementation
//     yet: the analysis is a template per kind of problem with invented code places and line numbers, the documentation
//     job writes nothing and says it did. They fail with a plain sentence instead.
import type { EngineJobKind } from "../../../src/domain/engineJob";
import { buildMode } from "../../local/engine/build/paths.ts";
import { JobFailure, type KindWriter } from "../../local/engine/run.ts";

/** The kinds the board-only build (build mode off) only simulates. */
export const SIMULATED_BUILD_KINDS: readonly EngineJobKind[] = ["build.run", "change.build", "preview.deploy"];

/** The kinds this worker must not claim: the builds while this host's build mode is off. The writers read the build mode
 *  from the process environment, so this does too. */
export function simulatedKinds(env: NodeJS.ProcessEnv = process.env): EngineJobKind[] {
  return buildMode(env) === "off" ? [...SIMULATED_BUILD_KINDS] : [];
}

/** The code a job of a kind without a real implementation fails with. */
export const NOT_AVAILABLE_CODE = "engine.notAvailable";

/** What people read on such a job (plain, under 200 characters). */
export const NOT_AVAILABLE_MESSAGE: Readonly<Partial<Record<EngineJobKind, string>>> = {
  "fix.analyse": "The bug analysis is not available yet. Your report is saved and the team can read it.",
  "docs.generate": "Writing the documentation on request is not available yet. Each build writes its documentation.",
};

/** writerOf for the Blocks worker: the kinds without a real implementation fail plainly; every other kind is the
 *  local engine's own writer. */
export function realWorkWriterOf(base: (kind: EngineJobKind) => Promise<KindWriter>): (kind: EngineJobKind) => Promise<KindWriter> {
  return async (kind) => {
    const message = NOT_AVAILABLE_MESSAGE[kind];
    if (message) {
      return async () => {
        throw new JobFailure(message, NOT_AVAILABLE_CODE);
      };
    }
    return base(kind);
  };
}
