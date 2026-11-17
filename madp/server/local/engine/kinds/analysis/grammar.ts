// A little English for the analysis writers: the things a line talks about, singular forms, articles, and turning
// "X should do Y" / "X must stay Y" into the statement "X does Y" / "X stays Y".
import { cap } from "../../text.ts";

/** Business objects, longest first (so "temperature logs" wins over "logs"). */
const THINGS = [
  "temperature logs", "delivery notes", "salary statements", "annual statements", "service reports", "bank details", "spare parts",
  "price lists", "route lists", "purchase orders", "tax returns", "code of conduct", "certificates", "receipts", "documents",
  "invoices", "orders", "payslips", "statements", "declarations", "reports", "contracts", "mandates", "checklists", "photos",
  "drawings", "offers", "routes", "visits", "deliveries", "absences", "hours", "requests", "approvals", "tickets", "leads", "parts",
  "logs", "files", "forms", "registrations",
];

const GENERIC = new Set(["files", "documents", "forms", "logs", "photos"]);

/** The business objects a text mentions, in order of appearance (at most `max`); generic words only when nothing more precise is named. */
export function thingsIn(text: string, max = 2): string[] {
  const all = thingsInAll(text);
  const precise = all.filter((t) => !GENERIC.has(t));
  return (precise.length ? precise.slice(0, max) : all.slice(0, 1));
}

function thingsInAll(text: string): string[] {
  // "within 2 hours", "opening hours", "ten minutes of practice": times, not records the product keeps
  const t = ` ${text.toLowerCase().replace(/\b(\d+|one|two|three|four|five|six|eight|ten|twelve|24|48|opening|working|office|peak|business)\s+hours?\b/g, " ")} `;
  const hits: { at: number; thing: string }[] = [];
  for (const th of THINGS) {
    const singular = singularOf(th);
    for (const form of [th, singular]) {
      const at = t.search(new RegExp(`[^a-z]${form.replace(/ /g, "\\s+")}[^a-z]`));
      if (at >= 0 && !hits.some((h) => h.thing.includes(th) || th.includes(h.thing))) {
        hits.push({ at, thing: th });
        break;
      }
    }
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.thing);
}

export function singularOf(word: string): string {
  const parts = word.split(" ");
  const last = parts.pop()!;
  let s = last;
  if (/ies$/.test(last)) s = last.replace(/ies$/, "y");
  else if (/(ss|us|is)$/.test(last)) s = last;
  else if (/(ches|shes|xes|ses)$/.test(last)) s = last.replace(/es$/, "");
  else if (/s$/.test(last) && !/^(details|hours|news)$/.test(last)) s = last.replace(/s$/, "");
  return [...parts, s].join(" ");
}

export function article(word: string): string {
  return /^[aeiou]/i.test(word) && !/^(user|uni|eu)/i.test(word) ? `an ${word}` : `a ${word}`;
}

/** True when the subject reads as plural ("suppliers", "clients and staff"). */
export function isPlural(subject: string): boolean {
  const s = subject.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (/\band\b/.test(s)) return true;
  if (/^(qa|quality assurance|purchasing|finance|dispatch|accounting|staff|the order desk|order desk|everyone|nobody)$/.test(s)) return false;
  const last = s.split(/\s+/).pop() ?? "";
  return /[^s]s$/.test(last) || /^(people|staff)$/.test(last);
}

/** "show" -> "shows" (third person singular). */
export function thirdPerson(verb: string): string {
  if (verb === "be") return "is";
  if (verb === "have") return "has";
  if (/(s|sh|ch|x|z|o)$/.test(verb)) return `${verb}es`;
  if (/[^aeiou]y$/.test(verb)) return verb.replace(/y$/, "ies");
  return `${verb}s`;
}

/**
 * Turns a wish into the statement of the finished product:
 *   "A phone app should show the route"        -> "A phone app shows the route"
 *   "Failed deliveries should be visible"      -> "Failed deliveries are visible"
 *   "clients must not need a new login"        -> "Clients do not need a new login"
 *   "The portal must keep working"             -> "The portal keeps working"
 */
