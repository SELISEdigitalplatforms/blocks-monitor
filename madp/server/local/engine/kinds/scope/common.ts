// Shared reading of a scope version for the scope writers: the included features with their stories and hours, the
// people in the stories, and the words that tell what kind of work a feature is.
import type { Row } from "../../../../../functions/_lib/gateway";
import type { ProjectView } from "../../context.ts";
import { num, str, strs } from "../../context.ts";
import { cap, lower, wordsOf } from "../../text.ts";

export interface StoryInfo {
  id: string;
  key: string;
  title: string;
  text: string;
  actor: string;
  criteria: string[];
  hours: number;
  sortOrder: number;
}

export interface FeatureInfo {
  id: string;
  key: string;
  ref: string;
  title: string;
  description: string;
  priority: "must" | "nice" | "later";
  requirementRefs: string[];
  sortOrder: number;
  stories: StoryInfo[];
  hours: number;
  /** All words of the feature and its stories (for the classifiers). */
  words: Set<string>;
  text: string;
}

export function storyInfo(r: Row): StoryInfo {
  return {
    id: str(r.ItemId),
    key: str(r.Key),
    title: str(r.Title) || str(r.Text),
    text: str(r.Text),
    actor: str(r.ActorRole),
    criteria: strs(r.AcceptanceCriteria).filter((c) => c.trim() !== ""),
    hours: num(r.EstimateHours),
    sortOrder: num(r.SortOrder),
  };
}

/** The features of a scope version that are in the scope (not dropped), in their order, with their stories. */
export function includedFeatures(p: ProjectView, version: number): FeatureInfo[] {
  const stories = p.stories(version);
  return p.includedFeatures(version).map((f) => {
    const key = str(f.Key);
    const mine = stories.filter((s) => s.FeatureRef === `feature:${key}`).map(storyInfo);
    const pr = str(f.Priority);
    const text = [str(f.Title), str(f.Description), ...mine.map((s) => `${s.title} ${s.text} ${s.criteria.join(" ")}`)].join(" ");
    return {
      id: str(f.ItemId),
      key,
      ref: `feature:${key}`,
      title: str(f.Title) || key,
      description: str(f.Description),
      priority: pr === "nice" || pr === "later" ? pr : "must",
      requirementRefs: strs(f.RequirementRefs),
      sortOrder: num(f.SortOrder),
      stories: mine,
      hours: mine.reduce((h, s) => h + s.hours, 0),
      words: wordsOf(text),
      text: text.toLowerCase(),
    };
  });
}

