// Plain names for what the scope writers make from a requirement sentence: a feature name ("Book a class online"),
// a screen name ("Book a class", "Guest list", "Document approvals"), the person in it ("customer") and what they want
// ("book a class online and pay by card or TWINT"). Requirements are written by people and by the requirements draft,
// so a title may be a sentence ("Staff see the guest list per class"), a passive ("Documents are approved in one
// place"), a statement about a thing ("A confirmation email goes out for every order"), a wish ("The application
// should: reminder e-mail one day before"), a label ("Table turn planner: show each room's status") or a noun phrase
// ("Delivery status"). Pure: no I/O.
import { cap, clip, lower } from "../../text.ts";

/** "The application should:", "The system must", "It should", "We need" — the lead-in before the actual wish. */
const LEAD = /^(?:(?:the\s+)?(?:application|system|app|portal|platform|tool|solution|software|website|site|product)|it|we|you)\s+(?:should|must|shall|will|can|needs?\s+to|has\s+to|have\s+to|is\s+able\s+to)\b\s*:?\s*/i;
const MODAL = new Set(["can", "could", "must", "should", "shall", "will", "may", "need", "needs", "want", "wants", "able", "have", "has", "to", "always", "also", "only", "easily", "quickly", "is", "are"]);
const BE = new Set(["are", "is", "get", "gets", "be", "been"]);
const DETERMINERS = new Set(["the", "a", "an", "my", "their", "our", "your", "his", "her", "its", "all", "every", "each", "any", "some", "this", "that", "these", "those"]);
/** Words that only qualify the thing ("only my articles", "their own prices"). */
const FILLER = new Set(["only", "own", "just", "both", "also", "even", "exactly"]);
const PREPOSITIONS = new Set(["per", "against", "across", "around", "between", "for", "in", "on", "at", "by", "with", "from", "to", "of", "before", "after", "until", "within", "into", "via", "over", "under", "without", "during", "through", "so", "because", "when", "while", "if", "instead", "than", "as", "where", "who", "which", "that"]);
const PARTICLES = new Set(["in", "out", "up", "off", "on", "back", "down"]);
const RELATIVE = /\b(when|if|where|who|which|that|whose|whenever|unless)\b/i;
const NUMBERS = new Set(["first", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "once", "twice", "daily", "weekly", "monthly"]);
const ADVERBS = new Set(["online", "securely", "easily", "quickly", "automatically", "directly", "again", "anywhere", "anytime", "safely", "fast", "immediately", "instantly", "together", "themselves", "myself", "yourself", "first", "later", "now", "today", "live", "monthly", "weekly", "daily"]);

/** Verbs a requirement states its action with (base forms). Nouns that are also verbs ("order", "report") are fine:
 *  a verb only counts where the sentence shape says so (see verbAt). */
const VERBS = new Set(
  ("see view list browse find search filter sort compare follow track check get receive read open show display watch " +
    "book reserve buy order pay sell return cancel change edit update delete remove add create enter record register " +
    "sign log approve reject confirm review accept request submit send share invite notify remind message chat call " +
    "upload download import export print scan photograph capture attach plan schedule assign dispatch route " +
    "manage handle keep store archive count calculate report rate comment answer reply choose select pick repeat " +
    "start stop finish complete close fill take use set link connect sync match invoice bill rent deliver collect " +
    "move transfer reuse save mark tag rename publish monitor measure test learn train help support build reach go " +
    "come work fit end ship write carry comply respect turn type flag alert hand give leave join meet prepare " +
    "load unload count weigh pack label sign").split(" "),
);

/** The verbs of looking at something: their screen is named after the thing ("see the guest list" -> "Guest list"). */
const LOOK = new Set(["see", "view", "list", "browse", "find", "search", "follow", "track", "check", "get", "receive", "read", "open", "show", "display", "monitor", "compare", "watch"]);
/** The verbs of a connection to another system ("Orders reach the ERP", "It fits SAP"). */
const LINK = new Set(["reach", "fit", "connect", "sync", "link"]);

