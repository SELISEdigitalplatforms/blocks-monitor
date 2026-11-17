// What the collaboration writers (agent chat, assistant, bug analysis, wiki) know about a project: the locked scope,
// the board, the builds, the releases and the decisions, read from the project's current rows. Pure reads.
import type { Row } from "../../../../../functions/_lib/gateway";
import { changeCode } from "../../../../../src/domain/delivery";
import { briefFactsOf } from "../../../../../src/domain/projectBrief";
import { num, str, strs, type ProjectView } from "../../context.ts";
import { slugOf, wordsOf } from "../../text.ts";

export interface FeatureFact {
  id: string;
  key: string;
  ref: string;
  title: string;
  description: string;
  priority: string;
  requirementKeys: string[];
  stories: StoryFact[];
  milestone: MilestoneFact | null;
}

export interface StoryFact {
  id: string;
  key: string;
  title: string;
  text: string;
  actor: string;
  criteria: string[];
  hours: number;
}

export interface MilestoneFact {
  id: string;
  number: number;
  name: string;
  goal: string;
  status: string;
  featureRefs: string[];
  previewPoint: string;
}

export interface TicketFact {
  id: string;
  number: number;
  title: string;
  column: string;
  agentRole: string;
  milestoneId: string;
  isDone: boolean;
  hours: number;
  featureRef: string;
  changeRequestId: string;
  /** Ticket.ItemIds this ticket waits for (the board plan's dependencies). */
  dependsOn: string[];
  type: string;
  description: string;
  acceptance: string[];
}

export interface ReleaseFact {
  id: string;
  env: string;
  version: string;
  releasedAt: string;
  changeRequestIds: string[];
}

export interface ChangeFact {
  id: string;
  number: number;
  code: string;
  lane: string;
  title: string;
  description: string;
  status: string;
  version: string;
  featureRef: string;
}

export interface CollabFacts {
  projectId: string;
  name: string;
  client: string;
  brief: string;
  stage: string;
  existing: boolean;
  repo: { owner: string; name: string; branch: string };
  objective: Row | undefined;
  features: FeatureFact[];
  milestones: MilestoneFact[];
  tickets: TicketFact[];
  releases: ReleaseFact[];
  changes: ChangeFact[];
  requirements: Row[];
  decisions: Row[];
  techDecisions: Row[];
  clarifications: Row[];
  previews: Row[];
  buildJobs: Row[];
  screens: Row[];
  /** Stack words (java, dotnet, php, python, react, …) found in the tech decisions and the architecture. */
  stack: string;
}

const ENV_ORDER = ["production", "stage", "dev"];

