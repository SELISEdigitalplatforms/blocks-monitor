// The Claude part of change.analyse (../changes.ts): the ask (the project's material and context digest, its facts, the
// locked scope with its stories and milestones, the screens, the change request itself and, on a refine, the questions
// already answered), the answer's JSON schema, and the check that turns the answer into ChangeRequest.Analysis
// (src/domain/changeAnalysis.ts, the shape engine-host/CHANGE-PROCESS-31.10.md fixes). Pure, except projectMaterial.
//
// When the product's code is on the engine host (official/fileMap.ts productCode: its registry, repositories and FILE
// MAP), the ask also carries "The product's code" and the answer names the files and folders the change lands in
// (codeAreas, checked against the map) and the existing behaviour at risk. Without it, the ask is the same as before.
//
// A product without a Factory scope (an existing product attached as it is live: no locked features) has no scope to
// clash with: the ask judges the request against what the product does today, and a new feature is planned as a feature
// delivery on the existing product (route "feature"): more tickets than a change, each in an increment (milestone-like
// builds, each deployed to dev and tried before the next), the parts it changes (API, web, data), its code areas and
// risks. A product with a scope keeps the ask and the Scope & success route exactly as before.
import type { Row } from "../../../../../functions/_lib/gateway";
import { pathInMap, type ProductCode } from "../../official/fileMap.ts";
import {
  CHANGE_ANALYSIS_LIMITS,
  CHANGE_KINDS,
  FEATURE_DELIVERY_LIMITS,
  changeRouteFor,
  parseChangeAnalysis,
  splitIncrements,
  type ChangeAnalysis,
  type ChangeAnalysisQuestion,
} from "../../../../../src/domain/changeAnalysis";
import { changeCode } from "../../../../../src/domain/delivery";
import { str, strs, type ProjectView } from "../../context.ts";
import { isLiveProductRow } from "../../../../../src/domain/liveProduct";
import { STAGED, obj } from "../../ai/check.ts";

export const MAX_QUESTIONS = CHANGE_ANALYSIS_LIMITS.questions; // 3
const MAX_TICKETS = 6;
/** A feature on an existing product: up to 18 tickets in up to 4 proposed increments of at most 6 tickets each. */
export const MAX_FEATURE_TICKETS = FEATURE_DELIVERY_LIMITS.tickets;
export const MAX_INCREMENTS = FEATURE_DELIVERY_LIMITS.proposedIncrements;

/** True when the project has a Factory scope (locked features). An existing product attached as it is live has none:
 *  its change requests are about the product as a whole and a new feature is built on it (route "feature"). The
 *  modules documented from the live product (product.document, Origin "live-product") describe what is built; they are
 *  no scope to route a change through. */
export const hasFactoryScope = (p: ProjectView): boolean => p.includedFeatures().some((f) => !isLiveProductRow(f));

const LANE_TEXT: Record<string, string> = {
  fix: "Fix: something does not work as the locked scope says",
  change: "Change feature: the business changed and the feature works differently now",
  enhance: "Enhance feature: a partial change or an addition to an existing feature",
  add: "Add feature: something new",
};

/** The names the analysis may name under "impact" (the project's own titles). */
export interface ChangeNames {
  features: string[];
  stories: string[];
  screens: string[];
  milestones: string[];
}

const uniq = (xs: string[]): string[] => {
  const out: string[] = [];
  for (const x of xs.map((s) => s.replace(/\s+/g, " ").trim()).filter(Boolean)) if (!out.some((o) => o.toLowerCase() === x.toLowerCase())) out.push(x);
  return out;
};

export function changeNames(p: ProjectView): ChangeNames {
  const features = p.includedFeatures();
  return {
    features: uniq(features.map((f) => str(f.Title))),
    stories: uniq(features.flatMap((f) => p.storiesOf(str(f.Key)).map((s) => str(s.Title)))),
    screens: uniq(p.screens().map((s) => str(s.Name))),
    milestones: uniq(p.milestones().map((m) => str(m.Name))),
  };
}

