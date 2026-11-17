/** The domain's words in the chosen language, read at render time. src/domain is bundled into the Blocks functions and the
 *  engine (no React, no Vite), so its label tables stay English and never import @/i18n; screens show these instead.
 *  The English here is the domain's own, word for word (test/goals/domainLabels.test.ts keeps both equal). Stored values
 *  (codes, saved answers) are never translated: only the words people see. */
import { getCulture, t } from "@/i18n";
import { LANDING_LIMITS, type LandingChoice, type LandingProblem } from "@/domain/landingPage";
import type { ExtraKind, ExtraRecord } from "@/domain/requirementsExtras";
import type { ClarificationStatus, DecisionStatus, NfrCategory, RequirementPriority, TechArea, TechStatus } from "@/domain/sanitization";
import type { ConstraintKind } from "@/domain/setupDetails";
import { SUCCESS_KEYS, isBlank, successBlockers, successSummary, type SetAgreement, type SuccessKey, type SuccessTargets } from "@/domain/successTargets";
import type { DOCUMENT_REFUSAL_TEXT } from "@/domain/liveProduct";

/* ── landing page (domain/landingPage.ts) ───────────────────────────────────── */

/** CHOICE_LABEL */
export function landingChoiceName(c: LandingChoice): string {
  switch (c) {
    case "none": return t("analysis.labels.landingChoice.none", "No landing page");
    case "new": return t("analysis.labels.landingChoice.new", "A new landing page");
    case "modify": return t("analysis.labels.landingChoice.modify", "Change the existing landing page");
  }
}

/** landingProblemText: one problem of the landing page answers in plain words. */
export function landingProblemName(p: LandingProblem): string {
  if (p.key === "choice") return t("analysis.labels.landing.choice", "Choose whether you want a landing page.");
  if (p.key === "references") {
    if (p.problem === "tooMany") return t("analysis.labels.landing.tooMany", "Add at most {max} addresses.", { max: LANDING_LIMITS.references });
    const url = t("analysis.labels.landing.url", "Enter a web address, like www.example.com.");
    return p.value ? `"${p.value}": ${url}` : url;
  }
  if (p.problem === "required") return t("analysis.labels.landing.required", "Please fill this in.");
  return t("analysis.labels.landing.tooLong", "Use at most {max} characters.", { max: LANDING_LIMITS[p.key] });
}

/* ── Understanding your project (domain/sanitization.ts) ────────────────────── */

/** CLARIFICATION_STATUS_LABEL */
export function clarificationStatusName(s: ClarificationStatus): string {
  switch (s) {
    case "open": return t("analysis.labels.clarificationStatus.open", "Open");
    case "answered": return t("analysis.labels.clarificationStatus.answered", "Answered");
    case "deferred": return t("analysis.labels.clarificationStatus.deferred", "Deferred");
  }
}

/** DECISION_STATUS_LABEL */
export function decisionStatusName(s: DecisionStatus): string {
  switch (s) {
    case "proposed": return t("analysis.labels.decisionStatus.proposed", "Proposed");
    case "accepted": return t("analysis.labels.decisionStatus.accepted", "Active");
    case "rejected": return t("analysis.labels.decisionStatus.rejected", "Rejected");
    case "superseded": return t("analysis.labels.decisionStatus.superseded", "Superseded");
  }
}

/** TECH_STATUS_LABEL */
export function techStatusName(s: TechStatus): string {
  switch (s) {
    case "proposed": return t("analysis.labels.techStatus.proposed", "Proposed");
    case "accepted": return t("analysis.labels.techStatus.accepted", "Agreed");
    case "rejected": return t("analysis.labels.techStatus.rejected", "Rejected");
  }
}

/** TECH_AREA_LABEL */
export function areaName(a: TechArea): string {
  switch (a) {
    case "stack": return t("analysis.labels.techArea.stack", "Tech stack");
    case "architecture": return t("analysis.labels.techArea.architecture", "Architecture");
    case "integration": return t("analysis.labels.techArea.integration", "Integrations");
    case "nfr": return t("analysis.labels.techArea.nfr", "Non-functional requirements");
    case "security": return t("analysis.labels.techArea.security", "Security");
    case "data": return t("analysis.labels.techArea.data", "Data");
    case "hosting": return t("analysis.labels.techArea.hosting", "Hosting");
    case "other": return t("analysis.labels.techArea.other", "Other");
  }
}

