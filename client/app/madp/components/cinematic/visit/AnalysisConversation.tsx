/** Business Analysis with the business analyst at the meeting table: the analyst's checklist of the analysis page
 *  (analysis-next AnalystColumn), item by item in its order, each a turn of the conversation on the page's own reads and
 *  writes. A conversation, not a form: any real answer is taken (short answers are answers), "later" / "not sure" go the
 *  app's own way (set aside; for the questions clarification.defer with its standard reasons) and the conversation moves
 *  on, "yes" / "ok" confirm where something is to be confirmed, and no line is ever repeated in a loop.
 *   - "Objective and the people who will use it": the analyst's two questions, clarification.answerBrief (project.setup
 *     during Project Setup), any answer counts (domain/projectBrief briefAnswers);
 *   - "Check what I understood": what was read, then Confirm (POST /api/brief/:id/confirm, then the questions job when
 *     it never ran), as UnderstoodStep does;
 *   - "A few questions": QuestionsTalk.tsx (the engine's own questions, in its words);
 *   - "Approve the requirements" and "Agree and lock the scope": the page's own approve card and lock card (with their
 *     blockers, checklist and dialog), opened with the analysis; "yes" approves the requirements (requirements.confirm,
 *     the server re-checks every blocker) and opens the lock card;
 *  and, once the scope is locked, the hand-over to Software Engineering. The step list's "now" and "Next for you" come
 *  from the same item as the conversation (flow.ts nextForItem). The page's entry op for the scope (scope.open) is sent
 *  the same way (useOpenScopeOnEntry). */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useT } from "@/madp/i18n";
import type { ProjectRecord } from "@/madp/blocks/projects/records";
import { useCan } from "@/madp/blocks/projects/context";
import { useSetupProject } from "@/madp/blocks/projects/mutations";
import { blocksKeys } from "@/madp/blocks/data/keys";
import { FunctionError } from "@/madp/blocks/fn";
import { useEngineJobs } from "@/madp/blocks/engine/jobs";
import { isActiveEngineJob } from "@/madp/blocks/engine/types";
import { clarificationsOptions, latestAssistJob, useStepAccess } from "@/madp/blocks/sanitization/hooks";
import { useAnswerBrief, useAskMadp } from "@/madp/blocks/sanitization/ops";
import { sanitizationErrorText } from "@/madp/blocks/sanitization/messages";
import { useConfirmRequirements } from "@/madp/blocks/requirements/mutations";
import { answersFromProject, toSetupArgs } from "@/madp/domain/guidedStart";
import { stepIndex } from "@/madp/domain/journey";
import { BriefRequestError, confirmBrief, fetchBrief, type Brief } from "@/madp/components/understanding/briefApi";
import { fileCounts, fileState } from "@/madp/components/understanding/model";
import { briefRefetchInterval } from "@/madp/components/analysis/doc/briefQuery";
import { blockerText, type ConfirmBlocker } from "@/madp/components/requirements/glance";
import { requirementsErrorMessage } from "@/madp/components/requirements/messages";
import { ANALYST_ITEMS, type AnalysisCtx, type AnalystItem, type NextAction } from "@/madp/components/analysis-next/model";
import { analystChecklistStates, briefAnswers, briefKey, briefQuestions, myWords, readLine } from "@/madp/components/analysis-next/analyst/analystModel";
import { NEXT_TEXT } from "@/madp/components/analysis-next/next/nextAction";
import { useNextAction } from "@/madp/components/analysis-next/next/useNextAction";
import { useOpenScopeOnEntry } from "@/madp/components/analysis-next/next/scopeOpen";
import { settleAck, useChat } from "./chat";
import { analysisIndicator, analysisItemOf, nextForItem } from "./flow";
import { ackFor } from "./acks";
import { intentOf } from "./intent";
import { useVisit } from "./store";
import { QuestionsTalk } from "./QuestionsTalk";
import { useTurn, useWorking } from "./useTurn";

const PM = "pm" as const;
const MAX = { goal: 2000, users: 1000 } as const;