const one = (s: string, max: number): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).replace(/\s+\S*$/, "")}…`;
};

/** The locked scope as the analysis reads it: features with their stories and checks, what is left out, the milestones
 *  and the screens (pure). */
export function scopeText(p: ProjectView): string {
  const out: string[] = [];
  const features = p.includedFeatures();
  if (!features.length && p.features().length === 0) {
    out.push("Locked scope: none. The product came to the Factory as an existing product that is already live: what it does today is in its code and in what the client told us.");
  } else if (features.length) {
    out.push(`Locked scope (version ${p.scopeVersion}), features and their stories:\n${features
      .map((f) => {
        const stories = p.storiesOf(str(f.Key)).slice(0, 12).map((s) => {
          const ac = strs(s.AcceptanceCriteria).slice(0, 3);
          return `  - Story "${str(s.Title)}"${str(s.Text) ? `: ${one(str(s.Text), 200)}` : ""}${ac.length ? ` Checks: ${ac.map((a) => one(a, 120)).join("; ")}` : ""}`;
        });
        return `- Feature "${str(f.Title)}"${str(f.Priority) ? ` (${str(f.Priority)})` : ""}: ${one(str(f.Description), 300)}${stories.length ? `\n${stories.join("\n")}` : ""}`;
      })
      .join("\n")}`);
  } else {
    out.push("Locked scope: no features are locked yet.");
  }
  const dropped = p.features().filter((f) => f.Status === "dropped").map((f) => str(f.Title)).filter(Boolean);
  if (dropped.length) out.push(`Left out of the scope on purpose:\n${dropped.map((d) => `- ${d}`).join("\n")}`);
  const ms = p.milestones();
  if (ms.length) {
    const featureTitle = new Map(features.map((f) => [`feature:${str(f.Key)}`, str(f.Title)]));
    out.push(`Milestones:\n${ms
      .map((m) => {
        const fs = strs(m.FeatureRefs).map((r) => featureTitle.get(r) ?? featureTitle.get(`feature:${r}`) ?? "").filter(Boolean);
        return `- Milestone ${str(m.Number) || m.Number} "${str(m.Name)}" (${str(m.Status) || "planned"}): ${one(str(m.Goal), 200)}${fs.length ? ` Features: ${fs.join(", ")}` : ""}`;
      })
      .join("\n")}`);
  }
  const screens = p.screens();
  if (screens.length) out.push(`Screens of the design:\n${screens.slice(0, 40).map((s) => `- ${str(s.Name)}`).join("\n")}`);
  const others = p.changeRequests().filter((c) => !["draft", "rejected"].includes(str(c.Status)));
  if (others.length) {
    out.push(`Earlier change requests:\n${others.slice(-8).map((c) => `- ${changeCode({ lane: str(c.Lane), number: Number(c.Number) || 0 })} "${str(c.Title)}" (${str(c.Status)})`).join("\n")}`);
  }
  return out.join("\n\n");
}

/** The change request in plain lines (pure). */
export function requestText(p: ProjectView, cr: Row): string {
  const ref = str(cr.FeatureRef).replace(/^feature:/, "");
  const feature = ref ? p.features().find((f) => str(f.Key) === ref) : undefined;
  return [
    `Change request ${changeCode({ lane: str(cr.Lane), number: Number(cr.Number) || 0 })}: "${str(cr.Title)}"`,
    `Lane the person picked: ${LANE_TEXT[str(cr.Lane)] ?? str(cr.Lane)}`,
    `Feature it is about: ${feature ? `"${str(feature.Title)}"` : hasFactoryScope(p) ? "none named" : "the product as a whole (it has no locked scope)"}`,
    `What the person wrote:\n${str(cr.Description).trim().slice(0, 4000) || "(no description)"}`,
  ].join("\n");
}

const answeredOf = (prior: ChangeAnalysis | null): ChangeAnalysisQuestion[] => (prior ? prior.questions.filter((q) => q.answer !== null) : []);

/** How many new questions the answer may ask: at most 3 in all, answered ones included. */
export const questionSlots = (prior: ChangeAnalysis | null): number => Math.max(0, MAX_QUESTIONS - answeredOf(prior).length);

/** At most this many codeAreas in an answer. */
export const MAX_CODE_AREAS = 12;
const MAX_RULES = 20;

/** "The product's code" as the analysis reads it: what the product is, its repositories with their roles, the owner's
 *  standing rules for every change (registry agent_rules) and the FILE MAP (pure). */
export function codeText(code: ProductCode): string {
  const repos = code.repos.map((r) => `- \`${r.key}\`${r.role ? ` (${r.role})` : ""}${r.entries ? "" : ": its files could not be listed"}`);
  const rules = code.agentRules.slice(0, MAX_RULES).map((r) => `- ${one(r, 600)}`);
  return [
    "The product's code (what is built today, read from its repositories):",
    ...(code.description ? [`About the product: ${one(code.description, 300)}`] : []),
    `Repositories (their keys name them under codeAreas):\n${repos.join("\n")}`,
    ...(rules.length ? [`The owner's standing rules for this product (every change must keep them):\n${rules.join("\n")}`] : []),
    `FILE MAP (the tracked source files of each repository, one line per folder with each file's line count; paths are relative to the repository; "+k smaller" counts small files that are not named):\n${code.map}`,
  ].join("\n\n");
}

