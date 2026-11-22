/** "Goals & requirements", the third section of step 2 "Business Analysis" (/p/:id/analysis#requirements), on the shared step frame (STEP-STANDARD.md):
 *  the business analyst prepares the Requirements document — the goal, the requirements as Must / Should / Could with
 *  their acceptance criteria, the key workflows, what is not included and the constraints — and you review, comment,
 *  ask for changes and approve. The main area reads like that document; open questions, MADP's suggestions, the
 *  screens & design instruction and the numbers sit in the collapsed Details. Every write is a project function op;
 *  comments, version history and the review by MADP stay as they were. Old ?tab= links jump to the matching place. */
import { t, useT } from "@/i18n";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FilePen, Lightbulb, ListChecks, MessageSquareText } from "lucide-react";
import { useMemberName, useRequirementsContext } from "@/blocks/requirements/context";
import { useDesignBrief, useObjective, useOpenClarifications, useRequirements, useSuggestions } from "@/blocks/requirements/hooks";
import { useConfirmRequirements } from "@/blocks/requirements/mutations";
import { useRequirementsExtras } from "@/blocks/requirements/extras";
import { useProjectCommentStats, useProjectThreads } from "@/blocks/collab/feedback";
import { useEngineJobs } from "@/blocks/engine/jobs";
import { FunctionError } from "@/blocks/fn";
import { DesignTab } from "@/components/design/DesignTab";
import { FeedbackLayer } from "@/components/feedback/FeedbackLayer";
import { closeFeedback } from "@/components/feedback/feedbackUi";
import { StepFrame, type StepChip } from "@/components/step/StepFrame";
import { signOffText } from "@/components/step/stepModel";
import { cn } from "@/lib/cn";
import { stepPath } from "@/domain/phases";
import { stepName } from "@/components/project/stepNames";
import { confirmBlockers, isActiveRequirementStatus } from "@/domain/requirements";
import { threadKey } from "@/domain/feedback";
import { hasPendingFeedback, pendingFeedback } from "@/domain/pendingFeedback";
import { PendingFeedbackNote } from "@/components/step/PendingFeedbackNote";
import type { ExtraKind } from "@/domain/requirementsExtras";
import { Button, Chip, Modal, Tabs } from "@/ui/kit";
import { EasedJobBar } from "@/components/engine/EasedJobBar";
import { reducedMotion } from "../intake/IntakeShared";
import { EditingReportProvider, useEditingGuard } from "./editingGuard";
import { blockerKey, blockerText, isLandingBlocker, type ConfirmBlocker } from "./glance";
import { LandingPageSection, useLandingSection } from "./LandingPageSection";
import { isLandingJob } from "@/domain/landingPage";
import { goalsChips, goalsStatus, nowItems, type NowItemId } from "./goalsNow";
import { LookAndFeel } from "./LookAndFeel";
import { automaticDesignDirection, designSource, parseMakePrototype } from "@/domain/figmaMake";
import { designSourceCurrent, parseProductPrototype } from "@/domain/factoryDesign";
import { useDesignContext } from "@/blocks/requirements/designContext";
import { requirementsErrorMessage } from "./messages";
import { MustTab } from "./MustTab";
import { ObjectiveTab } from "./ObjectiveTab";
import { countPriorities } from "./priority";
import { QuestionsTab } from "./QuestionsTab";
import { SuggestionsTab } from "./SuggestionsTab";
import { SummaryTab } from "./SummaryTab";
import { WorkflowsTab } from "./WorkflowsTab";
import { REQ_TAB_LABEL, tabFromSearch, type ReqTab } from "./requirementsTab";

type DetailsTab = "questions" | "suggestions" | "design" | "summary";
/** The parts of Details, in order; their names are the tabs' own (REQ_TAB_LABEL, read at render time). */
const DETAILS_TABS: readonly DetailsTab[] = ["suggestions", "questions", "design", "summary"];
const DETAILS_BODY = "req-details-body";

/** Where an old ?tab= value (or an item of the checklist) lives on the page. */
const SECTION_OF: Partial<Record<ReqTab | NowItemId, string>> = {
  objective: "doc-goal", goal: "doc-goal", must: "doc-must", musts: "doc-must", comments: "doc-must",
  workflows: "doc-workflow", exclusions: "doc-exclusion", constraints: "doc-constraint",
};
const DETAILS_OF: Partial<Record<ReqTab, DetailsTab>> = { summary: "summary", questions: "questions", suggestions: "suggestions", design: "design" };
const EXTRA_OF: Partial<Record<NowItemId, ExtraKind>> = { workflows: "workflow", exclusions: "exclusion", constraints: "constraint" };

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
}

