/** Pure: the answers a person can pick with one click under a business analyst's question ("Questions for you").
 *  The Clarification record carries only the question, so the choices come from the question itself (money, payouts,
 *  approvals, files, what goes wrong, refunds, accounts, volumes, speed, dates, languages, hosting…) and from the
 *  project's own words (its goal and users, the region's currency). At most four, the most common first; the composer
 *  adds "Other…" (own words) and "Not sure" (the business analyst suggests one). No React. */

export interface AnswerContext {
  /** The project's goal in the client's words. */
  goal?: string | null;
  /** Who will use it, in the client's words. */
  users?: string | null;
  /** The client's region ("Switzerland"), for the currency. */
  region?: string | null;
  /** The client's or company's name ("QA Studio"). */
  client?: string | null;
  /** More of the project's words (name, other answers) the currency can be read from. */
  words?: string | null;
}

const MAX = 4;

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const unq = (s: string): string => clean(s).replace(/[?.!\s]+$/, "");

/** The currency the project talks about: from its words, else from the region; "" when nothing says. */
export function currencyOf(question: string, c: AnswerContext): string {
  const text = `${question} ${c.goal ?? ""} ${c.users ?? ""} ${c.words ?? ""}`;
  if (/\bCHF\b|\bFranken\b|\bSwiss francs?\b/i.test(text)) return "CHF";
  if (/€|\bEUR\b|\beuros?\b/i.test(text)) return "EUR";
  if (/£|\bGBP\b|\bpounds?\b/i.test(text)) return "GBP";
  if (/\$|\bUSD\b|\bdollars?\b/i.test(text)) return "USD";
  const region = (c.region ?? "").trim();
  if (/switzerland|schweiz|suisse|svizzera|\bch\b|swiss/i.test(region)) return "CHF";
  if (/united kingdom|\buk\b|england|britain/i.test(region)) return "GBP";
  if (/united states|\busa?\b|america/i.test(region)) return "USD";
  if (/germany|austria|france|italy|spain|netherlands|belgium|ireland|portugal|finland|europe|\beu\b/i.test(region)) return "EUR";
  return "";
}

/** "makers", "creators", "sellers" … as the question names the people who sell or provide; "" when it doesn't. */
function sellersOf(q: string): string {
  const m = /\b(makers?|creators?|sellers?|vendors?|artists?|designers?|suppliers?|partners?|authors?|merchants?|hosts?|providers?|freelancers?)\b/i.exec(q);
  if (!m) return "";
  const w = m[1]!.toLowerCase();
  return w.endsWith("s") ? w : `${w}s`;
}

/** The two sides of "Do buyers need an account, or can they buy as guests?" as plain statements; null when the
 *  question doesn't offer two sides that read well on their own. */
export function alternativesOf(question: string): string[] | null {
  const q = unq(question);
  const i = q.search(/,\s*or\s+/i);
  if (i < 0) return null;
  const left = q.slice(0, i).trim();
  const right = q.slice(i).replace(/^,\s*or\s+/i, "").trim();
  // only a yes/no question split in two reads as two answers ("What …, or …" doesn't)
  if (!/^(do|does|did|can|could|must|should|will|would|is|are|may|has|have)\b/i.test(left)) return null;
  const statement = (s: string): string | null => {
    let t = s.trim();
    // "Do buyers need …" → "Buyers need …"
    t = t.replace(/^(do|does|did)\s+/i, "");
    // "Can anyone sign up …" → "Anyone can sign up …"; "must you approve …" → "You must approve …"
    // the subject is one word, or two after an article ("the marketplace", "each maker")
    const modal = /^(can|could|must|should|will|would|may|is|are|has|have)\s+((?:(?:the|a|an|our|your|their|this|each|every)\s+)?\S+)\s+(.*)$/i.exec(t);
    if (modal) t = `${modal[2]} ${modal[1]!.toLowerCase()} ${modal[3]}`;
    t = t.replace(/^you\b/i, "We").replace(/^they\b/i, "They");
    t = clean(t);
    if (t.split(" ").length < 2 || t.length > 90) return null;
    return cap(t);
  };
  const a = statement(left);
  const b = statement(right);
  return a && b && a.toLowerCase() !== b.toLowerCase() ? [a, b] : null;
}

type Rule = { test: RegExp; options: (q: string, c: AnswerContext) => string[] };