export function AnalysisConversation({ project, workspaceId, visitor, arrived }: { project: ProjectRecord; workspaceId: string; visitor: string; arrived: boolean }) {
  const t = useT();
  const ctx: AnalysisCtx = { projectId: project.id, workspaceId, step: project.step, type: project.type };
  const picked = useVisit((s) => s.picked);
  const aside = useVisit((s) => s.aside);
  const setIndicator = useVisit((s) => s.setIndicator);
  const locked = stepIndex(project.step) >= stepIndex("board");
  const reached = project.step !== "business";

  // the page's entry op for Scope & success, and its "Next for you"
  useOpenScopeOnEntry(ctx);
  const next = useNextAction(ctx);

  // the checklist, read and worked out exactly as the analyst's column does
  const briefQ = useQuery<Brief, BriefRequestError>({
    queryKey: briefKey(project.id),
    queryFn: ({ signal }) => fetchBrief(project.id, signal),
    enabled: reached,
    refetchInterval: briefRefetchInterval,
    retry: (count, e) => !(e instanceof BriefRequestError && e.status < 500) && count < 2,
  });
  const brief = briefQ.data ?? null;
  const asked = useQuery({ ...clarificationsOptions({ workspaceId, projectId: project.id }), enabled: Boolean(workspaceId && reached) });
  const askedRows = (asked.data ?? []) as { Question: string; Answer?: string | null; Status: string }[];
  const answers = briefAnswers({ name: project.name, goal: project.goal, users: project.targetUsers, asked: askedRows });
  const states = analystChecklistStates(project.step, { briefReady: answers.missing.length === 0, understoodConfirmed: Boolean(brief?.confirmedAt) }, null);
  const item = analysisItemOf(states, picked, new Set(aside));
  const marks = analysisIndicator(states, item);
  // "Next for you" says what the conversation is doing now (never another item than the list's "now")
  const words: Record<AnalystItem, { title: string; detail: string }> = {
    brief: { title: NEXT_TEXT.brief.title, detail: NEXT_TEXT.brief.detail },
    understood: { title: NEXT_TEXT.understood.title, detail: NEXT_TEXT.understood.detail },
    questions: { title: t("studio.office.visit.items.questions", "A few questions"), detail: NEXT_TEXT.questionsDetail },
    requirements: { title: NEXT_TEXT.requirements.title, detail: NEXT_TEXT.requirements.detail },
    scope: { title: NEXT_TEXT.scope.title, detail: NEXT_TEXT.scope.detail },
  };
  const nextWords = locked ? { title: NEXT_TEXT.done.title, detail: NEXT_TEXT.done.detail } : nextForItem(item, next, words);

  const marksKey = JSON.stringify(marks);
  useEffect(() => {
    setIndicator({ phase: locked ? "engineering" : "analysis", items: ANALYST_ITEMS.map((id) => ({ id, state: locked ? "done" : marks[id] })), next: nextWords });
  }, [marksKey, nextWords.title, nextWords.detail, locked, setIndicator]); // eslint-disable-line react-hooks/exhaustive-deps

  // the analyst greets you at the table once, before the first item's words (the items' turns wait for it: a child's
  // effects would otherwise run first)
  const [greeted, setGreeted] = useState(false);
  useEffect(() => {
    if (!arrived) return;
    const first = visitor.trim().split(/\s+/)[0] ?? "";
    void useChat.getState().say(PM, t("studio.office.visit.pm.hello", "Hello{name}, I'm your business analyst. I'll take you through this one step at a time.", { name: first ? ` ${first}` : "" }), { key: `pm:hello:${project.id}` });
    setGreeted(true);
  }, [project.id, arrived]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!greeted) return null;
  if (locked) return <LockedTalk />;
  // the checklist decides only on what the records say: never a question that is already answered
  const loaded = !reached || ((asked.data !== undefined || asked.isError) && (briefQ.data !== undefined || briefQ.isError));
  if (!loaded) return <Opening />;
  switch (item) {
    case "brief":
      return <BriefTalk project={project} workspaceId={workspaceId} missing={answers.missing} />;
    case "understood":
      return <UnderstoodTalk project={project} workspaceId={workspaceId} brief={brief} briefError={briefQ.isError} waitingForBrief={briefQ.isFetching && !brief} />;
    case "questions":
      return <QuestionsTalk projectId={project.id} workspaceId={workspaceId} projectName={project.name} existing={project.type === "brownfield"} />;
    case "requirements":
      return <SignOffTalk item="requirements" next={next} project={project} workspaceId={workspaceId} />;
    case "scope":
      return <SignOffTalk item="scope" next={next} project={project} workspaceId={workspaceId} />;
  }
}

/** While the analysis's records are read. */
function Opening() {
  const t = useT();
  useWorking(PM, t("studio.office.visit.pm.opening", "Opening your analysis"));
  return null;
}

/* ── Objective and the people who will use it ───────────────────────────── */

