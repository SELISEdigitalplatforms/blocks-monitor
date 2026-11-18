/** The build's progress line in plain words. A real build (the official MADP engine's lanes) reports each lane step as
 *  "<Building CR-006>: <step name> <step outcome>" (server/local/engine/kinds/delivery.ts laneMoves), for example
 *  "Building CR-006: file-map 24986 chars for 2 repo(s)". The step names and their outcomes are the engine's own words
 *  and never reach people: on the web read path (src/blocks/engine/types.ts toEngineJob) such a line becomes
 *  "Building CR-006: reading the code" while the build runs, "The build of CR-006 stopped while reading the code." once
 *  it stopped (failed or cancelled), and "The build of CR-006 finished." once it succeeded. Any other line is returned
 *  unchanged. Pure; the engine's writes are not touched (their raw steps stay in the lane's log). */

/** What each lane step does, in plain words (keyed by the step's family: the step name without its "02-" order, its
 *  "[repo]" and its "-2" retry). */
const STEP_WORDS: Readonly<Record<string, string>> = {
  load: "getting the product ready",
  preflight: "checking the set-up",
  login: "signing in to Blocks",
  isolate: "preparing its own copy of the code",
  "file-map": "reading the code",
  plan: "planning the work",
  locate: "finding the code to change",
  lock: "reserving the files to change",
  dev: "writing the code",
  ownership: "checking each change stays in its own files",
  integrate: "putting the changes together",
  gate: "running the automatic checks",
  verify: "running the automatic checks",
  check: "running the automatic checks",
  validate: "running the automatic checks",
  suites: "running the tests",
  test: "running the tests",
  e2e: "testing the app end to end",
  review: "reviewing the code",
  secops: "checking security",
  secrets: "checking security",
  fix: "fixing what the checks found",
  "fix-up": "fixing what the checks found",
  "pre-fix": "fixing what the checks found",
  "conflict-fix": "fixing what the checks found",
  conflict: "fixing what the checks found",
  revert: "undoing a part that did not pass",
  commit: "saving the changes",
  "commit+push": "saving the changes",
  push: "sending the changes to the development branch",
  pull: "getting the latest code",
  sync: "getting the latest code",
  refresh: "getting the latest code",
  deploy: "putting it on the development environment",
  smoke: "trying the app on development",
  "post-deploy": "finishing the steps after the deploy",
  release: "releasing it",
  accept: "checking the acceptance criteria",
  "generate-uilm-file": "updating the texts",
  tenant: "updating the texts",
  quiet: "waiting for the environment",
  wait: "waiting for the environment",
  "warm-up": "waiting for the environment",
  HOLD: "waiting",
};

/** "<Building|Updating> <what>: <rest>" */
const LINE = /^(Building|Updating) ([^:\n]{1,120}): ([\s\S]+)$/;
/** A fix round's lane: "Fixing CR-006 (round 1): <rest>" (server/local/engine/kinds/delivery.ts fixRound). */
const FIX_LINE = /^Fixing ([^:\n]{1,120}) \(round (\d{1,3})\): ([\s\S]+)$/;
/** A revert's lane: "Putting development back without CR-006: <rest>". */
const BACK_LINE = /^Putting development back without ([^:\n]{1,120}): ([\s\S]+)$/;
/** The step name at the start of the rest: an optional "02-" order, the name, an optional "[repo]" and "-2" retry. */
const STEP = /^(?:\d{2}-)?(HOLD|[a-z][a-z0-9]*(?:[+-][a-z][a-z0-9]*)*)(?:\[[^\]\n]*\])?(?:-\d+)?(?=\s|$)/;

/** The plain words of a lane step name ("file-map" -> "reading the code"), or null when it is not a lane step. */
export function laneStepWords(rest: string): string | null {
  const m = STEP.exec(rest.trim());
  if (!m) return null;
  const name = m[1]!;
  // the full name first ("fix-up", "post-deploy"), then its first part ("04-test suites" -> "test")
  return STEP_WORDS[name] ?? STEP_WORDS[name.split(/[+-]/)[0]!] ?? null;
}

/** "The build of CR-006" / "The update of milestone 2" */
const whatOf = (verb: string, what: string): string => `${verb === "Updating" ? "The update" : "The build"} of ${what}`;

/** The step a lane line is at, in plain words ("reading the code"), or null for any other line. */
export function laneLineStep(message: string): string | null {
  const t = message.trim();
  const rest = LINE.exec(t)?.[3] ?? FIX_LINE.exec(t)?.[3] ?? BACK_LINE.exec(t)?.[2];
  return rest ? laneStepWords(rest) : null;
}

/** A build job's line with any lane step in plain words; every other line as it is. A fix round's and a revert's lanes
 *  read as what they do: "Fixing what the checks found in CR-006 (round 1): reading the code", "Fix round 1 of CR-006
 *  stopped while …", "Putting development back without CR-006: …". */
export function plainLaneLine(status: string, message: string): string {
  const stopped = status === "failed" || status === "cancelled";
  const fix = FIX_LINE.exec(message.trim());
  if (fix) {
    const [, what, round, rest] = fix;
    const doing = laneStepWords(rest!);
    if (!doing) return message;
    if (stopped) return `Fix round ${round} of ${what} stopped while ${doing}.`;
    if (status === "succeeded") return `Fix round ${round} of ${what} finished.`;
    return `Fixing what the checks found in ${what} (round ${round}): ${doing}`;
  }
  const back = BACK_LINE.exec(message.trim());
  if (back) {
    const [, what, rest] = back;
    const doing = laneStepWords(rest!);
    if (!doing) return message;
    if (stopped) return `Putting development back without ${what} stopped while ${doing}.`;
    if (status === "succeeded") return `Development was put back without ${what}.`;
    return `Putting development back without ${what}: ${doing}`;
  }
  const m = LINE.exec(message.trim());
  if (!m) return message;
  const [, verb, what, rest] = m;
  const doing = laneStepWords(rest!);
  if (!doing) return message;
  if (status === "failed" || status === "cancelled") return `${whatOf(verb!, what!)} stopped while ${doing}.`;
  if (status === "succeeded") return `${whatOf(verb!, what!)} finished.`;
  return `${verb} ${what}: ${doing}`;
}
