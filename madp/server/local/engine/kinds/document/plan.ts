// What product.document writes, planned from the product's sources and the three answers (./ai.ts), without any I/O:
// the project profile, the objective, one requirement and one feature per module (plus the cross-cutting
// requirements), the workflows, constraints and exclusions, the scope version, the milestones (the phases the product
// was built in, the change requests already released, then the open ones), the existing design system and the
// snapshot of what was read. Every text passes the internal-terms cleaner; where no source says something the field
// stays empty and the snapshot says so (leftEmpty).
import { changeCode } from "../../../../../src/domain/delivery";
import type { ConstraintKind } from "../../../../../src/domain/setupDetails";
import { emptyTargets, type SuccessTargets } from "../../../../../src/domain/successTargets";
import type { ExistingDesignSystem, LiveEnvironment, LiveProductSnapshot } from "../../../../../src/domain/liveProduct";
import { slugOf } from "../../text.ts";
import type { CrossCategory, ModuleAnswer, ModulesAnswer, PhasesAnswer, ProfileAnswer } from "./ai.ts";
import type { ModuleCandidate, ProductSources } from "./sources.ts";
import type { Terms } from "./terms.ts";

type Row = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export interface PlannedModule {
  key: string;
  title: string;
  summary: string;
  capabilities: string[];
  /** "<repo>/<path>" of its parts */
  paths: string[];
  parts: { repo: string; path: string }[];
}

export interface PlannedRequirement {
  /** the module key or the cross-cutting requirement's key (the Requirement.Key when it is free) */
  key: string;
  Title: string;
  Text: string;
  Category: "functional" | CrossCategory;
  AcceptanceCriteria: string[];
  SourceRefs: string[];
}

export interface PlannedFeature {
  key: string;
  Title: string;
  Description: string;
  /** the planned requirement's key */
  requirement: string;
}

export interface PlannedMilestone {
  Name: string;
  Goal: string;
  /** module keys */
  features: string[];
  Status: "planned" | "building" | "done";
}

export interface PlannedExtra {
  kind: "workflow" | "constraint" | "exclusion";
  title: string;
  who: string;
  steps: string[];
  constraintKind: ConstraintKind | "";
}

export interface PlannedRelease {
  environment: LiveEnvironment;
  version: string;
  url: string;
  commit: string;
}

export interface DocumentationPlan {
  /** the project fields to fill in (only the ones the sources give) */
  profile: { Brief: string; Goal: string; TargetUsers: string; ClientName: string; ClientIndustry: string; ClientRegion: string };
  objective: { Statement: string; AcceptanceCriteria: string[]; HighLevelMd: string; ArchitectureMd: string };
  modules: PlannedModule[];
  requirements: PlannedRequirement[];
  features: PlannedFeature[];
  extras: PlannedExtra[];
  scope: { Title: string; Summary: string; SuccessTargets: string };
  milestones: PlannedMilestone[];
  design: { Instructions: string; PrototypeJson: string } | null;
  releases: PlannedRelease[];
  leftEmpty: string[];
}

export const MAX_MILESTONES = 60;

/** "InvoicesPage.tsx" -> "Invoices", "ChartOfAccountsPage.tsx" -> "Chart of accounts" (pure). */
export function screenName(file: string): string {
  const m = /^([A-Z][A-Za-z0-9]*?)(?:Page|Screen|View)\.(?:tsx|jsx|vue|svelte)$/.exec(file);
  if (!m) return "";
  const words = m[1]!.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" ");
  return words.map((w, i) => (i === 0 ? w : /^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(" ");
}

/** A key as a title: "accounting-close" -> "Accounting close" (pure). */
export const titleOfKey = (key: string): string => {
  const t = key.replace(/-/g, " ").trim();
  return t ? t[0]!.toUpperCase() + t.slice(1) : key;
};

/** The modules without an answer: the screen folders of the web repositories (else every candidate), one module
 *  each, named after their folder, with their screens as capabilities (pure). */
export function fallbackModules(candidates: readonly ModuleCandidate[], roles: Readonly<Record<string, string>>): ModuleAnswer[] {
  const web = candidates.filter((c) => c.parts.some((p) => roles[p.repo] === "web" && p.kind === "dir"));
  const list = web.length ? web : candidates;
  return list.slice(0, 30).map((c) => {
    const screens = [...new Set(c.parts.flatMap((p) => p.files.map(screenName)).filter(Boolean))].slice(0, 8);
    return { key: c.key, title: titleOfKey(c.key), summary: "", capabilities: screens, parts: [c.key] };
  });
}

const one = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
};

