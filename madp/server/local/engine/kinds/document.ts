// product.document: documents a live product from its own code and documents (src/domain/liveProduct.ts). An existing
// product attached to the Factory as it is live (attach.ts: factory.json existing: true) skipped Business Analysis, so
// every section was empty. Queued by project.documentExisting (functions/project/ops/liveProduct/documentExisting.ts).
//
//   1. reads the product's sources on the engine host, read-only (kinds/document/sources.ts): its registry, the
//      repositories' file map, module candidates, data tables and documents, the design tokens, git branches and tags;
//      and the project's Docs (notes and files, the owner's BA documents among them);
//   2. asks Claude three short questions (kinds/document/ai.ts: the profile, the modules, the phases), each answer
//      checked against its schema and its evidence; without an answer the part a source gives is written and the rest
//      stays empty (never a guess);
//   3. plans and writes the records (kinds/document/plan.ts), each marked Origin "live-product": the project profile
//      and the snapshot (Project.LiveProductJson), the objective, one requirement and one feature per module, the
//      workflows, constraints and exclusions, the scope version, the milestones, the existing design system and the
//      environments' releases the Factory has not recorded;
//   4. queues wiki.generate and docs.generate, which rebuild the Wiki and Produced from those records.
//
// Re-runnable: a record it wrote before is updated in place (matched by its key, its position or the project), one a
// person changed since is left as it is, and one no longer in the plan is dropped (removed for a milestone). Rows of the
// Factory's own process are never touched, and Project.ScopeLockedAt, RequirementsConfirmedAt and Stage stay as they
// are (no milestone build can start from a documented milestone). Restart safe: inserts reuse the attempt's keys.
import type { Row } from "../../../../functions/_lib/gateway";
import type { EngineJobKind } from "../../../../src/domain/engineJob";
import { DOCUMENT_REFUSAL_TEXT, LIVE_PRODUCT_ORIGIN, documentRefusal, isLiveProductRow, parseLiveProductSnapshot } from "../../../../src/domain/liveProduct";
import { wikiJobInput } from "../../../../src/domain/wiki";
import { num, str } from "../context.ts";
import { JobFailure, JobGone, type JobRun, type KindResult, type KindWriter } from "../run.ts";
import { aiJson, early } from "../ai/index.ts";
import { projectMaterial } from "../ai/material.ts";
import { appDir, appName } from "../official/app.ts";
import {
  BASE_EVIDENCE, acceptModules, acceptPhases, acceptProfile, candidatesText, modulesPrompt, modulesSchema, phasesPrompt, phasesSchema,
  profilePrompt, profileSchema, sourcesText, type ModulesAnswer,
} from "./document/ai.ts";
import { fallbackModules, freeKey, planDocumentation, snapshotOf, type DocumentationPlan } from "./document/plan.ts";
import { firstSeen, productState, readProductSources, type ProductSources } from "./document/sources.ts";
import { termsOf } from "./document/terms.ts";

const ORIGIN = { Origin: LIVE_PRODUCT_ORIGIN } as const;
const KIND = "product.document";
/** The platform stamps a write a little after it is made: a row this job wrote may carry a date up to this much after
 *  the job's own last write (kinds/analysis/edited.ts). */
const WRITE_SLACK_MS = 30_000;
const PROFILE_FIELDS = ["Brief", "Goal", "TargetUsers", "ClientName", "ClientIndustry", "ClientRegion"] as const;

export const NO_CODE = "The product's code is not on the engine host yet, so it could not be documented. The engine team attaches it first.";
export const NOT_ATTACHED = "Only a live product attached to the Factory is documented from its code; this one is not attached on the engine host.";

