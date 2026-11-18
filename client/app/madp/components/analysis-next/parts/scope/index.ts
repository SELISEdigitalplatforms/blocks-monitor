/** The four scope parts of the next Business Analysis page: for each, the collapsed row's summary hook and the content
 *  shown when the row opens. The page shell mounts ScopeFeedbackProvider / FeedbackLayer once around them. */
import type { AnalysisCtx, PartSummary } from "../../model";
import { MilestonesDetail } from "./MilestonesDetail";
import { ScopeDetail } from "./ScopeDetail";
import { ScreensDetail } from "./ScreensDetail";
import { SuccessDetail } from "./SuccessDetail";
import { useMilestonesSummary, useScopeSummary, useScreensSummary, useSuccessSummary } from "./summaries";

export type ScopePartId = "scope" | "screens" | "milestones" | "success";

export interface ScopePartView {
  useSummary: (ctx: AnalysisCtx) => PartSummary;
  Detail: (ctx: AnalysisCtx) => JSX.Element;
}

export const SCOPE_PART_VIEWS: Record<ScopePartId, ScopePartView> = {
  scope: { useSummary: useScopeSummary, Detail: ScopeDetail },
  screens: { useSummary: useScreensSummary, Detail: ScreensDetail },
  milestones: { useSummary: useMilestonesSummary, Detail: MilestonesDetail },
  success: { useSummary: useSuccessSummary, Detail: SuccessDetail },
};

export { ScopeDetail, ScreensDetail, MilestonesDetail, SuccessDetail };
export { useScopeSummary, useScreensSummary, useMilestonesSummary, useSuccessSummary };
export { featuresSummary, milestonesSummary, screensSummary, successSummaryRow, successIssues, fingerprint } from "./summaryModel";