/** The "Decide:" lines for a product without a Factory scope: judged against what the product does today, and a new
 *  feature planned as a feature delivery on the existing product, in increments (pure). */
function existingProductRules(slots: number, code: ProductCode | null): string[] {
  const L = FEATURE_DELIVERY_LIMITS;
  return [
    `- kind: "fix" when something the product does today does not work as it should; "change" when an existing screen, report, document or workflow should work or look differently, or gets a small addition; "feature" when it is new work the product does not do today (a new module, workflow, kind of user, report, document or integration). Judge from what the product does today${code ? " (its code below)" : ""}, not only from the lane the person picked.`,
    "- scopeChange: always false. The product has no locked scope; nothing here goes through Scope & success.",
    "- summary: one or two plain sentences on what will change for the people who use the product.",
    "- impact: leave the lists empty (the product has no locked features, stories or milestones).",
    "- conflicts: where it clashes with what the product does today, one of the owner's standing rules or an answer the client gave earlier; empty when there is none.",
    `- risks: what could break or what needs care, plainly. Name the existing behaviour at risk${code ? ": the other screens, API routes, reports, documents or data that share the code it touches (from the file map), and any of the owner's standing rules it comes close to" : ""}. For a feature, also name data that must be migrated or kept consistent; empty when there is none.`,
    `- acceptanceCriteria: 2 to 6 checks a tester can run on the finished product, each one plain sentence (a feature: 3 to 8, covering every increment).`,
    `- A "fix" or a "change": tickets: 1 to ${MAX_TICKETS} pieces of work, all in increment 1; increments: exactly one.`,
    `- A "feature" is built on the existing product as a feature delivery, the way milestones are planned: tickets: 2 to ${L.tickets} pieces of work for the development team, in the order they should be built, each with a short title, a description of what to build in plain words${code ? " (naming the repository and the files or folders it changes, as the file map shows them)" : ""} and the increment it belongs to. increments: 1 to ${L.proposedIncrements} builds in order; each is a usable step that is deployed to dev and tried by people before the next one starts, with a short title and its goal (what people can try on dev once it is built). The first increment is the smallest useful slice; a small feature is one increment; put at most ${L.ticketsPerIncrement} tickets in one increment and split a big feature so no build becomes one huge risky change. Tests and documentation go with the increment they cover.`,
    "- parts: whether the work needs API (server) changes, web app changes and data changes (new or changed stored records, schemas or migrations).",
    ...(code
      ? [`- codeAreas: up to ${MAX_CODE_AREAS} files or folders you expect the work to touch, each with its repository key and its path exactly as the file map shows it (a new file goes in a folder the map shows); empty only when no code changes.`]
      : []),
    slots > 0
      ? `- questions: at most ${slots}, only when the answer really changes what gets built and the material below does not already answer it (for a feature: who uses it, what data it works on, what it must not change). Each has 2 to 4 short options the person can pick with one click. Ask nothing when the request is clear.`
      : "- questions: none (every question has been answered).",
  ];
}