function BriefTalk({ project, workspaceId, missing }: { project: ProjectRecord; workspaceId: string; missing: ("goal" | "users")[] }) {
  const t = useT();
  const q = briefQuestions(project.name);
  const inSetup = project.step === "business";
  const canSetup = useCan("project.edit");
  const ctx = { workspaceId, projectId: project.id };
  const access = useStepAccess(ctx);
  const canAnswer = inSetup ? canSetup : access.canEdit;
  const setup = useSetupProject();
  const answerBrief = useAnswerBrief(ctx);
  const setAside = useVisit((s) => s.setAside);
  const asking = missing[0] ?? null;
  const chat = useChat.getState();

  const send = async (text: string) => {
    if (!asking) return;
    chat.you(text);
    const intent = intentOf(text);
    // "later", "not sure", "ok": this item waits (it stays open on the list) and the conversation moves on
    if (intent) {
      void chat.say(PM, ackFor("later"));
      setAside("brief");
      return;
    }
    // any real answer is an answer, however short: the next turn says the acknowledgement first
    chat.expectAck(PM, ackFor(asking === "goal" ? "goal" : "users", text));
    try {
      await chat.whileBusy(PM, null, async () => {
        if (inSetup) {
          const a = answersFromProject(project);
          const nextA = asking === "goal" ? { ...a, goal: text.slice(0, MAX.goal), goalTags: [] } : { ...a, users: text.slice(0, MAX.users), userTags: [] };
          await setup.run(toSetupArgs(project.id, nextA, project.name));
        } else {
          await answerBrief.mutateAsync({ projectId: project.id, about: asking, answer: text.slice(0, MAX[asking]) });
        }
      });
      settleAck(true);
    } catch (e) {
      settleAck(false);
      void chat.say(PM, myWords(sanitizationErrorText(e)), { tone: "error" });
    }
  };

  const lines = !asking ? [] : asking === "goal"
    ? [t("studio.office.visit.brief.goalIntro", "I'd like to be sure what this is for, in your own words."), q.goal]
    : [q.users];
  if (asking && !canAnswer) lines.push(t("studio.office.visit.brief.team", "Someone on the project team with edit rights answers this."));
  useTurn(PM, asking ? `brief:${asking}` : null, lines, asking ? {
    mode: "text",
    label: asking === "goal" ? q.goal : q.users,
    multiline: true,
    maxLength: MAX[asking],
    placeholder: asking === "goal"
      ? t("studio.office.visit.brief.goalPlaceholder", "For example: let our customers book and pay for repairs online.")
      : t("studio.office.visit.brief.usersPlaceholder", "For example: our service desk, and customers on their phones."),
    replies: canAnswer ? [{ id: "later", label: t("studio.office.visit.q.later", "Later"), quiet: true }] : [],
    onSend: canAnswer ? (text) => void send(text) : undefined,
    onReply: () => { chat.you(t("studio.office.visit.q.later", "Later")); void chat.say(PM, ackFor("later")); setAside("brief"); },
  } : null);
  return null;
}

/* ── Check what I understood ─────────────────────────────────────────────── */