/** True when a person changed the row since a product.document job wrote it (the job then leaves it as it is). */
export function editedByPerson(row: Row, schema: string, jobs: readonly Row[], current: string): boolean {
  const by = str(row.UpdatedByUserId);
  if (by && by !== str(row.CreatedByUserId)) return true;
  const creator = /^engine:([^:]+):/.exec(str(row.RequestKey))?.[1] ?? "";
  if (!creator) return true; // not the engine's row
  if (creator === current) return false;
  const updated = Date.parse(str(row.LastUpdatedDate));
  if (!Number.isFinite(updated)) return false;
  const ref = `${schema}:${str(row.ItemId)}`;
  let wrote = Number.NaN;
  for (const j of jobs) {
    if (str(j.Kind) !== KIND || str(j.ItemId) === current) continue;
    const outputs = Array.isArray(j.OutputRefs) ? j.OutputRefs : [];
    if (str(j.ItemId) !== creator && !outputs.includes(ref)) continue;
    const at = Date.parse(str(j.LastUpdatedDate)) || Date.parse(str(j.FinishedAt));
    if (Number.isFinite(at) && !(at <= wrote)) wrote = at;
  }
  if (!Number.isFinite(wrote)) wrote = Date.parse(str(row.CreatedDate));
  return Number.isFinite(wrote) && updated - wrote > WRITE_SLACK_MS;
}

class Writes {
  readonly outputs: string[] = [];
  readonly kept: string[] = [];
  private readonly jobs: Row[];
  constructor(readonly run: JobRun) {
    this.jobs = run.p.rows("EngineJob").filter((j) => str(j.Kind) === KIND);
  }
  edited(row: Row, schema: string): boolean {
    return editedByPerson(row, schema, this.jobs, this.run.id);
  }
  out(schema: string, id: string): void {
    const ref = `${schema}:${id}`;
    if (!this.outputs.includes(ref)) this.outputs.push(ref);
  }
}

const sameList = (a: unknown, b: readonly string[]) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

/** Only the fields that differ from the row (an unchanged record is not written again). */
function changed(row: Row, fields: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v) ? !sameList(row[k], v as string[]) : row[k] !== v) out[k] = v;
  }
  return out;
}

async function upsertOne(w: Writes, schema: string, row: Row | undefined, fields: Row, insertOnly: Row, local: string, what: string): Promise<string | null> {
  const run = w.run;
  if (!row) {
    const id = await run.insert(schema, { ...fields, ...insertOnly, ...ORIGIN }, local);
    w.out(schema, id);
    return id;
  }
  const id = str(row.ItemId);
  if (!isLiveProductRow(row) || w.edited(row, schema)) {
    w.kept.push(what);
    return null;
  }
  const patch = changed(row, fields);
  if (Object.keys(patch).length) await run.update(schema, id, patch);
  w.out(schema, id);
  return id;
}

/** Requirements and features: matched by key among the documented rows; the ones no longer planned are dropped. */
async function writeKeyed(
  w: Writes,
  schema: "Requirement" | "Feature",
  rows: Row[],
  planned: readonly { key: string; fields: Row }[],
  insertOnly: (key: string, i: number) => Row,
): Promise<Map<string, string>> {
  const run = w.run;
  const mine = rows.filter(isLiveProductRow);
  const taken = new Set(rows.map((r) => str(r.Key)));
  const claimed = new Set<string>();
  const keyOf = new Map<string, string>();
  for (const [i, p] of planned.entries()) {
    const hit = mine.find((r) => !claimed.has(str(r.ItemId)) && str(r.Key) === p.key) ?? mine.find((r) => !claimed.has(str(r.ItemId)) && str(r.Key).replace(/-\d+$/, "") === p.key);
    if (hit) {
      claimed.add(str(hit.ItemId));
      keyOf.set(p.key, str(hit.Key));
      if (w.edited(hit, schema)) {
        w.kept.push(`${schema} ${str(hit.Key)}`);
        continue;
      }
      const patch = changed(hit, p.fields);
      if (Object.keys(patch).length) await run.update(schema, str(hit.ItemId), patch);
      w.out(schema, str(hit.ItemId));
      continue;
    }
    const key = freeKey(p.key, taken);
    taken.add(key);
    keyOf.set(p.key, key);
    const id = await run.insert(schema, { ...insertOnly(key, i), Key: key, ...p.fields, ...ORIGIN }, `${schema.toLowerCase()}-${p.key}`);
    w.out(schema, id);
  }
  for (const r of mine) {
    if (claimed.has(str(r.ItemId)) || str(r.Status) === "dropped" || w.edited(r, schema)) continue;
    await run.update(schema, str(r.ItemId), { Status: "dropped" });
    w.out(schema, str(r.ItemId));
  }
  return keyOf;
}

