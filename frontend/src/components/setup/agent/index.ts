/** The business agent of the Project setup page: one calm line about its work and the window to review what it found.
 *  Render <SetupAgentLine projectId={…} /> in the page's layout; everything else (waking it, polling, the review) is
 *  inside. Rules: src/domain/setupAgent.ts; the work itself: server/local/engine/kinds/setup.ts. */
export { SetupAgentLine, type SetupAgentLineProps } from "./SetupAgentLine";
export { SetupAgentReview, type SetupAgentReviewProps } from "./SetupAgentReview";
export { useSetupAgent, wakeSetupAgent, decideSuggestions, type SetupAgentState } from "./data";
