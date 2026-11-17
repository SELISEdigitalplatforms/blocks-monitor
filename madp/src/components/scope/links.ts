/** Where the scope page links to. Pure; the routes are the journey's (src/domain/journey.ts) grouped into the four
 *  steps a person sees (src/domain/phases.ts): Project understanding, Understanding your project, Goals & requirements
 *  and Scope & success are sections of the one Business Analysis page (/p/:id/analysis#<step>). */
import { buildTabPath, type JourneyPage } from "../../domain/journey";
import { isAnalysisStep, phaseOf, stepPath as phaseStepPath } from "../../domain/phases";
import { phaseName, stepName as journeyStepName } from "@/components/project/stepNames";

const encode = (id: string) => encodeURIComponent(id);

/** The page of a stored step: the Business Analysis steps open their section of /p/:id/analysis. */
export const stepPath = (id: string, step: JourneyPage): string => phaseStepPath(encode(id), step);

/** A step's page with a query (?tab=design), kept before the section anchor (/p/:id/analysis?tab=design#requirements). */
export function stepPathWith(id: string, step: JourneyPage, search: string | URLSearchParams): string {
  const query = String(search).replace(/^\?/, "");
  const path = stepPath(id, step);
  if (!query) return path;
  const hash = path.indexOf("#");
  return hash < 0 ? `${path}?${query}` : `${path.slice(0, hash)}?${query}${path.slice(hash)}`;
}

/** The name a step goes by in a link ("Open …"): a Business Analysis section keeps its own name (Scope & success), any
 *  other step is named by its phase (Project Setup, Software Engineering, Release). */
export function stepName(step: JourneyPage): string {
  if (step === "wiki") return journeyStepName("wiki");
  return isAnalysisStep(step) ? journeyStepName(step) : phaseName(phaseOf(step));
}

/** The approvals set-up opens in place on the Scope page (L8's ApprovalPolicyEditor), so the policy can be set before the build. */
export const APPROVALS_PARAM = "approvals";
export const APPROVALS_SETUP = "setup";
export const APPROVALS_SETUP_PATH = (id: string): string => stepPathWith(id, "scope", `${APPROVALS_PARAM}=${APPROVALS_SETUP}`);

export const boardPath = (id: string): string => buildTabPath(id, "board");
export const deliveredPath = (id: string): string => stepPath(id, "release");
export const requirementsDesignPath = (id: string): string => stepPathWith(id, "requirements", "tab=design");
