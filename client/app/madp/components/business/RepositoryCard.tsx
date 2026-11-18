/** Brownfield projects: the existing product's GitHub repository and branch, which MADP analyses after the hand-over. */
import { useRef, useState, type FormEvent } from "react";
import { ExternalLink, GitBranch, Lock } from "lucide-react";
import { Button } from "@/madp/ui/kit";
import { useUpdateProject } from "@/madp/blocks/projects/mutations";
import { messageFor } from "@/madp/blocks/projects/messages";
import type { ProjectRecord } from "@/madp/blocks/projects/records";
import { checkRepoRef, repoConnected, type RepoRef } from "@/madp/domain/projectType";
import { useGithubStatus } from "@/madp/blocks/github";
import { GithubRepoChooser } from "@/madp/components/github/RepoPicker";
import { useT } from "@/madp/i18n";

export function RepositoryCard({ project, canEdit, embedded, onDone }: {
  project: ProjectRecord; canEdit: boolean;
  /** Inside the Code window: no card around it; a save closes the window. */
  embedded?: boolean; onDone?: () => void;
}) {
  const t = useT();
  const update = useUpdateProject();
  const connected = repoConnected(project);
  const locked = Boolean(project.handedOverAt);
  const [editing, setEditing] = useState(false);
  const card = useRef<HTMLElement>(null);
  const saved: RepoRef | null = connected ? { owner: project.repoOwner, name: project.repoName, branch: project.repoBranch } : null;
  const [pick, setPick] = useState<RepoRef | null>(saved);
  const [error, setError] = useState<string | null>(null);
  const github = useGithubStatus();
  const githubConnected = github.data?.connected === true;

  const open = () => {
    setPick(saved);
    setError(null);
    setEditing(true);
  };

  const save = async (ev: FormEvent) => {
    ev.preventDefault();
    if (update.isPending) return;
    if (!pick) { setError(t("analysis.business.repo.pickFirst", "Pick the repository first.")); return; }
    const ref = checkRepoRef(`${pick.owner}/${pick.name}`, pick.branch);
    if (!ref.ok) { setError(ref.message); return; }
    setError(null);
    try {
      await update.run({ projectId: project.id, repo: `${ref.value.owner}/${ref.value.name}`, repoBranch: ref.value.branch });
      setEditing(false);
      if (embedded) onDone?.();
    } catch (e) {
      setError(messageFor(e));
    }
  };

  const unchanged = Boolean(saved && pick && saved.owner === pick.owner && saved.name === pick.name && saved.branch === pick.branch);
  const form = (
    <form onSubmit={(e) => void save(e)} noValidate className="mt-4 flex flex-col gap-4">
      <GithubRepoChooser value={pick} disabled={update.isPending}
        why={t("analysis.business.repo.why", "MADP reads this code to understand the product as it is today. Connect your GitHub account and pick the repository.")}
        onChange={(v) => { setPick(v); setError(null); }} />
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      {(githubConnected || connected) && (
        <div className="flex gap-2">
          {githubConnected && (
            <Button type="submit" variant="primary" disabled={update.isPending || !pick || unchanged} aria-busy={update.isPending}>
              {update.isPending ? t("analysis.business.saving", "Saving…") : t("analysis.business.repo.save", "Save repository")}
            </Button>
          )}
          {connected && <Button type="button" variant="ghost" onClick={() => setEditing(false)}>{t("analysis.business.cancel", "Cancel")}</Button>}
        </div>
      )}
    </form>
  );

  return (
    <section ref={card} aria-label={t("analysis.business.repo.existing", "Existing product repository")} className={embedded ? "" : "mb-6 rounded-card bg-surface p-5 shadow-card dark:ring-1 dark:ring-line"}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {!embedded && <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-warning-soft text-warning"><GitBranch size={16} strokeWidth={1.75} aria-hidden /></span>}
        <div className="min-w-0 flex-1">
          {!embedded && <div className="text-[15px] font-medium">{t("analysis.business.repo.existing", "Existing product repository")}</div>}
          {connected ? (
            <a href={`https://github.com/${project.repoOwner}/${project.repoName}/tree/${encodeURIComponent(project.repoBranch)}`} target="_blank" rel="noopener noreferrer"
              className="mt-0.5 inline-flex items-center gap-1.5 text-[13px] text-accent hover:underline">
              {project.repoOwner}/{project.repoName} · {project.repoBranch}<ExternalLink size={12} strokeWidth={1.75} aria-hidden />
            </a>
          ) : (
            <div className="mt-0.5 text-[13px] text-ink2">{t("analysis.business.repo.needed", "Needed before the hand-over: MADP reads this code to understand the product as it is today.")}</div>
          )}
        </div>
        {locked ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-ink3"><Lock size={14} strokeWidth={1.75} aria-hidden />{t("analysis.business.repo.fixed", "Fixed after the hand-over")}</span>
        ) : connected && !editing && canEdit ? (
          <Button variant="secondary" size="sm" onClick={open}>{t("analysis.business.change", "Change")}</Button>
        ) : null}
      </div>
      {!locked && canEdit && (editing || !connected) && form}
      {connected && !locked && !editing && (
        <p className="mt-3 text-[13px] text-ink3">{t("analysis.business.repo.checksAccess", "MADP checks its access to this repository when it starts the analysis.")}</p>
      )}
    </section>
  );
}
