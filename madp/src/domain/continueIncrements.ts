/**
 * "Continue with the next increment when the checks pass" (Project.ContinueIncrements, written by
 * cr.continueIncrements or from the tech lead's chat): a feature on an existing product is built increment by
 * increment; with this on, once an increment's own checks pass on development (or every failure is marked "known
 * before this change"), the engine asks for the next increment of the same change by itself: a queued build that starts
 * by the same stream rules as any other. Never when the checks failed, could not run or could not judge, never past the
 * last increment, never for a change whose automatic next increment a person cancelled (that pauses the change: its
 * next build is a person's again). Off (the default): every increment waits for a person to start it. Pure.
 */

export const CONTINUE_LABEL = "Continue with the next increment when the checks pass";

export interface ContinueSetting {
  v: 1;
  on: boolean;
  /** Who set it, and when. */
  by: string;
  at: string;
}

const objectOf = (raw: unknown): Record<string, unknown> | null => {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const line = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 80) : "");

export function parseContinueSetting(raw: unknown): ContinueSetting | null {
  const o = objectOf(raw);
  if (!o || typeof o.on !== "boolean") return null;
  return { v: 1, on: o.on, by: line(o.by), at: line(o.at) };
}

export const serializeContinueSetting = (s: ContinueSetting): string => JSON.stringify({ v: 1, on: s.on, by: line(s.by), at: line(s.at) });

/** On only when someone turned it on. */
export const continueOn = (raw: unknown): boolean => parseContinueSetting(raw)?.on === true;

/** The input of an automatic next increment (a change.build): its change, its version, and that it continued by itself. */
export interface ContinuedInput {
  projectId: string;
  changeRequestId: string;
  version: string;
  continued: true;
  /** The build whose checks passed (the increment before). */
  afterJobId: string;
}

const inputOf = (raw: unknown): Record<string, unknown> => objectOf(raw) ?? {};

/** True for a build the engine asked for by itself after the increment before passed its checks. */
export const isContinued = (job: { kind: string; inputJson?: string | null } | null | undefined): boolean =>
  !!job && job.kind === "change.build" && inputOf(job.inputJson).continued === true;

/** A person paused the change: they cancelled one of its automatic next increments (pure). */
export function pausedByPerson(jobs: readonly { kind: string; status: string; inputJson?: string | null }[], changeRequestId: string): boolean {
  return jobs.some((j) => j.status === "cancelled" && isContinued(j) && inputOf(j.inputJson).changeRequestId === changeRequestId);
}

export type ContinueDecision = { go: true; next: number; of: number } | { go: false; why: string };

/** Whether the next increment starts by itself now (pure). `checks`: the status of the increment's own checks on
 *  development (ok, failed, not-run, not-judged, none); `cleared`: every failure is marked known before this change;
 *  `next`: the increment after this one (null when this was the last); `paused`: pausedByPerson. */
export function continueDecision(o: { on: boolean; checks: string; cleared: boolean; next: number | null; of: number; paused: boolean }): ContinueDecision {
  if (!o.on) return { go: false, why: "the next increment waits for a person to start it" };
  if (o.next === null || o.next > o.of) return { go: false, why: "it was the last increment" };
  if (o.paused) return { go: false, why: "a person paused this change: its next increment waits for them" };
  if (o.checks === "ok" || (o.checks === "failed" && o.cleared)) return { go: true, next: o.next, of: o.of };
  if (o.checks === "failed") return { go: false, why: "its checks failed on development" };
  if (o.checks === "none") return { go: false, why: "it has no checks on development to pass" };
  return { go: false, why: "its checks could not judge it on development" };
}

/** The line a build adds when its next increment starts by itself. */
export const continuedWords = (next: number, of: number): string =>
  `increment ${next} of ${of} starts by itself next (cancel it to pause this change)`;

/** "continue with the next increment automatically", "turn on auto continue", "stop continuing increments by
 *  themselves": on (true), off (false), or null when a message asks for neither (pure). */
export function continueAsked(text: string): boolean | null {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  if (!/\bincrements?\b|\bauto[- ]?continue\b|\bcontinu\w*\b.*\b(?:automatic|by itself|by themselves|on its own)/.test(t)) return null;
  if (!/\bcontinu\w*|\bnext increment\b|\bstart\w*\b.*\bnext\b/.test(t)) return null;
  const off = /\b(?:stop|turn off|switch off|disable|don'?t|do not|no longer|never|pause|off)\b/.test(t);
  const on = /\b(?:automatic\w*|by itself|by themselves|on its own|auto[- ]?continue|turn on|switch on|enable|always|keep going|go on)\b/.test(t) || /\bcontinue with the next increment\b/.test(t);
  if (off) return false;
  return on ? true : null;
}
