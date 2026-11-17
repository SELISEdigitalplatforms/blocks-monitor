/** Which project the dashboard focuses: the newest with an active build job, else the most recently updated. */
import { byRecent, liveNow, type DashJob, type DashProject } from "@/domain/dashboard";

export { byRecent, liveNow };

/** The project "Live now" shows; null for an empty workspace. */
export function latestProject(projects: readonly DashProject[], jobs: readonly DashJob[] = []): DashProject | null {
  return liveNow(projects, jobs)?.project ?? null;
}
