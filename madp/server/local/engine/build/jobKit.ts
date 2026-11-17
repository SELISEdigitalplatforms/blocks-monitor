// Small helpers the delivery jobs share: the project's engine folder, an honest job failure with its own code, and the
// product's facts as rules (the same lines the design screens follow). The work itself (code, checks, commits,
// deployments) is the official MADP engine's (official/).
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { JobFailure, type JobRun } from "../run.ts";
import { contextOf } from "../../../engine-context/hooks.ts";
import { currencyOfCode } from "../../../engine-context/currency.ts";
import { projectDirs, projectDirsAt, type ProjectDirs } from "./paths.ts";

/** A job that could not finish; it is already marked failed with this code (the driver records it like any
 *  JobFailure and leaves the row as it is). */
export class BuildFailed extends JobFailure {
  constructor(code: string, message: string) {
    super(message, code);
    this.name = "BuildFailed";
  }
}

/** Marks the job failed with its own code and plain message (the engine's generic failure would hide why), then
 *  throws. Only while the job is still this attempt's. The engine's gateway makes the message plain and fits it
 *  (plainMessages.ts). */
export async function failJob(run: JobRun, code: string, message: string): Promise<never> {
  run.check();
  await run.deps.gateway.update("EngineJob", run.id, {
    Status: "failed",
    Message: message,
    ErrorCode: code,
    FinishedAt: run.iso(),
    ActiveKey: run.id,
  });
  run.log(`failed ${code}: ${message}`);
  throw new BuildFailed(code, message);
}

/** The project's engine folder: the engine's own project folder (projectFolder.ts, when the engine has MF_ENGINE_ROOT),
 *  else the same layout under MF_ENGINE_ROOT's default (build/paths.ts). */
export function dirsOf(run: JobRun): ProjectDirs {
  if (run.deps.projectFolder) return projectDirsAt(run.folder().dir);
  return projectDirs(run.workspaceId || run.p.workspaceId, run.projectId);
}

/** The project's facts as rules: the context's basics.facts (snapshot.ts) through engine-context/facts.ts factsRules,
 *  the same lines the design screens follow; without that helper, the currency alone (currency.ts). */
export async function factRules(run: JobRun): Promise<string[]> {
  let basics: { currency?: string; facts?: unknown } = {};
  try {
    basics = (await contextOf(run)).sections.basics as typeof basics;
  } catch (e) {
    run.log(`facts: the context was not read (${e instanceof Error ? e.message : String(e)})`);
  }
  const facts = basics.facts && typeof basics.facts === "object" ? basics.facts : basics.currency ? { currency: basics.currency } : {};
  try {
    const url = new URL("../../../engine-context/facts.ts", import.meta.url).href;
    if (fs.existsSync(fileURLToPath(url))) {
      const mod = (await import(/* @vite-ignore */ url)) as { factsRules?: (f: unknown) => string[] };
      if (typeof mod.factsRules === "function") {
        const lines = mod.factsRules(facts);
        if (Array.isArray(lines) && lines.length) return lines.filter((l) => typeof l === "string" && l.trim() !== "");
      }
    }
  } catch (e) {
    run.log(`facts: the facts helper was not used (${e instanceof Error ? e.message : String(e)})`);
  }
  const c = basics.currency ? currencyOfCode(basics.currency) : null;
  return [c ? `- Currency: ${c.code}. Every price, fee, payout and amount is in ${c.code}, written like "${c.format(24)}"; no other currency anywhere.` : "- Currency: the material names none. Write amounts as plain numbers without a currency sign or code."];
}