/** People (and teams) a requirement is about; anything else in the subject is a thing ("orders", "the app"). */
const PERSON = /(customer|client|staff|employee|employer|driver|technician|partner|manager|desk|team|user|buyer|guest|agronomist|operator|dispatch|dispatcher|planner|member|admin|administrator|owner|supplier|patient|student|teacher|visitor|worker|nurse|doctor|accountant|clerk|engineer|agent|seller|chef|farmer|courier|sales|support|reception|receptionist|housekeeping|trainer|instructor|tenant|resident|parent|coach|cook|waiter|host|organiser|organizer|approver|reviewer|auditor|inspector|dealer|retailer|merchant|vendor|shopper|subscriber|participant|attendee|applicant|candidate|recruiter|HR|people|person|everyone)s?$/i;

/** Participles of a passive ("are approved") and the noun of the activity ("approval"). */
const ACTIVITY: Record<string, string> = {
  approved: "approval", signed: "signature", booked: "booking", paid: "payment", checked: "check", recorded: "record",
  stored: "storage", sent: "dispatch", shown: "overview", listed: "list", exported: "export", imported: "import",
  updated: "update", tracked: "tracking", planned: "planning", scheduled: "schedule", reminded: "reminder",
  notified: "notification", uploaded: "upload", archived: "archive", shared: "sharing", calculated: "calculation",
  reported: "report", processed: "processing", invoiced: "invoicing", registered: "registration", confirmed: "confirmation",
  validated: "check", matched: "matching", scanned: "scan", reviewed: "review", assigned: "assignment", ordered: "order",
  delivered: "delivery", collected: "collection", counted: "count", logged: "log", requested: "request", released: "release",
  written: "writing", created: "creation", cancelled: "cancellation", printed: "print", photographed: "photo",
};

