import type { GithubBranch, GithubConnection, GithubSource } from "@/blocks/github/types";
import { parseGitHubRepo } from "@/domain/projectType";
import { useShellContext } from "./context";
import { navigateBlocks, type BlocksRepository } from "./protocol";

export function githubRepository(repo: BlocksRepository): { owner: string; name: string } | null {
  // A repository on another provider must never be interpreted as GitHub.
  if (repo.repoUrl) {
    if (!/^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:)/i.test(repo.repoUrl)) return null;
    return parseGitHubRepo(repo.repoUrl);
  }
  return parseGitHubRepo(repo.repoName);
}

function status(): GithubConnection {
  return { connected: (useShellContext.getState().context?.repositories.length ?? 0) > 0, login: null, connectedAt: null };
}

export function blocksBranches(owner: string, name: string): Promise<GithubBranch[]> {
  const repository = `${owner}/${name}`;
  const allowed = useShellContext.getState().context?.repositories.some((repo) => {
    const parsed = githubRepository(repo);
    return parsed && `${parsed.owner}/${parsed.name}`.toLowerCase() === repository.toLowerCase();
  });
  if (!allowed || window.parent === window) return Promise.reject(new Error("This repository is not connected to the selected Blocks project."));
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const finish = (error: string | null, branches: GithubBranch[] = []) => {
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      if (error) reject(new Error(error)); else resolve(branches);
    };
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent) return;
      const data = event.data;
      if (!data || data.type !== "blocks:repo-branches" || data.version !== 1 || data.requestId !== requestId) return;
      if (data.error || !Array.isArray(data.branches)) { finish("Blocks could not load this repository's branches."); return; }
      const branches = data.branches.filter((b: unknown): b is { name: string; isDefault?: boolean } => !!b && typeof b === "object" && typeof (b as { name?: unknown }).name === "string");
      if (branches.length !== data.branches.length) { finish("Blocks returned an invalid branch list."); return; }
      finish(null, branches.map((b: { name: string; isDefault?: boolean }) => ({ name: b.name, isDefault: b.isDefault === true })));
    };
    const timer = setTimeout(() => finish("Blocks did not answer the branch request. Try again."), 20_000);
    window.addEventListener("message", receive);
    window.parent.postMessage({ type: "madp:repo-branches", version: 1, requestId, repository }, location.origin);
  });
}

/** Repository consent and account switching belong to Blocks; never use a preview connection. */
export const blocksGithub: GithubSource = {
  preview: false,
  get manageAccessUrl() { return `${location.origin}/app/console`; },
  async status() { return status(); },
  async connect() { navigateBlocks("repositories"); return status(); },
  async disconnect() { navigateBlocks("repositories"); throw new Error("Manage the repository connection in Blocks."); },
  async repos() {
    return (useShellContext.getState().context?.repositories ?? []).flatMap((repo) => {
      const parsed = githubRepository(repo);
      return parsed ? [{ ...parsed, fullName: `${parsed.owner}/${parsed.name}`, private: null, defaultBranch: "", updatedAt: "", description: "Connected through Blocks" }] : [];
    });
  },
  async branches(_viewer, owner, name) { return blocksBranches(owner, name); },
};
