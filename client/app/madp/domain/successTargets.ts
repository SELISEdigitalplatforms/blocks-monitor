/** Success & performance of a scope version (step "Scope & success"): what outcome makes the project a success, how many
 *  people use it, how fast it should feel, how much data it holds and when it must be available. Stored as one JSON
 *  string on the ScopeVersion row (`SuccessTargets`). A value can be marked "Not sure yet — ask the business analyst":
 *  it then carries a question for the business analyst, which must be answered or accepted before the scope locks.
 *  Pure: shared by the page, the scope ops and the local engine. */

export const SUCCESS_KEYS = ["outcome", "users", "responseTime", "dataVolume", "availability"] as const;
export type SuccessKey = (typeof SUCCESS_KEYS)[number];

/** The four the lock needs (availability / peak times is optional). */
export const REQUIRED_SUCCESS_KEYS: readonly SuccessKey[] = ["outcome", "users", "responseTime", "dataVolume"];

/** open → the business analyst has not answered yet; proposed → the business analyst answered, waiting for the team;
 *  answered → a value was agreed (the team's own or the business analyst's); accepted → the team goes ahead without a
 *  fixed value (the business analyst's answer stands as the working assumption). */
export type QuestionStatus = "open" | "proposed" | "answered" | "accepted";

export interface SuccessQuestion {
  status: QuestionStatus;
  text: string;
  askedAt: string;
  askedBy: string;
  /** the business analyst's answer (a value in the same words as the field) and why */
  answer: string;
  reason: string;
  answeredAt: string;
  resolvedAt: string;
  resolvedBy: string;
}

export interface SuccessTarget {
  value: string;
  unsure: boolean;
  /** response time only: the friendly choice the value came from ("" = typed by hand) */
  choice: string;
  /** true while the value is the business analyst's proposal nobody has changed yet */
  suggested: boolean;
  question: SuccessQuestion | null;
}

export type SuccessTargets = Record<SuccessKey, SuccessTarget>;

export const SUCCESS_LABEL: Record<SuccessKey, string> = {
  outcome: "How will we know it worked?",
  users: "Expected users",
  responseTime: "How fast should it feel?",
  dataVolume: "How much data",
  availability: "Peak times & availability",
};

export const SUCCESS_SHORT: Record<SuccessKey, string> = {
  outcome: "Success outcome",
  users: "Expected users",
  responseTime: "Response time",
  dataVolume: "Data volume",
  availability: "Peak times",
};

export const SUCCESS_HINT: Record<SuccessKey, string> = {
  outcome: "The result that tells everyone the project paid off, ideally with a number.",
  users: "How many people use it, and how many at the same time.",
  responseTime: "How quickly pages and searches should answer for the people using it.",
  dataVolume: "Roughly how many records, files or orders it holds, now and in a year or two.",
  availability: "Busy hours or days, and when it must not be down. Optional.",
};

export const SUCCESS_PLACEHOLDER: Record<SuccessKey, string> = {
  outcome: "e.g. 70% of repeat orders placed online within six months",
  users: "e.g. 300 buyers, up to 60 at the same time",
  responseTime: "e.g. pages and searches answer in under 1 second",
  dataVolume: "e.g. 25,000 orders a year, 4,000 products",
  availability: "e.g. weekdays 06:00–20:00, busiest on Monday mornings",
};

export interface Choice { id: string; label: string; value: string }

/** Friendly answers for "How fast should it feel?"; each sets an exact value the team can still change. */
export const RESPONSE_TIME_CHOICES: readonly Choice[] = [
  { id: "instant", label: "Instant", value: "under 0.5 seconds for every page and search" },
  { id: "fast", label: "Fast", value: "under 1 second for pages and searches" },
  { id: "normal", label: "Normal", value: "under 2 seconds; reports up to 10 seconds" },
  { id: "patient", label: "Can take a moment", value: "under 5 seconds; large exports may run in the background" },
];

export const USER_CHOICES: readonly Choice[] = [
  { id: "small", label: "Up to 50", value: "up to 50 people, about 10 at the same time" },
  { id: "team", label: "50–500", value: "50–500 people, about 50 at the same time" },
  { id: "large", label: "500–5,000", value: "500–5,000 people, about 300 at the same time" },
  { id: "public", label: "5,000+", value: "more than 5,000 people, 1,000+ at the same time" },
];

