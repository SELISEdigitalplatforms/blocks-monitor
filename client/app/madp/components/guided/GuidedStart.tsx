/** The guided project start: a large dialog over the app that asks one question per step, with a progress bar that
 *  keeps "pushing" while the person is on a step. New project (Projects, Home, the rail's New) opens it; Home's box
 *  hands over its words as the description. Nothing is created until the last step's button: then the project is
 *  created (the same project.create as the New project form, plus the answers) and its setup page opens, where the
 *  documents and notes flow continues as before. The draft survives a reload; Escape or Close asks before leaving. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight, CornerDownLeft, Eye, X } from "lucide-react";
import { isNotConfigured, messageFor, NOT_CONFIGURED_MESSAGE, useProjectsContext } from "@/madp/blocks/projects";
import { useCreateProjectOnce, useSetupProject } from "@/madp/blocks/projects/mutations";
import { useWorkspaces } from "@/madp/blocks/workspaces/store";
import { useSession } from "@/madp/blocks/session";
import { useGithubStatus } from "@/madp/blocks/github";
import { newRequestId } from "@/madp/blocks/fn";
import { can } from "@/madp/domain/rbac";
import { viewerTip } from "@/madp/data/rbac";
import {
  EDIT_STEPS, STEPS, nextStep, prevStep, stepIndex, toCreateArgs, toSetupArgs, validateStep, type StartAnswers, type StepErrors, type StepId,
} from "@/madp/domain/guidedStart";
import { usePersona } from "@/madp/state/store";
import { Banner, Button, useBackdropDismiss } from "@/madp/ui/kit";
import { ShimmerProgress } from "@/madp/ui/ShimmerProgress";
import { KBD } from "@/madp/components/intake/IntakeShared";
import { cn } from "@/madp/lib/cn";
import { t, useT } from "@/madp/i18n";
import { AboutStep, GoalStep, KindStep, ReadyStep, StepHeading, WhereExistingStep, WhereNewStep } from "./GuidedSteps";
import { Illustration } from "@/madp/components/setup/SetupWindow";
import { closeGuidedStart, finishGuidedStart, goToStep, hasAnswers, loadGuidedDraft, setAnswers, useGuidedStart } from "./store";
import { prefixPath } from "@/madp/lib/pathPrefix";

export { openGuidedStart } from "./store";

/** A step's shown title (the domain's STEP_TITLE keeps the English). */
function stepTitle(step: StepId): string {
  switch (step) {
    case "kind": return t("shell.guided.steps.kind", "Your idea");
    case "about": return t("shell.guided.steps.about", "About the project");
    case "goal": return t("shell.guided.steps.goal", "Goal and users");
    case "where": return t("shell.guided.steps.where", "Where it lives");
    default: return t("shell.guided.steps.ready", "Ready");
  }
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Mounted with the app shell: shows the dialog while it is open (a draft left open reopens after a reload). */
export function GuidedStartHost() {
  const status = useSession((s) => s.status);
  const userId = useSession((s) => s.profile?.userId ?? "");
  const mustChange = useSession((s) => s.status === "signed-in" && s.profile?.mustChangePassword === true);
  const persona = usePersona();
  const open = useGuidedStart((s) => s.open);
  const owner = useGuidedStart((s) => s.owner);
  useEffect(() => { if (status === "signed-in" && userId) loadGuidedDraft(); }, [status, userId]);
  if (status !== "signed-in" || mustChange || !persona || !open || owner !== userId) return null;
  return <GuidedStartDialog />;
}

/** After a failed Continue: the first field with an error. Otherwise: the step's first field (or chosen card), else its heading. */
function focusStep(root: HTMLElement | null, headingId: string, invalidOnly = false) {
  if (!root) return;
  const target = invalidOnly
    ? root.querySelector<HTMLElement>('[aria-invalid="true"]') ?? root.querySelector<HTMLElement>('[role="radiogroup"] input:not(:disabled)')
    : root.querySelector<HTMLElement>("[data-step-focus]")
      ?? root.querySelector<HTMLElement>('[role="radiogroup"] input:checked')
      ?? root.querySelector<HTMLElement>('[role="radiogroup"] input:not(:disabled)');
  (target ?? document.getElementById(headingId))?.focus({ preventScroll: !invalidOnly });
}

function GuidedStartDialog() {
  useT();
  const navigate = useNavigate();
  const step = useGuidedStart((s) => s.step);
  const dir = useGuidedStart((s) => s.dir);
  const a = useGuidedStart((s) => s.answers);
  const editing = useGuidedStart((s) => s.mode === "edit");
  const projectId = useGuidedStart((s) => s.projectId);
  const setup = useSetupProject();
  // what the answers were when the dialog opened (edit mode: changed or not, the name it had)
  const initial = useRef(a);
  const github = useGithubStatus();
  const login = github.data?.connected ? github.data.login ?? null : null;
  const ctx = useProjectsContext();
  const ready = useWorkspaces((s) => s.ready);
  const canCreate = ctx.isSuperAdmin || can(ctx.permissions, "project.create");
  const { create, isPending: creating } = useCreateProjectOnce();
  const isPending = creating || setup.isPending;
  const [showErrors, setShowErrors] = useState(false);
  const [confirm, setConfirm] = useState(false);
  // "Change" on the last step: once that answer is done, Continue goes straight back to the summary
  const [fromReview, setFromReview] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const requestId = useRef<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const advance = useRef<number | null>(null);
  const headingId = useId();
  const statusId = useId();
  const editIndex = EDIT_STEPS.indexOf(step);
  const index = editing ? Math.max(0, editIndex) : stepIndex(step);
  const total = editing ? EDIT_STEPS.length : STEPS.length;
  const errors: StepErrors = showErrors ? validateStep(step, a, login, { skipRepo: editing }) : {};

  const set = (patch: Partial<StartAnswers>) => { setAnswers(patch); requestId.current = null; setFailure(null); };
  const go = (to: StepId, d: 1 | -1) => {
    if (advance.current) { window.clearTimeout(advance.current); advance.current = null; }
    setShowErrors(false);
    setFailure(null);
    goToStep(to, d);
  };

  const submit = () => {
    if (isPending || !ready || !canCreate) return;
    const s = useGuidedStart.getState();
    // every step must still hold (answers can change elsewhere, e.g. GitHub disconnected): send the person there
    for (const st of STEPS) {
      if (Object.keys(validateStep(st, s.answers, login)).length) { go(st, -1); setShowErrors(true); return; }
    }
    if (!requestId.current) requestId.current = newRequestId();
    const createArgs = toCreateArgs(s.answers, login);
    // In Blocks shell: always stamp the current Blocks project ID
    const blocksId = (window as unknown as Record<string, unknown>).__BLOCKS_ITEM_ID__ as string | undefined;
    if (blocksId && !createArgs.blocksProjectRef) createArgs.blocksProjectRef = blocksId;
    create(createArgs, requestId.current).then(
      (r) => {
        requestId.current = null;
        finishGuidedStart();
        navigate(prefixPath(`/p/${r.project.id}/business`));
      },
      (e: unknown) => setFailure(isNotConfigured(e) ? NOT_CONFIGURED_MESSAGE : messageFor(e)),
    );
  };

  /** Edit mode: every changed answer is saved at once (project.setup rewrites the Project brief note), then the dialog closes. */
  const save = () => {
    if (isPending || !projectId) return;
    const s = useGuidedStart.getState();
    for (const st of EDIT_STEPS) {
      if (Object.keys(validateStep(st, s.answers, login, { skipRepo: true })).length) {
        go(st, EDIT_STEPS.indexOf(st) < EDIT_STEPS.indexOf(s.step) ? -1 : 1);
        setShowErrors(true);
        window.setTimeout(() => focusStep(form.current, headingId, true), 0);
        return;
      }
    }
    setup.run(toSetupArgs(projectId, s.answers, initial.current.name)).then(
      () => closeGuidedStart(false),
      (e: unknown) => setFailure(messageFor(e)),
    );
  };

  const next = () => {
    const s = useGuidedStart.getState();
    if (s.step === "ready") { submit(); return; }
    const e = validateStep(s.step, s.answers, login, { skipRepo: editing });
    if (Object.keys(e).length) {
      setShowErrors(true);
      window.setTimeout(() => focusStep(form.current, headingId, true), 0);
      return;
    }
    if (editing) {
      const i = EDIT_STEPS.indexOf(s.step);
      if (i < EDIT_STEPS.length - 1) go(EDIT_STEPS[i + 1], 1);
      else save();
      return;
    }
    if (fromReview) {
      // back to the summary, unless a changed answer (e.g. the kind of project) left another step incomplete
      const open = STEPS.find((st) => st !== "ready" && Object.keys(validateStep(st, s.answers, login)).length > 0);
      if (open) { go(open, stepIndex(open) < stepIndex(s.step) ? -1 : 1); return; }
      setFromReview(false);
      go("ready", 1);
      return;
    }
    go(nextStep(s.step), 1);
  };
  const back = () => {
    if (editing) { if (editIndex > 0) go(EDIT_STEPS[editIndex - 1], -1); return; }
    if (step !== "kind") go(prevStep(step), -1);
  };
  const changed = () => JSON.stringify(useGuidedStart.getState().answers) !== JSON.stringify(initial.current);
  const askClose = () => {
    if (isPending) return;
    if (editing ? changed() : hasAnswers(useGuidedStart.getState().answers)) setConfirm(true);
    else closeGuidedStart(false);
  };
  // a choice card picked with the pointer on the first step moves on by itself, after a moment to see the choice
  const picked = () => {
    if (advance.current) window.clearTimeout(advance.current);
    advance.current = window.setTimeout(() => { advance.current = null; next(); }, 320);
  };
  useEffect(() => () => { if (advance.current) window.clearTimeout(advance.current); }, []);

  // the dialog: focus inside, Tab stays inside, the page behind does not scroll, focus returns to the opener
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const body = document.body.style;
    const before = { overflow: body.overflow, paddingRight: body.paddingRight };
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    body.overflow = "hidden";
    if (gutter > 0) body.paddingRight = `${gutter}px`;
    const onKey = (e: KeyboardEvent) => {
      const box = panel.current;
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        e.preventDefault();
        if (confirmRef.current) setConfirm(false);
        else askCloseRef.current();
        return;
      }
      if (e.key !== "Tab" || !box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0 && !el.closest("[inert]"));
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const inside = box.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      body.overflow = before.overflow;
      body.paddingRight = before.paddingRight;
      if (opener?.isConnected) opener.focus();
    };
  }, []);
  const askCloseRef = useRef(askClose);
  askCloseRef.current = askClose;
  const confirmRef = useRef(confirm);
  confirmRef.current = confirm;
  const content = useRef<HTMLDivElement>(null);
  // while "Leave?" is asked, the dialog behind it is out of reach
  useEffect(() => { content.current?.toggleAttribute("inert", confirm); }, [confirm]);

  // each step starts at its top with its first question focused
  useLayoutEffect(() => {
    form.current?.scrollTo({ top: 0 });
    focusStep(form.current, headingId);
  }, [step, headingId]);

  // Enter continues (Shift+Enter: a new line); lists, menus and buttons keep their own Enter
  const onKeyDown = (e: ReactKeyboardEvent<HTMLFormElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.altKey || e.metaKey || e.ctrlKey || e.nativeEvent.isComposing || e.defaultPrevented) return;
    const el = e.target as HTMLElement;
    if (el instanceof HTMLButtonElement || el instanceof HTMLAnchorElement || el.getAttribute("role") === "combobox") return;
    if (el instanceof HTMLInputElement && el.type === "checkbox") return;
    e.preventDefault();
    next();
  };

  const failureBanner: ReactNode = failure
    ? <div className="mb-5"><Banner tone="danger" title={editing ? t("shell.guided.saveFailed", "Your changes could not be saved.") : t("shell.guided.createFailed", "The project could not be created.")} text={failure} /></div>
    : !canCreate && ready
      ? <div className="mb-5"><Banner tone="warning" title={viewerTip()} text={t("shell.newProject.askForMember", "Ask a Workspace admin for the Member role to start projects.")} /></div>
      : null;

  const props = { a, set, errors, headingId, disabled: isPending, editing };
  const screen = step === "kind" ? <KindStep {...props} onPicked={picked} />
    : step === "about" ? <AboutStep {...props} />
    : step === "goal" ? <GoalStep {...props} />
    : step === "where" ? (a.kind === "existing" ? <WhereExistingStep {...props} /> : <WhereNewStep {...props} />)
    : <ReadyStep {...props} login={login} failure={failureBanner} onEdit={(s) => { setFromReview(true); go(s, -1); }} />;

  const scrim = useBackdropDismiss(askClose);
  // someone who may not start projects (a viewer) learns it at once, not after answering every question
  const blocked = ready && !canCreate && !editing;
  const valueText = t("shell.home.stepOfNamed", "Step {step} of {total}: {name}", { step: index + 1, total, name: stepTitle(step) });
  const last = step === "ready";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-[rgb(var(--c-scrim)/0.32)] backdrop-blur-[3px] sm:items-center sm:p-6 dark:bg-[rgb(var(--c-scrim)/0.62)]" {...scrim}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={statusId} onClick={(e) => e.stopPropagation()}
        className="relative flex h-[100dvh] w-full flex-col overflow-hidden bg-surface shadow-float animate-rise sm:h-[min(800px,calc(100dvh-48px))] sm:max-w-[1000px] sm:rounded-card dark:ring-1 dark:ring-line">
        <div ref={content} className="flex min-h-0 flex-1 flex-col">
          {!blocked && <ShimmerProgress step={index + 1} total={total} label={t("shell.guided.progress", "Project start progress")} valueText={valueText} className="rounded-none" />}
          <header className="flex items-center gap-3 px-5 pt-4 sm:px-8 sm:pt-5">
            <p id={statusId} aria-live="polite" className="min-w-0 flex-1 truncate text-[13px] text-ink3">
              <span className="font-medium text-ink">{editing ? t("shell.guided.yourAnswers", "Your answers") : t("shell.titles.newProject", "New project")}</span>
              {!blocked && <> · {editing ? t("shell.guided.questionOf", "Question {step} of {total}", { step: index + 1, total }) : t("shell.progress.stepOf", "Step {step} of {total}", { step: index + 1, total })}<span className="hidden sm:inline"> · {stepTitle(step)}</span></>}
            </p>
            <button type="button" aria-label={t("common.actions.close", "Close")} onClick={askClose}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface2 text-ink2 transition hover:bg-line hover:text-ink"><X size={16} /></button>
          </header>
          {blocked ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex flex-1 flex-col items-start gap-5 px-5 pb-8 pt-6 sm:flex-row sm:items-center sm:px-10 sm:pt-8">
                <Illustration icon={<Eye size={30} strokeWidth={1.5} />} tone="warning" />
                <StepHeading id={headingId} title={t("shell.guided.blockedTitle", "Starting a project is for the project team")}
                  text={t("shell.guided.blockedText", "Your role lets you follow every project, read its documents and comment. To start a project, ask a Workspace admin to make you a Member.")} />
              </div>
              <footer className="flex items-center justify-end gap-3 border-t border-line bg-surface px-5 py-4 sm:px-8">
                <Button variant="primary" size="lg" onClick={() => closeGuidedStart(false)}>{t("common.actions.close", "Close")}</Button>
              </footer>
            </div>
          ) : (<>
          <form ref={form} noValidate aria-labelledby={headingId} onSubmit={(e) => { e.preventDefault(); next(); }} onKeyDown={onKeyDown}
            className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-8 pt-6 sm:px-10 sm:pt-8">
            <div key={step} className={dir === 1 ? "guided-in-forward" : "guided-in-back"}>{editing && failureBanner}{screen}</div>
          </form>
          {editing ? (
            <footer className="flex items-center gap-3 border-t border-line bg-surface px-5 py-4 sm:px-8">
              {editIndex > 0
                ? <Button variant="ghost" icon={<ArrowLeft size={16} aria-hidden />} onClick={back} disabled={isPending}>{t("common.actions.back", "Back")}</Button>
                : <Button variant="ghost" onClick={askClose} disabled={isPending}>{t("common.actions.cancel", "Cancel")}</Button>}
              <span className="ml-auto" />
              {editIndex < EDIT_STEPS.length - 1 && (
                <Button variant="ghost" className="max-sm:hidden" iconRight={<ArrowRight size={16} aria-hidden />} onClick={next} disabled={isPending}>{t("shell.guided.nextQuestion", "Next question")}</Button>
              )}
              <Button variant="primary" size="lg" onClick={save} disabled={isPending} aria-busy={setup.isPending || undefined}>
                {setup.isPending ? t("common.status.saving", "Saving…") : t("shell.guided.saveChanges", "Save changes")}
              </Button>
            </footer>
          ) : (
          <footer className="flex items-center gap-3 border-t border-line bg-surface px-5 py-4 sm:px-8">
            {step !== "kind"
              ? <Button variant="ghost" icon={<ArrowLeft size={16} aria-hidden />} onClick={back} disabled={isPending}>{t("common.actions.back", "Back")}</Button>
              : <span className="text-[13px] text-ink3 max-sm:hidden">{t("shell.guided.twoMinutes", "Takes about two minutes")}</span>}
            <p className="ml-auto hidden items-center gap-1.5 text-[13px] text-ink3 md:flex" aria-hidden>
              {t("shell.guided.press", "Press")} <kbd className={KBD}>{t("shell.guided.enterKey", "Enter")} <CornerDownLeft size={11} className="inline" /></kbd>
            </p>
            <Button variant="primary" size="lg" className={cn("max-md:ml-auto", last && "min-w-[200px]")} onClick={next}
              disabled={isPending || (last && (!ready || !canCreate))} aria-busy={isPending || undefined}
              iconRight={isPending ? undefined : <ArrowRight size={16} strokeWidth={2} aria-hidden />}>
              {last ? (isPending ? t("shell.guided.creating", "Creating your project…") : t("shell.guided.create", "Create my project")) : fromReview ? t("shell.guided.backToReview", "Back to review") : t("common.actions.continue", "Continue")}
            </Button>
          </footer>
          )}
          </>)}
        </div>
        {confirm && (
          <ConfirmLeave editing={editing}
            onStay={() => setConfirm(false)}
            onKeep={() => { setConfirm(false); closeGuidedStart(true); }}
            onDiscard={() => { setConfirm(false); closeGuidedStart(false); }} />
        )}
      </div>
    </div>,
    document.body,
  );
}

