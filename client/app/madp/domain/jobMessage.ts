/**
 * The line people read on an engine job (EngineJob.Message) is always plain. Raw tool output never reaches them: no
 * stack frames, exit codes, host paths, npm or pip warnings, JSON, library error names, tokens or long dumps. A line
 * that looks like that is replaced by a plain sentence for the job's kind; the raw text belongs in the engine's log only
 * (the engine's writes pass server/local/engine/plainMessages.ts, which logs it). Lines that are already plain pass as
 * they are, cut at a sentence end when they are longer than a job line may be.
 *
 * Pure (only the kinds' type is imported): the engine, the server functions and the web use the same rules, so a row
 * written before these rules existed reads plainly too (src/blocks/engine/types.ts).
 */
import type { EngineJobKind, EngineJobStatus } from "./engineJob";

/** The longest job line people see. */
export const JOB_MESSAGE_MAX = 200;

/** What a job of each kind is called in a sentence, and what it does while it runs. */
const WORK: Readonly<Record<EngineJobKind, { what: string; doing: string }>> = {
  "requirements.draft": { what: "The requirements draft", doing: "drafting the requirements" },
  "sanitization.assist": { what: "The clarifying questions", doing: "preparing the questions" },
  "design.generate": { what: "The screen design", doing: "designing the screens" },
  "scope.draft": { what: "The scope draft", doing: "drafting the scope" },
  "scope.grill": { what: "The second opinion", doing: "reviewing the scope" },
  "scope.success": { what: "The success & performance draft", doing: "drafting the targets" },
  "milestones.suggest": { what: "The milestone plan", doing: "planning the milestones" },
  "board.plan": { what: "The work plan", doing: "planning the tickets" },
  "build.run": { what: "The build", doing: "building the milestone" },
  "change.build": { what: "The change build", doing: "building the change" },
  "change.analyse": { what: "The change analysis", doing: "analysing the change" },
  "fix.analyse": { what: "The bug analysis", doing: "analysing the report" },
  "preview.deploy": { what: "The milestone preview", doing: "deploying the preview" },
  "wiki.generate": { what: "The wiki", doing: "writing the wiki pages" },
  "docs.generate": { what: "The project documentation", doing: "writing the documents" },
  "chat.reply": { what: "The assistant", doing: "writing the reply" },
  "setup.assist": { what: "The set-up assistant", doing: "reading what you shared" },
  "feedback.apply": { what: "The work on your feedback", doing: "" },
  "file.extract": { what: "The file reader", doing: "reading this file" },
  "engine.skills-sync": { what: "The skills sync", doing: "updating Blocks skills" },
  "product.document": { what: "The product documentation", doing: "documenting the live product" },
};

const workOf = (kind: string): { what: string; doing: string } =>
  (WORK as Record<string, { what: string; doing: string }>)[kind] ?? { what: "This work", doing: "" };

/** What happens next after a failure that is not a service that did not answer, and who acts. */
const AGAIN = "Start it again; if it stops the same way again, ask the engine team to look into it.";

/** Three or more lines with text, or more text than any job line: output pasted as it came. */
const isDump = (text: string): boolean => text.length > 2000 || text.split(/\r?\n/).filter((l) => l.trim() !== "").length >= 3;

