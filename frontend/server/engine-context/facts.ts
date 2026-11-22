// The project's facts that every generated piece must agree on: the currency, the tax (VAT) rate, the payout schedule,
// the country and the main call to action. Read from the project's own material (the brief, the notes, the files'
// text, the answers and the decisions); a fact the material does not state is left out, never a default of the
// engine's home region. The client's answers come first: what an answer (or an accepted decision) states wins over the
// documents, and every difference is kept as a conflict for the client to confirm (resolveProjectFacts). The design
// screens, the build and every prompt take them from here (or from the context's basics.facts, which snapshot.ts fills
// with resolveProjectFacts), so the screens and the app never contradict each other or the client's answers.
// Pure.
import { currencyCodeIn, currencyOfCode } from "./currency.ts";

export interface TaxFact {
  /** "VAT", "GST", "sales tax" (the material's word). */
  name: string;
  /** The rate in percent (19, 7.7); absent when the material names the tax but not its rate. */
  percent?: number;
  /** True: the prices shown include it; false: it is added on top; absent: not said. */
  included?: boolean;
}

export interface PayoutFact {
  /** "monthly", "every two weeks", "weekly", "daily". */
  schedule?: string;
  /** Day of the month (1-31; 31 = the last day) for a monthly payout. */
  dayOfMonth?: number;
  /** Day of the week ("Friday") for a weekly payout. */
  weekday?: string;
  /** What a payout covers ("the previous calendar month"). */
  covers?: string;
  /** The smallest amount paid out, in the project's currency. */
  minimum?: number;
}

export interface ProjectFacts {
  /** ISO code ("EUR"). */
  currency?: string;
  tax?: TaxFact;
  payout?: PayoutFact;
  /** The country the business sells from ("Germany"). */
  country?: string;
  /** The main call to action, in the client's words ("Download the app"): the main button of the screens and the app. */
  primaryAction?: string;
}

const COUNTRIES = [
  "Switzerland", "Germany", "Austria", "France", "Italy", "Spain", "Portugal", "Netherlands", "Belgium", "Luxembourg", "Ireland",
  "United Kingdom", "Sweden", "Norway", "Denmark", "Finland", "Poland", "Czech Republic", "United States", "Canada", "Australia",
  "New Zealand", "India", "Bangladesh", "Pakistan", "Singapore", "Malaysia", "United Arab Emirates", "Saudi Arabia", "Japan",
];
const COUNTRY_ALIAS: Record<string, string> = { "the uk": "United Kingdom", uk: "United Kingdom", "great britain": "United Kingdom", "the us": "United States", "the usa": "United States", usa: "United States", "the united states": "United States", "the netherlands": "Netherlands", uae: "United Arab Emirates", "the uae": "United Arab Emirates" };
const COUNTRY_WORDS = [...COUNTRIES, ...Object.keys(COUNTRY_ALIAS)].sort((a, b) => b.length - a.length).map((c) => c.replace(/ /g, "\\s+")).join("|");
/** "Country: Germany", "based in Switzerland", "a company registered in Austria", "launch in Germany", "sell in the UK". */
const COUNTRY = new RegExp(`\\b(?:country\\s*[:=-]\\s*|(?:based|registered|located|headquartered|incorporated|operat(?:es|ing)|launch(?:es|ing)?|sell(?:s|ing)?|customers|buyers|users) (?:only )?in |for the )(${COUNTRY_WORDS})\\b`, "i");
const countryOf = (raw: string): string => {
  const k = raw.replace(/\s+/g, " ").trim().toLowerCase();
  return COUNTRY_ALIAS[k] ?? COUNTRIES.find((c) => c.toLowerCase() === k) ?? "";
};

