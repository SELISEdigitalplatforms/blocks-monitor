// The screens' words for the domain's codes (src/components/requirements/domainLabels.ts) say in English exactly what the
// domain's own tables say: src/domain stays English for the Blocks functions and the engine, the screens translate.
import { describe, expect, it } from "vitest";
import {
  areaName, clarificationStatusName, constraintKindName, constraintPlaceholder, constraintTagName, constraintWords, decisionStatusName,
  documentRefusalText, extraLabel, landingChoiceName, landingProblemName, nfrCategoryName, priorityName, setAgreementName,
  successBlockersWords, successChoiceName, successDetailWords, successHint, successLockReasonWords, successPlaceholder, successQuestionName,
  successShortInSentence, successShortName, techStatusName,
} from "../../src/components/requirements/domainLabels";
import { DOCUMENT_REFUSAL_TEXT } from "../../src/domain/liveProduct";
import {
  DATA_CHOICES, RESPONSE_TIME_CHOICES, SET_AGREEMENT_LABEL, SUCCESS_HINT, USER_CHOICES, SUCCESS_KEYS, SUCCESS_LABEL, SUCCESS_PLACEHOLDER, SUCCESS_SHORT, emptyTargets, successBlockersText,
  successDetail, successLockReason, type SetAgreement, type SuccessTargets,
} from "../../src/domain/successTargets";
import { CHOICE_LABEL, LANDING_CHOICES, landingProblemText, type LandingProblem } from "../../src/domain/landingPage";
import { EXTRA_KINDS, EXTRA_LABEL, constraintTag, constraintText } from "../../src/domain/requirementsExtras";
import {
  CLARIFICATION_STATUSES, CLARIFICATION_STATUS_LABEL, DECISION_STATUS_LABEL, NFR_CATEGORIES, NFR_CATEGORY_LABEL, PRIORITY_LABEL,
  REQUIREMENT_PRIORITIES, TECH_AREAS, TECH_AREA_LABEL, TECH_STATUSES, TECH_STATUS_LABEL, type DecisionStatus,
} from "../../src/domain/sanitization";
import { CONSTRAINT_KINDS, CONSTRAINT_LABEL, CONSTRAINT_PLACEHOLDER } from "../../src/domain/setupDetails";

describe("domain labels on screen (English is the domain's own)", () => {
  it("landing page choices and problems", () => {
    for (const c of LANDING_CHOICES) expect(landingChoiceName(c)).toBe(CHOICE_LABEL[c]);
    const problems: LandingProblem[] = [
      { key: "choice" },
      { key: "purpose", problem: "required" },
      { key: "notes", problem: "tooLong" },
      { key: "references", problem: "tooMany" },
      { key: "references", problem: "invalid" },
      { key: "references", problem: "invalid", value: "not a url" },
    ];
    for (const p of problems) expect(landingProblemName(p)).toBe(landingProblemText(p));
  });

  it("Understanding your project: statuses, areas, categories, priorities", () => {
    for (const s of CLARIFICATION_STATUSES) expect(clarificationStatusName(s)).toBe(CLARIFICATION_STATUS_LABEL[s]);
    for (const s of Object.keys(DECISION_STATUS_LABEL) as DecisionStatus[]) expect(decisionStatusName(s)).toBe(DECISION_STATUS_LABEL[s]);
    for (const s of TECH_STATUSES) expect(techStatusName(s)).toBe(TECH_STATUS_LABEL[s]);
    for (const a of TECH_AREAS) expect(areaName(a)).toBe(TECH_AREA_LABEL[a]);
    for (const c of NFR_CATEGORIES) expect(nfrCategoryName(c)).toBe(NFR_CATEGORY_LABEL[c]);
    for (const p of REQUIREMENT_PRIORITIES) expect(priorityName(p)).toBe(PRIORITY_LABEL[p]);
  });

  it("workflows, constraints and not included", () => {
    for (const k of CONSTRAINT_KINDS) {
      expect(constraintKindName(k)).toBe(CONSTRAINT_LABEL[k]);
      expect(constraintPlaceholder(k)).toBe(CONSTRAINT_PLACEHOLDER[k]);
      expect(constraintTagName(k)).toBe(constraintTag(k));
      for (const title of ["", "live before 1 March"]) {
        expect(constraintWords({ constraintKind: k, title })).toBe(constraintText({ constraintKind: k, title }));
      }
    }
    expect(constraintTagName("")).toBe(constraintTag(""));
    for (const k of EXTRA_KINDS) expect(extraLabel(k)).toEqual(EXTRA_LABEL[k]);
  });

  it("success & performance targets", () => {
    for (const k of SUCCESS_KEYS) {
      expect(successShortName(k)).toBe(SUCCESS_SHORT[k]);
      expect(successShortInSentence(k)).toBe(SUCCESS_SHORT[k].toLowerCase());
      expect(successQuestionName(k)).toBe(SUCCESS_LABEL[k]);
      expect(successHint(k)).toBe(SUCCESS_HINT[k]);
      expect(successPlaceholder(k)).toBe(SUCCESS_PLACEHOLDER[k]);
    }
    for (const a of Object.keys(SET_AGREEMENT_LABEL) as SetAgreement[]) expect(setAgreementName(a)).toBe(SET_AGREEMENT_LABEL[a]);
    const blockers: unknown[][] = [
      [],
      [{ key: "users", kind: "missing" }],
      [{ key: "users", kind: "missing" }, { key: "dataVolume", kind: "missing" }, { key: "outcome", kind: "missing" }],
      [{ key: "responseTime", kind: "openQuestion" }],
      [{ key: "responseTime", kind: "openQuestion" }, { key: "outcome", kind: "openQuestion" }],
      [{ key: "responseTime", kind: "openQuestion" }, { key: "users", kind: "missing" }, { key: "dataVolume", kind: "missing" }],
      [{ key: "nope", kind: "missing" }, "x", null],
    ];
    for (const b of blockers) expect(successBlockersWords(b)).toBe(successBlockersText(b));
    const blank = emptyTargets();
    const some: SuccessTargets = {
      ...blank,
      users: { ...blank.users, value: "300 buyers" },
      responseTime: { ...blank.responseTime, unsure: true, question: { status: "open", text: "How fast?", askedAt: "", askedBy: "", answer: "", reason: "", answeredAt: "", resolvedAt: "", resolvedBy: "" } },
    };
    for (const tg of [blank, some]) {
      expect(successDetailWords(tg)).toBe(successDetail(tg));
      expect(successLockReasonWords(tg)).toBe(successLockReason(tg));
    }
  });

  it("documenting a live product", () => {
    for (const r of Object.keys(DOCUMENT_REFUSAL_TEXT) as (keyof typeof DOCUMENT_REFUSAL_TEXT)[]) expect(documentRefusalText(r)).toBe(DOCUMENT_REFUSAL_TEXT[r]);
  });

  it("the friendly answers to the success targets", () => {
    for (const c of USER_CHOICES) expect(successChoiceName("users", c)).toBe(c.label);
    for (const c of RESPONSE_TIME_CHOICES) expect(successChoiceName("responseTime", c)).toBe(c.label);
    for (const c of DATA_CHOICES) expect(successChoiceName("dataVolume", c)).toBe(c.label);
  });
});
