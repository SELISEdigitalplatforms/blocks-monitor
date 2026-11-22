/** The "Landing page" add-on (Understanding your project): does the client want a landing page — no, a new dedicated
 *  one, or a change to the existing one — and, if so, what it should say and do. Stored on the project as one JSON
 *  field (Project.LandingPageAddOn) by project.addon.landingPage.save; the same checks run in the browser and in the
 *  op. Pure. */

export const LANDING_FIELD = "LandingPageAddOn";

export const LANDING_CHOICES = ["none", "new", "modify"] as const;
export type LandingChoice = (typeof LANDING_CHOICES)[number];

export interface LandingAnswers {
  /** What should the page achieve, and for whom? (the one required answer when a page is wanted) */
  purpose: string;
  /** Anything it must include? (optional) */
  notes: string;
  /** Website or examples the client likes: http(s) addresses (optional, at most LANDING_LIMITS.references). */
  references: string[];
  /* Older answers, no longer asked (kept readable for stored data; the engine works them out now). */
  pageUrl: string;
  title: string;
  audience: string;
  sections: string;
  tone: string;
  cta: string;
}

export interface LandingAddOn {
  choice: LandingChoice;
  /** null when no landing page is wanted. */
  answers: LandingAnswers | null;
  /** Grows with every save; the Goals & requirements section is written for one revision. */
  revision: number;
  savedAt: string;
  savedByUserId: string;
  /** Set when the answers changed after the requirements were approved: the draft change request that carries them. */
  changeRequestId?: string;
  changeNumber?: number;
}

export type LandingState = "open" | "filled" | "notNeeded";

/** The journey steps where the answers feed the requirements directly (reviewed in Goals & requirements). */
export const LANDING_OPEN_STEPS = ["sanitization", "requirements"] as const;
/** After the requirements are approved, a change goes through a draft change request (the app's rule for late changes). */
export const LANDING_CHANGE_STEPS = ["scope", "board", "build", "release"] as const;

export type LandingWay = "direct" | "change";

/** Who may change the landing page answers now, and how: directly (Understanding, Goals & requirements) or, once the
 *  requirements are approved, through a change request (needs the build permission too). A reason when it's read only. */
export function landingAccess(o: { stage: string; step: string; canEditUnderstanding: boolean; canRequestChange: boolean }):
  { editable: boolean; way: LandingWay; reason: string | null } {
  const way: LandingWay = (LANDING_CHANGE_STEPS as readonly string[]).includes(o.step) ? "change" : "direct";
  if (o.stage === "paused") return { editable: false, way, reason: "This project is paused. The landing page can be changed again when it resumes." };
  if (o.stage === "abandoned" || o.stage === "closed" || !([...LANDING_OPEN_STEPS, ...LANDING_CHANGE_STEPS] as readonly string[]).includes(o.step)) {
    return { editable: false, way, reason: "This project is closed, so the landing page can't be changed." };
  }
  if (!o.canEditUnderstanding) return { editable: false, way, reason: "Only the project team can change these answers. You can read them here." };
  if (way === "change" && !o.canRequestChange) {
    return { editable: false, way, reason: "The requirements are approved, so a change now goes through a change request. The development team can make it." };
  }
  return { editable: true, way, reason: null };
}

/** The draft change request's title and description for answers changed after the requirements were approved. */
export function landingChangeText(addOn: LandingAddOn): { title: string; description: string } {
  const a = addOn.answers;
  const title = addOn.choice === "none" ? "Landing page: not needed any more" : addOn.choice === "modify" ? "Landing page: change the existing page" : "Landing page: a new page";
  if (!a) return { title, description: "The client no longer wants a landing page. Leave it out of the build." };
  const lines = [
    `What it should achieve, and for whom: ${a.purpose}`,
    a.notes ? `It must include: ${a.notes}` : "",
    a.references.length ? `Website or examples: ${a.references.join(", ")}` : "",
    "The full goals and requirements are in the Landing page section of Goals & requirements.",
  ].filter(Boolean);
  return { title, description: lines.join("\n").slice(0, 10000) };
}

export const LANDING_LIMITS = {
  purpose: 600, notes: 600, url: 500, references: 5,
  /* older answers, read only */
  title: 120, audience: 600, sections: 1500, tone: 400, cta: 200,
} as const;

export const EMPTY_LANDING: LandingAnswers = {
  purpose: "", notes: "", references: [], pageUrl: "", title: "", audience: "", sections: "", tone: "", cta: "",
};