const TAX_WORD = "VAT|GST|sales tax|MwSt\\.?|USt\\.?|TVA|IVA|BTW|moms";
const RATE = "(\\d{1,2}(?:[.,]\\d{1,2})?)\\s?%";
/** "19% VAT", "VAT of 19 %", "VAT (8.1%)", "VAT: 20%", "VAT rate is 7.7%". Not "15% commission". */
const TAX_RATE = [
  new RegExp(`${RATE}\\s*(?:of\\s+)?(${TAX_WORD})\\b`, "i"),
  new RegExp(`\\b(${TAX_WORD})(?:\\s+rate)?\\s*(?:of|is|at|:|=|\\()?\\s*${RATE}`, "i"),
];
const TAX_NAMED = new RegExp(`\\b(${TAX_WORD})\\b`, "i");
const TAX_IN = new RegExp(`\\b(?:prices?|amounts?)\\b[^.\\n]{0,30}\\b(?:include|includes|including|incl\\.?|with)\\s+(?:the\\s+)?(?:${RATE}\\s+)?(?:${TAX_WORD}|tax)\\b|\\b(?:${TAX_WORD})[- ](?:inclusive|included)\\b|\\bgross prices?\\b`, "i");
const TAX_OUT = new RegExp(`\\b(?:prices?|amounts?)\\b[^.\\n]{0,30}\\b(?:exclude|excludes|excluding|excl\\.?|before|plus|\\+)\\s+(?:the\\s+)?(?:${RATE}\\s+)?(?:${TAX_WORD}|tax)\\b|\\b(?:${TAX_WORD})\\s+(?:is\\s+)?added (?:on top|at checkout)\\b|\\bnet prices?\\b`, "i");
const taxName = (w: string): string => (/^gst$/i.test(w) ? "GST" : /^sales tax$/i.test(w) ? "sales tax" : "VAT");