export const DATA_CHOICES: readonly Choice[] = [
  { id: "small", label: "Small", value: "up to 10,000 records" },
  { id: "medium", label: "Medium", value: "up to 1 million records" },
  { id: "large", label: "Large", value: "several million records and growing" },
];

export const VALUE_MAX = 300;
const TEXT_MAX = 600;

/** The question the business analyst gets for an unsure value, in plain words. */
export function questionText(key: SuccessKey, projectName = ""): string {
  const of = projectName.trim() ? ` for ${projectName.trim()}` : "";
  switch (key) {
    case "outcome": return `What result will tell us that ${projectName.trim() || "the project"} worked?`;
    case "users": return `How many people will use it${of}, and how many at the same time?`;
    case "responseTime": return `How fast should pages and searches answer${of}?`;
    case "dataVolume": return `How much data will it hold${of}, now and in two years?`;
    case "availability": return `When are the busy times${of}, and when must it never be down?`;
  }
}

export function emptyTarget(): SuccessTarget {
  return { value: "", unsure: false, choice: "", suggested: false, question: null };
}

export function emptyTargets(): SuccessTargets {
  return { outcome: emptyTarget(), users: emptyTarget(), responseTime: emptyTarget(), dataVolume: emptyTarget(), availability: emptyTarget() };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const s = (v: unknown, max = TEXT_MAX): string => (typeof v === "string" ? v.slice(0, max) : "");
const STATUSES: readonly QuestionStatus[] = ["open", "proposed", "answered", "accepted"];

function questionOf(raw: unknown): SuccessQuestion | null {
  if (!isObj(raw)) return null;
  const status = STATUSES.includes(raw.status as QuestionStatus) ? (raw.status as QuestionStatus) : "open";
  return {
    status, text: s(raw.text), askedAt: s(raw.askedAt, 40), askedBy: s(raw.askedBy, 80), answer: s(raw.answer, VALUE_MAX),
    reason: s(raw.reason), answeredAt: s(raw.answeredAt, 40), resolvedAt: s(raw.resolvedAt, 40), resolvedBy: s(raw.resolvedBy, 80),
  };
}

function targetOf(raw: unknown): SuccessTarget {
  if (typeof raw === "string") return { ...emptyTarget(), value: raw.slice(0, VALUE_MAX) };
  if (!isObj(raw)) return emptyTarget();
  return {
    value: s(raw.value, VALUE_MAX),
    unsure: raw.unsure === true,
    choice: s(raw.choice, 40),
    suggested: raw.suggested === true,
    question: questionOf(raw.question),
  };
}

/** The stored JSON (string or object) as targets; anything unreadable reads as empty. */
export function parseSuccessTargets(raw: unknown): SuccessTargets {
  let v: unknown = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return emptyTargets();
    try { v = JSON.parse(raw); } catch { return emptyTargets(); }
  }
  const out = emptyTargets();
  if (!isObj(v)) return out;
  for (const k of SUCCESS_KEYS) out[k] = targetOf(v[k]);
  return out;
}

export const serializeSuccessTargets = (t: SuccessTargets): string => JSON.stringify(t);

/** True when nothing was entered at all (a version from before this section existed). */
export function isBlank(t: SuccessTargets): boolean {
  return SUCCESS_KEYS.every((k) => !t[k].value.trim() && !t[k].unsure);
}

export type TargetState = "set" | "missing" | "open" | "proposed" | "accepted";

/** Where one value stands: agreed, still empty, waiting for the business analyst, waiting for the team, or accepted open. */
export function targetState(t: SuccessTarget): TargetState {
  if (t.unsure) {
    const q = t.question?.status ?? "open";
    if (q === "accepted") return "accepted";
    if (q === "answered") return t.value.trim() ? "set" : "accepted";
    return q === "proposed" ? "proposed" : "open";
  }
  return t.value.trim() ? "set" : "missing";
}

export const isResolved = (st: TargetState): boolean => st === "set" || st === "accepted";

/** Whether a value that is set was agreed, in people's words. The business analyst's proposal that nobody changed
 *  (`suggested`) is "Proposed" while the scope is a draft: nobody agreed it yet (the lock does not wait for it).
 *  Locking the scope agrees the scope with its targets, so after the lock the same value is "Agreed with the scope".
 *  A value the team gave itself, or took over from the business analyst's answer, is "Agreed". */
