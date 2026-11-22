// The tech lead's advice for parallel streams (Project.StreamsAdvice, src/domain/parallelStreams.ts) from the product's
// set-up on this host: the installed engine's `--merge-turn`, its repositories ready for separate working copies, its
// environment's limits on check runs (streams.ts adviceOf). Written after a change analysis and at the start of a change
// build, only when it changed; a tenant without the field (its migration not applied yet) keeps one stream, and the
// write that fails is only logged.
import fs from "node:fs";
import path from "node:path";
import type { StreamsAdvice } from "../../../../src/domain/parallelStreams";
import type { JobRun } from "../run.ts";
import { adviceOf, adviceUpdate } from "../streams.ts";
import { engineLaneOptions } from "./build.ts";
import { parseRegistry } from "./hostRegistry.ts";

/** The advice for the product whose registry is `registry` (null when it cannot be read). */
export function streamsAdviceOf(registry: string, now: string): StreamsAdvice | null {
  try {
    const data = parseRegistry(fs.readFileSync(registry, "utf8"));
    const base = path.dirname(registry);
    return adviceOf(data, {
      engineStreams: engineLaneOptions().mergeTurn,
      hasPackages: (p) => !!p && fs.existsSync(path.join(path.isAbsolute(p) ? p : path.resolve(base, p), "package.json")),
      now,
    });
  } catch {
    return null;
  }
}

/** Computes the advice and stores it on the project when it changed; answers it (null when the registry is unreadable). */
export async function refreshStreamsAdvice(run: JobRun, registry: string): Promise<StreamsAdvice | null> {
  const advice = streamsAdviceOf(registry, run.iso());
  if (!advice) return null;
  const value = adviceUpdate(run.p.project, advice);
  if (value) {
    try {
      await run.update("Project", run.projectId, { StreamsAdvice: value });
      run.log(`parallel streams: the product allows ${advice.cap}${advice.why ? ` (${advice.why})` : ""}`);
    } catch (e) {
      run.log(`parallel streams: the advice was not stored (${e instanceof Error ? e.message.slice(0, 160) : "error"}); one stream until it is`);
    }
  }
  return advice;
}
