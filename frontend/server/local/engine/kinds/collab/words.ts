// Wording helpers of the collaboration writers: role names in the plural and user stories turned into plain sentences.
import { cap } from "../../text.ts";
import type { StoryFact } from "./facts.ts";

/** "driver" → "Drivers", "quality assurance" → "Quality assurance". */
export function pluralActor(actor: string): string {
  const a = actor.trim();
  if (!a) return "People";
  if (/man$/i.test(a)) return cap(a.replace(/man$/i, "men"));
  if (/s$/i.test(a)) return cap(a);
  if (/(er|or|ist|ant|ent|ee|ian|ive|ic|ner|ger|ate|ard|ard)$/i.test(a)) return cap(`${a}s`);
  if (/y$/i.test(a) && !/[aeiou]y$/i.test(a)) return cap(`${a.slice(0, -1)}ies`);
  return cap(a);
}

const PRONOUNS = {
  you: { "I'm": "you're", I: "you", me: "you", my: "your", mine: "yours", myself: "yourself" },
  they: { "I'm": "they're", I: "they", me: "them", my: "their", mine: "theirs", myself: "themselves" },
} as const;

/** "As a driver I see my stops so that I can plan" → "See your stops so that you can plan" (or "they", "their"). */
export function storyAction(s: Pick<StoryFact, "text" | "title">, person: "you" | "they"): string {
  const t = (s.text || s.title).trim().replace(/[.]+$/, "");
  const m = /^as an? [^,]*?(?:,\s*|\s+)i\s+(?:want to\s+|would like to\s+|need to\s+|can\s+)?(.*)$/i.exec(t);
  const body = m ? m[1]! : t;
  const p = PRONOUNS[person];
  const out = body
    .replace(/\bI'm\b/g, p["I'm"])
    .replace(/\bI\b/g, p.I)
    .replace(/\bmyself\b/gi, p.myself)
    .replace(/\bmine\b/gi, p.mine)
    .replace(/\bmy\b/gi, p.my)
    .replace(/\bme\b/gi, p.me);
  return cap(out);
}

/** True when the story text is written as "As a … I …". */
export const isUserStory = (s: Pick<StoryFact, "text">): boolean => /^as an? [^,]*?(?:,\s*|\s+)i\s+/i.test(s.text.trim());

/** "Drivers take a photo of the goods when nobody is there." */
export function storyLine(s: Pick<StoryFact, "text" | "title" | "actor">): string {
  if (isUserStory(s) && s.actor) {
    const action = storyAction(s, "they");
    return `${pluralActor(s.actor)} ${action[0]!.toLowerCase()}${action.slice(1)}.`;
  }
  const t = (s.text || s.title).trim().replace(/[.]+$/, "");
  return `${cap(t)}.`;
}