export type SetAgreement = "agreed" | "proposed" | "agreedWithScope";

export function setAgreement(t: Pick<SuccessTarget, "suggested">, locked: boolean): SetAgreement {
  if (!t.suggested) return "agreed";
  return locked ? "agreedWithScope" : "proposed";
}

export const SET_AGREEMENT_LABEL: Record<SetAgreement, string> = {
  agreed: "Agreed",
  proposed: "Proposed",
  agreedWithScope: "Agreed with the scope",
};

export interface SuccessBlocker { key: SuccessKey; kind: "missing" | "openQuestion" }

/** What still stops the lock: a required value nobody gave, or a question for the business analyst that is still open.
 *  The scope.lock op runs the same rule. */
export function successBlockers(t: SuccessTargets): SuccessBlocker[] {
  const out: SuccessBlocker[] = [];
  for (const k of SUCCESS_KEYS) {
    const st = targetState(t[k]);
    if (st === "open" || st === "proposed") out.push({ key: k, kind: "openQuestion" });
    else if (st === "missing" && REQUIRED_SUCCESS_KEYS.includes(k)) out.push({ key: k, kind: "missing" });
  }
  return out;
}

export interface SuccessSummary { set: number; required: number; openQuestions: number; waitingForTeam: number; accepted: number; done: boolean }

