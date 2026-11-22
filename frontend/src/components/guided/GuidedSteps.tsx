/** The guided project start's screens: one question per step, big choice cards, plain words. Each screen gets the
 *  answers, a patch function and the errors to show; the dialog around them owns the flow. */
import { useId, type ReactNode } from "react";
import {
  ArrowRight, Check, FileText, FolderGit2, Globe, Hammer, Lightbulb, Lock, PencilLine, Plus, RefreshCcw,
  Rocket, ShieldCheck, Upload, Wrench,
} from "lucide-react";
import { useGithubStatus } from "@/blocks/github";
import {
  LIMITS, checkWebsite, codeHomeOf, suggestedRepoName, type StartAnswers, type StepErrors, type StepId,
} from "@/domain/guidedStart";
import { ConnectGithubPanel, GithubLoading } from "@/components/github/ConnectGithubPanel";
import { GithubAccountLine, GithubRepoChooser } from "@/components/github/RepoPicker";
import { GithubMark } from "@/components/intake/IntakeShared";
import { Button, Chip, Input, Segmented, Textarea } from "@/ui/kit";
import { cn } from "@/lib/cn";
import { t, useT } from "@/i18n";

export interface StepProps {
  a: StartAnswers;
  set: (patch: Partial<StartAnswers>) => void;
  errors: StepErrors;
  /** A choice card was picked with the pointer: the dialog may move on by itself. */
  onPicked?: () => void;
  /** Jump to a step (the last step's "Change" links). */
  onEdit?: (step: StepId) => void;
  disabled?: boolean;
  /** Changing an existing project's answers: the repository is changed on its own card, not here. */
  editing?: boolean;
}

/* ── building blocks ──────────────────────────────────────────────────────── */

/** A translated sentence with one marked place (e.g. "{name}", left unfilled in t) drawn as an element. */
export function withNode(text: string, token: string, node: ReactNode): ReactNode {
  const i = text.indexOf(token);
  if (i < 0) return text;
  return <>{text.slice(0, i)}{node}{text.slice(i + token.length)}</>;
}

export function StepHeading({ id, title, text }: { id: string; title: string; text?: ReactNode }) {
  return (
    <div className="mb-6 sm:mb-8">
      <h2 id={id} tabIndex={-1} className="text-[26px] font-medium leading-tight tracking-[-0.02em] outline-none sm:text-[32px]">{title}</h2>
      {text && <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-ink2">{text}</p>}
    </div>
  );
}

function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return <p id={id} role="alert" className="mt-1.5 text-[13px] text-danger">{text}</p>;
}

function Question({ label, hint, htmlFor, optional, children }: { label: string; hint?: ReactNode; htmlFor?: string; optional?: boolean; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
        {htmlFor ? <label htmlFor={htmlFor} className="text-[16px] font-medium text-ink">{label}</label> : <span className="text-[16px] font-medium text-ink">{label}</span>}
        {optional && <span className="text-[13px] text-ink3">{t("shell.guided.optional", "Optional")}</span>}
      </div>
      {hint && <p className="-mt-1 mb-2.5 max-w-[62ch] text-[13px] text-ink2">{hint}</p>}
      {children}
    </div>
  );
}

/** A simple illustration: a soft tile with a large icon and a small badge icon. */
function Illustration({ icon, badge, tone = "accent", muted }: { icon: ReactNode; badge?: ReactNode; tone?: "accent" | "success" | "warning"; muted?: boolean }) {
  const tile = muted ? "bg-surface text-ink3" : tone === "success" ? "bg-success-soft text-success" : tone === "warning" ? "bg-warning-soft text-warning" : "bg-accent-soft text-accent";
  return (
    <span aria-hidden className={cn("guided-tile relative grid h-16 w-16 shrink-0 place-items-center rounded-[20px] transition group-hover:scale-[1.03]", tile)}>
      {icon}
      {badge && <span className={cn("absolute -bottom-1.5 -right-1.5 grid h-7 w-7 place-items-center rounded-full ring-4", muted ? "bg-surface2 text-ink3 ring-surface2" : "bg-surface text-ink ring-surface shadow-card")}>{badge}</span>}
    </span>
  );
}

