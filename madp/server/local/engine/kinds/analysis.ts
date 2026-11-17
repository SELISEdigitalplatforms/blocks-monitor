// The analysis work of the MADP engine: questions and technical proposals during product sanitization
// (sanitization.assist), the first draft of Requirements v1 with the objective, and the review of the requirements
// for suggestions (requirements.draft). The planning lives in ./analysis/; this file writes the rows step by step.
import type { EngineJobKind } from "../../../../src/domain/engineJob";
import type { Row } from "../../../../functions/_lib/gateway";
import type { JobRun, KindResult, KindWriter } from "../run.ts";
import { str } from "../context.ts";
import { clip, plural } from "../text.ts";
import { planFollowUp, planQuestions, type PlannedQuestion } from "./analysis/clarify.ts";
import { objectiveWrite, planObjective, planRequirements, type PlannedReq } from "./analysis/draft.ts";
import { automaticDesignDirection, rawDesignRequirements } from "../../../../src/domain/figmaMake";
import { freeKey, insertNumberedAll, mine, writtenBy } from "./analysis/own.ts";
import { editedByPerson } from "./analysis/edited.ts";
import { briefFactsOf, isThin } from "../../../../src/domain/projectBrief";
import { inParallel } from "../run.ts";
import { planSuggestions } from "./analysis/review.ts";
import { planTech, techCandidates, type PlannedTech } from "./analysis/technical.ts";
import { readFacts } from "./analysis/facts.ts";
import { outOfScopeItems, plannedExtras, withMaterialExclusions, writeSetupExtras } from "./analysis/extras.ts";
import { materialTexts } from "../ai/material.ts";
import { hasSetup, setupOf } from "./analysis/setup.ts";
import { writeLandingSection } from "./analysis/landing.ts";
import { LANDING_JOB_PURPOSE } from "../../../../src/domain/landingPage";
import { early } from "../ai/index.ts";
import { aiDraftRequirements, aiObjective, aiQuestions, aiRequirements, aiTech, type ObjectivePlan } from "./analysis/ai.ts";
import { askConflicts, followAnswers, recordAnswerCheck } from "./analysis/followAnswers.ts";
import { agentDraftRequirements, hasAgentPlanner } from "./analysis/agent.ts";

const progressOf = (i: number, n: number, from: number, to: number): number => from + Math.round(((to - from) * i) / Math.max(1, n));

// ------------------------------------------------------------------------------------------------- questions

async function writeQuestions(run: JobRun, plan: PlannedQuestion[]): Promise<string[]> {
  const ids = await insertNumberedAll(run, "Clarification", plan, {
    local: (q) => q.local,
    fields: (q, n) => ({
      Question: q.question,
      Answer: "",
      Status: "open",
      OwnerUserId: q.owner,
      SourceType: q.sourceType,
      SourceRef: q.sourceRef,
      DeferReason: "",
      SortOrder: n,
      ...(q.options?.length ? { Options: q.options } : {}),
    }),
    before: async (_q, i) => {
      await run.step(progressOf(i, plan.length, 40, 92), `Writing question ${i + 1} of ${plan.length}.`);
      await run.wait(2.6);
    },
  });
  return ids.map((id) => `Clarification:${id}`);
}

