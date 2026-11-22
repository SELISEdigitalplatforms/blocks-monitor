// Agent-powered requirements draft: a full Claude session with the planner's AGENT.md, MCP tools and the
// complete project material — not a short focused call. The session reads every file, cross-references
// documents, detects contradictions and produces structured requirements with full reasoning.
//
// Used when:
//   1. The official MADP engine is installed (AGENT.md exists)
//   2. MF_ENGINE_AI is not "off"
//
// Falls back to null so the caller keeps the direct AI calls (ai.ts).
import fs from "node:fs";
import path from "node:path";
import type { JobRun } from "../../run.ts";
import { aiJson } from "../../ai/index.ts";
import { S, arr, obj, oneOf, text, texts } from "../../ai/check.ts";
import { projectMaterial, type SourceTag } from "../../ai/material.ts";
import { officialHome } from "../../official/home.ts";
import { briefFactsOf } from "../../../../../src/domain/projectBrief";
import { detailsFromRow } from "../../../../../src/domain/setupDetails";
import { slugOf } from "../../text.ts";
import type { PlannedObjective, PlannedReq } from "./draft.ts";
import { EXTRA_KINDS, type ExtraKind } from "../../../../../src/domain/requirementsExtras";

const CATEGORIES = ["functional", "integration", "nfr", "security", "data", "ux", "other"] as const;
const PRIORITIES = ["must", "nice", "later"] as const;

/** True when the planner agent's instructions are available. */
export function hasAgentPlanner(): boolean {
  // the operator can turn the agent mode off on a host (MF_AGENT_PLANNER=off): the focused AI calls draft instead
  if (process.env.MF_AGENT_PLANNER?.trim().toLowerCase() === "off") return false;
  try {
    const home = officialHome();
    return fs.existsSync(path.join(home, "MADP", "agents", "01-planner", "AGENT.md"));
  } catch {
    return false;
  }
}

/** Read the planner's AGENT.md (or a relevant excerpt) to use as system prompt. */
function plannerSystemPrompt(): string {
  try {
    const home = officialHome();
    const agentMd = fs.readFileSync(path.join(home, "MADP", "agents", "01-planner", "AGENT.md"), "utf-8");
    // Use the first 6000 chars of AGENT.md — the role definition and key rules
    const excerpt = agentMd.slice(0, 6000);
    return [
      excerpt,
      "",
      "You are running in ANALYSIS MODE for the Factory's project setup step.",
      "Your task: read ALL the project material below and produce structured requirements.",
      "Cross-reference every document, note and answered question. Find contradictions.",
      "The client's answers ALWAYS win over documents when they disagree.",
    ].join("\n");
  } catch {
    return "You are Rajiv, the product manager of the product team. You read all the business material and write structured requirements.";
  }
}

/** Build a comprehensive prompt with the full project material. */
async function fullMaterialPrompt(run: JobRun, max: number): Promise<{ prompt: string; sources: Map<string, SourceTag> }> {
  const { text: material, sources } = await projectMaterial(run, { budget: 30000 });
  const p = run.p;
  const about = briefFactsOf(p);
  const details = detailsFromRow(p.project);

  const sections: string[] = [];
  sections.push("# PROJECT MATERIAL FOR REQUIREMENTS ANALYSIS");

  // Project overview
  sections.push(`## Project: ${p.name}`);
  if (about.goal) sections.push(`Goal: ${about.goal}`);
  if (about.targetUsers) sections.push(`Target users: ${about.targetUsers}`);

  // Setup details
  if (details.mustHaves.length > 0) {
    sections.push(`\n## Must-Haves from Setup`);
    for (const m of details.mustHaves) sections.push(`- [${m.priority}] ${m.text}`);
  }
  if (details.workflows.length > 0) {
    sections.push(`\n## Key Workflows`);
    for (const w of details.workflows) sections.push(`- ${w}`);
  }
  if (details.exclusions.length > 0) {
    sections.push(`\n## Excluded (Out of Scope)`);
    for (const e of details.exclusions) sections.push(`- ${e}`);
  }
  if (details.constraints.length > 0) {
    sections.push(`\n## Constraints`);
    for (const c of details.constraints) sections.push(`- [${c.kind}] ${c.text}`);
  }

  // Full material (notes, files, answers)
  sections.push(`\n## Source Material\n${material}`);

  // Task
  sections.push([
    `\n## YOUR TASK`,
    `Write at most ${max} requirements, the project objective, and the key workflows/exclusions/constraints.`,
    "",
    "For each requirement:",
    "- title: short (max 80 chars), says what people can do",
    "- text: 1-3 sentences explaining who, what and why",
    "- category: functional | integration | nfr | security | data | ux | other",
    "- priority: must (needed for first release) | nice (should have) | later (could wait)",
    "- acceptanceCriteria: 2-4 short checks a business person can verify",
    "- sources: tags of the notes/files/answers it comes from",
    "",
    "For the objective:",
    "- statement: one sentence — what the product does and for whom",
    "- description: 2-3 paragraphs describing the product",
    "- architectureOutline: high-level technical approach",
    "",
    "CRITICAL RULES:",
    "- Cross-reference ALL documents — find where they agree and disagree",
    "- When an answer and a document disagree, list it in conflicts",
    "- Every requirement must trace to at least one source",
    "- Most important requirements first",
  ].join("\n"));

  return { prompt: sections.join("\n"), sources };
}

