/**
 * Project types (pure; shared by the web app and the functions).
 * Greenfield builds a new product in a new repository; brownfield changes an existing product in its own GitHub
 * repository; greyfield (rebuild an existing product) is planned and cannot be chosen yet.
 * The type is stored as Project.RepoMode: "new" = greenfield, "existing" = brownfield (an unset mode is greenfield).
 */
import type { JourneyPage } from "./journey";

export type ProjectType = "greenfield" | "brownfield" | "greyfield";
export type ChoosableType = Exclude<ProjectType, "greyfield">;

export const PROJECT_TYPES: readonly { id: ProjectType; label: string; text: string; enabled: boolean }[] = [
  { id: "greenfield", label: "New product", text: "Nothing exists yet; MADP builds it from scratch and keeps the code for you.", enabled: true },
  { id: "brownfield", label: "Existing product", text: "MADP changes or extends a product you already use, from your documents, website and, if you like, its code.", enabled: true },
  { id: "greyfield", label: "Rebuilt product", text: "Rebuild an existing product on a new platform, keeping its business rules and data.", enabled: false },
];

/** What a person sees for each type; the ids greenfield / brownfield / greyfield never reach the screen. */
export const TYPE_LABEL: Record<ProjectType, string> = { greenfield: "New product", brownfield: "Existing product", greyfield: "Rebuilt product" };

export const REPO_MODE: Record<ChoosableType, "new" | "existing"> = { greenfield: "new", brownfield: "existing" };

export function isChoosableType(x: unknown): x is ChoosableType {
  return x === "greenfield" || x === "brownfield";
}

/** The type of a stored project, from its RepoMode. */
export function projectTypeOf(repoMode: string | null | undefined): ChoosableType {
  return repoMode === "existing" ? "brownfield" : "greenfield";
}

/** Step names that differ for brownfield: the product is understood from its code, and requirements are changes to it. */
const BROWNFIELD_LABEL: Partial<Record<JourneyPage, { label: string; short: string }>> = {
  sanitization: { label: "Understanding your product", short: "Understanding" },
  requirements: { label: "Goals for the change", short: "Goals" },
};

export function stepLabelFor(type: ProjectType, page: JourneyPage): { label: string; short: string } | null {
  return type === "brownfield" ? BROWNFIELD_LABEL[page] ?? null : null;
}

/* ── the repository of a brownfield project ───────────────────────────────── */

export interface RepoRef { owner: string; name: string; branch: string }

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/** owner/name from "owner/name", "https://github.com/owner/name(.git)(/...)" or "git@github.com:owner/name.git"; null if it is none of these. */
export function parseGitHubRepo(text: string): { owner: string; name: string } | null {
  const t = text.trim();
  const m = /^(?:https?:\/\/(?:www\.)?github\.com\/|git@github\.com:)?([^/\s:]+)\/([^/\s]+?)(?:\.git)?(?:\/.*)?$/i.exec(t);
  if (!m) return null;
  const [owner, name] = [m[1], m[2]];
  if (!OWNER.test(owner) || !NAME.test(name) || name === "." || name === "..") return null;
  return { owner, name };
}

/** A git branch name the way git accepts it (check-ref-format), at most 200 characters. */
export function checkBranch(text: string): { ok: true; value: string } | { ok: false; message: string } {
  const b = text.trim();
  const bad = !b || b.length > 200 || /[\s~^:?*[\\\u0000-\u001f\u007f]/.test(b) || b.includes("..") || b.includes("@{") || b.includes("//")
    || b.startsWith("-") || b.startsWith("/") || b.endsWith("/") || b.endsWith(".") || b.endsWith(".lock") || b === "@";
  return bad ? { ok: false, message: "Enter a valid branch name, for example main." } : { ok: true, value: b };
}

/** Checks a repository and branch typed by a person: the normalised reference, or the message to show. */
export function checkRepoRef(repo: string, branch: string): { ok: true; value: RepoRef } | { ok: false; field: "repo" | "branch"; message: string } {
  const r = parseGitHubRepo(repo);
  if (!r) return { ok: false, field: "repo", message: "Enter the GitHub repository as owner/name or its github.com address." };
  const b = checkBranch(branch);
  if (!b.ok) return { ok: false, field: "branch", message: b.message };
  return { ok: true, value: { ...r, branch: b.value } };
}

/** True when a brownfield project names its repository and branch (the hand-over gate). */
export function repoConnected(p: { repoOwner?: string; repoName?: string; repoBranch?: string }): boolean {
  return Boolean(p.repoOwner && p.repoName && p.repoBranch);
}

export const repoDisplay = (p: { repoOwner: string; repoName: string; repoBranch: string }) =>
  `${p.repoOwner}/${p.repoName} · ${p.repoBranch}`;

/** Project.RepoProvider of a project without a GitHub repository: MADP Factory keeps its code (the engine's own git
 *  repository for the project). Connecting GitHub later sets "github". */
export const FACTORY_REPO_PROVIDER = "factory";

/* ── the new repository of a greenfield project ───────────────────────────── */

/** Who can see the repository MADP creates for a greenfield project (never public). */
export const REPO_VISIBILITIES = ["private", "internal"] as const;
export type RepoVisibility = (typeof REPO_VISIBILITIES)[number];
export const VISIBILITY_LABEL: Record<RepoVisibility, string> = { private: "Private", internal: "Internal" };

export function isRepoVisibility(x: unknown): x is RepoVisibility {
  return x === "private" || x === "internal";
}

/** The branch MADP creates a greenfield repository with. */
export const NEW_REPO_BRANCH = "main";

/** A repository name from a project name: lower case, letters, digits and single hyphens, at most 100 characters. */
export function repoSlug(projectName: string): string {
  const s = projectName.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100).replace(/-+$/, "");
  return s || "new-product";
}

export type NewRepoCheck =
  | { ok: true; value: { owner: string; name: string; visibility: RepoVisibility } }
  | { ok: false; field: "owner" | "name" | "visibility"; message: string };

/** Checks the new repository of a greenfield project: a GitHub owner, a repository name and private or internal. */
export function checkNewRepo(owner: string, name: string, visibility: string): NewRepoCheck {
  const o = owner.trim();
  const n = name.trim();
  if (!OWNER.test(o)) return { ok: false, field: "owner", message: "Connect GitHub to choose the account the repository is created in." };
  if (!NAME.test(n) || n === "." || n === ".." || n.toLowerCase().endsWith(".git")) {
    return { ok: false, field: "name", message: "Use 1 to 100 letters, digits, dots, hyphens or underscores, for example customer-portal." };
  }
  if (!isRepoVisibility(visibility)) return { ok: false, field: "visibility", message: "Choose private or internal." };
  return { ok: true, value: { owner: o, name: n, visibility } };
}