async function writeRequirements(w: Writes, plan: DocumentationPlan): Promise<Map<string, string>> {
  const rows = w.run.p.rows("Requirement");
  let next = rows.reduce((m, r) => Math.max(m, num(r.Number)), 0) + 1;
  return writeKeyed(
    w,
    "Requirement",
    rows,
    plan.requirements.map((r, i) => ({
      key: r.key,
      fields: { Title: r.Title.slice(0, 200), Text: r.Text.slice(0, 10_000), Category: r.Category, Priority: "must", Status: "confirmed", AcceptanceCriteria: r.AcceptanceCriteria, SourceRefs: r.SourceRefs, SortOrder: (i + 1) * 1000 },
    })),
    () => ({ Number: next++, SpecVersion: 1 }),
  );
}

/** The scope version, the features and the milestones; skipped when the version holds the Factory's own scope. */
async function writeScope(w: Writes, plan: DocumentationPlan, reqKeys: Map<string, string>): Promise<boolean> {
  const run = w.run;
  const version = run.p.scopeVersion;
  const sv = run.p.scopeVersionRow(version);
  const features = run.p.features(version);
  if ((sv && !isLiveProductRow(sv)) || features.some((f) => !isLiveProductRow(f))) {
    w.kept.push("the scope (your team's own)");
    return false;
  }
  await upsertOne(w, "ScopeVersion", sv, { Title: plan.scope.Title, Summary: plan.scope.Summary, ...(plan.scope.SuccessTargets ? { SuccessTargets: plan.scope.SuccessTargets } : {}) }, { Number: version, Status: "locked", EngineJobId: run.id }, "scope-version", "the scope version");
  const featureKeys = await writeKeyed(
    w,
    "Feature",
    features,
    plan.features.map((f, i) => ({
      key: f.key,
      fields: { Title: f.Title.slice(0, 200), Description: f.Description.slice(0, 5000), Priority: "must", Status: "planned", RequirementRefs: reqKeys.has(f.requirement) ? [`requirement:${reqKeys.get(f.requirement)}`] : [], SortOrder: (i + 1) * 1000 },
    })),
    () => ({ ScopeVersion: version }),
  );
  // milestones: by position among the documented ones (they carry no builds); numbers stay with their rows
  const all = run.p.milestones(version);
  const mine = all.filter(isLiveProductRow).sort((a, b) => num(a.SortOrder) - num(b.SortOrder) || num(a.Number) - num(b.Number));
  const taken = new Set(all.map((m) => num(m.Number)));
  const freeNumber = () => {
    for (let n = 1; n <= 100; n++) if (!taken.has(n)) return n;
    return 0;
  };
  for (const [i, m] of plan.milestones.entries()) {
    const fields: Row = {
      Name: m.Name.slice(0, 120),
      Goal: m.Goal.slice(0, 2000),
      FeatureRefs: m.features.map((k) => featureKeys.get(k)).filter((k): k is string => Boolean(k)).map((k) => `feature:${k}`),
      Status: m.Status,
      SortOrder: (i + 1) * 1000,
    };
    const row = mine[i];
    if (row) {
      if (w.edited(row, "Milestone")) {
        w.kept.push(`milestone ${str(row.Number)}`);
        continue;
      }
      const patch = changed(row, fields);
      if (Object.keys(patch).length) await run.update("Milestone", str(row.ItemId), patch);
      w.out("Milestone", str(row.ItemId));
      continue;
    }
    const n = freeNumber();
    if (!n) break;
    taken.add(n);
    const id = await run.insert("Milestone", { ScopeVersion: version, Number: n, PreviewPoint: "", EngineJobId: run.id, ...fields, ...ORIGIN }, `milestone-${i}`);
    w.out("Milestone", id);
  }
  for (const row of mine.slice(plan.milestones.length)) {
    if (w.edited(row, "Milestone")) continue;
    await run.remove("Milestone", str(row.ItemId));
  }
  return true;
}