export function analysisPrompt(o: { p: ProjectView; cr: Row; material: string; prior: ChangeAnalysis | null; refine: boolean; code?: ProductCode | null; existing?: boolean }): string {
  const answered = answeredOf(o.prior);
  const slots = questionSlots(o.prior);
  const code = o.code ?? null;
  if (o.existing) {
    const out = [
      `A person asks for a change to ${o.p.name}, which is already built and live. It came to the Factory as an existing product: there is no locked scope, so judge the request against what the product does today and what the client told us. Analyse it before anyone builds it; a new feature is built on the existing product, increment by increment.`,
      requestText(o.p, o.cr),
      "",
      ...(code
        ? ["The product's code is at the end of this message. Analyse the request against what the code is today: find where it lands in the file map, and do not assume a file or folder the map does not show.", ""]
        : []),
      "Decide:",
      ...existingProductRules(slots, code),
    ];
    if (o.refine && answered.length) {
      out.push("", `The person answered the questions of the first analysis. Use the answers: they decide what gets built.\n${answered.map((q) => `- Q: ${q.text}\n  A: ${q.answer}`).join("\n")}`);
      if (o.prior?.summary) out.push(`The first analysis said: ${o.prior.summary}`);
    }
    out.push("", scopeText(o.p), "", `What the client told us and the project context:\n${o.material}`);
    if (code) out.push("", codeText(code));
    return out.join("\n");
  }
  const out = [
    `A person asks for a change to ${o.p.name}, which is already built and released. Analyse it before anyone builds it.`,
    requestText(o.p, o.cr),
    "",
    ...(code
      ? [
          "The product's code is at the end of this message. Analyse the change against what the code is today as well as against the scope: find where it lands in the file map, and do not assume a file or folder the map does not show.",
          "",
        ]
      : []),
    "Decide:",
    `- kind: "fix" when something does not work as the locked scope says; "change" when an existing feature or screen should work or look differently, or gets a small addition; "feature" only when it is new work the locked scope does not cover at all (a new feature, a new kind of user, a new integration). A new look, layout, size, colour, picture, motion or wording of an existing screen or section is always a "change", even when it alters a detail the scope or the design shows (a button label, the order of sections, a full-width banner instead of a boxed one). Judge from the scope below, not only from the lane the person picked.`,
    "- scopeChange: true only when the change adds a new feature, removes something the locked scope promises, or contradicts a rule the locked scope decided on purpose (a story's rule, something left out on purpose). How an existing screen looks or is laid out is never a scope change on its own. A feature is always a scope change.",
    "- When the change clashes with a detail of the locked scope that the person can settle with one answer (the scope says the hero has two buttons, the request describes a hero without them), do not route it away silently: name the clash under conflicts and ask ONE question about it (if questions are allowed), with options like building it as a change that replaces that detail, or keeping the detail and fitting the change around it.",
    "- summary: one or two plain sentences on what will change for the people who use the product.",
    "- impact: the features, stories, screens and milestones it touches, by their exact names from the lists below; leave a list empty when nothing there is touched.",
    "- conflicts: where it clashes with the locked scope, what was left out on purpose, a decision or an answer the client gave earlier; empty when there is none.",
    code
      ? "- risks: what could break or what needs care, plainly. Name the existing behaviour at risk: the other screens, API routes, reports, documents or data that share the code the change touches (from the file map), and any of the owner's standing rules it comes close to; empty when there is none."
      : "- risks: what could break or what needs care, plainly; empty when there is none.",
    "- acceptanceCriteria: 2 to 6 checks a tester can run on the finished product, each one plain sentence.",
    `- tickets: 1 to ${MAX_TICKETS} pieces of work for the development team, in the order they should be built; each has a short title and a description of what to build, in plain words. A fix usually needs one ticket.${code ? " Each description also names the repository and the files or folders the ticket changes, as the file map shows them." : ""}`,
    ...(code
      ? [`- codeAreas: up to ${MAX_CODE_AREAS} files or folders you expect the change to touch, each with its repository key and its path exactly as the file map shows it (a new file goes in a folder the map shows); empty only when no code changes.`]
      : []),
    slots > 0
      ? `- questions: at most ${slots}, only when the answer really changes what gets built and the material below does not already answer it. Each has 2 to 4 short options the person can pick with one click. Ask nothing when the request is clear.`
      : "- questions: none (every question has been answered).",
  ];
  if (o.refine && answered.length) {
    out.push("", `The person answered the questions of the first analysis. Use the answers: they decide what gets built. An answer that settles a clash with the locked scope makes it a change in the fast lane (scopeChange false), unless the work is a new feature.\n${answered.map((q) => `- Q: ${q.text}\n  A: ${q.answer}`).join("\n")}`);
    if (o.prior?.summary) out.push(`The first analysis said: ${o.prior.summary}`);
  }
  out.push("", scopeText(o.p), "", `What the client told us and the project context:\n${o.material}`);
  if (code) out.push("", codeText(code));
  return out.join("\n");
}

