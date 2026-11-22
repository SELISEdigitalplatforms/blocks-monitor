/** "Screens and look & feel", opened in its row: today's analysis part (analysis/doc/scope/ScreensPart) without its
 *  card and heading. First the look & feel (the requirements step's own LookAndFeel / MakeDesignPanel, reviewed and
 *  approved here, editable while the requirements are), then the scope's screens (the Scope & success page's
 *  ScreensSection, with its Preview and "Mark reviewed") once the scope has them. Nothing is drawn that the design jobs
 *  did not return. Same reads as the row summary. */
import { useT } from "@/i18n";
import { useState } from "react";
import { CheckSquare, Eye, Palette } from "lucide-react";
import { useRequirementsContext } from "@/blocks/requirements/context";
import { useDesignBrief, useRequirements } from "@/blocks/requirements/hooks";
import { parseExistingDesignSystem } from "@/domain/liveProduct";
import { ExistingDesign } from "../../live/ExistingDesign";
import { useAttachedLive } from "../brief/summaryHooks";
import { useEngineJobs } from "@/blocks/engine/jobs";
import { useDesignScreens } from "@/blocks/scope/hooks";
import { useScreensReview } from "@/blocks/scope/mutations";
import { scopeErrorMessage } from "@/blocks/scope/messages";
import { isLandingJob } from "@/domain/landingPage";
import { LookAndFeel } from "@/components/requirements/LookAndFeel";
import { ScreensSection } from "@/components/scope/blocks/ScreensSection";
import { PartPlaceholder, PartSkeleton, useScopeDoc } from "@/components/analysis/doc/scope/shared";
import { partOpen, type AnalysisCtx } from "@/components/analysis/model";
import { Button } from "@/ui/kit";

const ACTIVE = new Set(["queued", "claimed", "running"]);
const REQUIREMENTS_JOBS = ["requirements.draft"] as const;
const EMPTY: never[] = [];
const noop = () => {};

export function ScreensDetail(ctx: AnalysisCtx) {
  const t = useT();
  // a live product documented from its code: its look & feel is the existing design system, nothing is designed here
  const live = useAttachedLive(ctx.projectId);
  const brief = useDesignBrief(live ? ctx.projectId : null).data ?? null;
  const existing = live ? parseExistingDesignSystem(brief?.prototypeJson ?? null) : null;
  if (existing) return <ExistingDesign system={existing} />;
  // the look & feel is made while the requirements are written (approving it is part of approving them)
  if (!partOpen("features", ctx.step)) return <PartPlaceholder text={t("analysis.scopeSummary.screensPlaceholder", "Your designer sets the look & feel here once the requirements are being written: the design direction and an interactive design of the product for you to review and approve. The screens of the agreed scope follow with the scope.")} icon={<Palette size={16} strokeWidth={1.75} />} />;
  return (
    <div className="flex flex-col gap-6">
      <LookAndFeelBlock projectId={ctx.projectId} />
      {partOpen("screens", ctx.step) && <ScopeScreens projectId={ctx.projectId} />}
    </div>
  );
}

/** The requirements step's Look & feel, with the same rule for when it may be changed and when it waits. */
function LookAndFeelBlock({ projectId }: { projectId: string }) {
  const ctx = useRequirementsContext(projectId);
  const reqs = useRequirements(projectId);
  const jobs = useEngineJobs(projectId, REQUIREMENTS_JOBS).data;
  if (reqs.isLoading || !ctx.ready) return <PartSkeleton rows={2} />;
  const requirements = reqs.data ?? EMPTY;
  const job = (jobs ?? []).find((j) => !isLandingJob(j) && ACTIVE.has(j.status)) ?? null;
  const drafting = job ? (/"purpose"\s*:\s*"suggestions"/.test(job.inputJson ?? "") ? "review" : "draft") : null;
  return (
    <LookAndFeel projectId={projectId} editable={ctx.open && ctx.canEditDesign}
      waiting={drafting === "draft" || requirements.length === 0} onChange={noop} />
  );
}

/** The scope's screens (design.generate results), shown once there are any: the look & feel above covers the time before. */
function ScopeScreens({ projectId }: { projectId: string }) {
  const t = useT();
  const doc = useScopeDoc(projectId);
  const screens = useDesignScreens(doc.ctx).data?.items ?? EMPTY;
  const review = useScreensReview(doc.ctx);
  const [preview, setPreview] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (doc.loading || screens.length === 0) return null;

  const version = doc.version;
  const draft = doc.page.phase === "draft";
  const reviewedAt = version?.screensReviewedAt ?? null;
  const reviewedBy = version?.screensReviewedBy ? doc.ctx.memberName(version.screensReviewedBy) : null;
  const when = reviewedAt ? new Date(reviewedAt) : null;
  const date = when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null;
  const count = screens.length === 1 ? t("analysis.scopeSummary.screensOne", "1 screen") : t("analysis.scopeSummary.screensMany", "{count} screens", { count: screens.length });
  const reviewedWords = reviewedBy && date ? t("analysis.scopeSummary.reviewedByOn", "reviewed by {name} on {date}", { name: reviewedBy, date })
    : reviewedBy ? t("analysis.scopeSummary.reviewedBy", "reviewed by {name}", { name: reviewedBy })
    : date ? t("analysis.scopeSummary.reviewedOn", "reviewed on {date}", { date })
    : t("analysis.scopeSummary.reviewed", "reviewed");
  const line = reviewedAt
    ? [count, reviewedWords].join(" · ")
    : screens.length === 1 ? t("analysis.scopeSummary.screensToLookOne", "1 screen to look through")
    : t("analysis.scopeSummary.screensToLookMany", "{count} screens to look through", { count: screens.length });
  const mark = (reviewed: boolean) => {
    if (!version) return;
    setError(null);
    review.mutate({ projectId, scopeVersionId: version.id, reviewed }, { onError: (e: unknown) => setError(scopeErrorMessage(e)) });
  };

  return (
    <div className="flex flex-col gap-3 border-t border-line pt-5">
      <div className="flex flex-wrap items-center gap-2 rounded-block bg-surface2 px-4 py-2.5 text-[13px] text-ink2">
        <span className="min-w-0 flex-1">{line}</span>
        <Button size="sm" variant="ghost" icon={<Eye size={14} strokeWidth={1.75} aria-hidden />} onClick={() => setPreview(0)}>{t("analysis.scopeSummary.preview", "Preview")}</Button>
        {draft && doc.page.canEditFeatures && version && (reviewedAt
          ? <Button size="sm" variant="ghost" disabled={review.isPending} onClick={() => mark(false)}>{t("analysis.scopeSummary.notReviewedYet", "Not reviewed yet")}</Button>
          : <Button size="sm" variant="secondary" icon={<CheckSquare size={14} aria-hidden />} disabled={review.isPending} onClick={() => mark(true)}>
            {review.isPending ? t("analysis.scopeSummary.saving", "Saving…") : t("analysis.scopeSummary.markReviewed", "Mark reviewed")}
          </Button>)}
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <ScreensSection ctx={doc.ctx} locked={!draft} preview={preview} onPreviewChange={setPreview} />
    </div>
  );
}