/** Workflows, constraints and exclusions: by position per kind among the documented ones; extra ones are removed. */
async function writeExtras(w: Writes, plan: DocumentationPlan): Promise<void> {
  const run = w.run;
  const rows = run.p.rows("RequirementExtra").filter((r) => isLiveProductRow(r) && str(r.Status) !== "removed");
  for (const kind of ["workflow", "constraint", "exclusion"] as const) {
    const mine = rows.filter((r) => r.Kind === kind).sort((a, b) => num(a.SortOrder) - num(b.SortOrder));
    const planned = plan.extras.filter((e) => e.kind === kind && e.title);
    for (const [i, e] of planned.entries()) {
      const fields: Row = { Kind: kind, Title: e.title, Who: kind === "workflow" ? e.who : "", Steps: kind === "workflow" ? e.steps : [], ConstraintKind: kind === "constraint" ? e.constraintKind || "other" : "", SortOrder: 1000 + i, Status: "active" };
      const row = mine[i];
      if (row) {
        if (w.edited(row, "RequirementExtra")) continue;
        const patch = changed(row, fields);
        if (Object.keys(patch).length) await run.update("RequirementExtra", str(row.ItemId), patch);
        w.out("RequirementExtra", str(row.ItemId));
        continue;
      }
      const id = await run.insert("RequirementExtra", { ...fields, ...ORIGIN }, `extra-${kind}-${i}`);
      w.out("RequirementExtra", id);
    }
    for (const row of mine.slice(planned.length)) {
      if (w.edited(row, "RequirementExtra")) continue;
      await run.update("RequirementExtra", str(row.ItemId), { Status: "removed" });
      w.out("RequirementExtra", str(row.ItemId));
    }
  }
}

/** The environments' releases the Factory has not recorded (a stage the product reached before it was attached). The
 *  Factory's own release rows are never changed; a dev release is added only when the project has none at all. */
async function writeReleases(w: Writes, plan: DocumentationPlan): Promise<void> {
  const run = w.run;
  const rels = run.p.releases();
  for (const r of plan.releases) {
    const env = rels.filter((x) => str(x.Environment) === r.environment);
    const same = env.find((x) => str(x.Version) === r.version);
    if (same) {
      if (isLiveProductRow(same)) {
        const patch = changed(same, { ...(r.url ? { Url: r.url } : {}), ...(r.commit ? { SourceCommit: r.commit } : {}) });
        if (Object.keys(patch).length) await run.update("Release", str(same.ItemId), patch);
        w.out("Release", str(same.ItemId));
      }
      continue;
    }
    if (env.some((x) => !isLiveProductRow(x))) continue;
    const id = await run.insert("Release", {
      Environment: r.environment, Version: r.version, Url: r.url, Status: "released", ChangeRequestIds: [], SourceCommit: r.commit,
      EngineJobId: run.id, ReleasedByUserId: "", ...ORIGIN,
    }, `release-${r.environment}-${r.version}`);
    w.out("Release", id);
  }
}

/** The project's own fields: a field is filled in when it is empty, or refreshed while it still holds what an earlier
 *  documentation wrote; a person's own text stays. Answers the patch and the fields the documentation now holds. */
export function profilePatch(project: Row, planned: DocumentationPlan["profile"], before: Record<string, string>): { patch: Row; written: Record<string, string> } {
  const patch: Row = {};
  const written: Record<string, string> = {};
  for (const f of PROFILE_FIELDS) {
    const value = planned[f];
    const cur = str(project[f]).trim();
    const ours = before[f] !== undefined && cur === before[f];
    if (!value) {
      if (ours && cur) written[f] = cur; // nothing new to say: what it wrote before stays
      continue;
    }
    if (cur && !ours) continue;
    if (cur !== value) patch[f] = value;
    written[f] = value;
  }
  return { patch, written };
}

/** The modules, with Claude's answer when there is one, else the code's own screen folders. */
async function modulesOf(run: JobRun, s: ProductSources, ctx: { sources: string; evidence: string[]; terms: ReturnType<typeof termsOf> }): Promise<ModulesAnswer | null> {
  if (!s.candidates.length) return null;
  return aiJson<ModulesAnswer>(run, {
    task: "document modules",
    role: `You are the product manager of ${run.p.name}, a product that is live.`,
    prompt: modulesPrompt({ name: run.p.name, sources: ctx.sources, candidates: candidatesText(s.candidates), map: s.map }),
    schema: modulesSchema(s.candidates.map((c) => c.key), ctx.evidence),
    accept: (raw) => acceptModules(raw, { candidates: s.candidates, evidence: ctx.evidence, terms: ctx.terms }),
    timeoutMs: 180_000,
    // without an answer the modules are the code's own screen folders (real, not invented)
    orNull: true,
  });
}

