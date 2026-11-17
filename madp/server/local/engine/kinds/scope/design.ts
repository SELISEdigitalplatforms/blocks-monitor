// Product design: explicit Factory-managed revisions or the legacy Make integration. Never fall back to screenshots.
import { JobFailure, type JobRun, type KindResult } from "../../run.ts";
import { str } from "../../context.ts";
import { generateMake } from "./figmaMake.ts";
import { generateFactoryDesign } from "./factoryDesign.ts";
import { generateFigmaScreens } from "./figmaScreens.ts";

export async function designGenerate(run: JobRun): Promise<KindResult> {
  const briefId = str(run.input.designBriefId);
  const brief = briefId ? run.p.row("DesignBrief", briefId) : run.p.designBrief();
  if (!brief || brief.Mode !== "figma" || typeof run.input.source !== "string" || !run.input.source) {
    throw new JobFailure("This screenshot-era design request cannot produce a Make prototype. Request the interactive design from Look & feel; screenshot generation has been replaced by Figma Make.", "design.figmaRequestRequired");
  }
  return run.input.workflow === "screens" ? generateFigmaScreens(run, brief) : run.input.workflow === "factory" ? generateFactoryDesign(run, brief) : generateMake(run, brief);
}
