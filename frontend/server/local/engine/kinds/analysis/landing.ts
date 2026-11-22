// The "Add-on: Landing page" section of Goals & requirements: written from the client's landing page answers together
// with the requirements draft, and again (requirements.draft, purpose "landingPage") whenever the answers change. Each
// write is for the add-on revision read right before it, so a section always matches the latest answers.
import type { JobRun } from "../../run.ts";
import {
  LANDING_FIELD, LANDING_SECTION_FIELD, landingSectionFor, parseLandingAddOn, parseLandingSection, serialiseLandingSection, type LandingContext,
} from "../../../../../src/domain/landingPage";
import { detailsFromRow } from "../../../../../src/domain/setupDetails";
import { briefFacts } from "../../../../../src/domain/projectBrief";
import type { Row } from "../../../../../functions/_lib/gateway";

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** What the project says about itself: its name, description, goal, users, website, and what it must do (the drafted
 *  Must requirements, which carry the answers from Understanding, else the setup's must-haves). */
export function landingContext(run: JobRun, row: Row): LandingContext {
  const reqs = run.p.rows("Requirement").filter((r) => text(r.Status) !== "dropped");
  const musts = [...reqs].sort((a, b) => (Number(a.SortOrder) || 0) - (Number(b.SortOrder) || 0))
    .filter((r) => text(r.Priority) === "must").map((r) => text(r.Title)).filter(Boolean);
  const setup = detailsFromRow(row as Record<string, unknown>).mustHaves.map((m) => m.text);
  // the description, goal and users wherever they are recorded (the Project brief note, the analyst's answers)
  const about = briefFacts(row, { notes: run.p.rows("DocNote"), clarifications: run.p.rows("Clarification") });
  return {
    name: text(row.Name), description: about.description, goal: about.goal, users: about.targetUsers,
    websiteUrl: text(row.WebsiteUrl), features: musts.length ? musts : setup,
  };
}

/** Writes the section when the latest answers want a landing page and it isn't written for them yet; true when written. */
export async function writeLandingSection(run: JobRun, progress: number): Promise<boolean> {
  const row = run.deps.store.get("Project", run.projectId) ?? run.p.project;
  const addOn = parseLandingAddOn(row[LANDING_FIELD]);
  const current = parseLandingSection(row[LANDING_SECTION_FIELD]);
  if (!addOn || addOn.choice === "none" || current?.revision === addOn.revision) return false;
  await run.step(progress, "Writing the landing page section from your answers.");
  await run.wait(2);
  const section = landingSectionFor(addOn, run.deps.now().toISOString(), landingContext(run, row));
  if (!section) return false;
  await run.update("Project", run.projectId, { [LANDING_SECTION_FIELD]: serialiseLandingSection(section) });
  return true;
}