const SCHEMA = S.obj({
  requirements: S.list(S.obj({
    title: S.str("Short, max 80 chars, says what people can do."),
    text: S.str("1-3 sentences: who, what and why."),
    category: S.enum(CATEGORIES),
    priority: S.enum(PRIORITIES, "must = first release, nice = should have, later = could wait."),
    acceptanceCriteria: S.list(S.str(), 4, "2-4 checks a business person can verify."),
    sources: S.list(S.str(), 6, 'Tags: "A1", "N1", "F1"'),
  }), 14),
  objective: S.obj({
    statement: S.str("One sentence: what the product does and for whom."),
    description: S.str("2-3 paragraphs about the product."),
    architectureOutline: S.str("High-level technical approach."),
  }),
  extras: S.list(S.obj({
    kind: S.enum(["workflow", "exclusion", "constraint"]),
    title: S.str("Short title."),
    who: S.str("Who is involved (empty for exclusions/constraints)."),
    steps: S.list(S.str(), 6, "Steps of a workflow, or the detail."),
  }), 12),
  conflicts: S.list(S.obj({
    answer: S.str('Tag of the client\'s answer ("A1").'),
    point: S.str("What it's about, a few words."),
    answerSays: S.str("What the answer says, max 80 chars."),
    other: S.str('Tag of the disagreeing source ("F1", "N1").'),
    otherSays: S.str("What that source says, max 80 chars."),
  }), 8),
});

export interface AgentDraftResult {
  requirements: PlannedReq[];
  objective: PlannedObjective;
  extras: Array<{ kind: ExtraKind; title: string; who: string; steps: string[] }>;
  conflicts: Array<{
    answerRef: string;
    point: string;
    answerSays: string;
    otherRef: string;
    otherSays: string;
  }>;
}

/** Accept the agent's structured answer, mapping it to the engine's plan types. */
function acceptAgentDraft(raw: unknown, sources: Map<string, SourceTag>, max: number): AgentDraftResult | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.requirements)) return null;

  const requirements: PlannedReq[] = [];
  const keys = new Set<string>();

  for (const x of arr(o.requirements)) {
    const r = obj(x);
    const title = r ? text(r.title, 80, 5) : null;
    const body = r ? text(r.text, 600, 10) : null;
    if (!r || !title || !body) continue;
    const criteria = texts(r.acceptanceCriteria, 4, 200, 5);
    if (criteria.length < 2) continue;

    let key = slugOf(title.replace(/^(the|a|an)\s+/i, ""), 40);
    for (let n = 2; keys.has(key); n++) key = `${slugOf(title, 36)}-${n}`;
    keys.add(key);

    const refs = arr(r.sources)
      .map((s) => sources.get(String(s).toUpperCase())?.id)
      .filter((s): s is string => Boolean(s));

    requirements.push({
      local: `req-${requirements.length}`,
      key,
      Title: title,
      Text: body,
      Category: oneOf(r.category, CATEGORIES) ?? "functional",
      Priority: oneOf(r.priority, PRIORITIES) ?? "must",
      AcceptanceCriteria: criteria,
      SourceRefs: refs,
    });
    if (requirements.length >= max) break;
  }

  if (requirements.length < 2) return null;

  // Parse objective — PlannedObjective uses Statement, AcceptanceCriteria, HighLevelMd, ArchitectureMd
  const objRaw = obj(o.objective);
  const objective: PlannedObjective = {
    Statement: objRaw ? text(objRaw.statement, 300, 10) ?? "" : "",
    AcceptanceCriteria: [],
    HighLevelMd: objRaw ? text(objRaw.description, 2000, 20) ?? "" : "",
    ArchitectureMd: objRaw ? text(objRaw.architectureOutline, 2000, 10) ?? "" : "",
  };
  // without an objective statement the draft would write an empty objective: fall back to the focused AI calls instead
  if (!objective.Statement) return null;

  // Parse extras
  const extras = arr(o.extras).map((x) => {
    const e = obj(x);
    if (!e) return null;
    return {
      kind: oneOf(e.kind, EXTRA_KINDS) ?? "workflow",
      title: text(e.title, 120, 3) ?? "",
      who: text(e.who, 200, 0) ?? "",
      steps: texts(e.steps, 6, 200, 3),
    };
  }).filter((e): e is NonNullable<typeof e> => e !== null && e.title !== "");

  return { requirements, objective, extras, conflicts: [] };
}

/** Run the agent-powered requirements draft. Returns null to fall back to direct AI calls. */
export async function agentDraftRequirements(
  run: JobRun,
  opts: { max?: number },
): Promise<AgentDraftResult | null> {
  if (!hasAgentPlanner()) return null;

  const max = opts.max ?? 12;
  const system = plannerSystemPrompt();
  const { prompt, sources } = await fullMaterialPrompt(run, max);

  return aiJson(run, {
    task: "agent requirements draft",
    role: system,
    prompt,
    schema: SCHEMA,
    timeoutMs: 120_000, // 2 min — richer prompt needs more time
    accept: (raw) => acceptAgentDraft(raw, sources, max),
  });
}