export function asStatement(text: string): string {
  const m = /^(.*?)\b(should|must|shall|has to|have to|needs to|need to|will)\s+(not\s+)?(\w+)\b(.*)$/i.exec(text.trim());
  if (!m) return cap(text.trim());
  const subject = m[1]!.trim();
  if (!subject || subject.split(/\s+/).length > 8) return cap(text.trim());
  const plural = isPlural(subject);
  const neg = Boolean(m[3]);
  const verb = m[4]!.toLowerCase();
  let vp: string;
  if (verb === "be") vp = `${plural ? "are" : "is"}${neg ? " not" : ""}`;
  else if (neg) vp = `${plural ? "do" : "does"} not ${verb}`;
  else vp = plural ? verb : thirdPerson(verb);
  return cap(`${subject} ${vp}${m[5]}`.replace(/\s+/g, " ").trim().replace(/^(.{1,60}?)\b(?:is|are) able to\b/i, "$1can"));
}

/** Common verbs that start a clause without its subject ("…, see what is missing"). */
const VERBS = new Set(
  "see get upload register approve sign check order find report download receive record show update track send book enter change create plan pay view search export import follow list add remove confirm request submit assign scan photograph capture read need use keep know manage edit invite notify remind block mark flag select pick choose repeat cancel return start stop work appear stay go print fill maintain support run host store handle process deliver prepare write call chase arrive come expire fail lose miss take give".split(
    " ",
  ),
);

/** True for a verb in any simple present form ("approve", "approves", "sees", "notifies"). */
export function isVerb(word: string): boolean {
  const w = word.toLowerCase();
  return VERBS.has(w) || VERBS.has(w.replace(/s$/, "")) || VERBS.has(w.replace(/es$/, "")) || VERBS.has(w.replace(/ies$/, "y"));
}

export function startsWithVerb(clause: string): boolean {
  const w = clause.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return isVerb(w) || /^(should|must|can)$/.test(w);
}

/** The words before the first verb of a clause ("quality assurance sees…" -> "quality assurance"). */
export function subjectOf(clause: string): string {
  const words = clause.trim().split(/\s+/);
  for (let i = 1; i < Math.min(words.length, 6); i++) {
    const w = words[i]!.toLowerCase();
    if (isVerb(w) || /^(should|must|can|will|gets?|sees?|is|are|has|have|needs?|wants?)$/.test(w)) return words.slice(0, i).join(" ");
  }
  return "";
}

/** Splits a wish line into its needs: "suppliers upload themselves, QA gets a list…" -> two clauses. */
export function clausesOf(text: string): string[] {
  const raw = text
    .replace(/\s*\([^)]*\)/g, "")
    .split(/;\s+|,\s+(?![^(]*\))/)
    .map((s) => s.trim().replace(/^(and|or|also|then)\s+/i, "").replace(/[.;,]+$/, ""))
    .filter(Boolean);
  const out: string[] = [];
  let subject = "";
  // a comma inside a noun phrase ("a single, current route", "Each table plan, event calendar or …"): the parts stay together
  const open = (prev: string): boolean => /\b(a|an|the|single|each|every|per|of|to|for|with|and|or|one|their|its|our|your|my)$/i.test(prev)
    || /^(each|every|all|the|a|an)\s+\S+(\s+\S+)?$/i.test(prev)
    || !(startsWithVerb(prev) || subjectOf(prev) !== "" || /\b(should|must|is|are|can|has|have)\b/i.test(prev));
  for (const c of raw) {
    const words = c.split(/\s+/).length;
    // "headcount and dietary needs": a verb-looking last word with nothing after it is a noun, not a clause
    const subj = subjectOf(c);
    const hasVerb = startsWithVerb(c) || (subj !== "" && subj.split(/\s+/).length < words - 1) || /\b(should|must|is|are|can)\b/i.test(c);
    if (!hasVerb || words < 3 || (out.length > 0 && open(out[out.length - 1]!))) {
      if (out.length > 0) out[out.length - 1] = `${out[out.length - 1]}, ${c}`;
      else out.push(c);
      continue;
    }
    if (startsWithVerb(c) && subject) {
      out.push(`${subject} ${c}`);
      continue;
    }
    const s = subjectOf(c);
    if (s) subject = s.replace(/\s+(should|must|can|will)$/i, "");
    out.push(c);
  }
  return out;
}

