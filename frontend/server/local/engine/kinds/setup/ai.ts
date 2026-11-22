// Claude-written findings of the business agent (setup.assist, see ../../ai/index.ts): what the shared documents and
// notes say the product must do, its key workflows, what to leave out, the constraints, and the goal or the users when
// the project has none yet. Each finding names the document it came from. The same filter as the built-in reading
// leaves out what the project has already (extract.ts newFindings). Null: keep the built-in findings.
import { CONSTRAINT_KINDS, PRIORITIES, type ConstraintKind, type Priority } from "../../../../../src/domain/setupDetails";
import { SUGGESTION_KINDS, TEXT_MAX, type SuggestionKind } from "../../../../../src/domain/setupAgent";
import type { JobRun } from "../../run.ts";
import { aiJson } from "../../ai/index.ts";
import { S, arr, obj, oneOf, text } from "../../ai/check.ts";
import { FINDINGS_MAX, newFindings, type ExtractContext, type Finding, type SourceDoc } from "./extract.ts";

const AGENT = "You are the business analyst of the product team. People just shared documents and notes about their product; you read them and note what they say for the project setup.";

const docText = (d: SourceDoc): string => {
  if (d.read.rows?.length) return d.read.rows.slice(0, 40).map((r) => r.join(" | ")).join("\n");
  return d.read.text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
};

export function acceptFindings(raw: unknown, docs: readonly SourceDoc[], ctx: ExtractContext): Finding[] | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.findings)) return null;
  const found: Finding[] = [];
  for (const x of arr(o.findings)) {
    const f = obj(x);
    const kind = f ? oneOf<SuggestionKind>(f.kind, SUGGESTION_KINDS) : null;
    if (!f || !kind) continue;
    const t = text(f.text, TEXT_MAX[kind], 4);
    const at = Number(String(f.source ?? "").replace(/\D/g, "")) - 1;
    const doc = docs[at] ?? null;
    if (!t || !doc) continue;
    if (kind === "goal" && ctx.goal.trim()) continue;
    if (kind === "users" && ctx.users.trim()) continue;
    found.push({
      kind,
      text: t.replace(/\.$/, ""),
      priority: kind === "mustHave" ? (oneOf<Priority>(f.priority, PRIORITIES) ?? "must") : "must",
      constraintKind: kind === "constraint" ? (oneOf<ConstraintKind>(f.constraintKind, CONSTRAINT_KINDS) ?? "other") : "other",
      sourceRef: doc.ref,
      sourceName: doc.name,
    });
  }
  // nothing found in readable documents is an answer only when the built-in reading finds nothing either
  return newFindings(found, ctx);
}

const SCHEMA = S.obj({
  findings: S.list(S.obj({
    kind: S.enum(SUGGESTION_KINDS, "mustHave = something it must do; workflow = a routine of who does what; exclusion = left out on purpose; constraint = a rule to respect; goal / users only when asked."),
    text: S.str("In the documents' own terms, one point, at most 200 characters."),
    priority: S.enum(PRIORITIES, "For a mustHave: must, should or could. Else must."),
    constraintKind: S.enum(CONSTRAINT_KINDS, "For a constraint: its kind. Else other."),
    source: S.str('Tag of the document it comes from ("D1").'),
  }), 30),
});

export async function aiFindings(run: JobRun, docs: readonly SourceDoc[], ctx: ExtractContext, builtInCount: number): Promise<Finding[] | null> {
  const readable = docs.filter((d) => d.read.type !== "none" && docText(d).length > 20);
  if (readable.length === 0) return null;
  let budget = 14000;
  const parts = docs.map((d, i) => {
    const t = d.read.type === "none" ? "" : docText(d);
    const body = budget > 300 ? t.slice(0, Math.min(5000, budget)) : "";
    budget -= body.length;
    return `[D${i + 1}] "${d.name}"${body ? `:\n${body}` : " (no readable text)"}`;
  });
  const have = [
    ctx.goal ? `Goal: ${ctx.goal}` : "Goal: (none yet — note one if the documents state it)",
    ctx.users ? `Who uses it: ${ctx.users}` : "Who uses it: (none yet — note the user groups if the documents name them)",
    ...ctx.details.mustHaves.map((m) => `Must-have: ${m.text}`),
    ...ctx.details.workflows.map((w) => `Workflow: ${w}`),
    ...ctx.details.exclusions.map((e) => `Not included: ${e}`),
    ...ctx.details.constraints.map((c) => `Constraint (${c.kind}): ${c.text}`),
  ];
  const prompt = [
    `Read what was shared for ${ctx.productName} and write down what it says, for people to review and add to the project setup.`,
    "",
    "Rules:",
    `- At most ${FINDINGS_MAX.mustHave} must-haves, ${FINDINGS_MAX.workflow} workflows, ${FINDINGS_MAX.exclusion} things to leave out and ${FINDINGS_MAX.constraint} constraints; only what the documents really say, the most important first.`,
    "- A must-have says what the product must let people do (\"Sellers can set their own price per licence\"); its priority follows the document (must, should, could).",
    "- A constraint is a rule to respect: a deadline, a budget, a law or standard, the languages, or another system it must work with.",
    "- Leave out what the project setup has already (below), small talk, and what people do today without the product.",
    "- Each finding names the document it comes from.",
    "",
    `Project setup so far:\n${have.map((h) => `- ${h}`).join("\n")}`,
    "",
    `Documents and notes:\n${parts.join("\n\n")}`,
  ].join("\n");
  return aiJson(run, {
    task: "setup findings",
    role: AGENT,
    prompt,
    schema: SCHEMA,
    accept: (raw) => {
      const out = acceptFindings(raw, docs, ctx);
      return out && (out.length > 0 || builtInCount === 0) ? out : null;
    },
  });
}
