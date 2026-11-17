/** The first five parts of the next Business Analysis page (understood, files, objective, features, workflows): for
 *  each, the hook that gives its collapsed row (PartSummary) and the content shown when the row is opened. */
import type { JSX } from "react";
import type { AnalysisCtx, PartSummary } from "../../model";
import { FeaturesDetail } from "./FeaturesDetail";
import { FilesDetail } from "./FilesDetail";
import { ObjectiveDetail } from "./ObjectiveDetail";
import { UnderstoodDetail } from "./UnderstoodDetail";
import { WorkflowsDetail } from "./WorkflowsDetail";
import { useFeaturesSummary, useFilesSummary, useObjectiveSummary, useUnderstoodSummary, useWorkflowsSummary } from "./summaryHooks";

export type BriefPart = "understood" | "files" | "objective" | "features" | "workflows";

export interface BriefPartView {
  useSummary: (ctx: AnalysisCtx) => PartSummary;
  Detail: (ctx: AnalysisCtx) => JSX.Element;
}

export const BRIEF_PART_VIEWS: Record<BriefPart, BriefPartView> = {
  understood: { useSummary: useUnderstoodSummary, Detail: UnderstoodDetail },
  files: { useSummary: useFilesSummary, Detail: FilesDetail },
  objective: { useSummary: useObjectiveSummary, Detail: ObjectiveDetail },
  features: { useSummary: useFeaturesSummary, Detail: FeaturesDetail },
  workflows: { useSummary: useWorkflowsSummary, Detail: WorkflowsDetail },
};

export { UnderstoodDetail, FilesDetail, ObjectiveDetail, FeaturesDetail, WorkflowsDetail };
export { useUnderstoodSummary, useFilesSummary, useObjectiveSummary, useFeaturesSummary, useWorkflowsSummary };
