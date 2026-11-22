// engine.skills-sync: updates the official Blocks skills in the MADP engine repo.
import path from "node:path";
import { JobFailure, type JobRun, type KindResult } from "../run.ts";
import { officialHome, madpPython } from "../official/home.ts";
import { execRunner } from "../ai/runnerProcess.ts";

export async function syncSkills(run: JobRun): Promise<KindResult> {
  await run.step(10, "Syncing Blocks skills with official upstream...");
  const home = officialHome();
  const py = madpPython();
  const args = ["-B", "-m", "MADP.orchestrator.cli.project", "run", "blocks-skill-sync", "--force"];

  await run.step(40, "Updating vendored skills...");

  const env = {
    ...process.env,
    PYTHONPATH: home + (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : ""),
  };

  await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execRunner(
      py,
      args,
      { cwd: home, env, timeout: 120_000, signal: run.signal },
      (err, stdout, stderr) => {
        if (err) {
          const detail = (stderr || stdout || err.message).trim().slice(0, 180);
          reject(new JobFailure(`Skill sync failed: ${detail}`, "engine.skillsSyncFailed"));
        } else {
          resolve({ stdout, stderr });
        }
      }
    );
  });

  await run.step(100, "Blocks skills updated successfully.");
  return {
    outputs: [],
    message: "Blocks skills synced successfully",
  };
}

export const WRITERS = {
  "engine.skills-sync": syncSkills,
};