export function successSummary(t: SuccessTargets): SuccessSummary {
  const states = SUCCESS_KEYS.map((k) => [k, targetState(t[k])] as const);
  const req = states.filter(([k]) => REQUIRED_SUCCESS_KEYS.includes(k));
  return {
    set: req.filter(([, st]) => isResolved(st)).length,
    required: REQUIRED_SUCCESS_KEYS.length,
    openQuestions: states.filter(([, st]) => st === "open").length,
    waitingForTeam: states.filter(([, st]) => st === "proposed").length,
    accepted: states.filter(([, st]) => st === "accepted").length,
    done: successBlockers(t).length === 0,
  };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One line for the checklist and the lock: what is set, what is still open. */
export function successDetail(t: SuccessTargets): string {
  const sum = successSummary(t);
  if (isBlank(t)) return "Not set yet: outcome, users, response time and data volume";
  const parts = [`${sum.set} of ${sum.required} set`];
  if (sum.openQuestions) parts.push(`${plural(sum.openQuestions, "question", "questions")} for the business analyst`);
  if (sum.waitingForTeam) parts.push(`${plural(sum.waitingForTeam, "answer", "answers")} to review`);
  return parts.join(" · ");
}

/** The sentence that says why the lock waits (null when nothing blocks). */
export function successLockReason(t: SuccessTargets): string | null {
  return successBlockersText(successBlockers(t));
}

/** The same sentence from the blockers alone (what scope.lock answers when it refuses). */
export function successBlockersText(raw: readonly unknown[]): string | null {
  const b = raw.filter((x): x is SuccessBlocker => isObj(x) && (SUCCESS_KEYS as readonly unknown[]).includes(x.key) && (x.kind === "missing" || x.kind === "openQuestion"));
  if (!b.length) return null;
  const open = b.filter((x) => x.kind === "openQuestion").map((x) => SUCCESS_SHORT[x.key].toLowerCase());
  const missing = b.filter((x) => x.kind === "missing").map((x) => SUCCESS_SHORT[x.key].toLowerCase());
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  if (open.length && missing.length) return `Answer or accept the business analyst's ${open.length === 1 ? "question" : "questions"} (${list(open)}) and set ${list(missing)}.`;
  if (open.length) return `Answer or accept the business analyst's ${open.length === 1 ? "question" : "questions"} on ${list(open)}.`;
  return `Set the success & performance targets: ${list(missing)}.`;
}

/* ── changes (the page builds the new value, the op stores it after parseSuccessTargets) ───────────────────── */

/** Mark a value unsure: the value is cleared and it gets a fresh open question for the business analyst (an existing,
 *  still undecided one is kept). */
export function markUnsure(t: SuccessTarget, key: SuccessKey, by: string, at: string, projectName = ""): SuccessTarget {
  const keep = t.question && t.question.status !== "answered" ? t.question : null;
  return {
    ...t, value: "", choice: "", unsure: true, suggested: false,
    question: keep ?? { status: "open", text: questionText(key, projectName), askedAt: at, askedBy: by, answer: "", reason: "", answeredAt: "", resolvedAt: "", resolvedBy: "" },
  };
}

/** The team gives the value itself: the question (if any) is answered by that. */
export function setValue(t: SuccessTarget, value: string, by: string, at: string, choice = ""): SuccessTarget {
  const v = value.slice(0, VALUE_MAX);
  const q = t.question && v.trim() ? { ...t.question, status: "answered" as const, resolvedAt: at, resolvedBy: by } : t.question;
  return { ...t, value: v, choice, unsure: v.trim() ? false : t.unsure, suggested: false, question: q };
}

/** The business analyst's answer is used as the value. */
export function takeAnswer(t: SuccessTarget, by: string, at: string): SuccessTarget {
  if (!t.question?.answer.trim()) return t;
  return { ...t, value: t.question.answer, unsure: false, suggested: false, choice: "", question: { ...t.question, status: "answered", resolvedAt: at, resolvedBy: by } };
}

/** The team accepts going ahead without a fixed value (the business analyst's answer, if any, is the assumption). */
export function acceptOpen(t: SuccessTarget, by: string, at: string): SuccessTarget {
  if (!t.question) return t;
  return { ...t, unsure: true, question: { ...t.question, status: "accepted", resolvedAt: at, resolvedBy: by } };
}

/** Back to an open question (undo an accept). */
export function reopen(t: SuccessTarget): SuccessTarget {
  if (!t.question) return t;
  return { ...t, unsure: true, question: { ...t.question, status: t.question.answer.trim() ? "proposed" : "open", resolvedAt: "", resolvedBy: "" } };
}

/** Keys whose questions the business analyst still has to answer. */
export const openQuestionKeys = (t: SuccessTargets): SuccessKey[] => SUCCESS_KEYS.filter((k) => targetState(t[k]) === "open");

/** Keys the business analyst may propose a value for (empty and not unsure). */
export const emptyKeys = (t: SuccessTargets): SuccessKey[] => SUCCESS_KEYS.filter((k) => !t[k].unsure && !t[k].value.trim());

/** What the scope.success.save op stores: the team's values and decisions from `next`, while the business analyst's
 *  answers, who asked and when always come from the stored `prev` (a page never writes an answer in the product
 *  manager's name). Server time and the caller stamp every new question and every decision. */
export function normalizeTargets(next: SuccessTargets, prev: SuccessTargets, by: string, at: string, projectName = ""): SuccessTargets {
  const out = emptyTargets();
  for (const k of SUCCESS_KEYS) {
    const t = next[k];
    const p = prev[k];
    const value = t.value.trim() ? t.value.slice(0, VALUE_MAX) : "";
    const pq = p.question;
    let q: SuccessQuestion | null = null;
    if (t.unsure || (t.question && pq)) {
      const answer = pq?.answer ?? "";
      const base: SuccessQuestion = {
        status: "open", text: pq?.text || questionText(k, projectName), askedAt: pq?.askedAt || at, askedBy: pq?.askedBy || by,
        answer, reason: pq?.reason ?? "", answeredAt: pq?.answeredAt ?? "", resolvedAt: "", resolvedBy: "",
      };
      let status: QuestionStatus = t.question?.status ?? "open";
      if (!t.unsure && value) status = "answered";
      if (status === "answered" && !value) status = answer ? "proposed" : "open";
      if (status === "open" && answer) status = "proposed";
      if (status === "proposed" && !answer) status = "open";
      const decided = status === "answered" || status === "accepted";
      const same = decided && pq?.status === status;
      q = { ...base, status, resolvedAt: decided ? (same ? pq!.resolvedAt || at : at) : "", resolvedBy: decided ? (same ? pq!.resolvedBy || by : by) : "" };
      // a value given without ever being unsure, and no stored question: nothing to keep
      if (!t.unsure && !pq) q = null;
      // unsure withdrawn with no value: the question goes too
      if (!t.unsure && !value && status !== "accepted") q = null;
    }
    out[k] = {
      value, unsure: t.unsure && !(value && q?.status === "answered"),
      choice: k === "responseTime" && RESPONSE_TIME_CHOICES.some((c) => c.id === t.choice) ? t.choice : "",
      suggested: t.suggested && Boolean(value), question: q,
    };
  }
  return out;
}
