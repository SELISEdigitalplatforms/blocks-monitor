import type { JobRun } from "../run.ts";
import type { Exec } from "./attach.ts";

type Environment = { env: Record<string, string>; redact(text: string): string };
const cached = new WeakMap<JobRun, { until: number; pending: Promise<Environment> }>();

/** One job never borrows another project's credential or a host's ambient GitHub login. */
export function repositoryEnvironment(run: JobRun): Promise<Environment> {
  if (!run.deps.repositoryEnvironment) return Promise.resolve({ env: {}, redact: text => text });
  const previous = cached.get(run);
  if (previous && previous.until > Date.now()) return previous.pending;
  const pending = run.deps.repositoryEnvironment(run.p.project, run.job);
  cached.set(run, { until: Date.now() + 5 * 60_000, pending });
  pending.catch(() => cached.delete(run));
  return pending;
}

export function repositoryCommand(run: JobRun, command: Exec): Exec {
  return async (cmd, args, options) => {
    // Only GitHub-facing commands need the credential; npm install scripts never receive it here.
    if (cmd !== "git" && cmd !== "gh") return command(cmd, args, options);
    const repository = await repositoryEnvironment(run);
    const result = await command(cmd, args, { ...options, env: { ...options.env, ...repository.env } });
    return { ...result, stdout: repository.redact(result.stdout), stderr: repository.redact(result.stderr) };
  };
}

/** Keep partial lines private until the next chunk so split credential strings cannot reach logs. */
export function redactedOutput(redact: (text: string) => string, write: (safe: string) => void) {
  let pending = "";
  return {
    push(chunk: string) {
      const lines = (pending + chunk).split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) write(redact(line) + "\n");
    },
    flush() { if (pending) write(redact(pending)); pending = ""; },
  };
}