/** A big choice card (a radio underneath, so arrow keys and screen readers work as in any radio group). */
function ChoiceCard({ name, value, checked, disabled, onChoose, onPicked, illustration, title, text, tag }: {
  name: string; value: string; checked: boolean; disabled?: boolean; onChoose: () => void; onPicked?: () => void;
  illustration: ReactNode; title: string; text: string; tag?: ReactNode;
}) {
  const textId = useId();
  return (
    <label
      // a pointer click on the card (the label's own click); keyboard selection (detail 0) never moves on by itself
      onClick={(e) => { if (!disabled && e.detail > 0 && !(e.target instanceof HTMLInputElement)) onPicked?.(); }}
      className={cn(
        "group relative flex min-w-0 flex-col gap-4 rounded-card p-5 ring-1 transition sm:p-6",
        disabled ? "hatched cursor-not-allowed bg-surface2 ring-line"
          : checked ? "guided-pop cursor-pointer bg-accent-soft ring-2 ring-accent [&_.guided-tile]:bg-surface"
          : "cursor-pointer bg-surface ring-line hover:-translate-y-0.5 hover:shadow-float hover:ring-accent/50 dark:bg-surface2",
      )}>
      <input type="radio" name={name} value={value} checked={checked} disabled={disabled} onChange={onChoose}
        aria-describedby={textId} className="peer sr-only" />
      <span className="flex items-start justify-between gap-3">
        {illustration}
        {checked ? (
          <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-accent text-white"><Check size={16} strokeWidth={2.25} /></span>
        ) : tag}
      </span>
      <span className="flex flex-col gap-1">
        <span className={cn("text-[17px] font-medium leading-snug", disabled ? "text-ink2" : "text-ink")}>{title}</span>
        <span id={textId} className={cn("text-[14px] leading-relaxed", disabled ? "text-ink3" : "text-ink2")}>{text}</span>
      </span>
      <span aria-hidden className="pointer-events-none absolute inset-0 rounded-card peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface" />
    </label>
  );
}

/** A plain-language disclosure ("More options"). */

/** Shift+Enter makes a new line; Enter alone continues (the dialog's form handles it). */
const textareaHint = () => t("shell.guided.newLineHint", "Shift + Enter for a new line");

/* ── 1. what are you building ─────────────────────────────────────────────── */

export function KindStep({ a, set, errors, onPicked, headingId }: StepProps & { headingId: string }) {
  useT();
  return (
    <>
      <StepHeading id={headingId} title={t("shell.guided.kind.title", "Hey! What are you going to build today?")} text={t("shell.guided.kind.text", "Pick the one that fits best. You can change it on the way.")} />
      <fieldset className="min-w-0">
        <legend className="sr-only">{t("shell.guided.kind.legend", "What are you going to build?")}</legend>
        <div role="radiogroup" aria-labelledby={headingId} aria-describedby={errors.kind ? "kind-error" : undefined} className="grid gap-4 md:grid-cols-3">
          <ChoiceCard name="guided-kind" value="new" checked={a.kind === "new"} onChoose={() => set({ kind: "new" })} onPicked={onPicked}
            illustration={<Illustration icon={<Lightbulb size={30} strokeWidth={1.5} />} badge={<Plus size={14} />} />}
            title={t("shell.guided.kind.newTitle", "Something new")} text={t("shell.guided.kind.newText", "An idea that doesn't exist yet. We build it from scratch, together with you.")} />
          <ChoiceCard name="guided-kind" value="existing" checked={a.kind === "existing"} onChoose={() => set({ kind: "existing" })} onPicked={onPicked}
            illustration={<Illustration icon={<Wrench size={28} strokeWidth={1.5} />} badge={<Hammer size={14} />} tone="success" />}
            title={t("shell.guided.kind.existingTitle", "Improve something we already have")} text={t("shell.guided.kind.existingText", "A product you use today. We add to it or change it, without breaking what works.")} />
          <ChoiceCard name="guided-kind" value="rebuild" checked={false} disabled onChoose={() => undefined}
            illustration={<Illustration icon={<RefreshCcw size={28} strokeWidth={1.5} />} muted />}
            tag={<Chip>{t("shell.guided.kind.comingSoon", "Coming soon")}</Chip>}
            title={t("shell.guided.kind.rebuildTitle", "Rebuild a product on a new platform")} text={t("shell.guided.kind.rebuildText", "Keep what it does and its data, rebuilt on modern technology.")} />
        </div>
      </fieldset>
      <FieldError id="kind-error" text={errors.kind} />
    </>
  );
}