async function documentProduct(run: JobRun): Promise<KindResult> {
  await run.step(3, "Reading the live product's registry and code.");
  const refusal = documentRefusal(run.p.project, run.p.releases());
  if (refusal) throw new JobFailure(DOCUMENT_REFUSAL_TEXT[refusal], `document.${refusal}`);
  let madp = "";
  try {
    madp = appDir(run);
  } catch {
    throw new JobFailure(NO_CODE, "document.noCode");
  }
  const state = productState(madp);
  if (!state.existing) throw new JobFailure(NOT_ATTACHED, "document.notAttached");
  const project = run.p.project;
  const devUrl = state.url || [str(project.AppUrl), str(project.BlocksProjectDomain)].map((u) => u.replace(/\/+$/, "")).find((u) => /^https:\/\/[^\s/]+/.test(u)) || "";
  const sources = await readProductSources(madp, { name: state.name || appName(run.p.name, run.projectId), devUrl });
  if (!sources) throw new JobFailure(NO_CODE, "document.noCode");
  run.log(`document: ${sources.repos.map((r) => `${r.key} ${r.files} files`).join(", ")}; ${sources.candidates.length} module candidates, ${sources.tables.length} data tables, ${sources.documents.length} documents, environments ${sources.environments.map((e) => `${e.environment}@${e.branch || "?"}`).join(" ")}, design ${sources.design ? "found" : "none"}`);
  await run.step(12, `Read ${sources.repos.length === 1 ? "1 repository" : `${sources.repos.length} repositories`}; reading the project's notes and files.`);

  const material = await projectMaterial(run, { files: true, budget: 12_000, fileMax: 4000, contextBudget: 0 });
  const terms = termsOf();
  const evidence = [...BASE_EVIDENCE, ...material.sources.keys()];
  const shared = sourcesText(sources);
  const candidates = candidatesText(sources.candidates);

  // the profile runs beside the modules; the phases need the modules
  const profileAsk = early(aiJson(run, {
    task: "document profile",
    role: `You are the business analyst of ${run.p.name}, a product that is live.`,
    prompt: profilePrompt({ name: run.p.name, sources: shared, candidates, material: material.text }),
    schema: profileSchema(evidence, sources.candidates.map((c) => c.key)),
    accept: (raw) => acceptProfile(raw, { evidence, moduleKeys: sources.candidates.map((c) => c.key), terms }),
    timeoutMs: 180_000,
    // without an answer no profile is written
    orNull: true,
  }));
  await run.step(20, `Grouping the code into the product's modules (${sources.candidates.length} folders and routes).`);
  const modules = await modulesOf(run, sources, { sources: shared, evidence, terms });
  const moduleList = modules?.modules ?? fallbackModules(sources.candidates, Object.fromEntries(sources.repos.map((r) => [r.key, r.role])));
  const byKey = new Map(sources.candidates.map((c) => [c.key, c]));
  const seen = await firstSeen(sources, moduleList.map((m) => ({ key: m.key, parts: m.parts.flatMap((k) => byKey.get(k)?.parts ?? []) })));
  await run.step(45, "Putting the modules into the phases the product was built in.");
  const phases = moduleList.length
    ? await aiJson(run, {
        task: "document phases",
        role: `You are the delivery lead of ${run.p.name}, a product that is live.`,
        prompt: phasesPrompt({
          name: run.p.name,
          modules: moduleList.map((m) => `- ${m.key}: ${m.title}${seen.get(m.key) ? ` (first seen ${seen.get(m.key)!.slice(0, 10)})` : ""}`).join("\n"),
          tags: sources.tags.map((t) => `- ${t.repo} ${t.name} ${t.at.slice(0, 10)}`).join("\n"),
          material: material.text.slice(0, 8000),
        }),
        schema: phasesSchema(moduleList.map((m) => m.key)),
        accept: (raw) => acceptPhases(raw, { moduleKeys: moduleList.map((m) => m.key), terms }),
        timeoutMs: 120_000,
        // without an answer no phases are written
        orNull: true,
      })
    : null;
  const profile = await profileAsk;
  run.log(`document: answers: profile ${profile ? "used" : "none"}, modules ${modules ? `${modules.modules.length} used` : `none (${moduleList.length} from the code)`}, phases ${phases ? phases.phases.length : "none"}`);

  const refOf = (e: string): string => {
    const src = material.sources.get(e);
    return src ? `${src.type}:${src.id}` : e === "registry" || e === "code" || e === "readme" ? `live-product:${e}` : "";
  };
  const plan = planDocumentation({
    productName: run.p.name, sources, profile, modules: modules ?? { modules: moduleList, crossCutting: [] }, phases, firstSeen: seen,
    changes: run.p.rows("ChangeRequest"), refOf, terms,
  });
  run.writeJobFile("plan.json", plan);

  const w = new Writes(run);
  await run.step(60, "Writing the objective and the requirements, one per module.");
  await upsertOne(w, "Objective", run.p.rows("Objective")[0], plan.objective, { SpecVersion: 1, Status: "confirmed" }, "objective", "the objective");
  const reqKeys = await writeRequirements(w, plan);
  await run.step(72, "Writing the key workflows and the constraints.");
  await writeExtras(w, plan);
  await run.step(80, "Writing the modules and the milestones: the phases first, then the change requests.");
  const scoped = await writeScope(w, plan, reqKeys);
  await run.step(88, plan.design ? "Recording the existing design system." : "Recording the environments.");
  if (plan.design) await upsertOne(w, "DesignBrief", run.p.rows("DesignBrief")[0], { Mode: "describe", Instructions: plan.design.Instructions, PrototypeJson: plan.design.PrototypeJson, Status: "confirmed" }, { References: [], SampleFileIds: [] }, "design-brief", "the look and feel");
  await writeReleases(w, plan);

  // the project's profile and the snapshot of what was read
  const before = parseLiveProductSnapshot(project.LiveProductJson);
  const { patch, written } = profilePatch(run.p.project, plan.profile, before?.profile ?? {});
  const leftEmpty = [...plan.leftEmpty, ...(scoped ? [] : ["The modules and milestones: the project has a scope of its own, which stays as it is."])];
  const snapshot = snapshotOf({
    plan, sources, documentedAt: run.iso(), jobId: run.id, releases: run.p.releases(),
    material: { notes: run.p.notes().length, files: run.p.files().length }, profile: written, leftEmpty,
  });
  const profileChanged = Object.keys(patch).length > 0;
  await run.update("Project", run.projectId, { ...patch, LiveProductJson: JSON.stringify(snapshot), ...(profileChanged ? { Rev: num(run.p.project.Rev) + 1 } : {}) });
  w.out("Project", run.projectId);

  // the Wiki and Produced, rebuilt from the records (the records are written already: a rebuild that cannot be queued
  // is logged, and people start it from the Wiki or Produced)
  await run.step(96, "Asking for the wiki and the project documentation to be rebuilt.");
  let rebuilt = 0;
  for (const [kind, input] of [["wiki.generate", wikiJobInput(run.projectId)], ["docs.generate", { projectId: run.projectId }]] as const) {
    try {
      w.out("EngineJob", await run.queueJob({ kind, input, requestKey: run.key(kind === "wiki.generate" ? "wiki" : "docs") }));
      rebuilt += 1;
    } catch (e) {
      if (e instanceof JobGone) throw e;
      run.log(`document: ${kind} was not queued (${e instanceof Error ? e.message.slice(0, 160) : "error"})`);
    }
  }
  if (w.kept.length) run.log(`document: kept as people wrote them: ${w.kept.join(", ")}`);

  const reqs = plan.requirements.length;
  const mods = plan.modules.length;
  return {
    outputs: w.outputs,
    message: `Documented the live product: ${mods === 1 ? "1 module" : `${mods} modules`}, ${reqs === 1 ? "1 requirement" : `${reqs} requirements`}, ${plan.milestones.length === 1 ? "1 milestone" : `${plan.milestones.length} milestones`}${plan.design ? " and the design system" : ""}.${rebuilt ? " The wiki is being rebuilt." : ""}`,
  };
}

export const WRITERS: Partial<Record<EngineJobKind, KindWriter>> = {
  "product.document": documentProduct,
};