/** NFR_CATEGORY_LABEL */
export function nfrCategoryName(c: NfrCategory): string {
  switch (c) {
    case "performance": return t("analysis.labels.nfrCategory.performance", "Performance");
    case "security": return t("analysis.labels.nfrCategory.security", "Security");
    case "availability": return t("analysis.labels.nfrCategory.availability", "Availability");
    case "scalability": return t("analysis.labels.nfrCategory.scalability", "Scalability");
    case "accessibility": return t("analysis.labels.nfrCategory.accessibility", "Accessibility");
    case "privacy": return t("analysis.labels.nfrCategory.privacy", "Privacy");
    case "compliance": return t("analysis.labels.nfrCategory.compliance", "Compliance");
    case "operability": return t("analysis.labels.nfrCategory.operability", "Operability");
    case "other": return t("analysis.labels.nfrCategory.other", "Other");
  }
}

/** PRIORITY_LABEL of domain/sanitization.ts (the Requirements v1 words: Must / Nice to have / Later). */
export function priorityName(p: RequirementPriority): string {
  switch (p) {
    case "must": return t("analysis.labels.priority.must", "Must");
    case "nice": return t("analysis.labels.priority.nice", "Nice to have");
    case "later": return t("analysis.labels.priority.later", "Later");
  }
}

/** A stored status, area, category or priority that may be unknown: its name, else the stored value as it is. */
export function nameOr<K extends string>(name: (k: K) => string, known: readonly K[], value: string): string {
  return (known as readonly string[]).includes(value) ? name(value as K) : value;
}

/* ── workflows, constraints & not included (domain/requirementsExtras.ts, domain/setupDetails.ts) ───────── */

/** CONSTRAINT_LABEL */
export function constraintKindName(k: ConstraintKind): string {
  switch (k) {
    case "deadline": return t("analysis.labels.constraint.deadline", "Deadline");
    case "budget": return t("analysis.labels.constraint.budget", "Budget");
    case "compliance": return t("analysis.labels.constraint.compliance", "Compliance");
    case "languages": return t("analysis.labels.constraint.languages", "Languages");
    case "integrations": return t("analysis.labels.constraint.integrations", "Integrations");
    case "other": return t("analysis.labels.constraint.other", "Something else");
  }
}

/** CONSTRAINT_PLACEHOLDER */
export function constraintPlaceholder(k: ConstraintKind): string {
  switch (k) {
    case "deadline": return t("analysis.labels.constraintHint.deadline", "For example: live before the spring season starts on 1 March");
    case "budget": return t("analysis.labels.constraintHint.budget", "For example: about CHF 80 000 for the first version");
    case "compliance": return t("analysis.labels.constraintHint.compliance", "For example: Swiss data protection (revDSG), data stays in Switzerland");
    case "languages": return t("analysis.labels.constraintHint.languages", "For example: German and French, English later");
    case "integrations": return t("analysis.labels.constraintHint.integrations", "For example: our ERP (orders and stock) and Microsoft 365 sign-in");
    case "other": return t("analysis.labels.constraintHint.other", "Anything else we must keep in mind");
  }
}

/** constraintTag: the kind as a tag beside the constraint's own words ("" for "other"). */
export function constraintTagName(kind: ConstraintKind | "" | null | undefined): string {
  const k = kind || "other";
  return k === "other" ? "" : constraintKindName(k);
}

/** constraintText: "Deadline: live before 1 March" (or just the kind when nothing more was said). */
export function constraintWords(e: Pick<ExtraRecord, "constraintKind" | "title">): string {
  const k = e.constraintKind || "other";
  if (k === "other") return e.title;
  return e.title ? `${constraintKindName(k)}: ${e.title}` : constraintKindName(k);
}

/** EXTRA_LABEL: a list's title, one item's name, its "Add" button and its empty line. */
export function extraLabel(kind: ExtraKind): { title: string; one: string; add: string; empty: string } {
  switch (kind) {
    case "workflow": return {
      title: t("analysis.labels.extra.workflow.title", "Key workflows"),
      one: t("analysis.labels.extra.workflow.one", "workflow"),
      add: t("analysis.labels.extra.workflow.add", "Add a workflow"),
      empty: t("analysis.labels.extra.workflow.empty", "No workflows yet. Describe who does what, step by step."),
    };
    case "exclusion": return {
      title: t("analysis.labels.extra.exclusion.title", "Not included"),
      one: t("analysis.labels.extra.exclusion.one", "item"),
      add: t("analysis.labels.extra.exclusion.add", "Add something we leave out"),
      empty: t("analysis.labels.extra.exclusion.empty", "Nothing is left out yet. Say what this version won't do, so nobody expects it."),
    };
    case "constraint": return {
      title: t("analysis.labels.extra.constraint.title", "Constraints"),
      one: t("analysis.labels.extra.constraint.one", "constraint"),
      add: t("analysis.labels.extra.constraint.add", "Add a constraint"),
      empty: t("analysis.labels.extra.constraint.empty", "No constraints yet. Add the deadline, budget, rules, languages or systems we must respect."),
    };
  }
}