const ENV_WORD: Record<LiveEnvironment, string> = { dev: "Development", stage: "Staging", production: "Production" };

/** "en-US", "de-CH" -> "English, German (en-US, de-CH)" (pure). */
export function languagesText(codes: readonly string[]): string {
  let names: string[];
  try {
    const dn = new Intl.DisplayNames(["en"], { type: "language" });
    names = [...new Set(codes.map((c) => dn.of(c.split("-")[0]!) ?? c))];
  } catch {
    names = [...codes];
  }
  return codes.length ? `${names.join(", ")} (${codes.join(", ")})` : "";
}

/** The design brief of the existing design system (pure). */
export function designBrief(d: ExistingDesignSystem): { Instructions: string; PrototypeJson: string } {
  const parts: string[] = [];
  if (d.themes.length) parts.push(`${d.themes.length === 1 ? "one colour theme" : `${d.themes.length} colour themes`} (${d.themes.slice(0, 6).map((t) => t.name).join(", ")}${d.themes.length > 6 ? ", …" : ""})`);
  const colours = Object.keys(d.colors).length;
  if (colours) parts.push(`${colours} base colours`);
  parts.push(d.modes.includes("dark") ? "light and dark modes" : "a light mode");
  if (d.fonts.length) parts.push(`the ${d.fonts.length === 1 ? "typeface" : "typefaces"} ${d.fonts.join(", ")}`);
  const radii = Object.keys(d.radius).length;
  if (radii) parts.push(`${radii} corner ${radii === 1 ? "radius" : "radii"}`);
  const Instructions = `The product's existing design system, as its code defines it (${d.files.join(", ") || "the web app's styles"}): ${parts.join(", ")}. Every new screen follows this system; nothing is redesigned.`;
  return { Instructions: Instructions.slice(0, 10_000), PrototypeJson: JSON.stringify(d) };
}

export interface PlanInput {
  productName: string;
  sources: ProductSources;
  profile: ProfileAnswer | null;
  modules: ModulesAnswer | null;
  phases: PhasesAnswer | null;
  /** module key -> when it first appeared in the code (ISO) */
  firstSeen: ReadonlyMap<string, string>;
  /** the project's change requests */
  changes: readonly Row[];
  /** evidence tag -> a SourceRef ("N1" -> "doc-note:<id>") */
  refOf: (evidence: string) => string;
  terms: Terms;
}

