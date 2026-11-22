// Publishing a build: the official MADP engine (official/) deploys every milestone and change to the product's dev
// environment on Blocks as part of its lane (deploy + smoke test), so a preview or a dev release is that address,
// checked once more before people get it. A product of the former template builder was never deployed by the official
// engine: its first preview (or dev release) deploys its dev commit as it is through the official engine first
// (official/firstDeploy.ts). Stage and production are `madp promote`: a fast-forward of the tested dev commit, deployed
// and smoke-tested by the official engine. A failure fails the job honestly.
import fs from "node:fs";
import path from "node:path";
import type { JobRun } from "../run.ts";
import { ensureApp } from "../official/app.ts";
import { answers, promote } from "../official/build.ts";
import { ensureFirstDeploy } from "../official/firstDeploy.ts";
import { failJob } from "./jobKit.ts";

/** Each smoke test of the job, as it ran, in jobs/<id>-<n>/smoke.json (the release report shows them). Best effort. */
function recordSmoke(run: JobRun, url: string, ok: boolean): void {
  const dir = run.jobDir();
  if (!dir) return;
  let list: unknown[] = [];
  try {
    const v = JSON.parse(fs.readFileSync(path.join(dir, "smoke.json"), "utf8")) as unknown;
    list = Array.isArray(v) ? v : [];
  } catch {
    list = [];
  }
  run.writeJobFile("smoke.json", [...list, { url, result: ok ? "PASS" : "FAIL", detail: ok ? "answers 200" : "no 200 answer within about a minute", checks: ["the address answers 200"], at: run.iso() }]);
}

async function liveOrFail(run: JobRun, url: string, code: string): Promise<string> {
  const ok = await answers(url);
  recordSmoke(run, url, ok);
  // the deployment itself passed; an app that is still starting answers a few minutes later
  if (!ok) return failJob(run, code, `The app at ${url.replace(/^https:\/\//, "")} did not answer within a minute of its deployment. Start it again in a few minutes; if it still does not answer, ask the engine team to look into it.`);
  return url;
}

/** A milestone preview: the dev address the milestone's build deployed (a former product's first one deploys first). */
export async function publishPreview(run: JobRun, version: string, step: (pct: number, line: string) => Promise<void>): Promise<string> {
  const app = await ensureApp(run, step);
  await ensureFirstDeploy(run, app, step);
  await step(40, `Checking ${version} at ${app.url.replace(/^https:\/\//, "")}.`);
  return liveOrFail(run, app.url, "preview.smoke_failed");
}

/** The first release to dev: the accepted build is on dev already (the official lane deployed it). */
export async function publishDevRelease(run: JobRun, version: string, step: (pct: number, line: string) => Promise<void>): Promise<string> {
  const app = await ensureApp(run, step);
  await ensureFirstDeploy(run, app, step);
  await step(40, `Checking release ${version} at ${app.url.replace(/^https:\/\//, "")}.`);
  return liveOrFail(run, app.url, "release.smoke_failed");
}

/** A promoted release: `madp promote` fast-forwards the tested dev commit to stage or production and deploys it. */
export async function publishEnvironment(run: JobRun, env: "stage" | "production", version: string, step: (pct: number, line: string) => Promise<void>): Promise<string> {
  const app = await ensureApp(run, step);
  await step(30, `Promoting ${version} to ${env} with the official MADP engine (fast-forward of the tested dev commit).`);
  const url = await promote(run, app, env);
  return liveOrFail(run, url, "release.smoke_failed");
}

/** A change released to dev: the change lane deployed it; its address. */
export async function publishChange(run: JobRun, _version: string, _buildId: string): Promise<string> {
  const app = await ensureApp(run, (p, l) => run.step(p, l));
  return liveOrFail(run, app.url, "release.smoke_failed");
}