/** "1.10.0" > "1.9.2". */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => Number(x) || 0);
  const pb = b.split(".").map((x) => Number(x) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function stackOf(texts: string[]): string {
  const t = texts.join(" ").toLowerCase();
  if (/\bjava\b|spring/.test(t)) return "java";
  if (/\.net\b|\bc#|dotnet|asp\.net/.test(t)) return "dotnet";
  if (/\bphp\b|laravel|symfony/.test(t)) return "php";
  if (/\bpython\b|django|fastapi/.test(t)) return "python";
  return "ts";
}

export function loadFacts(p: ProjectView): CollabFacts {
  const version = p.scopeVersion;
  const milestones: MilestoneFact[] = p.milestones(version).map((m) => ({
    id: str(m.ItemId),
    number: num(m.Number),
    name: str(m.Name),
    goal: str(m.Goal),
    status: str(m.Status) || "planned",
    featureRefs: strs(m.FeatureRefs),
    previewPoint: str(m.PreviewPoint),
  }));
  const msOf = (ref: string) => milestones.find((m) => m.featureRefs.includes(ref)) ?? null;
  const features: FeatureFact[] = p.includedFeatures(version).map((f) => {
    const key = str(f.Key);
    const ref = `feature:${key}`;
    return {
      id: str(f.ItemId),
      key,
      ref,
      title: str(f.Title),
      description: str(f.Description),
      priority: str(f.Priority),
      requirementKeys: strs(f.RequirementRefs).map((r) => r.replace(/^requirement:/, "")),
      stories: p.storiesOf(key, version).map((s) => ({
        id: str(s.ItemId),
        key: str(s.Key),
        title: str(s.Title),
        text: str(s.Text),
        actor: str(s.ActorRole),
        criteria: strs(s.AcceptanceCriteria),
        hours: num(s.EstimateHours),
      })),
      milestone: msOf(ref),
    };
  });
  const tickets: TicketFact[] = p.tickets().map((t) => ({
    id: str(t.ItemId),
    number: num(t.Number),
    title: str(t.Title),
    column: str(t.Column),
    agentRole: str(t.AgentRole),
    milestoneId: str(t.MilestoneId),
    isDone: t.IsDone === true || t.Column === "done",
    hours: num(t.EstimateHours),
    featureRef: str(t.FeatureRef),
    changeRequestId: str(t.ChangeRequestId),
    dependsOn: strs(t.DependsOn),
    type: str(t.TicketType),
    description: str(t.Description),
    acceptance: strs(t.Acceptance),
  }));
  const releases: ReleaseFact[] = p
    .releases()
    .filter((r) => r.Status === undefined || r.Status === "released")
    .map((r) => ({ id: str(r.ItemId), env: str(r.Environment), version: str(r.Version), releasedAt: str(r.ReleasedAt), changeRequestIds: strs(r.ChangeRequestIds) }))
    .filter((r) => r.version !== "");
  const changes: ChangeFact[] = p.changeRequests().map((c) => {
    const lane = str(c.Lane) || "change";
    const number = num(c.Number);
    return {
      id: str(c.ItemId),
      number,
      code: changeCode({ lane, number }),
      lane,
      title: str(c.Title),
      description: str(c.Description),
      status: str(c.Status),
      version: str(c.Version),
      featureRef: str(c.FeatureRef),
    };
  });
  const objective = p.objective();
  const techDecisions = p.techDecisions().filter((t) => t.Status !== "rejected");
  return {
    projectId: p.id,
    name: p.name,
    client: p.client,
    brief: briefFactsOf(p).description,
    stage: str(p.project.Stage),
    existing: p.existingProduct,
    repo: p.repo,
    objective,
    features,
    milestones,
    tickets,
    releases,
    changes,
    requirements: p.requirements(),
    decisions: p.decisions(),
    techDecisions,
    clarifications: p.clarifications(),
    previews: p.rows("Preview"),
    buildJobs: p
      .rows("EngineJob")
      .filter((j) => j.Kind === "build.run" || j.Kind === "change.build")
      .sort((a, b) => str(b.CreatedDate).localeCompare(str(a.CreatedDate))),
    screens: p.screens(),
    stack: stackOf([...techDecisions.map((t) => `${str(t.Title)} ${str(t.Choice)}`), str(objective?.ArchitectureMd)]),
  };
}

/** The newest release of an environment. */
export function latestRelease(f: CollabFacts, env: string): ReleaseFact | null {
  return [...f.releases.filter((r) => r.env === env)].sort((a, b) => compareVersions(b.version, a.version) || b.releasedAt.localeCompare(a.releasedAt))[0] ?? null;
}

/** The version the product is "at": the newest production release, else stage, else dev; null before any release. */
export function productVersion(f: CollabFacts): string | null {
  for (const env of ENV_ORDER) {
    const r = latestRelease(f, env);
    if (r) return r.version;
  }
  return null;
}

/** Environments that run a release, the given one first. */
export function environmentsWith(f: CollabFacts, first: string): string[] {
  const have = ENV_ORDER.filter((e) => f.releases.some((r) => r.env === e));
  return [...new Set([first, ...have])].filter((e) => have.includes(e) || e === first);
}

/** The locked features the scope's milestones carry (the ones a fix may name). */
export function lockedFeatureRefs(f: CollabFacts): string[] {
  return [...new Set(f.milestones.flatMap((m) => m.featureRefs))];
}

/** The best matching feature for a text (title, description, stories), or null when nothing overlaps. */
/** Words that say nothing about which feature is meant. */
const GENERIC = new Set(
  "handle handled handling file files work works working use used using make made show shown see get way thing things app application system project happen happens happened possible able want need like just good quality question answer explain tell know think could would should does done able".split(" "),
);

/** The words of a question that can point at a feature. */
export function keyWords(text: string): Set<string> {
  return new Set([...wordsOf(text)].filter((w) => !GENERIC.has(w)));
}

/** The best matching feature for a text (title 3, story titles 2, the rest 1 per shared word), or null. */
export function matchFeature(f: CollabFacts, text: string, among?: readonly string[]): { feature: FeatureFact; score: number } | null {
  // The roles (driver, customer, …) appear in most stories: they don't tell features apart.
  const actors = wordsOf(f.features.flatMap((x) => x.stories.map((s) => s.actor)).join(" "));
  const words = new Set([...keyWords(text)].filter((w) => !actors.has(w)));
  let best: { feature: FeatureFact; score: number } | null = null;
  for (const feat of f.features) {
    if (among && !among.includes(feat.ref)) continue;
    const title = wordsOf(feat.title);
    const storyTitles = wordsOf(feat.stories.map((s) => s.title).join(" "));
    const body = wordsOf([feat.description, ...feat.stories.map((s) => `${s.text} ${s.criteria.join(" ")}`)].join(" "));
    let score = 0;
    for (const w of words) {
      if (title.has(w)) score += 3;
      else if (storyTitles.has(w)) score += 2;
      else if (body.has(w)) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { feature: feat, score };
  }
  return best;
}

/** The best matching story of a feature for a text (title 2, text and criteria 1 per shared word). */
export function matchStory(feat: FeatureFact, text: string): StoryFact | null {
  const words = keyWords(text);
  let best: StoryFact | null = null;
  let bestScore = 0;
  for (const s of feat.stories) {
    const tw = wordsOf(s.title);
    const sw = wordsOf(`${s.text} ${s.criteria.join(" ")}`);
    let score = 0;
    for (const w of words) score += tw.has(w) ? 2 : sw.has(w) ? 1 : 0;
    if (score > bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

/** The change request that best matches a text (two shared words at least). */
export function matchChange(f: CollabFacts, text: string): ChangeFact | null {
  const words = keyWords(text);
  let best: ChangeFact | null = null;
  let bestScore = 0;
  for (const c of f.changes) {
    const tw = wordsOf(c.title);
    const dw = wordsOf(c.description);
    let score = 0;
    let inTitle = 0;
    for (const w of words) {
      if (tw.has(w)) inTitle += 1;
      score += tw.has(w) ? 2 : dw.has(w) ? 1 : 0;
    }
    if ((inTitle > 0 || score >= 4) && score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

/** The decision (Decision or TechDecision) that best matches a text, with at least two shared words. */
export function matchDecision(f: CollabFacts, text: string): { title: string; statement: string; rationale: string; id: string; tech: boolean } | null {
  const words = wordsOf(text);
  let best: { title: string; statement: string; rationale: string; id: string; tech: boolean; score: number } | null = null;
  const consider = (title: string, statement: string, rationale: string, id: string, tech: boolean) => {
    const dw = wordsOf(`${title} ${statement} ${rationale}`);
    let score = 0;
    for (const w of words) if (dw.has(w)) score += 1;
    if (score >= 2 && (!best || score > best.score)) best = { title, statement, rationale, id, tech, score };
  };
  for (const d of f.decisions) consider(str(d.Title), str(d.Statement), str(d.Rationale), str(d.ItemId), false);
  for (const t of f.techDecisions) consider(str(t.Title), str(t.Choice), str(t.Rationale), str(t.ItemId), true);
  return best;
}

const camel = (s: string): string => s.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
const pascal = (s: string): string => {
  const c = camel(s);
  return c ? c[0]!.toUpperCase() + c.slice(1) : c;
};

/** The topic of a bug or question, for file names and causes. */
export type CodeArea = "upload" | "sync" | "pdf" | "signature" | "time" | "money" | "mail" | "auth" | "list" | "status" | "import" | "form" | "screen";

export function codeAreaOf(text: string): CodeArea {
  const t = text.toLowerCase().replace(/\b(?:which|what|in which|the) files?\b|\bcode\b/g, " ");
  if (/\b(photo|photos|image|picture|upload|attachment|file|scan|camera)\b/.test(t)) return "upload";
  if (/\b(offline|sync|signal|connection|network|queue|duplicate|twice)\b/.test(t)) return "sync";
  if (/\b(pdf|report|print|statement|document)\b/.test(t)) return "pdf";
  if (/\b(sign|signs|signed|signature)\b/.test(t)) return "signature";
  if (/\b(date|time|timezone|hour|hours|clock|yesterday|tomorrow|deadline|expiry|expires|expired)\b/.test(t)) return "time";
  if (/\b(price|prices|total|sum|amount|vat|chf|eur|discount|invoice|cost|rounding)\b/.test(t)) return "money";
  if (/\b(e-?mail|mail|notification|reminder|message)\b/.test(t)) return "mail";
  if (/\b(log ?in|sign ?in|password|session|logged out|access|permission|role)\b/.test(t)) return "auth";
  if (/\b(list|search|filter|sort|order|missing from|not shown|empty|disappeared)\b/.test(t)) return "list";
  if (/\b(status|state|stuck|still shows|not updated)\b/.test(t)) return "status";
  if (/\b(import|export|erp|csv|excel|interface)\b/.test(t)) return "import";
  if (/\b(field|form|save|saving|input|validation|required)\b/.test(t)) return "form";
  return "screen";
}

const AREA_FILE: Record<CodeArea, { web: string; api: string; test: string }> = {
  upload: { web: "photoUpload", api: "attachmentStore", test: "photoUpload" },
  sync: { web: "syncQueue", api: "statusChanges", test: "syncQueue" },
  pdf: { web: "reportPreview", api: "reportPdf", test: "reportPdf" },
  signature: { web: "SignaturePad", api: "signOff", test: "signOff" },
  time: { web: "dateFormat", api: "schedule", test: "dateFormat" },
  money: { web: "priceSummary", api: "priceCalculation", test: "priceCalculation" },
  mail: { web: "notificationSettings", api: "notificationMailer", test: "notificationMailer" },
  auth: { web: "useSession", api: "accessPolicy", test: "accessPolicy" },
  list: { web: "List", api: "query", test: "query" },
  status: { web: "statusLabel", api: "statusTransitions", test: "statusTransitions" },
  import: { web: "importResult", api: "erpInterface", test: "erpInterface" },
  form: { web: "Form", api: "validation", test: "validation" },
  screen: { web: "Screen", api: "service", test: "service" },
};

export interface CodePaths {
  web: string;
  api: string;
  test: string;
}

/** Plausible repository paths of a feature's code for a topic, in the project's stack. */
export function codePaths(f: CollabFacts, featureKey: string, area: CodeArea): CodePaths {
  const folder = slugOf(featureKey, 30);
  const files = AREA_FILE[area];
  const component = /^[A-Z]/.test(files.web) && files.web !== "SignaturePad" ? `${pascal(folder)}${files.web}` : files.web;
  const webExt = /^[A-Z]/.test(component) ? "tsx" : "ts";
  const web = `web/src/${folder}/${component}.${webExt}`;
  const apiName = files.api === "service" || files.api === "query" || files.api === "validation" ? `${camel(folder)}${pascal(files.api)}` : files.api;
  let api: string;
  let test: string;
  switch (f.stack) {
    case "java": {
      const pkg = `${slugOf(f.repo.owner || f.name, 20).replace(/-/g, "")}`;
      api = `api/src/main/java/com/${pkg}/${folder.replace(/-/g, "")}/${pascal(apiName)}.java`;
      test = `api/src/test/java/com/${pkg}/${folder.replace(/-/g, "")}/${pascal(apiName)}Test.java`;
      break;
    }
    case "dotnet":
      api = `src/Api/${pascal(folder)}/${pascal(apiName)}.cs`;
      test = `tests/Api.Tests/${pascal(folder)}/${pascal(apiName)}Tests.cs`;
      break;
    case "php":
      api = `app/${pascal(folder)}/${pascal(apiName)}.php`;
      test = `tests/${pascal(folder)}/${pascal(apiName)}Test.php`;
      break;
    case "python":
      api = `api/${folder.replace(/-/g, "_")}/${apiName.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}.py`;
      test = `api/tests/test_${apiName.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}.py`;
      break;
    default:
      api = `api/src/${folder}/${apiName}.ts`;
      test = `api/src/${folder}/${apiName}.test.ts`;
  }
  return { web, api, test };
}

/** The active or newest build of the project. */
export function currentBuild(f: CollabFacts): Row | null {
  return f.buildJobs.find((j) => ["queued", "claimed", "running"].includes(str(j.Status))) ?? f.buildJobs[0] ?? null;
}

/** The milestone being built now (else the next planned one). */
export function activeMilestone(f: CollabFacts): MilestoneFact | null {
  return f.milestones.find((m) => m.status === "building") ?? f.milestones.find((m) => m.status === "planned") ?? null;
}