function UnderstoodTalk({ project, workspaceId, brief, briefError, waitingForBrief }: {
  project: ProjectRecord; workspaceId: string; brief: Brief | null; briefError: boolean; waitingForBrief: boolean;
}) {
  const t = useT();
  const qc = useQueryClient();
  const canEdit = useCan("business.edit");
  const jobs = useEngineJobs(project.id, ["sanitization.assist"]).data ?? [];
  const ask = useAskMadp({ workspaceId, projectId: project.id });
  const openSheet = useVisit((s) => s.openSheet);
  const setAside = useVisit((s) => s.setAside);
  const chat = useChat.getState();

  // "I read … N files": the files really read (not those still being read, failed, not read or not supported)
  const files = brief ? fileCounts(brief.attachmentStatus).read : 0;
  const reading = (brief?.attachmentStatus ?? []).filter((f) => ["processing", "pending"].includes(fileState(f.status))).length;
  const requirements = brief ? brief.features.reduce((n, f) => n + f.confirmedRequirements.length + f.proposedRequirements.length, 0) : 0;
  const conflicts = brief ? brief.conflicts.filter((c) => !c.resolution).length : 0;
  const afterQuestionsStarted = stepIndex(project.step) >= stepIndex("sanitization");

  useWorking(PM, !brief && !briefError ? t("studio.office.visit.understood.reading", "Reading your project setup and files")
    : reading > 0 ? (reading === 1 ? t("studio.office.visit.understood.oneFile", "One file is still being read") : t("studio.office.visit.understood.files", "{n} files are still being read", { n: reading }))
    : null);

  const confirm = async (said: string) => {
    chat.you(said);
    chat.expectAck(PM, ackFor("confirm"));
    try {
      await chat.whileBusy(PM, null, async () => {
        qc.setQueryData(briefKey(project.id), await confirmBrief(project.id));
        const job = latestAssistJob(jobs, "clarifications");
        if (!job || !(isActiveEngineJob(job) || job.status === "succeeded")) await ask.mutateAsync({ projectId: project.id, focus: "clarifications" }).catch(() => undefined);
        await qc.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, "Project") });
      });
      settleAck(true);
    } catch (e) {
      settleAck(false);
      const text = e instanceof BriefRequestError && e.code === "conflicts_open" ? t("studio.office.visit.understood.conflictsOpen", "A few points still disagree between your sources. Settle them in “What we understood” first.")
        : e instanceof BriefRequestError && e.status === 401 ? t("studio.office.visit.understood.session", "Your session has ended. Sign in again to continue.")
        : e instanceof BriefRequestError && (e.status === 403 || e.status === 404) ? t("studio.office.visit.understood.noAccess", "You don't have access to this project.")
        : t("studio.office.visit.understood.failed", "I couldn't save that just now.");
      void chat.say(PM, text, { tone: "error" });
    }
  };
  const later = (said: string) => {
    chat.you(said);
    void chat.say(PM, ackFor("later"));
    setAside("understood");
  };
  const onSend = (text: string) => {
    const intent = intentOf(text);
    if (intent === "yes" && canEdit && reading === 0 && !waitingForBrief) { void confirm(text); return; }
    if (intent === "later" || intent === "notSure" || intent === "no") { later(text); return; }
    // anything else: a correction or a remark; it belongs in "What we understood", where it can be changed
    chat.you(text);
    void chat.say(PM, t("studio.office.visit.understood.toPart", "Let's put that right in “What we understood”. I've opened it for you."));
    openSheet("understood");
  };

  const found = requirements
    ? (requirements === 1 ? t("studio.office.visit.understood.foundOne", "I found one requirement so far.") : t("studio.office.visit.understood.found", "I found {n} requirements so far.", { n: requirements }))
    : t("studio.office.visit.understood.foundNone", "Your material doesn't name requirements yet. We'll work them out together.");
  const lines = briefError ? [t("studio.office.visit.understood.openFailed", "I couldn't open what I read from your project just now.")]
    : !brief ? []
    : [
      `${readLine(files)} ${found}`,
      ...(conflicts > 0 ? [conflicts === 1
        ? t("studio.office.visit.understood.conflict", "One point disagrees between your sources. Please settle it in “What we understood”.")
        : t("studio.office.visit.understood.conflicts", "{n} points disagree between your sources. Please settle them in “What we understood”.", { n: conflicts })] : []),
      afterQuestionsStarted
        ? t("studio.office.visit.understood.ask", "Have a look at what I understood. If it's right, confirm it.")
        : t("studio.office.visit.understood.askThenQuestions", "Have a look at what I understood. If it's right, confirm it and I'll move on to my questions."),
      ...(!canEdit ? [t("studio.office.visit.understood.team", "Someone on the project team with edit rights confirms this.")] : []),
    ];
  useTurn(PM, briefError ? "understood:error" : brief ? `understood:${files}:${requirements}:${conflicts}` : null, lines, briefError ? {
    mode: "text", label: t("studio.office.visit.understood.label", "Check what I understood"),
    replies: [{ id: "retry", label: t("studio.office.visit.q.retry", "Try again"), primary: true }],
    onReply: () => void qc.invalidateQueries({ queryKey: briefKey(project.id) }),
    onSend: () => void qc.invalidateQueries({ queryKey: briefKey(project.id) }),
  } : brief ? {
    mode: "text", label: t("studio.office.visit.understood.label", "Check what I understood"),
    placeholder: t("studio.office.visit.understood.placeholder", "Say yes to confirm, or tell me what's not right"),
    replies: [
      ...(canEdit ? [{ id: "confirm", label: t("studio.office.visit.understood.confirm", "Confirm"), primary: true, disabled: reading > 0 || waitingForBrief }] : []),
      { id: "show", label: t("studio.office.visit.understood.show", "Show what you understood") },
      { id: "later", label: t("studio.office.visit.q.later", "Later"), quiet: true },
    ],
    onReply: (id) => (id === "confirm" ? void confirm(t("studio.office.visit.understood.confirm", "Confirm")) : id === "later" ? later(t("studio.office.visit.q.later", "Later")) : openSheet("understood")),
    onSend,
  } : null);
  return null;
}

