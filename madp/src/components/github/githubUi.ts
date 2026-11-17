/** Pure rules of the GitHub screens (no React). */
import type { GithubBranch, GithubRepo } from "@/blocks/github/types";
import { t } from "@/i18n";

/** The repositories whose name, owner or description contains every word typed, in their order (most recently updated first). */
export function filterRepos(repos: readonly GithubRepo[], query: string): GithubRepo[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...repos];
  return repos.filter((r) => {
    const text = `${r.fullName} ${r.description}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** The branch choices: the repository's branches, plus the chosen one when it is not among them (a branch named earlier). */
export function branchOptions(branches: readonly GithubBranch[], chosen: string): { value: string; label: string }[] {
  const out = branches.map((b) => ({ value: b.name, label: b.isDefault ? t("settings.github.branch.defaultLabel", "{name} (default)", { name: b.name }) : b.name }));
  if (chosen && !branches.some((b) => b.name === chosen)) out.unshift({ value: chosen, label: chosen });
  return out;
}

/** The index the arrow keys move the active option to in a list of `count`, clamped at both ends; -1 for an empty list. */
export function moveActive(active: number, count: number, key: string): number {
  if (count === 0) return -1;
  if (key === "ArrowDown") return Math.min(count - 1, active + 1);
  if (key === "ArrowUp") return Math.max(0, active - 1);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return active;
}