async function clarifications(run: JobRun): Promise<KindResult> {
  const refId = str(run.input.refId);
  const asked = str(run.input.question);
  const ref = refId ? (run.p.row("Clarification", refId) ?? run.p.row("TechDecision", refId) ?? run.p.row("Requirement", refId) ?? null) : null;
  // the built-in plan, and Claude's (started now, read while the step reads the material); a person's own question stays theirs
  const builtIn = refId || asked ? planFollowUp(run, ref, asked) : planQuestions(run);
  const fromAi = asked ? null : early(aiQuestions(run, { ref: refId ? ref : undefined, fallbackCount: builtIn.length }));
  const notes = run.p.notes().length;
  const files = run.p.files().length;
  const setup = hasSetup(setupOf(run.p));
  if (setup) {
    await run.step(4, "Reading the project setup: the goal, the users and what it must do.");
    await run.wait(3);
  }
  const material = [notes ? plural(notes, "note") : "", files ? plural(files, "file") : ""].filter(Boolean).join(" and ");
  await run.step(setup ? 14 : 6, material ? `Reading ${material}.` : "Reading the brief.");
  await run.wait(4.5);
  await run.step(24, "Comparing with the answered questions and the decisions.");
  await run.wait(3);
  await run.step(30, "Checking the success and performance targets: how many users, how fast.");
  await run.wait(2.5);
  const plan = (await fromAi) ?? builtIn;
  await run.step(34, plan.length ? `Found ${plural(plan.length, "point")} to clarify.` : "Checking what is still open.");
  await run.wait(2);
  const outputs = await writeQuestions(run, plan);
  return {
    outputs,
    message: outputs.length
      ? `Drafted ${plural(outputs.length, "question")} from ${setup ? "the project setup, " : ""}the notes and files.`
      : "No new questions: the notes and files are covered by the questions and decisions so far.",
  };
}

// ------------------------------------------------------------------------------------------------- technical

async function writeTech(run: JobRun, plan: PlannedTech[]): Promise<string[]> {
  const ids = await insertNumberedAll(run, "TechDecision", plan, {
    local: (t) => t.local,
    before: async (t, i) => {
      await run.step(progressOf(i, plan.length, 45, 93), `Writing proposal ${i + 1} of ${plan.length}: ${clip(t.Title, 120)}.`);
      await run.wait(3);
    },
    fields: (t) => ({
        Area: t.Area,
        Title: t.Title,
        Choice: t.Choice,
        Rationale: t.Rationale,
        Alternatives: t.Alternatives,
        NfrCategory: t.NfrCategory,
        NfrTarget: t.NfrTarget,
        IntegrationSystem: t.IntegrationSystem,
        ExpertUserIds: [],
        Status: "proposed",
      }),
  });
  return ids.map((id) => `TechDecision:${id}`);
}

async function technical(run: JobRun): Promise<KindResult> {
  const p = run.p;
  const repo = p.repo;
  const repoLabel = repo.owner && repo.name ? `${repo.owner}/${repo.name}` : repo.name;
  // the built-in plan, and Claude's (started now, read when the step gets there)
  const refId = str(run.input.refId);
  const question = str(run.input.question);
  let builtIn: PlannedTech[];
  const ref = refId ? p.row("TechDecision", refId) : undefined;
  if (refId || question) {
    const area = str(ref?.Area);
    const all = techCandidates(run, readFacts(p));
    const pick = all.find((t) => (area ? t.Area === area : true) && t.Title !== str(ref?.Title)) ?? all[0];
    builtIn = pick ? [{ ...pick, local: "t-follow-up" }] : [];
  } else {
    builtIn = planTech(run);
  }
  const fromAi = early(aiTech(run, refId || question
    ? { max: 1, fallbackCount: builtIn.length, area: str(ref?.Area) || undefined, question: question || undefined, ref: ref ?? null }
    : { max: 4, fallbackCount: builtIn.length }));
  if (p.existingProduct && repoLabel) {
    await run.step(5, `Cloning ${repoLabel} (${repo.branch}).`);
    await run.wait(4.5);
    await run.step(18, "Reading the code structure and the data model.");
    await run.wait(5.5);
    await run.step(32, "Comparing the code with the business notes and decisions.");
    await run.wait(3.5);
  } else {
    await run.step(6, "Reading the business notes, files and decisions.");
    await run.wait(4.5);
    await run.step(25, "Checking volumes, devices, integrations and hosting.");
    await run.wait(4.5);
  }
  const plan = (await fromAi) ?? builtIn;
  await run.step(40, plan.length ? `${plural(plan.length, "area")} without a decision yet.` : "Every area has a decision already.");
  await run.wait(2);
  const outputs = await writeTech(run, plan);
  const n = outputs.length;
  return {
    outputs,
    message: !n
      ? "No new proposals: every technical area has a decision."
      : p.existingProduct && repoLabel
        ? `Read ${repoLabel} and proposed ${plural(n, "technical decision")}.`
        : `Proposed ${plural(n, "technical decision")}.`,
  };
}

