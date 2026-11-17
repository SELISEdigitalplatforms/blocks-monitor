import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProjectRecord } from "@/blocks/projects/records";
import { putRows, useUpdateProject } from "@/blocks/projects/mutations";
import { messageFor } from "@/blocks/projects/messages";
import { checkRepoRef } from "@/domain/projectType";
import { Button, Input, Label, Select } from "@/ui/kit";
import { codeHomeStillOpen } from "@/components/business/NewRepositoryCard";
import { useShellContext } from "./context";
import { blocksBranches, githubRepository } from "./github";
import { navigateBlocks } from "./protocol";

export function BlocksRepositoryCard({ project, canEdit, onDone }: { project: ProjectRecord; canEdit: boolean; onDone: () => void }) {
  const context = useShellContext((s) => s.context);
  const repos = (context?.repositories ?? []).flatMap((repo) => {
    const parsed = githubRepository(repo);
    return parsed ? [{ ...repo, ...parsed, fullName: `${parsed.owner}/${parsed.name}` }] : [];
  });
  const current = `${project.repoOwner}/${project.repoName}`;
  const [fullName, setFullName] = useState(() => repos.find((r) => r.fullName.toLowerCase() === current.toLowerCase())?.fullName ?? "");
  const [branch, setBranch] = useState(project.repoBranch);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<"greenfield" | "brownfield">(project.type);
  const [kindPending, setKindPending] = useState(false);
  const [kindError, setKindError] = useState<string | null>(null);
  const update = useUpdateProject();
  const selected = repos.find((r) => r.fullName === fullName);
  const editable = canEdit && codeHomeStillOpen(project);
  const kindEditable = canEdit && project.step === "business" && !project.handedOverAt;
  const branches = useQuery({
    queryKey: ["embedded", context?.project.tenantId, "branches", fullName],
    queryFn: () => blocksBranches(selected!.owner, selected!.name),
    enabled: Boolean(selected) && editable,
    retry: false,
    staleTime: 60_000,
  });
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!selected || !editable || update.isPending) return;
    const checked = checkRepoRef(fullName, branch);
    if (!checked.ok) { setError(checked.message); return; }
    setError(null);
    try {
      await update.run({ projectId: project.id, repo: fullName, repoBranch: checked.value.branch });
      onDone();
    } catch (reason) { setError(messageFor(reason)); }
  }
  async function saveKind() {
    if (!kindEditable || kindPending || kind === project.type) return;
    setKindPending(true); setKindError(null);
    try {
      const response = await fetch("/api/shell/project-kind", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: project.id, kind }) });
      const answer = await response.json() as { ok?: boolean; data?: { project?: Record<string, unknown> }; error?: { code?: string } };
      if (!response.ok || !answer.ok || answer.data?.project?.ItemId !== project.id) {
        const code = answer.error?.code;
        throw new Error(code === "project_work_active" ? "Wait for the current project work to finish before changing the product type."
          : code === "product_kind_locked" ? "The product type is fixed once analysis starts."
          : response.status === 403 ? "You do not have permission to change this project's product type." : "The product type could not be saved. Try again.");
      }
      putRows(project.workspaceId, "Project", [answer.data!.project!]);
    } catch (reason) { setKindError(reason instanceof Error ? reason.message : "The product type could not be saved. Try again."); }
    finally { setKindPending(false); }
  }
  return <div className="flex flex-col gap-4">
    <section className="flex flex-col gap-3 rounded-block bg-surface2 p-4" aria-label="Product type">
      <div><Label>What are you working on?</Label><Select label="Product type" value={kind} disabled={!kindEditable || kindPending || update.isPending}
        options={[{ value: "greenfield", label: "A new product" }, { value: "brownfield", label: "An existing product" }]}
        onChange={(value) => { setKind(value as "greenfield" | "brownfield"); setKindError(null); }} /></div>
      <p className="text-[13px] leading-5 text-ink2">{kind === "brownfield" ? "MADP understands the product you already have and plans changes to it." : "MADP plans and builds a new product from your requirements."}</p>
      {kindEditable ? <Button size="sm" variant="secondary" disabled={kindPending || update.isPending || kind === project.type} aria-busy={kindPending} onClick={() => void saveKind()}>
        {kindPending ? "Saving product type…" : "Save product type"}</Button> : <p className="text-[13px] text-ink3">{canEdit ? "The product type is fixed once analysis starts." : "Your project role can view this choice."}</p>}
      {kindError && <p role="alert" className="text-[13px] text-danger">{kindError}</p>}
    </section>
    <p className="text-[14px] leading-6 text-ink2">Repository connections are managed in Blocks. Choose a connected repository and save the branch MADP should use for this workflow.</p>
    {project.repoOwner && project.repoName && <p className="rounded-block bg-surface2 p-3 text-[14px]">MADP currently uses <strong>{current}</strong>{project.repoBranch ? ` · ${project.repoBranch}` : ""}.</p>}
    {!editable && <p className="text-[14px] text-ink2">{canEdit ? "The repository is fixed at this stage of the workflow." : "You do not have permission to change this MADP project's repository."}</p>}
    {editable && repos.length > 0 && <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
      <div><Label>Blocks repository</Label><Select label="Blocks repository" value={fullName} disabled={update.isPending}
        placeholder="Choose a connected repository" options={repos.map((r) => ({ value: r.fullName, label: r.fullName }))}
        onChange={(value) => { setFullName(value); setBranch(value.toLowerCase() === current.toLowerCase() ? project.repoBranch : ""); setError(null); }} /></div>
      {branches.isSuccess && branches.data.length > 0 ? <div><Label>Branch</Label><Select label="Branch" value={branch} disabled={update.isPending}
        placeholder="Choose a branch" options={branches.data.map((b) => ({ value: b.name, label: b.name }))} onChange={setBranch} /></div>
        : <div><Label>Branch</Label><Input aria-label="Branch" value={branch} disabled={!selected || update.isPending} placeholder="Enter the branch to use" onChange={(event) => setBranch(event.target.value)} />
          {branches.isPending && selected && <p role="status" className="mt-2 text-[13px] text-ink3">Loading branches from Blocks…</p>}
          {branches.isError && <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px] text-ink2"><span>Branches could not be loaded. Enter the branch name or try again.</span><Button size="sm" variant="ghost" onClick={() => void branches.refetch()}>Retry</Button></div>}
        </div>}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      <Button type="submit" variant="primary" disabled={!selected || !branch || update.isPending || (fullName.toLowerCase() === current.toLowerCase() && branch === project.repoBranch)} aria-busy={update.isPending}>
        {update.isPending ? "Saving repository…" : "Use repository in MADP"}</Button>
    </form>}
    {repos.length === 0 && <p className="rounded-block bg-surface2 p-4 text-[14px] leading-6 text-ink2">No connected GitHub repository is available for this Blocks project. Add a repository in Blocks, then return to this workspace.</p>}
    <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => navigateBlocks("repositories")}>Manage repositories in Blocks</Button><Button variant="ghost" onClick={onDone}>Close</Button></div>
  </div>;
}
