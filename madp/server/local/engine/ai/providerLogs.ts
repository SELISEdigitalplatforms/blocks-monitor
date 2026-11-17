// A failed provider CLI run must be diagnosable without leaking credentials into job artifacts or the UI.
import fs from "node:fs";
import path from "node:path";

/** Bounds and redacts provider output: no bearer tokens, environment values, or long unidentifiable strings. */
export function sanitizeProviderOutput(text: string | undefined): string {
  return (text ?? "")
    .split(/\r?\n/)
    .map((line) => line
      .replace(/(Bearer|token|key|secret|password|authorization)\s*['":=\s]+\S[^"'\s]*/gi, "$1 <redacted>")
      .replace(/\$\{[^}]{1,120}\}/g, "<env>")
      .replace(/[?&](current_user[a-z_]*|org|session)=([^&\s]+)/gi, "$1=<value>")
      .replace(/[A-Za-z0-9+/=_-]{80,}/g, "<redacted>")
      .trim())
    .filter((line) => line.length > 0)
    .slice(-60)
    .join("\n")
    .slice(-10_000);
}

/** Keeps a failed run's sanitized provider output in the job workspace and attaches a short honest tail to the error. */
export function providerExitError(o: { directory: string; runner: string; base: string; stdout?: string; stderr?: string }): Error {
  const stdout = sanitizeProviderOutput(o.stdout);
  const stderr = sanitizeProviderOutput(o.stderr);
  try {
    fs.writeFileSync(
      path.join(o.directory, "provider-error.log"),
      `An "${o.runner}" provider run failed and its output was redacted for these records.\n\nstdout:\n${stdout}\n\nstderr:\n${stderr}\n`,
      { mode: 0o600 },
    );
  } catch { /* diagnostics must never fail the job */ }
  const tail = (stderr || stdout).split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 240);
  return tail ? new Error(`${o.base} Its provider output ends with: ${tail}`) : new Error(o.base);
}
