/**
 * A live product documented from its own code and documents (engine job "product.document", queued by the op
 * project.documentExisting). An existing product attached to the Factory as it is live skipped Business Analysis, so the
 * engine reads the product's real sources (its repositories on the engine host, its registry, git branches and the
 * project's Docs) and writes the records every section already shows: the project profile, the objective, one
 * requirement and one feature per module, the workflows and constraints, the milestones (released history, then the
 * open change requests), the existing design system and the stage environment.
 *
 * The data contract the screens read (pure; no imports, so the server functions bundle it unchanged):
 *   - every row the job writes carries Origin "live-product" (Objective, Requirement, Feature, Milestone, ScopeVersion,
 *     DesignBrief, Release, RequirementExtra): label it "Documented from the live product";
 *   - Project.LiveProductJson holds the snapshot of what was read (parseLiveProductSnapshot): when, the repositories,
 *     the environments with their branches, URLs and head commits, the modules, the release history (an empty commit is
 *     one that was not recorded) and what was left empty because no source says it;
 *   - DesignBrief.PrototypeJson of the documented brief is the existing design system (parseExistingDesignSystem):
 *     Look & feel shows it instead of offering to generate screens.
 * The job never sets Project.ScopeLockedAt, RequirementsConfirmedAt or Stage: the journey of the live product stays as
 * it is, so no milestone build can start from a documented milestone.
 */

/** The Origin of every record documented from the live product. */
export const LIVE_PRODUCT_ORIGIN = "live-product";

/** The engine job that documents a live product, and the op that queues it. */
export const DOCUMENT_JOB_KIND = "product.document";
export const DOCUMENT_OP = "project.documentExisting";

/** The schemas whose rows carry Origin "live-product" when the job wrote them. */
export const LIVE_PRODUCT_SCHEMAS = [
  "Objective", "Requirement", "Feature", "Milestone", "ScopeVersion", "DesignBrief", "Release", "RequirementExtra",
] as const;

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** True for a row the job documented from the live product. */
export function isLiveProductRow(row: { Origin?: unknown } | null | undefined): boolean {
  return str(row?.Origin) === LIVE_PRODUCT_ORIGIN;
}

// ── who may document a project ──────────────────────────────────────────────────────────────────────────────────────

/** Why a project cannot be documented from its live product (null: it can). Pure over the project row and its
 *  releases: an existing product (RepoMode "existing") with at least one released Release row is live. */
export function documentRefusal(project: Record<string, unknown> | null, releases: readonly Record<string, unknown>[]): "notFound" | "notExisting" | "notLive" | "paused" | null {
  if (!project || str(project.Status) === "deleting") return "notFound";
  if (str(project.RepoMode) !== "existing") return "notExisting";
  const stage = str(project.Stage);
  if (stage === "paused" || stage === "abandoned") return "paused";
  if (!releases.some((r) => str(r.Status) === "released" && r.IsDeleted !== true)) return "notLive";
  return null;
}

/** The plain sentence for each refusal (the op answers its code; the screens say this). */
export const DOCUMENT_REFUSAL_TEXT: Readonly<Record<"notFound" | "notExisting" | "notLive" | "paused", string>> = {
  notFound: "This project no longer exists.",
  notExisting: "Only an existing product attached to the Factory can be documented from its code.",
  notLive: "The product is documented once it is live: no release is recorded yet.",
  paused: "Resume the project before it is documented.",
};

// ── Project.LiveProductJson ─────────────────────────────────────────────────────────────────────────────────────────

export type LiveEnvironment = "dev" | "stage" | "production";

export interface LiveCommit {
  /** the repository key of the product's registry (web, api, …) */
  repo: string;
  /** 40 hex characters, or "" when it is not known */
  commit: string;
  /** ISO time of the commit, or "" */
  at: string;
}

export interface LiveEnvironmentFacts {
  environment: LiveEnvironment;
  /** the git branch the environment is released from ("" when no source names it) */
  branch: string;
  /** the web address ("" when no source names it) */
  url: string;
  /** the version the main repository's package.json says on that branch ("" when unknown) */
  version: string;
  /** the head of the branch in each repository on the engine host's copy */
  commits: LiveCommit[];
}

export interface LiveRelease {
  environment: LiveEnvironment;
  version: string;
  /** "" when the release did not record its commit (shown as "commit not recorded") */
  commit: string;
  releasedAt: string;
  /** true when the job wrote this Release row (Origin "live-product") */
  documented: boolean;
}

export interface LiveModule {
  key: string;
  title: string;
  /** "<repo>:<path>" of the folders and files the module is made of */
  paths: string[];
}

export interface LiveProductSnapshot {
  version: 1;
  documentedAt: string;
  jobId: string;
  /** the registry name of the product */
  product: string;
  repos: { key: string; role: string; branch: string; files: number; lines: number; firstCommitAt: string }[];
  environments: LiveEnvironmentFacts[];
  modules: LiveModule[];
  releases: LiveRelease[];
  /** version tags in the repositories (newest first) */
  tags: { repo: string; name: string; commit: string; at: string }[];
  /** what was read: the project's notes and files, and the repository documents */
  sources: { notes: number; files: number; documents: string[] };
  /** the sections left empty because no source says it (plain sentences) */
  leftEmpty: string[];
  /** the project fields the job filled in, with the value it wrote (a later run refreshes only a field still holding
   *  that value: a person's own text is never replaced) */
  profile: Record<string, string>;
}

