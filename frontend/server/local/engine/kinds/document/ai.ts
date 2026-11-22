// The Claude part of product.document (../document.ts): three short asks over the product's real sources, each with
// its JSON schema and a strict check of the answer. Nothing a source does not say is kept: every user, client fact,
// constraint, exclusion and success target names its evidence (the registry, the code, a repository document, or a
// note or file of the project's Docs by its tag), modules are made only of the module candidates found in the code,
// phases only of those modules, and an item that names an internal term or uses AI wording is dropped (terms.ts).
//   1. profile: what the product is, its goal, users and roles, client, objective, workflows, constraints, exclusions,
//      success targets;
//   2. modules: the candidates grouped into the product's modules, each with its title, summary and key capabilities,
//      plus the few requirements that cut across modules (security, languages…);
//   3. phases: the modules grouped into the phases the product was built in (released history).
// Pure, except the prompt material the writer reads.
import { CONSTRAINT_KINDS, type ConstraintKind } from "../../../../../src/domain/setupDetails";
import { SUCCESS_KEYS, type SuccessKey } from "../../../../../src/domain/successTargets";
import { S, arr, obj, oneOf, text, texts } from "../../ai/check.ts";
import { slugOf } from "../../text.ts";
import type { ModuleCandidate, ProductSources } from "./sources.ts";
import { keepItem, type Terms } from "./terms.ts";

/** Evidence that is not a note or file tag. */
export const BASE_EVIDENCE = ["registry", "code", "readme"] as const;

export interface ProfileAnswer {
  description: string;
  goal: string;
  users: { role: string; does: string; evidence: string }[];
  client: { name: string; industry: string; region: string; evidence: string };
  objective: { statement: string; criteria: string[] };
  workflows: { title: string; who: string; steps: string[]; modules: string[]; evidence: string }[];
  constraints: { kind: ConstraintKind; text: string; evidence: string }[];
  exclusions: { text: string; evidence: string }[];
  successTargets: { key: SuccessKey; value: string; evidence: string }[];
}

export interface ModuleAnswer {
  key: string;
  title: string;
  summary: string;
  capabilities: string[];
  /** candidate keys */
  parts: string[];
}

export const CROSS_CATEGORIES = ["security", "nfr", "ux", "data", "integration"] as const;
export type CrossCategory = (typeof CROSS_CATEGORIES)[number];

export interface ModulesAnswer {
  modules: ModuleAnswer[];
  crossCutting: { key: string; title: string; text: string; category: CrossCategory; criteria: string[]; evidence: string }[];
}

export interface PhasesAnswer {
  phases: { name: string; goal: string; modules: string[] }[];
}

/** Kept small on purpose: each answer must come within the engine's AI time limit (MF_ENGINE_AI_TIMEOUT_MS). */
export const LIMITS = { users: 8, workflows: 6, constraints: 8, exclusions: 6, targets: 5, modules: 24, capabilities: 6, cross: 6, phases: 8, criteria: 6 } as const;

const DOC_TAG = /^[NF]\d{1,3}$/;
const isDocTag = (e: string) => DOC_TAG.test(e);

