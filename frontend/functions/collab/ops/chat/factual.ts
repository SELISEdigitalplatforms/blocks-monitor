// Factual agent-chat questions ("Which step is the project at?"): answered from real records, never by an engine job.
import { replyFor, type ChatFacts } from "../../../../src/domain/agentChat";
import { STEP_LABEL } from "../../../../src/domain/journey";

export type FactualTopic = "step" | "objective" | "plan" | "working" | "release" | "blockers";

const QUESTION_START = /^(?:what|which|where|when|who|how|is|are|has|have|do|does|did|can)\b/;

/** Call only for a conversation that topicOf() could not place. null = a genuinely open question. */
export function factualTopicOf(text: string): FactualTopic | null {
  const t = text.toLowerCase().trim();
  if (!t.endsWith("?") && !QUESTION_START.test(t)) return null;
  if (/\b(?:step|stage|phase)\b|\bwhere are we\b|\bwhere is the project\b|\bat which\b/.test(t)) return "step";
  if (/\b(?:objective|goal|aim|purpose)\b/.test(t)) return "objective";
  if (/\b(?:milestones?|features?|stor(?:y|ies)|requirements?)\b/.test(t)) return "plan";
  if (/\b(?:tickets?|board|column)\b/.test(t)) return "working";
  if (/\bchange requests?\b|\bopen changes\b/.test(t)) return "blockers";
  return null;
}

export function factualReply(
  topic: FactualTopic,
  i: { projectName: string; step: string; objective: string | null; facts: ChatFacts; n: number },
): string {
  if (topic === "step") {
    const label = (STEP_LABEL as Record<string, string | undefined>)[i.step];
    return label ? `${i.projectName} is at ${label}.` : replyFor("plan", i.facts, i.n);
  }
  if (topic === "objective") return i.objective ? `The objective is: “${i.objective}”.` : "No objective is saved for this project yet.";
  return replyFor(topic, i.facts, i.n);
}
