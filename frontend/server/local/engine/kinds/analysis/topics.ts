// The subjects a business analyst asks about: each with the words that reveal it, the question to ask, and what a
// requirement on it is checked against. The texts use the project's own words (its people, objects and systems).
import { cap, listOf } from "../../text.ts";
import { actorLabel, type Facts, mainActor } from "./facts.ts";
import { article, singularOf, thingsIn } from "./grammar.ts";

export type Category = "functional" | "integration" | "nfr" | "security" | "data" | "ux" | "other";

export interface TopicCtx {
  /** The line the topic was found in ("" for project-wide topics). */
  line: string;
  facts: Facts;
  /** People group of the line, else of the project. */
  actor: string;
  /** Business objects of the line, else of the project. */
  things: string[];
  system: string | null;
  productNoun: string;
  region: string;
}

export interface Topic {
  id: string;
  match: RegExp;
  /** Asked only when the project's text matches (project-wide topics without a line). */
  projectWide?: (f: Facts, region: string) => boolean;
  question(c: TopicCtx): string;
  title?(c: TopicCtx): string;
  criteria(c: TopicCtx): string[];
  category: Category;
}

const things = (c: TopicCtx, fallback = "documents"): string => listOf(c.things.length ? c.things : [fallback]);
const thing = (c: TopicCtx, fallback = "document"): string => singularOf(c.things[0] ?? fallback);
const who = (c: TopicCtx): string => actorLabel(c.actor);
const one = (c: TopicCtx): string => actorLabel(singularOf(c.actor));
const days = (line: string): number[] =>
  [...line.matchAll(/\b(\d{1,3})(?:\s*(?:and|,|or)\s*(\d{1,3}))?\s+days?\b/gi)].flatMap((m) => [Number(m[1]), ...(m[2] ? [Number(m[2])] : [])]).filter((n) => n > 0);
const mb = (text: string): number | null => {
  const m = /\b(\d{1,3})\s*MB\b/i.exec(text);
  return m ? Number(m[1]) : null;
};