/* ── 2. about the project ─────────────────────────────────────────────────── */

export function AboutStep({ a, set, errors, headingId }: StepProps & { headingId: string }) {
  const nameId = useId();
  const descId = useId();
  const webId = useId();
  const existing = a.kind === "existing";
  useT();
  return (
    <>
      <StepHeading id={headingId} title={t("shell.guided.about.title", "Tell me about your project")}
        text={existing ? t("shell.guided.about.textExisting", "Give it a name you'll recognise and tell me what the product does today and what you'd like to change.") : t("shell.guided.about.textNew", "Give it a name you'll recognise and describe the idea in your own words. No technical terms needed.")} />
      <div className="flex max-w-2xl flex-col gap-6">
        <Question label={t("shell.guided.about.nameLabel", "What should we call it?")} htmlFor={nameId}>
          <Input id={nameId} data-step-focus="" value={a.name} maxLength={80} autoComplete="off" placeholder={existing ? t("shell.guided.about.namePlaceholderExisting", "For example: Customer portal") : t("shell.guided.about.namePlaceholderNew", "For example: Field service app")}
            aria-invalid={errors.name ? true : undefined} aria-describedby={errors.name ? `${nameId}-error` : undefined}
            className="h-12 text-[16px]" onChange={(e) => set({ name: e.target.value })} />
          <FieldError id={`${nameId}-error`} text={errors.name} />
        </Question>
        <Question label={existing ? t("shell.guided.about.descLabelExisting", "What does it do, and what should change?") : t("shell.guided.about.descLabelNew", "What is it about?")} htmlFor={descId}
          hint={existing ? t("shell.guided.about.descHintExisting", "One or two sentences is enough, for example: “Our booking site works, but customers can't change a booking themselves.”") : t("shell.guided.about.descHintNew", "One or two sentences is enough, for example: “An app where our technicians see the day's jobs and log their hours on site.”")}>
          <Textarea id={descId} value={a.description} maxLength={LIMITS.description} rows={4}
            aria-invalid={errors.description ? true : undefined} aria-describedby={`${descId}-hint${errors.description ? ` ${descId}-error` : ""}`}
            className="text-[15px] leading-relaxed" onChange={(e) => set({ description: e.target.value })} />
          <p id={`${descId}-hint`} className="mt-1.5 text-[12px] text-ink3">{textareaHint()}</p>
          <FieldError id={`${descId}-error`} text={errors.description} />
        </Question>
        {existing && <Question label={t("shell.guided.about.website", "Website")} htmlFor={webId} optional>
          <div className="relative sm:max-w-[480px]">
            <Globe size={16} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink3" />
            <Input id={webId} type="url" inputMode="url" value={a.website} maxLength={LIMITS.website} autoComplete="url" placeholder="www.example.com" className="pl-11"
              aria-invalid={errors.website ? true : undefined} aria-describedby={errors.website ? `${webId}-error` : undefined}
              onChange={(e) => set({ website: e.target.value })}
              // a bare address gets its https:// once the person moves on
              onBlur={() => { const w = checkWebsite(a.website); if (w.ok && w.value !== a.website) set({ website: w.value }); }} />
          </div>
          <FieldError id={`${webId}-error`} text={errors.website} />
        </Question>}
      </div>
    </>
  );
}

/* ── 3. goal and users ────────────────────────────────────────────────────── */