/** What the asks share: the product, its code and its documents, in plain sections (pure). */
export function sourcesText(s: ProductSources, o: { budget?: number } = {}): string {
  const out: string[] = [];
  out.push(`Product: ${s.name}${s.description ? ` — ${s.description}` : ""}`);
  out.push(`Repositories:\n${s.repos.map((r) => `- \`${r.key}\` (${r.role || "code"}): ${r.files} source files, ${r.lines} lines${r.firstCommitAt ? `, first commit ${r.firstCommitAt.slice(0, 10)}` : ""}`).join("\n")}`);
  if (s.languages.length) out.push(`Languages the product is translated into (registry): ${s.languages.join(", ")}`);
  if (s.environments.length) out.push(`Environments: ${s.environments.map((e) => `${e.environment}${e.branch ? ` (branch ${e.branch})` : ""}`).join(", ")}`);
  if (s.agentRules.length) out.push(`The owner's standing rules for the code (registry):\n${s.agentRules.slice(0, 20).map((r) => `- ${r.slice(0, 400)}`).join("\n")}`);
  if (s.tables.length) out.push(`Data tables (${s.tables.length}): ${s.tables.join(", ").slice(0, 3000)}`);
  if (s.documents.length) {
    let budget = o.budget ?? 5000;
    const docs: string[] = [];
    for (const d of s.documents) {
      if (budget <= 200) break;
      const body = d.excerpt.slice(0, Math.min(d.excerpt.length, budget));
      budget -= body.length;
      docs.push(`[readme] ${d.repo}/${d.path}:\n${body}`);
    }
    out.push(`The repositories' own documents (evidence "readme"):\n${docs.join("\n\n")}`);
  }
  return out.join("\n\n");
}

/** The module candidates, one line each (pure). */
export function candidatesText(candidates: readonly ModuleCandidate[]): string {
  return candidates
    .map((c) => `- ${c.key}: ${c.parts.map((p) => `${p.repo}:${p.path}${p.kind === "dir" && p.files.length ? ` [${p.files.join(", ")}]` : ""} (${p.lines} lines)`).join("; ")}`)
    .join("\n");
}

/** The product is called by the project's own name: its code and documents may still use an earlier one. */
const naming = (name: string) => `The product is called ${name}; call it that, even where the code or the documents use another name.`;

const RULES = [
  "You document a product that is already built and live, for the people who run the project. Describe what the product does today, from the sources below; never what it could do.",
  "Only state what the sources say or the code clearly shows. When no source says it, leave the field empty (an empty string or an empty list): an empty field is correct, a guess is wrong.",
  "Every item that asks for evidence names where it comes from: \"registry\" (the product's registry: description, languages, rules), \"code\" (the file map, folders and data tables), \"readme\" (the repositories' own documents) or the tag of a note or file of the project ([N1], [F2], without brackets).",
  "Write for business people: short sentences, no file names, no code, no internal project names or codenames, nothing about how the documentation was made.",
].join(" ");

// ── 1. profile ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function profileSchema(evidence: readonly string[], moduleKeys: readonly string[]): object {
  const ev = S.enum(evidence, "where this comes from");
  const docEv = S.enum(evidence.filter((e) => e !== "code"), "where this comes from (not the code)");
  return S.obj({
    description: S.str("2 to 4 sentences: what the product is and does, for whom; empty when the sources do not say"),
    goal: S.str("the business goal the product serves, one or two sentences; empty when no source states it"),
    users: S.list(S.obj({ role: S.str("a kind of user or role, e.g. Accountant"), does: S.str("what they do with the product, one sentence"), evidence: ev }), LIMITS.users),
    client: S.obj({ name: S.str("the client or company the product is for, as a source names it; else empty"), industry: S.str("else empty"), region: S.str("country or region, else empty"), evidence: docEv }),
    objective: S.obj({ statement: S.str("one or two sentences: what the product achieves for its users"), criteria: S.list(S.str(), LIMITS.criteria, "2 to 6 checks that show the product does its job, from what it does today") }),
    workflows: S.list(S.obj({ title: S.str(), who: S.str("who does it"), steps: S.list(S.str(), 8), modules: S.list(moduleKeys.length ? S.enum(moduleKeys) : S.str(), 6, "the module candidates it goes through"), evidence: ev }), LIMITS.workflows),
    constraints: S.list(S.obj({ kind: S.enum(CONSTRAINT_KINDS), text: S.str("the rule the product must respect, e.g. Swiss VAT rates, QR-bill payments, English and German"), evidence: ev }), LIMITS.constraints),
    exclusions: S.list(S.obj({ text: S.str("something the sources say the product does not do"), evidence: docEv }), LIMITS.exclusions),
    successTargets: S.list(S.obj({ key: S.enum(SUCCESS_KEYS), value: S.str("the target exactly as a source states it"), evidence: S.enum(evidence.filter(isDocTag).length ? evidence.filter(isDocTag) : ["none"]) }), LIMITS.targets, "only targets a note or file states; usually empty"),
  });
}