export const TOPICS: Topic[] = [
  {
    id: "upload",
    match: /\b(upload|uploads|uploaded|photo|photos|camera|scan|attach)\w*/i,
    category: "functional",
    question: (c) => {
      const size = mb(c.facts.all);
      return size
        ? `Today uploads fail above ${size} MB: which file types and what maximum size must ${who(c)} be able to upload for ${things(c)}, and several files at once?`
        : `Which file types and what maximum file size must ${who(c)} be able to upload for ${things(c)}, and should several files go up in one step?`;
    },
    title: (c) => `${cap(who(c))} upload ${things(c)}`,
    criteria: (c) => [
      `Several ${c.things[0] ?? "files"} can be uploaded in one go`,
      "Photos from the phone camera and PDF files are accepted",
      "A failed upload says why and can be repeated",
    ],
  },
  {
    id: "expiry",
    match: /\b(expir\w*|valid until|validity|renew\w*|out of date)\b/i,
    category: "functional",
    question: (c) =>
      `What should happen when ${article(thing(c, "certificate"))} has expired: only a reminder, or is the ${one(c)} blocked until a valid one is uploaded?`,
    title: (c) => `Expiring ${things(c, "certificates")} are flagged in time`,
    criteria: (c) => {
      const d = days(c.line)[0] ?? 30;
      return [
        `Every ${thing(c, "certificate")} is stored with its expiry date`,
        `${cap(c.things[0] ?? "certificates")} that expire within the next ${d} days are listed first`,
        `An expired ${thing(c, "certificate")} is clearly marked`,
      ];
    },
  },
  {
    id: "reminder",
    match: /\b(remind\w*|notif\w*|alert\w*|sms)\b/i,
    category: "functional",
    question: (c) => {
      const d = days(c.line);
      return d.length
        ? `Reminders go out ${listOf(d.map(String))} days before: who receives them besides the ${one(c)}, and what happens when nobody reacts?`
        : `Who receives the reminders and notifications, through which channel (e-mail, SMS or in the app), and how many days in advance?`;
    },
    title: (c) => `Reminders before ${thing(c, "deadline")} deadlines`,
    criteria: (c) => {
      const d = days(c.line);
      return [
        d.length >= 2 ? `Reminders go out ${d[0]} and ${d[1]} days before the date` : d.length === 1 ? `A reminder goes out ${d[0]} days before the date` : "A reminder goes out before the due date",
        "No reminder is sent once the item is complete",
        "Every reminder sent is visible in the history",
      ];
    },
  },
  {
    id: "login",
    match: /\b(login|log in|logins|sign in|sign-in|account|accounts|password|register\w*|link per)\b/i,
    category: "security",
    question: (c) =>
      `How do ${who(c)} sign in: with their own account and password, with a personal link per request, or through single sign-on?`,
    title: (c) => `${cap(who(c))} sign in securely`,
    criteria: (c) => [
      `${cap(who(c))} sign in with e-mail and password or a one-time code`,
      "A forgotten password can be reset without calling support",
      "Accounts of people who leave can be deactivated the same day",
    ],
  },
  {
    id: "approval",
    match: /\b(approv\w*|sign[- ]off|four[- ]eyes|check(?:ed)? by|call-back)\b/i,
    category: "functional",
    question: (c) =>
      `Who approves ${things(c)}, are two people needed for some cases (four-eyes principle), and what happens to a rejected one?`,
    title: (c) => `${cap(things(c, "registrations"))} are approved in one place`,
    criteria: (c) => [
      "Approve and reject are recorded with name, date and comment",
      `A rejected ${thing(c, "request")} goes back with the reason`,
      "Open approvals are listed with their waiting time",
    ],
  },
  {
    id: "signature",
    match: /\b(signature|signatures|e-?sign\w*|sign (?:the|documents?|online))\b/i,
    category: "integration",
    question: () =>
      "Which signature level is needed (simple, advanced or qualified electronic signature under ZertES), and is a provider already under contract?",
    title: (c) => `${cap(things(c, "documents"))} are signed online`,
    criteria: (c) => [
      `The ${one(c)} is told when a document is ready to sign`,
      "The signed document is stored with its signature evidence",
      "The signer receives a copy by e-mail",
    ],
  },
  {
    id: "integration",
    match: /\b(erp|sap|abacus|bexio|proffix|navision|dynamics|salesforce|sharepoint|crm|datev|(?<!user )interface|api|import|accounting software|payroll software|order portal)\b/i,
    category: "integration",
    question: (c) =>
      `How should ${c.system ?? "the existing systems"} and the new ${c.productNoun} exchange data: a live interface, a scheduled file export, or by hand in the first phase?`,
    title: (c) => `Data exchange with ${c.system ?? "the existing systems"}`,
    criteria: (c) => [
      `Data reaches ${c.system ?? "the connected system"} without typing it again`,
      "A failed transfer is reported to the person responsible",
      "Each transfer is logged with time and number of records",
    ],
  },
  {
    id: "offline",
    match: /\b(offline|no (?:signal|reception|network)|reception|cellar|basement|plant rooms?|on the road|at the customer)\b/i,
    category: "nfr",
    question: () => "Must the app keep working without mobile reception, and how long may unsent entries stay on the device?",
    title: () => "Works without mobile reception",
    criteria: () => ["Entries made without reception are kept on the device", "They are sent automatically once the connection is back", "The user sees which entries are still waiting"],
  },
  {
    id: "threshold",
    match: /\b(temperature|too warm|too cold|threshold|limits?|tolerance|out of range|failed deliver\w*)\b/i,
    category: "functional",
    question: (c) =>
      /temperature|warm|cold/i.test(c.line)
        ? `Which temperature limits apply per product group, who maintains them, and from when does a delivery count as failed?`
        : `Which limits apply, who maintains them, and what happens when one is exceeded?`,
    title: (c) => (/temperature|warm|cold/i.test(c.line) ? "Failed deliveries are visible per supplier" : "Values outside the limits are flagged"),
    criteria: (c) => [
      /temperature|warm|cold/i.test(c.line) ? "A delivery outside the temperature limits is marked as failed" : "A value outside the limits is marked",
      `Failed ones are listed per ${one(c)} with the evidence attached`,
      "The limits can be changed without a new release",
    ],
  },
  {
    id: "overview",
    match: /\b(overview|at a glance|dashboard|list of|report(?:ing)?|statistics?|kpis?)\b/i,
    category: "ux",
    question: (c) => `Which figures and filters does the overview of ${things(c)} need, and should it be exported to Excel or PDF?`,
    title: (c) => `Overview of ${things(c)}`,
    criteria: (c) => [`The overview can be filtered by ${one(c)} and period`, "It opens within 2 seconds", "It can be exported to Excel"],
  },
  {
    id: "status",
    match: /\b(status|track\w*|follow\w* up|progress|where .* stands)\b/i,
    category: "functional",
    question: (c) => `Which status steps must ${who(c)} see, and who moves ${things(c, "requests")} from one step to the next?`,
    title: (c) => `${cap(who(c))} see the status of ${things(c, "their requests")}`,
    criteria: () => ["Every status change is shown with date and time", "The person concerned is informed when the status changes"],
  },
  {
    id: "search",
    match: /\b(search\w*|find\w*|filter\w*|look up)\b/i,
    category: "ux",
    question: (c) => `By which fields must ${things(c)} be searchable and filterable (name, number, date, ${one(c)})?`,
    title: (c) => `Search and filter ${things(c)}`,
    criteria: () => ["Search by name, number and date", "Results appear while typing", "Filters can be combined"],
  },
  {
    id: "migration",
    match: /\b(shared folder|sharepoint|excel|existing (?:data|documents|portal|accounts)|migrat\w*|take over|archive)\b/i,
    category: "data",
    question: (c) => {
      const place = /shared folder/i.test(c.line) ? "the shared folder" : /sharepoint/i.test(c.line) ? "SharePoint" : /excel/i.test(c.line) ? "the Excel lists" : "the current system";
      return `Should the existing ${things(c)} from ${place} be taken over before go-live, and from how far back?`;
    },
    title: (c) => `Existing ${things(c)} are taken over`,
    criteria: (c) => [`Existing ${things(c)} are imported before go-live`, "Nothing has to be entered twice", "Imported records keep their original dates"],
  },
  {
    id: "bank",
    match: /\b(bank details|iban|payment details|bank account)\b/i,
    category: "security",
    question: () => "How are bank details verified before the first payment, and who may change them afterwards?",
    title: () => "Bank details are verified before use",
    criteria: () => ["New or changed bank details need a second person's approval", "Every change of bank details is logged with name and time"],
  },
  {
    id: "deadline",
    match: /\b(before the|by the end of|deadline|go-?live|launch|first look)\b/i,
    category: "other",
    question: (c) => {
      const date = c.facts.dates.find((d) => c.line.includes(d));
      const event = /before the ([a-z ]{3,30}?)(?: on|$|,|\.)/i.exec(c.line)?.[1];
      return date
        ? `What must be ready by ${date}${event ? ` for the ${event}` : ""}: a first version to show, or one that ${who(c)} already use?`
        : `By when is a first version needed, and what must it already do then?`;
    },
    criteria: () => [],
  },
  {
    id: "budget",
    match: /\b(budget|cost frame|costs?|price frame)\b/i,
    category: "other",
    question: () => "Is there a budget frame for the first phase, and who decides on it?",
    criteria: () => [],
  },
  {
    id: "privacy",
    match: /\b(personal data|privacy|data protection|gdpr|nfadp|secrecy|confidential|data must stay|stay in switzerland)\b/i,
    projectWide: () => true,
    category: "nfr",
    question: () => "Which personal data is stored, who may see it, and how long must it be kept before it is deleted?",
    title: () => "Personal data is kept only as long as needed",
    criteria: () => ["Each kind of record has a retention period", "Records past their retention period are deleted or anonymised", "Access to personal data is logged"],
  },
  {
    id: "hosting",
    match: /\b(switzerland|swiss|data cent(?:re|er)|hosted|hosting|on[- ]premise)\b/i,
    category: "nfr",
    question: () => "Where must the data be hosted: a Swiss data centre, the company's own data centre, or a Swiss cloud region?",
    title: () => "Data stays in Switzerland",
    criteria: () => ["All data and files are stored in a Swiss data centre", "Backups stay in Switzerland as well"],
  },
  {
    id: "roles",
    match: /\b(roles?|permissions?|access rights|who may|admin\w*)\b/i,
    projectWide: () => true,
    category: "security",
    question: (c) => `Which roles are needed besides ${who(c)}, and what may each of them see and change?`,
    title: () => "Roles and permissions",
    criteria: () => ["Each person sees only the records of their own company", "Administrators manage roles without a developer"],
  },
  {
    id: "languages",
    match: /\b(language|languages|german|french|italian|multilingual|translat\w*)\b/i,
    projectWide: (f, region) => /switzerland|zurich|bern|basel|geneva|lausanne|lucerne|st\.? gallen|swiss/i.test(`${region} ${f.all}`),
    category: "ux",
    question: () => "Which languages does the user interface need: German only, or also French, Italian and English?",
    title: () => "User interface in German and French",
    criteria: () => ["Every screen and e-mail is available in German and French", "Each person chooses their language"],
  },
];

