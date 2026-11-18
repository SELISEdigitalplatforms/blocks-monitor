import { PHASES, PHASE_LABEL } from "@/madp/domain/phases";
import type { StageId } from "@/madp/data/types";
import { t } from "@/madp/i18n";

/** The four steps as Home and Projects show them, by name (live and delivered are one step: Release). */
export const STEPS = PHASES.map((p) => PHASE_LABEL[p]) as unknown as readonly [
  "Project Setup", "Business Analysis", "Software Engineering", "Release",
];

/** The agent role per pipeline stage ("Deploy: checking that the live app answers", never "SELISE Blocks: deploying to SELISE Blocks").
 *  Steps 01 and 02 read as the 3D office names them: the business analyst and the tech lead (owner, 08.11.2026). */
export const AGENT_NAME: Record<StageId, string> = {
  get "01"() { return t("build.roles.planner", "Business analyst"); },
  get "02"() { return t("build.roles.dev", "Tech lead"); },
  get "03"() { return t("build.agents.reviewer", "Reviewer"); },
  get "04"() { return t("build.agents.tester", "Tester"); },
  get "05"() { return t("build.agents.secops", "SecOps"); },
  get "06"() { return t("build.pipeline.docs.name", "Docs"); },
  get "07"() { return t("build.pipeline.gate.name", "Release gate"); },
  get deploy() { return t("build.agents.deploy", "Deploy"); },
};