/* ── Approve the requirements · Agree and lock the scope ─────────────────── */

/** The page's own approve card / lock card, opened with the analysis; the analyst says one line about it and works
 *  (thinks) while the records say the requirements or the scope are being written. "Yes" approves the requirements
 *  (the server re-checks every blocker and says what is missing) and opens the lock card. */
function SignOffTalk({ item, next, project, workspaceId }: { item: Extract<AnalystItem, "requirements" | "scope">; next: NextAction; project: ProjectRecord; workspaceId: string }) {
  const t = useT();
  const qc = useQueryClient();
  const openSheet = useVisit((s) => s.openSheet);
  const confirm = useConfirmRequirements(project.id);
  const chat = useChat.getState();
  const working = next.working && (next.item === item || next.item === null) ? next.detail : null;
  useWorking(PM, working);
  const ready = !working && next.item === item;
  const open = () => openSheet(item === "requirements" ? "features" : "scope", item);

  const approve = (said: string) => {
    chat.you(said);
    chat.expectAck(PM, ackFor("confirm"));
    void chat.whileBusy(PM, null, () => confirm.mutateAsync({})).then(
      () => { settleAck(true); void qc.invalidateQueries({ queryKey: blocksKeys.schema(workspaceId, "Project") }); },
      (e: unknown) => {
        settleAck(false);
        const missing = e instanceof FunctionError && Array.isArray(e.params?.missing) ? (e.params.missing as ConfirmBlocker[]) : null;
        void chat.say(PM, myWords(missing && missing.length ? missing.map(blockerText).join(" ") : requirementsErrorMessage(e)), { tone: "error" });
      },
    );
  };
  const onSend = (text: string) => {
    const intent = intentOf(text);
    if (intent === "yes" && item === "requirements") { approve(text); return; }
    chat.you(text);
    if (intent === "yes") {
      void chat.say(PM, t("studio.office.visit.scope.lockHere", "Here is the lock card: check the list once more and lock it."));
      open();
      return;
    }
    if (intent) { void chat.say(PM, t("studio.office.visit.signoff.whenReady", "Fine. Take your time; say yes when it looks right.")); return; }
    // a remark: it belongs on the analysis, where it can be changed or commented on
    void chat.say(PM, t("studio.office.visit.signoff.toAnalysis", "Let's put that on the analysis, where you can change or comment on it. I've opened it for you."));
    open();
  };

  const lines = !ready ? []
    : item === "requirements"
      ? [t("studio.office.visit.req.say", "With your answers I've written the requirements. Read them through, comment on anything you'd change, then approve them.")]
      : [t("studio.office.visit.scope.say", "The requirements are now features, user stories and milestones. Check them and the success targets; when it all looks right, lock the scope.")];
  useTurn(PM, ready ? `${item}:${project.id}` : null, lines, {
    mode: "text",
    label: item === "requirements" ? t("studio.office.visit.req.label", "Approve the requirements") : t("studio.office.visit.scope.label", "Agree and lock the scope"),
    placeholder: item === "requirements" ? t("studio.office.visit.req.placeholder", "Say yes to approve, or tell me what to change") : t("studio.office.visit.scope.placeholder", "Say yes when it looks right"),
    replies: item === "requirements"
      ? [
        { id: "review", label: t("studio.office.visit.req.review", "Review and approve"), primary: true },
        // the product design is reviewed and approved in "Screens and look & feel", as on the page
        { id: "screens", label: t("studio.office.visit.req.design", "Review the product design") },
      ]
      : [{ id: "review", label: t("studio.office.visit.scope.review", "Review and lock"), primary: true }],
    onReply: (id) => (id === "screens" ? openSheet("screens", "requirements") : open()),
    onSend,
  });
  return null;
}

/* ── after the lock ──────────────────────────────────────────────────────── */

function LockedTalk() {
  const t = useT();
  const goBuild = useVisit((s) => s.goBuild);
  useTurn(PM, "locked", [
    t("studio.office.visit.locked.say", "The scope is locked. Your team starts building now: they plan the work, build it and test it in Software Engineering."),
  ], {
    mode: "text",
    label: t("studio.office.visit.locked.label", "Software Engineering"),
    placeholder: t("studio.office.visit.locked.placeholder", "Say yes to go to your team"),
    replies: [{ id: "build", label: t("studio.office.visit.locked.go", "Your team starts building"), primary: true }],
    onReply: () => goBuild(),
    onSend: (text) => { useChat.getState().you(text); if (intentOf(text) !== "no") goBuild(); },
  });
  return null;
}