const strList = (maxItems: number, description: string) => ({ type: "array", items: { type: "string" }, maxItems, description });
const nameList = (names: readonly string[], description: string) =>
  names.length ? { type: "array", items: { type: "string", enum: [...names] }, maxItems: Math.min(20, names.length), description } : { type: "array", items: { type: "string" }, maxItems: 0, description };

export function analysisSchema(names: ChangeNames, slots: number, code?: ProductCode | null, existing = false): object {
  const codeProps: Record<string, object> = code
    ? {
        codeAreas: {
          type: "array",
          maxItems: MAX_CODE_AREAS,
          description: "Files or folders the change touches, by repository key and path as the file map shows them.",
          items: {
            type: "object",
            properties: { repo: { type: "string", enum: code.repos.map((r) => r.key) }, path: { type: "string", description: "Relative to the repository, as in the file map." } },
            required: ["repo", "path"],
            additionalProperties: false,
          },
        },
      }
    : {};
  const props: Record<string, object> = {
    kind: { type: "string", enum: [...CHANGE_KINDS] },
    scopeChange: { type: "boolean" },
    summary: { type: "string", description: "One or two plain sentences." },
    impact: {
      type: "object",
      properties: {
        features: nameList(names.features, "Features touched, by their exact names."),
        stories: nameList(names.stories, "Stories touched, by their exact names."),
        screens: nameList(names.screens, "Screens touched, by their exact names."),
        milestones: nameList(names.milestones, "Milestones touched, by their exact names."),
      },
      required: ["features", "stories", "screens", "milestones"],
      additionalProperties: false,
    },
    conflicts: strList(6, "Clashes with the locked scope or earlier decisions; empty when none."),
    risks: strList(6, "What needs care; empty when none."),
    acceptanceCriteria: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 8, description: "Plain, testable checks." },
    tickets: existing
      ? {
          type: "array",
          minItems: 1,
          maxItems: MAX_FEATURE_TICKETS,
          description: `A fix or a change: at most ${MAX_TICKETS}, all in increment 1. A feature: its tickets in build order, each in its increment.`,
          items: {
            type: "object",
            properties: { title: { type: "string" }, description: { type: "string" }, increment: { type: "integer", minimum: 1, maximum: MAX_INCREMENTS } },
            required: ["title", "description", "increment"],
            additionalProperties: false,
          },
        }
      : {
          type: "array",
          minItems: 1,
          maxItems: MAX_TICKETS,
          items: { type: "object", properties: { title: { type: "string" }, description: { type: "string" } }, required: ["title", "description"], additionalProperties: false },
        },
    ...(existing
      ? {
          increments: {
            type: "array",
            minItems: 1,
            maxItems: MAX_INCREMENTS,
            description: "The builds in order, each deployed to dev and tried before the next; one for a fix or a change.",
            items: { type: "object", properties: { title: { type: "string" }, goal: { type: "string", description: "What people can try on dev once it is built." } }, required: ["title", "goal"], additionalProperties: false },
          },
          parts: {
            type: "object",
            description: "The parts of the product the work changes.",
            properties: { api: { type: "boolean" }, web: { type: "boolean" }, data: { type: "boolean" } },
            required: ["api", "web", "data"],
            additionalProperties: false,
          },
        }
      : {}),
    questions: {
      type: "array",
      maxItems: slots,
      items: {
        type: "object",
        properties: { text: { type: "string" }, options: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 4 } },
        required: ["text", "options"],
        additionalProperties: false,
      },
    },
    ...codeProps,
  };
  return { type: "object", properties: props, required: Object.keys(props), additionalProperties: false };
}

