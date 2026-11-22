/** The Business Analysis page (owner 08.11.2026, second round): the business analyst on the left, the analysis
 *  document on the right, filled part by part. Clicking an item of the business analyst's checklist opens its part.
 *  Front end only: the parts and the panel read the same records and call the same ops as the former four steps. */
import { useEffect, useState, type ComponentType } from "react";
import { Link, useLocation } from "react-router-dom";
import { phaseName } from "@/components/project/stepNames";
import { phaseGuide } from "@/components/project/projectSteps";
import { DOC_PARTS, DOC_PART_LABEL, type AnalysisCtx, type DocPart } from "./model";
import { ProductManagerPanel } from "./pm/ProductManagerPanel";
import { UnderstoodPart, FilesReadPart, ObjectivePart, MasterFeaturesPart, WorkflowsPart } from "./doc";
import { ScopeFeaturesPart, ScreensPart, MilestonesPart, SuccessPart } from "./doc/scope";
import { cn } from "@/lib/cn";
import { FeedbackLayer } from "@/components/feedback/FeedbackLayer";
import { ScopeFeedbackProvider } from "@/components/scope/blocks/ScopeFeedback";
import { stepIndex } from "@/domain/journey";
import { useT } from "@/i18n";

const PART: Record<DocPart, ComponentType<AnalysisCtx>> = {
  understood: UnderstoodPart,
  files: FilesReadPart,
  objective: ObjectivePart,
  features: MasterFeaturesPart,
  workflows: WorkflowsPart,
  scope: ScopeFeaturesPart,
  screens: ScreensPart,
  milestones: MilestonesPart,
  success: SuccessPart,
};

/** The former step anchors (#understanding, #sanitization, #requirements, #scope) open the part that replaced them. */
const OLD_ANCHOR: Record<string, DocPart> = {
  understanding: "understood",
  sanitization: "understood",
  requirements: "features",
  scope: "scope",
};

function partFromHash(hash: string): DocPart | null {
  const h = hash.replace(/^#/, "");
  if ((DOC_PARTS as readonly string[]).includes(h)) return h as DocPart;
  return OLD_ANCHOR[h] ?? null;
}

const CARD = "rounded-card bg-surface shadow-[0_6px_20px_-10px_rgb(10_12_20/0.16)] dark:ring-1 dark:ring-line";

export function AnalysisWorkspace(ctx: AnalysisCtx) {
  const t = useT();
  const { hash } = useLocation();
  const [selected, setSelected] = useState<DocPart | null>(() => partFromHash(hash));
  const guide = phaseGuide("analysis", ctx.type);

  const select = (part: DocPart) => {
    setSelected(part);
    document.getElementById(`part-${part}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // An address with a part (#scope, or a former step's anchor) opens it once the parts are drawn.
  useEffect(() => {
    const part = partFromHash(hash);
    if (!part) return;
    setSelected(part);
    const go = () => document.getElementById(`part-${part}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    const timers = [80, 500, 1300, 2600, 4000].map((ms) => window.setTimeout(go, ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [hash]);

  // the scope's comments and the requirements' comments: one layer each for the whole page
  const scopeLocked = !!ctx.step && stepIndex(ctx.step) >= stepIndex("board");
  return (
    <ScopeFeedbackProvider locked={scopeLocked}>
    <FeedbackLayer />
    <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-[380px_minmax(0,1fr)] xl:grid-cols-[420px_minmax(0,1fr)]">
      <aside aria-label={t("analysis.workspace.analystAria", "Your business analyst")} className="min-w-0 lg:sticky lg:top-[calc(var(--project-nav-h,var(--topbar-h,0px))_+_16px)] lg:max-h-[calc(100vh_-_var(--project-nav-h,var(--topbar-h,0px))_-_2rem)] lg:self-start lg:overflow-y-auto scroll-thin">
        <ProductManagerPanel {...ctx} selected={selected} onSelect={select} />
      </aside>
      <div className="flex min-w-0 flex-col gap-5">
        <header className={cn(CARD, "flex flex-col gap-3 px-5 py-5 md:px-6")}>
          <h1 className="text-[22px] font-semibold leading-7 text-ink">{phaseName("analysis")}</h1>
          <p className="max-w-[72ch] text-[14px] leading-6 text-ink2">{guide.what}</p>
          <nav aria-label={t("analysis.workspace.partsAria", "Parts of the analysis")} className="flex flex-wrap gap-1.5">
            {DOC_PARTS.map((p, i) => (
              <button key={p} type="button" onClick={() => select(p)}
                className={cn("rounded-full px-3 py-1 text-[12px] font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent/50",
                  selected === p ? "bg-accent-soft text-accent" : "bg-surface2 text-ink2 hover:bg-line hover:text-ink")}>
                <span className="num">{i + 1}.</span> {DOC_PART_LABEL[p]}
              </button>
            ))}
          </nav>
        </header>
        {DOC_PARTS.map((p) => {
          const Part = PART[p];
          return (
            <section key={p} id={`part-${p}`} aria-label={DOC_PART_LABEL[p]}
              className={cn("min-w-0 scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)] rounded-card transition-shadow", selected === p && "ring-2 ring-accent/40")}>
              <Part {...ctx} />
            </section>
          );
        })}
        <p className="px-1 text-[13px] text-ink3">
          {t("analysis.workspace.movesOnTo", "When the scope is locked, the project moves on to")} <Link to={`/p/${ctx.projectId}/build`} className="font-medium text-ink2 underline-offset-4 hover:underline">{phaseName("engineering")}</Link>.
          {" "}{t("analysis.workspace.formerPages", "Need the former detailed pages?")} <Link to={`/p/${ctx.projectId}/analysis?view=sections`} className="font-medium text-ink2 underline-offset-4 hover:underline">{t("analysis.workspace.showThem", "Show them")}</Link>.
        </p>
      </div>
    </div>
    </ScopeFeedbackProvider>
  );
}
