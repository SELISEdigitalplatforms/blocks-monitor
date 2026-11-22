/**
 * New products: where the code lives. Either the new GitHub repository MADP creates when the build starts (optional
 * until then, GitHub can be connected later), or a repository the team already has (fixed from the hand-over).
 */
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { ExternalLink, GitBranch, Lock } from "lucide-react";
import { Button, Chip, Input, Label, Segmented } from "@/ui/kit";
import { useUpdateProject } from "@/blocks/projects/mutations";
import { messageFor } from "@/blocks/projects/messages";
import type { ProjectRecord } from "@/blocks/projects/records";
import { useConnectGithub, useGithubStatus } from "@/blocks/github";
import {
  NEW_REPO_BRANCH, REPO_VISIBILITIES, checkBranch, checkNewRepo, checkRepoRef, isRepoVisibility, repoConnected, repoSlug,
  type RepoRef, type RepoVisibility,
} from "@/domain/projectType";
import { ConnectGithubPanel, GithubLoading } from "@/components/github/ConnectGithubPanel";
import { GithubAccountLine, GithubRepoChooser } from "@/components/github/RepoPicker";
import { GithubMark } from "@/components/intake/IntakeShared";
import { cn } from "@/lib/cn";
import { visibilityName } from "./businessUi";
import { t, useT } from "@/i18n";

/** True once the build has started: MADP has created the repository, so it is fixed. */
export const newRepoLocked = (step: string) => step === "build" || step === "release";

/** A repository the team already has can change only in the Business step (the op's rule). */
export const existingRepoLocked = (step: string) => step !== "business";

/** "create": the new repository MADP creates; "existing": one the team already has. */
export type RepoKind = "create" | "existing";

/** The guided start's answer (Project.SetupAnswers {"repoChoice": …}), or null when it gave none. */
export function setupRepoChoice(setupAnswers: string): RepoKind | null {
  if (!setupAnswers) return null;
  try {
    const v = JSON.parse(setupAnswers) as { repoChoice?: unknown } | null;
    return v?.repoChoice === "create" || v?.repoChoice === "existing" ? v.repoChoice : null;
  } catch {
    return null;
  }
}

/** The kind of the saved repository, or (none saved) the guided start's choice, else a new repository. */
export function repoKindOf(p: Pick<ProjectRecord, "repoOwner" | "repoName" | "repoBranch" | "repoExisting" | "setupAnswers">): { kind: RepoKind; saved: boolean } {
  if (repoConnected(p)) return { kind: p.repoExisting ? "existing" : "create", saved: true };
  return { kind: setupRepoChoice(p.setupAnswers) ?? "create", saved: false };
}

/** Whether where the code lives can still change (the cards' own lock rules): an existing product's repository until the
 *  hand-over; a new product's saved repository one the team already had until the hand-over, a new one (or none yet)
 *  until the build starts. */
export function codeHomeStillOpen(p: Pick<ProjectRecord, "type" | "step" | "handedOverAt" | "repoOwner" | "repoName" | "repoBranch" | "repoExisting" | "setupAnswers">): boolean {
  // an existing product's repository is fixed once it is past its setup (project.update answers project.repoLocked),
  // also when it came to the Factory as a live product and was never handed over
  if (p.type === "brownfield") return !p.handedOverAt && !existingRepoLocked(p.step);
  const { kind, saved } = repoKindOf(p);
  if (saved && kind === "existing") return !existingRepoLocked(p.step);
  return !newRepoLocked(p.step);
}

/** Read at render time: the texts are looked up in the current language when they are read. */
const KIND_CHOICES: { value: RepoKind; title: string; text: string; tag?: string }[] = [
  {
    value: "create",
    get title() { return t("analysis.business.newRepo.createTitle", "Create a new repository for me"); },
    get text() { return t("analysis.business.newRepo.createText", "We create a private repository in your GitHub account when you save."); },
    get tag() { return t("analysis.business.newRepo.recommended", "Recommended"); },
  },
  {
    value: "existing",
    get title() { return t("analysis.business.newRepo.existingTitle", "Use a repository I already have"); },
    get text() { return t("analysis.business.newRepo.existingText", "Pick it from your GitHub account, for example one your team prepared."); },
  },
];