export function profilePrompt(o: { name: string; sources: string; candidates: string; material: string }): string {
  return [
    RULES,
    naming(o.name),
    `Document the profile of ${o.name}: what it is, its goal, its users and roles, the client, the objective with its checks, the key workflows, the constraints it respects, what it does not do and the success targets.`,
    "Users and roles: the kinds of people who use it (from the roles and permissions in the code, the registry or the documents). Constraints: laws, standards, languages, currencies or systems it must respect (only those a source names). Exclusions and success targets: only what a note or file states.",
    "",
    o.sources,
    "",
    `Module candidates (folders and route groups of the code; workflows name them by key):\n${o.candidates || "(none)"}`,
    "",
    `The project's notes and files (evidence by tag):\n${o.material || "(none)"}`,
  ].join("\n");
}

export function acceptProfile(raw: unknown, ctx: { evidence: readonly string[]; moduleKeys: readonly string[]; terms: Terms }): ProfileAnswer | null {
  const o = obj(raw);
  if (!o) return null;
  const ev = new Set(ctx.evidence);
  const keys = new Set(ctx.moduleKeys);
  const t = ctx.terms;
  const keep = (v: unknown, max: number, min = 2) => keepItem(t, text(v, max, min));
  const evOf = (v: unknown): string => (typeof v === "string" && ev.has(v) ? v : "");
  const users: ProfileAnswer["users"] = [];
  for (const u of arr(o.users)) {
    const x = obj(u);
    const role = keep(x?.role, 60);
    const evidence = evOf(x?.evidence);
    if (!x || !role || !evidence || users.some((y) => y.role.toLowerCase() === role.toLowerCase())) continue;
    users.push({ role, does: keep(x.does, 240) ?? "", evidence });
    if (users.length >= LIMITS.users) break;
  }
  const c = obj(o.client);
  const cEv = evOf(c?.evidence);
  const client = c && cEv && cEv !== "code"
    ? { name: keep(c.name, 120) ?? "", industry: keep(c.industry, 120) ?? "", region: keep(c.region, 120) ?? "", evidence: cEv }
    : { name: "", industry: "", region: "", evidence: "" };
  const ob = obj(o.objective);
  const workflows: ProfileAnswer["workflows"] = [];
  for (const w of arr(o.workflows)) {
    const x = obj(w);
    const title = keep(x?.title, 300);
    const evidence = evOf(x?.evidence);
    if (!x || !title || !evidence) continue;
    const steps = texts(x.steps, 8, 300).filter((s) => keepItem(t, s) !== null);
    workflows.push({ title, who: keep(x.who, 120) ?? "", steps, modules: [...new Set(arr(x.modules).filter((k): k is string => typeof k === "string" && keys.has(k)))], evidence });
    if (workflows.length >= LIMITS.workflows) break;
  }
  const constraints: ProfileAnswer["constraints"] = [];
  for (const k of arr(o.constraints)) {
    const x = obj(k);
    const kind = oneOf(x?.kind, CONSTRAINT_KINDS);
    const txt = keep(x?.text, 300);
    const evidence = evOf(x?.evidence);
    if (!kind || !txt || !evidence || constraints.some((y) => y.text.toLowerCase() === txt.toLowerCase())) continue;
    constraints.push({ kind, text: txt, evidence });
    if (constraints.length >= LIMITS.constraints) break;
  }
  const exclusions: ProfileAnswer["exclusions"] = [];
  for (const k of arr(o.exclusions)) {
    const x = obj(k);
    const txt = keep(x?.text, 300);
    const evidence = evOf(x?.evidence);
    if (!txt || !evidence || evidence === "code") continue;
    exclusions.push({ text: txt, evidence });
    if (exclusions.length >= LIMITS.exclusions) break;
  }
  const successTargets: ProfileAnswer["successTargets"] = [];
  for (const k of arr(o.successTargets)) {
    const x = obj(k);
    const key = oneOf(x?.key, SUCCESS_KEYS);
    const value = keep(x?.value, 300);
    const evidence = evOf(x?.evidence);
    if (!key || !value || !isDocTag(evidence) || successTargets.some((y) => y.key === key)) continue;
    successTargets.push({ key, value, evidence });
  }
  return {
    description: keep(o.description, 1200, 20) ?? "",
    goal: keep(o.goal, 600, 10) ?? "",
    users,
    client,
    objective: { statement: keep(ob?.statement, 1000, 20) ?? "", criteria: texts(ob?.criteria, LIMITS.criteria, 300).filter((s) => keepItem(t, s) !== null) },
    workflows,
    constraints,
    exclusions,
    successTargets,
  };
}

