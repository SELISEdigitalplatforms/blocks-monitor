/** The Business Analysis page (owner approved 08.11.2026), shown at /p/:id/analysis by src/pages/Analysis.tsx; the
 *  review address /p/:id/analysis-next redirects there. Working with a calm, experienced business analyst: the
 *  analyst's column on the left ("Next for you" and the conversation, one thing at a time), the analysis on the right
 *  as parts that start collapsed to one line and open in place, a readiness bar on top and the one next action in a
 *  sticky bar. An anchor opens its part: a part id (#objective) or a former step's (#understanding, #sanitization,
 *  #requirements, #scope: where /p/:id/<step> lands). Front end only (src/components/analysis-next). */
import { useT } from "@/i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Check, ChevronDown, CircleDashed, CircleDot, Hand, MonitorCheck, RefreshCw, ScanSearch } from "lucide-react";
import { useProject } from "@/blocks/projects/reads";
import { stepIndex } from "@/domain/journey";
import { useWorkspaces } from "@/state/workspaces";
import { FeedbackLayer } from "@/components/feedback/FeedbackLayer";
import { ScopeFeedbackProvider } from "@/components/scope/blocks/ScopeFeedback";
import { PM_ITEM_PART } from "@/components/analysis/model";
import { DOC_PARTS, DOC_PART_LABEL, PART_STATUS_LABEL, readiness, type AnalysisCtx, type AnalystItem, type DocPart, type PartStatus, type PartSummary } from "@/components/analysis-next/model";
import { AnalystColumn } from "@/components/analysis-next/analyst/AnalystColumn";
import { useNextAction } from "@/components/analysis-next/next/useNextAction";
import { useOpenScopeOnEntry } from "@/components/analysis-next/next/scopeOpen";
import { BRIEF_PART_VIEWS } from "@/components/analysis-next/parts/brief";
import { SCOPE_PART_VIEWS } from "@/components/analysis-next/parts/scope";
import { usePublishPhaseProgress } from "@/components/project/phaseProgress";
import { useChangeWaits } from "@/components/team/useTeam";
import { changeWaitNext } from "@/components/team/changeWaiting";
import {
  LIVE_SECTIONS, LIVE_TEXT, canStartDocumentation, documentBlockedText, documentButton, documentedLine, liveNextAction, livePartSummary,
  liveSectionStatus, liveSectionsText,
} from "@/components/analysis-next/live/liveDoc";
import { phaseName } from "@/components/project/stepNames";
import { useLiveDoc, type LiveDoc } from "@/components/analysis-next/live/useLiveDoc";
import { Button } from "@/ui/kit";
import { cn } from "@/lib/cn";

const VIEWS = { ...BRIEF_PART_VIEWS, ...SCOPE_PART_VIEWS } as unknown as Record<DocPart, { useSummary: (ctx: AnalysisCtx) => PartSummary; Detail: React.ComponentType<AnalysisCtx> }>;
const CARD = "rounded-card bg-surface shadow-[0_6px_20px_-10px_rgb(10_12_20/0.16)] dark:ring-1 dark:ring-line";
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-accent/50";

const STATUS_STYLE: Record<PartStatus, { chip: string; icon: JSX.Element }> = {
  "needs-you": { chip: "bg-warning-soft text-warning", icon: <Hand aria-hidden size={14} strokeWidth={2} className="text-warning" /> },
  draft: { chip: "bg-accent-soft text-accent", icon: <CircleDot aria-hidden size={14} strokeWidth={2} className="text-accent" /> },
  confirmed: { chip: "bg-success-soft text-success", icon: <Check aria-hidden size={14} strokeWidth={2.5} className="text-success" /> },
  "not-started": { chip: "bg-surface2 text-ink3", icon: <CircleDashed aria-hidden size={14} strokeWidth={2} className="text-ink3" /> },
  skipped: { chip: "bg-surface2 text-ink3", icon: <CircleDashed aria-hidden size={14} strokeWidth={2} className="text-ink3 opacity-50" /> },
  documented: { chip: "bg-accent-soft text-[rgb(var(--c-accent-text))]", icon: <MonitorCheck aria-hidden size={14} strokeWidth={2} className="text-accent" /> },
  undocumented: { chip: "bg-surface2 text-ink2", icon: <CircleDashed aria-hidden size={14} strokeWidth={2} className="text-ink3" /> },
};

