/** /p/:id/analysis: "Business Analysis", step 2 of 4. Shows the design the owner approved on 08.11.2026 (working with
 *  your business analyst, src/pages/AnalysisNext.tsx; /p/:id/analysis-next redirects here). The old addresses
 *  (/understanding, /sanitization, /requirements, /scope) land here with their anchor (#understanding …), which opens
 *  the matching part. The second round's two-column page (components/analysis/AnalysisWorkspace) is no longer shown.
 *
 *  ?view=sections keeps the first round's page for now: the four former steps one under the other, each as its own
 *  section (Project understanding, Understanding your project, Goals & requirements, Scope & success). Each section is
 *  the step's own page, unchanged, and the stored journey decides which sections are open; one that is not open yet
 *  says why. An existing product attached as it is live never had that analysis: its sections show the main view's own
 *  parts instead (LiveSectionsAnalysis), so the two never disagree. Front end only. */
import { useT } from "@/madp/i18n";
import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { Check, Lock } from "lucide-react";
import { useProject } from "@/madp/blocks/projects/reads";
import { isBlocksProjectId } from "@/madp/domain/projects";
import { type AnalysisStep } from "@/madp/domain/phases";
import { phaseName } from "@/madp/components/project/stepNames";
import { analysisParts, phaseGuide, STATUS_TEXT, type AnalysisPart } from "@/madp/components/project/projectSteps";
import { missingNotice } from "@/madp/components/project/ProjectRoute";
import { cn } from "@/madp/lib/cn";
import { prefixPath, rewritePath } from "@/madp/lib/pathPrefix";
import { BusinessAnalysis, LiveSectionsAnalysis } from "@/madp/pages/AnalysisNext";
import { attachedLive } from "@/madp/components/analysis-next/model";
import { livePastAnalysis } from "@/madp/components/analysis/pm/pmModel";

const UnderstandingPage = lazy(() => import("@/madp/pages/Understanding"));
const SanitizationPage = lazy(() => import("@/madp/pages/Sanitization"));
const RequirementsPage = lazy(() => import("@/madp/pages/ProjectStep"));
const ScopePage = lazy(() => import("@/madp/pages/Scope"));

const SECTION: Record<AnalysisStep, () => ReactNode> = {
  understanding: () => <UnderstandingPage />,
  sanitization: () => <SanitizationPage />,
  requirements: () => <RequirementsPage step={2} />,
  scope: () => <ScopePage />,
};

const CARD = "rounded-card bg-surface shadow-[0_6px_20px_-10px_rgb(10_12_20/0.16)] dark:ring-1 dark:ring-line";
const CHIP: Record<AnalysisPart["status"], string> = {
  done: "bg-success-soft text-success",
  now: "bg-accent-soft text-accent",
  next: "bg-surface2 text-ink2",
  locked: "bg-surface2 text-ink3",
};

export default function Analysis() {
  const { id = "" } = useParams();
  const { search } = useLocation();
  if (!isBlocksProjectId(id)) return <Navigate to={rewritePath("/projects")} replace state={{ notice: missingNotice() }} />;
  // the approved page; the former four pages one under the other stay reachable as a fallback (?view=sections)
  return new URLSearchParams(search).get("view") === "sections" ? <SectionsAnalysis id={id} /> : <BusinessAnalysis id={id} />;
}

/** The first round's page: the former four steps as sections (?view=sections). */
function SectionsAnalysis({ id }: { id: string }) {
  const t = useT();
  const project = useProject(id).data;
  const { hash } = useLocation();
  const parts = analysisParts({ step: project?.step ?? null, type: project?.type });
  const guide = phaseGuide("analysis", project?.type);
  const target = hash.replace(/^#/, "");

  // An address with a section (#scope) scrolls to it once the sections are drawn (they load lazily, so try again shortly).
  useEffect(() => {
    if (!target) return;
    const go = () => document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    const timers = [60, 400, 1200].map((ms) => window.setTimeout(go, ms));
    return () => timers.forEach((tm) => window.clearTimeout(tm));
  }, [target, project?.step]);

  // a live product never had the analysis these pages are: the main view's own parts, every one opened
  if (livePastAnalysis(attachedLive(project ?? null), project?.step ?? null)) return <LiveSectionsAnalysis id={id} />;
  // the phase name is a link, so the sentence is split where it goes
  const movesOn = t("analysis.page.movesOnTo", "When the scope is locked, the project moves on to {link}.").split("{link}");

  return (
    <div className="flex min-w-0 flex-col gap-8">
      <header className={cn(CARD, "flex flex-col gap-4 px-5 py-5 md:px-6")}>
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold leading-7 text-ink">{phaseName("analysis")}</h1>
          <p className="max-w-[72ch] text-[14px] leading-6 text-ink2">{guide.what}</p>
        </div>
        <nav aria-label={t("analysis.page.partsNav", "Parts of the business analysis")}>
          <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {parts.map((p) => (
              <li key={p.id} className="min-w-0">
                <a href={`#${p.id}`} className={cn("flex min-w-0 items-center gap-3 rounded-block px-3 py-2.5 ring-1 ring-line transition-colors hover:bg-surface2 outline-none focus-visible:ring-2 focus-visible:ring-accent/50", target === p.id && "bg-surface2/60")}>
                  <PartMark part={p} />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium text-ink">{p.label}</span>
                    <span className={cn("mt-0.5 w-fit rounded-full px-2 py-0.5 text-[11px] font-medium", CHIP[p.status])}>{STATUS_TEXT[p.status]}</span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      {parts.map((p) => (
        <section key={p.id} id={p.id} aria-labelledby={`${p.id}-title`} className="flex min-w-0 scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)] flex-col gap-3">
          <div className="flex items-center gap-3 px-1">
            <PartMark part={p} />
            <h2 id={`${p.id}-title`} className="text-[16px] font-semibold text-ink">{`${p.n}. ${p.label}`}</h2>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", CHIP[p.status])}>{STATUS_TEXT[p.status]}</span>
          </div>
          {p.open ? (
            <Suspense fallback={<div aria-hidden className="hatched h-64 rounded-card bg-surface/60" />}>
              {SECTION[p.id]()}
            </Suspense>
          ) : (
            <div className={cn(CARD, "flex flex-col gap-1.5 px-5 py-5 text-[14px] text-ink2")}>
              <p className="flex items-center gap-2 font-medium text-ink"><Lock aria-hidden size={14} strokeWidth={2} />{t("analysis.page.notOpenYet", "Not open yet")}</p>
              <p>{p.what}</p>
              {p.reason && <p className="text-[13px] text-ink3">{p.reason}.</p>}
            </div>
          )}
        </section>
      ))}

      <p className="px-1 text-[13px] text-ink3">
        {movesOn[0]}<Link to={prefixPath(`/p/${id}/build`)} className="font-medium text-ink2 underline-offset-4 hover:underline">{phaseName("engineering")}</Link>{movesOn[1]}
      </p>
    </div>
  );
}

function PartMark({ part }: { part: AnalysisPart }) {
  return (
    <span aria-hidden className={cn("num grid h-7 w-7 shrink-0 place-items-center rounded-full text-[12px] font-medium",
      part.status === "done" && "bg-success text-white dark:text-canvas",
      part.status === "now" && "bg-accent text-white ring-4 ring-accent/15",
      part.status === "next" && "bg-surface text-ink2 ring-1 ring-line",
      part.status === "locked" && "bg-surface2 text-ink3")}>
      {part.status === "done" ? <Check size={14} strokeWidth={2.5} /> : part.status === "locked" ? <Lock size={12} strokeWidth={2} /> : part.n}
    </span>
  );
}