/* ── success & performance targets (domain/successTargets.ts) ──────────────────────────────────────────────── */

/** SUCCESS_SHORT: a target's short name (table rows, chips, lists). */
export function successShortName(k: SuccessKey): string {
  switch (k) {
    case "outcome": return t("analysis.labels.successShort.outcome", "Success outcome");
    case "users": return t("analysis.labels.successShort.users", "Expected users");
    case "responseTime": return t("analysis.labels.successShort.responseTime", "Response time");
    case "dataVolume": return t("analysis.labels.successShort.dataVolume", "Data volume");
    case "availability": return t("analysis.labels.successShort.availability", "Peak times");
  }
}

/** A target's short name inside a sentence: lower case in English ("response time"); German keeps its nouns capitalised. */
export function successShortInSentence(k: SuccessKey): string {
  const name = successShortName(k);
  return getCulture() === "en" ? name.toLowerCase() : name;
}

/** SUCCESS_LABEL: a target's question in the editor. */
export function successQuestionName(k: SuccessKey): string {
  switch (k) {
    case "outcome": return t("analysis.labels.successLabel.outcome", "How will we know it worked?");
    case "users": return t("analysis.labels.successLabel.users", "Expected users");
    case "responseTime": return t("analysis.labels.successLabel.responseTime", "How fast should it feel?");
    case "dataVolume": return t("analysis.labels.successLabel.dataVolume", "How much data");
    case "availability": return t("analysis.labels.successLabel.availability", "Peak times & availability");
  }
}

/** SUCCESS_HINT: the line under a target's question. */
export function successHint(k: SuccessKey): string {
  switch (k) {
    case "outcome": return t("analysis.labels.successHint.outcome", "The result that tells everyone the project paid off, ideally with a number.");
    case "users": return t("analysis.labels.successHint.users", "How many people use it, and how many at the same time.");
    case "responseTime": return t("analysis.labels.successHint.responseTime", "How quickly pages and searches should answer for the people using it.");
    case "dataVolume": return t("analysis.labels.successHint.dataVolume", "Roughly how many records, files or orders it holds, now and in a year or two.");
    case "availability": return t("analysis.labels.successHint.availability", "Busy hours or days, and when it must not be down. Optional.");
  }
}

/** SUCCESS_PLACEHOLDER: the example in a target's field. */
export function successPlaceholder(k: SuccessKey): string {
  switch (k) {
    case "outcome": return t("analysis.labels.successPlaceholder.outcome", "e.g. 70% of repeat orders placed online within six months");
    case "users": return t("analysis.labels.successPlaceholder.users", "e.g. 300 buyers, up to 60 at the same time");
    case "responseTime": return t("analysis.labels.successPlaceholder.responseTime", "e.g. pages and searches answer in under 1 second");
    case "dataVolume": return t("analysis.labels.successPlaceholder.dataVolume", "e.g. 25,000 orders a year, 4,000 products");
    case "availability": return t("analysis.labels.successPlaceholder.availability", "e.g. weekdays 06:00–20:00, busiest on Monday mornings");
  }
}

/** The label of a friendly answer to a target (USER_CHOICES, RESPONSE_TIME_CHOICES, DATA_CHOICES). Only the label is
 *  translated: the value a choice sets is stored as it is. An unknown choice keeps its own label. */
export function successChoiceName(k: SuccessKey, c: { id: string; label: string }): string {
  if (k === "responseTime") {
    switch (c.id) {
      case "instant": return t("analysis.labels.successChoice.responseTime.instant", "Instant");
      case "fast": return t("analysis.labels.successChoice.responseTime.fast", "Fast");
      case "normal": return t("analysis.labels.successChoice.responseTime.normal", "Normal");
      case "patient": return t("analysis.labels.successChoice.responseTime.patient", "Can take a moment");
    }
  }
  if (k === "users") {
    switch (c.id) {
      case "small": return t("analysis.labels.successChoice.users.small", "Up to 50");
      case "team": return t("analysis.labels.successChoice.users.team", "50–500");
      case "large": return t("analysis.labels.successChoice.users.large", "500–5,000");
      case "public": return t("analysis.labels.successChoice.users.public", "5,000+");
    }
  }
  if (k === "dataVolume") {
    switch (c.id) {
      case "small": return t("analysis.labels.successChoice.dataVolume.small", "Small");
      case "medium": return t("analysis.labels.successChoice.dataVolume.medium", "Medium");
      case "large": return t("analysis.labels.successChoice.dataVolume.large", "Large");
    }
  }
  return c.label;
}