export function GoalStep({ a, set, errors, headingId }: StepProps & { headingId: string }) {
  const goalId = useId();
  const usersId = useId();
  useT();
  return (
    <>
      <StepHeading id={headingId} title={t("shell.guided.goal.title", "What should it achieve?")} text={t("shell.guided.goal.text", "Describe the main goal and who will use it in your own words. This tells us what success looks like for you.")} />
      <div className="flex max-w-3xl flex-col gap-8">
        <Question label={t("shell.guided.goal.goalLabel", "The main goal")} htmlFor={goalId}>
          <Textarea id={goalId} data-step-focus="" value={a.goal} maxLength={LIMITS.goal} rows={2} placeholder={t("shell.guided.goal.goalPlaceholder", "In your own words, for example: “Customers book and pay without calling us.”")}
            aria-label={t("shell.guided.goal.goalAria", "The main goal, in your own words")} aria-invalid={errors.goal ? true : undefined} aria-describedby={errors.goal ? `${goalId}-error` : undefined}
            className="min-h-[76px] text-[15px] leading-relaxed" onChange={(e) => set({ goal: e.target.value })} />
          <FieldError id={`${goalId}-error`} text={errors.goal} />
        </Question>
        <Question label={t("shell.guided.goal.usersLabel", "Who will use it?")} htmlFor={usersId}>
          <Textarea id={usersId} value={a.users} maxLength={LIMITS.users} rows={2} placeholder={t("shell.guided.goal.usersPlaceholder", "For example: “Our 40 service technicians”")}
            aria-label={t("shell.guided.goal.usersAria", "Who will use it, in your own words")} aria-invalid={errors.users ? true : undefined} aria-describedby={errors.users ? `${usersId}-error` : undefined}
            className="min-h-[76px] text-[15px] leading-relaxed" onChange={(e) => set({ users: e.target.value })} />
          <FieldError id={`${usersId}-error`} text={errors.users} />
        </Question>
      </div>
    </>
  );
}

/* ── 4a. new product: where should we keep the code ───────────────────────── */

function NewRepositoryDetails({ a, errors }: StepProps) {
  const github = useGithubStatus();
  const login = github.data?.connected ? github.data.login : null;
  const nameId = useId();
  if (github.isPending) return <GithubLoading />;
  return (
    <div className="flex flex-col gap-4">
      <div>
        {!login ? (
          <ConnectGithubPanel title={t("shell.guided.where.connectTitle", "Connect your GitHub account")}
             why={t("shell.guided.where.connectWhy", "Connect GitHub so we can create a private repository when you create this project. Or keep the code in MADP Factory and connect GitHub later.")} />
        ) : (
          <div className="flex flex-col gap-3 rounded-block bg-surface2 p-4">
            <GithubAccountLine login={login} />
            <Question label={t("shell.guided.where.repoName", "Repository name")} htmlFor={nameId}>
              <div className="flex items-center gap-1.5 text-[14px]">
                <span className="shrink-0 text-ink2">{login} /</span>
                 <Input id={nameId} value={suggestedRepoName(a)} readOnly maxLength={100} spellCheck={false} autoComplete="off"
                  placeholder={suggestedRepoName(a)}
                  aria-invalid={errors.newRepoName ? true : undefined} aria-describedby={errors.newRepoName ? `${nameId}-error` : undefined}
                   />
              </div>
              <FieldError id={`${nameId}-error`} text={errors.newRepoName} />
            </Question>
            <p className="flex items-start gap-2 text-[13px] text-ink3">
              <Lock size={14} aria-hidden className="mt-0.5 shrink-0" />
               <span>{t("shell.guided.where.repoCreatedNow", "We'll create this private repository immediately when you create the project. Its name follows your project name.")}</span>
            </p>
          </div>
        )}
      </div>
      {!login && <FieldError id={`${nameId}-error`} text={errors.newRepoName} />}
    </div>
  );
}


