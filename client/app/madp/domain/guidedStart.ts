/**
 * The guided project start (pure: no React, no storage). One question per step for people without technical
 * knowledge: what are you building (new or existing product), about the project, its goal and users, and where the
 * code or the product is. The answers become the project.create arguments only on the last step; until then they are
 * a draft. The words "greenfield" / "brownfield" never reach the screen: "new" and "existing" map to them here.
 */
import { checkProjectName } from "./projects";
import { NEW_REPO_BRANCH, checkBranch, checkNewRepo, checkRepoRef, isRepoVisibility, repoSlug, type RepoRef, type RepoVisibility } from "./projectType";

export type StartKind = "new" | "existing";
export type StepId = "kind" | "about" | "goal" | "where" | "ready";
export type TestEnvAnswer = "yes" | "no" | "unsure";
/** Where a new product's code lives: "factory" = MADP Factory keeps it (the default, nothing to set up); "create" = a new
 *  repository in the connected GitHub account; "existing" = a GitHub repository the team already has. GitHub is optional. */
export type RepoChoice = "factory" | "create" | "existing";

/** The code home of a new product's answers (an unset choice is MADP Factory). */
export const codeHomeOf = (a: Pick<StartAnswers, "repoChoice">): RepoChoice => a.repoChoice ?? "factory";

/** The steps in order (the same for both kinds; step 4 asks different questions). */
/** The objective and the end users are not asked here (owner 08.11.2026): the business analyst asks them in Business
 *  Analysis when the description leaves them open. The "goal" step stays defined for saved drafts and older links. */
export const STEPS: readonly StepId[] = ["kind", "about", "where", "ready"];

export const STEP_TITLE: Record<StepId, string> = {
  kind: "Your idea",
  about: "About the project",
  goal: "Goal and users",
  where: "Where it lives",
  ready: "Ready",
};

export interface StartAnswers {
  kind: StartKind | null;
  name: string;
  description: string;
  /** Existing product only: its website (optional; "" = none). Stored on the project as WebsiteUrl; a new idea has none. */
  website: string;
  goal: string;
  goalTags: string[];
  users: string;
  userTags: string[];
  /* new product */
  repoChoice: RepoChoice | null;
  /** The new repository's name ("" = suggested from the project name). */
  newRepoName: string;
  repoVisibility: RepoVisibility;
  /** The branch MADP starts on (new repository; default main). */
  startBranch: string;
  hasBlocksProject: boolean;
  blocksProjectRef: string;
  /* both: a repository that already exists (new product: "use one I already have"; existing product: its code) */
  repo: RepoRef | null;
  /** Existing product: no repository now, it is added later on the project's setup page. */
  repoLater: boolean;
  /* existing product */
  appUrl: string;
  testEnv: TestEnvAnswer | null;
  testUrl: string;
  testAccess: string;
  runInstructions: string;
}

export const EMPTY_ANSWERS: StartAnswers = {
  kind: null, name: "", description: "", website: "", goal: "", goalTags: [], users: "", userTags: [],
  repoChoice: "factory", newRepoName: "", repoVisibility: "private", startBranch: NEW_REPO_BRANCH, hasBlocksProject: false, blocksProjectRef: "",
  repo: null, repoLater: false,
  appUrl: "", testEnv: null, testUrl: "", testAccess: "", runInstructions: "",
};

/** Helper chips: tap to add, tap again to remove. */
export const GOAL_CHIPS = [
  "Save time", "Replace spreadsheets", "Sell online", "Serve customers better", "Fewer mistakes", "See everything in one place", "Work from anywhere",
] as const;
export const USER_CHIPS = ["Our own team", "Customers", "Managers", "Partners and suppliers", "Field staff", "The public"] as const;

export const LIMITS = { description: 2000, website: 500, goal: 2000, users: 1000, blocksProjectRef: 200, url: 500, testAccess: 500, runInstructions: 5000 } as const;

export type FieldKey =
  | "kind" | "name" | "description" | "website" | "goal" | "users" | "repoChoice" | "newRepoName" | "startBranch" | "blocksProjectRef"
  | "repo" | "appUrl" | "testEnv" | "testUrl" | "testAccess" | "runInstructions";
export type StepErrors = Partial<Record<FieldKey, string>>;