function ConfirmLeave({ editing, onStay, onKeep, onDiscard }: { editing: boolean; onStay: () => void; onKeep: () => void; onDiscard: () => void }) {
  useT();
  const titleId = useId();
  const textId = useId();
  return (
    <div className="absolute inset-0 z-10 grid place-items-center bg-surface/80 p-5 backdrop-blur-sm animate-rise">
      <div role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={textId}
        className="w-full max-w-[480px] rounded-card bg-surface p-6 shadow-float ring-1 ring-line">
        <h3 id={titleId} className="text-[19px] font-medium">{editing ? t("shell.guided.leave.discardTitle", "Discard your changes?") : t("shell.guided.leave.title", "Leave the project start?")}</h3>
        <p id={textId} className="mt-2 text-[14px] text-ink2">
          {editing ? t("shell.guided.leave.discardText", "Your project keeps the answers it had.") : t("shell.guided.leave.text", "Your answers stay saved on this device, so you can pick up where you left off with New project. Nothing has been created yet.")}
        </p>
        {/* one row (discard on the left, the way forward on the right) from 520px, the narrowest window where all three fit
            at full size; below that a full-width stack, Keep going first. Never wraps half-way. */}
        <div className="mt-5 flex flex-col gap-2 min-[520px]:flex-row-reverse min-[520px]:items-center min-[520px]:gap-3">
          <Button variant="primary" onClick={onStay} autoFocus>{editing ? t("shell.guided.leave.keepEditing", "Keep editing") : t("shell.guided.leave.keepGoing", "Keep going")}</Button>
          {!editing && <Button variant="ghost" onClick={onKeep}>{t("shell.guided.leave.later", "Leave for now")}</Button>}
          <Button variant="danger-quiet" onClick={onDiscard} className="min-[520px]:mr-auto">{editing ? t("shell.guided.leave.discardChanges", "Discard changes") : t("shell.guided.leave.discardAnswers", "Discard answers")}</Button>
        </div>
      </div>
    </div>
  );
}