// ------------------------------------------------------------------------------------------------- requirements

async function writeRequirements(run: JobRun, plan: PlannedReq[], from: number, to: number): Promise<string[]> {
  const base = run.p.rows("Requirement").filter((r) => !str(r.RequestKey).startsWith(`engine:${run.id}:`)).reduce((m, r) => Math.max(m, Number(r.SortOrder) || 0), 0);
  const start = Math.ceil((base + 1) / 1000) * 1000;
  // the keys before any write (the requirements are written a few at a time, so two of them never get the same key)
  const taken = new Set(run.p.rows("Requirement").map((r) => str(r.Key)));
  const keys = plan.map((r) => {
    const own = mine(run, "Requirement", r.local);
    if (own) return str(own.Key);
    let key = freeKey(run, "Requirement", r.key, r.local, 63);
    for (let n = 2; taken.has(key); n++) key = `${key.replace(/-\d+$/, "").slice(0, 58)}-${n}`;
    taken.add(key);
    return key;
  });
  const indexOf = new Map(plan.map((r, i) => [r, i]));
  const ids = await insertNumberedAll(run, "Requirement", plan, {
    local: (r) => r.local,
    before: async (r, i) => {
      await run.step(progressOf(i, plan.length, from, to), `Writing requirement ${i + 1} of ${plan.length}: ${clip(r.Title, 110)}.`);
      await run.wait(2.6);
    },
    fields: (r) => {
      const i = indexOf.get(r)!;
      const key = keys[i]!;
      return {
        Key: key,
        Title: r.Title,
        Text: r.Text,
        Category: r.Category,
        Priority: r.Priority,
        Status: "draft",
        AcceptanceCriteria: r.AcceptanceCriteria,
        SourceRefs: r.SourceRefs,
        SpecVersion: 1,
        SortOrder: start + i * 1000,
      };
    },
  });
  return ids.map((id) => `Requirement:${id}`);
}

/** The texts of the requirements document's other lists Claude wrote (they count for the answers check). */
const extrasTexts = (ai: ObjectivePlan | null): string[] => (ai?.extras ?? []).map((e) => [e.title, e.who, ...e.steps].filter(Boolean).join(" "));

/** The job's message with what the answers check found: the conflicts the client is asked to confirm. */
function withAnswers(message: string, asked: readonly string[]): string {
  if (!asked.length) return message;
  const tail = ` ${asked.length === 1 ? "One answer differs" : `${asked.length} answers differ`} from the documents: we followed your answer${asked.length === 1 ? "" : "s"}, please confirm in the questions.`;
  return `${message}${tail}`;
}

