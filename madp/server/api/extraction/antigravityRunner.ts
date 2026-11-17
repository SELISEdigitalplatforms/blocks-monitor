/** The Antigravity CLI (Google's `agy`) as an engine runner: one headless (`--print`) call whose answer is
 *  constrained by --json-schema. Antigravity keeps its own Google sign-in; the CLI must have been run once
 *  interactively on this machine so its cached credentials are available. No streaming session, no tools:
 *  headless runs soft-deny anything that would prompt, and these calls only ask for structured text.
 *  Used by both surfaces:
 *    - server/api/extraction (this file): the extraction adapter (callAntigravity + antigravityAdapter);
 *    - server/local/engine/ai/antigravity.ts: the engine's AI runner for writer and design tasks.
 */
import { execRunner as execFile } from "../../local/engine/ai/runnerProcess.ts";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { EXTRACTION_INSTRUCTION, runnerEnvironment, type ExtractionAdapter } from "./runnerContract.ts";

export interface AntigravityCall {
  /** Structured output: the answer must be a JSON object of this shape (the CLI enforces it). */
  schema?: object;
  /** The CLI's model slug (agy models). Unset keeps the machine's own selection; never silently switched. */
  model?: string;
  /** Reasoning effort (low, medium, high, ...). Unset keeps the model's own effort. */
  effort?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

/** The terminal result event of one headless run (the same shape for --output-format json and stream-json). */
export interface AntigravityResultEvent {
  conversation_id?: string;
  status?: string;
  response?: string;
  error?: string;
  structured_output?: unknown;
}

/** The agy executable, resolved explicitly when the operator points at one. */
export function resolveAgyBinary(env: NodeJS.ProcessEnv = process.env): string {
  const set = env.MF_ENGINE_AI_ANTIGRAVITY_BINARY || env.MADP_AGY_BINARY || env.MF_EXTRACTION_ANTIGRAVITY_BINARY;
  if (set) return set;
  if (env.PATH) {
    const exe = process.platform === "win32" ? "agy.exe" : "agy";
    for (const dir of String(env.PATH).split(delimiter)) {
      if (dir && existsSync(join(dir, exe))) return join(dir, exe);
    }
  }
  return "agy";
}

/** One `agy` headless call over stream-JSON stdin (the way large prompts travel), answering the terminal result. */
export async function callAntigravity(content: string, options: AntigravityCall, env: NodeJS.ProcessEnv = process.env): Promise<AntigravityResultEvent> {
  const base = join(tmpdir(), "opencode", "madp-extraction");
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, "agy-"));
  try {
    const args = [
      "--print=",
      "--input-format", "stream-json", "--output-format", "stream-json",
      "--disable-slash-commands",
      "--dangerously-skip-permissions",
      "--print-timeout", `${Math.max(1, Math.ceil(options.timeoutMs / 1000))}s`,
      ...(options.schema ? ["--json-schema", await schemaFile(dir, options.schema)] : []),
      ...(options.model ? ["--model", options.model] : []),
      ...(options.effort ? ["--effort", options.effort] : []),
    ];
    const stdout = await new Promise<string>((resolve, reject) => {
      const child = execFile(resolveAgyBinary(env), args, {
        cwd: dir, env: runnerEnvironment("antigravity", env), windowsHide: true,
        timeout: options.timeoutMs, signal: options.signal, killSignal: "SIGKILL",
        maxBuffer: 16 * 1024 * 1024,
      }, (error, output) => {
        if (!error) return resolve(output);
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return reject(new Error("Antigravity CLI not found. Install the Antigravity CLI (agy) and sign in once interactively, or set its binary explicitly."));
        }
        reject(new Error(`Antigravity ${error.killed ? "timed out" : "failed"}. Check the Antigravity sign-in on this machine (run agy once interactively), model access, and CLI configuration.`));
      });
      child.stdin?.on("error", () => { /* the callback reports process failures */ });
      child.stdin?.end(`${JSON.stringify({ event: "user", message: { content } })}\n`);
    });
    return lastAntigravityResult(stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The answer text from one headless run: the structured (schema) payload or the plain response. */
export function parseAntigravityResult(envelope: AntigravityResultEvent, structured: boolean): string {
  if (!envelope || typeof envelope !== "object") throw new Error("Antigravity returned invalid result JSON. Check CLI compatibility.");
  if (envelope.status !== "SUCCESS") {
    throw new Error(`Antigravity did not complete successfully. ${(envelope.error || envelope.status || "No response").slice(0, 300)}`);
  }
  if (structured) {
    const output = envelope.structured_output;
    if (typeof output === "object" && output !== null) return JSON.stringify(output);
    // The docs answer carries the same payload as the response text; accept it when the model skipped the field.
    const text = typeof envelope.response === "string" ? envelope.response.trim() : "";
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object") return text;
    } catch { /* no JSON payload in the response */ }
    throw new Error("Antigravity returned no structured extraction output. Check CLI version and model support.");
  }
  if (typeof envelope.response !== "string" || !envelope.response.trim()) throw new Error("Antigravity returned an empty extraction response.");
  return envelope.response.trim();
}

/** The stream's last result event; the schema applies to the terminal event exactly like a json envelope. */
export function lastAntigravityResult(stdout: string): AntigravityResultEvent {
  let last: AntigravityResultEvent | null = null;
  for (const line of stdout.split("\n")) {
    const text = line.trim();
    if (!text) continue;
    try {
      const event = JSON.parse(text) as { event?: string; result?: AntigravityResultEvent };
      if (event?.event === "result" && event.result && typeof event.result === "object") last = event.result;
    } catch { /* a partial or foreign line: the sessions answer nothing yet */ }
  }
  if (!last) throw new Error("Antigravity returned invalid result JSON. Check CLI compatibility.");
  return last;
}

/** The timestamped workspace the child runs in; schema goes to a file because argv limits long strings. */
async function schemaFile(dir: string, schema: object): Promise<string> {
  const file = join(dir, "schema.json");
  await writeFile(file, JSON.stringify(schema), { mode: 0o600 });
  return file;
}

export const antigravityAdapter: ExtractionAdapter = {
  capabilities: { images: [], schemaConstrainedOutput: true },
  call: (prompt, input) => callAntigravity(`${EXTRACTION_INSTRUCTION}\n\n${prompt}`, {
    schema: input?.outputSchema,
    timeoutMs: 180_000,
  }).then((envelope) => parseAntigravityResult(envelope, Boolean(input?.outputSchema))),
};