const words = (s: string): string[] => s.replace(/[“”"]/g, "").split(/\s+/).filter(Boolean);
const bare = (w: string): string => w.toLowerCase().replace(/[^a-z0-9'-]/g, "");

/** The base form when `w` is a verb ("sees" -> "see"), else "". */
function baseOf(w: string): string {
  const v = bare(w);
  if (v === "has" || v === "have") return "have";
  if (VERBS.has(v)) return v;
  if (/(ches|shes|sses|xes|oes)$/.test(v) && VERBS.has(v.slice(0, -2))) return v.slice(0, -2);
  if (/ies$/.test(v) && VERBS.has(`${v.slice(0, -3)}y`)) return `${v.slice(0, -3)}y`;
  if (/s$/.test(v) && VERBS.has(v.slice(0, -1))) return v.slice(0, -1);
  return "";
}
const isSForm = (w: string): boolean => bare(w) !== baseOf(w) && baseOf(w) !== "";

/** The head noun of a subject: "Employees without e-mail" -> "Employees", "Clients and staff" -> "Clients". */
function headOf(subject: string): string {
  const ws = words(subject).filter((w) => !DETERMINERS.has(bare(w)));
  const out: string[] = [];
  for (const w of ws) {
    const b = bare(w);
    if (b === "and" || b === "or" || PREPOSITIONS.has(b)) break;
    out.push(w);
  }
  return out.join(" ");
}

const isPerson = (subject: string): boolean => {
  const head = headOf(subject);
  const last = words(head).pop() ?? "";
  return PERSON.test(bare(last));
};

/** "Customers" -> "customer", "Staff" -> "staff member", "The order desk" -> "order desk". */
export function singularActor(subject: string): string {
  // acronyms keep their case ("HR contact"); every other word is lower case
  const ws = words(headOf(subject)).map((w) => (/^[A-Z]{2,}$/.test(w.replace(/[^A-Za-z]/g, "")) ? w.replace(/[^A-Za-z0-9-]/g, "") : bare(w))).filter(Boolean);
  if (ws.length === 0) return "";
  const last = ws[ws.length - 1]!;
  const head = ws.slice(0, -1);
  const one =
    last === "staff" ? "staff member"
    : last === "people" ? "person"
    : last === "hr" || last === "HR" ? "HR team"
    : /^[A-Z]{2,}$/.test(last) ? last
    : /(ss|us|sis)$/.test(last) ? last
    : /ies$/.test(last) ? `${last.slice(0, -3)}y`
    : /(ches|shes|xes)$/.test(last) ? last.slice(0, -2)
    : /s$/.test(last) ? last.slice(0, -1)
    : last;
  return [...head, one].join(" ");
}

export interface RequirementPhrase {
  kind: "active" | "passive" | "noun";
  /** who or what does it ("customers", "a confirmation email"), or "" for an imperative */
  subject: string;
  /** the subject is a person or a team */
  person: boolean;
  /** the base verb of an active phrase, the participle of a passive one */
  verb: string;
  /** the verb as written ("sees") */
  verbWord: string;
  /** what follows the verb ("a class online and pay by card") */
  rest: string;
  /** the phrase without the lead-in */
  text: string;
  /** a label before a colon ("Table turn planner: show each room's status") */
  label: string;
}

/** Plural people or things ("customers", "orders", "staff") take a base-form verb ("Customers book", "Staff see"). */
const PLURAL_WORDS = new Set(["staff", "people", "police", "personnel", "crew", "hr"]);
const isPlural = (w: string): boolean => PLURAL_WORDS.has(w) || (/s$/.test(w) && !/(ss|us|is)$/.test(w));
const MODAL_BEFORE = new Set(["can", "could", "must", "should", "shall", "will", "may", "to"]);

/** Where the main verb is: an imperative start ("Find parts"), a verb after a modal ("can change", "able to use"), an
 *  -s form after a subject ("the operator checks"), else a base form after plural people or things ("Customers book",
 *  "Orders close"). A singular subject never takes a base form ("A driver route view" has no verb). */
function verbAt(ws: string[]): number {
  const limit = Math.min(ws.length, 10);
  const ok = (i: number) => i === 0 || !DETERMINERS.has(bare(ws[i - 1]!));
  const subjectOf = (i: number) => {
    let j = i;
    while (j > 0 && MODAL.has(bare(ws[j - 1]!))) j--;
    return ws.slice(0, j).join(" ");
  };
  if (ws.length > 1 && baseOf(ws[0]!) && !isSForm(ws[0]!) && !isSForm(ws[1]!)) return 0;
  for (let i = 1; i < limit; i++) {
    if (MODAL_BEFORE.has(bare(ws[i - 1]!)) && baseOf(ws[i]!) && !isSForm(ws[i]!) && !RELATIVE.test(subjectOf(i))) return i;
  }
  for (let i = 1; i < limit; i++) {
    const w = ws[i]!;
    if (!ok(i) || !baseOf(w)) continue;
    const subject = subjectOf(i);
    if (!subject) continue;
    if (RELATIVE.test(subject)) return -1;
    if (isSForm(w)) return i;
    const last = bare(words(headOf(subject)).pop() ?? "");
    if (isPlural(last)) return i;
  }
  return -1;
}

/** Reads a requirement title as who + verb + rest (or a noun phrase). */
export function phraseOf(title: string): RequirementPhrase {
  let t = title.trim().replace(/[.!]+$/, "").replace(LEAD, "").replace(/^[-–:•\s]+/, "").replace(/[“”"]/g, "");
  let label = "";
  const colon = /^([^:]{3,40}):\s+(.+)$/.exec(t);
  if (colon && words(colon[1]!).length <= 4) {
    label = colon[1]!.trim();
    t = colon[2]!.trim();
  }
  const ws = words(t);
  const none = { subject: "", person: false, verb: "", verbWord: "", rest: "", text: t, label };
  for (let i = 1; i < Math.min(ws.length - 1, 6); i++) {
    const w = bare(ws[i]!);
    const next = bare(ws[i + 1]!);
    if (BE.has(w) && /(ed|wn|tten|nt|id|ne)$/.test(next) && !MODAL.has(next) && !RELATIVE.test(ws.slice(0, i).join(" "))) {
      return { ...none, kind: "passive", subject: ws.slice(0, i).join(" "), verb: next, verbWord: next, rest: ws.slice(i + 2).join(" ") };
    }
  }
  const at = verbAt(ws);
  // after a label the wish is an instruction: "Newsletter studio: assemble the newsletter …"
  if (at < 0 && label && ws.length > 1 && !DETERMINERS.has(bare(ws[0]!)) && /^[a-z]/.test(ws[0]!)) {
    return { ...none, kind: "active", person: true, verb: bare(ws[0]!), verbWord: ws[0]!, rest: ws.slice(1).join(" ") };
  }
  if (at < 0) return { ...none, kind: "noun" };
  let j = at;
  while (j > 0 && MODAL.has(bare(ws[j - 1]!))) j--;
  const subject = ws.slice(0, j).join(" ");
  return { ...none, kind: "active", subject, person: subject === "" || isPerson(subject), verb: baseOf(ws[at]!), verbWord: ws[at]!, rest: ws.slice(at + 1).join(" ") };
}

/** Cuts a phrase at the first joint ("and", a comma, a preposition, a number) once it holds `min` words. A phrase cut
 *  only by `max` goes back to its last joint, so it never ends in the middle ("Find parts by the pump's serial"). */
function cutAtJoint(ws: string[], min: number, max: number, o: { verbFirst?: boolean; and?: boolean } = {}): string[] {
  const out: string[] = [];
  let joint = -1;
  let byMax = false;
  for (const [i, raw] of ws.entries()) {
    const w = bare(raw);
    const particle = o.verbFirst === true && i === 1 && PARTICLES.has(w);
    const isJoint = !particle && (((w === "and" || w === "or") && o.and !== false) || PREPOSITIONS.has(w) || NUMBERS.has(w) || /^\d/.test(w));
    if (isJoint && out.length >= min) break;
    if (isJoint && out.length >= 2) joint = out.length;
    out.push(raw.replace(/[,;:]+$/, ""));
    if (/[,;:]$/.test(raw) && out.length >= Math.min(min, 2)) break;
    if (out.length >= max) {
      byMax = i < ws.length - 1;
      break;
    }
  }
  if (byMax && joint >= 2) out.splice(joint);
  while (out.length > 1) {
    const last = bare(out[out.length - 1]!);
    const particle = o.verbFirst === true && out.length === 2 && PARTICLES.has(last);
    if (particle || !(PREPOSITIONS.has(last) || DETERMINERS.has(last) || last === "and" || last === "or")) break;
    out.pop();
  }
  return out;
}

const dropAdverbs = (ws: string[], keep = 2): string[] => {
  const out = [...ws];
  while (out.length > keep && ADVERBS.has(bare(out[out.length - 1]!))) out.pop();
  return out;
};
const noDeterminers = (ws: string[]): string[] => ws.filter((w) => !DETERMINERS.has(bare(w)) && !FILLER.has(bare(w)));
const tidy = (s: string): string => cap(s.replace(/\s+/g, " ").replace(/[,;:]+$/, "").replace(/\s+'s\b/g, "'s").trim());
const sentenceCase = (ws: string[]): string[] => ws.map((w, i) => (i === 0 ? w : /^[A-Z]{2,}|^[A-Z][a-z]*[A-Z]/.test(w) ? w : lower(w)));

/** The other system a connection is about: "the ERP as a CSV export" -> "ERP", "SAP for invoicing" -> "SAP",
 *  "to it Read access to the door lock system" -> "door lock system". */
const SYSTEM_WORD = /^(system|software|erp|sap|crm|portal|platform|database|archive|tool|service|api|shop|webshop|calendar|scanner|terminal|till|pos|point-of-sale|app|ledger|bank|payroll|accounting)$/i;
function systemOf(rest: string): string {
  const ws = words(rest).map((w) => w.replace(/[,;:.]+$/, ""));
  let k = -1;
  // the first system named (a file format is not a system: "the ERP as a CSV export" -> "ERP")
  for (let i = 0; i < ws.length && k < 0; i++) if ((SYSTEM_WORD.test(bare(ws[i]!)) || /^[A-Z]{2,}$/.test(ws[i]!)) && !/^(CSV|PDF|XML|JSON|XLSX?|SMS|QR|VAT|CHF|EUR)$/.test(ws[i]!)) k = i;
  if (k >= 0) {
    const out = [ws[k]!];
    for (let i = k - 1; i >= 0 && out.length < 4; i--) {
      const b = bare(ws[i]!);
      if (DETERMINERS.has(b) || PREPOSITIONS.has(b) || b === "it" || b === "and" || b === "or" || /^[A-Z]/.test(ws[i]!) && i > 0 && !/^[A-Z]{2,}$/.test(ws[i]!)) break;
      out.unshift(ws[i]!);
    }
    return out.join(" ");
  }
  const lead = ws.findIndex((w) => !PREPOSITIONS.has(bare(w)) && !DETERMINERS.has(bare(w)) && bare(w) !== "it");
  return lead < 0 ? "" : noDeterminers(cutAtJoint(ws.slice(lead), 1, 4)).join(" ");
}

/** A noun phrase up to its relative clause ("A Field map view that works on a phone" -> "A Field map view"). */
const nounPart = (t: string): string => t.split(/\s+(?:that|which|who|where|when|whose)\s+/i)[0]!;

const NOBODY = /^(nobody|no one|no-one|none of us)$/i;
const gerund = (v: string): string =>
  /ie$/.test(v) ? `${v.slice(0, -2)}ying` : /[^aeiou]e$/.test(v) && !/(ee|ye|oe)$/.test(v) ? `${v.slice(0, -1)}ing` : `${v}ing`;

/** A statement about the product itself or a rule for everyone ("It fits SAP", "Nobody types data twice"): no screen. */
export function isScreenWorthy(title: string): boolean {
  const p = phraseOf(title);
  if (p.kind !== "active") return true;
  const head = bare(headOf(p.subject));
  return !(NOBODY.test(head) || /^(it|this|that|everything|everyone|everybody|application|system|app|portal|platform|tool|solution|software|website|site|product)$/.test(head));
}

/** A feature name: the action in plain words ("Book a class online"), at most about six words. */
export function featureNameOf(title: string): string {
  const p = phraseOf(title);
  if (p.label) return clip(tidy(p.label), 60);
  if (p.kind === "active" && LINK.has(p.verb)) {
    const system = systemOf(p.rest);
    const thing = noDeterminers(words(headOf(p.subject))).join(" ");
    const product = !thing || /^(it|application|system|app|portal|platform|tool|solution|software|website|site|product)$/i.test(thing);
    if (system) return clip(tidy(product ? `${system} connection` : `${thing} to the ${system}`), 60);
  }
  if (p.kind === "active" && NOBODY.test(bare(headOf(p.subject)))) {
    // "Nobody wants to type the same data twice": the action after the want, as a rule ("No typing the same data twice")
    const after = words(p.rest);
    const k = after.findIndex((w) => baseOf(w) !== "" && !MODAL.has(bare(w)));
    const ws = k >= 0 ? [`no ${gerund(baseOf(after[k]!))}`, ...after.slice(k + 1)] : [`no ${gerund(p.verb)}`, ...after];
    const cut = cutAtJoint(ws, 2, 6);
    const next = bare(ws[cut.length] ?? "");
    return clip(tidy([...cut, ...(next === "twice" || next === "again" ? [next] : [])].join(" ")), 60);
  }
  if (p.kind === "active" && p.person) {
    const ws = dropAdverbs(cutAtJoint(words(`${p.verb} ${p.rest}`), 3, 6, { verbFirst: true }), 3);
    return clip(tidy(sentenceCase(ws).join(" ")), 60);
  }
  if (p.kind === "active") {
    const ws = dropAdverbs(cutAtJoint([...noDeterminers(words(p.subject)), p.verbWord, ...words(p.rest)], 2, 6), 2);
    return clip(tidy(sentenceCase(ws).join(" ")), 60);
  }
  if (p.kind === "passive") {
    const noun = ACTIVITY[p.verb];
    const thing = singularActor(p.subject);
    if (noun && thing) return clip(tidy(`${thing} ${noun}`), 60);
    return clip(tidy(cutAtJoint(noDeterminers(words(`${p.subject} ${p.verb}`)), 2, 5).join(" ")), 60);
  }
  const ws = noDeterminers(words(nounPart(p.text)));
  return clip(tidy(sentenceCase(ws.length <= 4 ? ws : cutAtJoint(ws, 2, 5)).join(" ")), 60);
}

const UNCOUNTABLE = /(ing|overview|storage)$/;

/** Verbs whose screen is named after the thing first ("export the herd record" -> "Herd record export"). */
const THING_FIRST: Record<string, string> = { export: "export", import: "import", report: "report", download: "", print: "print" };

/** A screen name: at most four words, a thing to look at ("Guest list") or an action ("Book a class"). */
export function screenNameOf(title: string): string {
  const p = phraseOf(title);
  let ws: string[];
  if (p.label) {
    ws = words(p.label);
  } else if (p.kind === "active" && LINK.has(p.verb)) {
    const system = systemOf(p.rest);
    ws = system ? words(`${system} connection`) : words(headOf(p.subject));
  } else if (p.kind === "active" && p.person && LOOK.has(p.verb)) {
    const obj = noDeterminers(words(p.rest));
    if (/^(what|which|who|how|where|when)$/i.test(bare(obj[0] ?? ""))) {
      const last = bare(obj[obj.length - 1] ?? "");
      ws = /^(missing|open|due|late|pending|new|done|left)$/.test(last) ? [cap(last), "items"] : ["Overview"];
    } else {
      const thing = dropAdverbs(cutAtJoint(obj, 1, 4, { and: false }), 1);
      ws = thing.length ? thing : [p.verb];
    }
  } else if (p.kind === "active" && p.person && p.verb === "sign" && !/^(in|up)\b/i.test(p.rest)) {
    ws = ["Signature"];
  } else if (p.kind === "active" && p.person && p.verb in THING_FIRST) {
    const thing = dropAdverbs(cutAtJoint(noDeterminers(words(p.rest)), 1, 3), 1);
    ws = thing.length ? [...thing, ...(THING_FIRST[p.verb] ? [THING_FIRST[p.verb]!] : [])] : [cap(p.verb)];
  } else if (p.kind === "active" && p.person) {
    ws = dropAdverbs(cutAtJoint(words(`${p.verb} ${p.rest}`), 2, 4, { verbFirst: true }));
  } else if (p.kind === "active") {
    ws = noDeterminers(words(headOf(p.subject)));
  } else if (p.kind === "passive") {
    const noun = ACTIVITY[p.verb];
    const thing = singularActor(p.subject);
    ws = noun && thing ? words(`${thing} ${UNCOUNTABLE.test(noun) ? noun : `${noun}s`}`) : cutAtJoint(noDeterminers(words(p.subject)), 1, 3);
  } else {
    const all = noDeterminers(words(nounPart(p.text)));
    ws = all.length <= 3 ? all : cutAtJoint(all, 1, 3);
  }
  ws = sentenceCase(ws.slice(0, 4));
  return tidy(ws.join(" ")) || "Overview";
}

/** The person of a requirement ("customer", "staff member", "order desk"), or "". */
export function actorOf(title: string): string {
  const p = phraseOf(title);
  if (p.kind !== "active" || !p.subject || !p.person) return "";
  return singularActor(p.subject);
}

/** What the person wants, after "I want": "to book a class online", "to be sure that partial deliveries are
 *  recorded", "a minimum order value of CHF 150". */
export function wishOf(title: string): string {
  const p = phraseOf(title);
  const own = (s: string) => s.replace(/\btheir\b/gi, "my").replace(/\bthem\b/gi, "me");
  const clause = (s: string) => (/^[A-Z]{2,}|^[A-Z][a-z]*[A-Z]/.test(s) ? s : lower(s));
  if (p.label && p.kind === "active" && p.subject === "") return `to ${own(`${p.verb} ${p.rest}`.trim())}`;
  if (p.kind === "active" && p.person) return `to ${own(`${p.verb} ${p.rest}`.trim())}`;
  if (p.kind === "active" || p.kind === "passive") return `to be sure that ${clause(p.text)}`;
  const ws = words(p.text);
  const first = bare(ws[0] ?? "");
  const np = DETERMINERS.has(first) ? clause(p.text) : `${/^[aeiou]/i.test(first) ? "an" : "a"} ${clause(p.text)}`;
  return np.replace(/^(each|every|all) /i, "an ").replace(/^an ([^aeiou])/i, "a $1");
}

/** True when a story title starts with what someone does ("See my net price", "Book a class"), not a name or a fact. */
export function startsWithVerb(title: string): boolean {
  const first = words(title)[0] ?? "";
  return baseOf(first) !== "" && !isSForm(first);
}
