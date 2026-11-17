/** The collapsed-row summaries of the four scope parts. Each hook reads through the SAME hooks the open parts use
 *  (useScopeDoc of today's analysis document, the scope hooks, the look & feel panel's design reads), so React Query shares
 *  one set of reads between the row and its detail. Before the step that writes a part, nothing is read (the hooks get
 *  an empty project id, which keeps every query disabled). The words and rules live in ./summaryModel.ts. */
import { useMemo } from "react";
import { useBlocksContext } from "@/blocks/context";
import { useEngineJobs } from "@/blocks/engine/jobs";
import { useDesignBrief, useRequirements } from "@/blocks/requirements/hooks";
import { useDesignContext } from "@/blocks/requirements/designContext";
import { useDesignScreens, useScopeJobs } from "@/blocks/scope/hooks";
import { milestonePlan } from "@/components/scope/blocks/MilestonesPlan";
import { useScopeDoc } from "@/components/analysis/doc/scope/shared";
import { partOpen, type AnalysisCtx } from "@/components/analysis/model";
import type { PartSummary } from "../../model";
import { useAttachedLive } from "../brief/summaryHooks";
import { parseExistingDesignSystem } from "@/domain/liveProduct";
import { designSystemLine } from "../../live/liveDoc";
import {
  designFromIntent, featuresSummary, fingerprint, lookAndFeelFacts, milestonesSummary, screensSummary, successSummaryRow,
  type ScopeRowBase,
} from "./summaryModel";

const ACTIVE = new Set(["queued", "claimed", "running"]);
const isActive = (job: { status: string } | null | undefined) => Boolean(job && ACTIVE.has(job.status));
const DESIGN_JOBS = ["design.generate"] as const;
const EMPTY: never[] = [];

/** The scope plan for a row: read only once the part is open. */
function useRowDoc(ctx: AnalysisCtx, open: boolean) {
  const doc = useScopeDoc(open ? ctx.projectId : "");
  const jobs = useScopeJobs(doc.ctx);
  const live = useAttachedLive(ctx.projectId);
  const base: ScopeRowBase = { open, loading: doc.loading, error: doc.error, phase: doc.page.phase, drafting: doc.drafting, live };
  return { doc, jobs, base };
}

/** "Features & user stories": "9 features · 23 user stories". */
export function useScopeSummary(ctx: AnalysisCtx): PartSummary {
  const { doc, base } = useRowDoc(ctx, partOpen("scope", ctx.step));
  return useMemo(
    () => featuresSummary({ ...base, features: doc.features, stories: doc.stories, milestones: doc.milestones, canEdit: doc.page.canEditFeatures }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base.open, base.loading, base.error, base.phase, base.drafting, base.live, doc.features, doc.stories, doc.milestones, doc.page.canEditFeatures],
  );
}

/** "Milestones": "3 milestones · first: Booking and price list". */
export function useMilestonesSummary(ctx: AnalysisCtx): PartSummary {
  const { doc, jobs, base } = useRowDoc(ctx, partOpen("milestones", ctx.step));
  const replanning = isActive(jobs.suggest);
  return useMemo(() => {
    const plan = milestonePlan(doc.milestones, doc.features).rows.map((r) => ({ name: r.name, done: r.status.tone === "success" }));
    return milestonesSummary({
      ...base, features: doc.features, stories: doc.stories, milestones: doc.milestones, plan, replanning, canEdit: doc.page.canEditMilestones,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base.open, base.loading, base.error, base.phase, base.drafting, base.live, doc.features, doc.stories, doc.milestones, replanning, doc.page.canEditMilestones]);
}

/** "Success metrics": "5 metrics · 1 target still open". */
export function useSuccessSummary(ctx: AnalysisCtx): PartSummary {
  const { doc, jobs, base } = useRowDoc(ctx, partOpen("success", ctx.step));
  const working = isActive(jobs.success);
  const targets = doc.version?.successTargets ?? null;
  return useMemo(
    () => successSummaryRow({ ...base, targets, working, canEdit: doc.page.canEditFeatures && doc.version !== null }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [base.open, base.loading, base.error, base.phase, base.drafting, base.live, targets, working, doc.page.canEditFeatures, doc.version],
  );
}

/** "Screens and look & feel": the look & feel while the requirements are written, then "10 screens · reviewed". */
export function useScreensSummary(ctx: AnalysisCtx): PartSummary {
  const designOpen = partOpen("features", ctx.step);
  const scopeOpen = partOpen("screens", ctx.step);
  const { permissions } = useBlocksContext();
  // the look & feel: the same reads as its panel (MakeDesignPanel), worked out by its rules (lookAndFeelFacts)
  const designId = designOpen ? ctx.projectId : null;
  const brief = useDesignBrief(designId);
  const requirements = useRequirements(designId);
  const designJobs = useEngineJobs(designId, DESIGN_JOBS);
  const b = brief.data ?? null;
  const jobList = designJobs.data ?? EMPTY;
  const prototypeJson = b?.prototypeJson ?? null;
  const fromIntent = useMemo(() => designFromIntent(prototypeJson, jobList), [prototypeJson, jobList]);
  const intent = useDesignContext(designOpen && fromIntent ? ctx.projectId : "");
  // the scope's screens: the same reads as the open part (useScopeDoc + useDesignScreens)
  const { doc, jobs, base } = useRowDoc(ctx, scopeOpen);
  const screens = useDesignScreens(doc.ctx).data?.items ?? EMPTY;

  const designJob = jobs.design;
  const designing = Boolean(designJob && designJob.status !== "succeeded" && designJob.status !== "failed" && designJob.status !== "cancelled");
  const requirementsRead = !requirements.isLoading && !requirements.isError;
  const look = useMemo(() => lookAndFeelFacts({
    brief: b, briefFetching: brief.isFetching, requirements: requirements.data ?? EMPTY, requirementsRead, jobs: jobList, intentSource: intent.data?.source, intentLegacySource: intent.data?.legacySource,
  }), [b, brief.isFetching, requirements.data, requirementsRead, jobList, intent.data?.source, intent.data?.legacySource]);
  const designKey = useMemo(() => (b ? fingerprint([b.id, b.status, prototypeJson]) : ""), [b, prototypeJson]);
  const designReading = brief.isLoading || requirements.isLoading || designJobs.isLoading || (fromIntent && intent.isLoading);
  const readsFailed = brief.isError || requirements.isError || designJobs.isError || (fromIntent && intent.isError);
  const loading = (designOpen && designReading) || (scopeOpen && doc.loading);
  const canApprove = ctx.step === "requirements" && permissions.includes("design.edit");

  // a live product documented from its code: its look & feel is the existing design system it was read from
  const existing = useMemo(() => (base.live ? parseExistingDesignSystem(prototypeJson) : null), [base.live, prototypeJson]);
  return useMemo(() => existing && !loading ? { id: "screens", status: "confirmed", summary: designSystemLine(existing), fingerprint: designKey || "existing" } : screensSummary({
    designOpen, scopeOpen, loading, phase: doc.page.phase,
    design: { ...look, readsFailed, canApprove, key: designKey },
    screens: { items: screens, reviewedAt: doc.version?.screensReviewedAt ?? null, designing, canReview: doc.page.canEditFeatures && doc.version !== null },
    live: base.live,
  }), [existing, designOpen, scopeOpen, loading, doc.page.phase, look, readsFailed, canApprove, designKey, screens, doc.version, designing, doc.page.canEditFeatures, base.live]);
}