/** The product as the subject of a line ("The application", "The portal", "It"). */
const PRODUCT = "(?:the (?:application|app|phone app|web app|portal|web portal|webshop|shop|product|system|tool|platform|solution|software)|it|this)";
/** What the product does to fit in or to show something: "fits", "connects to it", "shows", "respects"… */
const PRODUCT_LEAD_IN = new RegExp(
  `^${PRODUCT}\\s+(?:(?:has to|must|should|needs to|will|can)\\s+)?(fits?|fit into|connects?(?: to)?|connect to|works? with|integrates? with|complies with|comply with|respects?|supports?|(?:is|are|be) available in|keeps? working|runs? on|shows?|displays?|lists?|highlights?|has|have)\\b\\s*(?:it\\b[:,]?\\s*)?(.*)$`,
  "i",
);
/** A people group "showing" something is the product showing it to them ("Drivers show the minutes lost per site"). */
const PEOPLE_SHOW = /^((?:[A-Za-z][\w’'-]*\s+){0,3}?[A-Za-z][\w’'-]*?s)\s+(?:show|display|list|highlight)\s+(?:the\s+)?(.+)$/;
const ACCESS = /^(?:read|write|read and write|read-only|full|direct|single sign-?on)\b/i;

/** "It fits SAP" → "Works with SAP"; "The application connects to it Read access to the door lock system" → "Read access
 *  to the door lock system"; "The portal shows the open orders" → "Open orders". Unchanged when the product is not the
 *  subject. */
function withoutProductLeadIn(t: string): string {
  const m = PRODUCT_LEAD_IN.exec(t);
  if (!m) return t;
  const verb = m[1]!.toLowerCase();
  const rest = m[2]!.trim().replace(/^[:,]\s*/, "");
  if (!rest) return t;
  if (ACCESS.test(rest) || startsWithVerb(rest)) return cap(rest);
  if (/^(fits?|fit into|works? with|integrates? with)$/.test(verb)) return `Works with ${rest}`;
  if (/^connect/.test(verb)) return `Connection to ${rest}`;
  if (/^compl/.test(verb)) return `Complies with ${rest}`;
  if (/available in$/.test(verb)) return `Available in ${rest}`;
  if (/^supports?$/.test(verb)) return `Supports ${rest}`;
  if (/^keeps? working$/.test(verb)) return `Keeps working ${rest}`;
  if (/^runs? on$/.test(verb)) return `Runs on ${rest}`;
  // respects / shows / displays / lists / highlights: what is respected or shown is the title
  return cap(rest.replace(/^(the|a|an)\s+/i, ""));
}

/** "Each customer sees …" → "Customers see …"; other leading determiners are dropped ("The order desk can …" → "Order
 *  desk can …", "Each event calendar" → "Event calendar"). */
function withoutDeterminer(t: string): string {
  const each = /^(?:each|every)\s+([a-z]+)\s+(has|is|[a-z]+s)\b(.*)$/i.exec(t);
  if (each && !/s$/i.test(each[1]!) && (each[2] === "has" || each[2] === "is" || isVerb(each[2]!))) {
    const verb = each[2] === "has" ? "have" : each[2] === "is" ? "are" : each[2]!.replace(/ies$/, "y").replace(/(ch|sh|ss|x|o)es$/, "$1").replace(/s$/, "");
    return cap(`${plural(each[1]!)} ${verb}${each[3]}`);
  }
  const rest = t.replace(/^(?:each|every|the|a|an)\s+/i, "");
  return rest !== t && rest.split(/\s+/).length >= 2 ? cap(rest) : t;
}

function plural(word: string): string {
  if (/[^aeiou]y$/i.test(word)) return word.replace(/y$/i, "ies");
  if (/(s|sh|ch|x|z)$/i.test(word)) return `${word}es`;
  return `${word}s`;
}

const TITLE_WORDS = 8;
/** Where a long title may be cut: the part before is a complete short title, the part after explains it. */
/** Clause boundaries first (the rest is a second need or an explanation), then phrase boundaries. */
const CUT_CLAUSE = [", ", " so that ", " so ", " because ", " which ", " who ", " whenever ", " when ", " before ", " after ", " until ", " and then ", " and ", " or ", " instead of "];
const LIST_SEP = /^(?:, |\s+and\s+|\s+or\s+)/;
/** A second need starts with what is done ("and pay by card", ", then alert the right person"). */
const ACTION_START = new RegExp(`^(?:then\\s+|also\\s+)?(?:${"alert warn attach assemble accept let collect combine match publish sync compare calculate suggest display highlight connect link pass tell schedule reserve escalate move plan watch give keep update notify send show pay confirm need needs get gets see sees track tracks record records".split(" ").join("|")})\\b|^(?:${"approve sign check order find report download receive change create search export import follow list add remove request submit assign scan capture read use know manage edit invite remind block mark flag select pick choose repeat cancel return start stop print fill support run store handle process deliver prepare write call chase".split(" ").join("|")})s?\\b`);
const CUT_PHRASE = [" with ", " from ", " for ", " per ", " through ", " via "];
const DANGLING = /\s+(of|in|on|at|the|a|an|and|or|with|to|for|from|by|per|each|every|its|their|our|your|own|only|all|some|any|is|are|has|have|can|be|as|than|that|which|who|when|it)$/i;

const wordCount = (t: string): number => t.split(/\s+/).filter(Boolean).length;
const hasVerbIn = (t: string): boolean => t.split(/\s+/).some((w) => isVerb(w) || /^(is|are|has|have|can|gets?|sees?|needs?|keeps?|works?|runs?)$/i.test(w));

/** At most about eight words: cut where the rest only explains (", …", " and …", " who …"), keeping as much as fits; else
 *  before the first preposition after the third word ("register themselves | in the existing purchasing portal"). */
function shortened(t: string): string {
  let out = t;
  const OPEN_END = /\b(a|an|the|single|each|every|per|of|to|for|with|and|or|one|their|its|our|your)$/i;
  for (let guard = 0; wordCount(out) > TITLE_WORDS && guard < 6; guard++) {
    const lower = out.toLowerCase();
    const at = (list: string[]) => [...new Set(list.flatMap((c) => {
      const found: number[] = [];
      for (let i = lower.indexOf(c); i > 0; i = lower.indexOf(c, i + 1)) found.push(i);
      return found;
    }))].sort((a, b) => a - b);
    // a head that reads on its own: three words or more, not ending inside a noun phrase ("a single, current route") or
    // between two numbers ("reminders 60 and 30 days"), with a verb when the whole had one ("Watch cold store temperatures")
    const verbal = hasVerbIn(out);
    const good = (i: number) => {
      const head = out.slice(0, i).trim();
      if (wordCount(head) < 3 || OPEN_END.test(head) || /\d$/.test(head) || (verbal && !hasVerbIn(head))) return false;
      // ", " / " and " / " or " inside a list ("receipts, invoices and bank statements") is no boundary: only before a
      // second action ("… online and pay by card")
      const sep = LIST_SEP.exec(lower.slice(i));
      return !sep || ACTION_START.test(lower.slice(i + sep[0].length));
    };
    const pick = (cuts: number[]) => {
      const ok = cuts.filter(good);
      const fits = ok.filter((i) => wordCount(out.slice(0, i)) <= TITLE_WORDS);
      return fits.length ? fits[fits.length - 1]! : ok[0];
    };
    const clause = at(CUT_CLAUSE).filter(good);
    const cut = clause.some((i) => wordCount(out.slice(0, i)) <= TITLE_WORDS) ? pick(clause) : pick(at(CUT_PHRASE)) ?? pick(clause);
    if (cut === undefined) break;
    out = out.slice(0, cut).trim();
  }
  if (wordCount(out) > TITLE_WORDS) {
    const words = out.split(/\s+/).slice(0, TITLE_WORDS);
    let at = -1;
    for (let i = 3; i < words.length; i++) if (/^(in|on|at|for|with|to|from|by|of|per|into|before|after|during|through|via)$/i.test(words[i]!)) { at = i; break; }
    out = (at > 0 ? words.slice(0, at) : words).join(" ");
  }
  for (let i = 0; i < 3; i++) out = out.replace(DANGLING, "").replace(/[,;:–-]+$/, "").trim();
  return out;
}

/**
 * A requirement title from a statement: a short noun or verb phrase (at most about eight words), one sentence,
 * capitalised, no full stop, no lead-in ("The application should:", "It fits", "connects to it", "Each …"). The full
 * statement stays in the requirement's text.
 *   "The application connects to it Read access to the door lock system" → "Read access to the door lock system"
 *   "Drivers show the minutes lost per site at a glance"                 → "Minutes lost per site at a glance"
 *   "Rights tracker: attach licence terms to each asset"                 → "Rights tracker"
 */
export function titleOf(statement: string, max = 90): string {
  let t = statement.replace(/\s+/g, " ").trim();
  // one sentence ("… before billing. Catering Orders should …"): the second belongs in the text
  t = t.split(/(?<=[.!?])\s+(?=[A-Z0-9“"‘'])/)[0]!;
  t = t.replace(/\s*\([^)]*\)\s*/g, " ").replace(/[.!?…]+$/, "").replace(/\s+/g, " ").trim();
  // one need ("… point-of-sale system; read access to …"): the first
  t = t.split(/;\s+/)[0]!.trim();
  // "… instead of in shared folders": how it is done today belongs in the text, not the title
  t = t.replace(/\s+instead of\b.*$/i, "");
  // a label: "The application should: reminder e-mail one day before" → the wish; "Rights tracker: attach licence terms
  // to each asset" → the feature's name; "Peak times: Monday mornings" stays as it is
  const label = /^([^:]{2,48}):\s+(.+)$/.exec(t);
  if (label) {
    const head = label[1]!.trim(), body = label[2]!.trim();
    if (new RegExp(`^${PRODUCT}(\\s+(should|must|shall|needs to|has to|will|can))?$`, "i").test(head) || /^(we need|what we need|must|should|wish|request|requirement|feature)$/i.test(head)) t = cap(body);
    // a short name followed by what it does in small letters ("Rights tracker: attach licence terms …") is a feature's name
    else if (wordCount(head) <= 4 && (startsWithVerb(body) || /^[a-z]/.test(body)) && !hasVerbIn(head)) t = cap(head);
  }
  t = t.replace(/^(?:we|they)\s+(?:need|want|would like)\s+(?:to\s+)?/i, "");
  t = t.replace(new RegExp(`^${PRODUCT}\\s+(?:should|must|shall|needs to|has to|will)\\s*:?\\s+`, "i"), "");
  t = withoutProductLeadIn(t);
  // "Show the minutes lost per site at a glance": what is shown is the title
  t = t.replace(/^(?:show|display|list|highlight)\s+(?:the\s+|all\s+the\s+)?(?=\S)/i, "");
  t = cap(t);
  const people = PEOPLE_SHOW.exec(t);
  if (people && !new RegExp(`^${PRODUCT}$`, "i").test(people[1]!)) t = cap(people[2]!);
  t = t.replace(/^nobody wants to\s+/i, "Nobody has to ").replace(/\b(is|are) able to\b/gi, "can");
  t = t.replace(/^(a|an)\s+(phone app|app|web app|webshop|portal|web portal|tool)\b/i, "The $2");
  t = withoutDeterminer(t);
  t = shortened(t);
  if (t.length > max) {
    const cut = t.slice(0, max);
    const at = Math.max(cut.lastIndexOf(","), cut.lastIndexOf(" with "), cut.lastIndexOf(" and "));
    t = (at > max * 0.5 ? cut.slice(0, at) : cut.slice(0, cut.lastIndexOf(" "))).trim();
    t = t.replace(DANGLING, "");
  }
  return cap(t.replace(/[.!?…:;,]+$/, "").trim());
}
