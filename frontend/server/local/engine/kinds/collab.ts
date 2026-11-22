// Writers of the collaboration kinds: chat.reply (3D-office agents and the release assistant), fix.analyse (the bug
// analysis behind "Start the fix") and wiki.generate. Each reads the question or the records (a chat answer at once,
// the others for a believable moment) and writes its answer row before the job finishes (the screens re-read when the job leaves the active states).
import type { Row } from "../../../../functions/_lib/gateway";
import { isChatRole, type ChatRole } from "../../../../src/domain/agentChat";
import { parseAttachmentNotes } from "../../../../src/domain/assistant";
import type { EngineJobKind } from "../../../../src/domain/engineJob";
import { parseSources } from "../../../../src/domain/wiki";
import { str } from "../context.ts";
import { parseInput, type JobRun, type KindResult, type KindWriter } from "../run.ts";
import { agentReply, assistantReply } from "./collab/chat.ts";
import { readCalibration } from "../estimates.ts";
import { loadFacts } from "./collab/facts.ts";
import { analyseBug, analysisText } from "./collab/fix.ts";
import { early } from "../ai/index.ts";
import { aiAgentReply, aiAssistantReply } from "./collab/ai.ts";
import { actionStateOf, continueAnswer, offerRow, streamsAnswer } from "./collab/actions.ts";
import { continueAsked } from "../../../../src/domain/continueIncrements";
import { availableActions, streamsAsked } from "../../../../src/domain/chatActions";
import { editedByPerson, existingPageFor, mergeBody, planWiki, sourcesJson, wikiVersion } from "./collab/wiki.ts";

const ENVS = new Set(["dev", "stage", "production"]);

/** The user message the job answers. The op links it right after queuing, so a fresh job may not carry it yet. */
async function questionOf(run: JobRun, schema: "AgentChatMessage" | "AssistantMessage", field: "messageId" | "assistantMessageId"): Promise<Row> {
  for (let i = 0; i < 6; i++) {
    const input = parseInput(run.job.InputJson);
    const id = str(input[field]) || str(run.input[field]);
    const byId = id ? run.deps.store.get(schema, id) : undefined;
    if (byId && byId.ProjectId === run.projectId) return byId;
    const linked = run.deps.store.rows(schema).find((m) => m.ProjectId === run.projectId && m.EngineJobId === run.id && (m.Role === "user" || !m.Role));
    if (linked) return linked;
    await run.wait(1, 0);
  }
  throw new Error("the message to answer was not found");
}

/** An ISO time after the question (the thread is sorted by At). */
function answerAt(run: JobRun, question: Row): string {
  const now = run.now().getTime();
  const asked = Date.parse(str(question.At));
  return new Date(Number.isFinite(asked) && asked >= now ? asked + 1 : now).toISOString();
}

function people(run: JobRun): { assignee: string; creator: string } {
  const p = run.p.project;
  return { assignee: run.p.personName(str(p.AssigneeUserId)), creator: run.p.personName(str(p.CreatedByUserId)) };
}