/** A path as the analysis named it, relative and "/"-separated, or "" when it cannot name a place in a repository. */
function relPath(p: string): string {
  const t = p.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!t || t.length > 300 || /^[A-Za-z]:/.test(t) || /[\0\r\n]/.test(t) || t.split("/").some((s) => s === "." || s === "..")) return "";
  return t;
}

/** The answer's codeAreas as "<repo key>: <path>" (a folder ends in "/"), only those that fit the product's code: a
 *  listed file or folder, or a new file or folder just below a listed one (pure). */
export function codeAreasOf(raw: unknown, code: ProductCode): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const o = obj(item);
    const key = typeof o?.repo === "string" ? o.repo.trim() : "";
    const repo = code.repos.find((r) => r.key === key);
    let rel = typeof o?.path === "string" ? relPath(o.path) : "";
    if (!repo || !rel) continue;
    let where = repo.entries ? pathInMap(repo.entries, rel) : "new";
    if (!where && repo.entries && rel.startsWith(`${repo.key}/`)) {
      // the repository's key written in front of the path
      rel = rel.slice(repo.key.length + 1);
      where = pathInMap(repo.entries, rel);
    }
    if (!where) continue;
    const area = `${repo.key}: ${rel}${where === "dir" ? "/" : ""}`;
    if (!out.includes(area)) out.push(area);
    if (out.length >= MAX_CODE_AREAS) break;
  }
  return out;
}

/** The names of `list` that the project has, in its own spelling (the rest left out). */
function known(list: readonly string[], names: readonly string[]): string[] {
  const by = new Map(names.map((n) => [n.toLowerCase(), n]));
  return uniq(list.map((x) => by.get(x.toLowerCase()) ?? "").filter(Boolean));
}

const staged = (s: string): boolean => STAGED.test(s);

/** The question asked when a change clashes with a detail of the locked scope (its id marks it). */
export const CONFLICT_QUESTION_ID = "scope";
export const CONFLICT_OPTIONS = ["Build it as a change that replaces that part", "Keep that part and fit the change around it"] as const;

export function conflictQuestion(conflict: string): ChangeAnalysisQuestion {
  const what = conflict.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  const text = what
    ? `This change differs from the locked scope: ${what.charAt(0).toLowerCase()}${what.slice(1)}. How should we go on?`
    : "This change differs from what the locked scope decided. How should we go on?";
  return { id: CONFLICT_QUESTION_ID, text: text.slice(0, CHANGE_ANALYSIS_LIMITS.questionText), options: [...CONFLICT_OPTIONS], answer: null, answeredBy: null, answeredAt: null };
}

/** True when the person settled the clash with one of the question's options (free text leaves it to the analysis). */
export function conflictSettled(prior: ChangeAnalysis | null): boolean {
  const q = prior?.questions.find((x) => x.id === CONFLICT_QUESTION_ID);
  return !!q && q.answer !== null && (CONFLICT_OPTIONS as readonly string[]).includes(q.answer);
}

/** Claude's answer as ChangeRequest.Analysis, or a thrown Error saying why it is not usable (aiJson retries once). The
 *  answered questions of the earlier analysis are kept as they were; new questions get ids not used before. With the
 *  product's code, the codeAreas that fit it are kept (none of them is a reason to refuse the answer). */