/** True when any of the patterns occurs in the text (word-start matches). */
export function mentions(text: string, patterns: readonly string[]): boolean {
  const t = text.toLowerCase();
  return patterns.some((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(t));
}

export const WORDS = {
  access: ["sign in", "sign-in", "login", "log in", "password", "account", "sso", "role", "permission", "register", "invite"],
  integration: ["erp", "sap", "abacus", "bexio", "export", "import", "csv", "interface", "api", "sync", "crm", "accounting", "webhook", "booking into"],
  mobile: ["phone", "mobile", "app", "driver", "technician", "on site", "on the go", "plant room", "tablet", "photo", "scan", "camera", "signature", "offline"],
  personal: ["employee", "payslip", "salary", "personal", "signature", "photo", "address", "bank", "birth", "health", "absence", "contact", "private", "tax"],
  desk: ["desk", "office", "back office", "admin", "approve", "approval", "review", "dashboard", "overview", "report", "purchasing", "quality assurance", "dispatcher", "planner", "manager", "employer", "accountant", "laptop", "desktop"],
  notify: ["e-mail", "email", "notification", "reminder", "notify", "sms", "push"],
  money: ["price", "prices", "invoice", "payment", "fee", "chf", "eur", "vat", "salary", "cost", "amount"],
  foundation: ["sign in", "login", "account", "catalogue", "catalog", "master data", "register", "profile", "list of", "search", "price list", "route of the day", "my "],
} as const;

/** The most frequent story actor of the features, or "". */
export function mainActor(features: readonly FeatureInfo[]): string {
  const count = new Map<string, number>();
  for (const f of features) for (const s of f.stories) if (s.actor) count.set(s.actor, (count.get(s.actor) ?? 0) + 1);
  let best = "";
  let n = 0;
  for (const [a, c] of count) if (c > n) [best, n] = [a, c];
  return best;
}

/** Every distinct story actor, in first-seen order. */
export function actorsOf(features: readonly FeatureInfo[]): string[] {
  const out: string[] = [];
  for (const f of features) for (const s of f.stories) if (s.actor && !out.includes(s.actor)) out.push(s.actor);
  return out;
}

const GROUPS = /(desk|team|office|department|staff|assurance|management|purchasing|payroll|accounting|sales|support|service)$/i;

/** "a customer", "an employee", "the order desk". */
export function aActor(actor: string): string {
  const a = actor.replace(/[-_]+/g, " ").trim() || "user";
  if (GROUPS.test(a)) return `the ${lower(a)}`;
  return `${/^[aeiou]/i.test(a) ? "an" : "a"} ${lower(a)}`;
}

/** "customers", "the order desk". */
export function actorsPlural(actor: string): string {
  const a = lower(actor.replace(/[-_]+/g, " ").trim() || "user");
  if (GROUPS.test(a)) return `the ${a}`;
  if (/(s|x|ch|sh)$/.test(a)) return `${a}es`;
  if (/[^aeiou]y$/.test(a)) return `${a.slice(0, -1)}ies`;
  return `${a}s`;
}

/** A first-person story title as a third-person phrase: "See my own prices" -> "see their own prices". */
export function thirdPerson(title: string): string {
  return lower(title.trim())
    .replace(/\bmy\b/gi, "their")
    .replace(/\bI am\b/g, "they are")
    .replace(/\bI\b/g, "they")
    .replace(/\bme\b/gi, "them")
    .replace(/\bmine\b/gi, "theirs")
    .replace(/[.]+$/, "");
}

export const capFirst = cap;

const BASE_VERBS = new Set(
  "see add get find search pick record change choose start open follow repeat receive upload take enter send sign check approve view show report scan book pay read edit create track work be know use mark update download print export import filter plan accept reject confirm cancel request answer list set keep select attach review close register log invite compare share submit order fill photograph capture call reply write reuse rate place sort assign move return refuse print sync drop".split(" "),
);

const baseOf = (verb: string): string =>
  /(ches|shes|sses|xes)$/.test(verb) ? verb.slice(0, -2) : /ies$/.test(verb) ? `${verb.slice(0, -3)}y` : /[^s]s$/.test(verb) ? verb.slice(0, -1) : verb;

/** What a story lets its actor do, after "can": "See my own prices" -> "see their own prices", "Driver starts the
 *  route" -> "start the route", "Customer signs on the phone" (a driver's story) -> "let the customer sign on the phone". */
export function ability(title: string, actor: string): string {
  const words = title.trim().replace(/[.]+$/, "").split(/\s+/);
  const head = (words[0] ?? "").toLowerCase();
  if (words.length < 3 || BASE_VERBS.has(head)) return thirdPerson(title);
  const a = actor.replace(/[-_]+/g, " ").trim().toLowerCase();
  const last = a.split(" ").pop() ?? a;
  const verb = baseOf(words[1]!.toLowerCase());
  const rest = words.slice(2).join(" ");
  if (a && (head === a || head === `${a}s` || head === last || head === `${last}s`)) return thirdPerson(`${verb} ${rest}`);
  // "<Someone> signs ..." / "<People> see ...": a sentence about someone else; anything else is the actor's own action.
  const third = /^[a-z]+[^s]s$/.test(words[1]!.toLowerCase()) || (/[^s]s$/.test(head) && BASE_VERBS.has(words[1]!.toLowerCase()));
  if (!third) return thirdPerson(title);
  const plural = /[^s]s$/.test(head);
  return thirdPerson(`let ${plural ? head : `the ${head}`} ${verb} ${rest}`);
}