// ── 2. modules ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function modulesSchema(candidateKeys: readonly string[], evidence: readonly string[]): object {
  return S.obj({
    modules: S.list(S.obj({
      key: S.str("a short lowercase key, e.g. sales"),
      title: S.str("the module's name as people know it, e.g. Sales"),
      summary: S.str("one sentence: what people do in this module"),
      capabilities: S.list(S.str("one key capability in at most 12 words, e.g. Create, send and track invoices"), LIMITS.capabilities, "3 to 6 key capabilities"),
      parts: S.list(candidateKeys.length ? S.enum(candidateKeys) : S.str(), 12, "the candidates this module is made of"),
    }), LIMITS.modules),
    crossCutting: S.list(S.obj({
      title: S.str(), text: S.str("what the whole product does or respects"), category: S.enum(CROSS_CATEGORIES), criteria: S.list(S.str(), 5), evidence: S.enum(evidence),
    }), LIMITS.cross, "the few requirements that apply to every module (sign-in and roles, languages, audit trail…), only when the sources show them"),
  });
}

export function modulesPrompt(o: { name: string; sources: string; candidates: string; map: string }): string {
  return [
    RULES,
    naming(o.name),
    `List the modules of ${o.name}: the parts people use (Sales, Purchases, Banking…), one per real module or route group, with what people do in each.`,
    "Group the module candidates below: a page folder and the route files that serve it belong to the same module (sales pages and the sales routes); a candidate that is plumbing (sign-in screens, background jobs, mail, PDF rendering, translations) either joins the module it serves or is left out. Every module names the candidates it is made of; each candidate goes into one module at most.",
    "Capabilities say what people can do, from the screens, routes and data tables you see; never a capability the code does not show.",
    "",
    o.sources,
    "",
    `Module candidates (key: repository:path [files]):\n${o.candidates || "(none)"}`,
    "",
    `FILE MAP (the tracked source files, one line per folder):\n${o.map}`,
  ].join("\n");
}