const ENVS: readonly LiveEnvironment[] = ["dev", "stage", "production"];
const HEX40 = /^[0-9a-f]{40}$/;

const commitOf = (v: unknown): LiveCommit | null => {
  const c = rec(v);
  if (!c) return null;
  const commit = str(c.commit).toLowerCase();
  return { repo: str(c.repo), commit: HEX40.test(commit) ? commit : "", at: str(c.at) };
};

/** The snapshot as stored on the project, or null when there is none (or it is not one). */
export function parseLiveProductSnapshot(raw: unknown): LiveProductSnapshot | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const o = rec(v);
  if (!o || o.version !== 1 || !str(o.documentedAt)) return null;
  const envOf = (x: unknown): LiveEnvironment | null => (ENVS as readonly unknown[]).includes(x) ? (x as LiveEnvironment) : null;
  return {
    version: 1,
    documentedAt: str(o.documentedAt),
    jobId: str(o.jobId),
    product: str(o.product),
    repos: list(o.repos).map(rec).filter((r): r is Record<string, unknown> => r !== null).map((r) => ({
      key: str(r.key), role: str(r.role), branch: str(r.branch),
      files: typeof r.files === "number" ? r.files : 0, lines: typeof r.lines === "number" ? r.lines : 0, firstCommitAt: str(r.firstCommitAt),
    })),
    environments: list(o.environments).map(rec).flatMap((e) => {
      const env = envOf(e?.environment);
      if (!e || !env) return [];
      return [{ environment: env, branch: str(e.branch), url: str(e.url), version: str(e.version), commits: list(e.commits).map(commitOf).filter((c): c is LiveCommit => c !== null) }];
    }),
    modules: list(o.modules).map(rec).filter((m): m is Record<string, unknown> => m !== null && str(m.key) !== "").map((m) => ({
      key: str(m.key), title: str(m.title), paths: list(m.paths).map(str).filter(Boolean),
    })),
    releases: list(o.releases).map(rec).flatMap((r) => {
      const env = envOf(r?.environment);
      if (!r || !env) return [];
      const commit = str(r.commit).toLowerCase();
      return [{ environment: env, version: str(r.version), commit: HEX40.test(commit) ? commit : "", releasedAt: str(r.releasedAt), documented: r.documented === true }];
    }),
    tags: list(o.tags).map(rec).filter((t): t is Record<string, unknown> => t !== null).map((t) => ({ repo: str(t.repo), name: str(t.name), commit: str(t.commit), at: str(t.at) })),
    sources: (() => {
      const s = rec(o.sources);
      return { notes: typeof s?.notes === "number" ? s.notes : 0, files: typeof s?.files === "number" ? s.files : 0, documents: list(s?.documents).map(str).filter(Boolean) };
    })(),
    leftEmpty: list(o.leftEmpty).map(str).filter(Boolean),
    profile: Object.fromEntries(Object.entries(rec(o.profile) ?? {}).filter(([, val]) => typeof val === "string")) as Record<string, string>,
  };
}

// ── DesignBrief.PrototypeJson of the documented brief ───────────────────────────────────────────────────────────────

export interface ExistingDesignSystem {
  provider: "existing-system";
  version: 1;
  /** the repository the system was read from, and the files ("src/styles/tokens.css") */
  repo: string;
  files: string[];
  /** the colour themes people can pick ("Teal" #138086), in the product's order */
  themes: { id: string; name: string; color: string }[];
  /** the base colours of the system, by token name (#rrggbb) */
  colors: Record<string, string>;
  /** the typefaces ("Plus Jakarta Sans") */
  fonts: string[];
  /** "light" and/or "dark" */
  modes: ("light" | "dark")[];
  /** corner radii by token name ("0.75rem") */
  radius: Record<string, string>;
}

const HEX6 = /^#[0-9a-f]{6}$/i;
const TOKEN = /^[a-z][a-z0-9-]{0,39}$/;
const SIZE = /^(?:0|\d+(?:\.\d+)?(?:px|rem|em|%))$/;

/** The existing design system of a documented brief, or null for any other PrototypeJson (a Figma design, a Factory
 *  prototype) or none. */
export function parseExistingDesignSystem(raw: unknown): ExistingDesignSystem | null {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const o = rec(v);
  if (!o || o.provider !== "existing-system" || o.version !== 1) return null;
  const pairs = (x: unknown, ok: RegExp) =>
    Object.fromEntries(Object.entries(rec(x) ?? {}).filter(([k, val]) => TOKEN.test(k) && typeof val === "string" && ok.test(val)).slice(0, 64)) as Record<string, string>;
  return {
    provider: "existing-system",
    version: 1,
    repo: str(o.repo),
    files: list(o.files).map(str).filter(Boolean).slice(0, 20),
    themes: list(o.themes).map(rec).filter((t): t is Record<string, unknown> => t !== null && str(t.name) !== "" && HEX6.test(str(t.color)))
      .map((t) => ({ id: str(t.id), name: str(t.name), color: str(t.color).toLowerCase() })).slice(0, 40),
    colors: pairs(o.colors, HEX6),
    fonts: list(o.fonts).map(str).filter(Boolean).slice(0, 8),
    modes: list(o.modes).filter((m): m is "light" | "dark" => m === "light" || m === "dark"),
    radius: pairs(o.radius, SIZE),
  };
}