async function chatReply(run: JobRun): Promise<KindResult> {
  const thread = str(run.input.thread) === "assistant" ? "assistant" : "agent";
  const schema = thread === "assistant" ? "AssistantMessage" : "AgentChatMessage";
  // A chat answer is read while the person waits: the question is read and Claude starts at once, the progress
  // lines go out beside it, and nothing waits on purpose (the answer is written the moment it is there).
  const [question] = await Promise.all([questionOf(run, schema, "messageId"), run.step(8, "Reading the question.")]);
  const text = str(question.Text);
  const facts = loadFacts(run.p);
  const role: ChatRole = isChatRole(run.input.threadId) ? run.input.threadId : isChatRole(question.AgentRole) ? question.AgentRole : "planner";
  const envRaw = str(run.input.threadId) || str(question.Environment);
  const env = ENVS.has(envRaw) ? envRaw : "dev";
  // "use 3 parallel streams" to the tech lead: answered from the records with the offer that sets it (no model)
  const settings = thread === "agent" && role === "dev" && availableActions(actionStateOf(run.p)).includes("parallel-streams");
  const streams = settings ? streamsAsked(text) : null;
  // "continue with the next increment automatically" (or "stop continuing by itself") to the tech lead: the same way
  const continuing = settings && streams === null ? continueAsked(text) : null;
  // Claude's answer (else the built-in answer from the records)
  const agentAi = streams !== null ? Promise.resolve(streamsAnswer(run.p, streams))
    : continuing !== null ? Promise.resolve(continueAnswer(run.p, continuing))
    : thread === "agent" ? early(aiAgentReply(run, { role, question, facts, thread: run.p.rows("AgentChatMessage").filter((m) => m.AgentRole === role), events: run.p.rows("TicketEvent") })) : Promise.resolve(null);
  const assistantAi = thread === "assistant" ? early(aiAssistantReply(run, { env, question, facts, thread: run.p.rows("AssistantMessage").filter((m) => m.Environment === env) })) : Promise.resolve(null);
  await run.step(35, thread === "assistant" ? "Looking at what runs there." : "Looking at the board and the scope.");

  if (thread === "agent") {
    const events = run.p.rows("TicketEvent").sort((a, b) => str(a.At).localeCompare(str(b.At)));
    const ai = await agentAi;
    // the built-in answer names build times only from the real estimates (read only when it is needed)
    const reply = ai?.text ?? agentReply(facts, role, text, { events, people: people(run), key: run.id, estimates: await readCalibration(run) });
    const at = answerAt(run, question);
    const id = await run.insert(
      "AgentChatMessage",
      { AgentRole: role, Role: "agent", Kind: "text", Text: reply, AuthorUserId: "", EngineJobId: run.id, At: at },
      "reply",
    );
    // The one action the answer offers (kinds/collab/actions.ts), as its own message right under it: the person taps it
    // and the op runs as them. Nothing is done here.
    if (ai?.offer) {
      const offerId = await run.insert("AgentChatMessage", offerRow(role, ai.offer, { jobId: run.id, at: new Date(Date.parse(at) + 1).toISOString() }), "offer");
      return { outputs: [`AgentChat:${id}`, `AgentChat:${offerId}`], message: `Answered, offering: ${ai.offer.title}.` };
    }
    return { outputs: [`AgentChat:${id}`], message: "Answered." };
  }

  const fromAi = await assistantAi;
  const answer = fromAi ? { text: fromAi.text, points: fromAi.points, refs: [] } : assistantReply(facts, env, text, run.p.rows("WikiPage"), run.id);
  const id = await run.insert(
    "AssistantMessage",
    {
      Environment: env,
      Role: "assistant",
      Kind: "text",
      Text: answer.text,
      Points: answer.points,
      RefsJson: JSON.stringify(answer.refs),
      AttachmentsJson: "[]",
      AnalysisJson: "",
      FixState: "none",
      EngineJobId: run.id,
      At: answerAt(run, question),
    },
    "reply",
  );
  return { outputs: [`AssistantMessage:${id}`], message: "Answered." };
}

async function fixAnalyse(run: JobRun): Promise<KindResult> {
  const envRaw = str(run.input.environment);
  await run.step(6, `Reproducing the report on ${ENVS.has(envRaw) ? envRaw : "dev"}.`);
  const report = await questionOf(run, "AssistantMessage", "assistantMessageId");
  const env = ENVS.has(envRaw) ? envRaw : ENVS.has(str(report.Environment)) ? str(report.Environment) : "dev";
  await run.wait(6);
  await run.step(38, "Tracing the cause in the code.");
  const facts = loadFacts(run.p);
  const analysis = analyseBug(facts, {
    report: str(report.Text),
    attachments: parseAttachmentNotes(str(report.AttachmentsJson)).map((a) => ({ name: a.name, excerpt: a.excerpt })),
    env,
    region: str(run.p.project.ClientRegion),
  });
  await run.wait(7);
  await run.step(76, "Writing the fix plan.");
  await run.wait(4);
  const id = await run.insert(
    "AssistantMessage",
    {
      Environment: env,
      Role: "assistant",
      Kind: "analysis",
      Text: analysisText(analysis),
      Points: [],
      RefsJson: "[]",
      AttachmentsJson: "[]",
      AnalysisJson: JSON.stringify(analysis),
      FixState: "offered",
      EngineJobId: run.id,
      At: answerAt(run, report),
    },
    "analysis",
  );
  return { outputs: [`AssistantMessage:${id}`], message: "Analysed the report." };
}