/** The topics a business analyst asks about, the most specific first. */
const RULES: Rule[] = [
  // what it should achieve / who will use it: the project's own words first
  {
    test: /\b(achieve|what problem|which problem|what is the goal|main goal|purpose)\b/i,
    options: (_q, c) => [c.goal?.trim() ? unq(c.goal) : "", "Save time on work we do by hand today", "Sell more online", "Give our customers a better service"],
  },
  {
    test: /\bwho will use\b|\bwhich (groups of )?(people|users)\b|\bwho are the (main )?users\b/i,
    options: (_q, c) => [c.users?.trim() ? unq(c.users) : "", "Our customers", "Our own team", "Customers and our team"],
  },
  // money: the platform's fee
  {
    test: /\b(commission|percentage|fee|cut|take from each sale|keep from each sale|share of each sale)\b/i,
    options: () => ["10% of each sale", "15% of each sale", "20% of each sale", "No fee at the start"],
  },
  // money: paying the sellers out
  {
    test: /\b(payouts?|paid out|pay (the |them|their|out)|get paid|be paid|receive (their|the) money|their share|their money)\b/i,
    options: (q, c) => {
      const cur = currencyOf(q, c);
      const min = cur ? `once their balance reaches 50 ${cur}` : "once their balance reaches a minimum amount";
      return /\b(check|verify|verified|before paying)\b/i.test(q)
        ? [`Monthly by bank transfer, ${min}; we check their bank details first`,
          "Weekly through the payment provider, which checks who they are",
          "Right after each sale; the payment provider does the checks"]
        : [`Monthly by bank transfer, ${min}`, "Every week, by bank transfer", "Right after each sale, through the payment provider"];
    },
  },
  // refunds
  {
    test: /\b(refunds?|money back|faulty|complain)/i,
    options: () => ["A refund within 14 days if the file is faulty", "No refunds for digital files", "Our support team decides case by case"],
  },
  // something goes wrong (payments, e-mails, downloads, uploads)
  {
    test: /\b(fails?|failed|goes wrong|go wrong|never arrives?|doesn'?t arrive|does not arrive|gets? lost|is lost|errors?|breaks?|is down|outage)\b/i,
    options: (q) => [
      "Show a clear message and let them try again",
      /\b(download|e-?mail|link)\b/i.test(q) ? "They can download it again from their order page" : "Save what they did, so nothing is lost",
      "Our support team sorts it out by e-mail",
    ],
  },
  // who may join / is checked first
  {
    test: /\b(sign up|signs up|register|join)\b.*\b(approve|check|review|vet)\b|\b(approve|check|review|vet)\b.*\b(sign up|signs up|register|join|each (maker|creator|seller|vendor|artist|supplier|partner))\b/i,
    options: (q) => {
      const who = sellersOf(q).replace(/s$/, "");
      const a = who ? `${/^[aeiou]/.test(who) ? "an" : "a"} ${who}` : "";
      return who
        ? [`Anyone can sign up as ${a}`, `We approve each new ${who} first`, "Anyone can sign up; we check their first upload"]
        : ["Anyone can sign up", "We approve each person first", "Anyone can sign up; we check what they add first"];
    },
  },
  // is each item checked before it goes live
  {
    test: /\b(check|review|approve|moderate|vet)\b.*\b(before|each|every)\b|\bbefore it goes (on sale|live|online)\b/i,
    options: () => ["Yes, a person checks each one first", "No, it goes live at once", "Only the first one from each new seller"],
  },
  // files: kinds and size
  {
    test: /\b(kinds? of files?|file types?|types of files?|formats?|file size|largest file|how (big|large))\b/i,
    options: () => ["Images, PDFs and ZIP files, up to 100 MB", "Any file type, up to 500 MB", "Images and PDFs only, up to 20 MB"],
  },
  // accounts and guests
  {
    test: /\b(guests?|without an account|create an account|need an account|accounts?)\b/i,
    options: () => ["Guests can buy with an e-mail; an account is optional", "Everyone needs an account", "Guests only, no accounts"],
  },
  // signing in
  {
    test: /\b(sign in|log ?in|password|single sign-on|sso)\b/i,
    options: () => ["E-mail and password", "Sign in with Google or Microsoft", "A one-time code by e-mail"],
  },
  // payments
  {
    test: /\b(pay(ment)? (by|with|methods?)|how (do|will|should) (buyers|customers|people) pay|card|twint|paypal|invoice)\b/i,
    options: (q, c) => [currencyOf(q, c) === "CHF" ? "Card and TWINT" : "Card and PayPal", "Card only", "Card and invoice"],
  },
  // volumes and success targets
  {
    test: /\bhow many\b|\bhow much (will|is|do)\b|\bvolume\b|\bnumber of\b/i,
    options: (q) => {
      const per = /\bmonth\b/i.test(q) ? " a month" : /\byear\b/i.test(q) ? " a year" : /\bday\b/i.test(q) ? " a day" : "";
      return [`A small start: up to 100${per}`, `About 1,000${per}`, `10,000 or more${per}`];
    },
  },
  {
    test: /\b(how fast|how quickly|how long (may|can|should)|response time|load(ing)? time|wait)\b/i,
    options: () => ["Within 2 seconds", "Within 5 seconds", "Speed isn't critical for us"],
  },
  {
    test: /\b(how will you know|success|measure|which number should change)\b/i,
    options: () => ["More sales each month", "Less time spent on work by hand", "More people signing up"],
  },
  // dates
  {
    test: /\b(when (should|must|do|will|would)|deadline|go live|launch|by when|which date|fixed date)\b/i,
    options: () => ["Within a month", "In about three months", "No fixed date yet"],
  },
  {
    test: /\blanguages?\b/i,
    options: (_q, c) => (currencyOf("", c) === "CHF"
      ? ["German and English", "German, French and English", "German, French, Italian and English"]
      : ["English only", "English and German", "English, German and French"]),
  },
  {
    test: /\b(hosted|hosting|data cent(re|er)|where (must|should|is) the data|data (be )?stored|stored where)\b/i,
    options: (_q, c) => (currencyOf("", c) === "CHF" ? ["In Switzerland", "In the EU", "No preference"] : ["In the EU", "In our own country", "No preference"]),
  },
  {
    test: /\b(personal data|privacy|how long must|kept|deleted?)\b/i,
    options: () => ["Only names and e-mail addresses, kept while the account is active", "As long as the law requires, then deleted", "Deleted after one year without activity"],
  },
  {
    test: /\b(phones?|mobile|tablets?|devices?|desktop|computers?)\b/i,
    options: () => ["Phones and computers", "Computers first", "Phones first"],
  },
  {
    test: /\b(notif|remind|alert|tell (them|the)|let (them|the) know|informed)\w*/i,
    options: () => ["By e-mail", "In the app", "By e-mail and in the app"],
  },
  {
    test: /\b(other systems?|integrat\w*|connect(ed)? to|accounting|crm|erp|export)\b/i,
    options: () => ["None for now", "Our accounting software", "An export to Excel is enough"],
  },
  {
    test: /\b(search|filter)\w*\b/i,
    options: () => ["By name and category", "By name, category and price", "By name only"],
  },
  {
    test: /\b(budget|cost|price range)\b/i,
    options: (q, c) => {
      const cur = currencyOf(q, c);
      return cur ? [`Under 10,000 ${cur}`, `10,000 to 50,000 ${cur}`, "No fixed budget yet"] : ["A small budget for a first version", "A medium budget", "No fixed budget yet"];
    },
  },
  {
    test: /\bwhich roles\b|\bwho (approves|decides|signs off|confirms|checks|may|can|is allowed)\b/i,
    options: (_q, c) => [c.client?.trim() ? `Someone at ${c.client.trim()}` : "The project owner", "A team lead", "Anyone in the team"],
  },
];

/** "Yes" / "No" for a plain yes-or-no question. */
const YES_NO = /^(do|does|did|can|could|must|should|will|would|is|are|may|has|have|shall)\b/i;

/** The answers to offer for a question (2 to 4, the most common first), from its topic and the project's words. */
export function answerOptions(question: string, c: AnswerContext = {}): string[] {
  const q = clean(question);
  if (!q) return [];
  const out: string[] = [];
  const add = (xs: readonly string[]) => {
    for (const x of xs) {
      const t = clean(x);
      if (t && t.length <= 160 && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    }
  };
  const rule = RULES.find((r) => r.test.test(q));
  if (rule) add(rule.options(q, c));
  if (out.length < 2) {
    const sides = alternativesOf(q);
    if (sides) add(sides);
  }
  if (out.length < 2 && YES_NO.test(q)) add(["Yes", "No", "Only in some cases"]);
  if (out.length < 2) {
    // an open question nothing above fits: answers that still move the work on
    add(/^who\b/i.test(q)
      ? [c.client?.trim() ? `Someone at ${c.client.trim()}` : "The project owner", "Our support team", "The people who use it, themselves"]
      : ["Keep it simple for the first version", "Like similar products usually do", "Let's decide it together in a short call"]);
  }
  return out.slice(0, MAX);
}

/** The answers to offer for a stored question: the business analyst's own options written with the question (2 to 4)
 *  first; the wording-based ones (answerOptions) only for a question that has none. */
export function optionsFor(row: { Question: string; Options?: readonly unknown[] | null }, c: AnswerContext = {}): string[] {
  const stored: string[] = [];
  for (const x of row.Options ?? []) {
    const t = typeof x === "string" ? clean(x) : "";
    if (t && t.length <= 160 && !stored.some((o) => o.toLowerCase() === t.toLowerCase())) stored.push(t);
  }
  return stored.length >= 2 ? stored.slice(0, MAX) : answerOptions(row.Question, c);
}