/** A sentence that speaks of paying the sellers out. */
const PAYOUT_TALK = /\b(pay ?outs?|paid out|pays? out|pay(?:s|ing)? (?:the )?(?:creators?|sellers?|vendors?|partners?|merchants?|hosts?|drivers?)|earnings? (?:are|is) (?:paid|transferred|sent))\b/i;
const SCHEDULE: readonly [string, RegExp][] = [
  ["every two weeks", /\b(every two weeks|every other week|fortnightly|bi-?weekly)\b/i],
  ["monthly", /\b(monthly|every month|each month|once a month|per month|of the month)\b/i],
  ["weekly", /\b(weekly|every week|each week|once a week|every (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/i],
  ["daily", /\b(daily|every day|each day)\b/i],
];
const DAY_OF_MONTH = /\b(?:on|by)\s+the\s+(\d{1,2})(?:st|nd|rd|th)\b|\b(\d{1,2})(?:st|nd|rd|th)\s+(?:day\s+)?of\s+(?:each|every|the)\s+(?:following\s+)?month\b/i;
const LAST_DAY = /\blast (?:working |business )?day of (?:each|every|the) month\b/i;
const WEEKDAY = /\b(?:every|each|on)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?\b/i;
const COVERS = /\bfor the (previous|last|past) (calendar )?(month|week)\b/i;
const MINIMUM = /\bminimum (?:payout|pay-out|withdrawal|balance)\b[^.\n\d]{0,24}?(?:[A-Z]{3}|[€$£])?\s?(\d[\d',. ]*\d|\d)/i;

// a line a PDF wrapped ("pays creators\ntheir earnings once a month") is one sentence again
const sentences = (t: string): string[] => t.replace(/\r\n/g, "\n").replace(/\n(?=[a-z])/g, " ").split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const amount = (raw: string): number | undefined => {
  const n = Number(raw.replace(/[' ]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

/** The tax the texts state, the first text that says something winning (the client's words come first). */
function taxIn(texts: readonly string[]): TaxFact | undefined {
  let named = "";
  let included: boolean | undefined;
  for (const t of texts) {
    for (const re of TAX_RATE) {
      const m = re.exec(t);
      if (!m) continue;
      const word = /\d/.test(m[1]!) ? m[2]! : m[1]!;
      const pct = Number((/\d/.test(m[1]!) ? m[1]! : m[2]!).replace(",", "."));
      if (pct > 0 && pct < 40) {
        const inc = TAX_IN.test(t) ? true : TAX_OUT.test(t) ? false : included;
        return { name: taxName(word), percent: pct, ...(inc !== undefined ? { included: inc } : {}) };
      }
    }
    if (!named) {
      const n = TAX_NAMED.exec(t);
      if (n) named = taxName(n[1]!);
    }
    if (included === undefined) included = TAX_IN.test(t) ? true : TAX_OUT.test(t) ? false : undefined;
  }
  if (!named && included === undefined) return undefined;
  return { name: named || "VAT", ...(included !== undefined ? { included } : {}) };
}

/** The payout schedule the texts state (the sentences about payouts only). */
function payoutIn(texts: readonly string[]): PayoutFact | undefined {
  const out: PayoutFact = {};
  for (const t of texts) {
    for (const s of sentences(t)) {
      // a key-number row ("Payout schedule Monthly, on the 1st") or a sentence about paying out
      if (!PAYOUT_TALK.test(s) && !/\bpayout\b/i.test(s)) continue;
      if (!out.schedule) out.schedule = SCHEDULE.find(([, re]) => re.test(s))?.[0];
      if (out.dayOfMonth === undefined) {
        const d = DAY_OF_MONTH.exec(s);
        const n = d ? Number(d[1] ?? d[2]) : LAST_DAY.test(s) ? 31 : NaN;
        if (n >= 1 && n <= 31) out.dayOfMonth = n;
      }
      if (!out.weekday) {
        const w = WEEKDAY.exec(s);
        if (w) out.weekday = cap(w[1]!);
      }
      if (!out.covers) {
        const c = COVERS.exec(s);
        if (c) out.covers = `the ${c[1]!.toLowerCase()} ${c[2] ? "calendar " : ""}${c[3]!.toLowerCase()}`;
      }
      if (out.minimum === undefined) {
        const m = MINIMUM.exec(s);
        const a = m ? amount(m[1]!) : undefined;
        if (a !== undefined) out.minimum = a;
      }
    }
  }
  if (out.dayOfMonth !== undefined && !out.schedule) out.schedule = "monthly";
  if (out.weekday && !out.schedule) out.schedule = "weekly";
  const clean = Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as PayoutFact;
  return Object.keys(clean).length ? clean : undefined;
}

/** "Primary CTA: “Join the Waitlist”", "Main call to action: Book a demo", "The main button is “Start free trial”" (one
 *  line; a colour row such as "Primary CTA #7C3AED" is not one). */
const PRIMARY_ACTION = /\b(?:primary|main)[ \t]+(?:CTA|call[- ]to[- ]action|action|button)s?\b[ \t]*(?:is|will be|should be|:|=|–|-)[ \t]*["“'‘]?([^"”'’\n.;]{2,60}?)["”'’]?(?=[ \t]*(?:[.;\n]|$|["”'’]))/i;
/** An action as people write it on a button: no quotes or end punctuation, at most 80 characters. */
export function actionText(raw: string): string {
  const t = raw.replace(/\s+/g, " ").trim().replace(/^["“'‘]+|["”'’]+$/g, "").replace(/[.;:!]+$/, "").trim();
  if (t.length <= 80) return t;
  const first = t.split(/(?<=[.;!?])\s+|,\s+/)[0]!.trim();
  return first.length <= 80 ? first.replace(/[.;:!]+$/, "") : `${first.slice(0, 79).replace(/\s+\S*$/, "")}…`;
}

function primaryActionIn(texts: readonly string[]): string | undefined {
  for (const t of texts) {
    const m = PRIMARY_ACTION.exec(t);
    const a = m ? actionText(m[1]!) : "";
    if (a.length >= 2 && !/^#?[0-9a-f]{3,8}$/i.test(a)) return a;
  }
  return undefined;
}

function countryIn(texts: readonly string[], region = ""): string | undefined {
  const r = countryOf(region);
  if (r) return r;
  for (const t of texts) {
    const m = COUNTRY.exec(t);
    const c = m ? countryOf(m[1]!) : "";
    if (c) return c;
  }
  return undefined;
}

/** The facts the texts state, in the order given (put the client's own words first: the brief, the files, the notes,
 *  the answers and decisions, then what was drafted from them); `region` is the guided start's region, when given. */
export function projectFactsIn(texts: readonly string[], o: { region?: string; currency?: string } = {}): ProjectFacts {
  const list = texts.filter((t): t is string => typeof t === "string" && t.trim() !== "");
  const out: ProjectFacts = {};
  const currency = o.currency || currencyCodeIn(list);
  if (currency) out.currency = currency;
  const tax = taxIn(list);
  if (tax) out.tax = tax;
  const payout = payoutIn(list);
  if (payout) out.payout = payout;
  const country = countryIn(list, o.region);
  if (country) out.country = country;
  const action = primaryActionIn(list);
  if (action) out.primaryAction = action;
  return out;
}

// ------------------------------------------------------------------------------------------------- the client's answers first

/** The facts that can differ between an answer and a document. */
export type FactKey = "primaryAction" | "currency" | "tax" | "payout" | "country";
export const FACT_KEYS: readonly FactKey[] = ["primaryAction", "currency", "tax", "payout", "country"];
/** What a fact is about, in plain words ("Your answer on the main call to action…"). */
export const FACT_LABEL: Readonly<Record<FactKey, string>> = {
  primaryAction: "the main call to action",
  currency: "the currency",
  tax: "the tax (VAT)",
  payout: "the payout schedule",
  country: "the country",
};

/** A question about the main thing visitors should do ("What is the main action you want a visitor to take?"). */
const ASKS_ACTION = /\b(?:main|primary|key|most important|first)\b[^?]{0,50}\b(?:action|call[- ]to[- ]action|cta|button)s?\b|\bwhat (?:should|do you want|would you like) (?:a |the |your )?(?:visitors?|users?|people|customers?|readers?)\b[^?]{0,40}\bdo\b/i;
const ASKS_CURRENCY = /\bcurrenc(?:y|ies)\b|\bin which money\b/i;
const ASKS_MONEY = /\b(?:prices?|fees?|amounts?|costs?|charges?|pays?|payments?|subscriptions?)\b/i;
const ASKS_TAX = new RegExp(`\\b(?:${TAX_WORD}|tax(?:es)?)\\b`, "i");
const ASKS_COUNTRY = /\bcountr(?:y|ies)\b|\bwhere (?:is|are) (?:the |your )?(?:business|company|shop|team)\b|\b(?:based|registered) in\b/i;
const RATE_ONLY = /(\d{1,2}(?:[.,]\d{1,2})?)\s?%/;

/** The facts one answer states, read with its question ("Which currency…?" + "Swiss francs" = CHF). Only what the
 *  answer itself says: an answer about something else states none (pure). */
export function answerFactsOf(question: string, answer: string): ProjectFacts {
  const q = question.replace(/\s+/g, " ").trim();
  const a = answer.replace(/\s+/g, " ").trim();
  const out: ProjectFacts = {};
  if (!a) return out;
  if (ASKS_ACTION.test(q)) {
    const v = actionText(a);
    if (v.length >= 2) out.primaryAction = v;
  }
  // the currency the question asks for, or one the answer names outright ("Prices in EUR", "CHF 49 a month")
  const currency = ASKS_CURRENCY.test(q) || ASKS_MONEY.test(q) ? currencyCodeIn([a]) : currencyCodeIn([a].filter((x) => /\b[A-Z]{3}\b|[€£$₹৳]|\bfrancs?\b|\beuros?\b/.test(x)));
  if (currency) out.currency = currency;
  if (ASKS_TAX.test(q) || TAX_NAMED.test(a)) {
    const tax: Partial<TaxFact> = taxIn([a]) ?? {};
    const rate = tax.percent === undefined ? RATE_ONLY.exec(a) : null;
    const pct = rate ? Number(rate[1]!.replace(",", ".")) : undefined;
    const name = TAX_NAMED.exec(a)?.[1] ?? TAX_NAMED.exec(q)?.[1];
    const included = tax.included ?? (/\b(?:included|including|incl\.?|inclusive|gross)\b/i.test(a) ? true : /\b(?:on top|added|excluded|excluding|excl\.?|plus|net)\b/i.test(a) ? false : undefined);
    const percent = tax.percent ?? (pct !== undefined && pct > 0 && pct < 40 ? pct : undefined);
    if (percent !== undefined || included !== undefined) {
      out.tax = { name: name ? taxName(name) : "VAT", ...(percent !== undefined ? { percent } : {}), ...(included !== undefined ? { included } : {}) };
    }
  }
  if (PAYOUT_TALK.test(q) || /\bpayouts?\b/i.test(q) || PAYOUT_TALK.test(a)) {
    const payout = payoutIn([`Payouts: ${a}`]);
    if (payout) out.payout = payout;
  }
  if (ASKS_COUNTRY.test(q)) {
    const c = countryOf(a) || COUNTRIES.find((x) => new RegExp(`\\b${x.replace(/ /g, "\\s+")}\\b`, "i").test(a)) || countryIn([a]);
    if (c) out.country = c;
  }
  return out;
}

/** One of the client's answers (or accepted decisions) for the facts: the newest wins on the same point. */
export interface FactAnswer {
  /** "Clarification:<id>" or "Decision:<id>". */
  ref: string;
  /** The question's (or decision's) number. */
  number: number;
  question: string;
  answer: string;
  /** "decision" for an accepted decision of the decision log (default: an answered question). */
  kind?: "question" | "decision";
}

/** A text from the documents (the setup, a note, a file), with where it comes from. */
export interface FactDocument {
  text: string;
  /** "DocFile:<id>", "DocNote:<id>", "" for the setup. */
  ref?: string;
  /** "the brief “Client-Brief.pdf”", "the note “Project brief”", "the project setup". */
  name?: string;
}

/** An answer and a document (or two answers) that state a fact differently. The answer is followed; the client is
 *  asked to confirm it (requirements.draft writes the question). */
export interface FactConflict {
  fact: FactKey;
  label: string;
  /** "document": a note, a file or the setup says otherwise; "answer": an earlier answer said otherwise. */
  kind: "document" | "answer";
  /** The answer followed. */
  answerRef: string;
  answerNumber: number;
  /** "decision" when the value followed is an accepted decision's. */
  answerKind: "question" | "decision";
  question: string;
  /** The value followed, as written ("Download the app", "EUR", "VAT 19%"). */
  answer: string;
  /** The value the other side states. */
  other: string;
  /** The document's or the earlier answer's ref ("" for the setup). */
  otherRef: string;
  /** Where the other value is written, in plain words. */
  otherName: string;
}

export interface ResolvedFacts {
  facts: ProjectFacts;
  /** The facts the answers set (they win over the documents). */
  fromAnswers: FactKey[];
  conflicts: FactConflict[];
}

/** A fact's value in plain words, for a conflict or a question ("" when the facts do not state it). */
export function factValueText(f: ProjectFacts, key: FactKey): string {
  if (key === "primaryAction") return f.primaryAction ?? "";
  if (key === "currency") return f.currency ?? "";
  if (key === "country") return f.country ?? "";
  if (key === "tax") return f.tax ? `${f.tax.name}${f.tax.percent !== undefined ? ` ${f.tax.percent}%` : ""}${f.tax.included === true ? ", included in the prices" : f.tax.included === false ? ", added on top of the prices" : ""}` : "";
  return f.payout ? payoutText(f.payout, f.currency) : "";
}

const actionWords = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !/^(the|and|for|our|your|now|you|with)$/.test(w)));

/** True when two values of a fact say different things (a fact one side leaves out is no difference). */
function differs(key: FactKey, a: ProjectFacts, b: ProjectFacts): boolean {
  if (key === "primaryAction") {
    if (!a.primaryAction || !b.primaryAction) return false;
    const A = actionWords(a.primaryAction);
    const B = actionWords(b.primaryAction);
    if (A.size === 0 || B.size === 0) return a.primaryAction.toLowerCase() !== b.primaryAction.toLowerCase();
    // the same action in more or fewer words ("Join the waitlist" / "Join the waitlist with your e-mail") is the same
    return ![...A].every((w) => B.has(w)) && ![...B].every((w) => A.has(w));
  }
  if (key === "currency" || key === "country") return Boolean(a[key] && b[key] && a[key] !== b[key]);
  if (key === "tax") {
    const x = a.tax;
    const y = b.tax;
    if (!x || !y) return false;
    return (x.percent !== undefined && y.percent !== undefined && x.percent !== y.percent) || (x.included !== undefined && y.included !== undefined && x.included !== y.included);
  }
  const x = a.payout;
  const y = b.payout;
  if (!x || !y) return false;
  return (["schedule", "dayOfMonth", "weekday", "minimum"] as const).some((k) => x[k] !== undefined && y[k] !== undefined && x[k] !== y[k]);
}

/** The answer's fact over the document's, field by field for the tax and the payouts (what the answer leaves open, the
 *  document fills in). */
function overlay(base: ProjectFacts, key: FactKey, over: ProjectFacts): void {
  if (key === "tax" && over.tax) base.tax = { ...(base.tax ?? {}), ...over.tax, name: over.tax.name || base.tax?.name || "VAT" };
  else if (key === "payout" && over.payout) base.payout = { ...(base.payout ?? {}), ...over.payout };
  else if (key === "primaryAction" && over.primaryAction) base.primaryAction = over.primaryAction;
  else if (key === "currency" && over.currency) base.currency = over.currency;
  else if (key === "country" && over.country) base.country = over.country;
}

/** The project's facts with the client's answers first: what an answer (or an accepted decision) states wins over the
 *  documents (the setup, the notes, the files) and over what was drafted from them; the newest answer wins over an
 *  older one. Every point where they differ is a conflict, never dropped: the answer is followed and the client is
 *  asked to confirm it. `answers` oldest first; `documents` the client's words first; `drafted` the requirements and
 *  technical decisions (pure). */
export function resolveProjectFacts(o: { answers: readonly FactAnswer[]; documents: readonly FactDocument[]; drafted?: readonly string[]; region?: string; currency?: string }): ResolvedFacts {
  const docTexts = o.documents.map((d) => d.text);
  const answerTexts = o.answers.map((a) => `${a.question} ${a.answer}`);
  // what the documents (with the answers' words and the drafts, as before) state: the base the answers then override
  const base = projectFactsIn([...docTexts, ...answerTexts, ...(o.drafted ?? [])], { region: o.region, currency: o.currency });
  const fromDocs = projectFactsIn(docTexts, { region: o.region });
  const facts: ProjectFacts = { ...base, ...(base.tax ? { tax: { ...base.tax } } : {}), ...(base.payout ? { payout: { ...base.payout } } : {}) };
  const conflicts: FactConflict[] = [];
  const set = new Map<FactKey, { a: FactAnswer; f: ProjectFacts }>();
  for (const a of o.answers) {
    const f = answerFactsOf(a.question, a.answer);
    for (const key of FACT_KEYS) {
      if (f[key] === undefined) continue;
      const earlier = set.get(key);
      if (earlier && differs(key, f, earlier.f)) {
        conflicts.push({ fact: key, label: FACT_LABEL[key], kind: "answer", answerRef: a.ref, answerNumber: a.number, answerKind: a.kind ?? "question", question: a.question, answer: factValueText(f, key), other: factValueText(earlier.f, key), otherRef: earlier.a.ref, otherName: earlier.a.kind === "decision" ? `your decision ${earlier.a.number}` : `your answer to question ${earlier.a.number}` });
      }
      set.set(key, { a, f });
    }
  }
  for (const [key, { a, f }] of set) {
    overlay(facts, key, f);
    if (!differs(key, f, fromDocs)) continue;
    // the document that states the other value (the first one that does), for the question the client sees
    const doc = o.documents.find((d) => differs(key, f, projectFactsIn([d.text], { region: o.region }))) ?? o.documents[0];
    const docFacts = doc ? projectFactsIn([doc.text], { region: o.region }) : fromDocs;
    conflicts.push({
      fact: key, label: FACT_LABEL[key], kind: "document", answerRef: a.ref, answerNumber: a.number, answerKind: a.kind ?? "question", question: a.question,
      answer: factValueText(f, key), other: factValueText(docFacts[key] !== undefined ? docFacts : fromDocs, key), otherRef: doc?.ref ?? "", otherName: doc?.name || "the documents",
    });
  }
  if (facts.tax && !facts.tax.name) facts.tax.name = "VAT";
  return { facts, fromAnswers: [...set.keys()], conflicts };
}

const ordinal = (n: number): string => (n === 31 ? "last day" : `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`);

/** The payout schedule in words: "monthly, on the 1st, for the previous calendar month; at least EUR 50.00". */
export function payoutText(p: PayoutFact, currency?: string): string {
  const c = currency ? currencyOfCode(currency) : null;
  const parts = [
    p.schedule ?? "",
    p.dayOfMonth !== undefined ? (p.dayOfMonth === 31 ? "on the last day of the month" : `on the ${ordinal(p.dayOfMonth)} of the month`) : "",
    p.weekday ? `on ${p.weekday}` : "",
    p.covers ? `for ${p.covers}` : "",
  ].filter(Boolean);
  const min = p.minimum !== undefined ? `at least ${c ? c.format(p.minimum) : p.minimum.toFixed(2)} (smaller balances wait for the next payout)` : "";
  return [parts.join(", "), min].filter(Boolean).join("; ");
}

/** The facts as lines for a prompt or a README: what is known, and for the unknown ones what not to invent. The same
 *  lines go to the designer and to the build, so both write the same currency, tax, payout day and country. */
export function factsRules(f: ProjectFacts): string[] {
  const c = f.currency ? currencyOfCode(f.currency) : null;
  const out: string[] = [];
  out.push(c
    ? `- Currency: ${c.code}. Every price, fee, payout and amount is in ${c.code}, written like "${c.format(24)}"; no other currency anywhere.`
    : "- Currency: the material names none. Write amounts as plain numbers without a currency sign or code.");
  if (f.tax?.percent !== undefined) {
    out.push(`- ${f.tax.name}: ${f.tax.percent}%${f.tax.included === true ? ", included in the prices shown" : f.tax.included === false ? ", added on top of the prices shown" : ""}. Use exactly this rate wherever ${f.tax.name} appears.`);
  } else if (f.tax) {
    out.push(`- ${f.tax.name}: ${f.tax.included === true ? "included in the prices shown" : f.tax.included === false ? "added on top of the prices shown" : "applies"}; the material gives no rate, so never show a percentage: write "incl. ${f.tax.name}"${f.tax.included === false ? ` or "plus ${f.tax.name}"` : ""} only.`);
  } else {
    out.push("- Tax: the material says nothing about VAT or other tax. Show no tax line and no tax rate.");
  }
  if (f.payout && (f.payout.schedule || f.payout.dayOfMonth !== undefined || f.payout.weekday)) {
    const day = f.payout.dayOfMonth;
    out.push(`- Payouts: ${payoutText(f.payout, f.currency)}.${day !== undefined ? ` Every payout date shown is the ${day === 31 ? "last day" : ordinal(day)} of a month${f.payout.covers ? ` and covers ${f.payout.covers}` : ""}; the next payout date is the next such day.` : ""}`);
  } else if (f.payout?.minimum !== undefined) {
    out.push(`- Payouts: ${payoutText(f.payout, f.currency)}; the material gives no payout day, so do not name one.`);
  }
  out.push(f.country
    ? `- Country: ${f.country}. Addresses, phone numbers, company forms and references follow ${f.country}.`
    : "- Country: the material names none. No country-specific prefixes, IBANs, phone formats or company forms (no \"CH-\" or \"DE-\" references); keep them neutral.");
  // the client's main call to action (their answer wins over the documents): the same words on every screen
  if (f.primaryAction) out.push(`- Main call to action: "${f.primaryAction}". The main button and every main call to action say exactly this; no other main action anywhere (not one a document suggested).`);
  return out;
}

/** One line for a summary ("EUR · VAT 19% incl. · payouts monthly, on the 1st of the month · Germany"); "" when nothing is known. */
export function factsLine(f: ProjectFacts): string {
  const parts = [
    f.currency ?? "",
    f.tax ? `${f.tax.name}${f.tax.percent !== undefined ? ` ${f.tax.percent}%` : ""}${f.tax.included === true ? " incl." : f.tax.included === false ? " excl." : ""}` : "",
    f.payout ? `payouts ${payoutText(f.payout, f.currency)}` : "",
    f.country ?? "",
    f.primaryAction ? `main call to action "${f.primaryAction}"` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}