async function draft(run: JobRun): Promise<KindResult> {
  // Agent mode: when the planner agent is available, use a full session with the planner's AGENT.md,
  // cross-document reasoning and higher effort — falls back to the direct AI calls when unavailable.
  const agentResult = hasAgentPlanner() ? early(agentDraftRequirements(run, { max: 12 })) : Promise.resolve(null);
  // Claude's requirements and objective, started now and read when the step gets there (else the built-in plan)
  const builtInReqs = planRequirements(run);
  const aiReqs = early(aiDraftRequirements(run, { max: 12, fallbackCount: builtInReqs.length }));
  const aiObj = early(aiObjective(run));
  const notes = run.p.notes().length;
  const files = run.p.files().length;
  await run.step(4, notes || files ? `Reading ${plural(notes, "business note")} and ${plural(files, "file")}.` : "Reading the brief.");
  await run.wait(5);
  const answered = run.p.clarifications().filter((c) => c.Status === "answered").length;
  const decisions = run.p.decisions().filter((d: Row) => d.Status === "accepted").length;
  await run.step(14, `Reading ${plural(answered, "answered question")} and ${plural(decisions, "decision")}.`);
  await run.wait(5);
  // Prefer the agent's deep analysis when available; otherwise use the focused AI calls
  const agent = await agentResult;
  const drafted = agent ? { requirements: agent.requirements, conflicts: [] } : await aiReqs;
  const ai: ObjectivePlan | null = agent
    ? { objective: agent.objective, lookAndFeel: null, extras: agent.extras.flatMap((e) =>
      e.kind === "constraint" || e.kind === "workflow" || e.kind === "exclusion"
        ? [{ ...e, kind: e.kind, constraintKind: e.kind === "constraint" ? "other" as const : "" as const }]
        : []) }
    : await aiObj;
  // the client's answers win: every answer is in the requirements (a second try, else as a criterion), conflicts asked
  await run.step(20, agent ? "Cross-referencing documents with the agent's analysis." : "Checking that every answer is in the requirements.");
  const followed = await followAnswers(run, {
    plan: drafted?.requirements ?? builtInReqs,
    drafted: drafted?.conflicts ?? [],
    others: extrasTexts(ai),
    retry: drafted && !agent ? (fix) => aiDraftRequirements(run, { max: 12, fallbackCount: builtInReqs.length, fix }) : undefined,
  });
  const plan = followed.plan;
  const objective = ai?.objective ?? planObjective(run, plan);
  await run.step(24, `Grouping the needs into ${plural(plan.length, "requirement")}.`);
  await run.wait(4);
  const outputs = await writeRequirements(run, plan, 28, 84);
  await run.step(88, "Writing the objective, the high-level description and the architecture outline.");
  await run.wait(4.5);
  const w = objectiveWrite(run, objective);
  let objectiveId: string | null = null;
  if (w.mode === "insert") objectiveId = await run.insert("Objective", w.fields, "objective");
  else if (w.mode === "update") {
    await run.update("Objective", w.id, w.fields);
    objectiveId = w.id;
  } else if (w.id) objectiveId = w.id;
  if (objectiveId) outputs.push(`Objective:${objectiveId}`);
  // The planner owns the direction; screens need a separate, explicit review before requirements approval.
  if (run.p.rows("DesignBrief").length === 0) {
    await run.step(90, "Preparing automatic Figma Make design from the requirements.");
    const briefId = await run.insert("DesignBrief", { Mode: "figma", Instructions: automaticDesignDirection(rawDesignRequirements(run.p.requirements())), SampleFileIds: [], Status: "draft" }, "design-brief");
    outputs.push(`DesignBrief:${briefId}`);
  }
  const fromAi = withMaterialExclusions(ai?.extras ?? [], outOfScopeItems(await materialTexts(run).catch(() => [])));
  const extras = plannedExtras(run, fromAi);
  if (extras.length > 0) {
    await run.step(92, `Adding the key workflows, what is left out and the constraints from ${extras.some((e) => e.origin === "engine") ? "the material and your answers" : "the setup"}.`);
    outputs.push(...(await writeSetupExtras(run, fromAi)));
    await run.wait(1.5);
  }
  const landing = await writeLandingSection(run, 94);
  // where an answer and a document differ: the requirements follow the answer, the client confirms it
  const asked = await askConflicts(run, followed.conflicts);
  outputs.push(...asked);
  recordAnswerCheck(run, followed, asked);
  await run.step(96, "Checking every requirement has acceptance criteria.");
  await run.wait(2);
  const n = plan.length;
  return {
    outputs,
    message: withAnswers(n
      ? `Drafted ${plural(n, "requirement")}${objectiveId ? " and the objective" : ""}${landing ? ", and the landing page section" : ""}.`
      : objectiveId
        ? "The requirements cover the notes already; drafted the objective."
        : "The requirements and the objective cover the notes already.", asked),
  };
}

/** The objective statement to write when Claude has no objective right now: the person's own objective in the built-in
 *  wording (planObjective reads it from briefFactsOf), when one is recorded and the statement does not say it yet. */
function statementFromAnswer(run: JobRun, objective: Row): Row | null {
  if (isThin(briefFactsOf(run.p).goal)) return null;
  const statement = planObjective(run, []).Statement;
  return statement && statement !== str(objective.Statement) ? { Statement: statement } : null;
}