export function acceptModules(raw: unknown, ctx: { candidates: readonly ModuleCandidate[]; evidence: readonly string[]; terms: Terms }): ModulesAnswer | null {
  const o = obj(raw);
  if (!o) return null;
  const known = new Set(ctx.candidates.map((c) => c.key));
  const used = new Set<string>();
  const keys = new Set<string>();
  const t = ctx.terms;
  const modules: ModuleAnswer[] = [];
  for (const m of arr(o.modules)) {
    const x = obj(m);
    if (!x) continue;
    const parts = [...new Set(arr(x.parts).filter((k): k is string => typeof k === "string" && known.has(k) && !used.has(k)))];
    const rawTitle = text(x.title, 80);
    const title = rawTitle && !t.ai(rawTitle) ? t.clean(rawTitle) : "";
    if (!parts.length || !title || title.length < 2) continue;
    let key = slugOf(typeof x.key === "string" && x.key.trim() ? x.key : title, 40);
    for (let n = 2; keys.has(key); n++) key = `${slugOf(title, 36)}-${n}`;
    keys.add(key);
    for (const p of parts) used.add(p);
    modules.push({
      key,
      title,
      summary: keepItem(t, text(x.summary, 600, 10)) ?? "",
      capabilities: texts(x.capabilities, LIMITS.capabilities, 300).filter((s) => keepItem(t, s) !== null),
      parts,
    });
    if (modules.length >= LIMITS.modules) break;
  }
  if (!modules.length && ctx.candidates.length) return null;
  const ev = new Set(ctx.evidence);
  const crossCutting: ModulesAnswer["crossCutting"] = [];
  for (const c of arr(o.crossCutting)) {
    const x = obj(c);
    const title = keepItem(t, text(x?.title, 200));
    const txt = keepItem(t, text(x?.text, 1000, 10));
    const category = oneOf(x?.category, CROSS_CATEGORIES);
    const evidence = typeof x?.evidence === "string" && ev.has(x.evidence) ? x.evidence : "";
    if (!x || !title || !txt || !category || !evidence) continue;
    let key = slugOf(title, 40);
    for (let n = 2; keys.has(key); n++) key = `${slugOf(title, 36)}-${n}`;
    keys.add(key);
    crossCutting.push({ key, title, text: txt, category, criteria: texts(x.criteria, 5, 300).filter((s) => keepItem(t, s) !== null), evidence });
    if (crossCutting.length >= LIMITS.cross) break;
  }
  return { modules, crossCutting };
}

// ── 3. phases ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function phasesSchema(moduleKeys: readonly string[]): object {
  return S.obj({
    phases: S.list(S.obj({
      name: S.str("a short name, e.g. Sales and invoicing"),
      goal: S.str("one sentence: what this phase delivered"),
      modules: S.list(S.enum(moduleKeys), LIMITS.modules),
    }), LIMITS.phases, "1 to 8 phases in the order they were built"),
  });
}

export function phasesPrompt(o: { name: string; modules: string; tags: string; material: string }): string {
  return [
    RULES,
    naming(o.name),
    `Group the live modules of ${o.name} into the phases the product was built in, oldest first (1 to 8 phases). Use the dates each module first appeared in the code and, when the project's notes or files describe the delivery plan or its phases, follow them and their names.`,
    "Every module goes into exactly one phase. A phase name says what it delivered; never invent a date or a release the sources do not show.",
    "",
    `Modules (key: title, first seen in the code):\n${o.modules}`,
    ...(o.tags ? ["", `Version tags in the repositories:\n${o.tags}`] : []),
    "",
    `The project's notes and files:\n${o.material || "(none)"}`,
  ].join("\n");
}

export function acceptPhases(raw: unknown, ctx: { moduleKeys: readonly string[]; terms: Terms }): PhasesAnswer | null {
  const o = obj(raw);
  if (!o) return null;
  const known = new Set(ctx.moduleKeys);
  const used = new Set<string>();
  const phases: PhasesAnswer["phases"] = [];
  for (const p of arr(o.phases)) {
    const x = obj(p);
    const raw = text(x?.name, 100);
    const name = raw && !ctx.terms.ai(raw) ? ctx.terms.clean(raw) : "";
    const modules = [...new Set(arr(x?.modules).filter((k): k is string => typeof k === "string" && known.has(k) && !used.has(k)))];
    if (!x || name.length < 2 || !modules.length) continue;
    for (const m of modules) used.add(m);
    phases.push({ name, goal: keepItem(ctx.terms, text(x.goal, 600, 10)) ?? "", modules });
    if (phases.length >= LIMITS.phases) break;
  }
  return phases.length ? { phases } : null;
}