/** SET_AGREEMENT_LABEL: who agreed a set value. */
export function setAgreementName(a: SetAgreement): string {
  switch (a) {
    case "agreed": return t("analysis.labels.setAgreement.agreed", "Agreed");
    case "proposed": return t("analysis.labels.setAgreement.proposed", "Proposed");
    case "agreedWithScope": return t("analysis.labels.setAgreement.agreedWithScope", "Agreed with the scope");
  }
}

/** "a, b and c" for the success sentences. */
function andList(xs: readonly string[]): string {
  return xs.length <= 1 ? xs.join("") : t("analysis.labels.success.listAnd", "{items} and {last}", { items: xs.slice(0, -1).join(", "), last: xs[xs.length - 1] });
}

/** successBlockersText: why the lock waits on the success targets, from the blockers alone (null when nothing blocks). */
export function successBlockersWords(raw: readonly unknown[]): string | null {
  const b = raw.filter((x): x is { key: SuccessKey; kind: "missing" | "openQuestion" } => typeof x === "object" && x !== null
    && (SUCCESS_KEYS as readonly unknown[]).includes((x as { key?: unknown }).key)
    && ((x as { kind?: unknown }).kind === "missing" || (x as { kind?: unknown }).kind === "openQuestion"));
  if (!b.length) return null;
  const open = b.filter((x) => x.kind === "openQuestion").map((x) => successShortInSentence(x.key));
  const missing = b.filter((x) => x.kind === "missing").map((x) => successShortInSentence(x.key));
  if (open.length && missing.length) {
    return open.length === 1
      ? t("analysis.labels.success.answerOneAndSet", "Answer or accept the business analyst's question ({open}) and set {missing}.", { open: andList(open), missing: andList(missing) })
      : t("analysis.labels.success.answerManyAndSet", "Answer or accept the business analyst's questions ({open}) and set {missing}.", { open: andList(open), missing: andList(missing) });
  }
  if (open.length) {
    return open.length === 1
      ? t("analysis.labels.success.answerOne", "Answer or accept the business analyst's question on {open}.", { open: andList(open) })
      : t("analysis.labels.success.answerMany", "Answer or accept the business analyst's questions on {open}.", { open: andList(open) });
  }
  return t("analysis.labels.success.setTargets", "Set the success & performance targets: {missing}.", { missing: andList(missing) });
}

/** successLockReason: the same sentence from the targets. */
export function successLockReasonWords(targets: SuccessTargets): string | null {
  return successBlockersWords(successBlockers(targets));
}

/** successDetail: one line for the checklist and the lock (what is set, what is still open). */
export function successDetailWords(targets: SuccessTargets): string {
  const sum = successSummary(targets);
  if (isBlank(targets)) return t("analysis.labels.success.notSetYet", "Not set yet: outcome, users, response time and data volume");
  const parts = [t("analysis.labels.success.setOf", "{set} of {required} set", { set: sum.set, required: sum.required })];
  if (sum.openQuestions) {
    parts.push(sum.openQuestions === 1 ? t("analysis.labels.success.questionsOne", "1 question for the business analyst")
      : t("analysis.labels.success.questionsMany", "{count} questions for the business analyst", { count: sum.openQuestions }));
  }
  if (sum.waitingForTeam) {
    parts.push(sum.waitingForTeam === 1 ? t("analysis.labels.success.answersOne", "1 answer to review")
      : t("analysis.labels.success.answersMany", "{count} answers to review", { count: sum.waitingForTeam }));
  }
  return parts.join(" · ");
}

/* ── documenting a live product (domain/liveProduct.ts) ────────────────────────────────────────────────────── */

/** DOCUMENT_REFUSAL_TEXT: why a live product can't be documented from its code. */
export function documentRefusalText(r: keyof typeof DOCUMENT_REFUSAL_TEXT): string {
  switch (r) {
    case "notFound": return t("analysis.labels.documentRefusal.notFound", "This project no longer exists.");
    case "notExisting": return t("analysis.labels.documentRefusal.notExisting", "Only an existing product attached to the Factory can be documented from its code.");
    case "notLive": return t("analysis.labels.documentRefusal.notLive", "The product is documented once it is live: no release is recorded yet.");
    case "paused": return t("analysis.labels.documentRefusal.paused", "Resume the project before it is documented.");
  }
}