/** What an address's anchor opens: the part, and for a former step with its own conversation, the analyst's item. */
export interface AnchorTarget { part: DocPart; item?: AnalystItem }

/** The former steps' anchors (/p/:id/<step> lands on /p/:id/analysis#<step>) and the part each one became. */
const STEP_ANCHOR = new Map<string, AnchorTarget>([
  ["understanding", { part: "understood" }],
  ["sanitization", { part: "understood", item: "questions" }],
  ["requirements", { part: "features" }],
  ["scope", { part: "scope" }],
]);

/** The part (and analyst item) an anchor opens: a part id (#objective) or a former step (#sanitization); null otherwise (pure). */
export function anchorTarget(hash: string): AnchorTarget | null {
  const h = hash.replace(/^#/, "");
  if ((DOC_PARTS as readonly string[]).includes(h)) return { part: h as DocPart };
  return STEP_ANCHOR.get(h) ?? null;
}

/** The page for a Blocks project (src/pages/Analysis.tsx checks the id). */
export function BusinessAnalysis({ id }: { id: string }) {
  const project = useProject(id).data;
  const workspaceId = useWorkspaces((s) => s.workspaceId);
  const ctx: AnalysisCtx = { projectId: id, workspaceId, step: project?.step ?? null, type: project?.type ?? "greenfield" };
  const locked = !!ctx.step && stepIndex(ctx.step) >= stepIndex("board");
  return (
    <ScopeFeedbackProvider locked={locked}>
      <FeedbackLayer />
      <Workspace {...ctx} />
    </ScopeFeedbackProvider>
  );
}

/** Rows whose content changed after the first load glow for a few seconds ("Updated"). */
function useUpdated(parts: PartSummary[]): Set<DocPart> {
  const seen = useRef(new Map<DocPart, string>());
  const [updated, setUpdated] = useState<Set<DocPart>>(new Set());
  const key = parts.map((p) => `${p.id}:${p.loading ? "" : p.fingerprint}`).join("|");
  useEffect(() => {
    const changed: DocPart[] = [];
    for (const p of parts) {
      if (p.loading) continue;
      const before = seen.current.get(p.id);
      if (before !== undefined && before !== p.fingerprint) changed.push(p.id);
      seen.current.set(p.id, p.fingerprint);
    }
    if (!changed.length) return;
    setUpdated((s) => new Set([...s, ...changed]));
    const t = window.setTimeout(() => setUpdated((s) => { const n = new Set(s); changed.forEach((c) => n.delete(c)); return n; }), 4500);
    return () => window.clearTimeout(t);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return updated;
}

function Workspace(ctx: AnalysisCtx) {
  const t = useT();
  const { hash } = useLocation();
  // a live product past the analysis: what was written down from it (null for every other project)
  const liveDoc = useLiveDoc(ctx.projectId);
  const liveFacts = liveDoc?.facts ?? null;
  // every part's one-line summary (fixed order, so the hooks always run the same way); a live product's parts say
  // what was written down from it, and when
  const parts = DOC_PARTS.map((p) => livePartSummary(VIEWS[p].useSummary(ctx), liveFacts));
  const analysisNext = useNextAction(ctx);
  // a change request waiting for the person (the Team panel's own rule) comes first once the analysis asks nothing
  const changeWaits = useChangeWaits(ctx.projectId).waits;
  const next = useMemo(() => {
    const crNext = changeWaitNext(ctx.projectId, changeWaits);
    const idle = analysisNext.item === null && !analysisNext.working && !analysisNext.button;
    if (crNext && (liveFacts || idle)) return { title: crNext.title, detail: crNext.detail, item: null, button: crNext.button, href: crNext.href };
    return liveFacts ? liveNextAction(liveFacts) : analysisNext;
  }, [analysisNext, changeWaits, liveFacts, ctx.projectId]);
  // the Scope & success step's entry op (queues the scope draft once the requirements are approved; repairs a lock)
  useOpenScopeOnEntry(ctx);
  const ready = readiness(parts);
  const updated = useUpdated(parts);
  // the readiness shows in the sticky stepper (Business Analysis segment), not in a card here; while loading the last
  // one stays; none when every part is "Not used" (a live product: the stepper shows its plain state, not "0 of 0")
  usePublishPhaseProgress(parts.some((p) => p.loading) ? undefined
    : liveDoc || ready.total === 0 ? null : { projectId: ctx.projectId, phase: "analysis", done: ready.ready, total: ready.total, needsYou: ready.needsYou });
  const [openParts, setOpenParts] = useState<Set<DocPart>>(new Set());
  const [analystItem, setAnalystItem] = useState<AnalystItem | null>(null);
  const [focusSignal] = useState(0);
  const [tab, setTab] = useState<"talk" | "analysis">("talk");
  const touched = useRef(false);

  // first view: open the part the next action is about, else the first one that needs the person
  const firstOpen = useMemo(() => {
    if (next.item) return PM_ITEM_PART[next.item];
    return parts.find((p) => p.status === "needs-you")?.id ?? null;
  }, [next.item, parts.map((p) => p.status).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (touched.current || !firstOpen) return;
    setOpenParts(new Set([firstOpen]));
  }, [firstOpen]);

  /** Opens a part and scrolls to it; on phones it also switches to the Analysis tab unless `tab` is false. */
  const showPart = (part: DocPart, { tab: toTab = true }: { tab?: boolean } = {}) => {
    touched.current = true;
    setOpenParts((s) => new Set([...s, part]));
    if (toTab) setTab("analysis");
    window.setTimeout(() => document.getElementById(`part-${part}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };
  const toggle = (part: DocPart) => {
    touched.current = true;
    setOpenParts((s) => { const n = new Set(s); if (n.has(part)) n.delete(part); else n.add(part); return n; });
  };

  // an address with a part (#objective) or a former step (#sanitization) opens and shows the part; a step with its
  // own conversation (the questions) also opens that item, and phones stay on the conversation for it. The parts
  // draw as their reads arrive, so the scroll tries again shortly.
  useEffect(() => {
    const to = anchorTarget(hash);
    if (!to) return;
    if (to.item) {
      setAnalystItem(to.item);
      setTab("talk");
    }
    const timers = [120, 900, 2200].map((ms) => window.setTimeout(() => showPart(to.part, { tab: !to.item }), ms));
    return () => timers.forEach((tm) => window.clearTimeout(tm));
  }, [hash]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex min-w-0 flex-col gap-5 pb-24 lg:pb-28">

      {/* phones: two tabs */}
      <div role="tablist" aria-label={t("analysis.page.tabsLabel", "Business Analysis")} className="flex gap-1 rounded-full bg-surface2 p-1 lg:hidden">
        {([["talk", t("analysis.page.tabConversation", "Conversation")], ["analysis", t("analysis.page.tabAnalysis", "Analysis")]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
            className={cn("h-9 flex-1 rounded-full text-[13px] font-medium transition-colors", FOCUS, tab === k ? "bg-surface text-ink shadow-sm" : "text-ink2")}>{label}</button>
        ))}
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:[--analyst-w:400px] xl:[--analyst-w:440px] lg:grid-cols-[var(--analyst-w)_minmax(0,1fr)]">
        {/* lg+: the column scrolls on its own; it reaches 14px into the 24px gap so its slim scrollbar sits in the
            middle of the gap (gutter reserved, never over the cards), while the content keeps the grid column's width */}
        <aside aria-label={t("analysis.page.analystColumn", "Your business analyst")} className={cn("min-w-0 lg:sticky lg:top-[calc(var(--project-nav-h,0px)+16px)] lg:-mr-3.5 lg:max-h-[calc(100vh-var(--project-nav-h,0px)-7rem)] lg:self-start lg:overflow-y-auto scroll-quiet", tab !== "talk" && "max-lg:hidden")}>
          <div className="lg:w-[var(--analyst-w)] lg:max-w-full">
            <AnalystColumn {...ctx} next={next} open={analystItem} onOpen={setAnalystItem} onPart={(p) => showPart(p)} focusSignal={focusSignal} liveDoc={liveDoc} />
          </div>
        </aside>
        <section aria-label={t("analysis.page.analysisColumn", "The analysis")} className={cn("flex min-w-0 flex-col gap-3", tab !== "analysis" && "max-lg:hidden")}>
          {DOC_PARTS.map((p, i) => {
            const Detail = VIEWS[p].Detail;
            return (
              <PartRow key={p} n={i + 1} part={parts[i]} open={openParts.has(p)} updated={updated.has(p)} onToggle={() => toggle(p)}>
                {openParts.has(p) && (liveDoc ? <LivePartBody part={parts[i]} doc={liveDoc}><Detail {...ctx} /></LivePartBody> : <Detail {...ctx} />)}
              </PartRow>
            );
          })}
          <p className="px-1 pt-2 text-[13px] text-ink3">
            {t("analysis.page.formerPages", "Need the former detailed pages?")} <Link to={`/p/${ctx.projectId}/analysis?view=sections`} className="font-medium text-ink2 underline-offset-4 hover:underline">{t("analysis.page.showThem", "Show them")}</Link>.
          </p>
        </section>
      </div>

    </div>
  );
}

function PartRow({ n, part, open, updated, onToggle, children }: { n: number; part: PartSummary; open: boolean; updated: boolean; onToggle: () => void; children: React.ReactNode }) {
  const t = useT();
  const st = STATUS_STYLE[part.status];
  const label = DOC_PART_LABEL[part.id];
  return (
    <article id={`part-${part.id}`} className={cn(CARD, "min-w-0 scroll-mt-[calc(var(--project-nav-h,0px)+24px)] transition-shadow duration-500", updated && "ring-2 ring-success/50")}>
      <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={`part-${part.id}-body`}
        className={cn("flex w-full min-w-0 items-start gap-3 rounded-card px-5 py-4 text-left transition-colors hover:bg-surface2/50", FOCUS)}>
        <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface2">{st.icon}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-semibold text-ink"><span className="num text-ink3">{n}.</span> {label}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", st.chip)}>{PART_STATUS_LABEL[part.status]}</span>
            {updated && <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">{t("analysis.page.updated", "Updated")}</span>}
          </span>
          <span className={cn("text-[13px] leading-5", part.loading ? "text-ink3" : "text-ink2", !open && "line-clamp-2")}>{part.loading ? t("analysis.page.loading", "Loading…") : part.summary}</span>
          {!part.loading && (part.sources?.length || part.issues?.length) ? (
            <span className="flex flex-wrap items-center gap-1.5 pt-0.5">
              {part.issues?.slice(0, 2).map((i) => <span key={i} className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">{i}</span>)}
              {part.sources?.slice(0, 3).map((s) => <span key={s} className="max-w-[220px] truncate rounded-full bg-surface2 px-2 py-0.5 text-[11px] text-ink2" title={t("analysis.page.sourceTitle", "Where this comes from: {source}", { source: s })}>{s.replace(/^from\s+/i, "")}</span>)}
              {(part.sources?.length ?? 0) > 3 && <span className="text-[11px] text-ink3">{t("analysis.page.moreSources", "+{count} more", { count: (part.sources?.length ?? 0) - 3 })}</span>}
            </span>
          ) : null}
        </span>
        <ChevronDown aria-hidden size={18} strokeWidth={1.75} className={cn("mt-1 shrink-0 text-ink3 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open && <div id={`part-${part.id}-body`} className="min-w-0 border-t border-line px-5 py-5">{children}</div>}
    </article>
  );
}

/** A live product's part, opened: what was written down and when above the part's own content, or, while nothing is,
 *  the honest empty state with the documentation's action (never an analysis action nobody can take). The files part
 *  is the person's own material and shows as it is. */
function LivePartBody({ part, doc, children, action = true }: { part: PartSummary; doc: LiveDoc; children: React.ReactNode; action?: boolean }) {
  const t = useT();
  const f = doc.facts;
  if (part.status === "documented") {
    return (
      <div className="flex min-w-0 flex-col gap-4">
        <p className="flex items-center gap-2 text-[13px] text-ink2">
          <MonitorCheck aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-accent" />
          <span className="min-w-0 break-words">{documentedLine(f.documentedAt)}</span>
        </p>
        {children}
      </div>
    );
  }
  if (part.status !== "undocumented" && part.status !== "skipped") return <>{children}</>;
  const blocked = documentBlockedText(f);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <p className="break-words text-[14px] leading-6 text-ink2">{part.status === "undocumented" && canStartDocumentation(f) ? LIVE_TEXT.emptyPartOpen : part.summary}</p>
      {f.documentedAt && part.status === "skipped" && <p className="text-[13px] text-ink3">{documentedLine(f.documentedAt)}</p>}
      {action && canStartDocumentation(f) && (
        <Button size="sm" variant={f.documentedAt ? "ghost" : "primary"} className="w-fit" disabled={doc.starting}
          icon={f.documentedAt ? <RefreshCw size={14} strokeWidth={1.75} aria-hidden /> : <ScanSearch size={14} strokeWidth={1.75} aria-hidden />}
          onClick={doc.start}>
          {doc.starting ? t("analysis.page.asking", "Asking…") : documentButton(f)}
        </Button>
      )}
      {action && doc.error && <p role="alert" className="text-[13px] text-danger">{doc.error}</p>}
      {action && blocked && <p className="text-[13px] text-ink3">{blocked}</p>}
    </div>
  );
}

/** "Document / Refresh from the live product" once, with its progress, the reason when it can't be done, or its error. */
function LiveDocAction({ doc }: { doc: LiveDoc }) {
  const t = useT();
  const f = doc.facts;
  const blocked = documentBlockedText(f);
  return (
    <div className="flex flex-col gap-2">
      {f.running ? (
        <p role="status" className="text-[13px] text-ink2">{`${liveNextAction(f).title}: ${liveNextAction(f).detail}`}</p>
      ) : canStartDocumentation(f) ? (
        <Button size="sm" variant={f.documentedAt ? "ghost" : "primary"} className="w-fit" disabled={doc.starting}
          icon={f.documentedAt ? <RefreshCw size={14} strokeWidth={1.75} aria-hidden /> : <ScanSearch size={14} strokeWidth={1.75} aria-hidden />}
          onClick={doc.start}>
          {doc.starting ? t("analysis.page.asking", "Asking…") : documentButton(f)}
        </Button>
      ) : null}
      {doc.error && <p role="alert" className="text-[13px] text-danger">{doc.error}</p>}
      {blocked && <p className="text-[13px] text-ink3">{blocked}</p>}
    </div>
  );
}

/** The detailed pages ("Show them", ?view=sections) of an existing product attached as it is live: the former step pages
 *  would claim an analysis that never happened ("Done", "Requirements approved", "Scope locked" over nothing), so they
 *  show the main view's own parts instead, every one opened, in three sections whose status comes from their parts.
 *  The same reads and the same rules as the main view: the two never disagree. */
export function LiveSectionsAnalysis({ id }: { id: string }) {
  const project = useProject(id).data;
  const workspaceId = useWorkspaces((s) => s.workspaceId);
  const ctx: AnalysisCtx = { projectId: id, workspaceId, step: project?.step ?? null, type: project?.type ?? "greenfield" };
  return (
    <ScopeFeedbackProvider locked>
      <FeedbackLayer />
      <LiveSections {...ctx} />
    </ScopeFeedbackProvider>
  );
}

function LiveSections(ctx: AnalysisCtx) {
  const t = useT();
  const liveDoc = useLiveDoc(ctx.projectId);
  const facts = liveDoc?.facts ?? null;
  const parts = DOC_PARTS.map((p) => livePartSummary(VIEWS[p].useSummary(ctx), facts));
  const byId = new Map(parts.map((p) => [p.id, p]));
  const sections = LIVE_SECTIONS.map((sec, i) => {
    const own = sec.parts.map((p) => byId.get(p)!);
    return { ...sec, n: i + 1, own, status: own.some((p) => p.loading) ? null : liveSectionStatus(own) };
  });
  // the phase name is a link, so the sentence is split where it goes
  const changeIn = t("analysis.page.requestChangeIn", "To change the product, request a change in {link}.").split("{link}");
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <header className={cn(CARD, "flex flex-col gap-4 px-5 py-5 md:px-6")}>
        <div className="flex flex-col gap-1">
          <h1 className="text-[22px] font-semibold leading-7 text-ink">{phaseName("analysis")}</h1>
          <p className="max-w-[72ch] text-[14px] leading-6 text-ink2">{liveSectionsText(Boolean(facts?.documentedAt))}</p>
          {facts?.documentedAt && <p className="text-[13px] text-ink3">{documentedLine(facts.documentedAt)}</p>}
        </div>
        {liveDoc && !liveDoc.facts.loading && <LiveDocAction doc={liveDoc} />}
        <nav aria-label={t("analysis.page.partsNav", "Parts of the business analysis")}>
          <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {sections.map((sec) => (
              <li key={sec.id} className="min-w-0">
                <a href={`#${sec.id}`} className={cn("flex min-w-0 items-center gap-3 rounded-block px-3 py-2.5 ring-1 ring-line transition-colors hover:bg-surface2", FOCUS)}>
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface2">{sec.status ? STATUS_STYLE[sec.status].icon : null}</span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[13px] font-medium text-ink">{sec.label}</span>
                    <span className={cn("mt-0.5 w-fit rounded-full px-2 py-0.5 text-[11px] font-medium", sec.status ? STATUS_STYLE[sec.status].chip : "bg-surface2 text-ink3")}>
                      {sec.status ? PART_STATUS_LABEL[sec.status] : t("analysis.page.loading", "Loading…")}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
      </header>

      {sections.map((sec) => (
        <section key={sec.id} id={sec.id} aria-labelledby={`${sec.id}-title`} className="flex min-w-0 scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)] flex-col gap-3">
          <div className="flex items-center gap-3 px-1">
            <h2 id={`${sec.id}-title`} className="text-[16px] font-semibold text-ink">{`${sec.n}. ${sec.label}`}</h2>
            {sec.status && <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_STYLE[sec.status].chip)}>{PART_STATUS_LABEL[sec.status]}</span>}
          </div>
          {sec.own.map((part) => {
            const Detail = VIEWS[part.id].Detail;
            const st = STATUS_STYLE[part.status];
            return (
              <article key={part.id} id={`part-${part.id}`} className={cn(CARD, "min-w-0")}>
                <div className="flex min-w-0 items-start gap-3 px-5 py-4">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-surface2">{st.icon}</span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[15px] font-semibold text-ink">{DOC_PART_LABEL[part.id]}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", st.chip)}>{part.loading ? t("analysis.page.loading", "Loading…") : PART_STATUS_LABEL[part.status]}</span>
                    </span>
                    <span className="text-[13px] leading-5 text-ink2">{part.loading ? t("analysis.page.loading", "Loading…") : part.summary}</span>
                  </span>
                </div>
                {/* an empty part says it all in its header line; the rest open in full */}
                {!part.loading && part.status !== "undocumented" && part.status !== "skipped" && (
                  <div className="min-w-0 border-t border-line px-5 py-5">
                    {liveDoc ? <LivePartBody part={part} doc={liveDoc} action={false}><Detail {...ctx} /></LivePartBody> : <Detail {...ctx} />}
                  </div>
                )}
              </article>
            );
          })}
        </section>
      ))}

      <p className="px-1 text-[13px] text-ink3">
        {changeIn[0]}<Link to={`/p/${ctx.projectId}/build`} className="font-medium text-ink2 underline-offset-4 hover:underline">{phaseName("engineering")}</Link>{changeIn[1]}
      </p>
    </div>
  );
}