/** Editing: where the repository is shown and changed instead (the Code repository card on the Project setup page). */
function RepositoryElsewhere({ a }: { a: StartAnswers }) {
  return (
    <div className="flex items-start gap-3 rounded-block bg-surface2 p-4 text-[14px] text-ink2">
      <FolderGit2 size={18} aria-hidden className="mt-0.5 shrink-0 text-ink3" />
      <p>{a.repo ? <>{withNode(t("shell.guided.where.codeIsIn", "The code is in {repo} on the branch {branch}.", { branch: a.repo.branch }), "{repo}",
        <span className="font-medium text-ink">{a.repo.owner}/{a.repo.name}</span>)}{" "}</> : null}
        {t("shell.guided.where.changeRepo", "To change the repository, use the Code repository card on the Project setup page.")}</p>
    </div>
  );
}

export function WhereNewStep(props: StepProps & { headingId: string }) {
  const { a, set, errors, headingId, editing } = props;
  useT();
  if (editing) {
    return (
      <>
        <StepHeading id={headingId} title={t("shell.guided.where.title", "Where should we keep the code?")} text={t("shell.guided.where.editText", "The repository has its own card on the Project setup page.")} />
        <div className="flex max-w-3xl flex-col gap-6">
          <RepositoryElsewhere a={a} />
        </div>
      </>
    );
  }
  const home = codeHomeOf(a);
  const onGithub = home !== "factory";
  return (
    <>
      <StepHeading id={headingId} title={t("shell.guided.where.title", "Where should we keep the code?")}
        text={t("shell.guided.where.text", "MADP Factory keeps your project's code safe for you, with nothing to set up. You can also connect GitHub, now or any time later.")} />
      <div className="flex flex-col gap-6">
        <fieldset className="min-w-0">
          <legend className="sr-only">{t("shell.guided.where.title", "Where should we keep the code?")}</legend>
          <div role="radiogroup" aria-labelledby={headingId} aria-describedby={errors.repoChoice ? "repo-choice-error" : undefined} className="grid gap-4 md:grid-cols-2">
            <ChoiceCard name="guided-repo" value="factory" checked={!onGithub} onChoose={() => set({ repoChoice: "factory" })}
              illustration={<Illustration icon={<ShieldCheck size={28} strokeWidth={1.5} />} badge={<Lock size={14} />} />}
              tag={<Chip tone="accent">{t("shell.guided.where.recommended", "Recommended")}</Chip>}
              title={t("shell.guided.where.keepInFactory", "Keep it in MADP Factory")} text={t("shell.guided.where.factoryText", "We keep the code safe for you. Nothing to set up, and you can move it to GitHub later.")} />
            <ChoiceCard name="guided-repo" value="github" checked={onGithub} onChoose={() => set({ repoChoice: onGithub ? home : "create" })}
              illustration={<Illustration icon={<GithubMark size={28} />} badge={<FolderGit2 size={14} />} tone="success" />}
              title={t("shell.guided.where.githubTitle", "Connect GitHub (optional)")} text={t("shell.guided.where.githubText", "Keep the code in your own GitHub account: a new private repository, or one you already have.")} />
          </div>
        </fieldset>
        <FieldError id="repo-choice-error" text={errors.repoChoice} />
        {onGithub && <GithubChoice {...props} />}
        {/* BlocksProjectField removed — Blocks project setup handled automatically */}
      </div>
    </>
  );
}

/** GitHub is out of reach (not set up here, or not answering): say so plainly; the code stays in MADP Factory. */
function GithubUnavailable({ text, onFactory }: { text: string; onFactory?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-block bg-surface2 p-4 text-[14px] text-ink2">
      <GithubMark size={18} className="shrink-0 text-ink3" />
      <p className="min-w-0 flex-1">{text}</p>
      {onFactory && <Button variant="secondary" size="sm" onClick={onFactory}>{t("shell.guided.where.keepInFactory", "Keep it in MADP Factory")}</Button>}
    </div>
  );
}