type TextKey = "purpose" | "notes";

export const CHOICE_LABEL: Record<LandingChoice, string> = {
  none: "No landing page",
  new: "A new landing page",
  modify: "Change the existing landing page",
};

/** "www.x.ch" → "https://www.x.ch"; only http(s) addresses without spaces; "" stays "". */
export function normaliseLandingUrl(raw: string): { ok: true; value: string } | { ok: false } {
  const t = raw.trim();
  if (!t) return { ok: true, value: "" };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`;
  if (withScheme.length > LANDING_LIMITS.url || /\s/.test(withScheme)) return { ok: false };
  try {
    const u = new URL(withScheme);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || !u.hostname.includes(".")) return { ok: false };
    return { ok: true, value: withScheme };
  } catch {
    return { ok: false };
  }
}

/** One address per line (or comma separated), empty lines dropped. */
export function splitReferences(text: string): string[] {
  return text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
}

export type LandingProblem =
  | { key: "choice" }
  | { key: TextKey; problem: "required" | "tooLong" }
  | { key: "references"; problem: "invalid" | "tooMany"; value?: string };

export const LANDING_MESSAGE = {
  choice: "Choose whether you want a landing page.",
  required: "Please fill this in.",
  tooLong: (max: number) => `Use at most ${max} characters.`,
  url: "Enter a web address, like www.example.com.",
  tooMany: `Add at most ${LANDING_LIMITS.references} addresses.`,
} as const;

/** The checked add-on, or every problem found (the dialog shows them field by field). */
export function checkLanding(input: { choice: unknown; answers?: unknown }):
  { ok: true; value: { choice: LandingChoice; answers: LandingAnswers | null } } | { ok: false; problems: LandingProblem[] } {
  if (typeof input.choice !== "string" || !(LANDING_CHOICES as readonly string[]).includes(input.choice)) return { ok: false, problems: [{ key: "choice" }] };
  const choice = input.choice as LandingChoice;
  if (choice === "none") return { ok: true, value: { choice, answers: null } };
  const raw = (typeof input.answers === "object" && input.answers !== null && !Array.isArray(input.answers) ? input.answers : {}) as Record<string, unknown>;
  const problems: LandingProblem[] = [];
  const out: LandingAnswers = { ...EMPTY_LANDING, references: [] };
  for (const k of ["purpose", "notes"] as const) {
    const v = typeof raw[k] === "string" ? (raw[k] as string).trim() : "";
    if (!v && k === "purpose") problems.push({ key: k, problem: "required" });
    else if (v.length > LANDING_LIMITS[k]) problems.push({ key: k, problem: "tooLong" });
    out[k] = v;
  }
  const refs = Array.isArray(raw.references) ? raw.references.filter((r): r is string => typeof r === "string") : [];
  const cleaned = refs.map((r) => r.trim()).filter(Boolean);
  if (cleaned.length > LANDING_LIMITS.references) problems.push({ key: "references", problem: "tooMany" });
  for (const r of cleaned.slice(0, LANDING_LIMITS.references)) {
    const u = normaliseLandingUrl(r);
    if (!u.ok) { problems.push({ key: "references", problem: "invalid", value: r }); break; }
    if (!out.references.includes(u.value)) out.references.push(u.value);
  }
  return problems.length ? { ok: false, problems } : { ok: true, value: { choice, answers: out } };
}

/** The plain sentence for a problem (the dialog's field message). */
export function landingProblemText(p: LandingProblem): string {
  if (p.key === "choice") return LANDING_MESSAGE.choice;
  if (p.key === "references") return p.problem === "tooMany" ? LANDING_MESSAGE.tooMany : `${p.value ? `"${p.value}": ` : ""}${LANDING_MESSAGE.url}`;
  if (p.problem === "required") return LANDING_MESSAGE.required;
  return LANDING_MESSAGE.tooLong(LANDING_LIMITS[p.key]);
}

/** The stored add-on (null when nothing was decided yet or the value is unreadable). */
export function parseLandingAddOn(raw: unknown): LandingAddOn | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  if (!o || typeof o !== "object" || !(LANDING_CHOICES as readonly string[]).includes(o.choice as string)) return null;
  const choice = o.choice as LandingChoice;
  const a = (o.answers && typeof o.answers === "object" ? o.answers : null) as Record<string, unknown> | null;
  const str = (k: string) => (a && typeof a[k] === "string" ? (a[k] as string) : "");
  return {
    choice,
    answers: choice === "none" || !a ? null : {
      pageUrl: str("pageUrl"), title: str("title"), purpose: str("purpose"), audience: str("audience"), sections: str("sections"),
      tone: str("tone"), cta: str("cta"), notes: str("notes"),
      references: Array.isArray(a.references) ? a.references.filter((r): r is string => typeof r === "string") : [],
    },
    revision: typeof o.revision === "number" && Number.isFinite(o.revision) ? o.revision : 1,
    savedAt: typeof o.savedAt === "string" ? o.savedAt : "",
    savedByUserId: typeof o.savedByUserId === "string" ? o.savedByUserId : "",
    ...(typeof o.changeRequestId === "string" && o.changeRequestId ? { changeRequestId: o.changeRequestId } : {}),
    ...(typeof o.changeNumber === "number" ? { changeNumber: o.changeNumber } : {}),
  };
}

export function serialiseLandingAddOn(a: LandingAddOn): string {
  return JSON.stringify(a);
}

export function landingState(a: LandingAddOn | null): LandingState {
  if (!a) return "open";
  return a.choice === "none" ? "notNeeded" : "filled";
}

/** The chip's short value. */
export function landingChipValue(a: LandingAddOn | null): string {
  const s = landingState(a);
  if (s === "notNeeded") return "Not needed";
  if (s === "open") return "";
  return a!.choice === "modify" ? "change the existing page" : "new page";
}

/** The dialog's starting answers: the saved ones, else empty with the existing product's website among the examples. */
export function landingDraft(saved: LandingAddOn | null, websiteUrl: string): { choice: LandingChoice | null; answers: LandingAnswers } {
  if (saved?.answers) {
    const refs = [...saved.answers.references];
    // older answers kept the existing page's address apart: it shows among the addresses now
    if (saved.answers.pageUrl && !refs.includes(saved.answers.pageUrl)) refs.unshift(saved.answers.pageUrl);
    return { choice: saved.choice, answers: { ...saved.answers, references: refs } };
  }
  return { choice: saved?.choice ?? null, answers: { ...EMPTY_LANDING, references: websiteUrl ? [websiteUrl] : [] } };
}

/* ── the Goals & requirements section "Landing page" ────────────────────────── */

export const LANDING_SECTION_FIELD = "LandingPageSection";
/** requirements.draft with this purpose writes only the add-on's section (the answers changed after the draft). */
export const LANDING_JOB_PURPOSE = "landingPage";

export type LandingPriority = "must" | "should" | "could";
export interface LandingReq { priority: LandingPriority; title: string; text: string }

export interface LandingSection {
  /** The add-on revision the section was written from. */
  revision: number;
  choice: "new" | "modify";
  goals: string[];
  requirements: LandingReq[];
  generatedAt: string;
  /** "" until someone confirms this revision. */
  confirmedAt: string;
  confirmedByUserId: string;
}

/** "none" no landing page wanted · "preparing" the section for the latest answers isn't written yet · "review" written,
 *  waiting for confirmation · "confirmed". */
export type LandingReview = "none" | "preparing" | "review" | "confirmed";

const sentence = (t: string) => {
  const s = t.trim().replace(/\s+/g, " ");
  if (!s) return "";
  const c = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?]$/.test(c) ? c : `${c}.`;
};
const bare = (t: string) => t.trim().replace(/[.;:!]+$/, "");
const host = (url: string) => url.replace(/^https?:\/\//i, "").replace(/\/$/, "");

/** The key sections, one per line (or separated by ";"), cleaned of bullets. */
export function landingSectionsList(text: string): string[] {
  return text.split(/\n|;/).map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean).slice(0, 12);
}

/** What the engine knows about the project besides the answers (its name, description, goal, users, website). */
export interface LandingContext {
  name: string;
  description: string;
  goal: string;
  users: string;
  websiteUrl: string;
  /** What the product must do (setup must-haves), most important first. */
  features: readonly string[];
}

export const EMPTY_CONTEXT: LandingContext = { name: "", description: "", goal: "", users: "", websiteUrl: "", features: [] };

/** What the page is built around, worked out from the answers and the project: the headline, who it speaks to, the main
 *  button, the tone and the sections. Older stored answers win where they were given. */
export interface LandingBrief { title: string; audience: string; cta: string; tone: string; sections: string[]; pageUrl: string; examples: string[] }

const CTA_RULES: readonly [RegExp, string][] = [
  [/\bdemo\b/i, "Book a demo"],
  [/\b(trial|try (it|out))\b/i, "Start a free trial"],
  [/\b(sign[ -]?up|register|join|create an account)\b/i, "Sign up"],
  [/\b(download|install)\b/i, "Download"],
  [/\b(order|buy|shop|purchase)\b/i, "Order now"],
  [/\b(book|appointment|reserve)\b/i, "Book an appointment"],
  [/\b(apply|application)\b/i, "Apply now"],
  [/\b(newsletter|subscribe)\b/i, "Subscribe"],
];

/** "… for treasury analysts and finance leads, …" → "treasury analysts and finance leads". */
export function audienceFrom(text: string): string {
  const m = /\b(?:for|to|aimed at|targeting|so that)\s+((?:our |the |new |existing |potential )?[a-z][^.;,!?]{2,80}?)(?=\s+(?:to|so|and get|who|that|in order)\b|[.;,!?]|$)/i.exec(text);
  if (!m) return "";
  const a = m[1]!.trim();
  // "for X" must name people, not an action ("to book a demo")
  return /^(book|start|get|sign|order|buy|explain|show|make|see|try|download|apply)\b/i.test(a) ? "" : a;
}

export function landingBrief(addOn: LandingAddOn, ctx: LandingContext = EMPTY_CONTEXT): LandingBrief | null {
  if (addOn.choice === "none" || !addOn.answers) return null;
  const a = addOn.answers;
  const name = ctx.name.trim() || "the product";
  const all = `${a.purpose} ${a.notes} ${ctx.goal}`;
  const cta = bare(a.cta) || CTA_RULES.find(([re]) => re.test(`${a.purpose} ${a.notes}`))?.[1] || CTA_RULES.find(([re]) => re.test(all))?.[1] || "Get in touch";
  const audience = bare(a.audience) || audienceFrom(a.purpose) || bare(ctx.users) || "the people the product is for";
  const lead = bare(ctx.goal.split(/(?<=[.!?])\s/)[0] ?? "") || bare(ctx.description.split(/(?<=[.!?])\s/)[0] ?? "");
  // a short, positive goal makes a headline; a description of today's problem doesn't
  const headline = lead.length <= 60 && !/\b(today|currently|existing|slow|hard|problem|error|manual|broken|outdated|not)\b/i.test(lead);
  const title = bare(a.title) || (lead && headline ? `${name}: ${lead.charAt(0).toLowerCase()}${lead.slice(1)}` : name);
  const tone = bare(a.tone) || "Clear, friendly and professional, in plain words, with the organisation's own logo and colours";
  const asked = landingSectionsList(a.sections);
  const features = ctx.features.slice(0, 3).map((f) => bare(f)).filter(Boolean);
  const sections = asked.length ? asked : [
    `Headline and the "${cta}" button`,
    features.length ? `What it does: ${features.join(", ")}` : "What it does, in three short points",
    "How it works, in three steps",
    "What customers say",
    ...(/\b(price|pricing|cost)\b/i.test(all) ? ["Pricing"] : []),
    "Frequently asked questions",
    `"${cta}" again, with a short form`,
  ];
  const site = a.pageUrl || (addOn.choice === "modify" ? ctx.websiteUrl || a.references[0] || "" : "");
  const examples = a.references.filter((r) => r !== site && r !== ctx.websiteUrl);
  return { title, audience, cta, tone, sections, pageUrl: site, examples };
}

/** The goals and the Must/Should/Could requirements written from the answers and the project. Pure and deterministic. */
export function draftLandingSection(addOn: LandingAddOn, ctx: LandingContext = EMPTY_CONTEXT): { goals: string[]; requirements: LandingReq[] } | null {
  const b = landingBrief(addOn, ctx);
  if (!b || !addOn.answers) return null;
  const a = addOn.answers;
  const modify = addOn.choice === "modify";
  const page = modify ? (b.pageUrl ? `the existing landing page (${host(b.pageUrl)})` : "the existing landing page") : "a dedicated landing page";
  const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
  const goals = [
    sentence(`${modify ? "Rework" : "Launch"} ${page} for ${ctx.name.trim() || "the product"}, headed "${b.title}"`),
    sentence(bare(a.purpose)),
    sentence(`Speak to ${lowerFirst(b.audience)}`),
    sentence(`Lead visitors to one action: ${b.cta}`),
  ].filter(Boolean);
  const reqs: LandingReq[] = [
    { priority: "must", title: "Headline and main button at the top",
      text: sentence(`The top of the page shows the headline "${b.title}" and a clearly visible "${b.cta}" button without scrolling, on phones and computers`) },
    { priority: "must", title: "The page's sections",
      text: sentence(`The page has these sections, in this order: ${b.sections.join("; ")}`) },
    { priority: "must", title: `"${b.cta}" leads somewhere`,
      text: sentence(`Every "${b.cta}" button leads to a working next step (a form, a booking or a sign-up), and each click is counted`) },
    { priority: "must", title: "Works well on phones",
      text: "The page reads and works on phones, tablets and computers without sideways scrolling, and meets the usual accessibility rules (contrast, headings, keyboard)." },
    { priority: "should", title: "Tone and style",
      text: sentence(`Words, images and layout are ${lowerFirst(b.tone)}`) },
    { priority: "should", title: "Fast to load and easy to find",
      text: "The page loads in under two seconds on a normal mobile connection and has a page title, description and preview image for search engines and sharing." },
  ];
  if (modify) {
    reqs.push({ priority: "must", title: "Keep the current address working",
      text: sentence(`The reworked page stays at ${b.pageUrl ? host(b.pageUrl) : "its current address"}; links people already use keep working`) });
  }
  if (a.notes.trim()) reqs.push({ priority: "must", title: "What it must include", text: sentence(bare(a.notes)) });
  if (b.examples.length) {
    reqs.push({ priority: "could", title: "Ideas from pages the client likes",
      text: sentence(`Take ideas for layout and feel from ${b.examples.map(host).join(", ")}, without copying them`) });
  }
  reqs.push({ priority: "could", title: "Ready for later changes",
    text: "The team can change texts and images of the page later without a new build." });
  const rank: Record<LandingPriority, number> = { must: 0, should: 1, could: 2 };
  return { goals, requirements: reqs.map((r, i) => ({ r, i })).sort((x, y) => rank[x.r.priority] - rank[y.r.priority] || x.i - y.i).map((x) => x.r) };
}

export function parseLandingSection(raw: unknown): LandingSection | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let o: Record<string, unknown>;
  try { o = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  if (!o || typeof o !== "object" || typeof o.revision !== "number" || (o.choice !== "new" && o.choice !== "modify")) return null;
  const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const reqs = Array.isArray(o.requirements) ? o.requirements.filter((r): r is LandingReq =>
    !!r && typeof r === "object" && ["must", "should", "could"].includes((r as LandingReq).priority)
    && typeof (r as LandingReq).title === "string" && typeof (r as LandingReq).text === "string") : [];
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  return {
    revision: o.revision, choice: o.choice, goals: strs(o.goals), requirements: reqs,
    generatedAt: s("generatedAt"), confirmedAt: s("confirmedAt"), confirmedByUserId: s("confirmedByUserId"),
  };
}

export function serialiseLandingSection(s: LandingSection): string {
  return JSON.stringify(s);
}

/** The section the engine writes for the add-on as saved (null when no landing page is wanted). */
export function landingSectionFor(addOn: LandingAddOn | null, nowIso: string, ctx: LandingContext = EMPTY_CONTEXT): LandingSection | null {
  if (!addOn || addOn.choice === "none") return null;
  const d = draftLandingSection(addOn, ctx);
  if (!d) return null;
  return { revision: addOn.revision, choice: addOn.choice, ...d, generatedAt: nowIso, confirmedAt: "", confirmedByUserId: "" };
}

export function landingReview(addOn: LandingAddOn | null, section: LandingSection | null): LandingReview {
  if (!addOn || addOn.choice === "none") return "none";
  if (!section || section.revision !== addOn.revision) return "preparing";
  return section.confirmedAt ? "confirmed" : "review";
}

/** True when the requirements can't be approved yet because of the add-on (the section is missing or unconfirmed). */
export function landingBlocks(addOnRaw: unknown, sectionRaw: unknown): boolean {
  const r = landingReview(parseLandingAddOn(addOnRaw), parseLandingSection(sectionRaw));
  return r === "preparing" || r === "review";
}

/** True for the job that writes only the add-on's section (it is not "the requirements draft" for the steps' status). */
export function isLandingJob(job: { inputJson?: string | null } | null | undefined): boolean {
  return new RegExp(`"purpose"\\s*:\\s*"${LANDING_JOB_PURPOSE}"`).test(job?.inputJson ?? "");
}