/** purpose "refresh": the draft was made before the questions were answered; the answers are in now. The drafted
 *  requirements nobody has edited are written again from the material with the answers (same rows, same keys and
 *  numbers; extra ones added, ones no longer needed removed), and so is an objective nobody has edited: it follows the
 *  answers, above all the person's own objective (without Claude's objective, in the person's words). "Nobody has
 *  edited" is a person's change only, never the engine's own earlier writes (./analysis/edited.ts). A person's own or
 *  edited requirements stay as they are. Without Claude's answer the requirements stay as they are. */
async function refreshDraft(run: JobRun): Promise<KindResult> {
  const p = run.p;
  const jobs = p.rows("EngineJob");
  const old = p.rows("Requirement")
    .filter((r) => r.Status === "draft" && !writtenBy(run, r) && !editedByPerson(r, "Requirement", jobs))
    .sort((a, b) => (Number(a.SortOrder) || 0) - (Number(b.SortOrder) || 0));
  const objective = p.rows("Objective")[0];
  const objectiveFree = Boolean(objective && objective.Status !== "confirmed" && !editedByPerson(objective, "Objective", jobs));
  if (old.length === 0 && !objectiveFree) return { outputs: [], message: "The team has edited the requirements already; they stay as they are." };
  const answered = p.clarifications().filter((c) => c.Status === "answered").length;
  const replacing = new Set(old.map((r) => str(r.ItemId)));
  const fromAi = old.length ? early(aiDraftRequirements(run, { max: 12, fallbackCount: 0, replacing })) : Promise.resolve(null);
  const aiObj = objectiveFree ? early(aiObjective(run)) : Promise.resolve(null);
  await run.step(6, `Reading ${plural(answered, "answer")} to the questions.`);
  const outputs: string[] = [];
  const drafted = await fromAi;
  let plan: PlannedReq[] = [];
  let followed: Awaited<ReturnType<typeof followAnswers>> | null = null;
  if (drafted && drafted.requirements.length > 0) {
    // the client's answers win: every answer is in the requirements (a second try, else as a criterion), conflicts asked
    await run.step(20, "Checking that every answer is in the requirements.");
    followed = await followAnswers(run, {
      plan: drafted.requirements,
      drafted: drafted.conflicts,
      replacing,
      retry: (fix) => aiDraftRequirements(run, { max: 12, fallbackCount: 0, replacing, fix }),
    });
    plan = followed.plan;
    await run.step(30, `Writing ${plural(plan.length, "requirement")} with the answers.`);
    // the same rows first (in order), then the extra ones, then the ones no longer needed go
    const same = plan.slice(0, old.length);
    const updated = await inParallel(same, 4, async (r, i) => {
      const row = old[i]!;
      await run.update("Requirement", str(row.ItemId), { Title: r.Title, Text: r.Text, Category: r.Category, Priority: r.Priority, AcceptanceCriteria: r.AcceptanceCriteria, SourceRefs: r.SourceRefs });
      return `Requirement:${str(row.ItemId)}`;
    });
    outputs.push(...updated);
    if (plan.length > old.length) outputs.push(...(await writeRequirements(run, plan.slice(old.length), 60, 80)));
    await inParallel(old.slice(plan.length), 4, (r) => run.remove("Requirement", str(r.ItemId)));
  }
  const ai = await aiObj;
  // the objective nobody edited: Claude's, else the person's own objective in the built-in wording
  const objectivePatch = objectiveFree && objective ? (ai ? { ...ai.objective } : statementFromAnswer(run, objective)) : null;
  if (objectivePatch && objective) {
    await run.step(88, "Writing the objective again with the answers.");
    await run.update("Objective", str(objective.ItemId), objectivePatch);
    outputs.push(`Objective:${str(objective.ItemId)}`);
  }
  // the workflows, what is left out and the constraints, when the lists are still empty
  const extras = ai ? withMaterialExclusions(ai.extras, outOfScopeItems(await materialTexts(run).catch(() => []))) : [];
  if (ai && plannedExtras(run, extras).length > 0) {
    await run.step(92, "Adding the key workflows, what is left out and the constraints from the material and your answers.");
    outputs.push(...(await writeSetupExtras(run, extras)));
  }
  const asked = followed ? await askConflicts(run, followed.conflicts) : [];
  outputs.push(...asked);
  if (followed) recordAnswerCheck(run, followed, asked);
  const objectiveLine = objectivePatch ? " Wrote the objective again with your answers." : "";
  if (plan.length === 0) {
    return {
      outputs,
      message: old.length === 0
        ? `The team has edited the requirements already; they stay as they are.${objectiveLine}`
        : `Kept the requirements as they are: the answers could not be worked in right now.${objectiveLine}`,
    };
  }
  return { outputs, message: withAnswers(`Updated the requirements with ${plural(answered, "answer")}: ${plural(plan.length, "requirement")}${objectivePatch ? " and the objective" : ""}.`, asked) };
}