/** The plan (pure). */
export function planDocumentation(i: PlanInput): DocumentationPlan {
  const t = i.terms;
  const clean = (s: string, max: number) => one(t.clean(s), max);
  const s = i.sources;
  const leftEmpty: string[] = [];
  const roles = Object.fromEntries(s.repos.map((r) => [r.key, r.role]));
  const byKey = new Map(s.candidates.map((c) => [c.key, c]));

  // modules
  const answered = i.modules?.modules ?? fallbackModules(s.candidates, roles);
  const modules: PlannedModule[] = answered.map((m) => {
    const parts = m.parts.flatMap((k) => byKey.get(k)?.parts ?? []).map((p) => ({ repo: p.repo, path: p.path }));
    return { key: m.key, title: clean(m.title, 120) || titleOfKey(m.key), summary: clean(m.summary, 600), capabilities: m.capabilities.map((c) => clean(c, 300)).filter(Boolean), paths: parts.map((p) => `${p.repo}/${p.path}`), parts };
  });
  if (!modules.length) leftEmpty.push("The modules: the code has no screen or route folders to read them from.");

  // requirements: one per module, then the cross-cutting ones
  const requirements: PlannedRequirement[] = modules.map((m) => ({
    key: m.key,
    Title: m.title,
    Text: m.summary || (m.capabilities.length ? `${m.title}: ${m.capabilities.join("; ")}.` : `The ${m.title} part of ${i.productName}.`),
    Category: "functional",
    AcceptanceCriteria: m.capabilities,
    SourceRefs: m.paths.slice(0, 12).map((p) => `live-product:${p}`),
  }));
  for (const c of i.modules?.crossCutting ?? []) {
    requirements.push({ key: c.key, Title: clean(c.title, 200), Text: clean(c.text, 2000), Category: c.category, AcceptanceCriteria: c.criteria.map((x) => clean(x, 300)).filter(Boolean), SourceRefs: [i.refOf(c.evidence)].filter(Boolean) });
  }
  const features: PlannedFeature[] = modules.map((m) => ({ key: m.key, Title: m.title, Description: m.summary || (m.capabilities.length ? m.capabilities.join("; ") : ""), requirement: m.key }));

  // the profile
  const p = i.profile;
  const description = clean(p?.description || s.description, 1200);
  const users = (p?.users ?? []).map((u) => (u.does ? `${clean(u.role, 60)}: ${clean(u.does, 240)}` : clean(u.role, 60))).filter(Boolean);
  const profile = {
    Brief: description,
    Goal: clean(p?.goal ?? "", 600),
    TargetUsers: users.join("; ").slice(0, 1000),
    ClientName: clean(p?.client.name ?? "", 120),
    ClientIndustry: clean(p?.client.industry ?? "", 120),
    ClientRegion: clean(p?.client.region ?? "", 120),
  };
  if (!profile.Brief) leftEmpty.push("The description: no source describes the product.");
  if (!profile.Goal) leftEmpty.push("The goal: no source states it.");
  if (!profile.TargetUsers) leftEmpty.push("The users and roles: no source names them.");
  if (!profile.ClientName) leftEmpty.push("The client: no source names it.");

  // the objective
  const envs = s.environments.map((e) => `- ${ENV_WORD[e.environment]}: ${e.url || "address not recorded"}${e.branch ? ` (branch ${e.branch})` : ""}${e.version ? `, version ${e.version}` : ""}`);
  const languages = languagesText(s.languages);
  const high: string[] = [];
  if (description) high.push(`## What it is\n${description}`);
  if (users.length) high.push(`## Users and roles\n${(p?.users ?? []).map((u) => `- **${clean(u.role, 60)}**${u.does ? `: ${clean(u.does, 240)}` : ""}`).join("\n")}`);
  if (modules.length) high.push(`## Modules\n${modules.map((m) => `- **${m.title}**${m.summary ? `: ${m.summary}` : ""}`).join("\n")}`);
  if (envs.length) high.push(`## Where it runs\n${envs.join("\n")}`);
  if (languages) high.push(`## Languages\n${languages}`);
  const arch: string[] = [];
  arch.push(`## Repositories\n${s.repos.map((r) => `- **${r.key}**${r.role ? ` (${r.role === "web" ? "web app" : r.role === "api" ? "API" : r.role})` : ""}: ${r.files} source files, ${r.lines.toLocaleString("en-GB")} lines, branch ${r.branch}${r.firstCommitAt ? `, since ${r.firstCommitAt.slice(0, 10)}` : ""}`).join("\n")}`);
  if (s.tables.length) arch.push(`## Data\n${s.tables.length} data tables: ${s.tables.slice(0, 40).join(", ")}${s.tables.length > 40 ? ", …" : ""}.`);
  if (envs.length) arch.push(`## Environments\n${envs.join("\n")}`);
  if (s.design) arch.push(`## Design system\n${designBrief(s.design).Instructions}`);
  const objective = {
    Statement: clean(p?.objective.statement || description, 1000),
    AcceptanceCriteria: (p?.objective.criteria ?? []).map((c) => clean(c, 300)).filter(Boolean),
    HighLevelMd: t.clean(high.join("\n\n")).slice(0, 50_000),
    ArchitectureMd: t.clean(arch.join("\n\n")).slice(0, 50_000),
  };

  // workflows, constraints, what it does not do
  const extras: PlannedExtra[] = [];
  for (const w of p?.workflows ?? []) extras.push({ kind: "workflow", title: clean(w.title, 300), who: clean(w.who, 120), steps: w.steps.map((x) => clean(x, 300)).filter(Boolean).slice(0, 20), constraintKind: "" });
  for (const c of p?.constraints ?? []) extras.push({ kind: "constraint", title: clean(c.text, 300), who: "", steps: [], constraintKind: c.kind });
  if (languages && !extras.some((e) => e.kind === "constraint" && e.constraintKind === "languages")) {
    extras.push({ kind: "constraint", title: languages, who: "", steps: [], constraintKind: "languages" });
  }
  for (const x of p?.exclusions ?? []) extras.push({ kind: "exclusion", title: clean(x.text, 300), who: "", steps: [], constraintKind: "" });
  if (!(p?.workflows ?? []).length) leftEmpty.push("The key workflows: no source describes them.");
  if (!(p?.exclusions ?? []).length) leftEmpty.push("What it does not do: no note or file says it.");

  // the scope version and its success targets
  let successTargets = "";
  if (p?.successTargets.length) {
    const targets: SuccessTargets = emptyTargets();
    for (const x of p.successTargets) targets[x.key] = { ...targets[x.key], value: clean(x.value, 300) };
    successTargets = JSON.stringify(targets);
  } else leftEmpty.push("The success targets: no note or file states them.");
  const scope = { Title: "The live product", Summary: clean(description || `${i.productName} as it is live.`, 5000), SuccessTargets: successTargets };

  // milestones: the phases (done), the change requests released (done), then the open ones
  const keys = new Set(modules.map((m) => m.key));
  const date = (iso: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
  const milestones: PlannedMilestone[] = [];
  const phases = i.phases?.phases.filter((x) => x.modules.some((k) => keys.has(k))) ?? [];
  const phaseList = phases.length ? phases : modules.length ? [{ name: "The product as it is live", goal: "", modules: modules.map((m) => m.key) }] : [];
  for (const ph of phaseList) {
    const mods = ph.modules.filter((k) => keys.has(k));
    const seen = mods.map((k) => i.firstSeen.get(k) ?? "").filter(Boolean).sort();
    const since = seen.length ? ` In the code since ${date(seen[0]!)}.` : "";
    milestones.push({ Name: clean(ph.name, 120) || "A phase of the product", Goal: one(`${clean(ph.goal, 1500)}${since}`.trim(), 2000), features: mods, Status: "done" });
  }
  const crs = [...i.changes].filter((c) => c.IsDeleted !== true).sort((a, b) => num(a.Number) - num(b.Number));
  const RELEASED = new Set(["released-dev", "promoted-stage", "promoted-production"]);
  const OPEN: Record<string, string> = {
    requested: "Asked for; waiting for the analysis.",
    analysing: "Being analysed.",
    questions: "Waiting for answers to the analyst's questions.",
    review: "Analysed; waiting for approval.",
    approved: "Approved; waiting to be built.",
    building: "Being built.",
    failed: "The last attempt did not finish; waiting to be started again.",
  };
  const crName = (c: Row) => {
    const code = changeCode({ lane: str(c.Lane), number: num(c.Number) || 0 });
    const title = clean(str(c.Title), 110);
    return one(title ? `${code}: ${title}` : code, 120);
  };
  for (const c of crs.filter((x) => RELEASED.has(str(x.Status)))) {
    const where = str(c.Status) === "promoted-production" ? "production" : str(c.Status) === "promoted-stage" ? "staging" : "development";
    milestones.push({ Name: crName(c), Goal: `Released to ${where}${str(c.Version) ? ` in version ${str(c.Version)}` : ""}.`, features: [], Status: "done" });
  }
  for (const c of crs.filter((x) => OPEN[str(x.Status)] !== undefined)) {
    milestones.push({ Name: crName(c), Goal: OPEN[str(c.Status)]!, features: [], Status: str(c.Status) === "building" ? "building" : "planned" });
  }

  // releases: each environment's head, recorded where the Factory has no release of it yet (the writer decides)
  const main = s.repos.find((r) => r.role === "web") ?? s.repos[0];
  const releases: PlannedRelease[] = s.environments
    .filter((e) => /^[0-9]+\.[0-9]+(\.[0-9]+)?$/.test(e.version))
    .map((e) => ({ environment: e.environment, version: e.version, url: e.url, commit: e.commits.find((c) => c.repo === main?.key)?.commit ?? "" }));
  for (const e of s.environments) if (!e.url) leftEmpty.push(`The ${ENV_WORD[e.environment].toLowerCase()} address: no source names it.`);
  if (!s.design) leftEmpty.push("The design system: no colour tokens or themes were found in the code.");

  return {
    profile,
    objective,
    modules,
    requirements,
    features,
    extras,
    scope,
    milestones: milestones.slice(0, MAX_MILESTONES),
    design: s.design ? designBrief(s.design) : null,
    releases,
    leftEmpty,
  };
}

/** The snapshot stored on the project (Project.LiveProductJson), within 40 000 characters (pure). */
export function snapshotOf(o: {
  plan: DocumentationPlan;
  sources: ProductSources;
  documentedAt: string;
  jobId: string;
  releases: readonly Row[];
  material: { notes: number; files: number };
  profile: Record<string, string>;
  leftEmpty: readonly string[];
}): LiveProductSnapshot {
  const snap: LiveProductSnapshot = {
    version: 1,
    documentedAt: o.documentedAt,
    jobId: o.jobId,
    product: o.sources.name,
    repos: o.sources.repos.map((r) => ({ key: r.key, role: r.role, branch: r.branch, files: r.files, lines: r.lines, firstCommitAt: r.firstCommitAt })),
    environments: o.sources.environments.map((e) => ({ environment: e.environment, branch: e.branch, url: e.url, version: e.version, commits: e.commits })),
    modules: o.plan.modules.map((m) => ({ key: m.key, title: m.title, paths: m.paths.slice(0, 12) })),
    releases: o.releases
      .filter((r) => r.IsDeleted !== true && ["dev", "stage", "production"].includes(str(r.Environment)))
      .map((r) => ({ environment: str(r.Environment) as LiveEnvironment, version: str(r.Version), commit: /^[0-9a-f]{40}$/.test(str(r.SourceCommit)) ? str(r.SourceCommit) : "", releasedAt: str(r.ReleasedAt), documented: str(r.Origin) === "live-product" }))
      .slice(0, 100),
    tags: o.sources.tags.slice(0, 40),
    sources: { notes: o.material.notes, files: o.material.files, documents: o.sources.documents.map((d) => `${d.repo}/${d.path}`).slice(0, 20) },
    leftEmpty: [...o.leftEmpty],
    profile: o.profile,
  };
  const unknown = snap.releases.filter((r) => !r.commit).length;
  if (unknown) snap.leftEmpty.push(`The commit of ${unknown === 1 ? "one release" : `${unknown} releases`} was not recorded when it was released.`);
  while (JSON.stringify(snap).length > 40_000 && (snap.modules.length > 10 || snap.releases.length > 10)) {
    snap.modules = snap.modules.slice(0, Math.max(10, snap.modules.length - 5)).map((m) => ({ ...m, paths: m.paths.slice(0, 3) }));
    snap.releases = snap.releases.slice(0, Math.max(10, snap.releases.length - 10));
  }
  return snap;
}

/** A key that no other row of the schema holds (Requirement.Key / Feature.Key): the key itself, else key-2, key-3… */
export function freeKey(key: string, taken: ReadonlySet<string>): string {
  const base = slugOf(key, 58);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
}