/** "Connect GitHub (optional)": a new private repository in the connected account, or one the team already has. */
function GithubChoice(props: StepProps) {
  const { a, set, errors, disabled } = props;
  const github = useGithubStatus();
  if (github.isPending) return <GithubLoading />;
  if (github.isError) {
    return <GithubUnavailable onFactory={() => set({ repoChoice: "factory" })}
      text={t("shell.guided.where.githubDownNew", "GitHub can't be connected right now. Keep the code in MADP Factory and connect GitHub later on the project page.")} />;
  }
  const kind = a.repoChoice === "existing" ? "existing" : "create";
  return (
    <div className="flex flex-col gap-4">
      <Segmented label={t("shell.guided.where.whichRepo", "Which repository?")} className="self-start" value={kind} onChange={(v) => set({ repoChoice: v })}
        options={[{ value: "create", label: t("shell.guided.where.newRepo", "A new private repository") }, { value: "existing", label: t("shell.guided.where.existingRepo", "One I already have") }]} />
      {kind === "create" ? <NewRepositoryDetails {...props} /> : (
        <div>
          <GithubRepoChooser value={a.repo} disabled={disabled} onChange={(repo) => set({ repo })}
            why={t("shell.guided.where.pickRepoWhy", "Connect your GitHub account, then pick the repository we should build in.")} />
          <FieldError id="repo-error" text={errors.repo} />
        </div>
      )}
    </div>
  );
}

/* ── 4b. existing product: where is it today ──────────────────────────────── */

export function WhereExistingStep({ a, set, errors, headingId, disabled, editing }: StepProps & { headingId: string }) {
  const appId = useId();
  const github = useGithubStatus();
  useT();
  return (
    <>
      <StepHeading id={headingId} title={t("shell.guided.existing.title", "Where is your product today?")}
        text={t("shell.guided.existing.text", "This helps us understand your product before we change anything. Everything here is optional: your documents and website are enough to start.")} />
      <div className="flex max-w-3xl flex-col gap-8">
        <Question label={t("shell.guided.existing.codeLabel", "Its code on GitHub")} optional hint={t("shell.guided.existing.codeHint", "If the code is on GitHub, we read it to understand how the product works today. You can also add it later on the project page.")}>
          <div>
            {editing ? <RepositoryElsewhere a={a} />
              : github.isError ? <GithubUnavailable text={t("shell.guided.existing.githubDown", "GitHub can't be connected right now. You can add the code later on the project page.")} />
              : (
                <GithubRepoChooser value={a.repo} disabled={disabled} onChange={(repo) => set({ repo, repoLater: false })}
                  why={t("shell.guided.existing.pickRepoWhy", "Connect your GitHub account and pick the product's repository, or skip it and add it later.")} />
              )}
          </div>
          <FieldError id="repo-error" text={errors.repo} />
        </Question>

        <Question label={t("shell.guided.existing.webLabel", "Do you have a webpage?")} htmlFor={appId} optional hint={t("shell.guided.existing.webHint", "The address you open in the browser, if it has one.")}>
          <div className="relative sm:max-w-[480px]">
            <Globe size={16} aria-hidden className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink3" />
            <Input id={appId} type="url" inputMode="url" value={a.appUrl} maxLength={LIMITS.url} autoComplete="off" placeholder="app.yourcompany.com" className="pl-11"
              aria-invalid={errors.appUrl ? true : undefined} aria-describedby={errors.appUrl ? `${appId}-error` : undefined}
              onChange={(e) => set({ appUrl: e.target.value })} />
          </div>
          <FieldError id={`${appId}-error`} text={errors.appUrl} />
        </Question>

      </div>
    </>
  );
}

/* ── the hand-off ─────────────────────────────────────────────────────────── */

function SummaryRow({ icon, label, value, step, onEdit }: { icon: ReactNode; label: string; value: ReactNode; step: StepId; onEdit?: (s: StepId) => void }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <span aria-hidden className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface2 text-ink2">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] font-medium uppercase tracking-wider text-ink3">{label}</span>
        <span className="block break-words text-[14px] text-ink">{value}</span>
      </span>
      {onEdit && (
        <button type="button" onClick={() => onEdit(step)} aria-label={t("shell.guided.ready.changeItem", "Change: {label}", { label })}
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[13px] font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50">
          <PencilLine size={14} aria-hidden />{t("shell.guided.ready.change", "Change")}
        </button>
      )}
    </li>
  );
}