export function acceptAnalysis(raw: unknown, ctx: { names: ChangeNames; prior: ChangeAnalysis | null; contextVersion: number | null; code?: ProductCode | null; existing?: boolean }): ChangeAnalysis {
  const o = obj(raw);
  if (!o) throw new Error("the answer is not an object");
  const slots = questionSlots(ctx.prior);
  const rawQuestions = Array.isArray(o.questions) ? o.questions : [];
  if (rawQuestions.length > slots) throw new Error(`${rawQuestions.length} questions, at most ${slots} allowed`);
  for (const q of rawQuestions) {
    const opts = Array.isArray(obj(q)?.options) ? (obj(q)!.options as unknown[]).filter((x) => typeof x === "string" && x.trim()) : [];
    if (opts.length < 2 || opts.length > 4) throw new Error("a question needs 2 to 4 options");
  }
  // a feature on a product without a Factory scope: its increments and parts become its FeatureDeliveryPlan
  const plan = ctx.existing ? { basis: "existing-product", increments: o.increments, parts: o.parts } : undefined;
  const parsed = parseChangeAnalysis({ ...o, v: 1, questions: [], estimate: undefined, contextVersion: ctx.contextVersion ?? undefined, routeDecision: undefined, feature: plan });
  if (!parsed) throw new Error("no usable kind");
  if (!parsed.summary || staged(parsed.summary)) throw new Error("no usable summary");
  const clean = (xs: string[]) => xs.filter((x) => !staged(x));
  const acceptanceCriteria = clean(parsed.acceptanceCriteria);
  if (acceptanceCriteria.length === 0) throw new Error("no acceptance criteria");
  const feature = ctx.existing && parsed.kind === "feature" && parsed.feature ? parsed.feature : null;
  let tickets = parsed.tickets.filter((t) => !staged(t.title) && !staged(t.description)).slice(0, feature ? MAX_FEATURE_TICKETS : MAX_TICKETS);
  if (tickets.length === 0) throw new Error("no tickets");
  // the feature's builds: increments without a ticket left out, one that is too big split, so every build stays small
  let delivery = feature;
  if (feature) {
    const kept = { ...feature, increments: feature.increments.filter((_inc, i) => tickets.some((t) => t.increment === i + 1)) };
    const renumber = new Map(feature.increments.flatMap((_inc, i) => (tickets.some((t) => t.increment === i + 1) ? [i + 1] : [])).map((n, k) => [n, k + 1]));
    const split = splitIncrements(kept, tickets.map((t) => ({ ...t, increment: renumber.get(t.increment ?? 1) ?? 1 })));
    delivery = split.plan;
    tickets = split.tickets;
  }

  // the answered questions stay as they were; the new ones are parsed by the shared parser (ids q1.., options clamped)
  const kept = answeredOf(ctx.prior).map((q) => ({ ...q }));
  const used = new Set(kept.map((q) => q.id));
  const fresh = parseChangeAnalysis({ v: 1, kind: parsed.kind, questions: rawQuestions })?.questions ?? [];
  const added: ChangeAnalysisQuestion[] = [];
  let n = 1;
  for (const q of fresh) {
    if (staged(q.text) || q.options.some(staged)) throw new Error("a question uses words the product never shows");
    while (used.has(`q${n}`)) n += 1;
    const id = `q${n}`;
    used.add(id);
    added.push({ id, text: q.text, options: q.options, answer: null, answeredBy: null, answeredAt: null });
  }

  // A clash with the locked scope the person can settle is asked, not routed away silently (one question, when a slot is
  // free); once the person settled it with one of its options, the change stays in the fast lane (a new feature does not).
  const settled = conflictSettled(ctx.prior);
  const conflicts = clean(parsed.conflicts);
  // (a product without a Factory scope has no locked scope to clash with: nothing is a scope change there)
  if (!ctx.existing && parsed.kind !== "feature" && parsed.scopeChange && !settled && !kept.some((q) => q.id === CONFLICT_QUESTION_ID)
    && kept.length + added.length < MAX_QUESTIONS) {
    added.push(conflictQuestion(conflicts[0] ?? ""));
  }
  const scopeChange = ctx.existing ? false : parsed.kind === "feature" ? true : settled ? false : parsed.scopeChange;
  const codeAreas = ctx.code ? codeAreasOf(o.codeAreas, ctx.code) : [];

  const { codeAreas: _named, feature: _plan, ...base } = parsed; // only the checked codeAreas and the feature's own plan are kept
  return {
    ...base,
    ...(codeAreas.length ? { codeAreas } : {}),
    ...(delivery ? { feature: delivery } : {}),
    route: changeRouteFor(parsed.kind, scopeChange, undefined, null, !!delivery),
    scopeChange,
    impact: {
      features: known(parsed.impact.features, ctx.names.features),
      stories: known(parsed.impact.stories, ctx.names.stories),
      screens: known(parsed.impact.screens, ctx.names.screens),
      milestones: known(parsed.impact.milestones, ctx.names.milestones),
    },
    conflicts,
    risks: clean(parsed.risks),
    acceptanceCriteria,
    tickets,
    estimate: { tickets: tickets.length },
    questions: [...kept, ...added].slice(0, MAX_QUESTIONS),
    contextVersion: ctx.contextVersion,
  };
}