export function topicById(id: string): Topic | undefined {
  return TOPICS.find((t) => t.id === id);
}

/** The topics a text is about, in table order. */
export function topicsOf(text: string): Topic[] {
  return TOPICS.filter((t) => t.match.test(text));
}

/** The topics a text is about, the one it names first first. */
export function topicsByPosition(text: string): Topic[] {
  return topicsOf(text)
    .map((t) => ({ t, at: text.search(t.match) }))
    .sort((a, b) => a.at - b.at)
    .map((x) => x.t);
}

export function ctxFor(facts: Facts, line: string, o: { productNoun: string; region: string }): TopicCtx {
  const lineActor = facts.actors.find((a) => new RegExp(`\\b${a.name.replace(/[-/]/g, "\\$&")}\\b`, "i").test(line))?.name;
  const lineThings = thingsIn(line);
  const sys = facts.systems.find((s) => line.toLowerCase().includes(s.toLowerCase())) ?? facts.systems[0] ?? null;
  return {
    line,
    facts,
    actor: lineActor ?? mainActor(facts).name,
    things: lineThings.length ? lineThings : thingsIn(facts.all, 2),
    system: sys,
    productNoun: o.productNoun,
    region: o.region,
  };
}

/** "portal", "app", "webshop": what the project builds, from its name and brief. */
export function productNounOf(name: string, brief: string): string {
  const t = `${name} ${brief}`.toLowerCase();
  if (/\bwebshop|web shop|shop\b/.test(t)) return "webshop";
  if (/\bportal\b/.test(t)) return "portal";
  if (/\bapp\b|phone|tablet|mobile/.test(t)) return "app";
  return "application";
}