/** The signs of raw tool output, each with a name for the engine log. Hand-written job lines never show any of them. */
const TECHNICAL: readonly (readonly [string, RegExp | ((text: string) => boolean)])[] = [
  ["stack frame", /\bat\s+(?:async\s+)?[\w$.<>[\]]+(?:\s\[as [\w$]+\])?\s+\(.*:\d+:\d+\)|\bat\s+(?:file:\/\/|\/|[A-Za-z]:\\)\S*:\d+:\d+|^\s+at\s+\S/m],
  ["source line", /\b[\w.-]+\.(?:m?[jt]sx?|cjs|cts|mts|py|go|rb|rs|java|kt|cs|php)[:(]\d+\b/],
  ["python traceback", /Traceback \(most recent call last\)|\bFile "[^"]+", line \d+/],
  ["exit code", /\b(?:exit(?:ed)?|returned non-zero exit)(?:\s+with)?(?:\s+(?:code|status))?\s*[:=]?\s*-?\d+\b|\bexit (?:code|status)\b/i],
  ["signal", /\bSIG(?:TERM|KILL|INT|SEGV|ABRT|HUP|PIPE|BUS)\b/],
  ["system error", /\b(?:ENOENT|EACCES|EPERM|EEXIST|ENOTDIR|EISDIR|ENOTEMPTY|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|EAI_AGAIN|EADDRINUSE|ENOSPC|EMFILE|EBUSY|ERR_[A-Z0-9_]{3,})\b/],
  ["host path", /(?:^|[\s"'`(=:,[])(?:~\/|\/(?:srv|home|tmp|var|usr|opt|etc|root|mnt|proc|private|Users|Volumes|workspace)\/)|\b[A-Za-z]:\\[^\s]|\\\\[\w.-]+\\|file:\/\/\/|\bnode_modules\b/],
  ["package manager", /\b(?:npm|npx|pnpm|yarn)\s+(?:warn|WARN|ERR!?|error|ERROR|notice|verb|info)\b|\bgyp\s+(?:ERR!|info)\b|\bpip3?\s+(?:install|WARNING|ERROR)\b|^\s*(?:WARNING|ERROR|DEPRECATION):\s/m],
  ["package version", /(?:^|[\s(])@?[\w.-]+(?:\/[\w.-]+)?@[\^~]?\d+\.\d+\.\d+/],
  ["json", /^\s*(?:\{[\s\S]*\}|\[\s*(?:[{["\d-]|true|false|null)[\s\S]*\])\s*$|\{\s*\\?"[\w$@.-]+\\?"\s*:/],
  ["library error", /(?:^|[\s:([])(?:Uncaught\s+)?(?:[A-Z][A-Za-z0-9]*)?(?:Error|Exception)(?:\s*\[[A-Z0-9_]+\])?:\s|(?:^|\s)(?:fatal|error|panic|warning):\s|\berror TS\d{3,5}\b|\bCommand failed\b/],
  ["runtime error", /\bCannot read propert(?:y|ies) of (?:undefined|null)\b|\bis not a function\b|\bUnexpected (?:token|end of JSON input)\b|\bMaximum call stack size exceeded\b/],
  ["http status", /\b(?:status code|HTTP(?:\/\d(?:\.\d)?)?)\s*[1-5]\d\d\b/i],
  ["token", /\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,}|eyJ[\w-]{10,}\.[\w-]{10,})|\bBearer\s+\S{16,}/],
  ["terminal colours", /\x1b\[[0-9;]*[A-Za-z]/],
  ["long token", /\S{101}/],
  ["dump", isDump],
];

/** The name of the first sign of raw tool output in the text, or null when it reads as a plain line. */
export function technicalSignal(text: string): string | null {
  for (const [name, rule] of TECHNICAL) if (typeof rule === "function" ? rule(text) : rule.test(text)) return name;
  return null;
}

/** True when the text looks like raw tool output rather than a line for people. */
export function isTechnicalMessage(text: string): boolean {
  return technicalSignal(text) !== null;
}

/** Signs that a failure was a service that did not answer in time (worth starting again soon, not a defect). */
const TRANSIENT = /\b(?:ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|timed? ?out|50[234]|(?:service |temporarily )?unavailable|fetch failed|rate limit(?:ed)?|overloaded)\b/i;

/** True when the raw text says a service did not answer (a timeout, a reset connection, 502/503/504). */
export function isTransientFailure(raw: string): boolean {
  return TRANSIENT.test(raw);
}

const NOT_A_STEP = /^(?:During|Warning|Missing|Pending|Nothing|Something|Anything|Everything|String|Thing|Being|Bring|Ping|Spring)\b/;

/** The step a raw failure names in plain words before its colon ("Setting up the product: … exit 1 …" -> "setting up
 *  the product"), or "" when it names none. */
export function failedStepOf(raw: string): string {
  const m = /^([A-Z][a-z]+ing(?: [A-Za-z'’&-]+){1,7}?)(?::\s|\s+(?:stopped|failed|did not)\b)/.exec(raw.trim());
  if (!m || NOT_A_STEP.test(m[1]!)) return "";
  return m[1]!.charAt(0).toLowerCase() + m[1]!.slice(1);
}

/** The text cut to `max` characters at the end of a sentence (else at a word, with "…"); shorter text as it is. */
export function fitMessage(text: string, max = JOB_MESSAGE_MAX): string {
  const t = text.trim();
  if (t.length <= max) return t;
  let end = -1;
  for (const m of t.matchAll(/[.!?](?=\s|$)/g)) {
    if (m.index! + 1 > max) break;
    end = m.index! + 1;
  }
  if (end >= 40) return t.slice(0, end);
  const head = t.slice(0, max);
  const space = head.lastIndexOf(" ", max - 1);
  return `${head.slice(0, space > 40 ? space : max - 1).replace(/[\s,;:.-]+$/, "")}…`;
}

/** The plain failure sentence of a kind, with what happens next and who acts: "The build stopped while building the
 *  milestone. Start it again; if it stops the same way again, ask the engine team to look into it." A failure of a
 *  service that did not answer asks for a new start in a few minutes instead. `step` (plain words) replaces the kind's
 *  own activity. */
export function failureSentence(kind: string, o: { step?: string; transient?: boolean } = {}): string {
  const w = workOf(kind);
  const doing = o.step || w.doing;
  const head = `${w.what} stopped${doing ? ` while ${doing}` : ""}`;
  return o.transient ? `${head}: a service it needs did not answer in time. Start it again in a few minutes.` : `${head}. ${AGAIN}`;
}

/** The line a failed job shows: the given one when it is plain (fitted), else the kind's plain sentence. */
export function plainFailureMessage(kind: string, message: string | null | undefined): string {
  const text = (message ?? "").trim();
  if (!text) return failureSentence(kind);
  if (isTechnicalMessage(text)) return failureSentence(kind, { step: failedStepOf(text), transient: isTransientFailure(text) });
  return fitMessage(text);
}

/** The line a job shows in any status: plain lines fitted; raw output on a failed job becomes the kind's failure
 *  sentence, on a finished one "<what> finished.", and on a job still at work null (keep the line it had). */
export function plainJobMessage(kind: string, status: EngineJobStatus | string, message: string): string | null {
  if (status === "failed") return plainFailureMessage(kind, message);
  const text = message.trim();
  if (!text || !isTechnicalMessage(text)) return fitMessage(text);
  return status === "succeeded" ? `${workOf(kind).what} finished.` : null;
}

/** A job the system stopped after the longest time its kind may run. */
export function timeLimitMessage(kind: string, maxRunMs: number): string {
  const minutes = Math.round(maxRunMs / 60_000);
  const span = minutes >= 120 && minutes % 60 === 0 ? `${minutes / 60} hours` : `${minutes} minutes`;
  return `${workOf(kind).what} ran longer than its limit of ${span}, so it was stopped. ${AGAIN}`;
}

/** A job the engine picked up as often as a job may be and never finished. */
export function attemptsMessage(kind: string, attempts: number): string {
  return `${workOf(kind).what} was started ${attempts} times and did not finish. Ask the engine team to look into it, then start it again.`;
}
