// Right after the requirements are approved, the scope draft (scope.draft) writes the features with their user stories
// first and proposes the milestones after them (engine kinds/scope/draft.ts). Until its milestones are in, nothing asks
// the person to "Add at least one milestone" or says "7 features in 0 milestones" (live E2E 08.11.2026): the lock
// checklist says the business analyst is planning them, and the next action says the analyst is writing the scope.
// Once the draft is over, a plan without milestones is the person's to complete again.
//   npx vitest run --config test/scope/vitest.config.ts test/scope/draftMilestones.test.ts
import { describe, expect, it } from "vitest";
import { MILESTONES_DRAFTING, lockChecklist, planBeingDrafted } from "../../src/components/scope/blocks/pageState";
import { nowChecklist } from "../../src/components/scope/blocks/nowChecklist";
import { lockDisabledReason } from "../../src/components/scope/blocks/LockCard";
import { NEXT_TEXT, nextActionFrom, type NextFacts } from "../../src/components/analysis-next/next/nextAction";
import { emptyTargets } from "../../src/domain/successTargets";

const f = (id: string, priority = "must") => ({ id, ref: `feature:${id}`, priority });
const s = (featureId: string) => ({ featureId, text: "As a team member I pick my lunch for the week" });
const features = [f("a"), f("b"), f("c")];
const stories = [s("a"), s("b"), s("c")];
const milestones = [{ featureRefs: ["feature:a", "feature:b"] }, { featureRefs: ["feature:c"] }];

const ASK = "Add at least one milestone";

describe("the plan while the scope draft writes it", () => {
  it("is being drafted until it has its features and its milestones", () => {
    expect(planBeingDrafted(true, 0, 0)).toBe(true);
    // the features are in, the milestones come next
    expect(planBeingDrafted(true, 7, 0)).toBe(true);
    expect(planBeingDrafted(true, 7, 3)).toBe(false);
    // no draft running: what is there is the plan
    expect(planBeingDrafted(false, 7, 0)).toBe(false);
    expect(planBeingDrafted(false, 0, 0)).toBe(false);
  });

  it("the lock checklist says the milestones are being planned, never asks to add one", () => {
    const items = lockChecklist(features, stories, [], true);
    const m = items.find((i) => i.key === "milestones")!;
    expect(m).toMatchObject({ ok: false, short: "being planned", text: MILESTONES_DRAFTING });
    expect(items.map((i) => i.text)).not.toContain(ASK);
    // the lock still waits for them, and its reason says why
    expect(lockDisabledReason(true, items)).toBe(MILESTONES_DRAFTING);
    // the scope page's Features chip says the same
    const now = nowChecklist({
      lockItems: items, counts: { features: 3, stories: 3, milestones: 0 },
      screens: { count: 0, reviewedAt: null, reviewedBy: null, designing: false }, success: emptyTargets(),
      openComments: { threads: 0, comments: 0 }, approvals: { loading: false, stage: false, production: false },
    });
    expect(now[0]).toMatchObject({ done: false, short: "being planned", detail: MILESTONES_DRAFTING });
  });

  it("once the milestones are in, the item counts them, draft or not", () => {
    expect(lockChecklist(features, stories, milestones, true).find((i) => i.key === "milestones")).toMatchObject({ ok: true, text: "2 milestones planned" });
    expect(lockChecklist(features, stories, milestones).find((i) => i.key === "milestones")).toMatchObject({ ok: true, text: "2 milestones planned" });
  });

  it("without a draft running, a plan with no milestone is the person's to complete", () => {
    const items = lockChecklist(features, stories, []);
    expect(items.find((i) => i.key === "milestones")).toMatchObject({ ok: false, short: "no milestones yet", text: ASK });
    expect(lockDisabledReason(true, items)).toBe(ASK);
  });
});

describe("the next action right after the requirements are approved", () => {
  const scope = (drafting: boolean, blockers: string[]): NextFacts["scope"] => ({ drafting, replanning: false, locked: false, blockers, canLock: true });
  const at = (s: NextFacts["scope"]): NextFacts => ({ step: "scope", loading: false, trouble: false, scope: s } as NextFacts);

  it("says the business analyst is writing the scope while its milestones are still to come", () => {
    const items = lockChecklist(features, stories, [], true);
    const blockers = items.filter((i) => !i.ok).map((i) => i.text);
    const a = nextActionFrom(at(scope(planBeingDrafted(true, features.length, 0), blockers)));
    expect(a).toEqual({ title: NEXT_TEXT.working, detail: NEXT_TEXT.writingScope, item: "scope", button: null, working: true });
    expect(JSON.stringify(a)).not.toContain(ASK);
  });

  it("asks to lock once the draft's plan is in", () => {
    const a = nextActionFrom(at(scope(planBeingDrafted(true, features.length, milestones.length), [])));
    expect(a).toMatchObject({ title: NEXT_TEXT.scope.title, button: "Review" });
  });
});