/**
 * An http(s) address typed by a person: "" stays "", a bare host ("app.example.com", "localhost:3000/x") gets https://,
 * anything else (another scheme, spaces, credentials, no host) is null.
 */
export function normaliseWebUrl(raw: string, max = LIMITS.url): string | null {
  const t = raw.trim();
  if (!t) return "";
  if (/\s/.test(t) || t.length > max) return null;
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t);
  // "mailto:x" or "javascript:x" has a scheme without "//"; "host:8080" is a bare host with a port.
  if (!hasScheme && /^[a-z][a-z0-9+.-]*:(?!\d)/i.test(t)) return null;
  const text = hasScheme ? t : `https://${t}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) return null;
  // Without a scheme, a single word is not taken for a host name ("staging" is more likely a typo than an address).
  if (!hasScheme && !url.hostname.includes(".") && url.hostname !== "localhost") return null;
  return text.length > max ? null : text;
}

/** Why a website address was refused: not an http(s) address, or longer than LIMITS.website. */
export type WebsiteProblem = "invalid" | "tooLong";

/**
 * The optional website of an existing product: "" stays "" (none), a bare "yourcompany.com" becomes https://yourcompany.com, only
 * http(s) addresses are kept. The same check runs in the browser and in the ops.
 */
export function checkWebsite(raw: string): { ok: true; value: string } | { ok: false; problem: WebsiteProblem } {
  const t = raw.trim();
  if (!t) return { ok: true, value: "" };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  if (withScheme.length > LIMITS.website) return { ok: false, problem: "tooLong" };
  const url = normaliseWebUrl(t, LIMITS.website);
  return url ? { ok: true, value: url } : { ok: false, problem: "invalid" };
}

export const WEBSITE_MESSAGE: Record<WebsiteProblem, string> = {
  invalid: "Enter a web address, like www.example.com.",
  tooLong: `Use at most ${LIMITS.website} characters.`,
};

/** True when a text seems to hold a password or a secret (we only ask who gives access, never for the secret itself). */
export function looksLikeSecret(text: string): boolean {
  return /\b(pass(word|wort|wd)?|pwd|kennwort|secret|token|api[ _-]?key)\s*[:=]/i.test(text) || /\b(password|passwort|kennwort)\s+(is|ist)\s+\S/i.test(text);
}

const URL_MESSAGE = "Enter a web address, for example app.example.com.";
const SECRET_MESSAGE = "Please don't share passwords here. Just tell us who can give us access.";

/** The words of the chosen chips and the free text as one sentence-like line ("Save time, fewer mistakes. …"). */
export function joinAnswer(tags: readonly string[], text: string): string {
  const t = text.trim();
  const chips = tags.map((c, i) => (i === 0 ? c : c.charAt(0).toLowerCase() + c.slice(1))).join(", ");
  if (!chips) return t;
  if (!t) return chips;
  return `${chips}. ${t}`;
}

/** New repository names follow the project name. */
export function suggestedRepoName(a: Pick<StartAnswers, "newRepoName" | "name">): string {
  return repoSlug(a.name);
}

/** What is missing or wrong on one step (empty: the person may continue). `githubLogin` is the connected account. */
export function validateStep(step: StepId, a: StartAnswers, githubLogin: string | null = null, opts: { skipRepo?: boolean } = {}): StepErrors {
  const e: StepErrors = {};
  switch (step) {
    case "kind":
      if (!a.kind) e.kind = "Choose one to continue.";
      break;
    case "about": {
      if (!a.name.trim()) e.name = "Give your project a name.";
      else if (!checkProjectName(a.name).ok) e.name = "Use 1 to 80 characters for the name.";
      const d = a.description.trim();
      if (d.length < 10) e.description = d ? "Tell me a little more: one or two sentences is enough." : "Describe your project in a sentence or two.";
      else if (d.length > LIMITS.description) e.description = `Keep it under ${LIMITS.description} characters; you can add documents next.`;
      if (a.kind === "existing") {
        const w = checkWebsite(a.website);
        if (!w.ok) e.website = WEBSITE_MESSAGE[w.problem];
      }
      break;
    }
    case "goal":
      if (!a.goal.trim() && a.goalTags.length === 0) e.goal = "Pick a goal above or write it in your own words.";
      else if (a.goal.length > LIMITS.goal) e.goal = `Keep it under ${LIMITS.goal} characters.`;
      if (!a.users.trim() && a.userTags.length === 0) e.users = "Pick who will use it or describe them.";
      else if (a.users.length > LIMITS.users) e.users = `Keep it under ${LIMITS.users} characters.`;
      break;
    case "where":
      if (a.kind === "existing") {
        // the product's repository is optional (it can be added later on the project page); checked when given
        if (!opts.skipRepo && a.repo) {
          const r = checkRepoRef(`${a.repo.owner}/${a.repo.name}`, a.repo.branch);
          if (!r.ok) e.repo = r.message;
        }
        if (normaliseWebUrl(a.appUrl) === null) e.appUrl = URL_MESSAGE;
        if (a.testEnv === "yes") {
          if (!a.testUrl.trim()) e.testUrl = "Where can we find the test version?";
          else if (normaliseWebUrl(a.testUrl) === null) e.testUrl = URL_MESSAGE;
          if (looksLikeSecret(a.testAccess)) e.testAccess = SECRET_MESSAGE;
          else if (a.testAccess.length > LIMITS.testAccess) e.testAccess = `Keep it under ${LIMITS.testAccess} characters.`;
        }
        if (looksLikeSecret(a.runInstructions)) e.runInstructions = SECRET_MESSAGE;
        else if (a.runInstructions.length > LIMITS.runInstructions) e.runInstructions = `Keep it under ${LIMITS.runInstructions} characters.`;
      } else if (!opts.skipRepo) {
        // MADP Factory (the default) needs nothing; GitHub, when chosen, needs the connection
        const home = codeHomeOf(a);
        if (home === "existing") {
          if (!a.repo) e.repo = "Choose the repository to use, or keep the code in MADP Factory.";
          else {
            const r = checkRepoRef(`${a.repo.owner}/${a.repo.name}`, a.repo.branch);
            if (!r.ok) e.repo = r.message;
          }
        }
        if (home === "create") {
          if (!githubLogin) e.newRepoName = "Connect GitHub first, or keep the code in MADP Factory and connect GitHub later.";
          if (githubLogin) {
            const r = checkNewRepo(githubLogin, suggestedRepoName(a), a.repoVisibility);
            if (!r.ok && r.field === "name") e.newRepoName = r.message;
          }
          if (!checkBranch(a.startBranch || NEW_REPO_BRANCH).ok) e.startBranch = "Enter a valid branch name, for example main.";
        }
        if (a.hasBlocksProject && a.blocksProjectRef.length > LIMITS.blocksProjectRef) e.blocksProjectRef = `Keep it under ${LIMITS.blocksProjectRef} characters.`;
      } else if (a.hasBlocksProject && a.blocksProjectRef.length > LIMITS.blocksProjectRef) e.blocksProjectRef = `Keep it under ${LIMITS.blocksProjectRef} characters.`;
      break;
    case "ready":
      break;
  }
  return e;
}

export const isStepComplete = (step: StepId, a: StartAnswers, login: string | null = null) => Object.keys(validateStep(step, a, login)).length === 0;

export function stepIndex(step: StepId): number {
  return STEPS.indexOf(step);
}

export function nextStep(step: StepId): StepId {
  return STEPS[Math.min(STEPS.length - 1, stepIndex(step) + 1)];
}

export function prevStep(step: StepId): StepId {
  return STEPS[Math.max(0, stepIndex(step) - 1)];
}

/** The furthest step a draft may resume at: the first step that is not complete (or the saved one, when earlier). */
export function resumeStep(saved: StepId, a: StartAnswers): StepId {
  for (const s of STEPS) {
    if (s === saved) return s;
    if (!isStepComplete(s, a)) return s;
  }
  return saved;
}

/** Answers read back from storage: anything unknown or of the wrong shape falls back to the empty answer. */
export function sanitiseAnswers(raw: unknown): StartAnswers {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (k: keyof StartAnswers) => (typeof o[k] === "string" ? (o[k] as string) : (EMPTY_ANSWERS[k] as string));
  const tags = (k: keyof StartAnswers, allowed: readonly string[]) =>
    Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === "string" && allowed.includes(x)) : [];
  const repo = (() => {
    const r = o.repo as Record<string, unknown> | null | undefined;
    if (!r || typeof r !== "object" || typeof r.owner !== "string" || typeof r.name !== "string" || typeof r.branch !== "string") return null;
    return { owner: r.owner, name: r.name, branch: r.branch };
  })();
  return {
    kind: o.kind === "new" || o.kind === "existing" ? o.kind : null,
    name: str("name"), description: str("description"), website: str("website"),
    goal: str("goal"), goalTags: tags("goalTags", GOAL_CHIPS), users: str("users"), userTags: tags("userTags", USER_CHIPS),
    repoChoice: o.repoChoice === "factory" || o.repoChoice === "create" || o.repoChoice === "existing" ? o.repoChoice : "factory",
    newRepoName: str("newRepoName"), repoVisibility: isRepoVisibility(o.repoVisibility) ? o.repoVisibility : "private",
    startBranch: str("startBranch") || NEW_REPO_BRANCH, hasBlocksProject: o.hasBlocksProject === true, blocksProjectRef: str("blocksProjectRef"),
    repo, repoLater: o.repoLater === true,
    appUrl: str("appUrl"), testEnv: o.testEnv === "yes" || o.testEnv === "no" || o.testEnv === "unsure" ? o.testEnv : null,
    testUrl: str("testUrl"), testAccess: str("testAccess"), runInstructions: str("runInstructions"),
  };
}

export function isStepId(x: unknown): x is StepId {
  return typeof x === "string" && (STEPS as readonly string[]).includes(x);
}

/** A saved draft that stood at the former "goal" step opens at the step after it. */
export function currentStepId(x: unknown): StepId | null {
  if (x === "goal") return "where";
  return isStepId(x) ? x : null;
}

/** The project.create arguments of finished answers (the same op as the New project form, plus the guided fields). */
export interface GuidedCreateArgs {
  name: string;
  projectType: "greenfield" | "brownfield";
  description?: string;
  websiteUrl?: string;
  goal?: string;
  targetUsers?: string;
  repo?: string;
  repoBranch?: string;
  newRepoOwner?: string;
  newRepoName?: string;
  repoVisibility?: RepoVisibility;
  blocksProjectRef?: string;
  appUrl?: string;
  testEnv?: string;
  runInstructions?: string;
  setupAnswers: string;
  setupStatus: "draft";
}

export function toCreateArgs(a: StartAnswers, githubLogin: string | null): GuidedCreateArgs {
  const existing = a.kind === "existing";
  const out: GuidedCreateArgs = {
    name: a.name.trim(),
    projectType: existing ? "brownfield" : "greenfield",
    setupStatus: "draft",
    setupAnswers: JSON.stringify({ v: 1, ...a, ...(githubLogin ? { githubLogin } : {}) }),
  };
  const d = a.description.trim();
  if (d) out.description = d;
  const w = checkWebsite(a.website);
  if (existing && w.ok && w.value) out.websiteUrl = w.value;
  const goal = joinAnswer(a.goalTags, a.goal);
  if (goal) out.goal = goal;
  const users = joinAnswer(a.userTags, a.users);
  if (users) out.targetUsers = users;
  const home = codeHomeOf(a);
  const useRepo = existing ? a.repo : home === "existing" && a.repo;
  if (useRepo && a.repo) {
    out.repo = `${a.repo.owner}/${a.repo.name}`;
    out.repoBranch = a.repo.branch;
  }
  if (!existing && home === "create" && githubLogin) {
    out.newRepoOwner = githubLogin;
    out.newRepoName = suggestedRepoName(a);
    out.repoVisibility = "private";
    out.repoBranch = (a.startBranch || NEW_REPO_BRANCH).trim();
  }
  if (!existing && a.hasBlocksProject && a.blocksProjectRef.trim()) out.blocksProjectRef = a.blocksProjectRef.trim();
  if (existing) {
    const app = normaliseWebUrl(a.appUrl);
    if (app) out.appUrl = app;
    if (a.testEnv) {
      const url = a.testEnv === "yes" ? normaliseWebUrl(a.testUrl) : "";
      const access = a.testEnv === "yes" ? a.testAccess.trim() : "";
      out.testEnv = JSON.stringify({ available: a.testEnv, ...(url ? { url } : {}), ...(access ? { accessHow: access } : {}) });
    }
    if (a.runInstructions.trim()) out.runInstructions = a.runInstructions.trim();
  }
  return out;
}

/* ── editing the answers of an existing project (the Project setup page) ──── */

/** The steps whose answers can be changed after the project exists (what it is stays as created). Not the goal and
 *  users: Project Setup no longer asks them, the business analyst elicits them in Business Analysis (owner, 08.11.2026). */
export const EDIT_STEPS: readonly StepId[] = ["about", "where"];

export interface ProjectAnswersSource {
  name: string;
  type: "greenfield" | "brownfield" | string;
  websiteUrl?: string;
  goal?: string;
  targetUsers?: string;
  appUrl?: string;
  testEnv?: string;
  runInstructions?: string;
  blocksProjectRef?: string;
  setupAnswers?: string;
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
}

/** The answers of a project: its saved setup answers, with the project's own fields winning (they may have changed since). */
export function answersFromProject(p: ProjectAnswersSource): StartAnswers {
  let saved: unknown = null;
  try { saved = p.setupAnswers ? JSON.parse(p.setupAnswers) : null; } catch { saved = null; }
  const a = sanitiseAnswers(saved);
  const existing = p.type === "brownfield";
  const fromSaved = saved !== null;
  let testEnv = a.testEnv, testUrl = a.testUrl, testAccess = a.testAccess;
  if (p.testEnv) {
    try {
      const t = JSON.parse(p.testEnv) as { available?: string; url?: string; accessHow?: string };
      if (t.available === "yes" || t.available === "no" || t.available === "unsure") {
        testEnv = t.available; testUrl = t.url ?? ""; testAccess = t.accessHow ?? "";
      }
    } catch { /* keep the saved answer */ }
  }
  const repo = p.repoOwner && p.repoName && p.repoBranch ? { owner: p.repoOwner, name: p.repoName, branch: p.repoBranch } : a.repo;
  return {
    ...a,
    kind: existing ? "existing" : "new",
    name: p.name,
    website: existing ? p.websiteUrl ?? a.website : "",
    // free text and chips come from the saved answers; a project without them shows its fields as free text
    goal: fromSaved ? a.goal : p.goal ?? "",
    goalTags: fromSaved ? a.goalTags : [],
    users: fromSaved ? a.users : p.targetUsers ?? "",
    userTags: fromSaved ? a.userTags : [],
    appUrl: p.appUrl ?? a.appUrl,
    testEnv, testUrl, testAccess,
    runInstructions: p.runInstructions ?? a.runInstructions,
    hasBlocksProject: Boolean(p.blocksProjectRef) || a.hasBlocksProject,
    blocksProjectRef: p.blocksProjectRef ?? a.blocksProjectRef,
    repo,
  };
}

/** The project.setup arguments of changed answers (the repository is changed on its own card). */
export function toSetupArgs(projectId: string, a: StartAnswers, currentName: string) {
  const existing = a.kind === "existing";
  const name = a.name.trim();
  const testEnv = existing && a.testEnv
    ? JSON.stringify({ available: a.testEnv, ...(a.testEnv === "yes" && normaliseWebUrl(a.testUrl) ? { url: normaliseWebUrl(a.testUrl) } : {}), ...(a.testEnv === "yes" && a.testAccess.trim() ? { accessHow: a.testAccess.trim() } : {}) })
    : "";
  return {
    projectId,
    ...(name && name !== currentName ? { name } : {}),
    description: a.description.trim(),
    websiteUrl: (() => { const w = checkWebsite(a.website); return existing && w.ok ? w.value : ""; })(),
    goal: joinAnswer(a.goalTags, a.goal),
    targetUsers: joinAnswer(a.userTags, a.users),
    appUrl: existing ? normaliseWebUrl(a.appUrl) ?? "" : "",
    testEnv,
    runInstructions: existing ? a.runInstructions.trim() : "",
    blocksProjectRef: !existing && a.hasBlocksProject ? a.blocksProjectRef.trim() : "",
    setupAnswers: JSON.stringify({ v: 1, ...a }),
  };
}