export function ReadyStep({ a, onEdit, headingId, login, failure }: StepProps & { headingId: string; login: string | null; failure: ReactNode }) {
  useT();
  const existing = a.kind === "existing";
  const home = codeHomeOf(a);
  const where = existing
    ? (a.repo ? `${a.repo.owner}/${a.repo.name} · ${a.repo.branch}` : t("shell.guided.ready.addLater", "Can be added later on the project page"))
    : home === "factory" ? t("shell.guided.ready.inFactory", "Kept safe in MADP Factory (you can connect GitHub later)")
    : home === "existing" && a.repo ? `${a.repo.owner}/${a.repo.name} · ${a.repo.branch}`
    : login ? t("shell.guided.ready.newRepoNow", "New private repository {repo} (created now)", { repo: `${login}/${suggestedRepoName(a)}` })
    : t("shell.guided.ready.newRepoLater", "A new repository, once GitHub is connected");
  return (
    <>
      <div className="mb-6 flex flex-col items-start gap-5 sm:mb-8 sm:flex-row sm:items-center">
        <Illustration icon={<Rocket size={30} strokeWidth={1.5} />} badge={<Check size={14} strokeWidth={2.5} />} tone="success" />
        <div className="min-w-0">
          <h2 id={headingId} tabIndex={-1} className="text-[26px] font-medium leading-tight tracking-[-0.02em] outline-none sm:text-[32px]">{t("shell.guided.ready.title", "Great! Next, share what you already have")}</h2>
          <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-ink2">
            {withNode(t("shell.guided.ready.text", "I'll set up {name} now. On the next page you can add what you already have: documents, notes, meeting minutes, screenshots. Anything that helps us understand it."),
              "{name}", <span className="font-medium text-ink">{a.name.trim() || t("shell.guided.ready.yourProject", "your project")}</span>)}
          </p>
        </div>
      </div>
      {failure}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
        <ul aria-label={t("shell.guided.yourAnswers", "Your answers")} className="divide-y divide-line rounded-block bg-surface2 px-4">
          <SummaryRow icon={existing ? <Wrench size={16} /> : <Lightbulb size={16} />} label={t("shell.guided.ready.building", "You're building")} value={existing ? t("shell.guided.ready.improvement", "An improvement to a product we already have") : t("shell.guided.kind.newTitle", "Something new")} step="kind" onEdit={onEdit} />
          <SummaryRow icon={<FileText size={16} />} label={t("shell.guided.ready.project", "Project")} value={<><span className="font-medium">{a.name.trim()}</span><span className="line-clamp-3 text-ink2">{a.description.trim()}</span></>} step="about" onEdit={onEdit} />
          {existing && a.website.trim() && <SummaryRow icon={<Globe size={16} />} label={t("shell.guided.about.website", "Website")} value={a.website.trim()} step="about" onEdit={onEdit} />}
          <SummaryRow icon={<FolderGit2 size={16} />} label={existing ? t("shell.guided.ready.whereItIs", "Where it is") : t("shell.guided.ready.code", "Code")} value={where} step="where" onEdit={onEdit} />
        </ul>
        <div className="flex flex-col gap-3 self-start rounded-block bg-accent-soft p-4 text-[14px] text-ink2">
          <span className="flex items-center gap-2 font-medium text-ink"><Upload size={16} aria-hidden className="text-accent" />{t("shell.guided.ready.nextTitle", "What happens next")}</span>
          <p>{t("shell.guided.ready.nextText", "Your project opens on its setup page. Drop in documents or write notes; nothing starts until you choose Start project analysis.")}</p>
          <p className="flex items-center gap-1.5 text-[13px] text-ink3"><ArrowRight size={14} aria-hidden />{t("shell.guided.ready.changeLater", "You can change every answer later.")}</p>
        </div>
      </div>
    </>
  );
}