/** focus "requirements" of sanitization.assist: a few further draft requirements, no objective. */
async function assistRequirements(run: JobRun): Promise<KindResult> {
  const builtIn = planRequirements(run, { max: 3 });
  const fromAi = early(aiRequirements(run, { max: 3, fallbackCount: builtIn.length }));
  await run.step(8, "Reading the business notes and the requirements so far.");
  await run.wait(5);
  const plan = (await fromAi) ?? builtIn;
  await run.step(30, plan.length ? `Found ${plural(plan.length, "missing requirement")}.` : "Checking what is missing.");
  await run.wait(3);
  const outputs = await writeRequirements(run, plan, 40, 92);
  return { outputs, message: outputs.length ? `Proposed ${plural(outputs.length, "requirement")}.` : "No missing requirements found." };
}

// ------------------------------------------------------------------------------------------------- review

async function review(run: JobRun): Promise<KindResult> {
  await run.step(6, "Reading the requirements and the objective.");
  await run.wait(4.5);
  await run.step(25, "Checking targets, failure cases, data protection and accessibility.");
  await run.wait(5);
  const plan = planSuggestions(run);
  await run.step(45, plan.length ? `Found ${plural(plan.length, "gap")}.` : "No gaps found.");
  await run.wait(2.5);
  const outputs: string[] = [];
  for (const [i, s] of plan.entries()) {
    await run.step(progressOf(i, plan.length, 55, 94), `Writing suggestion ${i + 1} of ${plan.length}: ${clip(s.Title, 110)}.`);
    const own = mine(run, "Suggestion", s.local);
    const key = own ? str(own.Key) : freeKey(run, "Suggestion", s.Key, s.local, 63);
    const id = own ? str(own.ItemId) : await run.insert("Suggestion", { Source: "engine", Key: key, Title: s.Title, Text: s.Text, Status: "open", EngineJobId: run.id }, s.local);
    outputs.push(`Suggestion:${id}`);
    await run.wait(2.5);
  }
  return {
    outputs,
    message: outputs.length ? `Suggested ${plural(outputs.length, "addition")} to the requirements.` : "The requirements cover the usual gaps; no new suggestions.",
  };
}

// ------------------------------------------------------------------------------------------------- entry points

const assist: KindWriter = async (run) => {
  const focus = str(run.input.focus) || "clarifications";
  if (focus === "technical") return technical(run);
  if (focus === "requirements") return assistRequirements(run);
  return clarifications(run);
};

/** purpose "landingPage": only the add-on's section, after its answers changed. */
async function landingOnly(run: JobRun): Promise<KindResult> {
  await run.step(10, "Reading your answers about the landing page.");
  await run.wait(2.5);
  const written = await writeLandingSection(run, 60);
  return { outputs: [], message: written ? "Wrote the landing page section from your answers." : "The landing page section already matches your answers." };
}

const requirementsDraft: KindWriter = async (run) => {
  const purpose = str(run.input.purpose);
  return purpose === "suggestions" ? review(run) : purpose === LANDING_JOB_PURPOSE ? landingOnly(run) : purpose === "refresh" ? refreshDraft(run) : draft(run);
};

export const WRITERS: Partial<Record<EngineJobKind, KindWriter>> = {
  "sanitization.assist": assist,
  "requirements.draft": requirementsDraft,
};