/** Opens the frame's collapsed Details (a <details> element, or a toggle button that controls the panel holding our body). */
function openDetails() {
  const body = document.getElementById(DETAILS_BODY);
  const native = body?.closest("details");
  if (native) { native.open = true; return; }
  const panel = body?.parentElement;
  const toggle = panel?.id ? document.querySelector<HTMLButtonElement>(`[aria-controls="${CSS.escape(panel.id)}"]`) : null;
  if (toggle?.getAttribute("aria-expanded") === "false") toggle.click();
}


/** A blocker in words for this page (the look & feel is a section of the document). */
function reasonText(b: ConfirmBlocker): string {
  return blockerKey(b) === "design" ? t("analysis.requirements.blockDesignPage", "Review and approve the interactive product design.") : blockerText(b);
}

export function RequirementsPage() {
  useT();
  const id = useParams().id ?? "";
  const navigate = useNavigate();
  const ctx = useRequirementsContext(id);
  const [params] = useSearchParams();
  const guard = useEditingGuard();
  const reqs = useRequirements(id);
  const objective = useObjective(id);
  const brief = useDesignBrief(id);
  const questions = useOpenClarifications(id);
  const suggestions = useSuggestions(id);
  const extras = useRequirementsExtras(id, ctx.project?.setup);
  const threads = useProjectThreads(id).data;
  const stats = useProjectCommentStats(id).data;
  const jobs = useEngineJobs(id, ["requirements.draft"]).data;
  const confirm = useConfirmRequirements(id);
  const landing = useLandingSection(id);
  const memberName = useMemberName();
  const [refusal, setRefusal] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [detailsTab, setDetailsTab] = useState<DetailsTab>(() => DETAILS_OF[tabFromSearch(params)] ?? "suggestions");
  const [addRequest, setAddRequest] = useState<{ kind: ExtraKind; n: number } | null>(null);
  const first = useRef(true);

  const canReq = Boolean(ctx.canEditRequirements);
  const canDesign = Boolean(ctx.canEditDesign);
  const reason = (can: boolean): "closed" | "permission" | null => (!ctx.open ? "closed" : can ? null : "permission");
  const editable = ctx.open && canReq;

  // ---- the checklist, the blockers and the status
  const requirements = reqs.data ?? [];
  const designIntent = useDesignContext(id);
  const obj = objective.data ?? null;
  const landingOpen = landing.review === "preparing" || landing.review === "review";
  const blockers = confirmBlockers({ requirements, objective: obj, designBrief: brief.data ?? null, landingPageOpen: landingOpen } as never) as unknown as ConfirmBlocker[];
  const designRequirements = requirements.map((r) => ({ key: r.key || r.id, title: r.title, text: r.detail, criteria: r.criteria }));
  const parsedDesign = parseProductPrototype(brief.data?.prototypeJson);
  const factoryDesign = parsedDesign?.provider !== 'figma-make' ? parsedDesign : null;
  const designCurrent = brief.data?.mode === "figma" && (factoryDesign
    ? !designIntent.isError && !designIntent.isFetching && designSourceCurrent(factoryDesign.source, designIntent.data)
    : parseMakePrototype(brief.data?.prototypeJson)?.source === designSource(automaticDesignDirection(designRequirements), designRequirements));
  if (!designCurrent && !blockers.some((b) => blockerKey(b) === "design")) blockers.push({ code: "design_not_confirmed" });
  const openComments = useMemo(() => {
    if (!threads) return 0;
    const live = new Set(requirements.filter((r) => isActiveRequirementStatus(r.status)).map((r) => threadKey("requirement", r.id)));
    for (const e of Object.values(extras.byKind).flat()) live.add(threadKey("extra", e.id));
    let n = 0;
    for (const [key, th] of threads) if (th.status === "open" && live.has(key) && (stats?.get(th.id)?.comments ?? 0) > 0) n += 1;
    return n;
  }, [threads, stats, requirements, extras.byKind]);
  // comments the business analyst still works on, and updates waiting for the person (shown before the approval)
  const pending = useMemo(() => {
    const extraList = Object.values(extras.byKind).flat();
    return pendingFeedback(threads?.values(), ["requirement", "extra"], (type, itemId) => {
      if (type === "requirement") {
        const r = requirements.find((x) => x.id === itemId && isActiveRequirementStatus(x.status));
        return r ? r.title : null;
      }
      const e = type === "extra" ? extraList.find((x) => x.id === itemId) : undefined;
      return e ? e.title : null;
    });
  }, [threads, requirements, extras.byKind]);
  const feedbackPending = hasPendingFeedback(pending);
  const input = {
    objective: obj, priorities: countPriorities(requirements),
    workflows: extras.byKind.workflow.length, exclusions: extras.byKind.exclusion.length, constraints: extras.byKind.constraint.length,
    openComments,
  };
  const items = nowItems(input);
  const left = items.filter((i) => !i.done);
  const job = (jobs ?? []).find((j) => !isLandingJob(j) && (j.status === "queued" || j.status === "claimed" || j.status === "running")) ?? null;
  const drafting = job ? (/"purpose"\s*:\s*"suggestions"/.test(job.inputJson ?? "") ? "review" : "draft") : null;
  const status = goalsStatus({ approved: ctx.past, drafting, left: left.length, blockers: blockers.length, requirements: requirements.length });
  const drafted = requirements.filter((r) => r.origin === "sanitization").length;

  // ---- jumping to a place: a section of the document, or a part of Details
  const goDetails = (tab: DetailsTab) => {
    setDetailsTab(tab);
    openDetails();
    window.setTimeout(() => scrollToId(DETAILS_BODY), 30);
  };
  const go = (where: ReqTab | NowItemId) => {
    closeFeedback({ refocus: false });
    const d = DETAILS_OF[where as ReqTab];
    if (d) return goDetails(d);
    const section = SECTION_OF[where];
    if (section) scrollToId(section);
  };
  // an old link (?tab=design, ?tab=objective…) lands on its place once the page has its data
  useEffect(() => {
    if (!first.current || !reqs.data) return;
    first.current = false;
    if (params.has("tab")) window.setTimeout(() => go(tabFromSearch(params)), 60);
  }, [reqs.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const chips: StepChip[] = goalsChips(items, input).map((c) => ({
    ...c,
    todoLabel: !editable ? "open" : c.id === "comments" ? "review" : "add",
    onClick: () => {
      go(c.id);
      const kind = EXTRA_OF[c.id];
      if (kind && c.state === "todo" && editable) setAddRequest((r) => ({ kind, n: (r?.n ?? 0) + 1 }));
    },
  }));

  // ---- the one action: Approve requirements (requirements.confirm; the server re-checks every blocker)
  const runConfirm = async () => {
    setRefusal(null);
    setAsking(false);
    confirm.mutate({}, {
      // on to the next section of Business Analysis, Scope & success (the same page: no reload)
      onSuccess: () => navigate(stepPath(id, "scope")),
      onError: (e) => {
        const missing = e instanceof FunctionError && Array.isArray(e.params?.missing) ? (e.params.missing as ConfirmBlocker[]) : null;
        setRefusal(missing && missing.length > 0 ? missing.map(blockerText).join(" ") : requirementsErrorMessage(e));
      },
    });
  };
  const reasons: ReactNode = !canReq ? t("analysis.requirements.teamApproves", "The project team approves the requirements.")
    : guard.editing ? t("analysis.requirements.saveOrCancelFirst", "Save or cancel your edit first.")
    : blockers.length > 0 ? (
      <span className="inline-flex flex-wrap justify-end gap-x-3 gap-y-1">
        {[...new Map(blockers.map((b) => [reasonText(b), b])).entries()].map(([text, b]) => (
          <button key={text} type="button" className="text-left underline decoration-dotted underline-offset-2 hover:text-ink"
            onClick={() => (isLandingBlocker(b) ? scrollToId("doc-landing") : blockerKey(b) === "design" ? scrollToId("doc-look") : go(blockerKey(b) === "objective" ? "objective" : "must"))}>{text}</button>
        ))}
      </span>
    ) : refusal;
  const brownfield = ctx.project?.type === "brownfield";
  const title = stepName("requirements", brownfield ? "brownfield" : "greenfield");

  const shared = (can: boolean, key: ReqTab) => ({
    projectId: id, editable: ctx.open && can, readOnlyReason: reason(can), onOpenTab: go, onEditingChange: guard.reporter(key),
  });
  const openSuggestions = (suggestions.data ?? []).filter((s) => s.status === "open").length;
  const openQuestions = questions.data?.length ?? 0;

  const docActions = openSuggestions + openQuestions > 0 ? (
    <>
      {openSuggestions > 0 && (
        <Button size="sm" variant="ghost" icon={<Lightbulb size={14} aria-hidden />} onClick={() => goDetails("suggestions")}>
          {openSuggestions === 1 ? t("analysis.requirements.suggestionsToDecideOne", "1 suggestion to decide")
            : t("analysis.requirements.suggestionsToDecideMany", "{count} suggestions to decide", { count: openSuggestions })}
        </Button>
      )}
      {openQuestions > 0 && (
        <Button size="sm" variant="ghost" icon={<MessageSquareText size={14} aria-hidden />} onClick={() => goDetails("questions")}>
          {openQuestions === 1 ? t("analysis.requirements.openQuestionsOne", "1 open question")
            : t("analysis.requirements.openQuestionsMany", "{count} open questions", { count: openQuestions })}
        </Button>
      )}
    </>
  ) : undefined;

  const agentLine = job ? (
    <div className="rounded-block bg-surface2 px-4 py-3">
      <p className="flex flex-wrap items-center gap-2 text-[13px] text-ink2">
        <FilePen size={15} aria-hidden className="text-[rgb(var(--c-accent-text))]" />
        <span className="font-medium text-ink">{drafting === "review" ? t("analysis.requirements.agentReviewing", "Your business analyst is reviewing the requirements") : t("analysis.requirements.agentPreparing", "Your business analyst is preparing the requirements document")}</span>
        {job.message && <span className="min-w-0 truncate">· {job.message}</span>}
      </p>
      <EasedJobBar progress={job.progress} working={job.status !== "queued"} resetKey={job.id} label={t("analysis.requirements.analystAtWork", "Business analyst at work")} size="sm" className="mt-2" />
    </div>
  ) : null;

  const details = (
    <div id={DETAILS_BODY} className="scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)]">
      <div className="scroll-thin mb-4 overflow-x-auto">
        <Tabs idPrefix="req" label={t("analysis.requirements.details", "Details")} className="w-max min-w-full" tabs={DETAILS_TABS.map((value) => ({
          value,
          label: value === "suggestions" && openSuggestions > 0 ? `${REQ_TAB_LABEL[value]} (${openSuggestions})`
            : value === "questions" && openQuestions > 0 ? `${REQ_TAB_LABEL[value]} (${openQuestions})` : REQ_TAB_LABEL[value],
        }))} value={detailsTab} onChange={setDetailsTab} />
      </div>
      <div role="tabpanel" id="req-panel-suggestions" aria-labelledby="req-tab-suggestions" className={cn("min-w-0 flex-col gap-6", detailsTab === "suggestions" ? "flex" : "hidden")}>
        <SuggestionsTab {...shared(canReq, "suggestions")} />
      </div>
      <div role="tabpanel" id="req-panel-questions" aria-labelledby="req-tab-questions" className={cn("min-w-0 flex-col gap-6", detailsTab === "questions" ? "flex" : "hidden")}>
        <QuestionsTab projectId={id} />
      </div>
      <div role="tabpanel" id="req-panel-design" aria-labelledby="req-tab-design" className={cn("min-w-0 flex-col gap-6", detailsTab === "design" ? "flex" : "hidden")}>
        {detailsTab === "design" && <DesignTab {...shared(canDesign, "design")} />}
      </div>
      <div role="tabpanel" id="req-panel-summary" aria-labelledby="req-tab-summary" className={cn("min-w-0 flex-col gap-6", detailsTab === "summary" ? "flex" : "hidden")}>
        <SummaryTab projectId={id} />
      </div>
    </div>
  );

  return (
    <EditingReportProvider value={guard.report}>
      <StepFrame
        subject={ctx.project?.name || undefined}
        title={title}
        status={status.text}
        statusTone={status.tone}
        role={t("analysis.requirements.roleWho", "Business analyst")}
        deliverable={t("analysis.requirements.roleDelivers", "prepares your Requirements document")}
        yourPart={canReq ? t("analysis.requirements.roleYou", "review, comment, ask for changes, then approve") : t("analysis.requirements.roleReader", "read and comment")}
        primary={ctx.open ? {
          label: t("analysis.requirements.approve", "Approve requirements"),
          onClick: () => (left.length > 0 || feedbackPending ? setAsking(true) : void runConfirm()),
          disabled: !canReq || guard.editing || blockers.length > 0,
           pending: confirm.isPending, pendingLabel: t("analysis.requirements.approving", "Approving…"),
          reason: reasons ?? undefined,
        } : undefined}
        chips={chips}
        agentLine={agentLine}
        signedOff={ctx.past ? {
          text: signOffText({ verb: t("analysis.requirements.approvedVerb", "Requirements approved"), by: memberName(ctx.project?.requirementsConfirmedBy) ?? null, at: ctx.project?.requirementsConfirmedAt ?? null }),
          next: { label: t("analysis.requirements.openScope", "Open {step}", { step: stepName("scope") }), href: stepPath(id, "scope") },
        } : undefined}
        details={details}
        detailsLabel={openSuggestions + openQuestions > 0
          ? t("analysis.requirements.detailsLabelOpen", "Details · suggestions, questions, look & feel ({count} open)", { count: openSuggestions + openQuestions })
          : t("analysis.requirements.detailsLabel", "Details · suggestions, questions, look & feel")}
        detailsOpen={Boolean(DETAILS_OF[tabFromSearch(params)] && params.has("tab"))}
        mainTitle={t("analysis.requirements.document", "Requirements document")}
        mainActions={docActions}
      >
        <article aria-label={t("analysis.requirements.document", "Requirements document")} className="rounded-card bg-surface px-5 py-6 shadow-card dark:ring-1 dark:ring-line sm:px-8">
          {!canReq && ctx.open && (
            <p className="mb-5 flex items-start gap-2 rounded-block bg-surface2 px-4 py-3 text-[14px] text-ink2">
              <MessageSquareText size={16} aria-hidden className="mt-0.5 shrink-0 text-ink3" />
              <span>{t("analysis.requirements.readerNote", "You can read the whole document and comment on any item. Changing it and approving it is up to the project team.")}</span>
            </p>
          )}

          <div className="divide-y divide-line [&>*]:py-6 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0">
            <section id="doc-goal" aria-label={t("analysis.requirements.goal", "Goal")} className="scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)]">
              <ObjectiveTab {...shared(canReq, "objective")} bare />
            </section>
            <section id="doc-must" aria-label={t("analysis.requirements.tabMust", "What it must do")} className="scroll-mt-[calc(var(--project-nav-h,var(--topbar-h,0px))+24px)]">
              <MustTab {...shared(canReq, "must")} bare note={drafted > 0 && ctx.open ? (
                <p className="mb-3 flex flex-wrap items-center gap-2 rounded-block bg-accent-soft/60 px-3 py-2 text-[13px] text-ink">
                  <ListChecks size={15} aria-hidden className="text-[rgb(var(--c-accent-text))]" />
                  <Chip tone="accent">{t("analysis.requirements.landingPrepared", "Prepared by your business analyst — review")}</Chip>
                  <span className="text-ink2">{canReq ? t("analysis.requirements.reviewHintEditor", "Comment on anything, change a priority or edit an item, then approve.") : t("analysis.requirements.reviewHintReader", "Comment on anything you would like changed.")}</span>
                </p>
              ) : null} />
            </section>
            <WorkflowsTab {...shared(canReq, "workflows")} addRequest={addRequest} />
            <LookAndFeel projectId={id} editable={ctx.open && canDesign} waiting={drafting === "draft" || requirements.length === 0} onChange={() => goDetails("design")} />
            {landing.review !== "none" && (
              <LandingPageSection projectId={id} state={landing} editable={editable} memberName={memberName} />
            )}
          </div>
        </article>
      </StepFrame>
      <FeedbackLayer />

      <Modal open={asking} onClose={() => setAsking(false)} title={left.length > 0 ? t("analysis.requirements.askOpenTitle", "Approve with items still open?") : t("analysis.requirements.askTitle", "Approve the requirements now?")}
        footer={<>
          <Button variant="ghost" onClick={() => { setAsking(false); if (left[0]) go(left[0].id); }}>{t("analysis.requirements.notYet", "Not yet")}</Button>
          <Button variant="primary" disabled={confirm.isPending} onClick={() => void runConfirm()}>{t("analysis.requirements.approveAnyway", "Approve anyway")}</Button>
        </>}>
        {feedbackPending && (
          <div className={left.length > 0 ? "mb-4" : undefined}>
            <PendingFeedbackNote pending={pending} workingNote={t("analysis.requirements.workingNote", "Your business analyst is still answering these comments. If you approve now, the scope is written without their changes.")}
              waitingNote={t("analysis.requirements.waitingNote", "Your business analyst changed these after your comments. Have a look before you approve, or approve anyway.")} />
          </div>
        )}
        {left.length > 0 && (
          <>
            <p className="text-[14px] text-ink2">
              {left.length === 1 ? t("analysis.requirements.checklistOpenOne", "One item on the checklist is still open:")
                : t("analysis.requirements.checklistOpenMany", "{count} items on the checklist are still open:", { count: left.length })}
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[14px]">
              {left.map((i) => <li key={i.id}><span className="font-medium">{i.label}</span> <span className="text-ink2">— {i.detail}</span></li>)}
            </ul>
            <p className="mt-3 text-[13px] text-ink2">{t("analysis.requirements.approveAnywayNote", "You can approve anyway; the scope is then written without them.")}</p>
          </>
        )}
      </Modal>
    </EditingReportProvider>
  );
}