async function wikiGenerate(run: JobRun): Promise<KindResult> {
  await run.step(4, "Reading the scope, the build and the releases.");
  const facts = loadFacts(run.p);
  const planned = planWiki(facts);
  const version = wikiVersion(facts);
  await run.wait(4);
  const outputs: string[] = [];
  let created = 0;
  let updated = 0;
  const per = Math.max(1.5, Math.min(5, 24 / Math.max(1, planned.length)));
  const claimed = new Set<string>();
  for (const [i, page] of planned.entries()) {
    await run.wait(per);
    const existing = existingPageFor(run.p.rows("WikiPage"), page, claimed);
    if (existing) claimed.add(str(existing.ItemId));
    if (!existing) {
      const id = await run.insert(
        "WikiPage",
        {
          Slug: page.slug,
          PageGroup: page.group,
          Title: page.title,
          BodyMd: page.body,
          SourcesJson: sourcesJson(page),
          UpdatedWithVersion: version,
          Origin: "factory",
          EngineJobId: run.id,
        },
        `page:${page.slug}`,
      );
      outputs.push(`WikiPage:${id}`);
      created += 1;
    } else if (!editedByPerson(existing, run.p.rows("WikiPageHistory"))) {
      const id = str(existing.ItemId);
      const old = parseSources(str(existing.SourcesJson));
      const refs = new Set(old.items.map((s) => s.ref));
      const items = [...old.items, ...page.sources.filter((s) => !refs.has(s.ref))].slice(0, 20);
      await run.update("WikiPage", id, {
        BodyMd: mergeBody(str(existing.BodyMd), page, facts),
        SourcesJson: JSON.stringify({ order: old.order ?? page.order, items }),
        UpdatedWithVersion: version || str(existing.UpdatedWithVersion),
        EngineJobId: run.id,
      });
      outputs.push(`WikiPage:${id}`);
      updated += 1;
    }
    await run.step(8 + Math.round((88 * (i + 1)) / planned.length), `Writing “${page.title}”.`);
  }
  const n = created + updated;
  const message =
    created > 0 && updated === 0
      ? `Wrote ${n} wiki pages from the scope, the build and the releases.`
      : created === 0
        ? `Updated ${updated} wiki pages from the scope, the build and the releases${version ? ` of ${version}` : ""}.`
        : `Wrote ${created} new and updated ${updated} wiki pages from the scope, the build and the releases.`;
  return { outputs, message };
}

/** docs.generate: Agent 06-docs on demand. The local simulator writes nothing and says so; the Blocks engine worker
 *  never runs this writer (server/blocks/engineWorker/realWorkOnly.ts): there the job fails plainly until the on-demand
 *  documentation has a real implementation. */
async function docsGenerate(run: JobRun): Promise<KindResult> {
  await run.step(10, "Reading the project artifacts and build results.");
  await run.wait(6);
  await run.step(40, "Writing the project documentation.");
  await run.wait(8);
  await run.step(80, "Formatting and saving the documentation files.");
  await run.wait(4);
  return { outputs: [], message: "Project documentation generated." };
}

export const WRITERS: Partial<Record<EngineJobKind, KindWriter>> = {
  "chat.reply": chatReply,
  "fix.analyse": fixAnalyse,
  "wiki.generate": wikiGenerate,
  "docs.generate": docsGenerate,
};