function KindChoice({ value, onChange, disabled }: { value: RepoKind; onChange: (k: RepoKind) => void; disabled?: boolean }) {
  return (
    <fieldset className="min-w-0">
      <legend className="sr-only">{t("analysis.business.newRepo.whereKeep", "Where should we keep the code?")}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {KIND_CHOICES.map((c) => {
          const checked = value === c.value;
          return (
            <label key={c.value}
              className={cn("relative flex min-w-0 cursor-pointer flex-col gap-1 rounded-block p-4 ring-1 transition",
                checked ? "bg-accent-soft ring-2 ring-accent" : "bg-surface2 ring-line hover:ring-accent/50",
                disabled && "cursor-not-allowed opacity-60")}>
              <input type="radio" name="new-product-repo-kind" value={c.value} checked={checked} disabled={disabled}
                onChange={() => onChange(c.value)} className="peer sr-only" />
              <span className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-ink">
                {c.title}{c.tag && <Chip tone="accent">{c.tag}</Chip>}
              </span>
              <span className="text-[13px] text-ink2">{c.text}</span>
              <span aria-hidden className="pointer-events-none absolute inset-0 rounded-block peer-focus-visible:ring-2 peer-focus-visible:ring-accent/60" />
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function NewRepositoryCard({ project, canEdit, embedded, onDone }: {
  project: ProjectRecord; canEdit: boolean;
  /** Inside the Code window: no card around it, the choice open right away, Cancel / a save close the window. */
  embedded?: boolean; onDone?: () => void;
}) {
  const t = useT();
  const update = useUpdateProject();
  const github = useGithubStatus();
  const connect = useConnectGithub();
  const login = github.data?.connected ? github.data.login : null;
  const { kind: savedKind, saved } = repoKindOf(project);
  const canExisting = !existingRepoLocked(project.step);
  const canCreate = !newRepoLocked(project.step);
  // what can still be chosen: an existing repository only before the hand-over, a new one until the build starts
  const startKind = (k: RepoKind): RepoKind => (k === "existing" && !canExisting ? "create" : k);
  const locked = saved ? (savedKind === "existing" ? !canExisting : !canCreate) : !canCreate;
  // the kind the card stands for at rest (the saved one, else what can still be chosen)
  const shownKind: RepoKind = saved ? savedKind : startKind(savedKind);
  const card = useRef<HTMLElement>(null);
  // the guided start said "a repository I already have" but none is saved: open the chooser right away
  const [editing, setEditing] = useState(() => (embedded ? !saved && canEdit && (canCreate || canExisting) : !saved && savedKind === "existing" && canExisting));
  const [kind, setKind] = useState<RepoKind>(() => startKind(savedKind));
  const savedNew = saved && savedKind === "create";
  const savedRef: RepoRef | null = saved && savedKind === "existing" ? { owner: project.repoOwner, name: project.repoName, branch: project.repoBranch } : null;
  const [name, setName] = useState(() => (savedNew ? project.repoName : repoSlug(project.name)));
  const [visibility, setVisibility] = useState<RepoVisibility>(() => (isRepoVisibility(project.repoVisibility) ? project.repoVisibility : "private"));
  const [branch, setBranch] = useState(() => (savedNew ? project.repoBranch : NEW_REPO_BRANCH));
  const [pick, setPick] = useState<RepoRef | null>(savedRef);
  const [error, setError] = useState<{ field: string; message: string } | null>(null);

  const open = (k: RepoKind = savedKind) => {
    setKind(startKind(k));
    setName(savedNew ? project.repoName : repoSlug(project.name));
    setVisibility(isRepoVisibility(project.repoVisibility) ? project.repoVisibility : "private");
    setBranch(savedNew ? project.repoBranch : NEW_REPO_BRANCH);
    setPick(savedRef);
    setError(null);
    setEditing(true);
  };

  const run = async (args: Parameters<typeof update.run>[0]) => {
    try {
      await update.run(args);
      setEditing(false);
      if (embedded) onDone?.();
    } catch (e) {
      setError({ field: "", message: messageFor(e) });
    }
  };

  const saveNew = async (ev: FormEvent) => {
    ev.preventDefault();
    if (update.isPending) return;
    const r = checkNewRepo(login ?? "", name, visibility);
    if (!r.ok) { setError(r); return; }
    const b = checkBranch(branch);
    if (!b.ok) { setError({ field: "branch", message: b.message }); return; }
    setError(null);
    await run({ projectId: project.id, repoOwner: r.value.owner, repoName: r.value.name, repoVisibility: r.value.visibility, repoBranch: b.value });
  };

  const saveExisting = async (ev: FormEvent) => {
    ev.preventDefault();
    if (update.isPending) return;
    if (!pick) { setError({ field: "repo", message: t("analysis.business.repo.pickFirst", "Pick the repository first.") }); return; }
    const ref = checkRepoRef(`${pick.owner}/${pick.name}`, pick.branch);
    if (!ref.ok) { setError({ field: ref.field, message: ref.message }); return; }
    setError(null);
    await run({ projectId: project.id, repo: `${ref.value.owner}/${ref.value.name}`, repoBranch: ref.value.branch });
  };

  const close = () => { if (embedded && !saved) onDone?.(); else setEditing(false); };
  const cancel = (
    <Button type="button" variant="ghost" onClick={close}>
      {embedded && !saved ? (kind === "create" && !login ? t("analysis.business.newRepo.connectLater", "Connect GitHub later") : t("analysis.business.newRepo.decideLater", "Decide later")) : t("analysis.business.cancel", "Cancel")}
    </Button>
  );
  const errorLine = error && <p id="new-repo-error" role="alert" className="text-[13px] text-danger">{error.message}</p>;

  const createForm: ReactNode = github.isPending ? <GithubLoading />
    : !login ? (
      <div className="flex flex-col gap-3">
        <ConnectGithubPanel why={t("analysis.business.newRepo.connectWhy", "Connect GitHub to create the product's private repository immediately when you save.")} />
        <div>{cancel}</div>
      </div>
    ) : (
      <form onSubmit={(e) => void saveNew(e)} noValidate className="flex flex-col gap-4">
        <GithubAccountLine login={login} />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,200px)_minmax(0,1fr)_auto] sm:items-end">
          <div className="min-w-0">
            <Label>{t("analysis.business.newRepo.owner", "Owner")}</Label>
            <Input value={login} readOnly aria-label={t("analysis.business.newRepo.owner", "Owner")} aria-describedby="new-repo-owner-note" className="cursor-default text-ink2" />
          </div>
          <div className="min-w-0">
            <Label>{t("analysis.business.newRepo.repoName", "Repository name")}</Label>
            <Input value={name} maxLength={100} spellCheck={false} autoComplete="off" aria-label={t("analysis.business.newRepo.repoName", "Repository name")}
              aria-invalid={error?.field === "name" || undefined} aria-describedby={error?.field === "name" ? "new-repo-error" : undefined}
              disabled={update.isPending} onChange={(e) => { setName(e.target.value); setError(null); }} />
          </div>
          <div>
            <Label>{t("analysis.business.answers.visibility", "Visibility")}</Label>
            <Segmented label={t("analysis.business.answers.visibility", "Visibility")} className="h-11 items-center" value={visibility} onChange={(v) => { setVisibility(v); setError(null); }}
              options={REPO_VISIBILITIES.filter((v) => v === "private").map((v) => ({ value: v, label: visibilityName(v) }))} />
          </div>
        </div>
        <div className="min-w-0 sm:max-w-[320px]">
          <Label>{t("analysis.business.newRepo.branch", "Starting branch")}</Label>
          <Input value={branch} maxLength={200} spellCheck={false} autoComplete="off" aria-label={t("analysis.business.newRepo.branch", "Starting branch")}
            aria-invalid={error?.field === "branch" || undefined} aria-describedby={error?.field === "branch" ? "new-repo-error" : undefined}
            disabled={update.isPending} onChange={(e) => { setBranch(e.target.value); setError(null); }} />
        </div>
        {errorLine ?? <p id="new-repo-owner-note" className="text-[13px] text-ink3">{t("analysis.business.newRepo.ownerNote", "Created in @{login} immediately when you save. Leave the branch as {branch} if you're not sure.", { login, branch: NEW_REPO_BRANCH })}</p>}
        <div className="flex gap-2">
          <Button type="submit" variant="secondary" disabled={update.isPending} aria-busy={update.isPending || undefined}>
            {update.isPending ? t("analysis.business.saving", "Saving…") : t("analysis.business.repo.save", "Save repository")}
          </Button>
          {cancel}
        </div>
      </form>
    );

  const unchanged = Boolean(savedRef && pick && savedRef.owner === pick.owner && savedRef.name === pick.name && savedRef.branch === pick.branch);
  const existingForm: ReactNode = (
    <form onSubmit={(e) => void saveExisting(e)} noValidate className="flex flex-col gap-4">
      <GithubRepoChooser value={pick} disabled={update.isPending}
        why={t("analysis.business.newRepo.pickWhy", "Connect your GitHub account, then pick the repository we should build in.")}
        onChange={(v) => { setPick(v); setError(null); }} />
      {errorLine}
      <div className="flex gap-2">
        {login && (
          <Button type="submit" variant="secondary" disabled={update.isPending || !pick || unchanged} aria-busy={update.isPending || undefined}>
            {update.isPending ? t("analysis.business.saving", "Saving…") : t("analysis.business.repo.save", "Save repository")}
          </Button>
        )}
        {cancel}
      </div>
    </form>
  );

  const body = (
    <div className="mt-4 flex flex-col gap-4">
      {canExisting && canCreate && <KindChoice value={kind} disabled={update.isPending} onChange={(k) => { setKind(k); setError(null); }} />}
      <div>{kind === "existing" ? existingForm : createForm}</div>
    </div>
  );

  let summary: ReactNode;
  if (saved && savedKind === "existing") {
    summary = (
      <a href={`https://github.com/${project.repoOwner}/${project.repoName}/tree/${encodeURIComponent(project.repoBranch)}`} target="_blank" rel="noopener noreferrer"
        className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline">
        {project.repoOwner}/{project.repoName} · {project.repoBranch}<ExternalLink size={12} strokeWidth={1.75} aria-hidden />
        <span className="sr-only"> {t("analysis.business.answers.opensGithub", "(opens GitHub in a new tab)")}</span>
      </a>
    );
  } else if (saved) {
    summary = (
      <div className="mt-0.5 text-[13px] text-ink2">
        <span className="font-medium text-ink">{project.repoOwner}/{project.repoName}</span>
        {" · "}{isRepoVisibility(project.repoVisibility) ? visibilityName(project.repoVisibility) : t("analysis.business.newRepo.private", "Private")}{" · "}{project.repoBranch}
      </div>
    );
  } else if (setupRepoChoice(project.setupAnswers) === null) {
    // the guided start kept the code in MADP Factory (or the plain New project form): GitHub is an option, not a need
    summary = <div className="mt-0.5 text-[13px] text-ink2">{t("analysis.business.newRepo.factoryKeeps", "MADP Factory keeps the code for you. Connecting GitHub is optional; you can do it any time.")}</div>;
  } else if (shownKind === "existing") {
    summary = <div className="mt-0.5 text-[13px] text-ink2">{t("analysis.business.newRepo.pickWhenReady", "Pick the repository you already have whenever you're ready. It's needed before the build starts.")}</div>;
  } else {
    summary = (
      <div className="mt-0.5 text-[13px] text-ink2">
        {login
          ? t("analysis.business.newRepo.createSetUp", "We'll create a new repository for you. Set it up whenever you're ready. It's needed before the build starts.")
          : t("analysis.business.newRepo.createConnect", "We'll create a new repository for you. Connect GitHub whenever you're ready. It's needed before the build starts.")}
      </div>
    );
  }

  // at rest, nothing saved and GitHub not connected yet: connect straight from the card, then name the repository
  const connectFirst = !saved && shownKind === "create" && github.isSuccess && !login;
  const action = locked ? (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-ink3"><Lock size={14} strokeWidth={1.75} aria-hidden />
      {saved && savedKind === "existing" ? t("analysis.business.newRepo.fixedSince", "Fixed since the hand-over") : t("analysis.business.newRepo.fixedOnceBuild", "Fixed once the build starts")}
    </span>
  ) : editing || !canEdit ? null : connectFirst ? (
    <span className="flex flex-wrap gap-2">
      <Button variant="secondary" size="sm" icon={<GithubMark size={14} />} disabled={connect.isPending} aria-busy={connect.isPending || undefined}
        onClick={() => connect.mutate(undefined, { onSuccess: () => open("create") })}>
        {connect.isPending ? t("analysis.business.newRepo.connecting", "Connecting…") : t("analysis.business.answers.connectGithub", "Connect GitHub")}
      </Button>
      <Button variant="ghost" size="sm" disabled={connect.isPending} onClick={() => open()}>{t("analysis.business.newRepo.setUp", "Set up")}</Button>
    </span>
  ) : (
    <Button variant="secondary" size="sm" onClick={() => open()}>{saved ? t("analysis.business.change", "Change") : t("analysis.business.newRepo.setUp", "Set up")}</Button>
  );

  return (
    <section ref={card} aria-label={t("analysis.business.newRepo.codeRepo", "Code repository")} className={embedded ? "" : "mb-6 rounded-card bg-surface p-5 shadow-card dark:ring-1 dark:ring-line"}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {!embedded && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-success-soft text-success"><GitBranch size={16} strokeWidth={1.75} aria-hidden /></span>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {!embedded && <span className="text-[15px] font-medium">{t("analysis.business.newRepo.codeRepo", "Code repository")}</span>}
            {!saved && !locked && <Chip>{t("analysis.business.newRepo.optional", "Optional for now")}</Chip>}
          </div>
          {summary}
          {connect.isError && !editing && <p role="alert" className="mt-1 text-[13px] text-danger">{t("analysis.business.newRepo.connectFailed", "GitHub could not be connected. Try again.")}</p>}
        </div>
        {action}
      </div>
      {!locked && canEdit && editing && body}
    </section>
  );
}
